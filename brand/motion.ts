import type { AnimationItem } from "lottie-web";

const container = document.querySelector<HTMLDivElement>("#animation")!;
const still = document.querySelector<SVGSVGElement>("#still")!;
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const slow = document.querySelector<HTMLInputElement>("#slow")!;
const progress = document.querySelector<HTMLInputElement>("#progress")!;
const time = document.querySelector<HTMLSpanElement>("#time")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let animation: AnimationItem | undefined;
let ready = false;
let failed = false;

function showStill(show: boolean) {
  still.toggleAttribute("hidden", !show);
  container.hidden = show;
}

function updateTime() {
  if (!animation) return;
  progress.value = String(Math.round(animation.currentFrame));
  const seconds = Math.min(animation.currentFrame + 1, animation.totalFrames) / animation.frameRate;
  time.textContent = `${seconds.toFixed(2)} s`;
  progress.setAttribute("aria-valuetext", `${seconds.toFixed(2)} seconds`);
}

function play() {
  if (!ready || reducedMotion.matches || !animation) return;
  showStill(false);
  animation.setSpeed(slow.checked ? .5 : 1);
  animation.goToAndPlay(0, true);
  status.textContent = slow.checked ? "Playing at half speed." : "Playing.";
}

function applyPreference() {
  if (!ready || !animation) return;
  animation.goToAndStop(animation.totalFrames - 1, true);
  showStill(reducedMotion.matches);
  for (const control of [replay, slow, progress]) control.disabled = reducedMotion.matches;
  status.textContent = reducedMotion.matches ? "Reduced motion: showing the finished mark." : "Finished.";
}

function fail(error: unknown) {
  if (failed) return;
  failed = true;
  ready = false;
  animation?.destroy();
  showStill(true);
  for (const control of [replay, slow, progress]) control.disabled = true;
  status.textContent = "Could not load the animation. The original mark is shown. Reload to try again.";
  console.error("Monk motion preview failed", error);
}

replay.addEventListener("click", play);
slow.addEventListener("change", () => {
  if (!animation || !ready) return;
  animation.setSpeed(slow.checked ? .5 : 1);
  if (!animation.isPaused) status.textContent = slow.checked ? "Playing at half speed." : "Playing.";
});
progress.addEventListener("input", () => {
  if (!animation || !ready || reducedMotion.matches) return;
  showStill(false);
  animation.goToAndStop(Number(progress.value), true);
  status.textContent = Number(progress.value) === animation.totalFrames - 1 ? "Finished." : "Paused.";
});
reducedMotion.addEventListener("change", applyPreference);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ready && animation && !animation.isPaused) {
    animation.pause();
    status.textContent = "Paused.";
  }
});

async function load() {
  status.textContent = "Loading animation.";
  const [{ default: lottie }, response] = await Promise.all([
    import("lottie-web"),
    fetch(new URL("./assets/monk-entrance.json", window.location.href)),
  ]);
  if (!response.ok) throw new Error(`Animation request failed: ${response.status}`);
  animation = lottie.loadAnimation({
    container, renderer: "svg", loop: false, autoplay: false,
    animationData: await response.json(),
    rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
  });
  animation.addEventListener("data_failed", fail);
  animation.addEventListener("error", fail);
  animation.addEventListener("enterFrame", updateTime);
  animation.addEventListener("complete", () => {
    updateTime();
    status.textContent = "Finished.";
  });
  animation.addEventListener("DOMLoaded", () => {
    if (failed || !animation) return;
    ready = true;
    progress.max = String(animation.totalFrames - 1);
    applyPreference();
    if (!reducedMotion.matches) play();
  });
}

void load().catch(fail);
