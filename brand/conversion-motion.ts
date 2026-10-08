import { names, symbols, targets } from "../src/client/views";
import type { Faction } from "../src/shared/protocol";

type Scene = "self" | "other" | "stopped";

const screen = document.querySelector<HTMLDivElement>("#game-screen")!;
const faction = document.querySelector<HTMLSelectElement>("#faction")!;
const timeline = document.querySelector<HTMLInputElement>("#timeline")!;
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const stampReplay = document.querySelector<HTMLButtonElement>("#stamp-replay")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const slow = document.querySelector<HTMLInputElement>("#slow")!;
const reduced = document.querySelector<HTMLInputElement>("#reduced")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const time = document.querySelector<HTMLOutputElement>("#time")!;
const ownName = document.querySelector<HTMLHeadingElement>("#own-name")!;
const ownIcon = document.querySelector<HTMLImageElement>("#own-icon")!;
const selfMarkerName = document.querySelector<HTMLElement>("#self-marker-name")!;
const selfMarkerIcon = document.querySelector<HTMLImageElement>("#self-marker-icon")!;
const target = document.querySelector<HTMLDivElement>("#target-marker")!;
const targetName = document.querySelector<HTMLElement>("#target-name")!;
const targetIcon = document.querySelector<HTMLImageElement>("#target-icon")!;
const targetStamp = document.querySelector<HTMLDivElement>("#target-stamp")!;
const targetStampIcon = document.querySelector<HTMLImageElement>("#target-stamp-icon")!;
const ownRing = document.querySelector<SVGSVGElement>("#own-ring")!;
const targetRing = document.querySelector<SVGSVGElement>("#target-ring")!;
const link = document.querySelector<SVGLineElement>("#radar-link")!;
const arrow = document.querySelector<SVGPathElement>("#radar-arrow")!;
const signal = document.querySelector<SVGCircleElement>("#signal")!;
const influence = document.querySelector<HTMLDivElement>("#influence")!;
const heading = document.querySelector<HTMLHeadingElement>("#conversion-heading")!;
const conversionState = document.querySelector<HTMLElement>("#conversion-state")!;
const percent = document.querySelector<HTMLSpanElement>("#percent")!;
const progress = document.querySelector<HTMLDivElement>("#progress")!;
const fill = document.querySelector<HTMLDivElement>("#progress-fill")!;
const tip = document.querySelector<HTMLDivElement>("#progress-tip")!;
const guidance = document.querySelector<HTMLParagraphElement>("#guidance")!;
const result = document.querySelector<HTMLDivElement>("#result-message")!;
const resultTitle = document.querySelector<HTMLElement>("#result-title")!;
const resultDetail = document.querySelector<HTMLParagraphElement>("#result-detail")!;
const resultIcon = document.querySelector<HTMLImageElement>("#result-icon")!;
const takeover = document.querySelector<HTMLDivElement>("#takeover")!;
const bubble = document.querySelector<HTMLDivElement>("#bubble")!;
const stamp = document.querySelector<HTMLDivElement>("#faction-stamp")!;
const stampIcon = document.querySelector<HTMLImageElement>("#stamp-icon")!;
const impactRing = document.querySelector<HTMLDivElement>("#impact-ring")!;
const revealCopy = document.querySelector<HTMLDivElement>("#reveal-copy")!;
const revealName = document.querySelector<HTMLHeadingElement>("#reveal-name")!;
const holdCountdown = document.querySelector<HTMLDivElement>("#hold-countdown")!;
const countdownNumber = document.querySelector<HTMLSpanElement>("#countdown-number")!;
const countdownRing = document.querySelector<SVGCircleElement>("#countdown-ring")!;
const sceneTitle = document.querySelector<HTMLHeadingElement>("#scene-title")!;
const sceneDescription = document.querySelector<HTMLParagraphElement>("#scene-description")!;
const sceneTiming = document.querySelector<HTMLSpanElement>("#scene-timing")!;
const sceneButtons = document.querySelectorAll<HTMLButtonElement>("[data-scene]");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const descriptions = {
  self: ["The change takes over.", "A central bubble fills the screen in your new faction color. The hand stamps into place, with one short impact ring.",
    "480 ms bubble / 160 ms stamp / 3 s hold / 320 ms exit."],
  other: ["A new player on your side.", "A pulse travels to Alex. Your hand stamps onto their marker, and the confirmation stays below the radar.",
    "360 ms radar pulse / 160 ms marker stamp."],
  stopped: ["The conversion breaks.", "Alex moves out of range before the timer finishes. Their ring cracks into dashes, then expands and fades. Neither faction changes.",
    "120 ms crack / 530 ms expansion and fade. No success stamp."],
};
const dwellMs = 5000, confirmedAt = 5200, stampAt = 5680;
const holdAt = stampAt + 160, holdMs = 3000, exitAt = holdAt + holdMs, endMs = exitAt + 320;
const stoppedAt = 3000, failureMs = 650;
let scene: Scene = "self";
let sceneEndMs = endMs;
let nextFaction: Faction = "paper";
let position = 2900;
let playing = false;
let frame = 0;
let lastFrame = 0;
let effects: { animation: Animation; element: Element; start: number }[] = [];

function animate(element: Element, keyframes: Keyframe[], start: number, duration: number, easing = "linear") {
  const animation = element.animate(keyframes, { duration, easing, fill: "both" });
  animation.pause();
  effects.push({ animation, element, start });
}

function buildEffects() {
  for (const { animation } of effects) animation.cancel();
  effects = [];
  const gentler = preference.matches || reduced.checked;
  screen.dataset.reducedMotion = String(gentler);
  animate(bubble, gentler ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: "scale(0)" }, { transform: "scale(1)" }],
  confirmedAt, gentler ? 120 : 480, "cubic-bezier(.16, 1, .3, 1)");
  const stampFrames: Keyframe[] = gentler ? [{ opacity: 0 }, { opacity: 1 }] : [
    { transform: "scale(1.4) rotate(-9deg)", opacity: 0 },
    { offset: .12, opacity: 1 },
    { transform: "scale(1) rotate(0deg)", opacity: 1 },
  ];
  animate(stamp, stampFrames, stampAt, gentler ? 120 : 160, "cubic-bezier(.16, 1, .3, 1)");
  animate(targetStamp, stampFrames, stampAt, gentler ? 120 : 160, "cubic-bezier(.16, 1, .3, 1)");
  animate(impactRing, [{ transform: "scale(.75)", opacity: .5 }, { transform: "scale(1.4)", opacity: 0 }], stampAt + 60, 400);
  animate(revealCopy, [{ opacity: 0 }, { opacity: 1 }], stampAt + 120, 140);
  animate(takeover, [{ opacity: 1 }, { opacity: 0 }], exitAt, 320);
  animate(signal, [{ transform: "translate(0, 0)", opacity: 1 }, { transform: "translate(72px, -66px)", opacity: 1 }], confirmedAt, 360, "cubic-bezier(.16, 1, .3, 1)");
  animate(result, [{ opacity: 0 }, { opacity: 1 }], stampAt, gentler ? 120 : 160);
  if (scene === "stopped") {
    const failureFrames: Keyframe[] = [
      { opacity: 1 },
      { opacity: 1, offset: 120 / failureMs, easing: "cubic-bezier(.16, 1, .3, 1)" },
      { opacity: 0 },
    ];
    if (!gentler) {
      failureFrames[0].transform = failureFrames[1].transform = "scale(1)";
      failureFrames[2].transform = "scale(1.75)";
    }
    animate(targetRing, failureFrames, stoppedAt, failureMs);
  }
  animate(tip, gentler ? [{ opacity: 1 }, { opacity: 1 }]
    : [{ opacity: .45, transform: "scale(.8)" }, { opacity: 1, transform: "scale(1.15)" }, { opacity: .45, transform: "scale(.8)" }],
  0, 1100);
}

function render() {
  const gentler = preference.matches || reduced.checked;
  const outgoing = scene !== "self";
  const stopped = scene === "stopped" && position >= stoppedAt;
  const confirmed = scene !== "stopped" && position >= confirmedAt;
  const stamped = confirmed && position >= stampAt;
  const ownFaction = outgoing || stamped ? nextFaction : targets[nextFaction];
  const targetFaction = outgoing && !stamped ? targets[nextFaction] : nextFaction;
  const fraction = stopped ? 0 : Math.min(position / dwellMs, 1);
  const percentage = Math.round(fraction * 100);
  for (const { animation, element, start } of effects) {
    animation.currentTime = element === tip ? position % 1100 : position - start;
  }
  screen.dataset.faction = ownFaction;
  screen.style.setProperty("--current", `var(--faction-${ownFaction})`);
  screen.style.setProperty("--result", `var(--faction-${nextFaction})`);
  ownName.textContent = selfMarkerName.textContent = names[ownFaction];
  ownIcon.src = selfMarkerIcon.src = symbols[ownFaction];
  target.dataset.faction = targetFaction;
  target.style.setProperty("--marker-color", `var(--faction-${targetFaction})`);
  targetName.textContent = names[targetFaction];
  targetIcon.src = symbols[targetFaction];
  stampIcon.src = targetStampIcon.src = resultIcon.src = symbols[nextFaction];
  revealName.textContent = names[nextFaction];
  heading.textContent = outgoing ? "You are converting Alex" : "You are being converted by Alex";
  conversionState.textContent = stopped ? "Conversion stopped" : position >= dwellMs ? "Confirming..."
    : `${Math.ceil((dwellMs - position) / 1000)} s left`;
  percent.textContent = `${percentage}%`;
  progress.setAttribute("aria-valuenow", String(percentage));
  progress.setAttribute("aria-valuetext", conversionState.textContent);
  fill.style.transform = `scaleX(${fraction})`;
  tip.style.left = `${percentage}%`;
  tip.hidden = stopped || confirmed || gentler;
  guidance.textContent = stopped ? "Alex moved out of range. Your faction has not changed."
    : outgoing ? "Stay in range until confirmed." : "Move out of range to stop conversion.";
  influence.hidden = stamped;
  result.hidden = !stamped;
  const message = scene === "other" ? `Alex joined ${names[nextFaction]}` : `You are now ${names[nextFaction]}`;
  if (resultTitle.textContent !== message) {
    resultTitle.textContent = message;
    resultDetail.textContent = scene === "other" ? "Conversion confirmed. Keep playing." : "New side. New targets. Keep playing.";
  }
  takeover.hidden = scene !== "self" || !confirmed || position >= endMs;
  holdCountdown.hidden = scene !== "self" || position < holdAt || position >= exitAt;
  const holdElapsed = Math.max(0, Math.min(holdMs, position - holdAt));
  countdownNumber.textContent = String(Math.ceil((holdMs - holdElapsed) / 1000));
  countdownRing.setAttribute("stroke-dashoffset", String(gentler ? 0 : holdElapsed / holdMs * 100));
  targetStamp.hidden = scene !== "other" || !stamped;
  impactRing.hidden = gentler || scene !== "self" || position < stampAt + 60 || position >= stampAt + 460;
  signal.toggleAttribute("hidden", gentler || scene !== "other" || !confirmed || position >= confirmedAt + 360);
  ownRing.toggleAttribute("hidden", outgoing || stopped || confirmed);
  targetRing.toggleAttribute("hidden", !outgoing || confirmed || (stopped && position >= stoppedAt + failureMs));
  for (const ring of [ownRing, targetRing]) {
    ring.querySelector("circle")!.setAttribute("stroke-dasharray", stopped && ring === targetRing ? "3 3" : `${percentage} 100`);
  }
  link.toggleAttribute("hidden", stopped || confirmed);
  arrow.toggleAttribute("hidden", stopped || confirmed);
  arrow.setAttribute("d", outgoing ? "M192 106l-12 3 3 10z" : "M180 117l12 -3 -3 -10z");
  timeline.value = String(position);
  const seconds = `${(position / 1000).toFixed(2)} s`;
  time.value = seconds;
  timeline.setAttribute("aria-valuetext", `${seconds}. ${stopped ? "Conversion stopped" : stamped ? resultTitle.textContent : confirmed ? "Faction reveal" : conversionState.textContent}`);
  pauseButton.disabled = !playing;
}

function pause() {
  playing = false;
  cancelAnimationFrame(frame);
  pauseButton.disabled = true;
}

function tick(now: number) {
  position = Math.min(sceneEndMs, position + (now - lastFrame) * (slow.checked ? .5 : 1));
  lastFrame = now;
  render();
  if (position >= sceneEndMs) {
    pause();
    status.textContent = scene === "stopped" ? "Finished. Conversion stopped; no faction change."
      : `Finished. ${resultTitle.textContent}.`;
    return;
  }
  frame = requestAnimationFrame(tick);
}

function play(from: number) {
  pause();
  if (document.hidden) {
    status.textContent = "Preview paused while this tab is hidden.";
    return;
  }
  const bounds = screen.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > innerHeight) {
    screen.scrollIntoView({ block: "start", behavior: "instant" });
  }
  position = from;
  playing = true;
  lastFrame = performance.now();
  status.textContent = `Playing${slow.checked ? " at half speed" : ""}${preference.matches || reduced.checked ? " with reduced motion" : ""}.`;
  render();
  frame = requestAnimationFrame(tick);
}

function selectScene() {
  pause();
  position = 2900;
  sceneEndMs = scene === "self" ? endMs : 6500;
  timeline.max = String(sceneEndMs);
  for (const button of sceneButtons) button.setAttribute("aria-pressed", String(button.dataset.scene === scene));
  [sceneTitle.textContent, sceneDescription.textContent, sceneTiming.textContent] = descriptions[scene];
  stampReplay.textContent = scene === "stopped" ? "Play interruption" : "Play stamp";
  buildEffects();
  render();
  status.textContent = "Ready. Replay the sequence or drag the timeline to inspect the motion.";
}

for (const button of sceneButtons) {
  button.addEventListener("click", () => {
    const selected = button.dataset.scene;
    if (selected !== "self" && selected !== "other" && selected !== "stopped") throw new Error(`Unknown preview scene: ${selected}`);
    scene = selected;
    selectScene();
  });
}
faction.addEventListener("change", () => {
  const selected = faction.value;
  if (selected !== "rock" && selected !== "paper" && selected !== "scissors") throw new Error(`Unknown preview faction: ${selected}`);
  nextFaction = selected;
  selectScene();
});
replay.addEventListener("click", () => play(0));
stampReplay.addEventListener("click", () => play(scene === "stopped" ? 2800 : confirmedAt));
pauseButton.addEventListener("click", () => {
  pause();
  status.textContent = "Paused. Drag the timeline or replay.";
});
timeline.addEventListener("input", () => {
  pause();
  position = Number(timeline.value);
  render();
  status.textContent = `Paused at ${(position / 1000).toFixed(2)} seconds.`;
});
reduced.addEventListener("change", () => {
  buildEffects();
  render();
  status.textContent = reduced.checked ? "Reduced motion: short fades replace expansion, travel, and impact." : "Full motion enabled.";
});
function applyPreference() {
  if (preference.matches) reduced.checked = true;
  reduced.disabled = preference.matches;
  buildEffects();
  render();
  status.textContent = preference.matches ? "System reduced motion is on. Results use short fades without expansion or impact." : "Ready. Replay the sequence or drag the timeline.";
}
preference.addEventListener("change", applyPreference);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    pause();
    status.textContent = "Preview paused while this tab is hidden.";
  }
});
window.addEventListener("pagehide", () => {
  pause();
  for (const { animation } of effects) animation.cancel();
});
for (const control of [faction, timeline, replay, stampReplay, slow, reduced, ...sceneButtons]) control.disabled = false;
selectScene();
applyPreference();
