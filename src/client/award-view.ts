import type { AwardId, RoundAward } from "../shared/protocol";

export const awardTitles: Record<AwardId, string> = {
  hat_trick: "Hat Trick", comeback_kid: "Comeback Kid", social_butterfly: "Social Butterfly",
  hot_streak: "Hot Streak", conversion_champion: "Conversion Champion",
};
export const awardDescriptions: Record<AwardId, string> = {
  hat_trick: "Convert at least one player as each faction.",
  comeback_kid: "Fastest conversion after being converted.",
  social_butterfly: "Most different players involved in conversions, in either direction.",
  hot_streak: "Most conversions in a row without being converted (at least two).",
  conversion_champion: "Most conversions made this round.",
};
export const comebackTimingNote = "Excludes pauses, conversion grace, and unusable-location time.";
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
export function awardAchievement(award: RoundAward): { value: string; label: string } {
  switch (award.id) {
    case "hat_trick": return { value: "Rock, Paper, Scissors", label: "All three factions" };
    case "comeback_kid": return { value: (award.value / 1000).toFixed(3), label: "seconds of eligible play" };
    case "social_butterfly": return { value: String(award.value), label: `different player${award.value === 1 ? "" : "s"}` };
    case "hot_streak": return { value: String(award.value), label: "conversions in one streak" };
    case "conversion_champion": return { value: String(award.value), label: `conversion${award.value === 1 ? "" : "s"} made` };
  }
}
