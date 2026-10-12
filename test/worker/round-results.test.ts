import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { loadRecord } from "../../src/worker/storage";
import { closeSockets, connect, hostCommand, joinMatch, openSocket, runningMatch } from "./helpers";

afterEach(async () => { await closeSockets(); vi.restoreAllMocks(); await reset(); });

it("publishes complete results only after a committed host end", async () => {
  const match = await runningMatch();
  match.host.send({ version: 1, type: "snapshot_request" });
  expect((await match.host.next("snapshot")).snapshot.roundResults).toBeUndefined();
  const ended = await hostCommand(match.host, { type: "end" });
  expect(ended.snapshot.roundResults?.coverage).toBe("complete");
  expect(ended.snapshot.roundResults?.players.map(p => p.id).sort()).toEqual([...match.ids].sort());
  expect(ended.snapshot.roundResults?.players.map(p => p.rank)).toEqual([1, 1]);
  expect(JSON.stringify(ended.snapshot.roundResults)).not.toMatch(
    /awardData|conversionPeerIds|influencePeerIds|openEncounters|pendingComeback|lastFrame|latitude|longitude|accuracyM/);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.phase).toBe("ended");
});

it("publishes results when the timer ends the round", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const match = await runningMatch(100);
  match.host.messages.length = 0;
  now += 101;
  let update = await match.host.next("update");
  while (update.snapshot.phase !== "ended") update = await match.host.next("update");
  expect(update.snapshot.roundResults?.players).toHaveLength(2);
});

it("preserves ended results across eviction and reconnect", async () => {
  const match = await runningMatch();
  const ended = await hostCommand(match.host, { type: "end" });
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  await evictDurableObject(stub);
  const client = await connect(match.credentials);
  client.send({ version: 1, type: "snapshot_request" });
  expect((await client.next("snapshot")).snapshot.roundResults).toEqual(ended.snapshot.roundResults);
});

it("keeps a failed end out of storage and broadcasts", async () => {
  const match = await runningMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  const before = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  const restore = await runInDurableObject(stub, (_, state) => {
    const spy = vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("End write failed."));
    return () => spy.mockRestore();
  });
  match.host.send({ version: 1, type: "host_command", commandId: "failed-end", command: { type: "end" } });
  expect((await match.host.next("error")).code).toBe("storage_failed");
  restore();
  expect(await runInDurableObject(stub, (_, state) => loadRecord(state.storage))).toEqual(before);
  expect([...match.host.messages, ...match.other.messages]
    .filter(m => m.type === "update" && m.snapshot.roundResults !== undefined)).toEqual([]);
});

it("omits the new field for legacy sockets", async () => {
  const match = await runningMatch();
  const legacy = await openSocket(match.credentials.matchCode);
  legacy.send({ version: 1, type: "authenticate", hostToken: null, playerToken: match.credentials.playerToken });
  await legacy.next("authenticated"); await legacy.next("snapshot");
  await hostCommand(match.host, { type: "end" });
  expect((await legacy.next("update")).snapshot).not.toHaveProperty("roundResults");
  legacy.send({ version: 1, type: "snapshot_request" });
  expect((await legacy.next("snapshot")).snapshot).not.toHaveProperty("roundResults");
});

it("includes departed players without giving their open sockets results access", async () => {
  const match = await runningMatch();
  const credentials = await joinMatch(match.credentials.matchCode);
  const departed = await connect(credentials);
  departed.send({ version: 1, type: "snapshot_request" });
  const id = (await departed.next("snapshot")).snapshot.ownPlayerId;
  departed.send({ version: 1, type: "leave" });
  departed.send({ version: 1, type: "snapshot_request" }); await departed.next("snapshot");
  departed.messages.length = 0;
  const ended = await hostCommand(match.host, { type: "end" });
  expect(ended.snapshot.roundResults?.players.some(p => p.id === id)).toBe(true);
  expect((await departed.next("update")).snapshot).not.toHaveProperty("roundResults");
  departed.send({ version: 1, type: "snapshot_request" });
  expect((await departed.next("snapshot")).snapshot).not.toHaveProperty("roundResults");
  const invalid = await openSocket(credentials.matchCode);
  invalid.send({ version: 1, type: "authenticate", hostToken: null, playerToken: credentials.playerToken });
  expect((await invalid.next("error")).code).toBe("unauthorized");
});

it("shows partial legacy coverage without ranks, scores, or trophies", async () => {
  const match = await runningMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  await hostCommand(match.host, { type: "pause" });
  await closeSockets();
  await runInDurableObject(stub, async (instance, state) => {
    const timer: ReturnType<typeof setTimeout> | null = Reflect.get(instance, "timer");
    if (timer !== null) clearTimeout(timer);
    await state.storage.deleteAlarm();
    const record = await loadRecord(state.storage);
    if (!record) throw new Error("Missing legacy fixture.");
    await state.storage.put("record", { ...record, awardData: null });
    expect((await loadRecord(state.storage))?.awardData).toBeNull();
  });
  await evictDurableObject(stub);
  const client = await connect(match.credentials);
  const ended = await hostCommand(client, { type: "end" });
  expect(ended.snapshot.roundResults).toMatchObject({ coverage: "partial", awards: [] });
  expect(ended.snapshot.roundResults?.players.every(p => p.rank === null && p.conversionsMade === null)).toBe(true);
});

it("keeps ended legacy records without a collector unavailable across recovery", async () => {
  const match = await runningMatch();
  await hostCommand(match.host, { type: "end" });
  await closeSockets();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  await runInDurableObject(stub, async (instance, state) => {
    const timer: ReturnType<typeof setTimeout> | null = Reflect.get(instance, "timer");
    if (timer !== null) clearTimeout(timer);
    await state.storage.deleteAlarm();
    const record = await loadRecord(state.storage);
    if (!record) throw new Error("Missing ended legacy fixture.");
    expect(record.checkpoint.phase).toBe("ended");
    await state.storage.put("record", { ...record, awardData: null });
    expect((await loadRecord(state.storage))?.awardData).toBeNull();
  });
  for (let recovery = 0; recovery < 2; recovery++) {
    await evictDurableObject(stub);
    const client = await connect(match.credentials);
    client.send({ version: 1, type: "snapshot_request" });
    const results = (await client.next("snapshot")).snapshot.roundResults;
    expect(results).toMatchObject({ coverage: "unavailable", awards: [] });
    expect(results?.players).toHaveLength(2);
    expect(results?.players.every(p => p.rank === null && p.conversionsMade === null)).toBe(true);
    expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.awardData).toBeNull();
    await closeSockets();
  }
});

it("expires results with the room", async () => {
  const match = await runningMatch();
  await hostCommand(match.host, { type: "end" });
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  if (!record) throw new Error("Missing expiry fixture.");
  vi.spyOn(Date, "now").mockReturnValue(record.expiresAtMs + 1);
  await runDurableObjectAlarm(stub);
  expect(await runInDurableObject(stub, (_, state) => loadRecord(state.storage))).toBeNull();
});
