// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountApp } from "./app";
import { describeEvent, renderMatch } from "./views";
import type { MatchActions } from "./views";
import { snapshotFor } from "../worker/engine";
import { command, lobbyFixture, pulse, runningFixture } from "../../test/fixtures";
import type { EngineEvent, ServerMessage } from "../shared/protocol";

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
  const frames: string[] = [], raf: FrameRequestCallback[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    constructor() { super(); socket = this; }
    send(frame: string) { frames.push(frame); }
    close() { this.readyState = 3; }
    receive(message: ServerMessage) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { raf.push(callback); return raf.length; });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  sessionStorage.clear();
  sessionStorage.setItem("monk-session", JSON.stringify({ matchCode: "ABCDEFGH", hostToken: null, playerToken: "p".repeat(64) }));
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  const current = socket!;
  current.readyState = 1; current.dispatchEvent(new Event("open"));
  current.receive({ version: 1, type: "authenticated", streamId: "app-stream", streamSeq: 1,
    playerId: "p1", canHost: false, expiresAtMs: Date.now() + 86400000 });
  current.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 2,
    snapshot, trial: null, startChecking: false });
  const probe = JSON.parse(frames.find(f => JSON.parse(f).type === "clock_probe") ?? "{}");
  current.receive({ version: 1, type: "clock_reply", streamId: "app-stream", streamSeq: 3,
    nonce: probe.nonce, clientSendMs: probe.clientSendMs, serverReceiveMs: Date.now(), serverSendMs: Date.now() });
  current.receive({ version: 1, type: "clock_ready", streamId: "app-stream", streamSeq: 4,
    clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  return { root, socket: current, frames, raf, cleanup: () => { cleanup(); root.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); } };
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
