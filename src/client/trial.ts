import { trialReportSchema, trialSampleSchema } from "../shared/protocol";
import type { Distribution, RuleParameters, TrialReport, TrialSample, TrialSummary } from "../shared/protocol";

const bounds = [-100, -50, -20, -10, -5, -2, -1, 0, 1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000];
function empty(): Distribution {
  return { count: 0, min: null, max: null, mean: null, bounds, counts: bounds.map(() => 0).concat(0) };
}
function add(d: Distribution, n: number): Distribution {
  const bucket = d.bounds.findIndex(b => n <= b);
  const index = bucket < 0 ? d.bounds.length : bucket;
  return {
    ...d, count: d.count + 1, min: d.min === null ? n : Math.min(d.min, n),
    max: d.max === null ? n : Math.max(d.max, n),
    mean: ((d.mean ?? 0) * d.count + n) / (d.count + 1),
    counts: d.counts.map((count, i) => count + (i === index ? 1 : 0)),
  };
}
function pair(): [Distribution, Distribution] { return [empty(), empty()]; }
function addPair(values: [Distribution, Distribution], sample: [number, number]): [Distribution, Distribution] {
  return [add(values[0], sample[0]), add(values[1], sample[1])];
}
export function newTrialSummary(input: { devices: TrialReport["devices"]; conditions: string; candidates: RuleParameters[] }): TrialSummary {
  const report = trialReportSchema.parse({
    version: 1, devices: input.devices, conditions: input.conditions, sampleCount: 0, references: [],
    candidates: input.candidates.map(parameters => ({ parameters, falseEntrySamples: 0, interruptions: 0, eligibleSamples: 0 })),
    limitations: [
      "Provisional results apply only to this device pair, software, and outdoor conditions.",
      "This two-iPhone trial does not validate Android or other phones.",
      "Clock bounds describe transport checks, not proof of physical location.",
      "False-entry samples and interruptions evaluate location gates. Dwell and grace need separate gameplay trials.",
    ],
  });
  return { ...report, runtime: { lastAtMs: null, inside: input.candidates.map(() => false) } };
}
export function addTrialSample(summary: TrialSummary, raw: TrialSample): TrialSummary {
  const sample = trialSampleSchema.parse(raw);
  if (summary.runtime.lastAtMs !== null && sample.atMs <= summary.runtime.lastAtMs) return summary;
  let group = summary.references.find(r => r.referenceM === sample.referenceM) ?? {
    referenceM: sample.referenceM, count: 0, signedErrorM: empty(), absoluteErrorM: empty(),
    uncertaintiesM: pair(), agesMs: pair(), updateGapsMs: pair(),
    captureToReceiptLowerMs: pair(), captureToReceiptUpperMs: pair(), clockUncertaintiesMs: pair(),
  };
  const error = sample.referenceM === null ? null : sample.distanceM - sample.referenceM;
  group = {
    ...group, count: group.count + 1,
    signedErrorM: error === null ? group.signedErrorM : add(group.signedErrorM, error),
    absoluteErrorM: error === null ? group.absoluteErrorM : add(group.absoluteErrorM, Math.abs(error)),
    uncertaintiesM: addPair(group.uncertaintiesM, sample.uncertaintiesM),
    agesMs: addPair(group.agesMs, sample.agesMs), updateGapsMs: addPair(group.updateGapsMs, sample.updateGapsMs),
    captureToReceiptLowerMs: addPair(group.captureToReceiptLowerMs, [sample.delayBoundsMs[0][0], sample.delayBoundsMs[1][0]]),
    captureToReceiptUpperMs: addPair(group.captureToReceiptUpperMs, [sample.delayBoundsMs[0][1], sample.delayBoundsMs[1][1]]),
    clockUncertaintiesMs: addPair(group.clockUncertaintiesMs, sample.clockUncertaintiesMs),
  };
  const inside = summary.candidates.map((c, i) => {
    const p = c.parameters;
    return sample.uncertaintiesM.every(u => u <= p.maxAccuracyM) &&
      sample.agesMs.every(age => age < p.freshnessMs) &&
      sample.distanceM + sample.uncertaintiesM[0] + sample.uncertaintiesM[1] <=
      (summary.runtime.inside[i] ? p.retentionRadiusM : p.entryRadiusM);
  });
  return {
    ...summary, sampleCount: summary.sampleCount + 1,
    references: [...summary.references.filter(r => r.referenceM !== sample.referenceM), group],
    candidates: summary.candidates.map((c, i) => ({
      ...c, eligibleSamples: c.eligibleSamples + (inside[i] ? 1 : 0),
      falseEntrySamples: c.falseEntrySamples + (inside[i] && sample.referenceM !== null &&
        sample.referenceM > c.parameters.entryRadiusM ? 1 : 0),
      interruptions: c.interruptions + (summary.runtime.inside[i] &&
        (!inside[i] || sample.updateGapsMs.some(g => g >= c.parameters.freshnessMs)) ? 1 : 0),
    })),
    runtime: { lastAtMs: sample.atMs, inside },
  };
}
export function exportTrialSummary(summary: TrialSummary): string {
  const { runtime: _runtime, ...report } = summary;
  return JSON.stringify(trialReportSchema.parse(report), null, 2);
}
