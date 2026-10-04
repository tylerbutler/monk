import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { advanceEngine, checkpointEngine, restoreEngine, snapshotFor } from "../../src/worker/engine";
import { commitRecord, loadRecord } from "../../src/worker/storage";
import { command, pulse, runningFixture } from "../fixtures";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, probe, runningMatch } from "./helpers";

afterEach(async () => { await closeSockets(); vi.restoreAllMocks(); await reset(); });

async function trial(withoutParameters = false) {
  const credentials = await createMatch();
  if (withoutParameters) {
    const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
    await runInDurableObject(stub, async (_, state) => {
      const record = await loadRecord(state.storage);
      if (!record) throw new Error("Missing legacy lobby fixture");
      await state.storage.put("record", { ...record, checkpoint: { ...record.checkpoint, parameters: null } });
    });
    await evictDurableObject(stub);
  }
  const host = await connect(credentials);
  const a = await connect(await joinMatch(credentials.matchCode));
  const b = await connect(await joinMatch(credentials.matchCode));
  const stranger = await connect(await joinMatch(credentials.matchCode));
  host.send({ version: 1, type: "snapshot_request" });
  const state = await host.next("snapshot");
  const guests = state.snapshot.roster.filter(player => player.id !== state.snapshot.ownPlayerId);
  const ids: [string, string] = [guests[0].id, guests[1].id];
  host.messages.length = 0;
  host.send({ version: 1, type: "trial_begin", playerIds: ids, referenceM: 4 });
  let started = await host.next("update");
  while (!started.trial) started = await host.next("update");
  return { credentials, host, a, b, stranger, ids };
}

it("runs a lobby trial without parameters only after both consents and sends private samples", async () => {
  const { a, b, stranger, host } = await trial(true);
  a.send({ version: 1, type: "trial_ready", consent: true });
  let update = await a.next("update");
  while (update.trial?.readyIds.length !== 1) update = await a.next("update");
  expect(update.trial?.collecting).toBe(false);
  b.send({ version: 1, type: "trial_ready", consent: true });
  update = await b.next("update");
  while (!update.trial?.collecting) update = await b.next("update");
  expect(update.snapshot.parameters).toBeNull();
  await Promise.all([probe(a), probe(b)]);
  const capturedAtMs = Date.now();
  a.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  b.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 4 / 6371000 * 180 / Math.PI, accuracyM: 1 } });
  const sample = await host.next("trial_sample");
  expect(sample.sample.distanceM).toBeCloseTo(4, 6);
  expect(JSON.stringify(sample)).not.toMatch(/latitude|longitude/);
  stranger.send({ version: 1, type: "snapshot_request" });
  await stranger.next("snapshot");
  expect(stranger.messages.filter(m => m.type === "trial_sample")).toHaveLength(0);
  a.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  expect(await a.next("error")).toMatchObject({ code: "duplicate_fix" });
  a.send({ version: 1, type: "position", report: { seq: 0, capturedAtMs: capturedAtMs + 1, latitude: 0, longitude: 0, accuracyM: 1 } });
  expect(await a.next("error")).toMatchObject({ code: "old_sequence" });
});

it("declined consent and leaving stop the trial", async () => {
  const { host, a } = await trial();
  a.send({ version: 1, type: "trial_ready", consent: false });
  let update = await host.next("update");
  while (update.trial !== null) update = await host.next("update");
  expect(update.trial).toBeNull();
});
it("retains coordinate-free receipt gaps after trial observations expire", async () => {
  const { a, b, host, credentials } = await trial();
  a.send({ version: 1, type: "trial_ready", consent: true });
  b.send({ version: 1, type: "trial_ready", consent: true });
  for (;;) { if ((await host.next("update")).trial?.collecting) break; }
  await Promise.all([probe(a), probe(b)]);
  const capturedAtMs = Date.now();
  a.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  b.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs, latitude: 0, longitude: 0.0001, accuracyM: 1 } });
  await host.next("trial_sample");
  await new Promise(resolve => setTimeout(resolve, 5250));
  const fresh = Date.now();
  a.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs: fresh, latitude: 0, longitude: 0, accuracyM: 1 } });
  b.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs: fresh, latitude: 0, longitude: 0.0001, accuracyM: 1 } });
  const next = await host.next("trial_sample");
  expect(next.sample.updateGapsMs.every(g => g >= 5000)).toBe(true);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  expect(JSON.stringify(await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))).not.toMatch(/latitude|longitude/);
}, 12000);

it("round and grace deadlines run without new messages", async () => {
  const { host, ids } = await runningMatch(750);
  await hostCommand(host, { type: "set_faction", playerId: ids[0], faction: "scissors" });
  for (;;) {
    const update = await host.next("update");
    if (update.snapshot.phase === "ended") {
      expect(update.snapshot.remainingMs).toBe(0);
      expect(update.snapshot.graceMs).toBeLessThan(2000);
      break;
    }
  }
});

it("pause and cancel stop collection; a fresh resume check does not immediately run", async () => {
  const { host, other } = await runningMatch();
  const paused = await hostCommand(host, { type: "pause" });
  host.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1 } });
  expect(await host.next("error")).toMatchObject({ code: "collection_stopped" });
  const checking = await hostCommand(host, { type: "begin_resume" });
  expect(checking.snapshot).toMatchObject({ phase: "paused", resumeChecking: true, remainingMs: paused.snapshot.remainingMs });
  await probe(host);
  host.send({ version: 1, type: "position", report: { seq: 3, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1 } });
  host.send({ version: 1, type: "snapshot_request" });
  expect(await host.next("snapshot")).toMatchObject({ snapshot: { phase: "paused", resumeChecking: true } });
  await hostCommand(host, { type: "cancel_resume" });
  other.send({ version: 1, type: "position", report: { seq: 2, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1 } });
  expect(await other.next("error")).toMatchObject({ code: "collection_stopped" });
});

it("leaving a selected trial stops collection and removes the player", async () => {
  const { host, a, ids } = await trial();
  a.send({ version: 1, type: "leave" });
  const update = await host.next("update");
  expect(update.trial).toBeNull();
  expect(update.snapshot.roster.some(p => p.id === ids[0])).toBe(false);
});

it("recovers running as paused, preserves committed duration, and clears observations", async () => {
  const credentials = await createMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runInDurableObject(stub, async (_, state) => {
    const record = await loadRecord(state.storage);
    if (!record) throw new Error("Missing fixture record");
    const checkpoint = checkpointEngine(pulse(runningFixture(["rock", "scissors"]), 1000, [0, 4]).state, 1000);
    await state.storage.put("record", { ...record,
      checkpoint: { ...checkpoint, id: record.matchCode, hostId: record.checkpoint.hostId, createdAtMs: record.createdAtMs } });
  });

  await evictDurableObject(stub);
  const client = await connect({ ...credentials, playerToken: null });
  client.send({ version: 1, type: "snapshot_request" });
  expect(await client.next("snapshot")).toMatchObject({ snapshot: {
    phase: "paused", remainingMs: 599000, outgoing: null, resumeChecking: false,
    roster: [{ active: false }, { active: false }],
  } });
});

it("loads older matches and drops removed play-area metadata on the next commit", async () => {
  const credentials = await createMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runInDurableObject(stub, async (_, state) => {
    const original = await loadRecord(state.storage);
    if (!original) throw new Error("Missing fixture record");
    await state.storage.put("record", { ...original, checkpoint: { ...original.checkpoint, playArea: "Old test note" } });
    const loaded = await loadRecord(state.storage);
    if (!loaded) throw new Error("Older match was lost");
    expect(loaded.checkpoint).not.toHaveProperty("playArea");
    expect(loaded.sessions).toEqual(original.sessions);
    await commitRecord(state.storage, loaded, []);
    expect(await state.storage.get("record")).toEqual(original);
  });
  const client = await connect(credentials);
  client.send({ version: 1, type: "snapshot_request" });
  expect((await client.next("snapshot")).snapshot).not.toHaveProperty("playArea");
});

it("still rejects unrelated stored checkpoint fields during legacy cleanup", async () => {
  const credentials = await createMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runInDurableObject(stub, async (_, state) => {
    const original = await loadRecord(state.storage);
    if (!original) throw new Error("Missing fixture record");
    await state.storage.put("record", { ...original,
      checkpoint: { ...original.checkpoint, playArea: "Old test note", latitude: 1 } });
    await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid");
    await state.storage.put("record", original);
  });
});

it("does not advance paused clocks during a resume check and clears canceled/timed-out checks", () => {
  const paused = command(runningFixture(["rock", "paper"]), 500, { type: "pause" }).state;
  const check = command(paused, 10000, { type: "begin_resume" }).state;
  expect(snapshotFor(check, "p1", 15000)).toMatchObject({ phase: "paused", remainingMs: 599500, resumeChecking: true });
  expect(snapshotFor(command(check, 15000, { type: "cancel_resume" }).state, "p1", 15000).resumeChecking).toBe(false);
  expect(snapshotFor(command(check, 20000).state, "p1", 20000)).toMatchObject({ phase: "paused", resumeChecking: false });
  const restored = restoreEngine(checkpointEngine(check, 15000), 100000);
  const one = advanceEngine(restored, { nowMs: 100000, actor: null, commands: [], observations: [] });
  expect(snapshotFor(one.state, "p1", 100000).phase).toBe("paused");
});

it("pauses normal mode when a connected faction has stale fixes but not test mode", () => {
  const normal = runningFixture(["rock", "rock", "paper", "paper", "scissors", "scissors"], "normal");
  const paused = advanceEngine(normal, { nowMs: 1500, actor: null, commands: [], observations: [] });
  expect(snapshotFor(paused.state, "p1", 1500).phase).toBe("paused");
  expect(snapshotFor(command(runningFixture(["rock", "paper"]), 1500).state, "p1", 1500).phase).toBe("running");
});

it("keeps a private event gap out of another player's stream", async () => {
  const { host, a, ids } = await trial();
  a.send({ version: 1, type: "snapshot_request" });
  await a.next("snapshot");
  a.messages.length = 0;
  host.send({ version: 1, type: "host_command", commandId: "private-change", command: { type: "set_faction", playerId: ids[1], faction: "scissors" } });
  const update = await a.next("update");
  expect(update.events.filter(e => e.type === "manual_faction_change")).toHaveLength(0);
  a.send({ version: 1, type: "snapshot_request" });
  const next = await a.next("snapshot");
  expect(next.streamSeq).toBe(update.streamSeq + 1);
});

it("deletes data and closes clients at the 24-hour deadline; alarm retry is idempotent", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const credentials = await createMatch();
  const client = await connect(credentials);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  now += 86400000;
  await runDurableObjectAlarm(stub);
  expect(await client.next("error")).toMatchObject({ code: "expired" });
  expect(await runInDurableObject(stub, (_, state) => loadRecord(state.storage))).toBeNull();
  const expired = await SELF.fetch(`https://monk.test/api/matches/${credentials.matchCode}/socket`, {
    headers: { Upgrade: "websocket", Origin: "https://monk.test" },
  });
  expect(expired.status).not.toBe(101);
  await runInDurableObject(stub, instance => instance.alarm());
  expect(await runInDurableObject(stub, (_, state) => loadRecord(state.storage))).toBeNull();
});
