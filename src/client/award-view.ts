import type { AwardId, RoundAward } from "../shared/protocol";

export const awardTitles: Record<AwardId, string> = {
  hat_trick: "Hat Trick", comeback_kid: "Comeback Kid", social_butterfly: "Social Butterfly",
  hot_streak: "Hot Streak", conversion_champion: "Conversion Champion",
};
export const awardTiming = { introMs: 500, announcementMs: 6000 };
export type AwardSequence = { kind: "intro" } |
  { kind: "award"; award: RoundAward; index: number; ageMs: number } | { kind: "results" };

export function awardSequenceDuration(awards: readonly RoundAward[]): number {
  return awards.length ? awardTiming.introMs + awardTiming.announcementMs * awards.length : 0;
}
export function awardSequenceAt(awards: readonly RoundAward[], elapsedMs: number): AwardSequence {
  if (elapsedMs >= awardSequenceDuration(awards)) return { kind: "results" };
  if (elapsedMs < awardTiming.introMs) return { kind: "intro" };
  const age = elapsedMs - awardTiming.introMs, index = Math.floor(age / awardTiming.announcementMs);
  return { kind: "award", award: awards[index], index, ageMs: age % awardTiming.announcementMs };
}
export function awardAchievement(award: RoundAward): string {
  switch (award.id) {
    case "hat_trick": return "Converted as Rock, Paper, and Scissors.";
    case "comeback_kid": return `${(award.value / 1000).toFixed(3)} s of eligible play for the fastest comeback.`;
    case "social_butterfly": return `${award.value} distinct conversion counterpart${award.value === 1 ? "" : "s"}.`;
    case "hot_streak": return `${award.value} conversions in one streak.`;
    case "conversion_champion": return `${award.value} conversion${award.value === 1 ? "" : "s"} made.`;
  }
}
