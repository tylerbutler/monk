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
  expect(awardSequenceAt(awards, 3500)).toEqual({ kind: "award", award: awards[1], index: 1, ageMs: 0 });
  expect(awardSequenceAt(awards, 15499)).toEqual({ kind: "award", award: awards[4], index: 4, ageMs: 2999 });
  expect(awardSequenceAt(awards, 15500)).toEqual({ kind: "results" });
  expect(awardSequenceAt([], 0)).toEqual({ kind: "results" });
  expect(awardSequenceDuration([])).toBe(0);
  expect(awardSequenceDuration([awards[0]])).toBe(3500);
  expect(awardSequenceDuration(awards)).toBe(15500);
  expect(awardSequenceAt(awards, 500)).toEqual({ kind: "award", award: awards[0], index: 0, ageMs: 0 });
});

it("describes the actual measure without losing comeback precision", () => {
  expect(awardAchievement(awards[0])).toBe("Converted as Rock, Paper, and Scissors.");
  expect(awardAchievement(awards[1])).toContain("1.201 s");
  expect(awardAchievement(awards[1])).toContain("eligible play");
  expect(awardAchievement({ ...awards[1], id: "comeback_kid", value: 0 })).toContain("0.000 s");
  expect(awardAchievement(awards[2])).toBe("2 distinct conversion counterparts.");
  expect(awardAchievement({ id: "social_butterfly", winnerIds: ["p1"], value: 1 })).toBe("1 distinct conversion counterpart.");
  expect(awardAchievement(awards[3])).toBe("3 conversions in one streak.");
  expect(awardAchievement(awards[4])).toBe("4 conversions made.");
});

for (const [index, artwork] of [
  [0, ".award-hand"], [1, ".award-turnaround"], [2, ".award-arch"],
  [3, ".award-streak"], [4, ".award-curtain"],
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
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("[data-award]")?.classList.contains("is-reduced")).toBe(true);
    expect(root.querySelector(".conversion-takeover, .conversion-bubble, .conversion-faction-stamp")).toBeNull();
  });
}
