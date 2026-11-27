import { expect, it } from "vitest";
import { remainingSessionMs } from "./session";

const credentials = { matchCode: "ABCDEFGH", hostToken: "h".repeat(64), playerToken: null };
it("bounds a skewed future expiry to one room lifetime from the saved join", () => {
  const session = { ...credentials, expiresAtMs: 10 * 86400000, savedAtMs: 1000 };
  expect(remainingSessionMs(session, 2000)).toBe(86399000);
  expect(remainingSessionMs(session, 86401000)).toBe(0);
});
it("uses the earlier server expiry and tolerates small clock adjustments", () => {
  const session = { ...credentials, expiresAtMs: 700000, savedAtMs: 400000 };
  expect(remainingSessionMs(session, 450000)).toBe(250000);
  expect(remainingSessionMs(session, 390000)).toBe(310000);
  expect(remainingSessionMs(session, 0)).toBe(0);
});
