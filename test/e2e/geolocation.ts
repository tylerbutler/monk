import type { BrowserContext } from "@playwright/test";

type Coordinates = Pick<GeolocationCoordinates, "latitude" | "longitude" | "accuracy">;
type LocationErrorCode = 1 | 2 | 3;

declare global {
  interface Window {
    monkTestGeolocation: {
      setPosition(coordinates: Coordinates): void;
      setError(code: LocationErrorCode): void;
    };
  }
}

export async function installGeolocation(context: BrowserContext, initial: Coordinates): Promise<void> {
  await context.addInitScript(initial => {
    type Reading = GeolocationPosition | GeolocationPositionError;
    const watches = new Map<number, { success: PositionCallback; error?: PositionErrorCallback | null }>();
    let nextId = 1;

    function capture(coordinates: Coordinates): GeolocationPosition {
      const timestamp = Date.now();
      const values = { ...coordinates, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
      return {
        timestamp, coords: { ...values, toJSON: () => values },
        toJSON: () => ({ timestamp, coords: values }),
      };
    }
    let current: Reading = capture(initial);
    function deliver(reading: Reading, success: PositionCallback, error?: PositionErrorCallback | null) {
      if ("coords" in reading) success(reading);
      else error?.(reading);
    }
    function notify(id: number, reading: Reading) {
      setTimeout(() => {
        const watch = watches.get(id);
        if (watch) deliver(reading, watch.success, watch.error);
      }, 0);
    }
    function publish(reading: Reading) {
      current = reading;
      for (const id of watches.keys()) notify(id, reading);
    }

    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(success, error) {
          const id = nextId++;
          watches.set(id, { success, error });
          notify(id, current);
          return id;
        },
        clearWatch(id) { watches.delete(id); },
        getCurrentPosition(success, error) {
          const reading = current;
          setTimeout(() => deliver(reading, success, error), 0);
        },
      } satisfies Geolocation,
    });
    window.monkTestGeolocation = {
      setPosition(coordinates) { publish(capture(coordinates)); },
      setError(code) {
        publish({
          code, message: ["Location permission denied.", "Location unavailable.", "Location request timed out."][code - 1],
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
        });
      },
    };
  }, initial);
}
