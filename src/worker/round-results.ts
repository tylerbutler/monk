import { roundResultsSchema } from "../shared/protocol";
import type { PlayerSnapshot, RoundAward, RoundResults } from "../shared/protocol";
import type { AwardData, PlayerAwardData } from "./award-data";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function selectRoundResults(data: AwardData | null,
  roster: readonly Pick<PlayerSnapshot["roster"][number], "id" | "label">[]): RoundResults {
  if (!data || data.coverage !== "complete") {
    const labels = new Map(roster.map(p => [p.id, p.label]));
    for (const [id, player] of Object.entries(data?.players ?? {})) labels.set(id, player.label);
    const players = [...labels].map(([id, label]) => ({ id, label, rank: null, conversionsMade: null }))
      .sort((a, b) => compare(a.label, b.label) || compare(a.id, b.id));
    return roundResultsSchema.parse({ coverage: data ? "partial" : "unavailable", players, awards: [] });
  }
  const entries = Object.entries(data.players).sort(([a, left], [b, right]) =>
    right.conversionsMade - left.conversionsMade || compare(left.label, right.label) || compare(a, b));
  let rank = 0, previous: number | null = null;
  const players = entries.map(([id, player], index) => {
    if (player.conversionsMade !== previous) rank = index + 1;
    previous = player.conversionsMade;
    return { id, label: player.label, rank, conversionsMade: player.conversionsMade };
  });
  const awards: RoundAward[] = [];
  const hats = entries.filter(([, p]) => Object.values(p.conversionsByFaction).every(count => count > 0));
  if (hats.length) awards.push({ id: "hat_trick", winnerIds: hats.map(([id]) => id), value: null });
  const comebacks = entries.filter(([, p]) => p.fastestComebackEligibleMs !== null);
  if (comebacks.length) {
    const value = comebacks.reduce((best, [, p]) => Math.min(best, p.fastestComebackEligibleMs ?? Infinity), Infinity);
    awards.push({ id: "comeback_kid", value,
      winnerIds: comebacks.filter(([, p]) => p.fastestComebackEligibleMs === value).map(([id]) => id) });
  }
  function most(id: "social_butterfly" | "hot_streak" | "conversion_champion",
    score: (player: PlayerAwardData) => number, minimum: number) {
    const value = entries.reduce((best, [, p]) => Math.max(best, score(p)), 0);
    if (value >= minimum) awards.push({ id, value, winnerIds: entries.filter(([, p]) => score(p) === value).map(([id]) => id) });
  }
  most("social_butterfly", p => p.conversionPeerIds.length, 1);
  most("hot_streak", p => p.longestConversionStreak, 2);
  most("conversion_champion", p => p.conversionsMade, 1);
  return roundResultsSchema.parse({ coverage: "complete", players, awards });
}
