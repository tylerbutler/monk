import { z } from "zod";
import { checkpointSchema, eventSchema, gamePreset, locationInactivityMs, outcomeSchema } from "../shared/protocol";
import type { EngineEvent } from "../shared/protocol";
import { awardDataSchema } from "./award-data";

const sessionSchema = z.strictObject({
  id: z.string().min(1), host: z.boolean(), playerId: z.string().nullable(),
  verifier: z.string().regex(/^[0-9a-f]{64}$/),
});
const storedCheckpointSchema = checkpointSchema.extend({
  playArea: z.string().max(1000).optional(),
}).transform(({ playArea: _removed, ...checkpoint }) => checkpoint);
export const recordSchema = z.strictObject({
  matchCode: z.string().regex(/^[A-Z2-9]{8}$/),
  createdAtMs: z.number().int().nonnegative(), expiresAtMs: z.number().int().nonnegative(),
  checkpoint: storedCheckpointSchema,
  awardData: awardDataSchema.nullable().default(null),
  sessions: z.array(sessionSchema).max(101),
  events: z.array(eventSchema),
  // Reserve one outcome beyond the command budget so the host can always end.
  outcomes: z.array(outcomeSchema).max(10001),
  feedback: z.array(z.strictObject({
    eventSeq: z.number().int().nonnegative(), atMs: z.number().int().nonnegative(),
    recipients: z.array(z.strictObject({ playerId: z.string().min(1), seenAfterMs: z.number().nonnegative().nullable() })).length(2),
  })).default([]),
}).refine(r => r.expiresAtMs === r.createdAtMs + 86400000 &&
  r.checkpoint.id === r.matchCode && r.checkpoint.createdAtMs === r.createdAtMs &&
  r.events.every(e => e.eventSeq <= r.checkpoint.eventSeq) &&
  (r.awardData === null ||
    r.awardData.lastProcessedEventSeq <= r.checkpoint.eventSeq &&
    r.awardData.lastFrame.eventSeq <= r.checkpoint.eventSeq &&
    r.awardData.lastFrame.phase === r.checkpoint.phase &&
    r.awardData.lastFrame.remainingMs === r.checkpoint.remainingMs &&
    r.awardData.lastFrame.dwellMs === (r.checkpoint.parameters?.dwellMs ?? null) &&
    r.awardData.lastFrame.players.length === r.checkpoint.players.length &&
    r.awardData.lastFrame.players.every(p => r.checkpoint.players.some(saved =>
      saved.id === p.id && saved.label === p.label && saved.faction === p.faction && saved.graceMs === p.graceMs))),
  { message: "Inconsistent match record." });
export type MatchRecord = z.infer<typeof recordSchema>;

const prefix = "record:v2:";
const collections = ["checkpoint", "sessions", "events", "outcomes", "feedback", "award", "awardPlayers", "awardEncounters"] as const;
type Collection = typeof collections[number];
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const manifestSchema = z.strictObject({
  version: z.literal(2), revision: countSchema,
  matchCode: z.string().regex(/^[A-Z2-9]{8}$/),
  createdAtMs: countSchema, expiresAtMs: countSchema,
  counts: z.record(z.enum(collections), countSchema),
});
type Manifest = z.infer<typeof manifestSchema>;
type Stored = { manifest: Manifest; values: Map<string, string | number> };
const cache = new WeakMap<DurableObjectStorage, Stored>();
const invalid = () => new Error("Stored match record is invalid.");
const itemKey = (collection: Collection, index: number) => `${prefix}${collection}:${String(index).padStart(12, "0")}`;
const partKey = (key: string, part: number) => `${key}:${String(part).padStart(6, "0")}`;

function encode(record: MatchRecord): Stored {
  const { players, openEncounters, ...award } = record.awardData ?? {};
  const items: Record<Collection, unknown[]> = {
    checkpoint: [record.checkpoint], sessions: record.sessions, events: record.events,
    outcomes: record.outcomes, feedback: record.feedback,
    award: record.awardData === null ? [] : [award],
    awardPlayers: Object.entries(players ?? {}), awardEncounters: Object.entries(openEncounters ?? {}),
  };
  const values = new Map<string, string | number>();
  const counts = {} as Manifest["counts"];
  for (const collection of collections) {
    counts[collection] = items[collection].length;
    items[collection].forEach((item, index) => {
      const key = itemKey(collection, index);
      const json = JSON.stringify(item);
      // UTF-16 slices also bound UTF-8 bytes and JSON escaping below the KV value limit.
      const size = 16000;
      const parts = Math.ceil(json.length / size);
      values.set(key, parts);
      for (let part = 0; part < parts; part++) values.set(partKey(key, part), json.slice(part * size, (part + 1) * size));
    });
  }
  return { manifest: { version: 2, revision: 0, matchCode: record.matchCode,
    createdAtMs: record.createdAtMs, expiresAtMs: record.expiresAtMs, counts }, values };
}

function decode(stored: Stored): MatchRecord {
  const { manifest, values } = stored;
  const items = {} as Record<Collection, unknown[]>;
  let used = 0;
  for (const collection of collections) {
    const count = manifest.counts[collection];
    if (count > values.size) throw invalid();
    items[collection] = [];
    for (let index = 0; index < count; index++) {
      const key = itemKey(collection, index);
      const parts = values.get(key);
      if (typeof parts !== "number" || !Number.isSafeInteger(parts) || parts < 1 || parts > values.size) throw invalid();
      used++;
      let json = "";
      for (let part = 0; part < parts; part++) {
        const value = values.get(partKey(key, part));
        if (typeof value !== "string") throw invalid();
        json += value; used++;
      }
      try { items[collection].push(JSON.parse(json)); } catch { throw invalid(); }
    }
  }
  if (used !== values.size || items.checkpoint.length !== 1 || items.award.length > 1 ||
    items.award.length === 0 && (items.awardPlayers.length > 0 || items.awardEncounters.length > 0)) throw invalid();
  const dictionary = (entries: unknown[]): Record<string, unknown> => {
    if (!entries.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string")) throw invalid();
    const pairs = entries as [string, unknown][];
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length) throw invalid();
    return Object.fromEntries(pairs);
  };
  const award = items.award[0];
  if (award !== undefined && (typeof award !== "object" || award === null || Array.isArray(award))) throw invalid();
  if (award !== undefined && (Object.hasOwn(award, "players") || Object.hasOwn(award, "openEncounters"))) throw invalid();
  const result = recordSchema.safeParse({
    matchCode: manifest.matchCode, createdAtMs: manifest.createdAtMs, expiresAtMs: manifest.expiresAtMs,
    checkpoint: items.checkpoint[0], sessions: items.sessions, events: items.events,
    outcomes: items.outcomes, feedback: items.feedback,
    awardData: award === undefined ? null : { ...award,
      players: dictionary(items.awardPlayers), openEncounters: dictionary(items.awardEncounters) },
  });
  if (!result.success) throw invalid();
  return result.data;
}

async function readValues(storage: DurableObjectTransaction): Promise<Map<string, string | number>> {
  const values = new Map<string, string | number>();
  let startAfter: string | undefined;
  for (;;) {
    const page = await storage.list<string | number>({ prefix, limit: 1000, ...(startAfter === undefined ? {} : { startAfter }) });
    for (const [key, value] of page) values.set(key, value);
    if (page.size < 1000) return values;
    startAfter = [...page.keys()].at(-1)!;
  }
}

async function readStored(transaction: DurableObjectTransaction, raw: unknown): Promise<Stored | null> {
  if (raw === undefined) {
    if ((await transaction.list({ prefix, limit: 1 })).size) throw invalid();
    return null;
  }
  const result = manifestSchema.safeParse(raw);
  if (!result.success) throw invalid();
  const stored = { manifest: result.data, values: await readValues(transaction) };
  decode(stored);
  return stored;
}

export async function loadRecord(storage: DurableObjectStorage): Promise<MatchRecord | null> {
  const stored = await storage.transaction(async transaction => {
    const raw = await transaction.get("record");
    // Old-format rooms are unavailable after deployment. Drop their data and
    // alarm on first wake, just as for an expired room; keep no reservation.
    // Malformed records remain errors.
    if (raw !== undefined && recordSchema.safeParse(raw).success) {
      if ((await transaction.list({ prefix, limit: 1 })).size) throw invalid();
      await transaction.delete("record");
      await transaction.deleteAlarm();
      return null;
    }
    return readStored(transaction, raw);
  });
  if (stored === null) { cache.delete(storage); return null; }
  cache.set(storage, stored);
  const record = decode(stored);
  return { ...record, checkpoint: { ...record.checkpoint, mode: "test",
    parameters: { ...(record.checkpoint.parameters ?? gamePreset), freshnessMs: locationInactivityMs } } };
}
export async function commitRecord(
  storage: DurableObjectStorage, record: MatchRecord, events: EngineEvent[], initialAlarmMs?: number,
): Promise<void> {
  const validated = recordSchema.parse({ ...record, events: [...record.events, ...events] });
  if (initialAlarmMs !== undefined) countSchema.parse(initialAlarmMs);
  const next = encode(validated);
  await storage.transaction(async transaction => {
    const raw = await transaction.get("record");
    const saved = cache.get(storage);
    const previous = saved !== undefined && JSON.stringify(raw) === JSON.stringify(saved.manifest)
      ? saved : await readStored(transaction, raw);
    if (previous !== null) {
      if (previous.manifest.matchCode !== validated.matchCode || previous.manifest.createdAtMs !== validated.createdAtMs) throw invalid();
      for (const collection of ["events", "outcomes"] as const) {
        if (next.manifest.counts[collection] < previous.manifest.counts[collection]) throw new Error("Cannot truncate stored match history.");
        for (const [key, value] of previous.values) {
          if (key.startsWith(`${prefix}${collection}:`) && next.values.get(key) !== value) throw new Error("Cannot rewrite stored match history.");
        }
      }
    }
    for (const [key, value] of next.values) {
      if (previous?.values.get(key) !== value) await transaction.put(key, value);
    }
    if (previous !== null) {
      for (const key of previous.values.keys()) if (!next.values.has(key)) await transaction.delete(key);
    }
    next.manifest.revision = countSchema.parse((previous?.manifest.revision ?? 0) + 1);
    await transaction.put("record", next.manifest);
    if (initialAlarmMs !== undefined) await transaction.setAlarm(initialAlarmMs);
  });
  // A failed or retried transaction must not advance the committed delta baseline.
  cache.set(storage, next);
}
