import { expect, it } from "vitest";
import { advanceAwardData, awardDataSchema, createAwardData, recoverAwardData } from "./award-data";
import type { AwardData, AwardFrame } from "./award-data";
import { awardFrameFor } from "./engine";
import type { EngineState, EngineTransition } from "./engine";
import { command, pulse, runningFixture } from "../../test/fixtures";
import type { EngineEvent, Faction } from "../shared/protocol";

function frame(atMs = 0, eventSeq = 0, changes: Partial<AwardFrame> = {}): AwardFrame {
  return { atMs, eventSeq, phase: "running", remainingMs: 600000 - atMs, dwellMs: 30000,
    players: [
      { id: "p1", label: "Same name", faction: "rock", graceMs: 0, usableUntilMs: 60000 },
      { id: "p2", label: "Same name", faction: "scissors", graceMs: 0, usableUntilMs: 60000 },
    ], ...changes };
}
function event(type: EngineEvent["type"], eventSeq: number, atMs: number, changes: Partial<EngineEvent> = {}): EngineEvent {
  return { type, eventSeq, atMs, attackerId: "p1", targetId: "p2", faction: "rock",
    oldFaction: "scissors", reason: null, hostId: null, ...changes };
}
function collect(data: AwardData, state: EngineState, next: EngineTransition): AwardData {
  const old = awardFrameFor(state);
  return advanceAwardData(data, awardFrameFor(next.state), next.events.map(e =>
    e.type === "conversion" ? { ...e, oldFaction: old.players.find(p => p.id === e.targetId)!.faction } : e));
}

it("counts conversions and unique counterparts", () => {
  let state = runningFixture(["rock", "scissors"]);
  let data = createAwardData(awardFrameFor(state), "complete");
  for (const start of [0, 6000, 12000]) {
    if (start) {
      const changed = command(state, start - 2000, { type: "set_faction", playerId: "p2", faction: "scissors" });
      data = collect(data, state, changed); state = changed.state;
    }
    for (let at = start; at <= start + 3000; at += 1000) {
      const next = pulse(state, at, [0, 4]);
      data = collect(data, state, next); state = next.state;
      expect(advanceAwardData(data, awardFrameFor(state), next.events)).toEqual(data);
    }
  }
  expect(data.players.p1).toMatchObject({ conversionsMade: 3, conversionsReceived: 0,
    conversionsByFaction: { rock: 3, paper: 0, scissors: 0 }, conversionPeerIds: ["p2"],
    currentConversionStreak: 3, longestConversionStreak: 3 });
  expect(data.players.p2).toMatchObject({ conversionsReceived: 3, conversionPeerIds: ["p1"] });
});

it("records faction breadth without transferring achievements", () => {
  let state = runningFixture(["rock", "scissors"]);
  let data = createAwardData(awardFrameFor(state), "complete");
  const pairs: [Faction, Faction][] = [["rock", "scissors"], ["paper", "rock"], ["scissors", "paper"]];
  pairs.forEach(([attacker, target], index) => {
    const start = index * 6000;
    if (index) {
      const changed = command(state, start - 2000,
        { type: "set_faction", playerId: "p1", faction: attacker },
        { type: "set_faction", playerId: "p2", faction: target });
      data = collect(data, state, changed); state = changed.state;
    }
    for (let at = start; at <= start + 3000; at += 1000) {
      const next = pulse(state, at, [0, 4]); data = collect(data, state, next); state = next.state;
    }
  });
  expect(data.players.p1).toMatchObject({ conversionsMade: 3, longestConversionStreak: 1,
    conversionsByFaction: { rock: 1, paper: 1, scissors: 1 } });
});

it("resolves simultaneous credit before incoming streak resets", () => {
  let state = runningFixture(["rock", "scissors", "paper"]);
  let data = createAwardData(awardFrameFor(state), "complete");
  for (const at of [0, 1000, 2000, 3000]) {
    const next = pulse(state, at, [0, 0, 0]); data = collect(data, state, next); state = next.state;
  }
  for (const [id, faction] of [["p1", "rock"], ["p2", "scissors"], ["p3", "paper"]] as const) {
    expect(data.players[id]).toMatchObject({ conversionsMade: 1, conversionsReceived: 1,
      currentConversionStreak: 0, longestConversionStreak: 1, fastestComebackEligibleMs: null,
      pendingComebackEligibleMs: 0 });
    expect(data.players[id].conversionsByFaction[faction]).toBe(1);
  }
  expect(data.lastConversionBatch).toMatchObject({ atMs: 3000, attackerIds: ["p1", "p2", "p3"] });
});

it("keeps host changes and departures out of conversion totals", () => {
  let data = createAwardData(frame(), "complete");
  data = advanceAwardData(data, frame(1, 1), [event("conversion", 1, 1)]);
  const changed = frame(2, 2);
  changed.players[0].faction = "paper";
  data = advanceAwardData(data, changed, [event("manual_faction_change", 2, 2, { targetId: "p1", attackerId: null, faction: "paper" })]);
  expect(data.players.p1).toMatchObject({ conversionsMade: 1, currentConversionStreak: 0 });
  expect(data.players.p1.pendingComebackEligibleMs).toBeNull();
  data = advanceAwardData(data, frame(3, 2, { players: [changed.players[1]] }), []);
  expect(data.players.p1).toMatchObject({ label: "Same name", conversionsMade: 1, conversionPeerIds: ["p2"] });
  expect(Object.keys(data.players)).toEqual(["p1", "p2"]);
});

it("tracks unique influence peers and range outcomes", () => {
  let data = createAwardData(frame(), "complete");
  data = advanceAwardData(data, frame(0, 1), [event("attack_started", 1, 0)]);
  data = advanceAwardData(data, frame(26999, 2), [event("attack_interrupted", 2, 26999, { reason: "Outside confirmed range." })]);
  expect(data.players.p2).toMatchObject({ rangeBreaksReceived: 1, closeCallsReceived: 0 });
  data = advanceAwardData(data, frame(27000, 3), [event("attack_started", 3, 27000)]);
  data = advanceAwardData(data, frame(54000, 4), [event("attack_interrupted", 4, 54000, { reason: "Outside confirmed range." })]);
  expect(data.players.p1).toMatchObject({ outgoingEncounters: 2, influencePeerIds: ["p2"] });
  expect(data.players.p2).toMatchObject({ incomingEncounters: 2, influencePeerIds: ["p1"], rangeBreaksReceived: 2, closeCallsReceived: 1 });
  expect(data.openEncounters).toEqual({});
});

it("does not award an escape to a converted target", () => {
  const initial = frame();
  initial.players.push({ ...initial.players[0], id: "p3" });
  let data = createAwardData(initial, "complete");
  data = advanceAwardData(data, { ...initial, eventSeq: 2 }, [
    event("attack_started", 1, 0), event("attack_started", 2, 0, { attackerId: "p3" }),
  ]);
  data = advanceAwardData(data, { ...initial, atMs: 27000, eventSeq: 4 }, [
    event("attack_interrupted", 3, 27000, { reason: "Outside confirmed range." }),
    event("conversion", 4, 27000, { attackerId: "p3" }),
  ]);
  expect(data.players.p2).toMatchObject({ conversionsReceived: 1, rangeBreaksReceived: 0, closeCallsReceived: 0 });
});

it.each(["Location is stale or unavailable.", "Faction changed.", "Host changed faction.",
  "Grace period.", "Player left.", "Host paused the round.", "Round time elapsed.", "Unknown reason."])(
  "closes encounters without escape credit for %s", reason => {
    let data = createAwardData(frame(), "complete");
    data = advanceAwardData(data, frame(0, 1), [event("attack_started", 1, 0)]);
    data = advanceAwardData(data, frame(27000, 2), [event("attack_interrupted", 2, 27000, { reason })]);
    expect(data.openEncounters).toEqual({});
    expect(data.players.p2).toMatchObject({ rangeBreaksReceived: 0, closeCallsReceived: 0 });
  });

it("credits only the previous usable interval", () => {
  const first = frame();
  first.players[0].usableUntilMs = 30000;
  const original = createAwardData(first, "complete");
  const data = advanceAwardData(original, frame(31000), []);
  expect(data.players.p1).toMatchObject({ eligibleMs: 30000, longestUnconvertedEligibleMs: 30000,
    currentUnconvertedEligibleMs: 0 });
  expect(advanceAwardData(data, frame(31000), [])).toEqual(data);
  expect(original.players.p1.eligibleMs).toBe(0);
  expect(advanceAwardData(data, frame(32000), []).players.p1.eligibleMs).toBe(31000);
});

it("intersects grace and round deadlines", () => {
  const first = frame(0, 0, { remainingMs: 10000 });
  first.players[0].graceMs = 3000; first.players[0].usableUntilMs = 30000;
  const ended = frame(11000, 0, { remainingMs: 0, phase: "ended" });
  const data = advanceAwardData(createAwardData(first, "complete"), ended, []);
  expect(data.players.p1).toMatchObject({ eligibleMs: 7000, longestUnconvertedEligibleMs: 7000,
    currentUnconvertedEligibleMs: 0 });
  expect(advanceAwardData(data, { ...ended, atMs: 12000 }, []).players.p1.eligibleMs).toBe(7000);
});

function pendingComeback(): AwardData {
  const first = frame(0, 1);
  first.players[1].graceMs = 3000;
  return advanceAwardData(createAwardData(frame(), "complete"), first, [event("conversion", 1, 0)]);
}

it("times a comeback with eligibility and pause boundaries", () => {
  let data = pendingComeback();
  data = advanceAwardData(data, frame(5000, 1, { phase: "paused", players: frame().players.map(p => ({ ...p, usableUntilMs: null })) }), []);
  expect(data.players.p2.pendingComebackEligibleMs).toBe(2000);
  data = advanceAwardData(data, frame(15000, 1), []);
  const result = advanceAwardData(data, frame(19000, 2), [
    event("conversion", 2, 19000, { attackerId: "p2", targetId: "p1", faction: "scissors", oldFaction: "rock" }),
  ]);
  expect(result.players.p2.fastestComebackEligibleMs).toBe(6000);
  expect(result.players.p2.pendingComebackEligibleMs).toBeNull();
  const gap = frame(16000, 1); gap.players[1].usableUntilMs = null;
  data = advanceAwardData(data, gap, []);
  expect(advanceAwardData(data, frame(19000, 2), [
    event("conversion", 2, 19000, { attackerId: "p2", targetId: "p1", faction: "scissors", oldFaction: "rock" }),
  ]).players.p2.fastestComebackEligibleMs).toBeNull();
});

it("cancels paused timing through explicit reset input", () => {
  const paused = frame(1000, 1, { phase: "paused", players: frame().players.map(p => ({ ...p, usableUntilMs: null })) });
  const data = advanceAwardData(pendingComeback(), paused, []);
  expect(data.players.p2.pendingComebackEligibleMs).toBe(0);
  const reset = advanceAwardData(data, paused, [], ["p2"]);
  expect(reset.players.p2.pendingComebackEligibleMs).toBeNull();
  expect(data.players.p2.pendingComebackEligibleMs).toBe(0);
});

it.each(["pause", "location"] as const)("closes unbroken intervals at %s eligibility loss", kind => {
  let data = createAwardData(frame(), "complete");
  const lost = frame(5000);
  if (kind === "pause") lost.phase = "paused";
  lost.players[0].usableUntilMs = null;
  data = advanceAwardData(data, lost, []);
  data = advanceAwardData(data, frame(15000), []);
  data = advanceAwardData(data, frame(19000), []);
  expect(data.players.p1).toMatchObject({ eligibleMs: 9000, longestUnconvertedEligibleMs: 5000, currentUnconvertedEligibleMs: 4000 });
});

it.each([
  [["rock", "paper", "paper", "paper", "scissors", "scissors"], 1],
  [["rock", "rock", "paper", "paper", "scissors", "scissors", "scissors"], 0],
  [["rock", "scissors", "scissors"], 1],
] as [Faction[], number][])("counts underdog success from one resolution roster: %s", (factions, wanted) => {
  let state = runningFixture(factions);
  let data = createAwardData(awardFrameFor(state), "complete");
  for (const at of [0, 1000, 2000, 3000]) {
    const next = pulse(state, at, factions.map(() => 0));
    data = collect(data, state, next); state = next.state;
  }
  expect(data.players.p1.conversionsMade).toBe(1);
  expect(data.players.p1.underdogConversions).toBe(wanted);
});

it("uses post-command populations and does not depend on batch order", () => {
  const before = frame();
  before.players.push({ ...before.players[0], id: "p3", faction: "paper" },
    { ...before.players[0], id: "p4", faction: "paper" });
  const after = { ...before, eventSeq: 3, players: before.players.filter(p => p.id !== "p4").map(p =>
    ({ ...p, faction: p.id === "p2" ? "rock" as const : p.id === "p1" ? "paper" as const : p.faction })) };
  const conversions = [
    event("conversion", 1, 0), event("conversion", 2, 0, { attackerId: "p3", targetId: "p1", faction: "paper", oldFaction: "rock" }),
  ];
  const data = advanceAwardData(createAwardData(before, "complete"), after, conversions);
  const reordered = advanceAwardData(createAwardData(before, "complete"), after,
    [...conversions].reverse().map((e, i) => ({ ...e, eventSeq: i + 1 })));
  expect(data.players).toEqual(reordered.players);
  expect(data.players.p1.underdogConversions).toBe(0);
  expect(data.lastConversionBatch?.attackerIds).toEqual(["p1", "p3"]);
});

it("rejects invalid cursors and unsupported award records", () => {
  const data = createAwardData(frame(), "complete");
  for (const invalid of [
    { ...data, version: 2 }, { ...data, unexpected: true }, { ...data, lastProcessedEventSeq: 1 },
    { ...data, lastFrame: { ...data.lastFrame, atMs: -1 } },
    { ...data, lastFrame: { ...data.lastFrame, remainingMs: .5 } },
    { ...data, players: { ...data.players, p1: { ...data.players.p1, conversionPeerIds: ["p2", "p2"] } } },
    { ...data, openEncounters: { missing: { targetId: "p2", startedAtMs: 0, startedEventSeq: 1, dwellMs: 30000 } } },
  ]) expect(awardDataSchema.safeParse(invalid).success).toBe(false);
  for (const changes of [{ attackerId: null }, { targetId: null }, { faction: null }, { oldFaction: null }, { attackerId: "missing" }]) {
    expect(() => advanceAwardData(data, frame(1, 1), [event("conversion", 1, 1, changes)])).toThrow();
  }
  const advanced = advanceAwardData(data, frame(2, 2), [event("lifecycle", 2, 2)]);
  expect(() => advanceAwardData(advanced, frame(1, 2), [])).toThrow();
  expect(() => advanceAwardData(data, frame(1, 2), [event("lifecycle", 2, 1), event("lifecycle", 1, 1)])).toThrow();
  expect(() => advanceAwardData(data, frame(1, 1), [event("lifecycle", 2, 1)])).toThrow();
});

it("recovers without awarding an outage", () => {
  let data = createAwardData(frame(), "partial");
  data = advanceAwardData(data, frame(1000, 1), [event("conversion", 1, 1000)]);
  data = advanceAwardData(data, frame(2000, 2), [event("attack_started", 2, 2000)]);
  const restored = frame(100000, 2, { phase: "paused", players: frame().players.map(p => ({ ...p, usableUntilMs: null })) });
  const recovered = recoverAwardData(data, restored);
  expect(recovered).toMatchObject({ coverage: "partial", openEncounters: {},
    players: { p1: { conversionsMade: 1, eligibleMs: 2000, longestConversionStreak: 1, currentConversionStreak: 1,
      longestUnconvertedEligibleMs: 2000, currentUnconvertedEligibleMs: 0 },
    p2: { conversionsReceived: 1, pendingComebackEligibleMs: null, rangeBreaksReceived: 0 } } });
  expect(data.openEncounters.p1).toBeDefined();
});
