import type { AnimationItem } from "lottie-web";

const container = document.querySelector<HTMLDivElement>("#animation")!;
const still = document.querySelector<SVGSVGElement>("#still")!;
const stillImage = still.querySelector<SVGImageElement>("image")!;
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const slow = document.querySelector<HTMLInputElement>("#slow")!;
const progress = document.querySelector<HTMLInputElement>("#progress")!;
const time = document.querySelector<HTMLSpanElement>("#time")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const treatment = document.querySelector<HTMLSelectElement>("#treatment")!;
const description = document.querySelector<HTMLParagraphElement>("#treatment-description")!;
const timing = document.querySelector<HTMLParagraphElement>("#timing")!;
const download = document.querySelector<HTMLAnchorElement>("#download")!;
const lead = document.querySelector<HTMLSpanElement>("#lead")!;
const stage = document.querySelector<HTMLDivElement>("#stage")!;
const format = document.querySelector<HTMLParagraphElement>("#format")!;
const treatments = [
  {
    id: "stops", file: "monk-entrance.json", loop: false,
    lead: "Yellow leads. Red follows. Blue brings it home.",
    label: "Monk arches painted in yellow, then red and blue",
    description: "All colors start on the left. Red stops after the first arch; blue continues through the second and clears its first-arch trail.",
    timing: "3.3-second entrance + a 0.4-second hold.",
  },
  {
    id: "all-arches", file: "monk-entrance-all-arches.json", loop: false,
    lead: "Yellow leads. Blue follows. Red brings it home.",
    label: "Monk arches painted in yellow, then blue and red",
    description: "Yellow, blue, and red each paint both arches at four times the original speed. After red finishes, its second-arch trail clears to reveal blue.",
    timing: "1.175-second entrance + a 0.1-second hold.",
  },
  {
    id: "loading", file: "monk-loading.json", loop: true,
    lead: "Yellow, blue, red. Keep it moving.",
    label: "Monk arches cycling through yellow, blue, and red",
    description: "Each color rises fast, slows at the peak, then accelerates down. Yellow, blue, and red repeat through a fully visible m without a final hold.",
    timing: "2.1-second loading loop.",
  },
  {
    id: "realistic", file: "monk-entrance-realistic.json", loop: false,
    lead: "Yellow leads. Blue follows. Red brings it home.",
    label: "Monk arches painted in yellow, then blue and red",
    description: "Each bounce launches fast, slows at the peak, then accelerates down. Yellow, blue, and red paint both arches before red clears to reveal blue.",
    timing: "3.4-second entrance + a 0.3-second hold.",
  },
  {
    id: "wordmark", file: "monk-entrance-wordmark.json", loop: false,
    lead: "Paint the m. Make room for Monk.",
    label: "Monk wordmark with a red and blue m and ink onk",
    description: "Realistic bounce paints the m. It slides left and scales down, then o, n, and k appear in ink, using the original wordmark shapes.",
    timing: "3.7-second bounce + a 1-second wordmark reveal + a 0.8-second hold.",
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
  const display = seconds.toFixed(animation.frameRate > 60 ? 3 : 2);
  time.textContent = `${display} s`;
  progress.setAttribute("aria-valuetext", `${display} seconds`);
}

function playbackStatus() {
  const action = animation?.loop === true ? "Looping" : "Playing";
  return slow.checked ? `${action} at half speed.` : `${action}.`;
}

function play() {
  if (!ready || reducedMotion.matches || !animation) return;
  if (document.hidden) {
    animation.pause();
    status.textContent = "Paused.";
    return;
  }
  showStill(false);
  animation.setSpeed(slow.checked ? .5 : 1);
  animation.goToAndPlay(0, true);
  status.textContent = playbackStatus();
}

function applyPreference() {
  if (!ready || !animation) return;
  animation.goToAndStop(animation.totalFrames - 1, true);
  showStill(reducedMotion.matches);
  for (const control of [replay, slow, progress]) control.disabled = reducedMotion.matches;
  status.textContent = reducedMotion.matches ? "Reduced motion: showing the finished mark."
    : animation.loop === true ? "Paused." : "Finished.";
}

function fail(error: unknown) {
  if (failed) return;
  failed = true;
  ready = false;
  animation?.destroy();
  showStill(true);
  for (const control of [replay, slow, progress]) control.disabled = true;
  status.textContent = "Could not load the animation. The static mark is shown. Reload to try again.";
  console.error("Monk motion preview failed", error);
}

replay.addEventListener("click", play);
slow.addEventListener("change", () => {
  if (!animation || !ready) return;
  animation.setSpeed(slow.checked ? .5 : 1);
  if (!animation.isPaused) status.textContent = playbackStatus();
});
progress.addEventListener("input", () => {
  if (!animation || !ready || reducedMotion.matches) return;
  showStill(false);
  animation.goToAndStop(Number(progress.value), true);
  status.textContent = animation.loop !== true && Number(progress.value) === animation.totalFrames - 1
    ? "Finished." : "Paused.";
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
    lead.textContent = selected.lead;
    stage.setAttribute("aria-label", selected.label);
    const scale = 240 / 522;
    const fallback = selected.id === "wordmark"
      ? { file: "wordmark-paired.svg", x: 20, y: 110 - 80 * scale, width: 240, height: 160 * scale }
      : { file: "symbol-paired.svg", x: 70, y: 50, width: 140, height: 120 };
    stillImage.setAttribute("href", `./assets/${fallback.file}`);
    for (const attribute of ["x", "y", "width", "height"] as const) {
      stillImage.setAttribute(attribute, String(fallback[attribute]));
    }
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
      container, renderer: "svg", loop: selected.loop, autoplay: false,
      animationData,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    animation = current;
    format.textContent = `Vector Lottie / ${current.frameRate} fps / transparent background`;
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
