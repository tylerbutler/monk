import type { LocationStatus, PositionReport } from "../shared/protocol";

export function startLocation(onFix: (fix: PositionReport) => void, onStatus: (status: LocationStatus) => void): () => void {
  let active = true, pending = false, watcher: number | null = null;
  let lock: WakeLockSentinel | null = null;
  let wall = Date.now(), mono = performance.now(), lastReceiptMs = wall;
  let sequence = 0, lastCaptureMs = -1;
  const status: LocationStatus = {
    collecting: true, permission: "unknown", visible: document.visibilityState === "visible",
    wakeLock: navigator.wakeLock ? "pending" : "unsupported", reason: null,
  };
  function publish(reason: string | null = null) { status.reason = reason; onStatus({ ...status }); }
  function stop(reason: string | null = null) {
    if (!active) return;
    active = false; status.collecting = false;
    if (watcher !== null) navigator.geolocation.clearWatch(watcher);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", visibility);
    if (lock && !lock.released) void lock.release().catch(() => publish("Screen wake lock could not be released."));
    publish(reason);
  }
  function clockValid(): boolean {
    const now = Date.now(), elapsed = performance.now() - mono;
    if (Math.abs((now - wall) - elapsed) > 100) { stop("Phone clock changed. Wait for a new clock check."); return false; }
    wall = now; mono = performance.now();
    return true;
  }
  function receive(position: GeolocationPosition) {
    if (!active || document.visibilityState !== "visible" || !clockValid()) return;
    pending = false;
    if (!Number.isSafeInteger(position.timestamp) || position.timestamp <= lastCaptureMs ||
      position.timestamp > Date.now() || Date.now() - position.timestamp >= 5000) {
      publish("Location is cached or stale. Wait for a new fix."); return;
    }
    const { latitude, longitude, accuracy } = position.coords;
    if (![latitude, longitude, accuracy].every(Number.isFinite) || latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180 || accuracy <= 0) {
      publish("Location values are invalid. Wait for a new fix."); return;
    }
    try {
      sequence += 1; lastCaptureMs = position.timestamp;
      sessionStorage.setItem("monk-position-seq", String(sequence));
      sessionStorage.setItem("monk-last-capture", String(lastCaptureMs));
    } catch { stop("Session storage is unavailable. Allow storage before reporting location."); return; }
    lastReceiptMs = Date.now(); status.permission = "granted"; publish();
    onFix({ seq: sequence, capturedAtMs: position.timestamp, latitude, longitude, accuracyM: accuracy });
  }
  function fail(error: GeolocationPositionError) {
    if (!active) return;
    pending = false;
    if (error.code === 1) {
      status.permission = "denied"; stop("Location permission denied. Allow location in browser settings."); return;
    }
    publish(error.code === 3 ? "Location request timed out. Move to a clear outdoor area." :
      "Location is unavailable. Check device location settings.");
  }
  function visibility() {
    status.visible = document.visibilityState === "visible";
    if (!status.visible) stop("App is hidden. Location collection is stopped.");
  }
  const interval = setInterval(() => {
    if (!active || !clockValid() || document.visibilityState !== "visible") return;
    if (!pending && Date.now() - lastReceiptMs >= 1000) {
      pending = true;
      navigator.geolocation.getCurrentPosition(receive, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
    }
  }, 1000);
  document.addEventListener("visibilitychange", visibility);
  try {
    sequence = Number(sessionStorage.getItem("monk-position-seq") ?? "0");
    lastCaptureMs = Number(sessionStorage.getItem("monk-last-capture") ?? "-1");
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(lastCaptureMs)) throw new Error("Invalid sequence");
  } catch { stop("Session storage is unavailable or invalid. Clear this session before reporting location."); return () => stop(); }
  if (!navigator.geolocation || !status.visible) {
    stop(!status.visible ? "App is hidden. Keep it visible to collect location." : "Geolocation is not supported."); return () => stop();
  }
  watcher = navigator.geolocation.watchPosition(receive, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
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
