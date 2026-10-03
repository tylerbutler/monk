import { advanceEngine, createEngine } from "../src/worker/engine";
import type { EngineState, EngineTransition } from "../src/worker/engine";
import type { DomainCommand, Faction, MatchMode, Observation, RuleParameters } from "../src/shared/protocol";

export const parameters: RuleParameters = {
  entryRadiusM: 12, retentionRadiusM: 14, maxAccuracyM: 3,
  freshnessMs: 1500, dwellMs: 3000, graceMs: 2000, roundDurationMs: 600000,
};
export const host = { id: "h1", host: true, playerId: null };

export function command(state: EngineState, nowMs: number, ...commands: DomainCommand[]): EngineTransition {
  return advanceEngine(state, { nowMs, actor: host, commands, observations: [] });
}

export function fix(playerId: string, eastM: number, nowMs: number): Observation {
  return {
    playerId, latitude: 0, longitude: eastM / 6371000 * 180 / Math.PI,
    accuracyM: 1, capturedAtMs: nowMs, expiresAtMs: nowMs + 1500, seq: nowMs + 1,
  };
}

export function lobbyFixture(factions: Faction[], mode: MatchMode = "test"): EngineState {
  let state = createEngine({ id: "m1", hostId: "h1", createdAtMs: 0 });
  state = command(state, 0, { type: "configure", mode, parameters, approved: mode === "normal",
    deviceLimitations: "Synthetic tests only", playArea: "Marked test area" }).state;
  if (mode === "normal") state = command(state, 0, { type: "configure", mode, parameters, approved: true,
    deviceLimitations: "Synthetic tests only", playArea: "Marked test area" }).state;
  factions.forEach((faction, i) => {
    state = command(state, 0, { type: "join", playerId: `p${i + 1}`, faction, label: `Player ${i + 1}` }).state;
  });
  return state;
}

export function runningFixture(factions: Faction[], mode: MatchMode = "test"): EngineState {
  const next = advanceEngine(lobbyFixture(factions, mode), {
    nowMs: 0, actor: host, commands: [{ type: "start" }],
    observations: factions.map((_, i) => fix(`p${i + 1}`, i * 100, 0)),
  });
  if (next.rejections.length) throw new Error(JSON.stringify(next.rejections));
  return next.state;
}

export function pulse(state: EngineState, nowMs: number, eastM: number[]): EngineTransition {
  return advanceEngine(state, {
    nowMs, actor: null, commands: [],
    observations: eastM.map((east, i) => fix(`p${i + 1}`, east, nowMs)),
  });
}
