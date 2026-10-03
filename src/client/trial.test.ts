import { expect, it } from "vitest";
import { addTrialSample, exportTrialSummary, newTrialSummary } from "./trial";
import { parameters } from "../../test/fixtures";
import type { TrialSample } from "../shared/protocol";

const sample: TrialSample = { atMs: 1000, distanceM: 8, uncertaintiesM: [1, 1],
  agesMs: [20, 30], updateGapsMs: [1000, 1200], delayBoundsMs: [[0, 20], [5, 30]],
  clockUncertaintiesMs: [5, 5], referenceM: 20 };
const twoIphoneSummary = addTrialSample(newTrialSummary({
  devices: [{ model: "iPhone 15", os: "iOS 18", mode: "Safari tab" },
    { model: "iPhone 16", os: "iOS 18", mode: "Installed PWA" }],
  conditions: "Open outdoor area", candidates: [parameters],
}), sample);

it("exports measurements without coordinates, credentials, names, or per-fix records", () => {
  const text = exportTrialSummary(twoIphoneSummary);
  expect(text).toContain("iPhone");
  expect(text).not.toMatch(/latitude|longitude|token|playerName|atMs/);
  const report = JSON.parse(text);
  expect(report.sampleCount).toBe(1);
  expect(report.references[0].referenceM).toBe(20);
  expect(report.references[0].absoluteErrorM.mean).toBe(12);
  expect(report.references[0].captureToReceiptUpperMs[1].mean).toBe(30);
});
it("does not count duplicate samples and records candidate false entries and interruptions", () => {
  const duplicate = addTrialSample(twoIphoneSummary, sample);
  expect(duplicate.sampleCount).toBe(1);
  const moved = addTrialSample(duplicate, { ...sample, atMs: 2000, distanceM: 50 });
  const report = JSON.parse(exportTrialSummary(moved));
  expect(report.candidates[0]).toMatchObject({ falseEntrySamples: 1, interruptions: 1 });
  expect(report.limitations.join(" ")).toMatch(/provisional|device/i);
});
it("clears retention eligibility after a freshness gap before evaluating re-entry", () => {
  const initial = addTrialSample(newTrialSummary({
    devices: twoIphoneSummary.devices, conditions: "Open outdoor area", candidates: [parameters],
  }), { ...sample, updateGapsMs: [0, 0] });
  const afterGap = addTrialSample(initial, {
    ...sample, atMs: 7000, distanceM: 11, updateGapsMs: [6000, 6000],
  });
  expect(afterGap.candidates[0]).toMatchObject({ interruptions: 1, eligibleSamples: 1 });
  expect(afterGap.runtime.inside).toEqual([false]);
});
