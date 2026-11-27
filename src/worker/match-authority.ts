import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { advanceEngine, awardFrameFor, checkpointEngine, createEngine, distanceBetween, restoreEngine, snapshotFor, suspendEngine } from "./engine";
import type { EngineState, EngineTransition } from "./engine";
import { issueToken, verifyToken } from "./auth";
import { commitRecord, loadRecord } from "./storage";
import type { MatchRecord } from "./storage";
import { actorSchema, channelJoinSchema, joinReplySchema, gamePreset, isFactionChange, locationInactivityMs, parseClientMessage, serverMessageSchema } from "../shared/protocol";
import type { ClientMessage, ClockEstimate, ClockProbeSample, CommandOutcome, EngineEvent, FeedbackSummary, Observation, ServerBody, TrialStatus, VerifiedActor } from "../shared/protocol";
import { estimateClock, normalizeObservation } from "../shared/clock";
import { gameObservation } from "./locations";
import type { KnownPosition } from "./locations";
import { advanceAwardData, createAwardData, recoverAwardData } from "./award-data";
import { selectRoundResults } from "./round-results";
import * as channels from "../../rules/build/dev/javascript/monk_rules/monk_rules/channels.mjs";
import * as core from "../../rules/build/dev/javascript/beryl_protocol/beryl_protocol.mjs";
import { None, Some } from "../../rules/build/dev/javascript/gleam_stdlib/gleam/option.mjs";
import type { Result } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";
import { Ok, Error as GleamError } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";

type ProtocolState = core.State$;
type ChannelTransition = channels.Transition$;
type ReplyOperation = None | Some<core.Operation$>;
const none = new None();
const wallTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const attachmentSchema = z.strictObject({
  version: z.literal(1), protocol: z.string(), savedAtMs: wallTime,
  actor: actorSchema.nullable(), streamId: z.string(), streamSeq: z.number().int().nonnegative(),
  authDeadlineMs: wallTime, expiresAtMs: wallTime,
});
type Connection = z.infer<typeof attachmentSchema>;
function unwrap<T, E>(result: Result<T, E>): T {
  if (!(result instanceof Ok)) throw new Error("Channel transition failed.");
  return result[0];
}
type ClockSession = { probe: (Omit<ClockProbeSample, "clientReceiveMs"> & { nonce: string }) | null;
  clock: ClockEstimate | null; wallMs: number; monotonicMs: number };
type Measurement = { observation: Observation; receivedAtMs: number; updateGapMs: number; clock: ClockEstimate };
type CaptureTiming = { receivedAtMs: number; reportedAgeMs: number | null };

export class MatchAuthority extends DurableObject<Env> {
  private record: MatchRecord | null = null;
  private engine: EngineState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private protocols = new Map<WebSocket, ProtocolState>();
  private connections = new Map<WebSocket, Connection>();
  private clocks = new Map<WebSocket, ClockSession>();
  private reports = new Map<string, { seq: number; capturedAtMs: number }>();
  private lastKnownPositions = new Map<string, KnownPosition>();
  private captureTimings = new Map<string, Map<number, CaptureTiming>>();
  private measurements = new Map<string, Measurement>();
  private lastReceipts = new Map<string, number>();
  private trial: TrialStatus | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private alarmRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.record = await loadRecord(ctx.storage);
      if (this.record) {
        if (Date.now() >= this.record.expiresAtMs) { await this.expire(); return; }
        const engine = restoreEngine(this.record.checkpoint, Date.now());
        const frame = awardFrameFor(engine);
        const record = { ...this.record, checkpoint: checkpointEngine(engine, engine.last_at),
          awardData: this.record.awardData === null
            ? this.record.checkpoint.phase === "ended" ? null :
              createAwardData(frame, this.record.checkpoint.phase === "lobby" ? "complete" : "partial")
            : recoverAwardData(this.record.awardData, frame) };
        await commitRecord(ctx.storage, record, []);
        this.record = record;
        this.engine = engine;
        for (const socket of ctx.getWebSockets()) {
          try {
            const raw: unknown = socket.deserializeAttachment();
            if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 16_000) throw new Error("Attachment too large.");
            const connection = attachmentSchema.parse(raw), now = Date.now();
            if (connection.savedAtMs > now || connection.expiresAtMs !== record.expiresAtMs ||
              connection.actor && !this.validActor(connection.actor)) throw new Error("Invalid restored authority.");
            this.connections.set(socket, { ...connection, streamId: crypto.randomUUID(), streamSeq: 0 });
            await this.applyChannel(socket, unwrap(channels.restore(connection.protocol, now, now - connection.savedAtMs)));
            if (this.joined(socket)) await this.snapshot(socket);
            else if (this.connections.has(socket)) {
              this.attachment(socket).actor = null;
              if (connection.actor) this.attachment(socket).authDeadlineMs = now + 5000;
              this.checkpointConnection(socket);
            }
          } catch { await this.failConnection(socket); }
        }
        await this.scheduleAlarm();
      } else {
        for (const socket of ctx.getWebSockets()) socket.close(1011, "Match unavailable");
      }
    });
  }
  private serialize<T>(operation: () => Promise<T>, alarmEvent = false): Promise<T> {
    const result = this.queue.then(async () => {
      const value = await operation();
      try {
        await this.scheduleAlarm();
      } catch (error) {
        if (alarmEvent) throw error; // The runtime retries failed alarm handlers.
        console.warn("monk", "alarm_schedule_failed");
        if (this.alarmRetry === null) this.alarmRetry = setTimeout(() => {
          this.alarmRetry = null;
          this.ctx.waitUntil(this.serialize(async () => {}));
        }, 1000);
      }
      return value;
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private attachment(socket: WebSocket): Connection {
    const connection = this.connections.get(socket);
    if (!connection) throw new Error("Connection is unavailable.");
    return connection;
  }
  private validActor(actor: VerifiedActor): boolean {
    return !!this.record && (actor.host ? this.record.sessions.some(s => s.host && s.id === actor.id) :
      this.record.sessions.some(s => !s.host && s.id === actor.id)) &&
      (actor.playerId === null || this.record.checkpoint.players.some(p => p.id === actor.playerId) &&
        this.record.sessions.some(s => s.playerId === actor.playerId));
  }
  private joined(socket: WebSocket): boolean {
    const state = this.protocols.get(socket);
    return !!state && !!this.connections.get(socket)?.actor && !!this.record &&
      core.channel(state, `match:${this.record.matchCode}`).isOk();
  }
  private closeIfAuthTimedOut(socket: WebSocket): boolean {
    const connection = this.attachment(socket);
    if (connection.actor || Date.now() < connection.authDeadlineMs) return false;
    this.connections.delete(socket); this.protocols.delete(socket);
    socket.close(1008, "Authorization timeout");
    return true;
  }
  private checkpointConnection(socket: WebSocket): void {
    const connection = this.attachment(socket);
    const now = Date.now();
    const attachment = attachmentSchema.parse({ ...connection,
      protocol: unwrap(channels.snapshot(this.protocols.get(socket)!, now)), savedAtMs: now });
    if (new TextEncoder().encode(JSON.stringify(attachment)).byteLength > 16_000) throw new Error("Attachment too large.");
    socket.serializeAttachment(attachment);
    this.connections.set(socket, attachment);
  }
  private envelope(socket: WebSocket, body: ServerBody) {
    const connection = this.attachment(socket);
    connection.streamSeq += 1;
    return serverMessageSchema.parse({ ...body, version: 1, streamId: connection.streamId, streamSeq: connection.streamSeq });
  }
  private async send(socket: WebSocket, body: ServerBody, operation: ReplyOperation = none): Promise<void> {
    if (!this.joined(socket)) return;
    const message = this.envelope(socket, body), state = this.protocols.get(socket)!;
    await this.applyChannel(socket, unwrap(operation instanceof Some ?
      channels.reply(state, operation, JSON.stringify(message), body.type !== "error", Date.now()) :
      channels.push(state, `match:${this.record!.matchCode}`, body.type, JSON.stringify(message), Date.now())));
  }
  private async error(socket: WebSocket, code: string, reason: string, commandId: string | null = null,
    operation: ReplyOperation = none): Promise<void> {
    console.warn("monk", code);
    await this.send(socket, { type: "error", code, reason, commandId }, operation);
  }
  private async applyChannel(socket: WebSocket, transition: ChannelTransition): Promise<void> {
    if (!this.connections.has(socket)) return;
    this.protocols.set(socket, transition.state);
    this.checkpointConnection(socket);
    for (const action of transition.actions.toArray()) {
      if (!this.connections.has(socket)) break;
      if (action instanceof channels.Authorize) {
        const input = channelJoinSchema.safeParse(action.payload);
        const host = input.success && input.data.hostToken ? await this.verify(input.data.hostToken, true) : null;
        const player = input.success && input.data.playerToken ? await this.verify(input.data.playerToken, false) : null;
        if (this.closeIfAuthTimedOut(socket)) return;
        const connection = this.attachment(socket);
        if (!input.success || action.topic !== `match:${this.record!.matchCode}` ||
          input.data.hostToken && !host || input.data.playerToken && !player || !host && !player) {
          await this.applyChannel(socket, unwrap(channels.join_rejected(this.protocols.get(socket)!, action.operation,
            JSON.stringify({ code: "unauthorized", reason: "Session credentials or topic are invalid for this match." }), Date.now())));
          continue;
        }
        connection.actor = { id: host?.id ?? player!.id, host: !!host, playerId: player?.playerId ?? null };
        connection.streamId = crypto.randomUUID(); connection.streamSeq = 0;
        const reply = joinReplySchema.parse({
          identity: { playerId: connection.actor.playerId, canHost: connection.actor.host, expiresAtMs: this.record!.expiresAtMs },
          state: this.envelope(socket, this.snapshotBody(connection.actor)),
        });
        await this.applyChannel(socket, unwrap(channels.join_accepted(this.protocols.get(socket)!, action.operation, JSON.stringify(reply), Date.now())));
      } else if (action instanceof channels.Deliver) {
        const actor = this.attachment(socket).actor, parsed = parseClientMessage(action.payload);
        if (!actor || action.topic !== `match:${this.record!.matchCode}`) continue;
        if (!parsed.ok || parsed.value.type !== action.event) {
          const commandId = typeof action.payload === "object" && action.payload !== null &&
            "commandId" in action.payload && typeof action.payload.commandId === "string" ? action.payload.commandId : null;
          await this.error(socket, "invalid_message", "Invalid application message.", commandId, action.operation);
        } else {
          await this.dispatchMessage(socket, actor, parsed.value, action.operation);
        }
        if (this.protocols.has(socket)) await this.applyChannel(socket, unwrap(channels.reply(this.protocols.get(socket)!,
          action.operation, "{}", true, Date.now())));
      } else if (action instanceof channels.Cleanup) {
        await this.cleanupConnection(socket);
        await this.applyChannel(socket, unwrap(channels.cleaned_up(this.protocols.get(socket)!, action.operation, Date.now())));
      } else if (action instanceof channels.SendText) {
        this.checkpointConnection(socket);
        if (socket.readyState === WebSocket.OPEN) socket.send(action.data);
      } else if (action instanceof channels.Disconnect) {
        this.connections.delete(socket); this.protocols.delete(socket);
        socket.close(1000, action.reason);
      }
    }
  }
  private async failConnection(socket: WebSocket): Promise<void> {
    try { await this.cleanupConnection(socket); } finally {
      this.connections.delete(socket); this.protocols.delete(socket); this.clocks.delete(socket);
      socket.close(1011, "Channel recovery required");
    }
  }
  private view(actor: VerifiedActor, feedback = this.feedbackSummary()) {
    if (!this.engine || !this.record) throw new Error("Match engine is unavailable.");
    const snapshot = snapshotFor(this.engine, actor.playerId, Date.now(), actor.host, this.lastKnownPositions);
    const canReadResults = actor.host || snapshot.roster.some(p => p.id === actor.playerId);
    return { ...snapshot, feedback,
      ...(snapshot.phase === "ended" && canReadResults ?
        { roundResults: selectRoundResults(this.record.awardData, snapshot.roster) } : {}) };
  }
  private feedbackSummary(): FeedbackSummary {
    const now = Date.now();
    const records = this.record?.feedback ?? [];
    const recipients = records.flatMap(f => f.recipients);
    const delays = recipients.flatMap(r => r.seenAfterMs === null ? [] : [r.seenAfterMs]).sort((a, b) => a - b);
    const completed = records.filter(f => f.recipients.every(r => r.seenAfterMs !== null && r.seenAfterMs <= 1000)).length;
    const failed = records.filter(f => !f.recipients.every(r => r.seenAfterMs !== null && r.seenAfterMs <= 1000) &&
      (now - f.atMs >= 1000 || f.recipients.some(r => r.seenAfterMs !== null && r.seenAfterMs > 1000))).length;
    return {
      intended: recipients.length, acknowledged: delays.length,
      missing: records.reduce((n, f) => n + (now - f.atMs >= 1000 ? f.recipients.filter(r => r.seenAfterMs === null).length : 0), 0),
      conversions: records.length, conversionsWithinOneSecond: completed, conversionsFailed: failed,
      conversionsPending: records.length - completed - failed,
      p95UpperMs: delays.length && delays.length === recipients.length ? delays[Math.ceil(delays.length * .95) - 1] : null,
    };
  }
  private snapshotBody(actor: VerifiedActor): Extract<ServerBody, { type: "snapshot" }> {
    if (!this.record) throw new Error("Match record is unavailable.");
    return { type: "snapshot", snapshot: this.view(actor), trial: this.trialFor(actor), startChecking: false,
      factionHistory: this.eventsFor(actor, this.record.events.filter(isFactionChange)) };
  }
  private async snapshot(socket: WebSocket, operation: ReplyOperation = none): Promise<void> {
    const actor = this.attachment(socket).actor;
    if (actor) await this.send(socket, this.snapshotBody(actor), operation);
  }
  private eventsFor(actor: VerifiedActor, events: EngineEvent[]): EngineEvent[] {
    return events.filter(e => actor.host || e.type === "lifecycle" || actor.playerId !== null &&
      (e.attackerId === actor.playerId || e.targetId === actor.playerId));
  }
  private async broadcast(events: EngineEvent[], outcome: CommandOutcome | null = null, caller?: WebSocket,
    operation: ReplyOperation = none): Promise<void> {
    const feedback = this.feedbackSummary();
    for (const socket of this.ctx.getWebSockets()) {
      const actor = this.connections.get(socket)?.actor;
      if (!actor || !this.joined(socket)) continue;
      const privateEvents = this.eventsFor(actor, events);
      try {
        await this.send(socket, { type: "update", snapshot: this.view(actor, feedback), events: privateEvents,
          outcome: socket === caller ? outcome : null, trial: this.trialFor(actor), startChecking: false },
          socket === caller ? operation : none);
      } catch { await this.failConnection(socket); }
    }
  }
  private async accept(next: EngineTransition, outcome: CommandOutcome | null = null, sessions?: MatchRecord["sessions"],
    eligibilityResetIds: readonly string[] = []): Promise<void> {
    if (!this.record) throw new Error("Match record is unavailable.");
    const players = this.record.checkpoint.players;
    next.events = next.events.map(event => isFactionChange(event) ? { ...event,
      attackerLabel: players.find(player => player.id === event.attackerId)?.label ?? null,
      targetLabel: players.find(player => player.id === event.targetId)?.label ?? null,
      oldFaction: event.oldFaction ?? players.find(player => player.id === event.targetId)?.faction ?? null,
    } : event);
    const feedback = next.events.filter(e => e.type === "conversion" && e.attackerId && e.targetId).map(e => ({
      eventSeq: e.eventSeq, atMs: e.atMs, recipients: [
        { playerId: e.attackerId!, seenAfterMs: null }, { playerId: e.targetId!, seenAfterMs: null },
      ],
    }));
    const record = { ...this.record, feedback: [...this.record.feedback, ...feedback],
      sessions: sessions ?? this.record.sessions, checkpoint: checkpointEngine(next.state, next.state.last_at),
      awardData: this.record.awardData === null ? null :
        advanceAwardData(this.record.awardData, awardFrameFor(next.state), next.events, eligibilityResetIds),
      outcomes: outcome ? [...this.record.outcomes, outcome] : this.record.outcomes };
    await commitRecord(this.ctx.storage, record, next.events);
    this.record = { ...record, events: [...record.events, ...next.events] };
    this.engine = next.state;
    if (record.checkpoint.phase === "ended") { this.lastKnownPositions.clear(); this.reports.clear(); this.captureTimings.clear(); }
    if (record.checkpoint.phase === "ended" || (record.checkpoint.phase === "paused" && !this.view({ id: "", host: false, playerId: null }).resumeChecking)) {
      this.trial = null; this.clearMeasurements();
    }
    this.scheduleTick();
  }
  private trialFor(actor: VerifiedActor): TrialStatus | null {
    return this.trial && (actor.host || (actor.playerId !== null && this.trial.playerIds.includes(actor.playerId))) ? this.trial : null;
  }
  private clearMeasurements(): void {
    this.measurements.clear(); this.lastReceipts.clear();
  }
  private async scheduleAlarm(): Promise<void> {
    if (!this.record) return;
    const phase = this.record.checkpoint.phase;
    const recovering = phase === "running" || this.engine && snapshotFor(this.engine, null, Date.now()).resumeChecking;
    const deadlines = [this.record.expiresAtMs];
    if (recovering) deadlines.push(Date.now() + 1000);
    for (const [socket, connection] of this.connections) {
      if (!connection.actor) deadlines.push(connection.authDeadlineMs);
      const state = this.protocols.get(socket);
      if (state) {
        const deadline = channels.next_deadline(state);
        if (deadline >= 0) deadlines.push(deadline);
      }
    }
    const next = Math.min(...deadlines), current = await this.ctx.storage.getAlarm();
    // An earlier wake-up can check the new deadline without moving the alarm.
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }
  private scheduleTick(): void {
    if (this.timer !== null || !this.engine) return;
    const snapshot = snapshotFor(this.engine, null, Date.now());
    if (snapshot.phase !== "running" && !snapshot.resumeChecking && !this.trial?.collecting) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ctx.waitUntil(this.serialize(async () => {
        try { await this.tick(); } catch {
        for (const socket of this.connections.keys()) await this.error(socket, "storage_failed", "Authority update failed. Play is not confirmed.");
        this.scheduleTick();
        }
      }));
    }, 250);
  }
  private async tick(): Promise<void> {
    if (!this.record || !this.engine) return;
    if (Date.now() >= this.record.expiresAtMs) { await this.expire(); return; }
    for (const [id, measurement] of this.measurements) {
      if (measurement.observation.expiresAtMs <= Date.now()) this.measurements.delete(id);
    }
    const next = advanceEngine(this.engine, { nowMs: Date.now(), actor: null, commands: [], observations: [] });
    await this.accept(next);
    await this.broadcast(next.events);
  }
  async fetch(request: Request): Promise<Response> {
    return this.serialize(async () => {
      const url = new URL(request.url);
      const code = url.pathname.split("/")[3];
      const action = url.pathname.split("/")[4];
      if (action === "create") {
        if (this.record) return Response.json({ error: "Match code collision." }, { status: 409 });
        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
        const input = z.strictObject({ label: z.string().trim().max(80).optional() }).safeParse(raw);
        if (!input.success) return Response.json({ error: "Invalid match creation request." }, { status: 400 });
        const now = Date.now(), hostId = crypto.randomUUID(), playerId = crypto.randomUUID();
        const [credential, playerCredential] = await Promise.all([issueToken(), issueToken()]);
        const next = advanceEngine(createEngine({ id: code, hostId, createdAtMs: now }), {
          nowMs: now, actor: { id: hostId, host: true, playerId: null }, observations: [],
          commands: [
            { type: "configure", mode: "test", parameters: gamePreset, approved: false, deviceLimitations: "" },
            { type: "join", playerId, label: input.data.label || "Player 1", faction: "rock" },
          ],
        });
        if (next.rejections.length) throw new Error("Initial room setup failed.");
        const engine = next.state;
        const record: MatchRecord = {
          matchCode: code, createdAtMs: now, expiresAtMs: now + 86400000,
          checkpoint: checkpointEngine(engine, now),
          awardData: createAwardData(awardFrameFor(engine), "complete"),
          sessions: [
            { id: hostId, host: true, playerId: null, verifier: credential.verifier },
            { id: playerId, host: false, playerId, verifier: playerCredential.verifier },
          ],
          events: [], outcomes: [], feedback: [],
        };
        await commitRecord(this.ctx.storage, record, [], record.expiresAtMs);
        this.record = record; this.engine = engine;
        return Response.json({ matchCode: code, hostToken: credential.token, playerToken: playerCredential.token, expiresAtMs: record.expiresAtMs },
          { status: 201, headers: { "Cache-Control": "no-store" } });
      }
      if (!this.record || !this.engine) return Response.json({ error: "Match not found." }, { status: 404 });
      if (Date.now() >= this.record.expiresAtMs) {
        await this.expire();
        return Response.json({ error: "Match expired." }, { status: 410 });
      }
      if (action === "join") {
        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
        const input = z.strictObject({
          label: z.string().trim().max(80).optional(),
          hostToken: z.string().min(32).max(128).nullable().default(null),
        }).safeParse(raw);
        if (!input.success) return Response.json({ error: "Invalid join request." }, { status: 400 });
        if (this.record.checkpoint.phase === "ended") return Response.json({ error: "This room has ended." }, { status: 409 });
        if (input.data.hostToken && !(await this.verify(input.data.hostToken, true))) {
          return Response.json({ error: "Host credential is invalid." }, { status: 401 });
        }
        const playerId = crypto.randomUUID(), credential = await issueToken();
        let label = input.data.label;
        if (!label) {
          let number = 1;
          while (this.record.checkpoint.players.some(p => p.label === `Player ${number}`)) number++;
          label = `Player ${number}`;
        }
        const factions = ["rock", "paper", "scissors"] as const;
        const faction = factions.reduce((best, f) => this.record!.checkpoint.players.filter(p => p.faction === f).length <
          this.record!.checkpoint.players.filter(p => p.faction === best).length ? f : best);
        const next = advanceEngine(this.engine, {
          nowMs: Date.now(), actor: { id: this.record.checkpoint.hostId, host: true, playerId: null },
          commands: [{ type: "join", playerId, label, faction }], observations: [],
        });
        if (next.rejections.length) {
          if (next.events.length) {
            await this.accept(next);
            await this.broadcast(next.events);
          }
          return Response.json({ error: next.rejections[0].reason }, { status: 409 });
        }
        await this.accept(next, null, [...this.record.sessions,
          { id: playerId, host: false, playerId, verifier: credential.verifier }]);
        await this.broadcast(next.events);
        return Response.json({ matchCode: code, hostToken: null, playerToken: credential.token, expiresAtMs: this.record.expiresAtMs },
          { status: 201, headers: { "Cache-Control": "no-store" } });
      }
      if (action === "socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const pair = new WebSocketPair(), client = pair[0], server = pair[1];
        const deadline = Date.now() + 5000;
        this.connections.set(server, { version: 1, protocol: "", savedAtMs: Date.now(),
          actor: null, streamId: crypto.randomUUID(), streamSeq: 0, authDeadlineMs: deadline, expiresAtMs: this.record.expiresAtMs });
        this.protocols.set(server, unwrap(channels.new_connection(crypto.randomUUID(), Date.now())));
        this.checkpointConnection(server);
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }
      return Response.json({ error: "Unknown match route." }, { status: 404 });
    });
  }
  private async verify(token: string, host: boolean) {
    if (!this.record) return null;
    for (const session of this.record.sessions) {
      if (session.host === host && (host || this.record.checkpoint.players.some(p => p.id === session.playerId)) &&
        await verifyToken(token, session.verifier)) return session;
    }
    return null;
  }
  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer): Promise<void> {
    await this.serialize(async () => {
      if (!this.connections.has(socket)) return;
      if (!this.record || !this.engine || Date.now() >= this.record.expiresAtMs) {
        await this.expire(); return;
      }
      if (this.closeIfAuthTimedOut(socket)) return;
      if (typeof frame !== "string") {
        await this.cleanupConnection(socket);
        this.connections.delete(socket); this.protocols.delete(socket);
        socket.close(1003, "JSON text required"); return;
      }
      if (new TextEncoder().encode(frame).byteLength > 16384) {
        await this.cleanupConnection(socket);
        this.connections.delete(socket); this.protocols.delete(socket);
        socket.close(1009, "Frame too large"); return;
      }
      try {
        const deadline = channels.next_deadline(this.protocols.get(socket)!);
        if (deadline >= 0 && Date.now() >= deadline) {
          await this.applyChannel(socket, unwrap(channels.expire(this.protocols.get(socket)!, Date.now())));
          if (!this.connections.has(socket)) return;
        }
        const result = channels.receive_text(this.protocols.get(socket)!, frame, Date.now());
        if (result instanceof GleamError) {
          if (!channels.HostError$isDecode(result[0])) await this.failConnection(socket);
          return;
        }
        await this.applyChannel(socket, unwrap(result));
      } catch { await this.failConnection(socket); }
    });
  }
  private async dispatchMessage(socket: WebSocket, actor: VerifiedActor, message: ClientMessage,
    operation: ReplyOperation): Promise<void> {
      if (!this.record || !this.engine) return;
      const error = (code: string, reason: string, commandId: string | null = null) =>
        this.error(socket, code, reason, commandId, operation);
      if (message.type === "snapshot_request") { await this.snapshot(socket, operation); return; }
      if (actor.playerId && !this.record.checkpoint.players.some(p => p.id === actor.playerId) &&
        ["position", "suspend", "leave", "trial_ready", "feedback_seen"].includes(message.type)) {
        await error("forbidden", "This player has left the match."); return;
      }
      if (message.type === "host_command") {
        if (!actor.host) { await error("forbidden", "Only the host can send this command.", message.commandId); return; }
        const existing = this.record.outcomes.find(o => o.commandId === message.commandId);
        if (existing) { await this.send(socket, { type: "update", snapshot: this.view(actor), events: [], outcome: existing, trial: this.trialFor(actor), startChecking: false }, operation); return; }
        if (this.record.outcomes.length >= 10000 &&
          !(message.command.type === "end" && this.record.checkpoint.phase !== "ended")) {
          await error("command_limit", this.record.checkpoint.phase === "ended" ?
            "Command limit reached. This match has ended." : "Command limit reached. End this match.", message.commandId); return;
        }
        const unsupported = message.command.type === "configure" &&
          (message.command.mode !== "test" || message.command.parameters.freshnessMs !== locationInactivityMs);
        const next: EngineTransition = unsupported
          ? { state: this.engine, events: [], rejections: [{ reason: "Use multiplayer rules with a 30-second location inactivity limit." }] }
          : advanceEngine(this.engine, { nowMs: Date.now(), actor, commands: [message.command],
            observations: message.command.type === "start" || message.command.type === "begin_resume"
              ? [...this.lastKnownPositions].flatMap(([id, position]) => {
                const observation = gameObservation(position, id, Date.now());
                return observation ? [observation] : [];
              }) : [] });
        const outcome = { commandId: message.commandId, accepted: !next.rejections.length, reason: next.rejections[0]?.reason ?? "Command accepted." };
        try { await this.accept(next, outcome); } catch { await error("storage_failed", "State was not saved. Retry the same command ID.", message.commandId); return; }
        if (outcome.accepted && (message.command.type === "begin_resume" || message.command.type === "cancel_resume" ||
          message.command.type === "pause" || message.command.type === "end" || message.command.type === "start")) {
          this.trial = null; this.clearMeasurements();
        }
        await this.broadcast(next.events, outcome, socket, operation); return;
      }
      if (message.type === "clock_probe") {
        const serverReceiveMs = Date.now(), serverSendMs = Date.now();
        this.clocks.set(socket, { clock: null, probe: { nonce: message.nonce, clientSendMs: message.clientSendMs, serverReceiveMs, serverSendMs },
          wallMs: serverSendMs, monotonicMs: performance.now() });
        await this.send(socket, { type: "clock_reply", nonce: message.nonce, clientSendMs: message.clientSendMs, serverReceiveMs, serverSendMs }, operation); return;
      }
      if (message.type === "clock_confirm") {
        const session = this.clocks.get(socket);
        if (!session?.probe || session.probe.nonce !== message.nonce) { await error("clock_invalid", "Request a new clock probe."); return; }
        const clock = estimateClock({ ...session.probe, clientReceiveMs: message.clientReceiveMs });
        session.probe = null;
        if (!clock.ok) { session.clock = null; await error("clock_invalid", clock.error); return; }
        session.clock = clock.value; session.wallMs = Date.now(); session.monotonicMs = performance.now();
        await this.send(socket, { type: "clock_ready", clock: clock.value }, operation); return;
      }
      if (message.type === "trial_begin") {
        if (!actor.host) { await error("forbidden", "Only the host can select the trial pair."); return; }
        if (this.record.checkpoint.phase !== "lobby" || message.playerIds[0] === message.playerIds[1] ||
          !message.playerIds.every(id => this.record!.checkpoint.players.some(p => p.id === id))) {
          await error("trial_invalid", "Select two different joined players in the lobby."); return;
        }
        this.trial = { playerIds: message.playerIds, readyIds: [], collecting: false, referenceM: message.referenceM };
        this.clearMeasurements(); await this.broadcast([]); return;
      }
      if (message.type === "trial_ready") {
        if (!this.trial || !actor.playerId || !this.trial.playerIds.includes(actor.playerId)) {
          await error("trial_invalid", "You are not in the selected trial pair."); return;
        }
        if (!message.consent) { this.trial = null; this.clearMeasurements(); }
        else {
          this.trial.readyIds = Array.from(new Set([...this.trial.readyIds, actor.playerId]));
          this.trial.collecting = this.trial.readyIds.length === 2;
          this.scheduleTick();
        }
        await this.broadcast([]); return;
      }
      if (message.type === "trial_end") {
        if (!actor.host && (!actor.playerId || !this.trial?.playerIds.includes(actor.playerId))) {
          await error("forbidden", "Only the trial pair or host can stop the trial."); return;
        }
        this.trial = null; this.clearMeasurements();
        await this.broadcast([]); return;
      }
      if (message.type === "position") {
        if (!actor.playerId || !this.record.checkpoint.players.some(p => p.id === actor.playerId)) {
          await error("forbidden", "Join as a player to report a location."); return;
        }
        const view = this.view(actor);
        const inTrial = this.trial?.collecting && this.trial.playerIds.includes(actor.playerId);
        if (view.phase === "ended") { await error("collection_stopped", "This room has ended."); return; }
        const previous = this.reports.get(actor.playerId);
        if (previous && message.report.seq <= previous.seq) { await error("old_sequence", "Location sequence is out of order."); return; }
        const receivedAtMs = Date.now(), prior = this.lastKnownPositions.get(actor.playerId);
        const timing = this.captureTimings.get(actor.playerId)?.get(message.report.capturedAtMs);
        const repeated = !!timing || prior?.report.capturedAtMs === message.report.capturedAtMs;
        const known: KnownPosition = prior?.report.capturedAtMs === message.report.capturedAtMs ? { ...prior, sharing: true } :
          { report: timing ? { ...message.report, reportedAgeMs: timing.reportedAgeMs } : message.report,
            receivedAtMs: timing?.receivedAtMs ?? receivedAtMs, sharing: true };
        const gameplay = gameObservation(known, actor.playerId, receivedAtMs);
        const next = advanceEngine(gameplay ? this.engine : suspendEngine(this.engine, actor.playerId), {
          nowMs: receivedAtMs, actor: null, commands: [], observations: gameplay ? [gameplay] : [],
        });
        const resetIds = !gameplay || gameplay.accuracyM > (view.parameters?.maxAccuracyM ?? 0) ? [actor.playerId] : [];
        try { await this.accept(next, null, undefined, resetIds); } catch { await error("storage_failed", "Fix was not applied. Retry after reconnecting."); return; }
        if (this.record.checkpoint.phase !== "ended") {
          this.reports.set(actor.playerId, { seq: message.report.seq, capturedAtMs: message.report.capturedAtMs });
          this.lastKnownPositions.set(actor.playerId, known);
          const timings = this.captureTimings.get(actor.playerId) ?? new Map<number, CaptureTiming>();
          if (!timings.has(message.report.capturedAtMs)) timings.set(message.report.capturedAtMs, {
            receivedAtMs: known.receivedAtMs, reportedAgeMs: known.report.reportedAgeMs ?? null,
          });
          // ponytail: retain 512 timings; older captures rely on reported age. Increase only with field evidence.
          if (timings.size > 512) {
            const oldest = timings.keys().next().value;
            if (oldest !== undefined) timings.delete(oldest);
          }
          this.captureTimings.set(actor.playerId, timings);
        }
        await this.broadcast(next.events);
        if (inTrial && this.trial && !repeated) {
          const clockSession = this.clocks.get(socket);
          if (!clockSession?.clock || Math.abs((Date.now() - clockSession.wallMs) - (performance.now() - clockSession.monotonicMs)) > 100) {
            await error("diagnostic_clock_unavailable", "Location was shared. A clock check is needed only for measurements.");
          } else {
            const normalized = normalizeObservation(message.report, clockSession.clock, receivedAtMs, actor.playerId, 5000);
            if (!normalized.ok) await error("diagnostic_fix_invalid", `Location was shared. Measurement unavailable: ${normalized.error}`);
            else {
              const previousReceiptMs = this.lastReceipts.get(actor.playerId);
              this.lastReceipts.set(actor.playerId, receivedAtMs);
              this.measurements.set(actor.playerId, { observation: normalized.value, receivedAtMs,
                updateGapMs: previousReceiptMs === undefined ? 0 : Math.max(0, receivedAtMs - previousReceiptMs), clock: clockSession.clock });
              await this.sendTrialSample();
            }
          }
        }
        return;
      }
      if (message.type === "suspend" || message.type === "leave") {
        if (!actor.playerId) return;
        const next = advanceEngine(suspendEngine(this.engine, actor.playerId), {
          nowMs: Date.now(), actor, observations: [],
          commands: message.type === "leave" ? [{ type: "leave", playerId: actor.playerId }] : [],
        });
        const sessions = message.type === "leave" ? this.record.sessions.filter(s => s.playerId !== actor.playerId) : this.record.sessions;
        try { await this.accept(next, null, sessions, message.type === "suspend" ? [actor.playerId] : []); } catch { await error("storage_failed", "Suspension was not saved. Stop local location collection."); return; }
        if (message.type === "leave") {
          this.lastKnownPositions.delete(actor.playerId); this.reports.delete(actor.playerId); this.captureTimings.delete(actor.playerId);
        }
        else {
          const known = this.lastKnownPositions.get(actor.playerId);
          if (known) this.lastKnownPositions.set(actor.playerId, { ...known, sharing: false });
        }
        this.measurements.delete(actor.playerId);
        this.lastReceipts.delete(actor.playerId);
        if (this.trial?.playerIds.includes(actor.playerId)) { this.trial = null; this.clearMeasurements(); }
        await this.broadcast(next.events); return;
      }
      if (message.type === "feedback_seen") {
        const feedback = this.record.feedback.find(f => f.eventSeq === message.eventSeq);
        if (!feedback || !actor.playerId || !feedback.recipients.some(r => r.playerId === actor.playerId)) {
          await error("feedback_invalid", "This feedback event does not belong to your player."); return;
        }
        const record = { ...this.record, feedback: this.record.feedback.map(f => f.eventSeq !== message.eventSeq ? f : {
          ...f, recipients: f.recipients.map(r => r.playerId !== actor.playerId || r.seenAfterMs !== null ? r :
            { ...r, seenAfterMs: Math.max(0, Date.now() - f.atMs) }),
        }) };
        try { await commitRecord(this.ctx.storage, record, []); } catch { await error("storage_failed", "Feedback acknowledgement was not saved."); return; }
        this.record = record; await this.broadcast([]); return;
      }
      await error("invalid_operation", "This operation cannot be used in the current state.");
  }
  private async sendTrialSample(): Promise<void> {
    if (!this.trial?.collecting) return;
    const pair = this.trial.playerIds.map(id => this.measurements.get(id));
    const a = pair[0], b = pair[1], now = Date.now();
    if (!a || !b || a.observation.expiresAtMs <= now || b.observation.expiresAtMs <= now) return;
    const bounds = (m: Measurement): [number, number] => {
      const center = m.receivedAtMs - (m.observation.capturedAtMs + m.clock.offsetMs);
      return [Math.max(0, center - m.clock.uncertaintyMs), center + m.clock.uncertaintyMs];
    };
    const sample = {
      atMs: now, distanceM: distanceBetween(a.observation, b.observation),
      uncertaintiesM: [a.observation.accuracyM, b.observation.accuracyM] as [number, number],
      agesMs: [Math.max(0, now - (a.observation.capturedAtMs + a.clock.offsetMs - a.clock.uncertaintyMs)),
        Math.max(0, now - (b.observation.capturedAtMs + b.clock.offsetMs - b.clock.uncertaintyMs))] as [number, number],
      updateGapsMs: [a.updateGapMs, b.updateGapMs] as [number, number],
      delayBoundsMs: [bounds(a), bounds(b)] as [[number, number], [number, number]],
      clockUncertaintiesMs: [a.clock.uncertaintyMs, b.clock.uncertaintyMs] as [number, number],
      referenceM: this.trial.referenceM,
    };
    for (const socket of this.ctx.getWebSockets()) {
      const actor = this.connections.get(socket)?.actor;
      if (actor && this.trialFor(actor)) await this.send(socket, { type: "trial_sample", sample });
    }
  }
  private async cleanupConnection(socket: WebSocket): Promise<void> {
    this.clocks.delete(socket);
      const connection = this.connections.get(socket), actor = connection?.actor;
      if (connection) { connection.actor = null; connection.authDeadlineMs = Date.now() + 5000; }
      if (actor?.playerId && this.record && this.engine) {
        const others = [...this.connections].some(([s, c]) => s !== socket &&
          c.actor?.playerId === actor.playerId && this.joined(s) && s.readyState === WebSocket.OPEN);
        if (!others) {
          const next = advanceEngine(suspendEngine(this.engine, actor.playerId), { nowMs: Date.now(), actor: null, commands: [], observations: [] });
          await this.accept(next, null, undefined, [actor.playerId]);
          const known = this.lastKnownPositions.get(actor.playerId);
          if (known) this.lastKnownPositions.set(actor.playerId, { ...known, sharing: false });
          this.measurements.delete(actor.playerId);
          this.lastReceipts.delete(actor.playerId);
          if (this.trial?.playerIds.includes(actor.playerId)) { this.trial = null; this.clearMeasurements(); }
          await this.broadcast(next.events);
        }
      }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.serialize(async () => {
      try {
        const state = this.protocols.get(socket);
        if (state && this.connections.has(socket)) await this.applyChannel(socket, unwrap(channels.disconnect(state, Date.now())));
      } catch { await this.failConnection(socket); }
      this.connections.delete(socket); this.protocols.delete(socket); this.clocks.delete(socket);
      if (socket.readyState !== WebSocket.CLOSED) socket.close(1000, "Connection closed");
    });
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }
  private async expire(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try { await this.error(socket, "expired", "Match expired."); } catch { /* Close even if the final reply cannot be sent. */ }
    }
    await this.ctx.storage.deleteAll();
    this.record = null; this.engine = null;
    this.protocols.clear(); this.connections.clear();
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, "Match expired");
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.trial = null; this.clearMeasurements(); this.reports.clear(); this.clocks.clear(); this.lastKnownPositions.clear();
    this.captureTimings.clear();
  }
  async alarm(): Promise<void> {
    await this.serialize(async () => {
      if (this.record && Date.now() >= this.record.expiresAtMs) await this.expire();
      else if (this.record && this.engine) {
        for (const socket of this.connections.keys()) {
          if (this.closeIfAuthTimedOut(socket)) continue;
          try { await this.applyChannel(socket, unwrap(channels.expire(this.protocols.get(socket)!, Date.now()))); }
          catch { await this.failConnection(socket); }
        }
        const snapshot = snapshotFor(this.engine, null, Date.now());
        if (snapshot.phase === "running" || snapshot.resumeChecking) await this.tick();
      }
    }, true);
  }
}
