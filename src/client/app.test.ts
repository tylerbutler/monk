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
it("defaults the lobby to testing mode and disables redundant factions", () => {
  const root = document.createElement("section");
  renderMatch(root, { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true }, actions);
  expect(root.querySelector<HTMLInputElement>('input[name="testingMode"]')?.checked).toBe(true);
  expect(root.textContent).toContain("Uncalibrated");
  expect(root.querySelector<HTMLOptionElement>('select[data-action="set-faction"] option[value="rock"]')?.disabled).toBe(true);
});
it("keeps in-game location warnings and faction displays out of the waiting-room path", () => {
  const root = document.createElement("section");
  renderMatch(root, { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true }, actions);
  expect(root.querySelector("[data-faction-symbol]")).toBeNull();
  expect(root.querySelector(".warning")).toBeNull();
  expect(root.querySelector(".calibration")?.closest("details")?.id).toBe("advanced-settings");
  expect(root.querySelector(".roster")?.textContent).toContain("Player 1 - rock (you)");
  expect(root.querySelector('[data-action="start"]')?.textContent).toBe("Start game");
});
it("names confirmed influence and links it to radar markers", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  expect(root.textContent).toContain("Influencing Player 2");
  expect(root.textContent).toContain("17%");
  expect(root.querySelector("progress")?.value).toBeCloseTo(1 / 6);
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-influence")).toBe("outgoing");
  renderMatch(root, snapshotFor(state, "p2", 500), actions);
  expect(root.textContent).toContain("Player 1 is influencing you");
  expect(root.querySelector('[data-radar-player="p1"]')?.getAttribute("data-influence")).toBe("incoming");
});

it("shows a north-up radar with player identities and location quality", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "paper"]), 0, [0, 21]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  expect(root.querySelector('[data-radar]')?.getAttribute("viewBox")).toBe("0 0 320 320");
  expect(root.textContent).toContain("North");
  expect(root.textContent).toContain("Player 2");
  expect(root.textContent).toContain("about 20 m E");
  expect(root.textContent).toContain("GPS uncertainty 1 m");
  expect(root.textContent).toContain("Fix age 0.5 s");
  expect(root.querySelector('[data-radar-player="p2"] [data-faction-symbol="paper"]')).not.toBeNull();
  expect(root.textContent).toContain("No confirmed influence");
  expect(root.querySelectorAll("progress")).toHaveLength(0);
  expect(root.textContent).not.toMatch(/latitude|longitude/);
});

it("does not invent a fresh age for unknown radar timestamps", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "paper"]), 0, [0, 21]).state, "p1", 0);
  if (!snapshot.radar?.reference || !snapshot.radar.players[0].position) throw new Error("Missing radar fixture");
  snapshot.radar.reference.ageMs = null;
  snapshot.radar.players[0].position.ageMs = null;
  renderMatch(root, snapshot, actions);
  expect(root.textContent).toContain("Fix age unknown");
  expect(root.textContent).not.toContain("Fix age 0.0 s");
});

it("does not place unknown locations or keep radar markers while paused", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "paper"]), 0, [0, 21]).state;
  renderMatch(root, snapshotFor(state, "p1", 1500), actions);
  expect(root.querySelectorAll("[data-radar-player]")).toHaveLength(0);
  expect(root.querySelectorAll("progress")).toHaveLength(0);
  expect(root.textContent).toMatch(/location.*stale|location.*unavailable/i);
  renderMatch(root, snapshotFor(command(state, 100, { type: "pause" }).state, "p1", 100), actions);
  expect(root.querySelector("[data-radar]")).toBeNull();
  renderMatch(root, snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), actions);
  expect(root.querySelector("[data-radar]")).toBeNull();
});

it("keeps co-located player markers distinct from each other and the reference", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors", "paper"]), 0, [0, 0, 0]).state;
  renderMatch(root, snapshotFor(state, "p1", 100), actions);
  const transforms = [...root.querySelectorAll("[data-radar-player]")].map(p => p.getAttribute("transform"));
  expect(transforms).toHaveLength(2);
  expect(new Set(transforms).size).toBe(2);
  expect(transforms).not.toContain("translate(160 160)");
  expect(root.textContent).toContain("Within about 5 m");
});

it("identifies the host radar reference rather than calling it your position", () => {
  const root = document.createElement("section");
  renderMatch(root, snapshotFor(runningFixture(["rock", "paper"]), null, 100, true), actions);
  expect(root.textContent).toContain("Reference: Player 1");
  expect(root.querySelector('[data-radar-player="p2"]')).not.toBeNull();
});

it("distinguishes conversions, host changes, attack starts, and interruption reasons", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const base: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2",
    faction: "rock", reason: null, hostId: null, oldFaction: null, eventSeq: 1, atMs: 0 };
  expect(describeEvent(base, snapshot)).toBe("You converted Player 2 to Rock.");
  expect(describeEvent(base, { ...snapshot, ownPlayerId: "p2" })).toBe("Player 1 converted you to Rock.");
  expect(describeEvent(base, { ...snapshot, ownPlayerId: null })).toBe("Player 1 converted Player 2 to Rock.");
  expect(describeEvent({ ...base, type: "manual_faction_change", oldFaction: "scissors" }, snapshot)).toContain("Host changed");
  expect(describeEvent({ ...base, type: "attack_started" }, snapshot)).toContain("You are influencing Player 2");
  expect(describeEvent({ ...base, type: "attack_interrupted", reason: "Location is stale or unavailable." }, snapshot))
    .toContain("Influence on Player 2 stopped: Location is stale");
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
    matchCode: "ABCDEFGH", hostToken: snapshot.canHost ? "h".repeat(64) : null,
    playerToken: snapshot.ownPlayerId ? "p".repeat(64) : null,
  }));
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  function authenticate(current: Socket, streamId = "app-stream") {
    current.readyState = 1; current.dispatchEvent(new Event("open"));
    current.receive({ version: 1, type: "authenticated", streamId, streamSeq: 1,
      playerId: snapshot.ownPlayerId, canHost: snapshot.canHost, expiresAtMs: Date.now() + 86400000 });
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

it("clears live radar markers and influence when the connection fails", () => {
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const app = browserApp(snapshotFor(state, "p1", 500));
  try {
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    expect(app.root.querySelector("progress")).not.toBeNull();
    app.socket.dispatchEvent(new Event("error"));
    expect(app.root.querySelector("[data-radar-player]")).toBeNull();
    expect(app.root.querySelector("progress")).toBeNull();
    expect(app.root.textContent).toMatch(/live.*unavailable/i);
  } finally { app.cleanup(); }
});

it("expires radar and influence locally if server updates stop, then accepts a fresh snapshot", () => {
  vi.useFakeTimers();
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const snapshot = snapshotFor(state, "p1", 500);
  const app = browserApp(snapshot);
  try {
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(app.root.querySelector("[data-radar-player]")).toBeNull();
    expect(app.root.querySelector("progress")).toBeNull();
    expect(app.root.textContent).toMatch(/live.*unavailable/i);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: snapshotFor(pulse(state, 1500, [0, 4]).state, "p1", 1500), trial: null, startChecking: false });
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("keeps live markers cleared when an update arrives while the app is hidden", () => {
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const snapshot = snapshotFor(state, "p1", 500);
  const app = browserApp(snapshot);
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(app.root.querySelector("[data-radar-player]")).toBeNull();
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector("[data-radar-player]")).toBeNull();
    expect(app.root.querySelector("progress")).toBeNull();
  } finally {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    app.cleanup();
  }
});

it("shows a public-code-only invite link and keeps configuration out of the main lobby path", async () => {
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  const writeText = vi.fn(async (_value: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    const link = app.root.querySelector<HTMLAnchorElement>("[data-invite-link]");
    if (!link) throw new Error("Invite link is missing");
    const url = new URL(link.href);
    expect([...url.searchParams]).toEqual([["room", "ABCDEFGH"]]);
    expect(url.origin).toBe("https://monk.test");
    expect(link.href).not.toMatch(/token/i);
    expect(app.root.querySelector('[data-action="configure"]')?.closest("details")?.id).toBe("advanced-settings");
    expect(app.root.querySelector('[data-action="start"]')?.textContent).toBe("Start game");
    const copy = app.root.querySelector<HTMLButtonElement>('[data-action="copy-invite"]');
    if (!copy) throw new Error("Copy action is missing");
    copy.click();
    await vi.waitFor(() => expect(app.root.textContent).toContain("Link copied"));
    expect(writeText).toHaveBeenCalledWith("https://monk.test/?room=ABCDEFGH");
  } finally { app.cleanup(); }
});

it("opens an invite with its room code filled in and ready to join", () => {
  sessionStorage.clear();
  history.replaceState(null, "", "/?room=ABCDEFGH");
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  try {
    expect(root.querySelector<HTMLInputElement>("#matchCode")?.value).toBe("ABCDEFGH");
    expect(root.querySelector<HTMLButtonElement>(".join-form button")?.textContent).toBe("Join room");
  } finally { cleanup(); root.remove(); history.replaceState(null, "", "/"); sessionStorage.clear(); }
});

function permissionBrowser() {
  let success: PositionCallback = () => { throw new Error("No permission request"); };
  let failure: PositionErrorCallback = () => { throw new Error("No permission request"); };
  let watchError: PositionErrorCallback = () => { throw new Error("No location watch"); };
  const request = vi.fn((accept: PositionCallback, reject: PositionErrorCallback) => { success = accept; failure = reject; });
  const watch = vi.fn((_accept: PositionCallback, reject: PositionErrorCallback) => { watchError = reject; return 42; });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: request, watchPosition: watch, clearWatch: vi.fn(),
  } });
  const position: GeolocationPosition = { timestamp: Date.now(), coords: {
    latitude: 0, longitude: 0, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
    toJSON: () => ({}) };
  const error = (code: number): GeolocationPositionError => ({
    code, message: "Browser location error", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
  });
  return { request, watch, grant: () => success(position), deny: (code: number) => failure(error(code)),
    revoke: () => watchError(error(1)) };
}

it("requests host location from Start game before sending the start command", () => {
  const browser = permissionBrowser();
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    expect(app.frames.some(frame => JSON.parse(frame).type === "host_command")).toBe(false);
    browser.grant();
    expect(app.frames.map(frame => JSON.parse(frame)).filter(frame =>
      frame.type === "host_command" && frame.command.type === "start")).toHaveLength(1);
    expect(browser.watch).not.toHaveBeenCalled();
  } finally { app.cleanup(); }
});

it("keeps Start game retryable with the same command ID after a storage error", () => {
  const browser = permissionBrowser();
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.click();
    browser.grant();
    const original = app.frames.map(frame => JSON.parse(frame)).find(frame => frame.type === "host_command");
    app.socket.receive({ version: 1, type: "error", streamId: "app-stream", streamSeq: 5,
      code: "storage_failed", reason: "State was not saved. Retry the same command ID.", commandId: original.commandId });
    const retry = app.root.querySelector<HTMLButtonElement>('[data-action="start"]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    const starts = app.frames.map(frame => JSON.parse(frame)).filter(frame => frame.type === "host_command");
    expect(starts.map(frame => frame.commandId)).toEqual([original.commandId, original.commandId]);
  } finally { app.cleanup(); }
});

it("collects one fresh resume-check fix with prior consent without showing running, then stops on cancel", () => {
  let callback: PositionCallback = () => {};
  let permission: PositionCallback = () => {};
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    watchPosition: (success: PositionCallback) => { callback = success; return 42; },
    clearWatch, getCurrentPosition: (success: PositionCallback) => { permission = success; },
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
    permission(position);
    expect(app.frames.filter(f => JSON.parse(f).type === "position")).toHaveLength(0);
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

it("saves a fresh unapproved testing preset without entering any fields", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const app = browserApp(snapshot);
  try {
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    if (!form) throw new Error("Round setup is missing");
    expect(app.root.querySelector("#playArea")).toBeNull();
    expect(app.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(true);
    expect(form.reportValidity()).toBe(true);
    form.requestSubmit();
    const configured = app.frames.map(f => JSON.parse(f)).find(m => m.type === "host_command" && m.command.type === "configure");
    expect(configured?.command).toMatchObject({
      type: "configure", mode: "test", approved: false,
      parameters: { entryRadiusM: 30, retentionRadiusM: 40, maxAccuracyM: 15,
        freshnessMs: 5000, dwellMs: 2000, graceMs: 3000, roundDurationMs: 600000 },
    });
    expect(configured.command).not.toHaveProperty("playArea");
    expect(configured.command.deviceLimitations).toMatch(/uncalibrated/i);
    expect(app.root.querySelector('[data-action="approve"]')).toBeNull();
  } finally { app.cleanup(); }
});

it("needs no visible inputs while advanced controls and measurements are collapsed", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    for (const id of ["advanced-settings", "faction-controls", "location-trial"]) {
      expect(app.root.querySelector<HTMLDetailsElement>(`#${id}`)?.open).toBe(false);
    }
    const visible = [...app.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].filter(input => {
      for (let parent = input.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open) return false;
      }
      return true;
    });
    expect(visible).toHaveLength(0);
    expect(app.root.textContent).not.toContain("Agreed play area");
    expect(app.root.querySelector<HTMLInputElement>("#device-0")?.value).toBe("");
    expect(app.root.querySelector<HTMLInputElement>("#os-0")?.value).toBe("");
    expect(app.root.querySelector('[data-action="approve"]')?.closest("details")?.id).toBe("advanced-settings");
    expect(app.root.querySelector('[data-action="round-consent"]')).toBeNull();
    expect(app.root.querySelector('[data-action="start"]')).not.toBeNull();
  } finally { app.cleanup(); }
});

it("keeps open disclosures and draft settings across authority updates", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    for (const id of ["advanced-settings", "faction-controls", "location-trial"]) {
      const disclosure = app.root.querySelector<HTMLDetailsElement>(`#${id}`);
      expect(disclosure).not.toBeNull();
      if (disclosure) disclosure.open = true;
    }
    const entry = app.root.querySelector<HTMLInputElement>("#entryRadiusM");
    if (!entry) throw new Error("Entry-radius input is missing");
    entry.value = "45";
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector<HTMLInputElement>("#entryRadiusM")?.value).toBe("45");
    for (const id of ["advanced-settings", "faction-controls", "location-trial"]) {
      const disclosure = app.root.querySelector<HTMLDetailsElement>(`#${id}`);
      expect(disclosure?.open).toBe(true);
      if (disclosure) disclosure.open = false;
    }
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector<HTMLDetailsElement>("#advanced-settings")?.open).toBe(false);
    expect(app.root.querySelector<HTMLDetailsElement>("#location-trial")?.open).toBe(false);
  } finally { app.cleanup(); }
});

it("opens invalid advanced settings instead of hiding the field that needs correction", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const app = browserApp(snapshot);
  try {
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    const dwell = app.root.querySelector<HTMLInputElement>("#dwellMs");
    if (!form || !dwell) throw new Error("Round setup is missing");
    dwell.value = "0";
    expect(form.reportValidity()).toBe(false);
    expect(app.root.querySelector<HTMLDetailsElement>("#advanced-settings")?.open).toBe(true);
    expect(app.frames.some(f => JSON.parse(f).type === "host_command")).toBe(false);
  } finally { app.cleanup(); }
});

it("opens an invited measurement trial without hiding the player's consent action", () => {
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5, snapshot,
      trial: { playerIds: ["p1", "p2"], readyIds: [], collecting: false, referenceM: 4 }, startChecking: false });
    expect(app.root.querySelector<HTMLDetailsElement>("#location-trial")?.open).toBe(true);
    expect(app.root.querySelector('[data-action="trial-ready"]')?.closest("details")?.open).toBe(true);
    expect(app.frames.some(f => JSON.parse(f).type === "position")).toBe(false);
  } finally { app.cleanup(); }
});

it.each(["test", "normal"] as const)("preserves saved %s settings and explicit Normal-mode approval", mode => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"], mode), "p1", 0), canHost: true, approved: false };
  const root = document.createElement("section");
  const configure = vi.fn();
  renderMatch(root, snapshot, { ...actions, configure });
  expect(root.querySelector<HTMLInputElement>("#entryRadiusM")?.value).toBe("12");
  expect(root.querySelector<HTMLInputElement>("#deviceLimitations")?.value).toBe("Synthetic tests only");
  expect(root.querySelector("#playArea")).toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(mode === "normal");
  root.querySelector<HTMLButtonElement>('[data-action="approve"]')?.click();
  expect(configure).toHaveBeenCalledWith({ type: "configure", mode, parameters: snapshot.parameters,
    approved: true, deviceLimitations: "Synthetic tests only" });
});

it("does not prefill location parameters for an unconfigured Normal-mode match", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"], "normal"), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const root = document.createElement("section");
  renderMatch(root, snapshot, actions);
  expect(root.querySelector<HTMLInputElement>("#entryRadiusM")?.value).toBe("");
  expect(root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(true);
});

it("offers the host's player join before the setup form", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    const join = app.root.querySelector<HTMLButtonElement>('[data-action="host-join"]');
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    if (!join || !form) throw new Error("Host join or setup is missing");
    expect(join.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  } finally { app.cleanup(); }
});

it("requests browser permission on the lobby consent click and discards the permission fix", () => {
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    expect(browser.request).not.toHaveBeenCalled();
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    const pending = app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]');
    expect(pending?.disabled).toBe(true);
    pending?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    browser.grant();
    expect(app.root.textContent).toContain("permission granted");
    expect(browser.watch).not.toHaveBeenCalled();
    expect(app.frames.some(f => JSON.parse(f).type === "position")).toBe(false);
    expect(sessionStorage.getItem("monk-last-capture")).toBeNull();
    expect(sessionStorage.getItem("monk-position-seq")).toBeNull();
  } finally { app.cleanup(); }
});

it.each([
  { code: 1, reason: /denied/i },
  { code: 2, reason: /unavailable/i },
  { code: 3, reason: /timed out/i },
])("keeps the permission action retryable after browser error $code", ({ code, reason }) => {
  const browser = permissionBrowser();
  const app = browserApp(snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0));
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    browser.deny(code);
    expect(app.root.querySelector('[role="alert"]')?.textContent).toMatch(reason);
    const retry = app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(browser.request).toHaveBeenCalledTimes(2);
    browser.grant();
    expect(app.root.querySelector('[role="alert"]')).toBeNull();
    expect(app.root.textContent).toContain("permission granted");
    expect(browser.watch).not.toHaveBeenCalled();
  } finally { app.cleanup(); }
});

it("requests permission before confirming a trial while the other player is still waiting", () => {
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5, snapshot,
      trial: { playerIds: ["p1", "p2"], readyIds: [], collecting: false, referenceM: 4 }, startChecking: false });
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-ready"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    expect(app.frames.some(f => JSON.parse(f).type === "trial_ready")).toBe(false);
    browser.grant();
    expect(app.frames.map(f => JSON.parse(f)).filter(f => f.type === "trial_ready")).toEqual([
      { version: 1, type: "trial_ready", consent: true },
    ]);
    expect(browser.watch).not.toHaveBeenCalled();
    expect(app.frames.some(f => JSON.parse(f).type === "position")).toBe(false);
  } finally { app.cleanup(); }
});

it("does not offer trial permission to a player outside the selected pair", () => {
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper", "scissors"]), "p3", 0);
  const app = browserApp(snapshot);
  try {
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5, snapshot,
      trial: { playerIds: ["p1", "p2"], readyIds: [], collecting: false, referenceM: 4 }, startChecking: false });
    expect(app.root.querySelector('[data-action="trial-ready"]')).toBeNull();
    expect(browser.request).not.toHaveBeenCalled();
    expect(app.root.querySelector('[data-action="round-consent"]')).not.toBeNull();
  } finally { app.cleanup(); }
});

it.each(["leave", "end", "dispose"])("ignores a late permission result after %s", action => {
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    if (action === "leave") app.root.querySelector<HTMLButtonElement>('[data-action="leave"]')?.click();
    else if (action === "dispose") app.cleanup();
    else app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: { ...snapshot, phase: "ended" }, trial: null, startChecking: false });
    browser.grant();
    expect(browser.watch).not.toHaveBeenCalled();
    expect(app.frames.some(f => JSON.parse(f).type === "position")).toBe(false);
    expect(app.root.textContent).not.toContain("permission granted");
  } finally { app.cleanup(); }
});

it("does not confirm an ended trial from an outstanding permission request", () => {
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5, snapshot,
      trial: { playerIds: ["p1", "p2"], readyIds: [], collecting: false, referenceM: 4 }, startChecking: false });
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-ready"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot, trial: null, startChecking: false });
    browser.grant();
    expect(app.frames.some(f => JSON.parse(f).type === "trial_ready")).toBe(false);
    expect(app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.disabled).toBe(false);
  } finally { app.cleanup(); }
});

it("restores the consent action when location permission is revoked during collection", () => {
  const browser = permissionBrowser();
  const app = browserApp(snapshotFor(runningFixture(["rock", "paper"]), "p1", 0));
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(browser.request).toHaveBeenCalledTimes(1);
    browser.grant();
    expect(browser.watch).toHaveBeenCalledTimes(1);
    browser.revoke();
    expect(app.root.textContent).toContain("permission denied");
    const retry = app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(browser.request).toHaveBeenCalledTimes(2);
  } finally { app.cleanup(); }
});

it("reports unsupported geolocation without hiding or disabling the consent action", () => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
  const app = browserApp(snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0));
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(app.root.querySelector('[role="alert"]')?.textContent).toMatch(/not supported/i);
    expect(app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.disabled).toBe(false);
  } finally { app.cleanup(); }
});
