import { expect, it } from "vitest";
import { estimateClock, normalizeObservation } from "./clock";

it("uses the oldest plausible fix time for expiry", () => {
  const parsed = normalizeObservation(
    { seq: 1, capturedAtMs: 1000, latitude: 0, longitude: 0, accuracyM: 1 },
    { offsetMs: 100, uncertaintyMs: 40, measuredAtMs: 1000 }, 1100, "p1", 1500);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.expiresAtMs).toBe(2560);
});
it("bounds asymmetric transit delay and rejects impossible probes", () => {
  expect(estimateClock({ clientSendMs: 1000, serverReceiveMs: 1150, serverSendMs: 1170, clientReceiveMs: 1100 }))
    .toEqual({ ok: true, value: { offsetMs: 110, uncertaintyMs: 40, measuredAtMs: 1170 } });
  for (const sample of [
    { clientSendMs: 1000, serverReceiveMs: 1000, serverSendMs: 999, clientReceiveMs: 1100 },
    { clientSendMs: 1000, serverReceiveMs: 1000, serverSendMs: 1200, clientReceiveMs: 1100 },
    { clientSendMs: 1000, serverReceiveMs: 1000, serverSendMs: 1000, clientReceiveMs: 4000 },
  ]) expect(estimateClock(sample).ok).toBe(false);
});
it("rejects stale, future, and clock-expired fixes", () => {
  const clock = { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: 1000 };
  const report = { seq: 1, capturedAtMs: 1000, latitude: 0, longitude: 0, accuracyM: 1 };
  expect(normalizeObservation(report, clock, 2500, "p1", 1500).ok).toBe(false);
  expect(normalizeObservation({ ...report, capturedAtMs: 3000 }, clock, 2000, "p1", 1500).ok).toBe(false);
  expect(normalizeObservation({ ...report, capturedAtMs: 32000 }, clock, 32000, "p1", 1500).ok).toBe(false);
});
