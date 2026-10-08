import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { advanceEngine, checkpointEngine, restoreEngine } from "../../src/worker/engine";
import { loadRecord, recordSchema } from "../../src/worker/storage";
import { advanceAwardData } from "../../src/worker/award-data";
import type { PositionReport } from "../../src/shared/protocol";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, openSocket, runningMatch } from "./helpers";

afterEach(async () => { await closeSockets(); vi.restoreAllMocks(); await reset(); });

type Client = Awaited<ReturnType<typeof connect>>;
async function report(client: Client, seq: number, capturedAtMs: number, overrides: Partial<PositionReport> = {}) {
  client.send({ version: 1, type: "position", report: {
    seq, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0, ...overrides,
  } });
  client.send({ version: 1, type: "snapshot_request" });
  return client.next("snapshot");
}
async function preparedConversion() {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const match = await runningMatch(600000, { dwellMs: 300, graceMs: 1 });
  await hostCommand(match.host, { type: "set_faction", playerId: match.ids[1], faction: "scissors" });
  now += 2;
  await report(match.host, 2, now);
  await report(match.other, 2, now);
  match.host.messages.length = 0; match.other.messages.length = 0;
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  async function read() {
    const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
    if (!record) throw new Error("Missing award fixture record.");
    return record;
  }
  async function convert() {
    now += 300;
    await report(match.host, 3, now);
    for (;;) {
      const update = await match.host.next("update");
      if (update.events.some(e => e.type === "conversion")) return update;
    }
  }
  return { ...match, stub, read, convert, now: () => now, advance: (ms: number) => { now += ms; } };
}

it("saves award counters before announcing conversion", async () => {
  const match = await preparedConversion();
  const update = await match.convert();
  const conversion = update.events.find(e => e.type === "conversion")!;
  const record = await match.read();
  expect(record.awardData).toMatchObject({ version: 1, coverage: "complete",
    lastProcessedEventSeq: record.checkpoint.eventSeq,
    players: {
      [match.ids[0]]: { conversionsMade: 1, conversionsByFaction: { rock: 1, paper: 0, scissors: 0 },
        conversionPeerIds: [match.ids[1]], outgoingEncounters: 1 },
      [match.ids[1]]: { conversionsReceived: 1, conversionPeerIds: [match.ids[0]], incomingEncounters: 1 },
    },
    lastConversionBatch: { lastEventSeq: conversion.eventSeq, atMs: conversion.atMs, attackerIds: [match.ids[0]] },
  });
  await runInDurableObject(match.stub, instance => {
    const state = Reflect.get(instance, "engine");
    const checkpoint = checkpointEngine(state, state.last_at);
    expect(checkpoint).toEqual(record.checkpoint);
    expect(record.awardData?.lastFrame.atMs).toBe(state.last_at);
  });
});

it("keeps ordinary updates and duplicate commands idempotent", async () => {
  const match = await preparedConversion();
  const update = await match.convert();
  await hostCommand(match.host, { type: "pause" }, "pause-once");
  const saved = (await match.read()).awardData!;
  await hostCommand(match.host, { type: "end" }, "pause-once");
  match.host.send({ version: 1, type: "feedback_seen", eventSeq: update.events.find(e => e.type === "conversion")!.eventSeq });
  match.host.send({ version: 1, type: "snapshot_request" });
  await match.host.next("snapshot");
  match.other.send({ version: 1, type: "position", report: {
    seq: 1, capturedAtMs: match.now(), latitude: 0, longitude: 0, accuracyM: 99999, reportedAgeMs: null,
  } });
  expect((await match.other.next("error")).code).toBe("old_sequence");
  expect((await match.read()).awardData).toEqual(saved);
  expect(advanceAwardData(saved, saved.lastFrame, update.events)).toEqual(saved);
});

it("does not publish or retain failed award transitions", async () => {
  const match = await preparedConversion();
  const original = await match.read();
  const restore = await runInDurableObject(match.stub, (_, state) => {
    const spy = vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("Award write failed."));
    return () => spy.mockRestore();
  });
  match.advance(300);
  match.host.send({ version: 1, type: "position", report: {
    seq: 3, capturedAtMs: match.now(), latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0,
  } });
  expect((await match.host.next("error")).code).toBe("storage_failed");
  restore();
  expect(await match.read()).toEqual(original);
  await runInDurableObject(match.stub, instance => {
    expect(recordSchema.parse(Reflect.get(instance, "record")).awardData).toEqual(original.awardData);
  });
  expect([...match.host.messages, ...match.other.messages].filter(m => m.type === "update")
    .flatMap(m => m.events).filter(e => e.type === "conversion")).toEqual([]);
  await report(match.host, 3, match.now());
  expect((await match.read()).awardData?.players[match.ids[0]].conversionsMade).toBe(1);
});

it("tracks joins and retains departed participants", async () => {
  const match = await preparedConversion();
  await match.convert();
  const before = (await match.read()).awardData!.players[match.ids[1]];
  match.other.send({ version: 1, type: "leave" });
  match.other.send({ version: 1, type: "snapshot_request" });
  await match.other.next("snapshot");
  const departed = (await match.read()).awardData!;
  expect(departed.players[match.ids[1]]).toMatchObject({ label: "Test player", conversionsReceived: 1,
    conversionPeerIds: before.conversionPeerIds });
  expect(departed.lastFrame.players.some(p => p.id === match.ids[1])).toBe(false);
  const newcomer = await connect(await joinMatch(match.credentials.matchCode));
  newcomer.send({ version: 1, type: "snapshot_request" });
  const newcomerId = (await newcomer.next("snapshot")).snapshot.ownPlayerId!;
  expect(newcomerId).not.toBe(match.ids[1]);
  const saved = (await match.read()).awardData!;
  expect(saved.players[newcomerId]).toMatchObject({ label: "Test player", conversionsReceived: 0, conversionsMade: 0 });
  expect(saved.lastFrame.players.find(p => p.id === newcomerId)?.graceMs).toBe(1);
  expect(saved.players[match.ids[1]].conversionsReceived).toBe(1);
});

it.each(["suspend", "close", "unknown age", "inaccurate"] as const)(
  "cancels paused comebacks without requiring attack events: %s", async action => {
    const match = await preparedConversion();
    await match.convert();
    await hostCommand(match.host, { type: "pause" });
    const paused = (await match.read()).awardData!;
    expect(paused.players[match.ids[1]].pendingComebackEligibleMs).toBe(0);
    expect(paused.openEncounters).toEqual({});
    if (action === "suspend") {
      match.other.send({ version: 1, type: "suspend", reason: "Stop sharing." });
      match.other.send({ version: 1, type: "snapshot_request" }); await match.other.next("snapshot");
    } else if (action === "close") {
      await new Promise<void>(resolve => {
        match.other.socket.addEventListener("close", () => resolve(), { once: true }); match.other.socket.close();
      });
      match.host.send({ version: 1, type: "snapshot_request" }); await match.host.next("snapshot");
    } else {
      match.advance(1);
      await report(match.other, 3, match.now(), action === "unknown age" ? { reportedAgeMs: null } : { accuracyM: 4 });
    }
    expect((await match.read()).awardData?.players[match.ids[1]].pendingComebackEligibleMs).toBeNull();
    await hostCommand(match.host, { type: "begin_resume" });
    expect((await match.read()).awardData?.players[match.ids[1]].fastestComebackEligibleMs).toBeNull();
  });

it("does not disclose collection through messages", async () => {
  const match = await preparedConversion();
  const outsider = await connect(await joinMatch(match.credentials.matchCode));
  const legacy = await openSocket(match.credentials.matchCode);
  legacy.send({ version: 1, type: "authenticate", hostToken: null, playerToken: match.credentials.playerToken });
  await legacy.next("authenticated"); const initial = await legacy.next("snapshot");
  const converted = await match.convert();
  outsider.send({ version: 1, type: "snapshot_request" });
  const privateSnapshot = await outsider.next("snapshot");
  expect(privateSnapshot.factionHistory).toEqual([]);
  const legacyUpdate = await legacy.next("update");
  for (const message of [initial, converted, privateSnapshot, legacyUpdate]) {
    expect(JSON.stringify(message)).not.toMatch(/awardData|conversionPeerIds|influencePeerIds|openEncounters|pendingComeback|lastFrame/);
  }
  expect(initial).not.toHaveProperty("factionHistory");
  expect(legacyUpdate.events[0]).not.toHaveProperty("attackerLabel");
});

it("stores only coordinate-free award data", async () => {
  const match = await preparedConversion();
  await match.convert();
  const saved = (await match.read()).awardData;
  expect(saved).toBeTruthy();
  expect(JSON.stringify(saved)).not.toMatch(/latitude|longitude|accuracyM|capturedAtMs|distanceM|bearingDegrees|observations|reports|frames|history/);
});

it("recovers collected rounds without outage credit", async () => {
  const match = await preparedConversion();
  await match.convert();
  const newcomer = await connect(await joinMatch(match.credentials.matchCode));
  newcomer.send({ version: 1, type: "snapshot_request" });
  const newId = (await newcomer.next("snapshot")).snapshot.ownPlayerId!;
  await hostCommand(match.host, { type: "set_faction", playerId: newId, faction: "scissors" });
  match.advance(2);
  await report(newcomer, 1, match.now());
  const saved = (await match.read()).awardData!;
  expect(saved.openEncounters[match.ids[0]]).toBeDefined();
  expect(saved.players[match.ids[1]].pendingComebackEligibleMs).not.toBeNull();
  await runInDurableObject(match.stub, async (instance, state) => {
    const timer: ReturnType<typeof setTimeout> | null = Reflect.get(instance, "timer");
    if (timer !== null) clearTimeout(timer);
    await state.storage.deleteAlarm();
  });
  match.advance(100000);
  await evictDurableObject(match.stub);
  const recoveredHost = await connect(match.credentials);
  const recovered = (await match.read()).awardData!;
  expect(recovered).toMatchObject({ coverage: "complete", openEncounters: {},
    lastFrame: { phase: "paused", atMs: match.now() }, lastConversionBatch: saved.lastConversionBatch });
  for (const [id, player] of Object.entries(saved.players)) {
    expect(recovered.players[id]).toEqual({ ...player, currentUnconvertedEligibleMs: 0, pendingComebackEligibleMs: null });
  }
  await hostCommand(recoveredHost, { type: "begin_resume" });
  await report(recoveredHost, 4, match.now());
  match.advance(1000);
  await report(recoveredHost, 5, match.now());
  expect((await match.read()).awardData!.players[match.ids[0]].eligibleMs).toBe(saved.players[match.ids[0]].eligibleMs + 1000);
});

it.each(["lobby", "running", "paused", "ended"] as const)("starts legacy %s collection with honest coverage", async phase => {
  const credentials = await createMatch();
  await joinMatch(credentials.matchCode);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const original = await runInDurableObject(stub, async (_, state) => {
    const record = await loadRecord(state.storage);
    if (!record) throw new Error("Missing legacy award fixture.");
    let engine = restoreEngine(record.checkpoint, Date.now());
    for (const type of phase === "lobby" ? [] : phase === "running" ? ["start"] as const :
      phase === "paused" ? ["start", "pause"] as const : ["start", "end"] as const) {
      const next = advanceEngine(engine, { nowMs: engine.last_at,
        actor: { id: record.checkpoint.hostId, host: true, playerId: null },
        commands: [{ type }], observations: [] });
      engine = next.state; record.events.push(...next.events);
    }
    record.checkpoint = checkpointEngine(engine, engine.last_at);
    const { awardData: _removed, ...legacy } = record;
    await state.storage.put("record", legacy);
    expect((await loadRecord(state.storage))?.awardData).toBeNull();
    return record;
  });
  await evictDurableObject(stub);
  await connect(credentials);
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(record?.awardData).toMatchObject({ coverage: phase === "lobby" ? "complete" : "partial",
    startedAfterEventSeq: original.checkpoint.eventSeq, lastProcessedEventSeq: original.checkpoint.eventSeq,
    lastFrame: { phase: phase === "running" ? "paused" : phase }, lastConversionBatch: null, openEncounters: {} });
  expect(Object.values(record!.awardData!.players).every(p =>
    p.conversionsMade === 0 && p.conversionsReceived === 0 && p.eligibleMs === 0 &&
    p.incomingEncounters === 0 && p.fastestComebackEligibleMs === null)).toBe(true);
  expect(record?.sessions).toEqual(original.sessions);
  expect(record?.events).toEqual(original.events);
  expect(record?.checkpoint.parameters).toEqual(original.checkpoint.parameters);
});

it("rejects malformed present award data", async () => {
  const match = await preparedConversion();
  const original = await match.read();
  const data = original.awardData!;
  await runInDurableObject(match.stub, async (_, state) => {
    for (const invalid of [
      { ...data, version: 2 },
      { ...data, lastProcessedEventSeq: original.checkpoint.eventSeq + 1 },
      { ...data, lastFrame: { ...data.lastFrame, phase: "ended" } },
      { ...data, lastFrame: { ...data.lastFrame, remainingMs: data.lastFrame.remainingMs + 1 } },
      { ...data, lastFrame: { ...data.lastFrame, players: data.lastFrame.players.slice(1) } },
    ]) {
      await state.storage.put("record", { ...original, awardData: invalid });
      await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid.");
    }
    await state.storage.put("record", original);
  });
});

it("stops eligibility on explicit suspend and last socket close", async () => {
  const match = await preparedConversion();
  const additional = await connect({ ...match.credentials, hostToken: null });
  const initial = (await match.read()).awardData!;
  match.advance(1000);
  await new Promise<void>(resolve => {
    additional.socket.addEventListener("close", () => resolve(), { once: true }); additional.socket.close();
  });
  match.host.send({ version: 1, type: "snapshot_request" });
  expect((await match.host.next("snapshot")).snapshot.roster.find(p => p.id === match.ids[0])?.active).toBe(true);
  match.host.send({ version: 1, type: "suspend", reason: "Stop sharing." });
  match.host.send({ version: 1, type: "snapshot_request" }); await match.host.next("snapshot");
  const suspended = (await match.read()).awardData!;
  expect(suspended.players[match.ids[0]]).toMatchObject({
    eligibleMs: initial.players[match.ids[0]].eligibleMs + 1000, currentUnconvertedEligibleMs: 0,
    rangeBreaksReceived: 0, closeCallsReceived: 0,
  });
  match.advance(1000);
  await report(match.host, 3, match.now());
  match.advance(1000);
  await new Promise<void>(resolve => {
    match.host.socket.addEventListener("close", () => resolve(), { once: true }); match.host.socket.close();
  });
  match.other.send({ version: 1, type: "snapshot_request" }); await match.other.next("snapshot");
  const closed = (await match.read()).awardData!;
  expect(closed.players[match.ids[0]]).toMatchObject({
    eligibleMs: initial.players[match.ids[0]].eligibleMs + 2000, currentUnconvertedEligibleMs: 0,
    pendingComebackEligibleMs: null,
  });
  expect(closed.lastFrame.players.find(p => p.id === match.ids[0])?.usableUntilMs).toBeNull();
});

it.each(["unknown age", "inaccurate", "stale", "repeated capture"] as const)(
  "does not refresh eligibility through %s reports", async kind => {
    const match = await preparedConversion();
    const initial = (await match.read()).awardData!;
    const start = match.now();
    match.advance(31000);
    await report(match.host, 3, kind === "repeated capture" ? start : match.now(), {
      reportedAgeMs: kind === "unknown age" ? null : kind === "stale" ? 30000 : 0,
      accuracyM: kind === "inaccurate" ? 4 : 1,
    });
    const saved = (await match.read()).awardData!;
    expect(saved.players[match.ids[0]].eligibleMs).toBe(initial.players[match.ids[0]].eligibleMs + 30000);
    expect(saved.lastFrame.players.find(p => p.id === match.ids[0])?.usableUntilMs).toBeNull();
    match.advance(1000);
    await runInDurableObject(match.stub, instance => instance.alarm());
    expect((await match.read()).awardData!.players[match.ids[0]].eligibleMs).toBe(saved.players[match.ids[0]].eligibleMs);
  });

it.each(["host end", "round expiry"] as const)("closes round intervals at %s without location messages", async kind => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const match = await runningMatch(1000);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(match.credentials.matchCode));
  now += kind === "host end" ? 500 : 2000;
  if (kind === "host end") await hostCommand(match.host, { type: "end" });
  else await runDurableObjectAlarm(stub);
  const read = () => runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  const saved = (await read())!.awardData!;
  expect(saved.lastFrame).toMatchObject({ phase: "ended", remainingMs: kind === "host end" ? 500 : 0 });
  expect(saved.players[match.ids[0]]).toMatchObject({ eligibleMs: kind === "host end" ? 500 : 1000,
    currentUnconvertedEligibleMs: 0 });
  now += 1000;
  await runInDurableObject(stub, instance => instance.alarm());
  expect((await read())!.awardData!.players).toEqual(saved.players);
});

it("deletes award data with the expired room", async () => {
  const match = await preparedConversion();
  await match.convert();
  expect((await match.read()).awardData).not.toBeNull();
  const saved = await match.read();
  match.advance(saved.expiresAtMs - match.now());
  await runDurableObjectAlarm(match.stub);
  expect((await match.host.next("error")).code).toBe("expired");
  expect(await runInDurableObject(match.stub, (_, state) => state.storage.list())).toEqual(new Map());
  await runInDurableObject(match.stub, instance => instance.alarm());
  expect(await runInDurableObject(match.stub, (_, state) => state.storage.list())).toEqual(new Map());
});

it("retains summaries across roster turnover", async () => {
  const match = await preparedConversion();
  await match.convert();
  const original = (await match.read()).awardData!.players[match.ids[1]];
  for (let index = 0; index < 101; index++) {
    const guest = await connect(await joinMatch(match.credentials.matchCode));
    guest.send({ version: 1, type: "leave" });
    guest.send({ version: 1, type: "snapshot_request" }); await guest.next("snapshot");
    await new Promise<void>(resolve => {
      guest.socket.addEventListener("close", () => resolve(), { once: true }); guest.socket.close();
    });
    match.host.messages.length = 0; match.other.messages.length = 0;
  }
  const saved = (await match.read()).awardData!;
  expect(saved.lastFrame.players).toHaveLength(2);
  expect(Object.keys(saved.players)).toHaveLength(103);
  expect(saved.players[match.ids[1]]).toEqual(original);
  expect(Object.keys(saved.openEncounters).length).toBeLessThanOrEqual(2);
}, 30000);
