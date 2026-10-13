// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { RoundAward } from "../shared/protocol";
import { awardAchievement, awardSequenceAt, awardSequenceDuration } from "./award-view";
import AwardAnnouncement from "./AwardAnnouncement.svelte";

const awards: RoundAward[] = [
  { id: "hat_trick", winnerIds: ["p1"], value: null },
  { id: "comeback_kid", winnerIds: ["p1"], value: 1201 },
  { id: "social_butterfly", winnerIds: ["p1"], value: 2 },
  { id: "hot_streak", winnerIds: ["p1"], value: 3 },
  { id: "conversion_champion", winnerIds: ["p1"], value: 4 },
];
const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => { flushSync(() => { for (const view of mounted.splice(0)) void unmount(view); }); document.body.replaceChildren(); });

it("uses exact intro, announcement, and final-results boundaries", () => {
  expect(awardSequenceAt(awards, 499)).toEqual({ kind: "intro" });
  expect(awardSequenceAt(awards, 500)).toEqual({ kind: "award", award: awards[0], index: 0, ageMs: 0 });
  expect(awardSequenceAt(awards, 6499)).toEqual({ kind: "award", award: awards[0], index: 0, ageMs: 5999 });
  expect(awardSequenceAt(awards, 6500)).toEqual({ kind: "award", award: awards[1], index: 1, ageMs: 0 });
  expect(awardSequenceAt(awards, 30499)).toEqual({ kind: "award", award: awards[4], index: 4, ageMs: 5999 });
  expect(awardSequenceAt(awards, 30500)).toEqual({ kind: "results" });
  expect(awardSequenceAt([], 0)).toEqual({ kind: "results" });
  expect(awardSequenceDuration([])).toBe(0);
  expect(awardSequenceDuration([awards[0]])).toBe(6500);
  expect(awardSequenceDuration(awards)).toBe(30500);
  expect(awardSequenceAt(awards, 500)).toEqual({ kind: "award", award: awards[0], index: 0, ageMs: 0 });
});

it("describes the actual measure without losing comeback precision", () => {
  expect(awardAchievement(awards[0])).toEqual({ value: "Rock, Paper, Scissors", label: "All three factions" });
  expect(awardAchievement(awards[1])).toEqual({ value: "1.201", label: "seconds of eligible play" });
  expect(awardAchievement({ ...awards[1], id: "comeback_kid", value: 0 })).toEqual({
    value: "0.000", label: "seconds of eligible play",
  });
  expect(awardAchievement(awards[2])).toEqual({ value: "2", label: "different players" });
  expect(awardAchievement({ id: "social_butterfly", winnerIds: ["p1"], value: 1 })).toEqual({
    value: "1", label: "different player",
  });
  expect(awardAchievement(awards[3])).toEqual({ value: "3", label: "conversions in one streak" });
  expect(awardAchievement(awards[4])).toEqual({ value: "4", label: "conversions made" });
  expect(awardAchievement({ id: "conversion_champion", winnerIds: ["p1"], value: 1 })).toEqual({
    value: "1", label: "conversion made",
  });
});

for (const [index, artwork, description, value, label] of [
  [0, ".award-hand", "Convert at least one player as each faction.", "Rock, Paper, Scissors", "All three factions"],
  [1, ".award-turnaround", "Fastest conversion after being converted.", "1.201", "seconds of eligible play"],
  [2, ".award-arch", "Most different players involved in conversions, in either direction.", "2", "different players"],
  [3, ".award-streak", "Most conversions in a row without being converted (at least two).", "3", "conversions in one streak"],
  [4, ".award-curtain", "Most conversions made this round.", "4", "conversions made"],
] as const) {
  it(`renders ${awards[index].id} artwork and shared winners as literal text`, () => {
    const root = document.createElement("div"); document.body.append(root);
    mounted.push(mount(AwardAnnouncement, { target: root, props: {
      award: { ...awards[index], winnerIds: ["p1", "p2"] },
      winners: [{ id: "p1", label: "Alex" }, { id: "p2", label: "<img src=x onerror=alert(1)>" }],
      ageMs: 1500, reducedMotion: true,
    } }));
    flushSync();
    expect(root.querySelector("[data-award]")?.getAttribute("data-award")).toBe(awards[index].id);
    expect(root.querySelectorAll(artwork).length).toBeGreaterThan(0);
    expect(root.querySelectorAll("[data-award-winner]")).toHaveLength(2);
    expect(root.querySelector(".award-description")?.textContent).toBe(description);
    expect(root.querySelector(".award-value")?.textContent).toBe(value);
    expect(root.querySelector(".award-measure")?.textContent).toBe(label);
    if (index === 1) expect(root.querySelector(".award-time-note")?.textContent).toContain(
      "Excludes pauses, conversion grace, and unusable-location time.",
    );
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("[data-award]")?.classList.contains("is-reduced")).toBe(true);
    expect(root.querySelector(".conversion-takeover, .conversion-bubble, .conversion-faction-stamp")).toBeNull();
  });
}
