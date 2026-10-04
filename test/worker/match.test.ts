import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset, runInDurableObject } from "cloudflare:test";
import { loadRecord } from "../../src/worker/storage";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, openSocket, probe, runningMatch } from "./helpers";
import { parameters } from "../fixtures";

afterEach(async () => {
  await closeSockets();
  vi.restoreAllMocks();
  await reset();
});

it("creates a room with the host already playing and unapproved test defaults", async () => {
  const credentials = await createMatch();
  expect(credentials.playerToken).not.toBeNull();
  const client = await connect(credentials);
  client.send({ version: 1, type: "snapshot_request" });
  const { snapshot } = await client.next("snapshot");
  expect(snapshot).toMatchObject({
    phase: "lobby", mode: "test", canHost: true, approved: false, ownFaction: "rock",
    roster: [{ label: "Player 1" }],
    parameters: { entryRadiusM: 30, retentionRadiusM: 40, maxAccuracyM: 15,
      freshnessMs: 5000, dwellMs: 2000, graceMs: 3000, roundDurationMs: 600000 },
  });
  expect(snapshot.ownPlayerId).not.toBeNull();
  expect(snapshot).not.toHaveProperty("playArea");
});

it("starts from automatic room settings after the invited player joins", async () => {
  const credentials = await createMatch();
  const host = await connect(credentials);
  const other = await connect(await joinMatch(credentials.matchCode));
  host.send({ version: 1, type: "snapshot_request" });
  const { snapshot } = await host.next("snapshot");
  expect(snapshot.roster.map(player => player.label)).toEqual(["Player 1", "Test player"]);
  host.messages.length = 0;
  host.send({ version: 1, type: "host_command", commandId: "direct-start", command: { type: "start" } });
  const checking = await host.next("update");
  expect(checking.startChecking).toBe(true);
  await Promise.all([probe(host), probe(other)]);
  const capturedAtMs = Date.now();
  host.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  other.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0.001, accuracyM: 1 } });
  let started = await host.next("update");
  while (started.outcome?.commandId !== "direct-start") started = await host.next("update");
  expect(started).toMatchObject({ outcome: { accepted: true }, snapshot: { phase: "running" } });
});

it("starts a two-phone round from a fresh consent check without a trial", async () => {
  const credentials = await createMatch();
  const host = await connect(credentials);
  const other = await connect(await joinMatch(credentials.matchCode));
  await hostCommand(host, { type: "configure", mode: "test", parameters, approved: false,
    deviceLimitations: "Synthetic pair" });
  host.send({ version: 1, type: "host_command", commandId: "start-check", command: { type: "start" } });
  let check = await host.next("update");
  while (!check.startChecking) check = await host.next("update");
  expect(check.snapshot.phase).toBe("lobby");
  expect(check.trial).toBeNull();
  await Promise.all([probe(host), probe(other)]);
  const capturedAtMs = Date.now();
  host.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  other.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0.001, accuracyM: 1 } });
  let started = await host.next("update");
  while (started.outcome?.commandId !== "start-check") started = await host.next("update");
  expect(started).toMatchObject({ startChecking: false, outcome: { accepted: true }, snapshot: { phase: "running", mode: "test" } });
});

it("sends player-relative radar updates without retaining positions", async () => {
  const { credentials, host, other, ids } = await runningMatch();
  host.send({ version: 1, type: "snapshot_request" });
  other.send({ version: 1, type: "snapshot_request" });
  const [a, b] = await Promise.all([host.next("snapshot"), other.next("snapshot")]);
  expect(a.snapshot.radar).toMatchObject({
    reference: { playerId: ids[0] }, players: [{ playerId: ids[1], position: { distanceM: 100, bearingDegrees: 90 } }],
  });
  expect(b.snapshot.radar).toMatchObject({
    reference: { playerId: ids[1] }, players: [{ playerId: ids[0], position: { distanceM: 100, bearingDegrees: 270 } }],
  });
  expect(JSON.stringify([a, b])).not.toMatch(/latitude|longitude/);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(JSON.stringify(record)).not.toMatch(/radar|latitude|longitude|bearingDegrees|distanceM/);
  const paused = await hostCommand(host, { type: "pause" });
  expect(paused.snapshot.radar).toBeNull();
});

it("resolves a conversion and measures both visible-recipient acknowledgements", async () => {
  const { host, other, ids } = await runningMatch(30000, { dwellMs: 300, graceMs: 200 });
  await hostCommand(host, { type: "set_faction", playerId: ids[1], faction: "scissors" });
  await new Promise(resolve => setTimeout(resolve, 220));
  const capturedAtMs = Date.now();
  host.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  other.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs, latitude: 0, longitude: 4 / 6371000 * 180 / Math.PI, accuracyM: 1 } });
  let converted = await host.next("update");
  while (!converted.events.some(e => e.type === "conversion")) converted = await host.next("update");
  const event = converted.events.find(e => e.type === "conversion");
  if (!event) throw new Error("Missing conversion");
  expect(converted.snapshot.phase).toBe("running");
  expect(JSON.stringify(converted)).not.toMatch(/latitude|longitude/);
  host.send({ version: 1, type: "feedback_seen", eventSeq: event.eventSeq });
  other.send({ version: 1, type: "feedback_seen", eventSeq: event.eventSeq });
  host.send({ version: 1, type: "snapshot_request" });
  let snapshot = await host.next("snapshot");
  while (snapshot.snapshot.feedback?.acknowledged !== 2) {
    host.send({ version: 1, type: "snapshot_request" }); snapshot = await host.next("snapshot");
  }
  expect(snapshot.snapshot.feedback).toMatchObject({ intended: 2, acknowledged: 2, conversionsWithinOneSecond: 1 });
});

it("a join code grants no host authority, and wrong-match tokens fail", async () => {
  const a = await createMatch(), b = await createMatch();
  const socket = await openSocket(a.matchCode);
  socket.send({ version: 1, type: "authenticate", hostToken: a.matchCode, playerToken: null });
  expect(await socket.next("error")).toMatchObject({ code: "invalid_message" });
  const joined = await connect(await joinMatch(a.matchCode));
  joined.send({ version: 1, type: "host_command", commandId: "forged-host", command: { type: "end" } });
  expect(await joined.next("error")).toMatchObject({ code: "forbidden" });
  const wrong = await openSocket(a.matchCode);
  wrong.send({ version: 1, type: "authenticate", hostToken: b.hostToken, playerToken: null });
  expect(await wrong.next("error")).toMatchObject({ code: "unauthorized" });
});
it("joining guests receive only their own player credential", async () => {
  const host = await createMatch();
  const player = await joinMatch(host.matchCode, host.hostToken);
  expect(player.hostToken).toBeNull();
  expect(player.playerToken).toBeTruthy();
  const client = await connect(player);
  client.send({ version: 1, type: "snapshot_request" });
  expect(await client.next("snapshot")).toMatchObject({ snapshot: { canHost: false, ownFaction: "paper" } });
});
it("returns visible invalid-JSON errors without logging secrets or locations", async () => {
  const logs = vi.spyOn(console, "warn");
  const host = await createMatch();
  const client = await connect(host);
  client.socket.send(`{"token":"${host.hostToken}","latitude":42.12345`);
  expect(await client.next("error")).toMatchObject({ code: "invalid_json" });
  expect(JSON.stringify(logs.mock.calls)).not.toContain(host.hostToken);
  expect(JSON.stringify(logs.mock.calls)).not.toContain("42.12345");
});
it("deduplicates command outcomes without another event or grace change", async () => {
  const host = await createMatch(), player = await joinMatch(host.matchCode);
  const client = await connect(host);
  client.send({ version: 1, type: "snapshot_request" });
  const snapshot = await client.next("snapshot");
  const playerId = snapshot.snapshot.roster[0].id;
  const message = { version: 1 as const, type: "host_command" as const, commandId: "change-1",
    command: { type: "set_faction" as const, playerId, faction: "paper" as const } };
  client.send(message);
  const original = await client.next("update");
  client.send(message);
  const retry = await client.next("update");
  expect(retry.outcome).toEqual(original.outcome);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(record?.events.filter(e => e.type === "manual_faction_change")).toHaveLength(1);
  expect(JSON.stringify(record)).not.toContain(player.playerToken);
});
it("a failed storage commit emits no successful transition", async () => {
  const host = await createMatch();
  const client = await connect(host);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  const restore = await runInDurableObject(stub, (_, state) => {
    const spy = vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("disk failure"));
    return () => spy.mockRestore();
  });
  client.send({ version: 1, type: "host_command", commandId: "end-1", command: { type: "end" } });
  expect(await client.next("error")).toMatchObject({ code: "storage_failed" });
  restore();
  client.send({ version: 1, type: "snapshot_request" });
  expect(await client.next("snapshot")).toMatchObject({ snapshot: { phase: "lobby" } });
});
it("closed rosters reject new joins and corrupt records are not treated as new matches", async () => {
  const host = await createMatch();
  const client = await connect(host);
  client.send({ version: 1, type: "host_command", commandId: "end-1", command: { type: "end" } });
  await client.next("update");
  const response = await SELF.fetch(`https://monk.test/api/matches/${host.matchCode}/join`, { method: "POST", body: "{}" });
  expect(response.status).toBe(409);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  await runInDurableObject(stub, async (_, state) => {
    const original = await loadRecord(state.storage);
    if (!original) throw new Error("Missing match fixture");
    await state.storage.put("record", { broken: true });
    await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid");
    await state.storage.put("record", original);
  });
});
it("rejects cross-origin sockets and credentials in URLs", async () => {
  const host = await createMatch();
  for (const [suffix, origin] of [["", "https://other.test"], ["?token=secret", "https://monk.test"]]) {
    const response = await SELF.fetch(`https://monk.test/api/matches/${host.matchCode}/socket${suffix}`, {
      headers: { Upgrade: "websocket", Origin: origin },
    });

    expect(response.status).toBe(403);
  }
});

it("counts missing feedback as a failed conversion rather than reporting successful latency", async () => {
  const { host, other, ids } = await runningMatch(30000, { dwellMs: 300, graceMs: 200 });
  await hostCommand(host, { type: "set_faction", playerId: ids[1], faction: "scissors" });
  await new Promise(resolve => setTimeout(resolve, 220));
  const capturedAtMs = Date.now();
  host.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  other.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs, latitude: 0, longitude: 4 / 6371000 * 180 / Math.PI, accuracyM: 1 } });
  let update = await host.next("update");
  while (!update.events.some(e => e.type === "conversion")) update = await host.next("update");
  const event = update.events.find(e => e.type === "conversion");
  if (!event) throw new Error("Conversion missing");
  host.send({ version: 1, type: "feedback_seen", eventSeq: event.eventSeq });
  await new Promise(resolve => setTimeout(resolve, 1050));
  host.send({ version: 1, type: "snapshot_request" });
  const snapshot = await host.next("snapshot");
  expect(snapshot.snapshot.feedback).toMatchObject({
    intended: 2, acknowledged: 1, missing: 1, conversionsFailed: 1,
    conversionsWithinOneSecond: 0, p95UpperMs: null,
  });
});
