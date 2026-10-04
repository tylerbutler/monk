import { expect, it } from "vitest";
import { gameObservation, positionAgeMs } from "./locations";

const known = {
  report: { seq: 1, capturedAtMs: 9876543, latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 },
  receivedAtMs: 100000, sharing: true,
};

it("stops influence at exactly thirty seconds without deleting position age", () => {
  expect(gameObservation(known, "p1", 129999)?.expiresAtMs).toBe(130000);
  expect(gameObservation(known, "p1", 130000)).toBeNull();
  expect(positionAgeMs(known, 130000)).toBe(30000);
});
it("deducts cached age and normalizes capture time without a phone clock probe", () => {
  const cached = { ...known, report: { ...known.report, reportedAgeMs: 12000 } };
  expect(gameObservation(cached, "p1", 100000)).toMatchObject({ capturedAtMs: 88000, expiresAtMs: 118000 });
  expect(gameObservation(cached, "p1", 117999)?.expiresAtMs).toBe(118000);
  expect(gameObservation(cached, "p1", 118000)).toBeNull();
  expect(positionAgeMs(cached, 101000)).toBe(13000);
});
it.each([30000, 60000])("keeps an old %s ms position ineligible", reportedAgeMs => {
  const cached = { ...known, report: { ...known.report, reportedAgeMs } };
  expect(gameObservation(cached, "p1", 100000)).toBeNull();
  expect(positionAgeMs(cached, 100001)).toBe(reportedAgeMs + 1);
});
it.each([null, undefined])("never treats unknown age %s as fresh", reportedAgeMs => {
  const unknown = { ...known, report: { ...known.report, reportedAgeMs } };
  expect(gameObservation(unknown, "p1", 100000)).toBeNull();
  expect(positionAgeMs(unknown, 110000)).toBeNull();
});
it("keeps suspended sharing ineligible without resetting age", () => {
  const stopped = { ...known, sharing: false };
  expect(gameObservation(stopped, "p1", 110000)).toBeNull();
  expect(positionAgeMs(stopped, 110000)).toBe(10000);
});
it("keeps ages within the wire duration limit", () => {
  const ancient = { ...known, report: { ...known.report, reportedAgeMs: Number.MAX_SAFE_INTEGER } };
  expect(positionAgeMs(ancient, 110000)).toBe(Number.MAX_SAFE_INTEGER);
  expect(gameObservation(ancient, "p1", 110000)).toBeNull();
});
