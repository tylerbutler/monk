// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLocation } from "./location";
import type { LocationStatus, PositionReport } from "../shared/protocol";

let onWatch: PositionCallback;
let onFallback: PositionCallback;
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
  fallback = vi.fn((success: PositionCallback) => { onFallback = success; });
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
it("permits one fallback request and discards callbacks after stop or hide", () => {
  const fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), () => {});
  vi.advanceTimersByTime(3000);
  expect(fallback).toHaveBeenCalledTimes(1);
  stop();
  onFallback(position(13000));
  expect(fixes).toHaveLength(0);
  vi.advanceTimersByTime(5000);
  expect(fallback).toHaveBeenCalledTimes(1);
  const stopAgain = startLocation(f => fixes.push(f), () => {});
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  onWatch(position(18000));
  expect(fixes).toHaveLength(0);
  stopAgain();
});
it("detects backward wall-clock changes without sending a fix", () => {
  const states: LocationStatus[] = [], fixes: PositionReport[] = [];
  const stop = startLocation(f => fixes.push(f), s => states.push(s));
  vi.setSystemTime(5000);
  onWatch(position(5000));
  expect(fixes).toHaveLength(0);
  expect(states.at(-1)?.reason).toMatch(/clock/i);
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
