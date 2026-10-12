import { expect, it } from "vitest";
import { createAwardData } from "./award-data";
import type { AwardData } from "./award-data";
import { selectRoundResults } from "./round-results";
import { roundResultsSchema, snapshotSchema } from "../shared/protocol";
import { snapshotFor } from "./engine";
import { runningFixture } from "../../test/fixtures";

function dataFor(players = [
  { id: "p1", label: "Alex" }, { id: "p2", label: "Sam" }, { id: "p3", label: "Casey" },
], coverage: AwardData["coverage"] = "complete") {
  const data = createAwardData({
    atMs: 0, eventSeq: 0, phase: "ended", remainingMs: 0, dwellMs: 30000,
    players: players.slice(0, 100).map(p => ({ ...p, faction: "rock", graceMs: 0, usableUntilMs: null })),
  }, coverage);
  for (const player of players.slice(100)) {
    data.players[player.id] = { ...structuredClone(data.players[players[0].id]), label: player.label };
  }
  return data;
}

it("shares ranks and retains distinct players with identical names", () => {
  const data = dataFor([{ id: "p2", label: "Alex" }, { id: "p1", label: "Alex" }, { id: "p3", label: "Casey" }]);
  data.players.p1.conversionsMade = 4; data.players.p2.conversionsMade = 4;
  const before = structuredClone(data);
  const result = selectRoundResults(data, []);
  expect(result.players.map(p => p.id)).toEqual(["p1", "p2", "p3"]);
  expect(result.players.map(p => p.rank)).toEqual([1, 1, 3]);
  expect(result.awards).toEqual([{ id: "conversion_champion", winnerIds: ["p1", "p2"], value: 4 }]);
  expect(data).toEqual(before);
});

it("selects all five categories in ceremony order and permits repeat winners", () => {
  const data = dataFor();
  Object.assign(data.players.p1, {
    conversionsMade: 6, conversionsByFaction: { rock: 2, paper: 2, scissors: 2 },
    conversionPeerIds: ["p2", "p3"], longestConversionStreak: 4, fastestComebackEligibleMs: 800,
  });
  data.players.p2.conversionsMade = 3;
  data.players.p2.conversionsByFaction = { rock: 1, paper: 1, scissors: 1 };
  expect(selectRoundResults(data, []).awards).toEqual([
    { id: "hat_trick", winnerIds: ["p1", "p2"], value: null },
    { id: "comeback_kid", winnerIds: ["p1"], value: 800 },
    { id: "social_butterfly", winnerIds: ["p1"], value: 2 },
    { id: "hot_streak", winnerIds: ["p1"], value: 4 },
    { id: "conversion_champion", winnerIds: ["p1"], value: 6 },
  ]);
});

it("shares exact comeback ties including zero without treating null as a result", () => {
  const data = dataFor();
  data.players.p1.fastestComebackEligibleMs = 0; data.players.p2.fastestComebackEligibleMs = 0;
  expect(selectRoundResults(data, []).awards).toEqual([
    { id: "comeback_kid", winnerIds: ["p1", "p2"], value: 0 },
  ]);
});

it("does not turn rounded duration values into a shared trophy", () => {
  const data = dataFor();
  data.players.p1.fastestComebackEligibleMs = 1201; data.players.p2.fastestComebackEligibleMs = 1249;
  expect(selectRoundResults(data, []).awards).toEqual([
    { id: "comeback_kid", winnerIds: ["p1"], value: 1201 },
  ]);
});

it("omits unearned categories and a one-conversion streak", () => {
  const data = dataFor();
  data.players.p1.longestConversionStreak = 1;
  expect(selectRoundResults(data, []).awards).toEqual([]);
  expect(selectRoundResults(data, []).players.map(p => p.rank)).toEqual([1, 1, 1]);
  expect(selectRoundResults(dataFor([]), [])).toEqual({ coverage: "complete", players: [], awards: [] });
});

it("retains more than 100 archived, departed, and zero-score players", () => {
  const data = dataFor(Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, label: "Same name" })));
  data.lastFrame.players = [];
  const result = selectRoundResults(data, []);
  expect(result.players).toHaveLength(120);
  expect(new Set(result.players.map(p => p.id)).size).toBe(120);
  expect(result.players.every(p => p.rank === 1 && p.conversionsMade === 0)).toBe(true);
});

it("unions partial collection with the current roster without inventing totals", () => {
  const data = dataFor([{ id: "p1", label: "Saved name" }], "partial");
  data.players.p1.conversionsMade = 10;
  expect(selectRoundResults(data, [{ id: "p1", label: "Other name" }, { id: "p2", label: "New name" }])).toEqual({
    coverage: "partial", awards: [], players: [
      { id: "p2", label: "New name", rank: null, conversionsMade: null },
      { id: "p1", label: "Saved name", rank: null, conversionsMade: null },
    ],
  });
  expect(selectRoundResults(null, [{ id: "p2", label: "Sam" }])).toEqual({
    coverage: "unavailable", awards: [], players: [{ id: "p2", label: "Sam", rank: null, conversionsMade: null }],
  });
});

it("validates category measures, references, identity, and coverage", () => {
  const valid = { coverage: "complete", players: [{ id: "p1", label: "Alex", rank: 1, conversionsMade: 4 }],
    awards: [{ id: "conversion_champion", winnerIds: ["p1"], value: 4 }] };
  expect(roundResultsSchema.safeParse(valid).success).toBe(true);
  for (const awards of [
    [{ id: "conversion_champion", winnerIds: ["unknown"], value: 4 }],
    [{ id: "conversion_champion", winnerIds: ["p1", "p1"], value: 4 }],
    [{ id: "conversion_champion", winnerIds: [], value: 4 }],
    [valid.awards[0], valid.awards[0]],
    [{ id: "hot_streak", winnerIds: ["p1"], value: 1 }],
    [{ id: "hat_trick", winnerIds: ["p1"], value: 3 }],
    [{ id: "comeback_kid", winnerIds: ["p1"], value: -1 }],
    [{ id: "conversion_champion", winnerIds: ["p1"], value: Number.MAX_SAFE_INTEGER + 1 }],
  ]) expect(roundResultsSchema.safeParse({ ...valid, awards }).success).toBe(false);
  expect(roundResultsSchema.safeParse({ ...valid, players: [...valid.players, ...valid.players] }).success).toBe(false);
  expect(roundResultsSchema.safeParse({ ...valid, coverage: "partial", awards: [] }).success).toBe(false);
});

it("keeps results out of running snapshots", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const roundResults = selectRoundResults(dataFor(), []);
  expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshotSchema.safeParse({ ...snapshot, roundResults }).success).toBe(false);
  expect(snapshotSchema.safeParse({ ...snapshot, phase: "ended", roundResults }).success).toBe(true);
});
