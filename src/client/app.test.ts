// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountApp } from "./app";
import { describeEvent, renderMatch } from "./views";
import type { MatchActions } from "./views";
import { snapshotFor } from "../worker/engine";
import { command, lobbyFixture, pulse, runningFixture } from "../../test/fixtures";
import type { EngineEvent, ServerMessage, TrialSample, TrialStatus } from "../shared/protocol";

const actions: MatchActions = {
  start: vi.fn(), pause: vi.fn(), beginResume: vi.fn(), cancelResume: vi.fn(), end: vi.fn(),
  configure: vi.fn(), setFaction: vi.fn(), leave: vi.fn(),
};

it("explains location use and offers private creation and joining without collecting", () => {
  sessionStorage.clear();
  const root = document.createElement("main");
  document.body.append(root);
  const cleanup = mountApp(root);
  expect(root.textContent).toContain("Location");
  expect(root.querySelector('[data-action="create"]')).not.toBeNull();
  expect(root.querySelector('input[name="matchCode"]')).not.toBeNull();
  expect(root.textContent).toContain("bounded outdoor area");
  cleanup(); root.remove();
});

it("shows testing mode and host-only faction controls, without a coordinate map", () => {
  const root = document.createElement("section");
  const playerTestSnapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const hostTestSnapshot = { ...playerTestSnapshot, canHost: true };
  renderMatch(root, hostTestSnapshot, actions);
  expect(root.textContent).toContain("Testing mode");
  expect(root.querySelector('[data-action="set-faction"]')).not.toBeNull();
  renderMatch(root, playerTestSnapshot, actions);
  expect(root.querySelector('[data-action="set-faction"]')).toBeNull();
  expect(root.textContent).toContain("Rock");
  expect(root.querySelector('[data-faction-symbol="rock"]')).not.toBeNull();
  expect(root.querySelector('[data-map]')).toBeNull();
  expect(root.textContent).not.toMatch(/latitude|longitude/);
});
it("freezes the paused clock and grace, shows checks as paused, and freezes settings", () => {
  const root = document.createElement("section");
  const changed = command(runningFixture(["rock", "paper"]), 0, { type: "set_faction", playerId: "p1", faction: "scissors" }).state;
  const paused = command(changed, 500, { type: "pause" }).state;
  const checking = command(paused, 10000, { type: "begin_resume" }).state;
  renderMatch(root, { ...snapshotFor(checking, "p1", 10000), canHost: true }, actions);
  expect(root.textContent).toContain("Paused");
  expect(root.textContent).toContain("Freshness check");
  expect(root.querySelector('[data-action="configure"]')).toBeNull();
  expect(root.querySelector('[data-action="cancel-resume"]')).not.toBeNull();
});
it("defaults the lobby to testing mode, leaves location parameters blank, and disables redundant factions", () => {
  const root = document.createElement("section");
  renderMatch(root, { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true }, actions);
  expect(root.querySelector<HTMLInputElement>('input[name="testingMode"]')?.checked).toBe(true);
  expect(root.textContent).toContain("Uncalibrated");
  expect(root.querySelector<HTMLOptionElement>('select[data-action="set-faction"] option[value="rock"]')?.disabled).toBe(true);
});
it("shows outgoing and incoming attack progress", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  expect(root.textContent).toContain("Outgoing attack");
  expect(root.querySelector("progress")?.value).toBeCloseTo(1 / 6);
  renderMatch(root, snapshotFor(state, "p2", 500), actions);
  expect(root.textContent).toContain("Incoming attack");
});

it("distinguishes conversions, host changes, attack starts, and interruption reasons", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const base: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2",
    faction: "rock", reason: null, hostId: null, oldFaction: null, eventSeq: 1, atMs: 0 };
  expect(describeEvent(base, snapshot)).toContain("converted");
  expect(describeEvent({ ...base, type: "manual_faction_change", oldFaction: "scissors" }, snapshot)).toContain("Host changed");
  expect(describeEvent({ ...base, type: "attack_started" }, snapshot)).toContain("Attack started");
  expect(describeEvent({ ...base, type: "attack_interrupted", reason: "Location is stale or unavailable." }, snapshot)).toContain("Location is stale");
});

function browserApp(snapshot: ReturnType<typeof snapshotFor>) {
  let socket: Socket;
  const sockets: Socket[] = [];
  const frames: string[] = [], raf: FrameRequestCallback[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    constructor() { super(); socket = this; sockets.push(this); }
    send(frame: string) { frames.push(frame); }
    close() { this.readyState = 3; }
    receive(message: ServerMessage) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { raf.push(callback); return raf.length; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(16, 20, 300, 60));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  sessionStorage.clear();
  sessionStorage.setItem("monk-session", JSON.stringify({
    matchCode: "ABCDEFGH", hostToken: snapshot.canHost ? "h".repeat(64) : null, playerToken: "p".repeat(64),
  }));
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  function authenticate(current: Socket, streamId = "app-stream") {
    current.readyState = 1; current.dispatchEvent(new Event("open"));
    current.receive({ version: 1, type: "authenticated", streamId, streamSeq: 1,
      playerId: "p1", canHost: snapshot.canHost, expiresAtMs: Date.now() + 86400000 });
    current.receive({ version: 1, type: "snapshot", streamId, streamSeq: 2,
      snapshot, trial: null, startChecking: false });
    const probe = JSON.parse([...frames].reverse().find(f => JSON.parse(f).type === "clock_probe") ?? "{}");
    current.receive({ version: 1, type: "clock_reply", streamId, streamSeq: 3,
      nonce: probe.nonce, clientSendMs: probe.clientSendMs, serverReceiveMs: Date.now(), serverSendMs: Date.now() });
    current.receive({ version: 1, type: "clock_ready", streamId, streamSeq: 4,
      clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  }
  const current = socket!;
  authenticate(current);
  return { root, socket: current, sockets, frames, raf, authenticate, cleanup: () => {
    cleanup(); root.remove(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  } };
}

it("collects one fresh resume-check fix with prior consent without showing running, then stops on cancel", () => {
  let callback: PositionCallback = () => {};
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    watchPosition: (success: PositionCallback) => { callback = success; return 42; },
    clearWatch, getCurrentPosition: vi.fn(),
  } });
  const paused = command(runningFixture(["rock", "paper"]), 500, { type: "pause" }).state;
  const checking = command(paused, 1000, { type: "begin_resume" }).state;
  const snapshot = snapshotFor(checking, "p1", 1000);
  const app = browserApp(snapshot);
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    const position: GeolocationPosition = { timestamp: Date.now(), coords: {
      latitude: 0, longitude: 0, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
      toJSON: () => ({}) };
    callback(position);
    expect(app.frames.filter(f => JSON.parse(f).type === "position")).toHaveLength(1);
    expect(app.root.textContent).toContain("Paused");
    expect(app.root.textContent).not.toContain("Round running");
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot: { ...snapshot, resumeChecking: false }, trial: null, startChecking: false, events: [], outcome: null });
    callback(position);
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(app.frames.filter(f => JSON.parse(f).type === "position")).toHaveLength(1);
  } finally { app.cleanup(); }
});

it("keeps visible conversion feedback without audio/haptics and acknowledges only after a visible rendered frame", () => {
  vi.stubGlobal("AudioContext", undefined);
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    const event: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2", faction: "rock",
      reason: null, hostId: null, oldFaction: null, eventSeq: 99, atMs: Date.now() };
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [event], outcome: null });
    expect(app.root.textContent).toContain("converted");
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(0);
    app.raf.shift()?.(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    app.raf.shift()?.(16);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6, snapshot, trial: null, startChecking: false });
    app.raf.shift()?.(32); app.raf.shift()?.(48);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(1);
  } finally { app.cleanup(); }
});

it("reconnects unresolved host changes with their original ID and releases controls on the outcome", async () => {
  vi.useFakeTimers();
  const snapshot = { ...snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    const select = app.root.querySelector<HTMLSelectElement>('[data-action="set-faction"]');
    if (!select) throw new Error("Host faction control missing");
    select.value = "paper"; select.dispatchEvent(new Event("change"));
    const original = app.frames.map(f => JSON.parse(f)).find(m => m.type === "host_command");
    vi.advanceTimersByTime(7500);
    const reconnect = app.root.querySelector<HTMLButtonElement>('[data-action="reconnect"]');
    expect(reconnect).not.toBeNull();
    reconnect?.click();
    const replacement = app.sockets.at(-1);
    if (!replacement || replacement === app.socket) throw new Error("Replacement connection missing");
    const before = app.frames.length;
    app.authenticate(replacement, "reconnected-stream");
    const resent = app.frames.slice(before).map(f => JSON.parse(f)).find(m => m.type === "host_command");
    expect(resent).toEqual(original);
    replacement.receive({ version: 1, type: "update", streamId: "reconnected-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [],
      outcome: { commandId: original.commandId, accepted: true, reason: "Original change accepted." } });
    expect(app.root.querySelector<HTMLSelectElement>('[data-action="set-faction"]')?.disabled).toBe(false);
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("preserves grouped measurements between reference blocks and requires explicit discard for different device details", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  const sample: TrialSample = { atMs: 10000, distanceM: 8, uncertaintiesM: [1, 1],
    agesMs: [20, 30], updateGapsMs: [1000, 1200], delayBoundsMs: [[0, 20], [5, 30]],
    clockUncertaintiesMs: [5, 5], referenceM: 4 };
  let seq = 4;
  function update(trial: TrialStatus | null) {
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: ++seq,
      snapshot, trial, startChecking: false, events: [], outcome: null });
  }
  function field(id: string, value: string) {
    const input = app.root.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`Missing trial field: ${id}`);
    input.value = value;
  }
  try {
    for (const [id, value] of [["device-0", "iPhone 15"], ["os-0", "iOS 18"], ["device-1", "iPhone 16"],
      ["os-1", "iOS 18"], ["conditions", "Open outdoor area"], ["referenceM", "4"]]) field(id, value);
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-begin"]')?.click();
    update({ playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 });
    app.socket.receive({ version: 1, type: "trial_sample", streamId: "app-stream", streamSeq: ++seq, sample });
    expect(app.root.textContent).toContain("1 samples");
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-end"]')?.click();
    update(null);
    field("referenceM", "20");
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-begin"]')?.click();
    update({ playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 20 });
    expect(app.root.textContent).toContain("1 samples");
    app.socket.receive({ version: 1, type: "trial_sample", streamId: "app-stream", streamSeq: ++seq,
      sample: { ...sample, atMs: 11000, referenceM: 20 } });
    expect(app.root.textContent).toContain("2 samples");
    update(null);
    field("device-0", "Different phone");
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-begin"]')?.click();
    expect(app.root.textContent).toContain("Export");
    expect(app.root.textContent).toContain("2 samples");
    const discard = app.root.querySelector<HTMLButtonElement>('[data-action="discard-trial"]');
    expect(discard).not.toBeNull();
    discard?.click();
    expect(app.root.querySelector('[data-action="export-trial"]')).toBeNull();
  } finally { app.cleanup(); }
});

it("does not acknowledge off-screen conversion text and waits for an on-screen conversion notice", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const app = browserApp(snapshot);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  bounds.mockReturnValue(new DOMRect(16, 2000, 300, 60));
  try {
    const event: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2", faction: "rock",
      reason: null, hostId: null, oldFaction: null, eventSeq: 99, atMs: Date.now() };
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [event], outcome: null });
    app.raf.shift()?.(0); app.raf.shift()?.(16);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(0);
    bounds.mockImplementation(function (this: HTMLElement) {
      return new DOMRect(16, this.closest(".conversion-notice") ? 20 : 2000, 300, 60);
    });
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector(".conversion-notice")?.textContent).toContain("converted");
    app.raf.shift()?.(32); app.raf.shift()?.(48);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(1);
  } finally { app.cleanup(); }
});

it("does not acknowledge conversion text clipped by its notification container", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const app = browserApp(snapshot);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  bounds.mockImplementation(function (this: HTMLElement) {
    return new DOMRect(16, 20, 300, this.classList.contains("conversion-notice") ? 20 : 60);
  });
  try {
    const event: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2", faction: "rock",
      reason: null, hostId: null, oldFaction: null, eventSeq: 99, atMs: Date.now() };
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [event], outcome: null });
    app.raf.shift()?.(0); app.raf.shift()?.(16);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(0);
    bounds.mockReturnValue(new DOMRect(16, 20, 300, 60));
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot, trial: null, startChecking: false });
    app.raf.shift()?.(32); app.raf.shift()?.(48);
    expect(app.frames.filter(f => JSON.parse(f).type === "feedback_seen")).toHaveLength(1);
  } finally { app.cleanup(); }
});
