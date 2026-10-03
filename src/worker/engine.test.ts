import { expect, it } from "vitest";
import { advanceEngine, checkpointEngine, createEngine, distanceBetween, isSuperior, restoreEngine, snapshotFor, suspendEngine } from "./engine";
import { command, fix, host, lobbyFixture, parameters, pulse, runningFixture } from "../../test/fixtures";

it("calls Gleam faction rules", () => {
  expect(isSuperior("rock", "scissors")).toBe(true);
  expect(isSuperior("rock", "paper")).toBe(false);
  expect(isSuperior("paper", "rock")).toBe(true);
  expect(isSuperior("scissors", "paper")).toBe(true);
  expect(isSuperior("rock", "rock")).toBe(false);
});

it("requires continuous dwell", () => {
  let state = runningFixture(["rock", "scissors"]);
  for (const now of [0, 500, 1000, 1500, 2000, 2500]) {
    const next = pulse(state, now, [0, 4]);
    expect(next.events.filter(e => e.type === "conversion")).toHaveLength(0);
    state = next.state;
  }
  expect(pulse(state, 3000, [0, 4]).events.filter(e => e.type === "conversion")).toMatchObject([
    { attackerId: "p1", targetId: "p2", faction: "rock" },
  ]);
});

it("rejects stale fixes at expiry and excessive uncertainty", () => {
  const state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  const expired = advanceEngine(state, { nowMs: 1500, actor: null, commands: [], observations: [] });
  expect(expired.events).toContainEqual(expect.objectContaining({ type: "attack_interrupted", reason: "Location is stale or unavailable." }));
  const inaccurate = advanceEngine(runningFixture(["rock", "scissors"]), {
    nowMs: 0, actor: null, commands: [], observations: [{ ...fix("p1", 0, 0), accuracyM: 4 }, fix("p2", 4, 0)],
  });
  expect(inaccurate.events.filter(e => e.type === "attack_started")).toHaveLength(0);
});

it("does not join fresh endpoints across an observation gap", () => {
  let state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  state = pulse(state, 2000, [0, 4]).state;
  expect(pulse(state, 3000, [0, 4]).events.filter(e => e.type === "conversion")).toHaveLength(0);
});

it("resets dwell after leaving retention range", () => {
  let state = pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state;
  state = pulse(state, 1000, [0, 20]).state;
  state = pulse(state, 2000, [0, 4]).state;
  expect(pulse(state, 3000, [0, 4]).events.filter(e => e.type === "conversion")).toHaveLength(0);
});

it("locks the nearest target and resolves exact ties by player ID", () => {
  let state = pulse(runningFixture(["rock", "scissors", "scissors"]), 0, [0, 4, -4]).state;
  expect(snapshotFor(state, "p1", 0).outgoing?.targetId).toBe("p2");
  state = pulse(state, 500, [0, 5, 1]).state;
  expect(snapshotFor(state, "p1", 500).outgoing?.targetId).toBe("p2");
});
it("ranks eligible targets by horizontal distance rather than uncertainty bounds", () => {
  const next = advanceEngine(runningFixture(["rock", "scissors", "scissors"]), {
    nowMs: 500, actor: null, commands: [], observations: [
      fix("p1", 0, 500), { ...fix("p2", 3, 500), accuracyM: 3 }, fix("p3", 4, 500),
    ],
  });
  expect(snapshotFor(next.state, "p1", 500).outgoing?.targetId).toBe("p2");
});

it("accepts only one competing attacker and retains snapshot factions in an RPS chain", () => {
  let competing = runningFixture(["rock", "rock", "scissors"]);
  for (const now of [0, 1000, 2000, 3000]) {
    const next = pulse(competing, now, [0, 0, 4]);
    if (now === 3000) expect(next.events.filter(e => e.type === "conversion")).toMatchObject([{ attackerId: "p1", targetId: "p3" }]);
    competing = next.state;
  }
  let chain = runningFixture(["rock", "scissors", "paper"]);
  for (const now of [0, 1000, 2000]) chain = pulse(chain, now, [0, 0, 0]).state;
  expect(pulse(chain, 3000, [0, 0, 0]).events.filter(e => e.type === "conversion")).toMatchObject([
    { attackerId: "p1", targetId: "p2", faction: "rock" },
    { attackerId: "p2", targetId: "p3", faction: "scissors" },
    { attackerId: "p3", targetId: "p1", faction: "paper" },
  ]);
});

it("blocks both attack roles during grace", () => {
  let state = command(runningFixture(["rock", "scissors", "paper"]), 0,
    { type: "set_faction", playerId: "p1", faction: "scissors" }).state;
  expect(pulse(state, 1000, [0, 0, 0]).events.filter(e =>
    e.type === "attack_started" && (e.attackerId === "p1" || e.targetId === "p1"))).toHaveLength(0);
  state = pulse(state, 2000, [0, 0, 0]).state;
  expect(snapshotFor(state, "p1", 2000).outgoing?.targetId).toBe("p3");
});

it("replays deterministically and checkpoints without coordinates or dwell", () => {
  function replay() {
    let state = runningFixture(["rock", "scissors"]);
    const events = [];
    for (const now of [0, 1000, 2000, 3000]) {
      const next = pulse(state, now, [0, 4]); events.push(...next.events); state = next.state;
    }
    return { checkpoint: checkpointEngine(state, 3000), events };
  }
  expect(replay()).toEqual(replay());
  expect(JSON.stringify(replay().checkpoint)).not.toMatch(/latitude|longitude|capturedAtMs|dwellStart/);
});

it("normal_requires_six_balanced_players", () => {
  const next = advanceEngine(lobbyFixture(["rock", "paper"], "normal"), {
    nowMs: 0, actor: host, commands: [{ type: "start" }], observations: [fix("p1", 0, 0), fix("p2", 4, 0)],
  });
  expect(next.rejections).toHaveLength(1);
  expect(snapshotFor(next.state, "p1", 0).phase).toBe("lobby");
  expect(snapshotFor(runningFixture(["rock", "rock", "paper", "paper", "scissors", "scissors"], "normal"), "p1", 0).phase).toBe("running");
});

it("test_accepts_two_and_incomplete_factions and test_extinction_continues", () => {
  expect(snapshotFor(runningFixture(["rock", "rock"]), "p1", 0).mode).toBe("test");
  let state = runningFixture(["rock", "scissors"]);
  for (const now of [0, 1000, 2000, 3000]) state = pulse(state, now, [0, 4]).state;
  expect(snapshotFor(state, "p1", 3000).phase).toBe("running");
});

it("normal_extinction_ends", () => {
  let state = runningFixture(["rock", "rock", "paper", "paper", "scissors", "scissors"], "normal");
  for (const now of [0, 1000, 2000, 3000]) state = pulse(state, now, [0, 30, 100, 130, 4, 34]).state;
  expect(snapshotFor(state, "p1", 3000).phase).toBe("ended");
});

it("manual_change_requires_host and manual_change_rejected_in_normal_round", () => {
  const denied = advanceEngine(runningFixture(["rock", "paper"]), {
    nowMs: 0, actor: { id: "p1", host: false, playerId: "p1" }, commands: [{ type: "set_faction", playerId: "p2", faction: "rock" }], observations: [],
  });
  expect(denied.rejections).toHaveLength(1);
  const normal = command(runningFixture(["rock", "rock", "paper", "paper", "scissors", "scissors"], "normal"),
    0, { type: "set_faction", playerId: "p2", faction: "paper" });
  expect(normal.rejections).toHaveLength(1);
});

it("manual changes clear both attack roles, apply grace, and emit no conversion", () => {
  let state = pulse(runningFixture(["rock", "scissors", "paper"]), 0, [0, 0, 0]).state;
  const changed = command(state, 1000, { type: "set_faction", playerId: "p1", faction: "paper" });
  expect(changed.events.filter(e => e.type === "manual_faction_change")).toMatchObject([{ hostId: "h1", targetId: "p1", oldFaction: "rock", faction: "paper" }]);
  expect(changed.events.filter(e => e.type === "conversion")).toHaveLength(0);
  expect(snapshotFor(changed.state, "p1", 1000).outgoing).toBeNull();
  expect(snapshotFor(changed.state, "p1", 1000).incoming).toHaveLength(0);
  expect(snapshotFor(changed.state, "p1", 1000).graceMs).toBe(2000);
  state = changed.state;
  expect(snapshotFor(command(state, 1500, { type: "set_faction", playerId: "p1", faction: "paper" }).state, "p1", 1500).graceMs).toBe(1500);
});

it("freezes settings, round time and grace while paused and recovers running as paused", () => {
  let state = command(runningFixture(["rock", "paper"]), 0, { type: "set_faction", playerId: "p1", faction: "scissors" }).state;
  state = command(state, 500, { type: "pause" }).state;
  const paused = snapshotFor(state, "p1", 500);
  expect(command(state, 10000, { type: "configure", mode: "normal", parameters, approved: true,
    deviceLimitations: "Tests", playArea: "Test area" }).rejections).toHaveLength(1);
  state = command(state, 10000).state;
  expect(snapshotFor(state, "p1", 10000).remainingMs).toBe(paused.remainingMs);
  expect(snapshotFor(state, "p1", 10000).graceMs).toBe(paused.graceMs);
  const restored = restoreEngine(checkpointEngine(runningFixture(["rock", "paper"]), 1000), 100000);
  expect(snapshotFor(restored, "p1", 100000)).toMatchObject({ phase: "paused", outgoing: null, incoming: [] });
});

it("calculates horizontal haversine distance", () => {
  expect(distanceBetween(fix("p1", 0, 0), fix("p2", 100, 0))).toBeCloseTo(100, 7);
});

it("resets parameter approval when settings change, even when approval is supplied", () => {
  const state = lobbyFixture(["rock", "paper"], "normal");
  const changed = command(state, 0, { type: "configure", mode: "normal",
    parameters: { ...parameters, entryRadiusM: 11 }, approved: true, deviceLimitations: "Measured pair", playArea: "Marked test area" });
  expect(snapshotFor(changed.state, "p1", 0).approved).toBe(false);
});
it("excludes stale, uncertain and suspended nearby players", () => {
  let state = pulse(runningFixture(["rock", "paper", "scissors"]), 0, [0, 4, 6]).state;
  expect(snapshotFor(state, "p1", 0).nearby).toEqual({ rock: 0, paper: 1, scissors: 1 });
  state = suspendEngine(state, "p2");
  const next = advanceEngine(state, { nowMs: 500, actor: null, commands: [],
    observations: [{ ...fix("p3", 6, 500), accuracyM: 4 }] });
  expect(snapshotFor(next.state, "p1", 500).nearby).toEqual({ rock: 0, paper: 0, scissors: 0 });
});

it("creates a lobby in testing mode", () => {
  const state = createEngine({ id: "m1", hostId: "h1", createdAtMs: 0 });
  expect(state.id).toBe("m1");
  expect(state.phase).toBe("lobby");
  expect(state.mode).toBe("test");
});
