import * as rules from "../../rules/build/dev/javascript/monk_rules/monk_rules/engine.mjs";
import { Paper, Rock, Scissors } from "../../rules/build/dev/javascript/monk_rules/monk_rules/domain.mjs";
import type { Faction } from "../shared/protocol";

export type EngineState = ReturnType<typeof rules.new_match>;
const factions = { rock: new Rock(), paper: new Paper(), scissors: new Scissors() };

export function isSuperior(attacker: Faction, target: Faction): boolean {
  return rules.is_superior(factions[attacker], factions[target]);
}

export function createEngine(input: { id: string; hostId: string; createdAtMs: number }): EngineState {
  return rules.new_match(input.id, input.hostId, input.createdAtMs);
}
