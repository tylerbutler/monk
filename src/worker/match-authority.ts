import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { advanceEngine, awardFrameFor, checkpointEngine, createEngine, distanceBetween, restoreEngine, snapshotFor, suspendEngine } from "./engine";
import type { EngineState, EngineTransition } from "./engine";
import { issueToken, verifyToken } from "./auth";
import { commitRecord, loadRecord } from "./storage";
import type { MatchRecord } from "./storage";
import { actorSchema, gamePreset, isFactionChange, locationInactivityMs, parseClientMessage, serverMessageSchema } from "../shared/protocol";
import type { ClockEstimate, ClockProbeSample, CommandOutcome, EngineEvent, FeedbackSummary, Observation, ServerBody, TrialStatus, VerifiedActor } from "../shared/protocol";
import { estimateClock, normalizeObservation } from "../shared/clock";
import { gameObservation } from "./locations";
import type { KnownPosition } from "./locations";
import { advanceAwardData, createAwardData, recoverAwardData } from "./award-data";

const attachmentSchema = z.strictObject({
  actor: actorSchema.nullable(), streamId: z.string(), streamSeq: z.number().int().nonnegative(),
  authDeadlineMs: z.number(), expiresAtMs: z.number(),
  supportsFactionHistory: z.boolean().optional(),
});
type Connection = z.infer<typeof attachmentSchema>;
type ClockSession = { probe: (Omit<ClockProbeSample, "clientReceiveMs"> & { nonce: string }) | null;
  clock: ClockEstimate | null; wallMs: number; monotonicMs: number };
type Measurement = { observation: Observation; receivedAtMs: number; updateGapMs: number; clock: ClockEstimate };
type CaptureTiming = { receivedAtMs: number; reportedAgeMs: number | null };

export class MatchAuthority extends DurableObject<Env> {
  private record: MatchRecord | null = null;
  private engine: EngineState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private authTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private clocks = new Map<WebSocket, ClockSession>();
  private reports = new Map<string, { seq: number; capturedAtMs: number }>();
  private lastKnownPositions = new Map<string, KnownPosition>();
  private captureTimings = new Map<string, Map<number, CaptureTiming>>();
  private measurements = new Map<string, Measurement>();
  private lastReceipts = new Map<string, number>();
  private trial: TrialStatus | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.record = await loadRecord(ctx.storage);
      if (this.record) {
        const engine = restoreEngine(this.record.checkpoint, Date.now());
        const frame = awardFrameFor(engine);
        const record = { ...this.record, checkpoint: checkpointEngine(engine, engine.last_at),
          awardData: this.record.awardData === null
            ? createAwardData(frame, this.record.checkpoint.phase === "lobby" ? "complete" : "partial")
            : recoverAwardData(this.record.awardData, frame) };
        await commitRecord(ctx.storage, record, []);
        this.record = record;
        this.engine = engine;
        for (const socket of ctx.getWebSockets()) {
          const connection = this.attachment(socket);
          socket.serializeAttachment({ ...connection, streamId: crypto.randomUUID(), streamSeq: 0 });
          if (connection.actor) this.snapshot(socket);
        }
        await this.scheduleAlarm();
      }
    });
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private attachment(socket: WebSocket): Connection {
    return attachmentSchema.parse(socket.deserializeAttachment());
  }
  private send(socket: WebSocket, body: ServerBody): void {
    const connection = this.attachment(socket);
    if (body.type === "update" && !connection.supportsFactionHistory) {
      body = { ...body, events: body.events.map(({ attackerLabel, targetLabel, ...event }) => event) };
    }
    const streamSeq = connection.streamSeq + 1;
    socket.serializeAttachment({ ...connection, streamSeq });
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(serverMessageSchema.parse({ ...body, version: 1, streamId: connection.streamId, streamSeq })));
    }
  }
  private error(socket: WebSocket, code: string, reason: string, commandId: string | null = null): void {
    console.warn("monk", code);
    this.send(socket, { type: "error", code, reason, commandId });
  }
  private view(actor: VerifiedActor) {
    if (!this.engine) throw new Error("Match engine is unavailable.");
    return { ...snapshotFor(this.engine, actor.playerId, Date.now(), actor.host, this.lastKnownPositions), feedback: this.feedbackSummary() };
  }
  private feedbackSummary(): FeedbackSummary {
    const records = this.record?.feedback ?? [];
    const recipients = records.flatMap(f => f.recipients);
    const delays = recipients.flatMap(r => r.seenAfterMs === null ? [] : [r.seenAfterMs]).sort((a, b) => a - b);
    const completed = records.filter(f => f.recipients.every(r => r.seenAfterMs !== null && r.seenAfterMs <= 1000)).length;
    const failed = records.filter(f => !f.recipients.every(r => r.seenAfterMs !== null && r.seenAfterMs <= 1000) &&
      (Date.now() - f.atMs >= 1000 || f.recipients.some(r => r.seenAfterMs !== null && r.seenAfterMs > 1000))).length;
    return {
      intended: recipients.length, acknowledged: delays.length,
      missing: records.reduce((n, f) => n + (Date.now() - f.atMs >= 1000 ? f.recipients.filter(r => r.seenAfterMs === null).length : 0), 0),
      conversions: records.length, conversionsWithinOneSecond: completed, conversionsFailed: failed,
      conversionsPending: records.length - completed - failed,
      p95UpperMs: delays.length && delays.length === recipients.length ? delays[Math.ceil(delays.length * .95) - 1] : null,
    };
  }
  private snapshot(socket: WebSocket): void {
    const connection = this.attachment(socket), actor = connection.actor;
    if (actor) {
      if (!this.record) throw new Error("Match record is unavailable.");
      this.send(socket, { type: "snapshot", snapshot: this.view(actor), trial: this.trialFor(actor), startChecking: false,
        ...(connection.supportsFactionHistory ?
          { factionHistory: this.eventsFor(actor, this.record.events.filter(isFactionChange)) } : {}) });
    }
  }
  private eventsFor(actor: VerifiedActor, events: EngineEvent[]): EngineEvent[] {
    return events.filter(e => actor.host || e.type === "lifecycle" || actor.playerId !== null &&
      (e.attackerId === actor.playerId || e.targetId === actor.playerId));
  }
  private broadcast(events: EngineEvent[], outcome: CommandOutcome | null = null, caller?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      const actor = this.attachment(socket).actor;
      if (!actor) continue;
      const privateEvents = this.eventsFor(actor, events);
      this.send(socket, { type: "update", snapshot: this.view(actor), events: privateEvents,
        outcome: socket === caller ? outcome : null, trial: this.trialFor(actor), startChecking: false });
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
    await this.scheduleAlarm();
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
    await this.ctx.storage.setAlarm(Math.min(this.record.expiresAtMs, recovering ? Date.now() + 1000 : this.record.expiresAtMs));
  }
  private scheduleTick(): void {
    if (this.timer !== null || !this.engine) return;
    const snapshot = snapshotFor(this.engine, null, Date.now());
    if (snapshot.phase !== "running" && !snapshot.resumeChecking && !this.trial?.collecting) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ctx.waitUntil(this.serialize(() => this.tick()).catch(() => {
        for (const socket of this.ctx.getWebSockets()) this.error(socket, "storage_failed", "Authority update failed. Play is not confirmed.");
        this.scheduleTick();
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
    this.broadcast(next.events);
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
        await commitRecord(this.ctx.storage, record, []);
        this.record = record; this.engine = engine;
        await this.ctx.storage.setAlarm(record.expiresAtMs);
        return Response.json({ matchCode: code, hostToken: credential.token, playerToken: playerCredential.token },
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
        if (next.rejections.length) return Response.json({ error: next.rejections[0].reason }, { status: 409 });
        await this.accept(next, null, [...this.record.sessions,
          { id: playerId, host: false, playerId, verifier: credential.verifier }]);
        this.broadcast(next.events);
        return Response.json({ matchCode: code, hostToken: null, playerToken: credential.token }, { status: 201, headers: { "Cache-Control": "no-store" } });
      }
      if (action === "socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const pair = new WebSocketPair(), client = pair[0], server = pair[1];
        const deadline = Date.now() + 5000;
        server.serializeAttachment({ actor: null, streamId: crypto.randomUUID(), streamSeq: 0,
          authDeadlineMs: deadline, expiresAtMs: this.record.expiresAtMs });
        this.ctx.acceptWebSocket(server);
        this.authTimers.set(server, setTimeout(() => {
          if (!this.attachment(server).actor) { this.error(server, "auth_timeout", "Authenticate within five seconds."); server.close(1008, "Authentication timeout"); }
          this.authTimers.delete(server);
        }, 5000));
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
      const connection = this.attachment(socket);
      if (!this.record || !this.engine || Date.now() >= this.record.expiresAtMs) {
        this.error(socket, "expired", "Match expired. Leave this match."); socket.close(1008, "Match expired"); return;
      }
      if (typeof frame !== "string" || new TextEncoder().encode(frame).byteLength > 16384) {
        this.error(socket, "invalid_frame", "Use text messages of at most 16 KiB."); socket.close(1009, "Frame too large"); return;
      }
      let raw: unknown;
      try { raw = JSON.parse(frame); } catch { this.error(socket, "invalid_json", "Invalid JSON message."); return; }
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) { this.error(socket, "invalid_message", parsed.error); return; }
      const message = parsed.value;
      if (!connection.actor) {
        if (message.type !== "authenticate" || Date.now() >= connection.authDeadlineMs) {
          this.error(socket, "unauthorized", "Authenticate before sending other messages."); socket.close(1008, "Not authenticated"); return;
        }
        const host = message.hostToken ? await this.verify(message.hostToken, true) : null;
        const player = message.playerToken ? await this.verify(message.playerToken, false) : null;
        if ((message.hostToken && !host) || (message.playerToken && !player) || (!host && !player)) {
          this.error(socket, "unauthorized", "Session credentials are invalid for this match."); socket.close(1008, "Not authenticated"); return;
        }
        const actor: VerifiedActor = { id: host?.id ?? player!.id, host: !!host, playerId: player?.playerId ?? null };
        const authTimer = this.authTimers.get(socket);
        if (authTimer !== undefined) clearTimeout(authTimer);
        this.authTimers.delete(socket);
        socket.serializeAttachment({ ...connection, actor, supportsFactionHistory: message.supportsFactionHistory === true });
        this.send(socket, { type: "authenticated", playerId: actor.playerId, canHost: actor.host, expiresAtMs: this.record.expiresAtMs });
        this.snapshot(socket); return;
      }
      const actor = connection.actor;
      if (message.type === "snapshot_request") { this.snapshot(socket); return; }
      if (message.type === "host_command") {
        if (!actor.host) { this.error(socket, "forbidden", "Only the host can send this command.", message.commandId); return; }
        const existing = this.record.outcomes.find(o => o.commandId === message.commandId);
        if (existing) { this.send(socket, { type: "update", snapshot: this.view(actor), events: [], outcome: existing, trial: this.trialFor(actor), startChecking: false }); return; }
        if (this.record.outcomes.length >= 10000) { this.error(socket, "command_limit", "Command limit reached. End this match.", message.commandId); return; }
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
        try { await this.accept(next, outcome); } catch { this.error(socket, "storage_failed", "State was not saved. Retry the same command ID.", message.commandId); return; }
        if (outcome.accepted && (message.command.type === "begin_resume" || message.command.type === "cancel_resume" ||
          message.command.type === "pause" || message.command.type === "end" || message.command.type === "start")) {
          this.trial = null; this.clearMeasurements();
        }
        this.broadcast(next.events, outcome, socket); return;
      }
      if (message.type === "clock_probe") {
        const serverReceiveMs = Date.now(), serverSendMs = Date.now();
        this.clocks.set(socket, { clock: null, probe: { nonce: message.nonce, clientSendMs: message.clientSendMs, serverReceiveMs, serverSendMs },
          wallMs: serverSendMs, monotonicMs: performance.now() });
        this.send(socket, { type: "clock_reply", nonce: message.nonce, clientSendMs: message.clientSendMs, serverReceiveMs, serverSendMs }); return;
      }
      if (message.type === "clock_confirm") {
        const session = this.clocks.get(socket);
        if (!session?.probe || session.probe.nonce !== message.nonce) { this.error(socket, "clock_invalid", "Request a new clock probe."); return; }
        const clock = estimateClock({ ...session.probe, clientReceiveMs: message.clientReceiveMs });
        session.probe = null;
        if (!clock.ok) { session.clock = null; this.error(socket, "clock_invalid", clock.error); return; }
        session.clock = clock.value; session.wallMs = Date.now(); session.monotonicMs = performance.now();
        this.send(socket, { type: "clock_ready", clock: clock.value }); return;
      }
      if (message.type === "trial_begin") {
        if (!actor.host) { this.error(socket, "forbidden", "Only the host can select the trial pair."); return; }
        if (this.record.checkpoint.phase !== "lobby" || message.playerIds[0] === message.playerIds[1] ||
          !message.playerIds.every(id => this.record!.checkpoint.players.some(p => p.id === id))) {
          this.error(socket, "trial_invalid", "Select two different joined players in the lobby."); return;
        }
        this.trial = { playerIds: message.playerIds, readyIds: [], collecting: false, referenceM: message.referenceM };
        this.clearMeasurements(); this.broadcast([]); return;
      }
      if (message.type === "trial_ready") {
        if (!this.trial || !actor.playerId || !this.trial.playerIds.includes(actor.playerId)) {
          this.error(socket, "trial_invalid", "You are not in the selected trial pair."); return;
        }
        if (!message.consent) { this.trial = null; this.clearMeasurements(); }
        else {
          this.trial.readyIds = Array.from(new Set([...this.trial.readyIds, actor.playerId]));
          this.trial.collecting = this.trial.readyIds.length === 2;
          this.scheduleTick();
        }
        this.broadcast([]); return;
      }
      if (message.type === "trial_end") {
        if (!actor.host && (!actor.playerId || !this.trial?.playerIds.includes(actor.playerId))) {
          this.error(socket, "forbidden", "Only the trial pair or host can stop the trial."); return;
        }
        this.trial = null; this.clearMeasurements();
        this.broadcast([]); return;
      }
      if (message.type === "position") {
        if (!actor.playerId || !this.record.checkpoint.players.some(p => p.id === actor.playerId)) {
          this.error(socket, "forbidden", "Join as a player to report a location."); return;
        }
        const view = this.view(actor);
        const inTrial = this.trial?.collecting && this.trial.playerIds.includes(actor.playerId);
        if (view.phase === "ended") { this.error(socket, "collection_stopped", "This room has ended."); return; }
        const previous = this.reports.get(actor.playerId);
        if (previous && message.report.seq <= previous.seq) { this.error(socket, "old_sequence", "Location sequence is out of order."); return; }
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
        try { await this.accept(next, null, undefined, resetIds); } catch { this.error(socket, "storage_failed", "Fix was not applied. Retry after reconnecting."); return; }
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
        this.broadcast(next.events);
        if (inTrial && this.trial && !repeated) {
          const clockSession = this.clocks.get(socket);
          if (!clockSession?.clock || Math.abs((Date.now() - clockSession.wallMs) - (performance.now() - clockSession.monotonicMs)) > 100) {
            this.error(socket, "diagnostic_clock_unavailable", "Location was shared. A clock check is needed only for measurements.");
          } else {
            const normalized = normalizeObservation(message.report, clockSession.clock, receivedAtMs, actor.playerId, 5000);
            if (!normalized.ok) this.error(socket, "diagnostic_fix_invalid", `Location was shared. Measurement unavailable: ${normalized.error}`);
            else {
              const previousReceiptMs = this.lastReceipts.get(actor.playerId);
              this.lastReceipts.set(actor.playerId, receivedAtMs);
              this.measurements.set(actor.playerId, { observation: normalized.value, receivedAtMs,
                updateGapMs: previousReceiptMs === undefined ? 0 : Math.max(0, receivedAtMs - previousReceiptMs), clock: clockSession.clock });
              this.sendTrialSample();
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
        try { await this.accept(next, null, sessions, message.type === "suspend" ? [actor.playerId] : []); } catch { this.error(socket, "storage_failed", "Suspension was not saved. Stop local location collection."); return; }
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
        this.broadcast(next.events); return;
      }
      if (message.type === "feedback_seen") {
        const feedback = this.record.feedback.find(f => f.eventSeq === message.eventSeq);
        if (!feedback || !actor.playerId || !feedback.recipients.some(r => r.playerId === actor.playerId)) {
          this.error(socket, "feedback_invalid", "This feedback event does not belong to your player."); return;
        }
        const record = { ...this.record, feedback: this.record.feedback.map(f => f.eventSeq !== message.eventSeq ? f : {
          ...f, recipients: f.recipients.map(r => r.playerId !== actor.playerId || r.seenAfterMs !== null ? r :
            { ...r, seenAfterMs: Math.max(0, Date.now() - f.atMs) }),
        }) };
        try { await commitRecord(this.ctx.storage, record, []); } catch { this.error(socket, "storage_failed", "Feedback acknowledgement was not saved."); return; }
        this.record = record; this.broadcast([]); return;
      }
      this.error(socket, "invalid_operation", "This operation cannot be used in the current state.");
    });
  }
  private sendTrialSample(): void {
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
      const actor = this.attachment(socket).actor;
      if (actor && this.trialFor(actor)) this.send(socket, { type: "trial_sample", sample });
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    const authTimer = this.authTimers.get(socket);
    if (authTimer !== undefined) clearTimeout(authTimer);
    this.authTimers.delete(socket);
    this.clocks.delete(socket);
    await this.serialize(async () => {
      const actor = this.attachment(socket).actor;
      if (actor?.playerId && this.record && this.engine) {
        const others = this.ctx.getWebSockets().some(s => s !== socket &&
          this.attachment(s).actor?.playerId === actor.playerId && s.readyState === WebSocket.OPEN);
        if (!others) {
          const next = advanceEngine(suspendEngine(this.engine, actor.playerId), { nowMs: Date.now(), actor: null, commands: [], observations: [] });
          await this.accept(next, null, undefined, [actor.playerId]);
          const known = this.lastKnownPositions.get(actor.playerId);
          if (known) this.lastKnownPositions.set(actor.playerId, { ...known, sharing: false });
          this.measurements.delete(actor.playerId);
          this.lastReceipts.delete(actor.playerId);
          if (this.trial?.playerIds.includes(actor.playerId)) { this.trial = null; this.clearMeasurements(); }
          this.broadcast(next.events);
        }
      }
    });
    socket.close(1000, "Connection closed");
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }
  private async expire(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      this.error(socket, "expired", "Match expired."); socket.close(1008, "Match expired");
    }
    await this.ctx.storage.deleteAll();
    this.record = null; this.engine = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.trial = null; this.clearMeasurements(); this.reports.clear(); this.clocks.clear(); this.lastKnownPositions.clear();
    this.captureTimings.clear();
  }
  async alarm(): Promise<void> {
    await this.serialize(async () => {
      if (this.record && Date.now() >= this.record.expiresAtMs) await this.expire();
      else if (this.record && this.engine) {
        await this.tick();
        await this.scheduleAlarm();
      }
    });
  }
}
