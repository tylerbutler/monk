import { test, expect } from "@playwright/test";
import { installGeolocation } from "./geolocation";

test("delivers asynchronous fixes and errors while respecting watch cancellation", async ({ context, page }) => {
  await installGeolocation(context, { latitude: 0, longitude: 0, accuracy: 1 });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const fixes: GeolocationPosition[] = [];
    const errors: number[] = [];
    let cancelledCallbacks = 0;
    const startedAt = Date.now();
    window.monkTestGeolocation.setPosition({ latitude: 0, longitude: 0, accuracy: 1 });
    const watch = navigator.geolocation.watchPosition(fix => fixes.push(fix), error => errors.push(error.code));
    const cancelledWatch = navigator.geolocation.watchPosition(() => { cancelledCallbacks++; });
    navigator.geolocation.clearWatch(cancelledWatch);
    const synchronousCallbacks = fixes.length;
    const current = () => new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject));
    const initial = await current();
    window.monkTestGeolocation.setPosition({ latitude: 0, longitude: 0.001, accuracy: 16 });
    const moved = await current();
    window.monkTestGeolocation.setError(1);
    const denied = await new Promise<number>(resolve =>
      navigator.geolocation.getCurrentPosition(() => resolve(-1), error => resolve(error.code)));
    navigator.geolocation.clearWatch(watch);
    window.monkTestGeolocation.setPosition({ latitude: 0, longitude: 0.002, accuracy: 1 });
    await current();
    return {
      synchronousCallbacks, cancelledCallbacks, errors, denied, startedAt, finishedAt: Date.now(),
      fixes: fixes.map(fix => ({ longitude: fix.coords.longitude, accuracy: fix.coords.accuracy })),
      timestamps: [initial.timestamp, moved.timestamp],
    };
  });
  expect(result.synchronousCallbacks).toBe(0);
  expect(result.cancelledCallbacks).toBe(0);
  expect(result.fixes).toEqual([{ longitude: 0, accuracy: 1 }, { longitude: 0.001, accuracy: 16 }]);
  expect(result.errors).toEqual([1]);
  expect(result.denied).toBe(1);
  for (const timestamp of result.timestamps) {
    expect(timestamp).toBeGreaterThanOrEqual(result.startedAt);
    expect(timestamp).toBeLessThanOrEqual(result.finishedAt);
  }
});
