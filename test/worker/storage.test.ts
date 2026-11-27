import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { checkpointEngine } from "../../src/worker/engine";
import { createAwardData } from "../../src/worker/award-data";
import { commitRecord, loadRecord, recordSchema } from "../../src/worker/storage";
import type { MatchRecord } from "../../src/worker/storage";
import { lobbyFixture } from "../fixtures";

afterEach(async () => { vi.restoreAllMocks(); await reset(); });

function fixture(): MatchRecord {
  const saved = checkpointEngine(lobbyFixture([]), 0);
  const createdAtMs = Date.now();
  const checkpoint = { ...saved, id: "ABCDEFGH", createdAtMs, parameters: { ...saved.parameters!, freshnessMs: 30000 } };
  return recordSchema.parse({ matchCode: checkpoint.id, createdAtMs, expiresAtMs: createdAtMs + 86400000,
    checkpoint, sessions: [], events: [], outcomes: [], feedback: [], awardData: null });
}
function event(eventSeq: number) {
  return { type: "lifecycle" as const, attackerId: null, targetId: null, faction: null,
    reason: `Event ${eventSeq}`, hostId: null, oldFaction: null, eventSeq, atMs: 0 };
}
function stub() { return env.MATCHES.get(env.MATCHES.idFromName("storage-fixture")); }

it("round trips history above the per-value limit in order after eviction", async () => {
  const room = stub();
  const record = fixture();
  record.events = Array.from({ length: 2000 }, (_, i) => event(i + 1));
  record.checkpoint.eventSeq = record.events.length;
  record.outcomes = Array.from({ length: 1000 }, (_, i) => ({ commandId: `command-${i}`, accepted: true, reason: "" }));
  await runInDurableObject(room, async (_, state) => {
    await commitRecord(state.storage, record, []);
    const values = await state.storage.list();
    expect(values.size).toBeGreaterThan(3000);
    expect(JSON.stringify(values.get("record"))).not.toContain("Event 1");
    for (const value of values.values()) expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(128 * 1024);
  });
  await evictDurableObject(room);
  const { awardData: _unavailable, ...expected } = record;
  expect(await runInDurableObject(room, (_, state) => loadRecord(state.storage))).toMatchObject(expected);
});

it("writes only changed collections and appended history without re-reading unchanged history", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    record.events = [event(1)];
    record.checkpoint.eventSeq = 1;
    record.feedback = [{ eventSeq: 1, atMs: 0, recipients: [
      { playerId: "a", seenAfterMs: null }, { playerId: "b", seenAfterMs: null },
    ] }];
    await commitRecord(state.storage, record, []);
    const before = await state.storage.list();
    const transaction = state.storage.transaction.bind(state.storage);
    const writes: string[] = [];
    const lists = vi.spyOn(state.storage, "list");
    vi.spyOn(state.storage, "transaction").mockImplementation(callback => transaction(async tx => {
      const put = tx.put.bind(tx);
      return callback(new Proxy(tx, { get(target, property) {
        if (property === "put") return async (key: string, value: unknown) => { writes.push(key); await put(key, value); };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }));
    }));
    record.feedback[0].recipients[0].seenAfterMs = 12;
    record.checkpoint.eventSeq = 2;
    await commitRecord(state.storage, record, [event(2)]);
    expect(lists).not.toHaveBeenCalled();
    expect(writes.some(key => key.includes("outcomes"))).toBe(false);
    expect(writes).not.toContain("record:v2:events:000000000000:000000");
    expect(await loadRecord(state.storage)).toEqual({ ...record, events: [...record.events, event(2)] });
    expect(before.get("record:v2:events:000000000000:000000")).toEqual(JSON.stringify(event(1)));
  });
});

it("splits retained award summaries and oversized individual peer lists losslessly", async () => {
  const record = fixture();
  record.awardData = createAwardData({ atMs: 0, eventSeq: 0, phase: "lobby", remainingMs: record.checkpoint.remainingMs,
    dwellMs: record.checkpoint.parameters!.dwellMs, players: [] }, "complete");
  const player = createAwardData({ ...record.awardData.lastFrame, players: [
    { id: "a", label: "A", faction: "rock", graceMs: 0, usableUntilMs: null },
  ] }, "complete").players.a;
  const ids = Array.from({ length: 1200 }, (_, i) => `player-${i}-${"x".repeat(100)}`);
  record.awardData.players = Object.fromEntries(ids.map(id => [id, { ...player, label: id.slice(0, 80) }]));
  record.awardData.players.a = { ...player, conversionPeerIds: ids };
  await runInDurableObject(stub(), async (_, state) => {
    await commitRecord(state.storage, record, []);
    expect(await loadRecord(state.storage)).toEqual(record);
    const values = await state.storage.list();
    for (const value of values.values()) expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(128 * 1024);
  });
});

it("retires valid old rooms without credentials, alarms, or identity reuse", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    await state.storage.put("record", record);
    await state.storage.setAlarm(Date.now() + 86400000);
    expect(await loadRecord(state.storage)).toBeNull();
    expect(await state.storage.list()).toEqual(new Map([["record", { version: 2, retired: true }]]));
    expect(await state.storage.getAlarm()).toBeNull();
    expect(await loadRecord(state.storage)).toBeNull();
    await expect(commitRecord(state.storage, record, [])).rejects.toThrow("Stored match record is invalid");
  });
});

it("fails closed on corrupt records and missing split values, and never truncates committed history", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    await state.storage.put("record", { ...record, expiresAtMs: 1 });
    await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid");
    await expect(commitRecord(state.storage, record, [])).rejects.toThrow("Stored match record is invalid");
    await state.storage.deleteAll();
    record.checkpoint.eventSeq = 1;
    await commitRecord(state.storage, record, [event(1)]);
    await expect(commitRecord(state.storage, record, [])).rejects.toThrow("history");
    await state.storage.delete("record:v2:events:000000000000:000000");
    await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid");
  });
});

it("rolls back partial writes and can retry without a stale cache", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    await commitRecord(state.storage, record, []);
    const before = await state.storage.list();
    const transaction = state.storage.transaction.bind(state.storage);
    const spy = vi.spyOn(state.storage, "transaction").mockImplementationOnce(callback => transaction(async tx => {
      const put = tx.put.bind(tx);
      let calls = 0;
      return callback(new Proxy(tx, { get(target, property) {
        if (property === "put") return async (key: string, value: unknown) => {
          await put(key, value);
          if (++calls === 2) throw new Error("Injected partial write");
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }));
    }));
    record.checkpoint.eventSeq = 1;
    await expect(commitRecord(state.storage, record, [event(1)])).rejects.toThrow("Injected partial write");
    spy.mockRestore();
    expect(await state.storage.list()).toEqual(before);
    await commitRecord(state.storage, record, [event(1)]);
    expect((await loadRecord(state.storage))?.events).toEqual([event(1)]);
  });
});

it("does not rewrite command outcomes and deletes removed award collection entries", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    record.outcomes = [{ commandId: "start", accepted: true, reason: "" }];
    record.awardData = createAwardData({ atMs: 0, eventSeq: 0, phase: "lobby", remainingMs: record.checkpoint.remainingMs,
      dwellMs: record.checkpoint.parameters!.dwellMs, players: [] }, "complete");
    await commitRecord(state.storage, record, []);
    await expect(commitRecord(state.storage, { ...record, outcomes: [] }, [])).rejects.toThrow("history");
    await expect(commitRecord(state.storage, { ...record, outcomes: [{ ...record.outcomes[0], accepted: false }] }, [])).rejects.toThrow("history");
    await commitRecord(state.storage, { ...record, awardData: null }, []);
    expect((await state.storage.list({ prefix: "record:v2:award" })).size).toBe(0);
    expect((await loadRecord(state.storage))?.outcomes).toEqual(record.outcomes);
  });
});

it("propagates read and retirement failures without exposing old sessions or advancing cache", async () => {
  await runInDurableObject(stub(), async (_, state) => {
    const record = fixture();
    await state.storage.put("record", record);
    const transaction = state.storage.transaction.bind(state.storage);
    const spy = vi.spyOn(state.storage, "transaction").mockImplementationOnce(callback => transaction(async tx => {
      return callback(new Proxy(tx, { get(target, property) {
        if (property === "deleteAlarm") return async () => { throw new Error("Retirement failed"); };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }));
    }));
    await expect(loadRecord(state.storage)).rejects.toThrow("Retirement failed");
    spy.mockRestore();
    expect(await state.storage.get("record")).toEqual(record);
    expect(await loadRecord(state.storage)).toBeNull();
    await state.storage.deleteAll();
    await commitRecord(state.storage, record, []);
    const readSpy = vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("Read failed"));
    await expect(loadRecord(state.storage)).rejects.toThrow("Read failed");
    readSpy.mockRestore();
    expect(await loadRecord(state.storage)).toEqual(record);
  });
});
