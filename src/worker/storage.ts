import { z } from "zod";
import { checkpointSchema, eventSchema, outcomeSchema } from "../shared/protocol";
import type { EngineEvent } from "../shared/protocol";

const sessionSchema = z.strictObject({
  id: z.string().min(1), host: z.boolean(), playerId: z.string().nullable(),
  verifier: z.string().regex(/^[0-9a-f]{64}$/),
});
export const recordSchema = z.strictObject({
  matchCode: z.string().regex(/^[A-Z2-9]{8}$/),
  createdAtMs: z.number().int().nonnegative(), expiresAtMs: z.number().int().nonnegative(),
  checkpoint: checkpointSchema,
  sessions: z.array(sessionSchema).max(101),
  events: z.array(eventSchema),
  outcomes: z.array(outcomeSchema).max(10000),
  feedback: z.array(z.strictObject({
    eventSeq: z.number().int().nonnegative(), atMs: z.number().int().nonnegative(),
    recipients: z.array(z.strictObject({ playerId: z.string().min(1), seenAfterMs: z.number().nonnegative().nullable() })).length(2),
  })).default([]),
}).refine(r => r.expiresAtMs === r.createdAtMs + 86400000 &&
  r.checkpoint.id === r.matchCode && r.checkpoint.createdAtMs === r.createdAtMs &&
  r.events.every(e => e.eventSeq <= r.checkpoint.eventSeq), { message: "Inconsistent match record." });
export type MatchRecord = z.infer<typeof recordSchema>;
export async function loadRecord(storage: DurableObjectStorage): Promise<MatchRecord | null> {
  const raw = await storage.get<unknown>("record");
  if (raw === undefined) return null;
  const result = recordSchema.safeParse(raw);
  if (!result.success) throw new Error("Stored match record is invalid.");
  return result.data;
}
export async function commitRecord(storage: DurableObjectStorage, record: MatchRecord, events: EngineEvent[]): Promise<void> {
  const validated = recordSchema.parse({ ...record, events: [...record.events, ...events] });
  await storage.transaction(async transaction => {
    await transaction.put("record", validated);
  });
}
