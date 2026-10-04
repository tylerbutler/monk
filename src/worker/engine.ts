import * as rules from "../../rules/build/dev/javascript/monk_rules/monk_rules/engine.mjs";
import * as d from "../../rules/build/dev/javascript/monk_rules/monk_rules/domain.mjs";
import { toList } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";
import { None, Some } from "../../rules/build/dev/javascript/gleam_stdlib/gleam/option.mjs";
import { checkpointSchema, engineInputSchema, eventSchema, snapshotSchema } from "../shared/protocol";
import type { DomainCommand, EngineCheckpoint, EngineEvent, EngineInput, Faction, Observation, PlayerSnapshot, RuleParameters } from "../shared/protocol";
import { gameObservation, positionAgeMs } from "./locations";
import type { KnownPosition } from "./locations";

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
    case "configure": return d.Command$Configure(c.mode, toParameters(c.parameters), c.approved, c.deviceLimitations);
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
    deviceLimitations: c.limitations, players: c.players.toArray().map(player),
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
    option(c.parameters && toParameters(c.parameters)), c.approved, c.deviceLimitations,
    toList(c.players.map(p => d.Player$Player(p.id, p.label, factions[p.faction], p.graceMs))), c.remainingMs, c.eventSeq), nowMs);
}
function radarFor(state: EngineState, c: EngineCheckpoint, playerId: string | null, nowMs: number, canHost: boolean,
  retained?: ReadonlyMap<string, KnownPosition>): PlayerSnapshot["radar"] {
  if (c.phase === "ended" || !c.parameters || !canHost && !c.players.some(p => p.id === playerId)) return null;
  const maxAccuracy = c.parameters.maxAccuracyM, freshnessMs = c.parameters.freshnessMs;
  const positions = retained ?? new Map(state.observations.toArray().map(p => [p.id, {
    report: { seq: p.seq, capturedAtMs: p.captured_at, latitude: p.latitude, longitude: p.longitude,
      accuracyM: p.accuracy, reportedAgeMs: Math.max(0, freshnessMs - (p.expires_at - nowMs)) },
    receivedAtMs: nowMs, sharing: p.expires_at > nowMs,
  }]));
  const ownId = c.players.find(p => p.id === playerId)?.id;
  const referenceId = ownId && positions.has(ownId) ? ownId : c.players.find(p => positions.has(p.id))?.id;
  const reference = referenceId ? positions.get(referenceId) : undefined;
  const quality = (p: KnownPosition, id: string) => ({
    ageMs: positionAgeMs(p, nowMs), accuracyM: Math.ceil(p.report.accuracyM),
    active: gameObservation(p, id, nowMs) !== null && p.report.accuracyM <= maxAccuracy,
  });
  function reason(p: KnownPosition, id: string): string | null {
    if (p.report.accuracyM > maxAccuracy) return "Location is approximate.";
    if (positionAgeMs(p, nowMs) === null) return "Location age is unknown.";
    return quality(p, id).active ? null : "Last-known position.";
  }
  return {
    reference: reference && referenceId ? { playerId: referenceId, ...quality(reference, referenceId) } : null,
    reason: reference ? null : "Waiting for a player to share location.",
    players: c.players.filter(p => p.id !== referenceId).map(player => {
      const p = positions.get(player.id);
      if (!reference || !referenceId || !p) return {
        playerId: player.id, position: null, reason: "Waiting for location.",
      };
      const radians = Math.PI / 180;
      const a = reference.report.latitude * radians, b = p.report.latitude * radians;
      const delta = (p.report.longitude - reference.report.longitude) * radians;
      const bearing = Math.atan2(Math.sin(delta) * Math.cos(b),
        Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / radians;
      return {
        playerId: player.id, reason: reason(p, player.id),
        position: {
          distanceM: Math.round(distanceBetween(
            { ...reference.report, playerId: referenceId, expiresAtMs: nowMs },
            { ...p.report, playerId: player.id, expiresAtMs: nowMs }) / 5) * 5,
          bearingDegrees: Math.round(((bearing + 360) % 360) / 45) * 45 % 360,
          ...quality(p, player.id),
        },
      };
    }),
  };
}

export function snapshotFor(state: EngineState, playerId: string | null, nowMs: number, canHost = false,
  positions?: ReadonlyMap<string, KnownPosition>): PlayerSnapshot {
  const v = rules.view_for(state, option(playerId), nowMs);
  const c = fromCheckpoint(v.state);
  const own = nullable(v.own);
  const active = new Set(v.active.toArray());
  const attacks = v.attacks.toArray().filter(a => active.has(a.attacker) && active.has(a.target)).map(a => ({
    attackerId: a.attacker, targetId: a.target,
    progress: Math.min(1, Math.max(0, (nowMs - a.started_at) / (c.parameters?.dwellMs ?? 1))),
  }));
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
    deviceLimitations: c.deviceLimitations,
    resumeChecking: v.resume_checking, canHost,
    radar: radarFor(state, c, playerId, nowMs, canHost, positions),
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
