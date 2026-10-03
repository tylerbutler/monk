import { clockSchema, observationSchema, positionSchema } from "./protocol";
import type { ClockEstimate, ClockProbeSample, Observation, ParseResult, PositionReport } from "./protocol";

export function estimateClock(sample: ClockProbeSample): ParseResult<ClockEstimate> {
  const { clientSendMs: c0, serverReceiveMs: s1, serverSendMs: s2, clientReceiveMs: c3 } = sample;
  if (![c0, s1, s2, c3].every(n => Number.isSafeInteger(n) && n >= 0) || c3 < c0 || s2 < s1 || s2 - s1 > c3 - c0) {
    return { ok: false, error: "Clock probe intervals are inconsistent. Request a new probe." };
  }
  const estimate = clockSchema.safeParse({
    offsetMs: ((s1 - c0) + (s2 - c3)) / 2,
    uncertaintyMs: ((c3 - c0) - (s2 - s1)) / 2,
    measuredAtMs: s2,
  });
  return estimate.success ? { ok: true, value: estimate.data } :
    { ok: false, error: "Clock uncertainty exceeds 1000 ms. Request a new probe." };
}

export function normalizeObservation(report: PositionReport, clock: ClockEstimate, receivedAtMs: number,
  playerId: string, freshnessMs: number): ParseResult<Observation> {
  if (!positionSchema.safeParse(report).success || !clockSchema.safeParse(clock).success ||
    !Number.isSafeInteger(receivedAtMs) || !Number.isSafeInteger(freshnessMs) || freshnessMs <= 0 ||
    receivedAtMs < clock.measuredAtMs || receivedAtMs - clock.measuredAtMs > 30000) {
    return { ok: false, error: "Fix or clock estimate is invalid or expired. Request a new clock probe." };
  }
  const oldestCaptureMs = report.capturedAtMs + clock.offsetMs - clock.uncertaintyMs;
  const expiresAtMs = Math.floor(oldestCaptureMs + freshnessMs);
  if (oldestCaptureMs > receivedAtMs || expiresAtMs <= receivedAtMs) {
    return { ok: false, error: "Location fix is stale or in the future." };
  }
  const parsed = observationSchema.safeParse({ ...report, playerId, expiresAtMs });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Normalized location fix is invalid." };
}
