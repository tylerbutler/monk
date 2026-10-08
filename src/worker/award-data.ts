import { z } from "zod";
import { factionSchema, phaseSchema } from "../shared/protocol";

const id = z.string().min(1).max(128);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const label = z.string().max(80);
const uniqueIds = z.array(id).refine(ids => new Set(ids).size === ids.length, "Duplicate player IDs.");
export const awardFrameSchema = z.strictObject({
  atMs: count, eventSeq: count, phase: phaseSchema, remainingMs: count,
  dwellMs: count.positive().nullable(),
  players: z.array(z.strictObject({
    id, label, faction: factionSchema, graceMs: count, usableUntilMs: count.nullable(),
  })).max(100),
}).refine(f => new Set(f.players.map(p => p.id)).size === f.players.length, "Duplicate roster IDs.");
export type AwardFrame = z.infer<typeof awardFrameSchema>;

const playerAwardDataSchema = z.strictObject({
  label, conversionsMade: count, conversionsReceived: count,
  conversionsByFaction: z.strictObject({ rock: count, paper: count, scissors: count }),
  conversionPeerIds: uniqueIds, influencePeerIds: uniqueIds,
  currentConversionStreak: count, longestConversionStreak: count,
  incomingEncounters: count, outgoingEncounters: count,
  rangeBreaksReceived: count, closeCallsReceived: count, underdogConversions: count,
  eligibleMs: count, currentUnconvertedEligibleMs: count, longestUnconvertedEligibleMs: count,
  pendingComebackEligibleMs: count.nullable(), fastestComebackEligibleMs: count.nullable(),
});
export type PlayerAwardData = z.infer<typeof playerAwardDataSchema>;

export const awardDataSchema = z.strictObject({
  version: z.literal(1), coverage: z.enum(["complete", "partial"]),
  startedAfterEventSeq: count, lastProcessedEventSeq: count,
  lastFrame: awardFrameSchema, players: z.record(id, playerAwardDataSchema),
  openEncounters: z.record(id, z.strictObject({
    startedEventSeq: count, targetId: id, startedAtMs: count, dwellMs: count.positive(),
  })),
  lastConversionBatch: z.strictObject({
    lastEventSeq: count, atMs: count, attackerIds: uniqueIds.nonempty(),
  }).nullable(),
}).refine(data => {
  const known = (key: string) => Object.hasOwn(data.players, key);
  const roster = new Set(data.lastFrame.players.map(p => p.id));
  return data.startedAfterEventSeq <= data.lastProcessedEventSeq &&
    data.lastProcessedEventSeq <= data.lastFrame.eventSeq &&
    data.lastFrame.players.every(p => known(p.id)) &&
    Object.entries(data.players).every(([key, p]) =>
      p.conversionPeerIds.every(peer => peer !== key && known(peer)) &&
      p.influencePeerIds.every(peer => peer !== key && known(peer)) &&
      p.currentConversionStreak <= p.longestConversionStreak &&
      p.currentUnconvertedEligibleMs <= p.longestUnconvertedEligibleMs &&
      p.closeCallsReceived <= p.rangeBreaksReceived) &&
    Object.entries(data.openEncounters).every(([attacker, e]) =>
      roster.has(attacker) && roster.has(e.targetId) && attacker !== e.targetId &&
      e.startedEventSeq > data.startedAfterEventSeq && e.startedEventSeq <= data.lastProcessedEventSeq &&
      e.startedAtMs <= data.lastFrame.atMs) &&
    (data.lastConversionBatch === null ||
      data.lastConversionBatch.lastEventSeq > data.startedAfterEventSeq &&
      data.lastConversionBatch.lastEventSeq <= data.lastProcessedEventSeq &&
      data.lastConversionBatch.atMs <= data.lastFrame.atMs &&
      data.lastConversionBatch.attackerIds.every(known));
}, "Inconsistent award data.");
export type AwardData = z.infer<typeof awardDataSchema>;
