import { positionSchema } from "../shared/protocol";
import type { LocationStatus, PositionReport } from "../shared/protocol";

function locationFailure(error: GeolocationPositionError): Pick<LocationStatus, "permission" | "reason"> {
  if (error.code === 1) return { permission: "denied",
    reason: "Location permission denied. Allow location for this site in browser and device settings, then try again." };
  return { permission: "unknown", reason: error.code === 3 ?
    "Location request timed out. Move to a clear outdoor area and try again." :
    "Location is unavailable. Check device location settings and try again." };
}

export function requestLocationPermission(onResult: (result: Pick<LocationStatus, "permission" | "reason">) => void): () => void {
  let active = true;
  function finish(result: Pick<LocationStatus, "permission" | "reason">) {
    if (!active) return;
    active = false; onResult(result);
  }
  if (!navigator.geolocation) finish({ permission: "unknown", reason: "Geolocation is not supported by this browser." });
  else navigator.geolocation.getCurrentPosition(() => finish({ permission: "granted", reason: null }),
    error => finish(locationFailure(error)), { enableHighAccuracy: false, maximumAge: 60000, timeout: 5000 });
  return () => { active = false; };
}

export function startLocation(onFix: (fix: PositionReport) => void, onStatus: (status: LocationStatus) => void): () => void {
  let active = true, watcher: number | null = null;
  let lock: WakeLockSentinel | null = null;
  let sequence = 0, lastCaptureMs: number | null = null;
  const status: LocationStatus = {
    collecting: true, permission: "unknown", visible: document.visibilityState === "visible",
    wakeLock: navigator.wakeLock ? "pending" : "unsupported", reason: null,
  };
  function publish(reason: string | null = null) { status.reason = reason; onStatus({ ...status }); }
  function stop(reason: string | null = null) {
    if (!active) return;
    active = false; status.collecting = false;
    if (watcher !== null) navigator.geolocation.clearWatch(watcher);
    document.removeEventListener("visibilitychange", visibility);
    if (lock && !lock.released) void lock.release().catch(() => publish("Screen wake lock could not be released."));
    publish(reason);
  }
  function receive(position: GeolocationPosition) {
    if (!active || document.visibilityState !== "visible" || position.timestamp === lastCaptureMs) return;
    const { latitude, longitude, accuracy } = position.coords;
    const age = Date.now() - position.timestamp;
    const parsed = positionSchema.safeParse({
      seq: sequence + 1, capturedAtMs: Math.floor(position.timestamp), latitude, longitude, accuracyM: accuracy,
      reportedAgeMs: Number.isSafeInteger(Math.ceil(age)) && age >= 0 ? Math.ceil(age) : null,
    });
    if (!parsed.success) {
      publish("Location values are invalid. Wait for a new fix."); return;
    }
    try {
      sessionStorage.setItem("monk-position-seq", String(parsed.data.seq));
    } catch { stop("Session storage is unavailable. Allow storage before reporting location."); return; }
    sequence = parsed.data.seq; lastCaptureMs = position.timestamp;
    status.permission = "granted"; publish();
    if (active && document.visibilityState === "visible") onFix(parsed.data);
  }
  function fail(error: GeolocationPositionError) {
    if (!active) return;
    const result = locationFailure(error);
    status.permission = result.permission; stop(result.reason);
  }
  function visibility() {
    status.visible = document.visibilityState === "visible";
    if (!status.visible) stop("App is hidden. Location collection is stopped.");
  }
  document.addEventListener("visibilitychange", visibility);
  try {
    sequence = Number(sessionStorage.getItem("monk-position-seq") ?? "0");
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER) throw new Error("Invalid sequence");
  } catch { stop("Session storage is unavailable or invalid. Clear this session before reporting location."); return () => stop(); }
  if (!navigator.geolocation || !status.visible) {
    stop(!status.visible ? "App is hidden. Keep it visible to collect location." : "Geolocation is not supported."); return () => stop();
  }
  watcher = navigator.geolocation.watchPosition(receive, fail, { enableHighAccuracy: true, maximumAge: Infinity, timeout: 30000 });
  if (navigator.wakeLock) {
    void navigator.wakeLock.request("screen").then(async acquired => {
      if (!active) { await acquired.release(); return; }
      lock = acquired; status.wakeLock = "held"; publish();
      acquired.addEventListener("release", () => { status.wakeLock = "released"; publish("Screen wake lock released. Keep the screen on."); });
    }).catch(() => { status.wakeLock = "released"; publish("Screen wake lock is unavailable. Keep the screen on."); });
  }
  publish();
  return () => stop();
}
