import * as rules from "../../rules/build/dev/javascript/monk_rules/monk_rules/engine.mjs";
import * as d from "../../rules/build/dev/javascript/monk_rules/monk_rules/domain.mjs";
import { toList } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";
import { None, Some } from "../../rules/build/dev/javascript/gleam_stdlib/gleam/option.mjs";
import { checkpointSchema, engineInputSchema, eventSchema, snapshotSchema } from "../shared/protocol";
import type { DomainCommand, EngineCheckpoint, EngineEvent, EngineInput, Faction, Observation, PlayerSnapshot, RuleParameters } from "../shared/protocol";

export type EngineState = ReturnType<typeof rules.new_match>;
const factions = { rock: d.Faction$Rock(), paper: d.Faction$Paper(), scissors: d.Faction$Scissors() };

function faction(value: d.Faction$): Faction {
  if (d.Faction$isRock(value)) return "rock";
  if (d.Faction$isPaper(value)) return "paper";
  return "scissors";
}
function option<T>(value: T | null) { return value === null ? new None() : new Some(value); }
function nullable<T>(value: None | Some<T>): T | null { return value instanceof Some ? value[0] : null; }

function toParameters(p: RuleParameters): d.Parameters$ {
  return d.Parameters$Parameters(p.entryRadiusM, p.retentionRadiusM, p.maxAccuracyM, p.freshnessMs, p.dwellMs, p.graceMs, p.roundDurationMs);
}
function fromParameters(p: d.Parameters$ | null): RuleParameters | null {
  return p ? { entryRadiusM: p.entry, retentionRadiusM: p.retention, maxAccuracyM: p.accuracy,
    freshnessMs: p.freshness, dwellMs: p.dwell, graceMs: p.grace, roundDurationMs: p.duration } : null;
}
function position(p: Observation): d.Position$ {
  return d.Position$Position(p.playerId, p.latitude, p.longitude, p.accuracyM, p.capturedAtMs, p.expiresAtMs, p.seq);
}
function toCommand(c: DomainCommand): d.Command$ {
  switch (c.type) {
    case "join": return d.Command$Join(c.playerId, c.label, factions[c.faction]);
    case "leave": return d.Command$Leave(c.playerId);
    case "configure": return d.Command$Configure(c.mode, toParameters(c.parameters), c.approved, c.deviceLimitations, c.playArea);
    case "start": return d.Command$Start();
    case "pause": return d.Command$Pause();
    case "begin_resume": return d.Command$BeginResume();
    case "cancel_resume": return d.Command$CancelResume();
    case "end": return d.Command$End();
    case "set_faction": return d.Command$SetFaction(c.playerId, factions[c.faction]);
  }
}
function player(p: d.Player$) { return { id: p.id, label: p.label, faction: faction(p.faction), graceMs: p.grace }; }
function fromCheckpoint(c: d.Checkpoint$): EngineCheckpoint {
  return checkpointSchema.parse({
    id: c.id, hostId: c.host_id, createdAtMs: c.created_at, phase: c.phase, mode: c.mode,
    parameters: fromParameters(nullable(c.parameters)), approved: c.approved,
    deviceLimitations: c.limitations, playArea: c.play_area, players: c.players.toArray().map(player),
    remainingMs: c.remaining, eventSeq: c.event_seq,
  });
}
export type EngineTransition = { state: EngineState; events: EngineEvent[]; rejections: { reason: string }[] };

export function advanceEngine(state: EngineState, raw: EngineInput): EngineTransition {
  const input = engineInputSchema.parse(raw);
  const actor = input.actor && d.Actor$Actor(input.actor.id, input.actor.host, option(input.actor.playerId));
  const result = rules.step(state, d.StepInput$StepInput(input.nowMs, option(actor), toList(input.commands.map(toCommand)), toList(input.observations.map(position))));
  return {
    state: result.state,
    events: result.events.toArray().map(e => eventSchema.parse({
      type: e.kind, attackerId: nullable(e.attacker), targetId: nullable(e.target),
      faction: e.faction instanceof Some ? faction(e.faction[0]) : null,
      reason: nullable(e.reason), hostId: nullable(e.host),
      oldFaction: e.old_faction instanceof Some ? faction(e.old_faction[0]) : null,
      eventSeq: e.seq, atMs: e.at,
    })),
    rejections: result.rejections.toArray().map(reason => ({ reason })),
  };
}

export function checkpointEngine(state: EngineState, nowMs: number): EngineCheckpoint {
  return fromCheckpoint(rules.checkpoint(state, nowMs));
}
export function restoreEngine(raw: EngineCheckpoint, nowMs: number): EngineState {
  const c = checkpointSchema.parse(raw);
  return rules.restore(d.Checkpoint$Checkpoint(c.id, c.hostId, c.createdAtMs, c.phase, c.mode,
    option(c.parameters && toParameters(c.parameters)), c.approved, c.deviceLimitations, c.playArea,
    toList(c.players.map(p => d.Player$Player(p.id, p.label, factions[p.faction], p.graceMs))), c.remainingMs, c.eventSeq), nowMs);
}
export function snapshotFor(state: EngineState, playerId: string | null, nowMs: number): PlayerSnapshot {
  const v = rules.view_for(state, option(playerId), nowMs);
  const c = fromCheckpoint(v.state);
  const own = nullable(v.own);
  const attacks = v.attacks.toArray().map(a => ({
    attackerId: a.attacker, targetId: a.target,
    progress: Math.min(1, Math.max(0, (nowMs - a.started_at) / (c.parameters?.dwellMs ?? 1))),
  }));
  const active = new Set(v.active.toArray());
  const nearby = v.nearby.toArray();
  return snapshotSchema.parse({
    matchId: c.id, phase: c.phase, mode: c.mode, ownPlayerId: own?.id ?? null,
    ownFaction: own ? faction(own.faction) : null,
    roster: c.players.map(p => ({ ...p, active: active.has(p.id) })),
    remainingMs: c.remainingMs, graceMs: own?.grace ?? null,
    outgoing: attacks.find(a => a.attackerId === playerId) ?? null,
    incoming: attacks.filter(a => a.targetId === playerId),
    nearby: { rock: nearby.filter(p => faction(p.faction) === "rock").length,
      paper: nearby.filter(p => faction(p.faction) === "paper").length,
      scissors: nearby.filter(p => faction(p.faction) === "scissors").length },
    qualityReasons: v.quality.toArray(), parameters: c.parameters, approved: c.approved,
    deviceLimitations: c.deviceLimitations, playArea: c.playArea,
    resumeChecking: v.resume_checking, canHost: false,
  });
}
export function distanceBetween(a: Observation, b: Observation): number {
  return proximity.distance_between(position(a), position(b));
}
export function suspendEngine(state: EngineState, playerId: string): EngineState {
  return rules.forget(state, playerId);
}

import * as proximity from "../../rules/build/dev/javascript/monk_rules/monk_rules/proximity.mjs";

export function isSuperior(attacker: Faction, target: Faction): boolean {
  return rules.is_superior(factions[attacker], factions[target]);
}

export function createEngine(input: { id: string; hostId: string; createdAtMs: number }): EngineState {
  return rules.new_match(input.id, input.hostId, input.createdAtMs);
}
