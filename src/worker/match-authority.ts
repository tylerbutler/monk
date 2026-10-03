import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { advanceEngine, checkpointEngine, createEngine, restoreEngine, snapshotFor } from "./engine";
import type { EngineState, EngineTransition } from "./engine";
import { issueToken, verifyToken } from "./auth";
import { commitRecord, loadRecord } from "./storage";
import type { MatchRecord } from "./storage";
import { actorSchema, parseClientMessage, serverMessageSchema } from "../shared/protocol";
import type { CommandOutcome, EngineEvent, ServerBody, VerifiedActor } from "../shared/protocol";

const attachmentSchema = z.strictObject({
  actor: actorSchema.nullable(), streamId: z.string(), streamSeq: z.number().int().nonnegative(),
  authDeadlineMs: z.number(), expiresAtMs: z.number(),
});
type Connection = z.infer<typeof attachmentSchema>;

export class MatchAuthority extends DurableObject<Env> {
  private record: MatchRecord | null = null;
  private engine: EngineState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private authTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.record = await loadRecord(ctx.storage);
      if (this.record) this.engine = restoreEngine(this.record.checkpoint, Date.now());
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
    return { ...snapshotFor(this.engine, actor.playerId, Date.now()), canHost: actor.host };
  }
  private snapshot(socket: WebSocket): void {
    const actor = this.attachment(socket).actor;
    if (actor) this.send(socket, { type: "snapshot", snapshot: this.view(actor), trial: null, startChecking: false });
  }
  private broadcast(events: EngineEvent[], outcome: CommandOutcome | null = null, caller?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      const actor = this.attachment(socket).actor;
      if (!actor) continue;
      const privateEvents = events.filter(e => actor.host || e.type === "lifecycle" ||
        e.attackerId === actor.playerId || e.targetId === actor.playerId);
      this.send(socket, { type: "update", snapshot: this.view(actor), events: privateEvents,
        outcome: socket === caller ? outcome : null, trial: null, startChecking: false });
    }
  }
  private async accept(next: EngineTransition, outcome: CommandOutcome | null = null): Promise<void> {
    if (!this.record) throw new Error("Match record is unavailable.");
    const record = { ...this.record, checkpoint: checkpointEngine(next.state, Date.now()),
      outcomes: outcome ? [...this.record.outcomes, outcome] : this.record.outcomes };
    await commitRecord(this.ctx.storage, record, next.events);
    this.record = { ...record, events: [...record.events, ...next.events] };
    this.engine = next.state;
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
        if (!z.strictObject({}).safeParse(raw).success) return Response.json({ error: "Invalid match creation request." }, { status: 400 });
        const now = Date.now(), hostId = crypto.randomUUID(), credential = await issueToken();
        const engine = createEngine({ id: code, hostId, createdAtMs: now });
        const record: MatchRecord = {
          matchCode: code, createdAtMs: now, expiresAtMs: now + 86400000,
          checkpoint: checkpointEngine(engine, now),
          sessions: [{ id: hostId, host: true, playerId: null, verifier: credential.verifier }],
          events: [], outcomes: [],
        };
        await commitRecord(this.ctx.storage, record, []);
        this.record = record; this.engine = engine;
        await this.ctx.storage.setAlarm(record.expiresAtMs);
        return Response.json({ matchCode: code, hostToken: credential.token, playerToken: null }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
          label: z.string().trim().min(1).max(80).default("Player"),
          hostToken: z.string().min(32).max(128).nullable().default(null),
        }).safeParse(raw);
        if (!input.success) return Response.json({ error: "Invalid join request." }, { status: 400 });
        if (this.record.checkpoint.phase !== "lobby") return Response.json({ error: "Roster is closed." }, { status: 409 });
        if (input.data.hostToken && !(await this.verify(input.data.hostToken, true))) {
          return Response.json({ error: "Host credential is invalid." }, { status: 401 });
        }
        const playerId = crypto.randomUUID(), credential = await issueToken();
        const factions = ["rock", "paper", "scissors"] as const;
        const faction = factions.reduce((best, f) => this.record!.checkpoint.players.filter(p => p.faction === f).length <
          this.record!.checkpoint.players.filter(p => p.faction === best).length ? f : best);
        const next = advanceEngine(this.engine, {
          nowMs: Date.now(), actor: { id: this.record.checkpoint.hostId, host: true, playerId: null },
          commands: [{ type: "join", playerId, label: input.data.label, faction }], observations: [],
        });
        if (next.rejections.length) return Response.json({ error: next.rejections[0].reason }, { status: 409 });
        const record = { ...this.record, sessions: [...this.record.sessions,
          { id: playerId, host: false, playerId, verifier: credential.verifier }], checkpoint: checkpointEngine(next.state, Date.now()) };
        await commitRecord(this.ctx.storage, record, next.events);
        this.record = { ...record, events: [...record.events, ...next.events] }; this.engine = next.state;
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
      if (session.host === host && await verifyToken(token, session.verifier)) return session;
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
        socket.serializeAttachment({ ...connection, actor });
        this.send(socket, { type: "authenticated", playerId: actor.playerId, canHost: actor.host, expiresAtMs: this.record.expiresAtMs });
        this.snapshot(socket); return;
      }
      const actor = connection.actor;
      if (message.type === "snapshot_request") { this.snapshot(socket); return; }
      if (message.type === "host_command") {
        if (!actor.host) { this.error(socket, "forbidden", "Only the host can send this command.", message.commandId); return; }
        const existing = this.record.outcomes.find(o => o.commandId === message.commandId);
        if (existing) { this.send(socket, { type: "update", snapshot: this.view(actor), events: [], outcome: existing, trial: null, startChecking: false }); return; }
        if (this.record.outcomes.length >= 10000) { this.error(socket, "command_limit", "Command limit reached. End this match.", message.commandId); return; }
        const next = advanceEngine(this.engine, { nowMs: Date.now(), actor, commands: [message.command], observations: [] });
        const outcome = { commandId: message.commandId, accepted: !next.rejections.length, reason: next.rejections[0]?.reason ?? "Command accepted." };
        try { await this.accept(next, outcome); } catch { this.error(socket, "storage_failed", "State was not saved. Retry the same command ID.", message.commandId); return; }
        this.broadcast(next.events, outcome, socket); return;
      }
      this.error(socket, "unsupported", "This operation is not available yet.");
    });
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    const authTimer = this.authTimers.get(socket);
    if (authTimer !== undefined) clearTimeout(authTimer);
    this.authTimers.delete(socket);
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
  }
  async alarm(): Promise<void> {
    await this.serialize(async () => {
      if (this.record && Date.now() >= this.record.expiresAtMs) await this.expire();
      else if (this.record) await this.ctx.storage.setAlarm(this.record.expiresAtMs);
    });
  }
}
