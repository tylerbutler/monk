import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { checkpointEngine } from "../../src/worker/engine";
import { loadRecord, recordSchema } from "../../src/worker/storage";
import { advanceAwardData } from "../../src/worker/award-data";
import type { PositionReport } from "../../src/shared/protocol";
import { closeSockets, connect, hostCommand, joinMatch, openSocket, runningMatch } from "./helpers";

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
