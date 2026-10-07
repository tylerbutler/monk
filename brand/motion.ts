import type { AnimationItem } from "lottie-web";

const container = document.querySelector<HTMLDivElement>("#animation")!;
const still = document.querySelector<SVGSVGElement>("#still")!;
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const slow = document.querySelector<HTMLInputElement>("#slow")!;
const progress = document.querySelector<HTMLInputElement>("#progress")!;
const time = document.querySelector<HTMLSpanElement>("#time")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const treatment = document.querySelector<HTMLSelectElement>("#treatment")!;
const description = document.querySelector<HTMLParagraphElement>("#treatment-description")!;
const timing = document.querySelector<HTMLParagraphElement>("#timing")!;
const download = document.querySelector<HTMLAnchorElement>("#download")!;
const treatments = [
  {
    id: "stops", file: "monk-entrance.json",
    description: "All colors start on the left. Red stops after the first arch; blue continues through the second and clears its first-arch trail.",
    timing: "3.3-second entrance + a 0.4-second hold.",
  },
  {
    id: "all-arches", file: "monk-entrance-all-arches.json",
    description: "Yellow, red, and blue each paint both arches. After blue finishes, its first-arch trail clears to reveal red.",
    timing: "4.7-second entrance + a 0.4-second hold.",
  },
];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let animation: AnimationItem | undefined;
let ready = false;
let failed = false;
let loadVersion = 0;

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
  const version = ++loadVersion;
  ready = false;
  failed = false;
  animation?.destroy();
  animation = undefined;
  showStill(true);
  for (const control of [replay, slow, progress]) control.disabled = true;
  status.textContent = "Loading animation.";
  try {
    const selected = treatments.find(item => item.id === treatment.value);
    if (!selected) throw new Error(`Unknown animation treatment: ${treatment.value}`);
    description.textContent = selected.description;
    timing.textContent = selected.timing;
    download.href = new URL(`./assets/${selected.file}`, window.location.href).href;
    download.download = selected.file;
    const [{ default: lottie }, response] = await Promise.all([
      import("lottie-web"),
      fetch(download.href),
    ]);
    if (!response.ok) throw new Error(`Animation request failed: ${response.status}`);
    const animationData: unknown = await response.json();
    if (version !== loadVersion) return;
    const current = lottie.loadAnimation({
      container, renderer: "svg", loop: false, autoplay: false,
      animationData,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    animation = current;
    const onError = (error: unknown) => {
      if (current === animation) fail(error);
    };
    current.addEventListener("data_failed", onError);
    current.addEventListener("error", onError);
    current.addEventListener("enterFrame", () => {
      if (current === animation) updateTime();
    });
    current.addEventListener("complete", () => {
      if (current !== animation) return;
      updateTime();
      status.textContent = "Finished.";
    });
    current.addEventListener("DOMLoaded", () => {
      if (failed || current !== animation) return;
      ready = true;
      progress.max = String(current.totalFrames - 1);
      applyPreference();
      if (!reducedMotion.matches) play();
    });
  } catch (error) {
    if (version === loadVersion) fail(error);
  }
}

treatment.disabled = false;
treatment.addEventListener("change", () => { void load(); });
void load();
