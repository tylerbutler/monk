export type CompassState = { enabled: boolean; headingDegrees: number | null; reason: string | null };
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
type OrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<"granted" | "denied">;
};
const normalize = (degrees: number) => (degrees % 360 + 360) % 360;

function screenAngle(): number {
  const angle = screen.orientation?.angle;
  if (typeof angle === "number" && Number.isFinite(angle)) return angle;
  return "orientation" in window && typeof window.orientation === "number" && Number.isFinite(window.orientation) ?
    window.orientation : 0;
}
function headingFor(event: CompassEvent): number | null {
  const angle = screenAngle();
  if (event.webkitCompassHeading !== undefined) {
    const heading = event.webkitCompassHeading, accuracy = event.webkitCompassAccuracy;
    if (!Number.isFinite(heading) || heading < 0 || heading >= 360 ||
      accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 30)) return null;
    return normalize(heading + angle);
  }
  const { alpha, beta, gamma } = event;
  if (!event.absolute || alpha === null || beta === null || gamma === null ||
    !Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma) ||
    alpha < 0 || alpha >= 360 || Math.abs(beta) > 180 || Math.abs(gamma) > 90) return null;
  const a = alpha * Math.PI / 180, b = beta * Math.PI / 180, g = gamma * Math.PI / 180;
  const s = angle * Math.PI / 180;
  // Project the screen's top edge into Earth's horizontal plane using Z-X-Y rotation.
  const east = (Math.cos(a) * Math.cos(g) - Math.sin(a) * Math.sin(b) * Math.sin(g)) * Math.sin(s) -
    Math.sin(a) * Math.cos(b) * Math.cos(s);
  const north = (Math.sin(a) * Math.cos(g) + Math.cos(a) * Math.sin(b) * Math.sin(g)) * Math.sin(s) +
    Math.cos(a) * Math.cos(b) * Math.cos(s);
  if (Math.hypot(east, north) < .1) return null;
  return normalize(Math.atan2(east, north) * 180 / Math.PI);
}

export function startCompass(onUpdate: (state: CompassState) => void): () => void {
  let active = true, heading: number | null = null, sample: CompassEvent | null = null;
  let sampleAt = 0, timer: ReturnType<typeof setTimeout> | null = null;
  const orientation = screen.orientation;
  const constructor: OrientationConstructor | undefined =
    typeof DeviceOrientationEvent === "undefined" ? undefined : DeviceOrientationEvent;
  function publish(reason: string | null) { onUpdate({ enabled: active, headingDegrees: heading, reason }); }
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function stop(reason: string | null = null) {
    if (!active) return;
    active = false; heading = null; sample = null; clearTimer();
    window.removeEventListener("deviceorientation", receive);
    window.removeEventListener("deviceorientationabsolute", receive);
    window.removeEventListener("orientationchange", reorient);
    orientation?.removeEventListener("change", reorient);
    document.removeEventListener("visibilitychange", visibility);
    publish(reason);
  }
  function expire() {
    clearTimer();
    timer = setTimeout(() => {
      timer = null; heading = null; sample = null;
      publish("Compass readings stopped. Radar is north-up.");
    }, 3000);
  }
  function receive(event: CompassEvent) {
    if (!active || document.visibilityState !== "visible") return;
    if (event.webkitCompassHeading === undefined && !event.absolute) return;
    const next = headingFor(event), now = performance.now();
    if (next === null) {
      heading = null; sample = null; clearTimer();
      publish("Compass reading is unreliable. Radar is north-up."); return;
    }
    const difference = heading === null ? 0 : normalize(next - heading + 180) - 180;
    heading = heading === null ? next : normalize(heading + difference * (1 - Math.exp(-Math.max(0, now - sampleAt) / 150)));
    sample = event; sampleAt = now; expire(); publish(null);
  }
  function reorient() {
    if (!active || !sample) return;
    heading = headingFor(sample);
    publish(heading === null ? "Compass reading is unreliable. Radar is north-up." : null);
  }
  function visibility() {
    if (document.visibilityState !== "visible") stop("App is hidden. Compass stopped. Radar is north-up.");
  }
  function listen() {
    if (!active) return;
    window.addEventListener("deviceorientation", receive);
    window.addEventListener("deviceorientationabsolute", receive);
    window.addEventListener("orientationchange", reorient);
    orientation?.addEventListener("change", reorient);
    expire(); publish("Waiting for compass. Radar is north-up.");
  }
  if (!window.isSecureContext) stop("Compass access needs HTTPS. Radar is north-up.");
  else if (!constructor) stop("Compass is not supported by this browser. Radar is north-up.");
  else if (document.visibilityState !== "visible") visibility();
  else {
    document.addEventListener("visibilitychange", visibility);
    const request = constructor.requestPermission;
    if (request) {
      publish("Requesting compass access. Radar is north-up.");
      void (async () => {
        try {
          const permission = await request.call(constructor, true);
          if (!active) return;
          if (permission === "granted") listen();
          else stop("Compass permission denied. Radar is north-up.");
        } catch (failure) {
          if (active) stop(`Compass access failed: ${failure instanceof Error ? failure.message : "Sensor access was blocked"}. Radar is north-up.`);
        }
      })();
    } else listen();
  }
  return () => stop();
}
