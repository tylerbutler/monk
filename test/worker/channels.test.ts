import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, runningMatch } from "./helpers";
import { openChannel, receivePush } from "./phoenix-transport";
import { loadRecord } from "../../src/worker/storage";
import type { MatchRecord } from "../../src/worker/storage";
import type { ServerMessage } from "../../src/shared/protocol";
import * as core from "../../rules/build/dev/javascript/beryl_protocol/beryl_protocol.mjs";
import * as bridge from "../../rules/build/dev/javascript/monk_rules/monk_rules/channels.mjs";
import { Ok } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";
import { Some } from "../../rules/build/dev/javascript/gleam_stdlib/gleam/option.mjs";

const rawSockets: WebSocket[] = [];
afterEach(async () => {
  await closeSockets();
  for (const socket of rawSockets.splice(0)) if (socket.readyState === WebSocket.OPEN) socket.close();
  vi.restoreAllMocks(); await reset();
});

it("commit survives a lost command reply and eviction", async () => {
  const credentials = await createMatch();
  const client = await connect(credentials);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const before = (await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))!;
  const commandId = "lost-reply";
  const committed = await new Promise<Extract<ServerMessage, { type: "update" }>>(resolve => {
    client.transport.dropReply = frame => {
      const payload = frame[4] as { response?: Extract<ServerMessage, { type: "update" }> };
      if (frame[3] !== "phx_reply" || payload.response?.outcome?.commandId !== commandId) return false;
      resolve(payload.response); return true;
    };
    client.send({ version: 1, type: "host_command", commandId,
      command: { type: "set_faction", playerId: client.joined.identity.playerId!, faction: "paper" } });
  });
  await evictDurableObject(stub);
  const rejoined = await connect(credentials);
  const retried = await hostCommand(rejoined, { type: "set_faction", playerId: client.joined.identity.playerId!, faction: "paper" }, commandId);
  expect(retried.outcome).toEqual(committed.outcome);
  const after = (await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))!;
  expect(after.events.filter(e => e.type === "manual_faction_change"))
    .toHaveLength(before.events.filter(e => e.type === "manual_faction_change").length + 1);
});
it.each(["serializeAttachment", "send"] as const)("preserves a committed command when %s fails before delivery", async method => {
  const credentials = await createMatch(), client = await connect(credentials);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode)), commandId = `lost-${method}`;
  const restore = await runInDurableObject(stub, (instance, state) => {
    const socket = state.getWebSockets()[0];
    const original = socket[method].bind(socket);
    let interrupted = false;
    const spy = vi.spyOn(socket, method).mockImplementation((value: string | unknown) => {
      const record = Reflect.get(instance, "record") as MatchRecord;
      if (!interrupted && record.outcomes.some(o => o.commandId === commandId)) {
        interrupted = true; throw new Error("Interrupted after commit.");
      }
      original(value as string);
    });
    return () => spy.mockRestore();
  });
  const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve, { once: true }));
  client.send({ version: 1, type: "host_command", commandId,
    command: { type: "set_faction", playerId: client.joined.identity.playerId!, faction: "paper" } });
  expect((await closed).code).toBe(1011);
  restore();
  const committed = (await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))!;
  expect(committed.outcomes.find(o => o.commandId === commandId)?.accepted).toBe(true);
  await evictDurableObject(stub);
  const retried = await hostCommand(await connect(credentials),
    { type: "set_faction", playerId: client.joined.identity.playerId!, faction: "paper" }, commandId);
  expect(retried.outcome).toEqual(committed.outcomes.find(o => o.commandId === commandId));
  const after = (await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))!;
  expect(after.events.filter(e => e.type === "manual_faction_change")).toHaveLength(1);
});
it("successful reports do not retain pending reply operations", async () => {
  const credentials = await createMatch(), client = await connect(credentials);
  for (let seq = 1; seq <= 70; seq++) {
    expect(await receivePush(client.channel.push("position", { version: 1, type: "position",
      report: { seq, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } }))).toEqual({});
  }
  const pending = await runInDurableObject(env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode)), instance => {
    const states = Reflect.get(instance, "protocols") as Map<WebSocket, core.State$>;
    return [...states.values()].map(core.pending_count);
  });
  expect(pending).toEqual([0]);
});
it("valid position traffic cannot keep a heartbeat-dead connection alive", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const started = now, credentials = await createMatch(), client = await connect(credentials);
  client.transport.suppressHeartbeats = true;
  for (let seq = 1; seq <= 70; seq++) {
    now = started + seq * 800;
    await receivePush(client.channel.push("position", { version: 1, type: "position",
      report: { seq, capturedAtMs: now, latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } }));
  }
  const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve, { once: true }));
  now = started + 60_001;
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runDurableObjectAlarm(stub);
  expect((await closed).code).toBe(1000);
  expect(await runInDurableObject(stub, instance => (Reflect.get(instance, "protocols") as Map<unknown, unknown>).size)).toBe(0);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.players).toHaveLength(1);
});
it.each([
  { elapsed: 60_000, expected: "reply" },
  { elapsed: 60_001, expected: "closed" },
  { elapsed: 80_000, expected: "closed" },
])("checks the heartbeat deadline before a frame at +$elapsed ms, even with a delayed alarm", async ({ elapsed, expected }) => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const started = now, credentials = await createMatch(), client = await connect(credentials);
  const observed = new Promise<string>(resolve => {
    client.socket.addEventListener("close", () => resolve("closed"), { once: true });
    client.socket.addEventListener("message", event => {
      const frame = JSON.parse(event.data as string);
      if (frame[1] === "deadline-heartbeat" && frame[3] === "phx_reply") resolve("reply");
    });
  });
  now = started + elapsed;
  client.socket.send(JSON.stringify([null, "deadline-heartbeat", "phoenix", "heartbeat", {}]));
  expect(await observed).toBe(expected);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runDurableObjectAlarm(stub);
  expect(await runInDurableObject(stub, instance => (Reflect.get(instance, "protocols") as Map<unknown, unknown>).size))
    .toBe(expected === "closed" ? 0 : 1);
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(record?.checkpoint.players).toHaveLength(1);
  expect(record?.outcomes).toEqual([]);
});
it("eviction preserves membership but resets authority to paused", async () => {
  const { credentials, host, ids } = await runningMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const before = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  const beforeJoin = host.transport.frames.find(frame => frame[3] === "phx_join")![0];
  host.messages.length = 0;
  await runInDurableObject(stub, instance => {
    const timer = Reflect.get(instance, "timer") as ReturnType<typeof setTimeout> | null;
    if (timer !== null) clearTimeout(timer);
    Reflect.set(instance, "timer", null);
  });
  await evictDurableObject(stub);
  host.send({ version: 1, type: "snapshot_request" });
  const recovered = await host.next("snapshot");
  expect(recovered.snapshot).toMatchObject({ phase: "paused", ownPlayerId: ids[0], radar: { reference: null } });
  expect(recovered.snapshot.roster.every(p => !p.active)).toBe(true);
  const restored = await runInDurableObject(stub, (instance, state) => {
    const states = Reflect.get(instance, "protocols") as Map<WebSocket, core.State$>;
    return state.getWebSockets().map(socket => ({
      attachment: socket.deserializeAttachment(),
      ref: core.joined_ref(states.get(socket)!, `match:${credentials.matchCode}`),
    }));
  });
  expect(restored.some(item => item.ref instanceof Some && item.ref[0] === beforeJoin)).toBe(true);
  const encoded = JSON.stringify(restored.map(item => item.attachment));
  expect(encoded).not.toContain(credentials.hostToken);
  expect(encoded).not.toContain(credentials.playerToken);
  expect(encoded).not.toMatch(/latitude|longitude|capturedAtMs|reportedAgeMs/);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.sessions).toEqual(before?.sessions);
});
it("lost operations require authorized rejoin", async () => {
  const credentials = await createMatch(), client = await connect(credentials);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runInDurableObject(stub, (instance, state) => {
    const socket = state.getWebSockets()[0], states = Reflect.get(instance, "protocols") as Map<WebSocket, core.State$>;
    const ref = core.joined_ref(states.get(socket)!, `match:${credentials.matchCode}`);
    if (!(ref instanceof Some)) throw new Error("Missing joined ref");
    const pending = bridge.receive_text(states.get(socket)!, JSON.stringify([ref[0], "lost", `match:${credentials.matchCode}`,
      "host_command", { version: 1, type: "host_command", commandId: "never-delivered", command: { type: "end" } }]), Date.now());
    if (!(pending instanceof Ok)) throw new Error("Missing pending operation");
    const exported = bridge.snapshot(pending[0].state, Date.now());
    if (!(exported instanceof Ok)) throw new Error("Export failed");
    socket.serializeAttachment({ ...socket.deserializeAttachment() as object, protocol: exported[0], savedAtMs: Date.now() });
  });
  await evictDurableObject(stub);
  await runInDurableObject(stub, instance => {
    expect((Reflect.get(instance, "protocols") as Map<WebSocket, core.State$>).size).toBe(1);
  });
  const snapshot = await client.next("snapshot");
  expect(snapshot.snapshot.phase).toBe("lobby");
  expect(client.transport.frames.filter(frame => frame[3] === "phx_join")).toHaveLength(2);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.outcomes).toEqual([]);
});
it("revoked actors cannot resume after eviction", async () => {
  const credentials = await createMatch(), host = await connect(credentials);
  const guestCredentials = await joinMatch(credentials.matchCode), guest = await connect(guestCredentials);
  await receivePush(guest.channel.push("leave", { version: 1, type: "leave" }));
  const closed = new Promise<CloseEvent>(resolve => guest.socket.addEventListener("close", resolve, { once: true }));
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await evictDurableObject(stub);
  host.send({ version: 1, type: "snapshot_request" }); await host.next("snapshot");
  expect((await closed).code).toBe(1011);
  await expect(connect(guestCredentials)).rejects.toThrow("unauthorized");
});
it.each(["invalid version", "corrupt", "oversized", "backward time"] as const)(
  "closes %s attachments without reparsing them during cleanup", async kind => {
    const credentials = await createMatch(), client = await connect(credentials);
    const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
    await runInDurableObject(stub, (_, state) => {
      const socket = state.getWebSockets()[0];
      const attachment = socket.deserializeAttachment() as { version: number; protocol: string; savedAtMs: number };
      if (kind === "invalid version") attachment.version = 2;
      if (kind === "corrupt") attachment.protocol = "{";
      if (kind === "backward time") attachment.savedAtMs = Date.now() + 1_000;
      if (kind === "oversized") {
        attachment.protocol = "";
        attachment.protocol = "x".repeat(16_001 - new TextEncoder().encode(JSON.stringify(attachment)).byteLength);
      }
      socket.serializeAttachment(attachment);
    });
    const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve, { once: true }));
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
    expect((await closed).code).toBe(1011);
    expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.players).toHaveLength(1);
  });
it("closing one of two player connections preserves the other", async () => {
  const { credentials, host, ids } = await runningMatch();
  const second = await connect(credentials);
  const closed = new Promise<void>(resolve => host.socket.addEventListener("close", () => resolve(), { once: true }));
  host.socket.close(); await closed;
  second.send({ version: 1, type: "snapshot_request" });
  const snapshot = await second.next("snapshot");
  expect(snapshot.snapshot.roster.find(p => p.id === ids[0])?.active).toBe(true);
  expect(snapshot.snapshot.radar?.reference?.active).toBe(true);
});
it("closing the last connection suspends without roster removal", async () => {
  const { host, other, ids } = await runningMatch();
  const closed = new Promise<void>(resolve => other.socket.addEventListener("close", () => resolve(), { once: true }));
  other.socket.close(); await closed;
  host.send({ version: 1, type: "snapshot_request" });
  const snapshot = await host.next("snapshot");
  expect(snapshot.snapshot.roster.find(p => p.id === ids[1])?.active).toBe(false);
  expect(snapshot.snapshot.roster).toHaveLength(2);
});
it("explicit game leave revokes player authority on remaining connections", async () => {
  const credentials = await createMatch(), client = await connect(credentials), second = await connect(credentials);
  await receivePush(client.channel.push("leave", { version: 1, type: "leave" }));
  second.send({ version: 1, type: "position", report: {
    seq: 1, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0,
  } });
  expect((await second.next("error")).code).toBe("forbidden");
  second.send({ version: 1, type: "snapshot_request" });
  expect((await second.next("snapshot")).snapshot.roster).toHaveLength(0);
  expect((await hostCommand(second, { type: "end" })).outcome?.accepted).toBe(true);
});
async function dial(code: string, search = "?vsn=2.0.0", origin: string | null = "https://monk.test") {
  return SELF.fetch(`https://monk.test/api/matches/${code}/socket/websocket${search}`, {
    headers: { Upgrade: "websocket", ...(origin === null ? {} : { Origin: origin }) },
  });
}
async function rawSocket(code: string) {
  const response = await dial(code);
  if (!response.webSocket) throw new Error(`Failed to dial: ${response.status}`);
  response.webSocket.accept(); rawSockets.push(response.webSocket);
  return response.webSocket;
}
it("joins with verified host identity and a private snapshot", async () => {
  const client = await openChannel(await createMatch());
  expect(client.joined.identity.canHost).toBe(true);
  expect(client.joined.state.type).toBe("snapshot");
  expect(client.joined.state.snapshot.ownPlayerId).not.toBeNull();
});
it.each([
  ["URL credentials", "?vsn=2.0.0&hostToken=private", 403],
  ["duplicate parameters", "?vsn=2.0.0&vsn=2.0.0", 403],
  ["unknown parameters", "?vsn=2.0.0&other=1", 403],
  ["missing version", "", 400], ["unsupported version", "?vsn=1.0.0", 400],
] as const)("rejects %s", async (_, query, status) => {
  const credentials = await createMatch();
  expect((await dial(credentials.matchCode, query)).status).toBe(status);
});
it.each([null, "https://other.test"])("rejects missing or cross-origin requests: %s", async origin => {
  expect((await dial((await createMatch()).matchCode, "?vsn=2.0.0", origin)).status).toBe(403);
});
it("requires a WebSocket upgrade", async () => {
  const credentials = await createMatch();
  expect((await SELF.fetch(`https://monk.test/api/matches/${credentials.matchCode}/socket/websocket?vsn=2.0.0`,
    { headers: { Origin: "https://monk.test" } })).status).toBe(426);
});
it("rejects wrong topics and wrong-room tokens without mutation", async () => {
  const a = await createMatch(), b = await createMatch();
  await expect(openChannel(a, "match:WRONGROOM")).rejects.toThrow("unauthorized");
  await expect(openChannel({ ...a, hostToken: b.hostToken })).rejects.toThrow("unauthorized");
  const client = await openChannel(a);
  expect(client.joined.state.snapshot.roster).toHaveLength(1);
});
it("rejects invalid application fields and event disagreement without mutation", async () => {
  const client = await openChannel(await createMatch());
  const error = new Promise<unknown>(resolve => {
    client.channel.push("host_command", { version: 1, type: "host_command", commandId: "bad",
      command: { type: "end", latitude: 10 } }).receive("error", resolve);
  });
  expect(await error).toMatchObject({ type: "error", code: "invalid_message" });
  const mismatch = new Promise<unknown>(resolve => {
    client.channel.push("position", { version: 1, type: "host_command", commandId: "mismatch",
      command: { type: "end" } }).receive("error", resolve);
  });
  expect(await mismatch).toMatchObject({ code: "invalid_message" });
  client.send({ version: 1, type: "snapshot_request" });
  expect((await client.next("snapshot")).snapshot.phase).toBe("lobby");
});
it("rejects binary frames with 1003", async () => {
  const socket = await rawSocket((await createMatch()).matchCode);
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  socket.send(new Uint8Array([0]).buffer);
  expect((await closed).code).toBe(1003);
});
it("enforces the 16 KiB UTF-8 frame boundary", async () => {
  const credentials = await createMatch();
  const socket = await rawSocket(credentials.matchCode);
  const message = '["j","j","match:' + credentials.matchCode + '","phx_join",{}]';
  const reply = new Promise<MessageEvent>(resolve => socket.addEventListener("message", resolve, { once: true }));
  socket.send(message.padEnd(16384, " "));
  expect(JSON.parse(String((await reply).data))[4]).toMatchObject({ status: "error" });
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  socket.send("é".repeat(8193));
  expect((await closed).code).toBe(1009);
});
it("unauthorized sockets expire at the five-second deadline", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const credentials = await createMatch();
  const socket = await rawSocket(credentials.matchCode);
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  now += 5000;
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runDurableObjectAlarm(stub);
  expect((await closed).code).toBe(1008);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.phase).toBe("lobby");
});
it("closes a delayed valid join as a timeout, not a revoked session", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { matchCode, hostToken, playerToken } = await createMatch();
  const socket = await rawSocket(matchCode);
  const result = new Promise<string>(resolve => {
    socket.addEventListener("close", event => resolve(`${event.code} ${event.reason}`), { once: true });
    socket.addEventListener("message", () => resolve("join reply"), { once: true });
  });
  now += 5000;
  socket.send(JSON.stringify(["1", "1", `match:${matchCode}`, "phx_join", { hostToken, playerToken }]));
  expect(await result).toBe("1008 Authorization timeout");
});
it("eviction does not extend the initial authorization deadline", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const started = now, credentials = await createMatch(), socket = await rawSocket(credentials.matchCode);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await evictDurableObject(stub); now = started + 4000;
  const deadline = await runInDurableObject(stub, (_, state) =>
    (state.getWebSockets()[0].deserializeAttachment() as { authDeadlineMs: number }).authDeadlineMs);
  expect(deadline).toBe(started + 5000);
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  now = started + 5000; await runDurableObjectAlarm(stub);
  expect((await closed).code).toBe(1008);
});
it("heartbeat deadlines survive idle eviction and a delayed alarm", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const started = now, credentials = await createMatch(), client = await connect(credentials);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve, { once: true }));
  await evictDurableObject(stub); now = started + 80_000;
  await runDurableObjectAlarm(stub);
  expect((await closed).code).toBe(1000);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.players).toHaveLength(1);
});
