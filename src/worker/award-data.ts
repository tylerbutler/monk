import { z } from "zod";
import { eventSchema, factionSchema, phaseSchema } from "../shared/protocol";
import type { EngineEvent, Faction } from "../shared/protocol";

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

function emptyPlayer(label: string): PlayerAwardData {
  return {
    label, conversionsMade: 0, conversionsReceived: 0,
    conversionsByFaction: { rock: 0, paper: 0, scissors: 0 },
    conversionPeerIds: [], influencePeerIds: [],
    currentConversionStreak: 0, longestConversionStreak: 0,
    incomingEncounters: 0, outgoingEncounters: 0, rangeBreaksReceived: 0, closeCallsReceived: 0,
    underdogConversions: 0, eligibleMs: 0, currentUnconvertedEligibleMs: 0, longestUnconvertedEligibleMs: 0,
    pendingComebackEligibleMs: null, fastestComebackEligibleMs: null,
  };
}

export function createAwardData(frame: AwardFrame, coverage: AwardData["coverage"]): AwardData {
  return awardDataSchema.parse({
    version: 1, coverage, startedAfterEventSeq: frame.eventSeq, lastProcessedEventSeq: frame.eventSeq,
    lastFrame: frame, players: Object.fromEntries(frame.players.map(p => [p.id, emptyPlayer(p.label)])),
    openEncounters: {}, lastConversionBatch: null,
  });
}

function resetTiming(player: PlayerAwardData, cancelComeback: boolean): void {
  player.currentUnconvertedEligibleMs = 0;
  if (cancelComeback) player.pendingComebackEligibleMs = null;
}

function addPeer(peers: string[], id: string): void {
  if (!peers.includes(id)) { peers.push(id); peers.sort(); }
}

export function advanceAwardData(
  data: AwardData, frame: AwardFrame, events: readonly EngineEvent[], eligibilityResetIds: readonly string[] = [],
): AwardData {
  const next = awardDataSchema.parse(data);
  const current = awardFrameSchema.parse(frame);
  const previous = next.lastFrame;
  if (current.atMs < previous.atMs || current.eventSeq < previous.eventSeq) {
    throw new Error("Award frame moved backwards.");
  }
  const accepted = events.map(e => eventSchema.parse(e)).filter(e => e.eventSeq > data.lastProcessedEventSeq);
  let sequence = data.lastProcessedEventSeq;
  for (const e of accepted) {
    if (e.eventSeq <= sequence || e.eventSeq > current.eventSeq || e.atMs !== current.atMs) {
      throw new Error("Award event is outside its frame or out of order.");
    }
    sequence = e.eventSeq;
  }
  const roster = new Map(current.players.map(p => [p.id, p]));
  for (const p of current.players) {
    if (!Object.hasOwn(next.players, p.id)) next.players[p.id] = emptyPlayer(p.label);
    next.players[p.id].label = p.label;
  }
  const player = (id: string | null): PlayerAwardData => {
    if (id === null || !Object.hasOwn(next.players, id)) throw new Error("Award event has an unknown participant.");
    return next.players[id];
  };
  const resetIds = new Set(eligibilityResetIds.map(value => id.parse(value)));
  for (const p of previous.players) {
    const summary = player(p.id);
    if (previous.phase === "running") {
      if (p.graceMs > 0) resetTiming(summary, false);
      const until = Math.min(current.atMs - previous.atMs, previous.remainingMs,
        p.usableUntilMs === null ? 0 : p.usableUntilMs - previous.atMs);
      const eligible = Math.max(0, until - p.graceMs);
      summary.eligibleMs += eligible;
      summary.currentUnconvertedEligibleMs += eligible;
      summary.longestUnconvertedEligibleMs = Math.max(summary.longestUnconvertedEligibleMs, summary.currentUnconvertedEligibleMs);
      if (summary.pendingComebackEligibleMs !== null) summary.pendingComebackEligibleMs += eligible;
      if (p.usableUntilMs === null || p.usableUntilMs <= current.atMs) resetTiming(summary, true);
    }
  }
  for (const [key, summary] of Object.entries(next.players)) {
    const p = roster.get(key);
    if (!p || resetIds.has(key) || current.phase === "running" && (p.usableUntilMs === null || p.usableUntilMs <= current.atMs)) {
      resetTiming(summary, true);
    } else if (current.phase !== "running" || p.graceMs > 0) {
      resetTiming(summary, false);
    }
  }

  const conversions = accepted.filter(e => e.type === "conversion");
  const incoming = new Set<string>();
  const populations: Record<Faction, number> = { rock: 0, paper: 0, scissors: 0 };
  const beforeBatch = new Map(current.players.map(p => [p.id, p.faction]));
  for (const e of conversions) {
    player(e.attackerId); player(e.targetId);
    if (!e.attackerId || !e.targetId || e.attackerId === e.targetId || !e.faction || !e.oldFaction ||
      !roster.has(e.attackerId) || !roster.has(e.targetId) || incoming.has(e.targetId)) {
      throw new Error("Award conversion has invalid participants or faction.");
    }
    incoming.add(e.targetId);
    beforeBatch.set(e.targetId, e.oldFaction);
  }
  for (const faction of beforeBatch.values()) populations[faction]++;
  const present = factionSchema.options.filter(f => populations[f] > 0);
  const underdog = present.find(f => present.length > 1 && present.every(other => other === f || populations[f] < populations[other]));

  for (const e of accepted) {
    if (e.type === "manual_faction_change") {
      const summary = player(e.targetId);
      summary.currentConversionStreak = 0;
      resetTiming(summary, true);
    } else if (e.type === "attack_started") {
      const attacker = player(e.attackerId), target = player(e.targetId);
      if (!e.attackerId || !e.targetId || e.attackerId === e.targetId || current.dwellMs === null ||
        !roster.has(e.attackerId) || !roster.has(e.targetId) || Object.hasOwn(next.openEncounters, e.attackerId)) {
        throw new Error("Award encounter has invalid participants or dwell.");
      }
      attacker.outgoingEncounters++; target.incomingEncounters++;
      addPeer(attacker.influencePeerIds, e.targetId); addPeer(target.influencePeerIds, e.attackerId);
      next.openEncounters[e.attackerId] = {
        startedEventSeq: e.eventSeq, targetId: e.targetId, startedAtMs: e.atMs, dwellMs: current.dwellMs,
      };
    } else if (e.type === "attack_interrupted" || e.type === "conversion") {
      player(e.attackerId); player(e.targetId);
      const encounter = e.attackerId && Object.hasOwn(next.openEncounters, e.attackerId) ? next.openEncounters[e.attackerId] : undefined;
      if (encounter && encounter.targetId !== e.targetId) throw new Error("Award encounter target does not match.");
      if (encounter && e.type === "attack_interrupted" && e.reason === "Outside confirmed range." && !incoming.has(encounter.targetId)) {
        const target = player(encounter.targetId);
        target.rangeBreaksReceived++;
        if (BigInt(e.atMs - encounter.startedAtMs) * 10n >= BigInt(encounter.dwellMs) * 9n) target.closeCallsReceived++;
      }
      if (e.attackerId) delete next.openEncounters[e.attackerId];
    }
  }
  const attackers = new Set<string>();
  for (const e of conversions) {
    const attacker = player(e.attackerId), target = player(e.targetId);
    // These fields were checked for the whole batch before any credit.
    if (!e.attackerId || !e.targetId || !e.faction) throw new Error("Award conversion is incomplete.");
    attackers.add(e.attackerId);
    attacker.conversionsMade++; target.conversionsReceived++;
    attacker.conversionsByFaction[e.faction]++;
    addPeer(attacker.conversionPeerIds, e.targetId); addPeer(target.conversionPeerIds, e.attackerId);
    attacker.currentConversionStreak++;
    attacker.longestConversionStreak = Math.max(attacker.longestConversionStreak, attacker.currentConversionStreak);
    if (e.faction === underdog) attacker.underdogConversions++;
  }
  for (const key of attackers) {
    const summary = player(key);
    if (!incoming.has(key) && summary.pendingComebackEligibleMs !== null) {
      summary.fastestComebackEligibleMs = Math.min(summary.fastestComebackEligibleMs ?? summary.pendingComebackEligibleMs,
        summary.pendingComebackEligibleMs);
      summary.pendingComebackEligibleMs = null;
    }
  }
  for (const key of incoming) {
    const summary = player(key);
    summary.currentConversionStreak = 0;
    resetTiming(summary, false);
    summary.pendingComebackEligibleMs = resetIds.has(key) ? null : 0;
  }
  if (conversions.length) {
    next.lastConversionBatch = {
      lastEventSeq: conversions[conversions.length - 1].eventSeq, atMs: current.atMs, attackerIds: [...attackers].sort(),
    };
  }
  for (const [key, encounter] of Object.entries(next.openEncounters)) {
    if (current.phase !== "running" || !roster.has(key) || !roster.has(encounter.targetId)) delete next.openEncounters[key];
  }
  next.lastFrame = current;
  next.lastProcessedEventSeq = current.eventSeq;
  return awardDataSchema.parse(next);
}

export function recoverAwardData(data: AwardData, restored: AwardFrame): AwardData {
  const next = awardDataSchema.parse(data);
  const frame = awardFrameSchema.parse(restored);
  if (frame.atMs < next.lastFrame.atMs || frame.eventSeq !== next.lastFrame.eventSeq) {
    throw new Error("Restored award frame does not match its checkpoint.");
  }
  for (const summary of Object.values(next.players)) resetTiming(summary, true);
  next.openEncounters = {};
  next.lastFrame = frame;
  return awardDataSchema.parse(next);
}
