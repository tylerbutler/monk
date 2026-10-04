// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLocation } from "./location";
import type { LocationStatus, PositionReport } from "../shared/protocol";

let onWatch: PositionCallback;
let onError: PositionErrorCallback;
let clearWatch: ReturnType<typeof vi.fn>;
let fallback: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "performance"] });
  vi.setSystemTime(10000);
  sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  clearWatch = vi.fn();
  fallback = vi.fn();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    watchPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback) => { onWatch = success; onError = error; return 1; }),
    getCurrentPosition: fallback, clearWatch,
  } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function position(timestamp: number): GeolocationPosition {
  return { timestamp, coords: { latitude: 0, longitude: 0, accuracy: 1,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, toJSON: () => ({}) };
}
it("preserves capture timestamps and rejects repeated cached fixes", () => {
  const fixes: PositionReport[] = [], states: LocationStatus[] = [];
  const stop = startLocation(f => fixes.push(f), s => states.push(s));
  onWatch(position(10000)); onWatch(position(10000));
  expect(fixes).toHaveLength(1);
  expect(fixes[0].capturedAtMs).toBe(10000);
  expect(states.at(-1)?.wakeLock).toBe("unsupported");
  stop();
});
it("reports permission denial and stops collection", () => {
  const states: LocationStatus[] = [];
  const stop = startLocation(() => {}, s => states.push(s));
  onError({ code: 1, message: "Denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  expect(states.at(-1)).toMatchObject({ permission: "denied", collecting: false });
  expect(clearWatch).toHaveBeenCalledWith(1);
  stop();
});
it("uses the watch without forced polling and discards callbacks after stop or hide", () => {
  const fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), () => {});
  vi.advanceTimersByTime(30000);
  expect(fallback).not.toHaveBeenCalled();
  stop();
  onWatch(position(40000));
  expect(fixes).toHaveLength(0);
  vi.advanceTimersByTime(5000);
  expect(fallback).not.toHaveBeenCalled();
  const stopAgain = startLocation(f => fixes.push(f), () => {});
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  onWatch(position(18000));
  expect(fixes).toHaveLength(0);
  stopAgain();
});
it("reports a new position after the phone clock moves backward", () => {
  const states: LocationStatus[] = [], fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), s => states.push(s));
  onWatch(position(10000));
  vi.setSystemTime(5000);
  onWatch(position(5000));
  expect(fixes.map(f => [f.seq, f.capturedAtMs, f.reportedAgeMs])).toEqual([[1, 10000, 0], [2, 5000, 0]]);
  expect(states.at(-1)?.reason).toBeNull();
  stop();
});
it("preserves sequence numbers across restarts without a clock quarantine", () => {
  const fixes: PositionReport[] = [], states: LocationStatus[] = [];
  const stop = startLocation(f => fixes.push(f), s => states.push(s));
  onWatch(position(10000));
  stop();
  vi.advanceTimersByTime(3000);
  vi.setSystemTime(12000);
  const stopAgain = startLocation(f => fixes.push(f), s => states.push(s));
  onWatch(position(11000));
  expect(fixes.map(f => [f.seq, f.capturedAtMs, f.reportedAgeMs])).toEqual([[1, 10000, 0], [2, 11000, 1000]]);
  stopAgain();
});
it.each([[9999, 1], [5000, 5000], [0, 10000], [10001, null]])("reports available capture %s with age %s", (timestamp, age) => {
  const fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), () => {});
  onWatch(position(timestamp!));
  expect(fixes).toHaveLength(1);
  expect(fixes[0]).toMatchObject({ capturedAtMs: timestamp, reportedAgeMs: age });
  stop();
});
it("reports a released wake lock and releases a late-acquired lock after stop", async () => {
  class Lock extends EventTarget {
    released = false;
    async release() { this.released = true; this.dispatchEvent(new Event("release")); }
  }
  const lock = new Lock();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => lock } });
  const states: LocationStatus[] = [];
  const stop = startLocation(() => {}, s => states.push(s));
  await Promise.resolve(); await Promise.resolve();
  await lock.release();
  expect(states.at(-1)?.wakeLock).toBe("released");
  stop();
  const late = new Lock();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => late } });
  const stopLate = startLocation(() => {}, () => {});
  stopLate();
  await Promise.resolve(); await Promise.resolve();
  expect(late.released).toBe(true);
});
it("normalizes fractional browser milliseconds without rejecting available coordinates", () => {
  const fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), () => {});
  onWatch(position(9999.25));
  expect(fixes).toMatchObject([{ capturedAtMs: 9999, reportedAgeMs: 1 }]);
  stop();
});
it("does not send a fix if its status callback stops the watch", () => {
  const fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), s => { if (s.permission === "granted") stop(); });
  onWatch(position(10000));
  expect(fixes).toEqual([]);
});
