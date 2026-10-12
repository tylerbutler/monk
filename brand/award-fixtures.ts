import { roundResultsSchema, type RoundResults } from "../src/shared/protocol";

export type AwardFixtureId = "normal" | "ties" | "long_names" | "large_group" | "large_hat_trick" | "no_awards" | "partial";
export const awardFixtureLabels: Record<AwardFixtureId, string> = {
  normal: "Five awards, repeat winner", ties: "Shared ties", long_names: "Long, duplicate, and literal names",
  large_group: "120 players, including former players", large_hat_trick: "120 shared Hat Trick winners",
  no_awards: "No trophies earned", partial: "Incomplete collection",
};

const normal = {
  coverage: "complete",
  players: [
    { id: "p1", label: "Alex", rank: 1, conversionsMade: 8 },
    { id: "p2", label: "Blair", rank: 2, conversionsMade: 4 },
    { id: "p3", label: "Casey", rank: 3, conversionsMade: 2 },
    { id: "p4", label: "Devon", rank: 4, conversionsMade: 0 },
  ],
  awards: [
    { id: "hat_trick", winnerIds: ["p1"], value: null },
    { id: "comeback_kid", winnerIds: ["p2"], value: 1201 },
    { id: "social_butterfly", winnerIds: ["p1"], value: 3 },
    { id: "hot_streak", winnerIds: ["p1"], value: 5 },
    { id: "conversion_champion", winnerIds: ["p1"], value: 8 },
  ],
} satisfies RoundResults;
const large = Array.from({ length: 120 }, (_, i) => ({
  id: `large-${i}`, label: i < 2 ? "Alex" : `Former player ${i}`,
  rank: i < 2 ? 1 : 3, conversionsMade: i < 2 ? 12 : 0,
}));
export const awardFixtures: Record<AwardFixtureId, RoundResults> = {
  normal,
  ties: { ...normal, players: normal.players.map(p => p.id === "p2" ? { ...p, rank: 1, conversionsMade: 8 } : p),
    awards: normal.awards.map(a => a.id === "conversion_champion" || a.id === "comeback_kid" ?
      { ...a, winnerIds: ["p1", "p2"] } : a) },
  long_names: { ...normal, players: normal.players.map((p, i) => ({
    ...p, label: ["A".repeat(80), "Alex", "Alex", "<b>Alex</b>"][i],
  })) },
  large_group: { coverage: "complete", players: large, awards: [
    { id: "conversion_champion", winnerIds: ["large-0", "large-1"], value: 12 },
  ] },
  large_hat_trick: { coverage: "complete", players: large.map(p => ({ ...p, rank: 1, conversionsMade: 3 })),
    awards: [{ id: "hat_trick", winnerIds: large.map(p => p.id), value: null }] },
  no_awards: { coverage: "complete", players: normal.players.map(p => ({ ...p, rank: 1, conversionsMade: 0 })), awards: [] },
  partial: { coverage: "partial", players: normal.players.map(p => ({ ...p, rank: null, conversionsMade: null })), awards: [] },
};
for (const fixture of Object.values(awardFixtures)) roundResultsSchema.parse(fixture);
