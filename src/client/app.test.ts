// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mountApp } from "./app";
import { describeEvent } from "./views";
import { destroyMatch, renderMatch as updateMatch } from "./match-view.svelte";
import type { MatchActions } from "./views";
import { snapshotFor } from "../worker/engine";
import { command, lobbyFixture, pulse, runningFixture } from "../../test/fixtures";
import type { EngineEvent, ServerMessage, TrialSample, TrialStatus } from "../shared/protocol";

const actions: MatchActions = {
  start: vi.fn(), pause: vi.fn(), beginResume: vi.fn(), cancelResume: vi.fn(), end: vi.fn(),
  configure: vi.fn(), setFaction: vi.fn(), leave: vi.fn(),
};
const mountedViews = new Set<HTMLElement>();
function renderMatch(...args: Parameters<typeof updateMatch>) {
  mountedViews.add(args[0]); updateMatch(...args);
}
afterEach(() => {
  for (const root of mountedViews) destroyMatch(root);
  mountedViews.clear();
});

it.each(["/", "/?room=ABCDEFGH"])("puts room setup before optional detailed rules at %s", path => {
  sessionStorage.clear();
  history.replaceState(null, "", path);
  const root = document.createElement("main");
  document.body.append(root);
  const cleanup = mountApp(root);
  try {
    const rules = root.querySelector("#how-to-play");
    const play = root.querySelector("#play");
    if (!rules || !play) throw new Error("Missing entry sections");
    expect(play.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rules?.closest("details, dialog, [hidden]")).toBeNull();
    expect(rules?.getAttribute("aria-labelledby")).toBe(rules?.querySelector("h2")?.id);
    expect(root.querySelector<HTMLDetailsElement>("#rules-details")?.open).toBe(false);
    expect(root.querySelector<HTMLDetailsElement>("#safe-play")?.open).toBe(false);
    expect(root.querySelector(".masthead h1 img")?.getAttribute("alt")).toBe("Monk");
    expect(root.querySelector<HTMLAnchorElement>('a[href="#play"]')?.textContent).toBe("Skip to play");
    expect(root.querySelector("#play")?.contains(root.querySelector('[data-action="create"]'))).toBe(true);
    expect(root.querySelector('input[name="matchCode"]')).not.toBeNull();
    expect(root.textContent).toContain("Location");
    expect(root.textContent).toContain("bounded outdoor area");
  } finally { cleanup(); root.remove(); history.replaceState(null, "", "/"); }
});

it("keeps invalid room-code recovery at the field and preserves the entered name", () => {
  sessionStorage.clear();
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  try {
    const code = root.querySelector<HTMLInputElement>("#matchCode");
    const name = root.querySelector<HTMLInputElement>("#displayName");
    const form = root.querySelector("form");
    const submit = form?.querySelector("button");
    if (!code || !name || !form || !submit) throw new Error("Missing room form");
    name.value = "Sam"; code.value = "BAD"; submit.focus();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    const restored = root.querySelector<HTMLInputElement>("#matchCode");
    expect(document.activeElement).toBe(restored);
    expect(restored?.getAttribute("aria-invalid")).toBe("true");
    expect(restored?.getAttribute("aria-describedby")).toContain("room-code-error");
    expect(root.querySelector("#room-code-error")?.textContent).toContain("eight-character");
    expect(restored?.value).toBe("BAD");
    expect(root.querySelector<HTMLInputElement>("#displayName")?.value).toBe("Sam");
  } finally { cleanup(); root.remove(); }
});

it("adds decorative icons without replacing entry action labels", () => {
  sessionStorage.clear();
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  try {
    for (const [selector, label] of [
      ['[data-action="create"]', "Create room"],
      [".join-form button", "Join room"],
      ["#safe-play-toggle", "Location and safe play"],
    ]) {
      const control = root.querySelector(selector);
      expect(control?.textContent).toBe(label);
      expect(control?.querySelector("img")?.getAttribute("src")).toBeTruthy();
      expect(control?.querySelector("img")?.getAttribute("alt")).toBe("");
      expect(control?.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
    }
  } finally { cleanup(); root.remove(); }
});

it("shows game identity and host-only faction controls without testing gates", () => {
  const root = document.createElement("section");
  const playerTestSnapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0);
  const hostTestSnapshot = { ...playerTestSnapshot, canHost: true };
  renderMatch(root, hostTestSnapshot, actions);
  expect(root.textContent).not.toMatch(/Testing mode|uncalibrated|freshness/i);
  expect(root.querySelector('[data-action="set-faction"]')).not.toBeNull();
  renderMatch(root, playerTestSnapshot, actions);
  expect(root.querySelector('[data-action="set-faction"]')).toBeNull();
  expect(root.textContent).toContain("Rock");
  expect(root.querySelector('[data-faction-symbol="rock"]')).not.toBeNull();
  expect(root.querySelector('[data-map]')).toBeNull();
  expect(root.textContent).not.toMatch(/latitude|longitude/);
});
it.each(["rock", "paper", "scissors"] as const)("shares the %s icon and faction badge between rules, HUD and radar", faction => {
  sessionStorage.clear();
  const home = document.createElement("main"); document.body.append(home);
  const cleanup = mountApp(home);
  const game = document.createElement("section");
  try {
    const ruleIcon = home.querySelector(`.faction-cycle [data-faction="${faction}"] svg`);
    const reference = ruleIcon?.querySelector("image")?.getAttribute("href");
    expect(reference).toBeTruthy();
    const references = [...home.querySelectorAll(".faction-cycle image")].map(image => image.getAttribute("href"));
    expect(new Set(references).size).toBe(3);
    const state = pulse(runningFixture([faction, faction]), 0, [0, 60]).state;
    renderMatch(game, snapshotFor(state, "p1", 0), actions);
    expect(game.querySelector(".game-hud")?.getAttribute("data-faction")).toBe(faction);
    expect(game.querySelector(".own-faction")?.getAttribute("data-faction")).toBe(faction);
    expect(game.querySelector(".own-faction svg image")?.getAttribute("href")).toBe(reference);
    expect(game.querySelector('[data-radar-player="p2"]')?.getAttribute("data-faction")).toBe(faction);
    expect(game.querySelector('[data-radar-player="p2"] svg image')?.getAttribute("href")).toBe(reference);
    const playerBadge = game.querySelector('[data-player-id="p2"] .faction-icon');
    expect(playerBadge?.getAttribute("data-faction")).toBe(faction);
    expect(playerBadge?.getAttribute("src")).toBe(reference);
    renderMatch(game, snapshotFor(lobbyFixture([faction, faction]), "p1", 0), actions);
    expect(game.querySelectorAll(".roster .faction-icon")).toHaveLength(2);
    expect(game.querySelector(".roster .faction-icon")?.getAttribute("src")).toBe(reference);
  } finally { cleanup(); home.remove(); }
});
it("labels radar ranges and keeps player distances outside diagnostics", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 60]).state;
  const snapshot = snapshotFor(state, "p1", 0);
  renderMatch(root, snapshot, actions);
  expect([...root.querySelectorAll(".radar-range-label")].map(node => node.textContent)).toEqual(["37.5 m", "75 m"]);
  const players = root.querySelector(".radar-players");
  expect(players?.closest("details")).toBeNull();
  expect(players?.querySelector(".player-distance")?.textContent).toContain("about 60 m E");
  renderMatch(root, snapshot, actions, false);
  expect(root.querySelector(".radar-players [data-current='false']")).not.toBeNull();
  expect(root.querySelector(".radar-players")?.textContent).toContain("Last-known position.");
});
it("marks distances and markers as last-known when their reference is stale", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 60]).state;
  const snapshot = snapshotFor(state, "p1", 0);
  if (!snapshot.radar?.reference) throw new Error("Missing radar reference");
  renderMatch(root, {
    ...snapshot,
    radar: { ...snapshot.radar, reference: { ...snapshot.radar.reference, active: false } },
  }, actions);
  expect(root.querySelector('[data-player-id="p2"]')?.getAttribute("data-current")).toBe("false");
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-current")).toBe("false");
  expect(root.querySelector(".radar-players")?.textContent).toContain("Last-known position.");
});
it("keeps zero-distance estimates, missing positions and peer references explicit", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 0]).state;
  const snapshot = snapshotFor(state, "p1", 0);
  if (!snapshot.radar?.reference) throw new Error("Missing radar reference");
  renderMatch(root, { ...snapshot, ownPlayerId: null, ownFaction: null }, actions);
  expect(root.querySelector(".game-hud")?.hasAttribute("data-faction")).toBe(false);
  expect(root.querySelector(".distance-reference")?.textContent).toBe("Approximate distances from Player 1.");
  expect(root.querySelector(".player-distance")?.textContent).toContain("Within about 5 m.");
  renderMatch(root, {
    ...snapshot,
    radar: { ...snapshot.radar, reference: null, players: [{ playerId: "p2", reason: null, position: null }] },
  }, actions);
  expect(root.querySelector(".player-distance")?.textContent).toBe("Waiting for location.");
  expect(root.querySelector(".distance-reference")?.textContent).toBe("Location needed for distances.");
});
it("shows a direct resume action with frozen paused settings", () => {
  const root = document.createElement("section");
  const changed = command(runningFixture(["rock", "paper"]), 0, { type: "set_faction", playerId: "p1", faction: "scissors" }).state;
  const paused = command(changed, 500, { type: "pause" }).state;
  renderMatch(root, { ...snapshotFor(paused, "p1", 10000), canHost: true }, actions);
  expect(root.textContent).toContain("Paused");
  expect(root.textContent).not.toContain("Freshness check");
  expect(root.querySelector('[data-action="configure"]')).toBeNull();
  expect(root.querySelector('[data-action="begin-resume"]')?.textContent).toBe("Resume round");
});
it("updates gameplay without replacing a focused control or closing its disclosure", () => {
  const root = document.createElement("section"); document.body.append(root);
  const snapshot = { ...snapshotFor(runningFixture(["rock", "paper"]), "p1", 0), canHost: true };
  renderMatch(root, snapshot, actions);
  const details = root.querySelector<HTMLDetailsElement>("#faction-controls");
  const select = root.querySelector<HTMLSelectElement>("#faction-p1");
  if (!details || !select) throw new Error("Missing faction controls");
  details.open = true; select.focus();
  try {
    renderMatch(root, { ...snapshot, remainingMs: 123000 }, actions);
    expect(root.querySelector("#faction-p1")).toBe(select);
    expect(document.activeElement).toBe(select);
    expect(details.open).toBe(true);
    expect(root.querySelector(".round-clock")?.textContent).toContain("2:03");
  } finally { root.remove(); }
});
it("keeps optional settings closed and disables redundant factions", () => {
  const root = document.createElement("section");
  renderMatch(root, { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true }, actions);
  expect(root.querySelector('input[name="testingMode"]')).toBeNull();
  expect(root.querySelector<HTMLDetailsElement>("#advanced-settings")?.open).toBe(false);
  expect(root.querySelector<HTMLOptionElement>('select[data-action="set-faction"] option[value="rock"]')?.disabled).toBe(true);
});
it("shows faction and waiting radar without calibration warnings in the lobby", () => {
  const root = document.createElement("section");
  renderMatch(root, { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true }, actions);
  expect(root.querySelector('[data-faction-symbol="rock"]')).not.toBeNull();
  expect(root.querySelector(".warning")).toBeNull();
  expect(root.querySelector(".calibration")).toBeNull();
  expect(root.querySelector(".player-radar")).not.toBeNull();
  expect(root.querySelector(".roster")?.textContent).toContain("Player 1 - rock (you)");
  expect(root.querySelector('[data-action="start"]')?.textContent).toBe("Start game");
});
it("names confirmed influence and links it to radar markers", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  expect(root.textContent).toContain("You are converting Player 2");
  expect(root.querySelector(".conversion-countdown")?.textContent).toBe("3 s left");
  expect(root.textContent).toContain("17%");
  expect(root.querySelector("progress")?.value).toBeCloseTo(1 / 6);
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-influence")).toBe("outgoing");
  renderMatch(root, snapshotFor(state, "p2", 500), actions);
  expect(root.textContent).toContain("You are being converted by Player 1");
  expect(root.querySelector('[data-radar-player="p1"]')?.getAttribute("data-influence")).toBe("incoming");
});

it("counts down confirmed conversion time without declaring success and stops when offline", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 500);
  if (!snapshot.outgoing) throw new Error("Missing outgoing fixture");
  renderMatch(root, { ...snapshot, outgoing: { ...snapshot.outgoing, progress: 1 } }, actions);
  expect(root.querySelector(".conversion-countdown")?.textContent).toBe("Confirming...");
  expect(root.textContent).not.toContain("You converted");
  renderMatch(root, snapshot, actions, false);
  expect(root.querySelector(".conversion-countdown")).toBeNull();
  expect(root.textContent).toContain("Conversion stopped");
});

it.each([[0, "30 s left"], [.5, "15 s left"], [.7, "9 s left"], [1, "Confirming..."]] as const)(
  "uses the configured duration for confirmed progress %s without rounding up an extra second", (progress, expected) => {
    const root = document.createElement("section");
    const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 0);
    if (!snapshot.outgoing || !snapshot.parameters) throw new Error("Missing conversion fixture");
    renderMatch(root, { ...snapshot, parameters: { ...snapshot.parameters, dwellMs: 30000 },
      outgoing: { ...snapshot.outgoing, progress } }, actions, true, 500);
    expect(root.querySelector(".conversion-countdown")?.textContent).toBe(expected);
  });

it("shows a separate countdown for each incoming converter", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "paper", "paper"]), 0, [0, 4, 6]).state, "p1", 0);
  expect(snapshot.incoming).toHaveLength(2);
  renderMatch(root, { ...snapshot, incoming: snapshot.incoming.map((attack, index) =>
    ({ ...attack, progress: index ? .75 : .25 })) }, actions);
  expect([...root.querySelectorAll(".conversion-heading")].map(node => node.textContent)).toEqual([
    "You are being converted by Player 2", "You are being converted by Player 3",
  ]);
  expect([...root.querySelectorAll(".conversion-countdown")].map(node => node.textContent)).toEqual(["3 s left", "1 s left"]);
});

it.each(["pause", "location expiry"] as const)("stops conversion timers after %s", reason => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 0);
  renderMatch(root, snapshot, actions);
  expect(root.querySelector(".conversion-countdown")).not.toBeNull();
  if (reason === "pause") snapshot.phase = "paused";
  renderMatch(root, snapshot, actions, true, reason === "location expiry" ? 30000 : 0);
  expect(root.querySelector(".conversion-countdown")).toBeNull();
  expect(root.querySelector(".conversion-stopped")?.textContent).toContain("Conversion stopped");
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
  expect(root.textContent).toContain("Updated just now");
  expect(root.querySelector('[data-radar-player="p2"] [data-faction-symbol="paper"]')).not.toBeNull();
  expect(root.textContent).toContain("No confirmed influence");
  expect(root.querySelectorAll("progress")).toHaveLength(0);
  expect(root.textContent).not.toMatch(/latitude|longitude/);
});

it.each([
  ["rock", ["same", "threat", "target"]],
  ["paper", ["target", "same", "threat"]],
  ["scissors", ["threat", "target", "same"]],
] as const)("shows radar relationships from the player's %s faction", (faction, relationships) => {
  const root = document.createElement("section");
  const state = pulse(runningFixture([faction, "rock", "paper", "scissors"]), 0, [0, 50, 60, 70]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  const labels = { same: "Same faction", target: "Target", threat: "Threat" };
  const symbols = { same: "=", target: "T", threat: "!" };
  relationships.forEach((relationship, index) => {
    const marker = root.querySelector(`[data-radar-player="p${index + 2}"]`);
    const row = root.querySelector(`[data-player-id="p${index + 2}"]`);
    expect(marker?.getAttribute("data-relationship")).toBe(relationship);
    expect(marker?.querySelector("[data-radar-role]")?.textContent).toBe(symbols[relationship]);
    expect(row?.getAttribute("data-relationship")).toBe(relationship);
    expect(row?.textContent).toContain(labels[relationship]);
  });
  expect(root.querySelector("#radar-details")?.textContent).toContain("Faction roles only");
  expect(root.querySelector(".radar-link")).toBeNull();
  expect(root.querySelector(".radar-progress")).toBeNull();
});

it("keeps faction relationships player-relative when a peer is the location reference", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(runningFixture(["rock", "paper", "scissors"]), "p1", 100);
  if (!snapshot.radar?.reference) throw new Error("Missing radar fixture");
  snapshot.radar = { ...snapshot.radar, reference: { ...snapshot.radar.reference, playerId: "p2" },
    players: [{ playerId: "p1", reason: null, position: null }, ...snapshot.radar.players.filter(p => p.playerId !== "p2")] };
  renderMatch(root, snapshot, actions);
  expect(root.querySelector('[data-radar-player="p3"]')?.getAttribute("data-relationship")).toBe("target");
  expect(root.querySelector('[data-player-id="p1"]')?.textContent).toContain("You");
  expect(root.textContent).toContain("Reference: Player 2");
});

it("does not assign personal targets or threats to a spectator host", () => {
  const root = document.createElement("section");
  renderMatch(root, snapshotFor(runningFixture(["rock", "paper", "scissors"]), null, 100, true), actions);
  expect(root.querySelector('.radar-guide')).toBeNull();
  expect(root.querySelector('[data-relationship="target"]')).toBeNull();
  expect(root.querySelector('[data-relationship="threat"]')).toBeNull();
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-relationship")).toBe("player");
});

it.each([
  ["p1", "p2", "outgoing", "p1", "p2"],
  ["p2", "p1", "incoming", "p1", "p2"],
] as const)("shows directed confirmed influence and marker progress for %s", (viewer, other, influence, from, to) => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  renderMatch(root, snapshotFor(state, viewer, 500), actions);
  const link = root.querySelector(`.radar-link.${influence}`);
  expect(link?.getAttribute("data-from")).toBe(from);
  expect(link?.getAttribute("data-to")).toBe(to);
  if (!link) throw new Error("Missing influence link");
  const startDistance = Math.hypot(Number(link.getAttribute("x1")) - 160, Number(link.getAttribute("y1")) - 160);
  const endDistance = Math.hypot(Number(link.getAttribute("x2")) - 160, Number(link.getAttribute("y2")) - 160);
  expect(influence === "outgoing" ? endDistance > startDistance : startDistance > endDistance).toBe(true);
  expect(root.querySelector(`.radar-arrow.${influence}`)).not.toBeNull();
  const marker = root.querySelector(`[data-radar-player="${other}"]`);
  const progress = marker?.querySelector(".radar-progress");
  expect(progress).not.toBeNull();
  if (!progress) throw new Error("Missing influence progress");
  expect(Number.parseFloat(progress.getAttribute("stroke-dasharray") ?? "")).toBeCloseTo(100 / 6);
  expect(marker?.querySelector("title")?.textContent).toContain("17%");
  const status = root.querySelector(`[data-player-id="${other}"] .radar-combat-status`);
  expect(status?.textContent).toContain("17%");
  expect(status?.textContent).toContain(influence === "outgoing" ? "You are influencing" : "is influencing you");
});

it("shows progress for each incoming player alongside outgoing influence", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "paper", "paper", "scissors"]), 0, [0, 4, -4, 3]).state;
  renderMatch(root, snapshotFor(state, "p1", 500), actions);
  expect(root.querySelectorAll(".radar-progress")).toHaveLength(3);
  expect(root.querySelectorAll(".radar-arrow.incoming")).toHaveLength(2);
  expect(root.querySelectorAll(".radar-arrow.outgoing")).toHaveLength(1);
});

it.each(["offline", "expired", "paused", "unknown-age"] as const)(
  "removes radar combat cues when influence is %s but keeps faction relationships", condition => {
    const root = document.createElement("section");
    const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 500);
    if (condition === "paused") snapshot.phase = "paused";
    if (condition === "unknown-age") {
      if (!snapshot.radar?.reference) throw new Error("Missing radar fixture");
      snapshot.radar.reference.ageMs = null;
    }
    renderMatch(root, snapshot, actions, condition !== "offline", condition === "expired" ? 30000 : 0);
    expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-relationship")).toBe("target");
    expect(root.querySelector(".radar-link")).toBeNull();
    expect(root.querySelector(".radar-arrow")).toBeNull();
    expect(root.querySelector(".radar-progress")).toBeNull();
    expect(root.querySelector(".radar-combat-status")).toBeNull();
  });

it("shows last-known state separately from poor location accuracy", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(runningFixture(["rock", "scissors"]), "p1", 100);
  const position = snapshot.radar?.players[0].position;
  if (!position) throw new Error("Missing radar fixture");
  position.accuracyM = 60;
  renderMatch(root, snapshot, actions, true, 30000);
  const row = root.querySelector('[data-player-id="p2"]');
  expect(row?.textContent).toContain("Location is approximate");
  expect(row?.textContent).toContain("Last-known position");
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-current")).toBe("false");
});

it("does not invent a fresh age for unknown radar timestamps", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "paper"]), 0, [0, 21]).state, "p1", 0);
  if (!snapshot.radar?.reference || !snapshot.radar.players[0].position) throw new Error("Missing radar fixture");
  snapshot.radar.reference.ageMs = null;
  snapshot.radar.players[0].position.ageMs = null;
  renderMatch(root, snapshot, actions);
  expect(root.textContent).toContain("Update time unknown");
  expect(root.textContent).not.toContain("Updated just now");
});

it("retains old markers and shows ordinary waiting states without influence", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(["rock", "paper"]), 0, [0, 21]).state;
  renderMatch(root, snapshotFor(state, "p1", 1500), actions);
  expect(root.querySelectorAll("[data-radar-player]")).toHaveLength(1);
  expect(root.querySelectorAll("progress")).toHaveLength(0);
  expect(root.textContent).toMatch(/last-known/i);
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

it("keeps displaced markers inside the radar's rotation-safe radius", () => {
  const root = document.createElement("section");
  const state = pulse(runningFixture(Array.from({ length: 18 }, () => "rock")), 0, Array(18).fill(0)).state;
  renderMatch(root, snapshotFor(state, "p1", 100), actions);
  for (const marker of root.querySelectorAll("[data-radar-player]")) {
    const point = marker.getAttribute("transform")?.match(/^translate\(([^ ]+) ([^)]+)\)$/);
    expect(point).not.toBeNull();
    expect(Math.hypot(Number(point?.[1]) - 160, Number(point?.[2]) - 160)).toBeLessThanOrEqual(120.000001);
  }
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
    .toContain("Conversion stopped: you were converting Player 2. Location is stale");
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
    for (const streamSeq of [3, 4]) current.receive({ version: 1, type: "snapshot", streamId, streamSeq,
      snapshot, trial: null, startChecking: false });
  }
  const current = socket!;
  authenticate(current);
  return { root, socket: current, sockets, frames, raf, authenticate, cleanup: () => {
    cleanup(); root.remove(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  } };
}

it("keeps game-message badges tied to the recorded faction rather than the current roster", () => {
  const state = runningFixture(["rock", "scissors"]);
  const snapshot = snapshotFor(command(state, 0, { type: "set_faction", playerId: "p2", faction: "paper" }).state, "p1", 0);
  const app = browserApp(snapshot);
  try {
    const event: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "p2", faction: "rock",
      reason: null, hostId: null, oldFaction: null, eventSeq: 99, atMs: 0 };
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [event], outcome: null });
    for (const selector of [".conversion-notice p", "#match-feedback p"]) {
      const message = app.root.querySelector(selector);
      expect(message?.textContent).toBe("You converted Player 2 to Rock.");
      expect(message?.querySelector(".faction-icon")?.getAttribute("data-faction")).toBe("rock");
      expect(message?.querySelector(".faction-icon")?.getAttribute("alt")).toBe("");
    }
  } finally { app.cleanup(); }
});

it("restores faction history without replaying alerts and keeps changes out of the noisy feedback limit", () => {
  const snapshot = snapshotFor(runningFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    const event: EngineEvent = { type: "conversion", attackerId: "p1", targetId: "departed", faction: "rock",
      attackerLabel: "Player 1", targetLabel: "Former player", oldFaction: "scissors",
      reason: null, hostId: null, eventSeq: 10, atMs: 1000 };
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, factionHistory: [event] });
    expect(app.root.querySelector("#faction-history")?.textContent).toContain("You converted Former player to Rock.");
    expect(app.root.querySelector("#faction-history time")?.getAttribute("datetime")).toBe("1970-01-01T00:00:01.000Z");
    expect(app.root.querySelector(".conversion-notice")).toBeNull();
    const historyList = app.root.querySelector("#faction-history ol");
    const noise: EngineEvent[] = Array.from({ length: 8 }, (_, index) => ({ ...event, type: "lifecycle",
      faction: null, attackerId: null, targetId: null, eventSeq: 11 + index, reason: "Round running." }));
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 6,
      snapshot, trial: null, startChecking: false, events: noise, outcome: null });
    expect(app.root.querySelectorAll("#faction-history li")).toHaveLength(1);
    expect(app.root.querySelector("#faction-history ol")).toBe(historyList);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 7,
      snapshot, trial: null, startChecking: false, factionHistory: [event] });
    expect(app.root.querySelectorAll("#faction-history li")).toHaveLength(1);
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 8,
      snapshot, trial: null, startChecking: false, events: [event, { ...event, eventSeq: 20 }], outcome: null });
    expect(app.root.querySelectorAll("#faction-history li")).toHaveLength(2);
  } finally { app.cleanup(); }
});

it("keeps radar and every active conversion in the HUD with secondary information closed", () => {
  const snapshot = { ...snapshotFor(pulse(runningFixture(["rock", "paper", "paper", "scissors"]),
    0, [0, 4, -4, 3]).state, "p1", 500), canHost: true };
  const app = browserApp(snapshot);
  try {
    expect(app.root.querySelector("#how-to-play")).toBeNull();
    const hud = app.root.querySelector(".game-hud");
    expect(hud?.querySelector("[data-radar]")).not.toBeNull();
    expect(hud?.querySelectorAll("progress")).toHaveLength(3);
    expect(hud?.querySelector('[data-action="round-consent"]')?.closest("details")).toBeNull();
    expect(hud?.querySelector('[data-action="compass"]')?.closest("details")).toBeNull();
    const details = app.root.querySelector<HTMLDetailsElement>("#radar-details");
    expect(details?.open).toBe(false);
    expect(hud?.querySelectorAll(".radar-players li")).toHaveLength(3);
    expect(hud?.querySelector(".radar-players")?.closest("details")).toBeNull();
    expect(app.root.querySelector<HTMLDetailsElement>("#host-tools")?.open).toBe(false);
    expect(app.root.querySelector<HTMLDetailsElement>("#room-tools")?.open).toBe(false);
    expect(hud?.querySelector(".roster")).toBeNull();
  } finally { app.cleanup(); }
});

it("keeps the HUD and its open player details stable through age and authority updates", () => {
  vi.useFakeTimers();
  const snapshot = { ...snapshotFor(runningFixture(["rock", "paper"]), "p1", 100), canHost: true };
  const app = browserApp(snapshot);
  try {
    const details = app.root.querySelector<HTMLDetailsElement>("#radar-details");
    const toggle = app.root.querySelector<HTMLElement>("#radar-details-toggle");
    const radar = app.root.querySelector("[data-radar]");
    if (!details || !toggle || !radar) throw new Error("HUD details are missing");
    details.open = true; toggle.focus();
    vi.advanceTimersByTime(250);
    expect(app.root.querySelector("#radar-details")).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(toggle);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector("[data-radar]")).toBe(radar);
    expect(app.root.querySelector("#radar-details")).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(toggle);
    app.root.querySelector<HTMLButtonElement>('[data-action="leave"]')?.click();
    expect(app.root.querySelector(".game-hud")).toBeNull();
    expect(app.root.querySelector("section")?.id).toBe("play");
    vi.advanceTimersByTime(500);
    expect(app.root.querySelector("[data-radar]")).toBeNull();
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("closes setup help on entering gameplay and then retains the player's choice", () => {
  const lobby = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const running = { ...snapshotFor(runningFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(lobby);
  try {
    expect(app.root.querySelector<HTMLDetailsElement>("#safe-play")?.open).toBe(true);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: running, trial: null, startChecking: false });
    const help = app.root.querySelector<HTMLDetailsElement>("#safe-play");
    expect(help?.open).toBe(false);
    if (!help) throw new Error("Help is missing");
    help.open = true;
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot: running, trial: null, startChecking: false });
    expect(app.root.querySelector<HTMLDetailsElement>("#safe-play")?.open).toBe(true);
  } finally { app.cleanup(); }
});

type CompassReading = {
  absolute?: boolean; alpha?: number | null; beta?: number | null; gamma?: number | null;
  webkitCompassHeading?: number; webkitCompassAccuracy?: number;
};
function compassBrowser(permission: (() => Promise<"granted" | "denied">) | null = async () => "granted") {
  class Orientation extends Event { static requestPermission = permission; }
  const orientation = Object.assign(new EventTarget(), { angle: 0 });
  vi.stubGlobal("DeviceOrientationEvent", Orientation);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("screen", { orientation });
  let readingTime = 0;
  vi.spyOn(performance, "now").mockImplementation(() => readingTime);
  const snapshot = snapshotFor(runningFixture(["rock", "paper", "scissors"]), "p1", 100);
  const app = browserApp(snapshot);
  const flush = () => { for (const callback of app.raf.splice(0)) callback(readingTime); };
  const toggle = () => {
    const button = app.root.querySelector<HTMLButtonElement>('[data-action="compass"]');
    expect(button).not.toBeNull(); button?.click(); return button;
  };
  return { ...app, snapshot, flush, toggle,
    async enable() { toggle(); await Promise.resolve(); await Promise.resolve(); flush(); },
    reading(reading: CompassReading, type = "deviceorientation") {
      readingTime += 200;
      window.dispatchEvent(Object.assign(new Event(type), { absolute: false, alpha: null, beta: 0, gamma: 0, ...reading }));
      flush();
    },
    screenAngle(angle: number) { orientation.angle = angle; orientation.dispatchEvent(new Event("change")); flush(); },
    rotation() {
      const world = app.root.querySelector("[data-radar-world]");
      expect(world).not.toBeNull();
      return Number(world?.getAttribute("transform")?.match(/^rotate\(([^ ]+) 160 160\)$/)?.[1]);
    },
  };
}

it("keeps compass opt-in and local without starting location sharing", async () => {
  const app = compassBrowser();
  try {
    const frames = [...app.frames];
    app.reading({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector('[data-action="compass"]')?.getAttribute("aria-pressed")).toBe("false");
    await app.enable();
    app.reading({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    expect(app.rotation()).toBe(-90);
    expect(app.root.textContent).toContain("Heading-up");
    expect(app.root.textContent).toContain("Location sharing is off");
    expect(app.frames).toEqual(frames);
  } finally { app.cleanup(); }
});

it("keeps compass labels, marker icons, and player numbers upright", async () => {
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    expect(app.rotation()).toBe(-90);
    expect(app.root.querySelector('[data-radar-world] .radar-compass')?.getAttribute("transform")).toBe("rotate(90 160 19)");
    expect(app.root.querySelector('[data-radar-player] [data-radar-upright]')?.getAttribute("transform")).toBe("rotate(90 0 0)");
    expect(app.root.querySelector('[data-radar-world] .radar-center')).toBeNull();
    expect(app.root.querySelector('.radar-center')).not.toBeNull();
    expect(app.root.querySelector('[data-player-id="p2"]')?.textContent).toContain("about 100 m E");
  } finally { app.cleanup(); }
});

it("uses Android absolute orientation but never relative alpha as north", async () => {
  const app = compassBrowser(null);
  try {
    await app.enable(); app.reading({ alpha: 270 });
    expect(app.rotation()).toBe(0);
    app.reading({ absolute: true, alpha: 270 }, "deviceorientationabsolute");
    expect(app.rotation()).toBe(-90);
  } finally { app.cleanup(); }
});

it.each([0, 90, 180, 270])("aligns the top of the screen at a %s degree screen rotation", async angle => {
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 0, webkitCompassAccuracy: 0 });
    app.screenAngle(angle);
    expect(app.rotation()).toBe(angle === 0 ? 0 : -angle);
  } finally { app.cleanup(); }
});

it("accounts for tilt when using absolute orientation in landscape", async () => {
  const app = compassBrowser(null);
  try {
    app.screenAngle(90); await app.enable();
    app.reading({ absolute: true, alpha: 90, beta: 45, gamma: 30 }, "deviceorientationabsolute");
    expect(app.rotation()).toBeCloseTo(-337.792, 2);
  } finally { app.cleanup(); }
});

it("smooths the short turn across north rather than turning through south", async () => {
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 359 });
    expect(app.rotation()).toBe(-359);
    app.reading({ webkitCompassHeading: 1 });
    const heading = -app.rotation();
    expect(heading > 358 || heading < 2).toBe(true);
    expect(heading).not.toBe(1);
  } finally { app.cleanup(); }
});

it.each([
  { webkitCompassHeading: NaN }, { webkitCompassHeading: Infinity }, { webkitCompassHeading: -10 },
  { webkitCompassHeading: 90, webkitCompassAccuracy: -1 },
  { webkitCompassHeading: 90, webkitCompassAccuracy: 90 },
  { absolute: true, alpha: 0, beta: 90, gamma: 0 },
] as const)("falls back to north-up for an unreliable compass reading %j", async reading => {
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    expect(app.rotation()).toBe(-90);
    app.reading(reading);
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector("[data-compass-status]")?.textContent).toMatch(/north-up/i);
    expect(app.root.querySelectorAll("[data-radar-player]")).toHaveLength(2);
  } finally { app.cleanup(); }
});

it("returns to north-up when compass events stop and recovers on a new reading", async () => {
  vi.useFakeTimers();
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    vi.advanceTimersByTime(3500); app.flush();
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector("[data-compass-status]")?.textContent).toMatch(/north-up/i);
    app.reading({ webkitCompassHeading: 180 });
    expect(app.rotation()).toBe(-180);
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it.each(["denied", "rejected", "sync-rejected"] as const)("reports %s compass permission without losing the radar", async result => {
  const app = compassBrowser(() => {
    if (result === "sync-rejected") throw new Error("Sensor access blocked");
    if (result === "rejected") return Promise.reject(new Error("Sensor access blocked"));
    return Promise.resolve("denied");
  });
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector('[data-action="compass"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(app.root.querySelector("[data-compass-status]")?.textContent).toMatch(/denied|blocked/i);
  } finally { app.cleanup(); }
});

it("does not repeatedly announce unchanged compass status on sensor updates", async () => {
  const app = compassBrowser();
  const observer = new MutationObserver(() => {});
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    const status = app.root.querySelector("[data-compass-status]");
    expect(status).not.toBeNull();
    if (!status) throw new Error("Missing compass status");
    observer.observe(status, { childList: true });
    app.reading({ webkitCompassHeading: 90 });
    expect(observer.takeRecords()).toHaveLength(0);
  } finally { observer.disconnect(); app.cleanup(); }
});

it.each(["unsupported", "insecure"] as const)("explains an %s compass instead of requesting sensors", async reason => {
  const app = compassBrowser();
  try {
    if (reason === "unsupported") vi.stubGlobal("DeviceOrientationEvent", undefined);
    else vi.stubGlobal("isSecureContext", false);
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector("[data-compass-status]")?.textContent).toMatch(/not supported|HTTPS/i);
  } finally { app.cleanup(); }
});

it("ignores a late permission grant after the player selects north-up", async () => {
  let grant: ((value: "granted") => void) | undefined;
  const app = compassBrowser(() => new Promise(resolve => { grant = resolve; }));
  try {
    await app.enable(); app.toggle();
    grant?.("granted"); await Promise.resolve(); app.flush();
    app.reading({ webkitCompassHeading: 90 });
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector('[data-action="compass"]')?.getAttribute("aria-pressed")).toBe("false");
  } finally { app.cleanup(); }
});

it("retains heading and compass-button focus through age and snapshot updates", async () => {
  vi.useFakeTimers();
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    const button = app.root.querySelector<HTMLButtonElement>('[data-action="compass"]');
    button?.focus(); vi.advanceTimersByTime(250); app.flush();
    expect(app.rotation()).toBe(-90);
    expect(app.root.querySelector('[data-action="compass"]')).toBe(button);
    expect(document.activeElement).toBe(button);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: app.snapshot, trial: null, startChecking: false });
    expect(app.rotation()).toBe(-90);
    expect(document.activeElement?.id).toBe("action-compass");
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("stops compass sensing when hidden and clears sensor timers on cleanup", async () => {
  vi.useFakeTimers();
  const app = compassBrowser();
  try {
    await app.enable(); app.reading({ webkitCompassHeading: 90 });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange")); app.flush();
    app.reading({ webkitCompassHeading: 180 });
    expect(app.rotation()).toBe(0);
    expect(app.root.querySelector('[data-action="compass"]')?.getAttribute("aria-pressed")).toBe("false");
  } finally {
    app.cleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.useRealTimers();
  }
});

it("retains last-known markers but clears influence when the connection fails", () => {
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const app = browserApp(snapshotFor(state, "p1", 500));
  try {
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    expect(app.root.querySelector("progress")).not.toBeNull();
    app.socket.dispatchEvent(new Event("error"));
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    expect(app.root.querySelector("progress")).toBeNull();
    expect(app.root.textContent).toMatch(/offline.*last-known/i);
  } finally { app.cleanup(); }
});

it("expires influence at thirty seconds locally while retaining the radar", () => {
  vi.useFakeTimers();
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const snapshot = snapshotFor(state, "p1", 500);
  const app = browserApp(snapshot);
  try {
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    vi.advanceTimersByTime(30000);
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    expect(app.root.querySelector("progress")).toBeNull();
    expect(app.root.textContent).toMatch(/last-known/i);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: snapshotFor(pulse(state, 1500, [0, 4]).state, "p1", 1500), trial: null, startChecking: false });
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("keeps retained markers without influence when an update arrives while hidden", () => {
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const snapshot = snapshotFor(state, "p1", 500);
  const app = browserApp(snapshot);
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    expect(app.root.querySelector("[data-radar-player]")).not.toBeNull();
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
  let watchSuccess: PositionCallback = () => { throw new Error("No location watch"); };
  const request = vi.fn((accept: PositionCallback, reject: PositionErrorCallback) => { success = accept; failure = reject; });
  const watch = vi.fn((accept: PositionCallback, reject: PositionErrorCallback) => { watchSuccess = accept; watchError = reject; return 42; });
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
    fix: (timestamp = Date.now()) => watchSuccess({ ...position, timestamp }),
    revoke: (code = 1) => watchError(error(code)) };
}

it("starts the game without requesting browser permission", () => {
  const browser = permissionBrowser();
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.click();
    expect(browser.request).not.toHaveBeenCalled();
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

it("shares location while paused and stops sharing without leaving", () => {
  let callback: PositionCallback = () => {};
  let permission: PositionCallback = () => {};
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    watchPosition: (success: PositionCallback) => { callback = success; return 42; },
    clearWatch, getCurrentPosition: (success: PositionCallback) => { permission = success; },
  } });
  const paused = command(runningFixture(["rock", "paper"]), 500, { type: "pause" }).state;
  const snapshot = snapshotFor(paused, "p1", 1000);
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
    app.root.querySelector<HTMLButtonElement>('[data-action="stop-sharing"]')?.click();
    callback(position);
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(app.frames.filter(f => JSON.parse(f).type === "position")).toHaveLength(1);
    expect(app.frames.map(f => JSON.parse(f)).some(f => f.type === "suspend")).toBe(true);
    expect(app.frames.map(f => JSON.parse(f)).some(f => f.type === "leave")).toBe(false);
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
    select.value = "paper"; select.dispatchEvent(new Event("change", { bubbles: true }));
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

it("restores the authoritative faction after rejection so the host can retry it", () => {
  const snapshot = { ...snapshotFor(runningFixture(["rock", "scissors"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    const select = app.root.querySelector<HTMLSelectElement>("#faction-p1");
    if (!select) throw new Error("Faction control is missing");
    select.value = "paper"; select.dispatchEvent(new Event("change", { bubbles: true }));
    const sent = app.frames.map(frame => JSON.parse(frame)).find(frame => frame.type === "host_command");
    app.socket.receive({ version: 1, type: "update", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false, events: [],
      outcome: { commandId: sent.commandId, accepted: false, reason: "Faction change was rejected." } });
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("rock");
    expect(app.root.textContent).toContain("Faction change was rejected.");
    select.value = "paper"; select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.frames.map(frame => JSON.parse(frame)).filter(frame =>
      frame.type === "host_command" && frame.command.faction === "paper")).toHaveLength(2);
  } finally { app.cleanup(); }
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

it("saves ordinary defaults without a mode, approval, or inactivity field", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const app = browserApp(snapshot);
  try {
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    if (!form) throw new Error("Round setup is missing");
    expect(app.root.querySelector("#playArea")).toBeNull();
    expect(app.root.querySelector<HTMLInputElement>("#dwellMs")?.value).toBe("30");
    expect(app.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(false);
    expect(form.reportValidity()).toBe(true);
    form.requestSubmit();
    const configured = app.frames.map(f => JSON.parse(f)).find(m => m.type === "host_command" && m.command.type === "configure");
    expect(configured?.command).toMatchObject({
      type: "configure", mode: "test", approved: false,
      parameters: { entryRadiusM: 30, retentionRadiusM: 40, maxAccuracyM: 15,
        freshnessMs: 30000, dwellMs: 30000, graceMs: 3000, roundDurationMs: 600000 },
    });
    expect(configured.command).not.toHaveProperty("playArea");
    expect(configured.command.deviceLimitations).toBe("");
    expect(app.root.querySelector("#freshnessMs")).toBeNull();
    expect(app.root.querySelector('[data-action="approve"]')).toBeNull();
  } finally { app.cleanup(); }
});

it.each([[.001, 1], [1.001, 1001], [15, 15000], [45.5, 45500], [86400, 86400000]])(
  "lets the host set conversion time to %s seconds", (seconds, milliseconds) => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    const duration = app.root.querySelector<HTMLInputElement>("#dwellMs");
    if (!form || !duration) throw new Error("Conversion setting is missing");
    expect(duration.labels?.[0].textContent).toContain("Conversion time (seconds)");
    expect(duration.value).toBe("3");
    duration.value = String(seconds);
    expect(form.reportValidity()).toBe(true);
    form.requestSubmit();
    const configured = app.frames.map(frame => JSON.parse(frame)).find(frame =>
      frame.type === "host_command" && frame.command.type === "configure");
    expect(configured?.command.parameters.dwellMs).toBe(milliseconds);
    expect(configured?.command.parameters.roundDurationMs).toBe(600000);
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
    expect(app.root.querySelector('[data-action="approve"]')).toBeNull();
    expect(app.root.querySelector('[data-action="round-consent"]')?.textContent).toBe("Share location");
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

it.each(["0", "1.0001"])("opens invalid advanced settings for conversion time %s", seconds => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const app = browserApp(snapshot);
  try {
    const form = app.root.querySelector<HTMLFormElement>(".configuration");
    const dwell = app.root.querySelector<HTMLInputElement>("#dwellMs");
    if (!form || !dwell) throw new Error("Round setup is missing");
    dwell.value = seconds;
    expect(form.reportValidity()).toBe(false);
    expect(app.root.querySelector<HTMLDetailsElement>("#advanced-settings")?.open).toBe(true);
    expect(app.root.querySelector<HTMLDetailsElement>("#host-tools")?.open).toBe(true);
    form.requestSubmit();
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

it.each(["test", "normal"] as const)("shows saved %s range settings without legacy approval gates", mode => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"], mode), "p1", 0), canHost: true, approved: false };
  const root = document.createElement("section");
  const configure = vi.fn();
  renderMatch(root, snapshot, { ...actions, configure });
  expect(root.querySelector<HTMLInputElement>("#entryRadiusM")?.value).toBe("12");
  expect(root.querySelector("#deviceLimitations")).toBeNull();
  expect(root.querySelector("#playArea")).toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(false);
  expect(root.querySelector('[data-action="approve"]')).toBeNull();
});

it("uses game defaults for legacy unconfigured snapshots without blocking start", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"], "normal"), "p1", 0), canHost: true,
    parameters: null, approved: false, deviceLimitations: "" };
  const root = document.createElement("section");
  renderMatch(root, snapshot, actions);
  expect(root.querySelector<HTMLInputElement>("#entryRadiusM")?.value).toBe("30");
  expect(root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled).toBe(false);
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

it("starts a lobby watch without a clock and sends its first cached position", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    expect(browser.request).not.toHaveBeenCalled();
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    expect(browser.request).not.toHaveBeenCalled();
    expect(browser.watch).toHaveBeenCalledTimes(1);
    browser.fix(Date.now() - 60000);
    const reports = app.frames.map(f => JSON.parse(f)).filter(f => f.type === "position");
    expect(reports).toHaveLength(1);
    expect(reports[0].report.reportedAgeMs).toBe(60000);
    expect(app.frames.some(f => JSON.parse(f).type === "clock_probe")).toBe(false);
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
    expect(browser.watch).toHaveBeenCalledTimes(1);
    browser.revoke(code);
    expect(app.root.querySelector('[role="alert"]')?.textContent).toMatch(reason);
    const retry = app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(browser.watch).toHaveBeenCalledTimes(2);
    browser.fix();
    expect(app.root.querySelector('[role="alert"]')).toBeNull();
    expect(app.root.querySelector('[data-action="stop-sharing"]')).not.toBeNull();
    expect(app.frames.some(f => JSON.parse(f).type === "position")).toBe(true);
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
    expect(browser.watch).toHaveBeenCalledTimes(1);
    if (action === "leave") app.root.querySelector<HTMLButtonElement>('[data-action="leave"]')?.click();
    else if (action === "dispose") app.cleanup();
    else app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: { ...snapshot, phase: "ended" }, trial: null, startChecking: false });
    browser.fix();
    expect(browser.watch).toHaveBeenCalledTimes(1);
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
    expect(browser.watch).toHaveBeenCalledTimes(1);
    browser.fix();
    browser.revoke();
    expect(app.root.textContent).toContain("permission denied");
    const retry = app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(browser.watch).toHaveBeenCalledTimes(2);
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

it.each(["create", "join"])("sends the display name when players %s", async action => {
  sessionStorage.clear();
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(options.body)) });
    return new Response(JSON.stringify({ error: "Name recorded" }), { status: 400 });
  });
  const root = document.createElement("main"); document.body.append(root);
  const cleanup = mountApp(root);
  try {
    const name = root.querySelector<HTMLInputElement>("#displayName");
    expect(name).not.toBeNull();
    if (!name) throw new Error("Display name missing");
    name.value = "Sam";
    if (action === "create") root.querySelector<HTMLButtonElement>('[data-action="create"]')?.click();
    else {
      const code = root.querySelector<HTMLInputElement>("#matchCode");
      if (!code) throw new Error("Room code missing");
      code.value = "ABCDEFGH";
      root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    }
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: action === "create" ? "/api/matches" : "/api/matches/ABCDEFGH/join",
      body: { label: "Sam" } });
  } finally { cleanup(); root.remove(); vi.unstubAllGlobals(); }
});

it.each(["running", "paused"] as const)("keeps invitations available in a %s room", phase => {
  const app = browserApp({ ...snapshotFor(runningFixture(["rock", "paper"]), "p1", 0), phase });
  try {
    const link = app.root.querySelector("[data-invite-link]");
    expect(link?.getAttribute("href")).toBe("https://monk.test/?room=ABCDEFGH");
    expect(link?.closest("details")?.open).toBe(false);
  }
  finally { app.cleanup(); }
});

it.each([29999, 30000])("retains radar and expires confirmed influence at local age %s", elapsedMs => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 0);
  renderMatch(root, snapshot, actions, true, elapsedMs);
  expect(root.querySelector('[data-radar-player="p2"]')).not.toBeNull();
  expect(root.querySelector("progress") === null).toBe(elapsedMs === 30000);
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-current")).toBe(String(elapsedMs < 30000));
});

it("does not let an unrelated old marker hide a fresh encounter", () => {
  const root = document.createElement("section");
  const snapshot = snapshotFor(pulse(runningFixture(["rock", "scissors", "paper"]), 0, [0, 4, 60]).state, "p1", 0);
  const old = snapshot.radar?.players.find(p => p.playerId === "p3")?.position;
  if (!old) throw new Error("Old marker fixture missing");
  old.ageMs = 60000; old.active = false;
  renderMatch(root, snapshot, actions, true, 1000);
  expect(root.querySelector("progress")).not.toBeNull();
  expect(root.querySelector('[data-radar-player="p2"]')?.getAttribute("data-current")).toBe("true");
  expect(root.querySelector('[data-radar-player="p3"]')?.getAttribute("data-current")).toBe("false");
});

it.each(["lobby", "paused"] as const)("shows retained positions in the %s", phase => {
  const root = document.createElement("section");
  const snapshot = { ...snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 0), phase };
  renderMatch(root, snapshot, actions);
  expect(root.querySelector("[data-radar]")).not.toBeNull();
  expect(root.querySelector("progress")).toBeNull();
});

it("updates offline ages without changing influence progress and clears its timer on disposal", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  const app = browserApp(snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 500));
  try {
    vi.advanceTimersByTime(1000);
    expect(app.root.querySelector("progress")?.value).toBeCloseTo(1 / 6);
    app.socket.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(60000);
    expect(app.root.textContent).toContain("Updated 1 min ago");
    expect(app.root.querySelector("progress")).toBeNull();
    app.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  } finally { app.cleanup(); vi.useRealTimers(); }
});

it("keeps ordinary sharing independent of trial consent, timeout, and stopping", () => {
  vi.useFakeTimers();
  const browser = permissionBrowser();
  const snapshot = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(snapshot);
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    browser.fix();
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5, snapshot,
      trial: { playerIds: ["p1", "p2"], readyIds: [], collecting: false, referenceM: 4 }, startChecking: false });
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-ready"]')?.click();
    vi.advanceTimersByTime(5000);
    browser.fix(Date.now());
    app.root.querySelector<HTMLButtonElement>('[data-action="trial-end"]')?.click();
    browser.fix(Date.now() + 1);
    expect(app.frames.map(f => JSON.parse(f)).filter(f => f.type === "position")).toHaveLength(3);
    expect(app.frames.map(f => JSON.parse(f)).filter(f => f.type === "suspend")).toHaveLength(0);
    expect(app.root.querySelector('[data-action="stop-sharing"]')).not.toBeNull();
  } finally { app.cleanup(); vi.useRealTimers(); }
});
it("keeps the text selection while local ages update", () => {
  vi.useFakeTimers();
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  try {
    const input = app.root.querySelector<HTMLInputElement>("#conditions");
    if (!input) throw new Error("Text field missing");
    input.value = "Open field"; input.focus(); input.setSelectionRange(1, 4);
    vi.advanceTimersByTime(250);
    const next = app.root.querySelector<HTMLInputElement>("#conditions");
    expect(next).toBe(document.activeElement);
    expect([next?.selectionStart, next?.selectionEnd]).toEqual([1, 4]);
  } finally { app.cleanup(); vi.useRealTimers(); }
});
it("does not say it is waiting when the player already has a known location", () => {
  const browser = permissionBrowser();
  const app = browserApp(snapshotFor(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, "p1", 500));
  try {
    app.root.querySelector<HTMLButtonElement>('[data-action="round-consent"]')?.click();
    browser.fix();
    expect(app.root.querySelector(".location-sharing")?.textContent).toBe("Location sharing is on");
  } finally { app.cleanup(); }
});
it("collapses the lobby invite when play starts but retains a player's later choice", () => {
  const lobby = snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0);
  const app = browserApp(lobby);
  try {
    expect(app.root.querySelector<HTMLDetailsElement>("#room-invite")?.open).toBe(true);
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot: { ...lobby, phase: "running" }, trial: null, startChecking: false });
    const invite = app.root.querySelector<HTMLDetailsElement>("#room-invite");
    expect(invite?.open).toBe(false);
    if (!invite) throw new Error("Invite disclosure missing");
    invite.open = true;
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 6,
      snapshot: { ...lobby, phase: "running" }, trial: null, startChecking: false });
    expect(app.root.querySelector<HTMLDetailsElement>("#room-invite")?.open).toBe(true);
  } finally { app.cleanup(); }
});
it("keeps the same keyboard controls connected during idle age ticks", () => {
  vi.useFakeTimers();
  const app = browserApp({ ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true });
  try {
    for (const selector of ['[data-action="start"]', '[data-action="round-consent"]', "[data-invite-link]"]) {
      const control = app.root.querySelector<HTMLElement>(selector);
      if (!control) throw new Error("Keyboard control missing");
      control.focus();
      vi.advanceTimersByTime(250);
      expect(app.root.querySelector(selector)).toBe(control);
      expect(document.activeElement).toBe(control);
    }
  } finally { app.cleanup(); vi.useRealTimers(); }
});
it("restores game-control focus across an authority update", () => {
  const snapshot = { ...snapshotFor(lobbyFixture(["rock", "paper"]), "p1", 0), canHost: true };
  const app = browserApp(snapshot);
  try {
    app.root.querySelector<HTMLElement>('[data-action="start"]')?.focus();
    app.socket.receive({ version: 1, type: "snapshot", streamId: "app-stream", streamSeq: 5,
      snapshot, trial: null, startChecking: false });
    expect(document.activeElement).toBe(app.root.querySelector('[data-action="start"]'));
  } finally { app.cleanup(); }
});
