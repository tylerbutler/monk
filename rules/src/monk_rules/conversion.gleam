import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order.{Eq}
import gleam/string
import monk_rules/domain.{
  type Faction, type Match, type Player, type StepResult, Attack, Event, Match,
  Paper, Player, Rock, Scissors, StepResult,
}
import monk_rules/proximity

pub fn is_superior(attacker: Faction, target: Faction) -> Bool {
  case attacker, target {
    Rock, Scissors | Paper, Rock | Scissors, Paper -> True
    _, _ -> False
  }
}

pub fn emit(
  result: StepResult,
  kind: String,
  attacker,
  target,
  faction,
  reason,
  host,
  old_faction,
  now: Int,
) -> StepResult {
  let seq = result.state.event_seq + 1
  StepResult(
    ..result,
    state: Match(..result.state, event_seq: seq),
    events: list.append(result.events, [
      Event(
        kind,
        attacker,
        target,
        faction,
        reason,
        host,
        old_faction,
        seq,
        now,
      ),
    ]),
  )
}

pub fn invalidate(
  result: StepResult,
  ids: List(String),
  reason: String,
  now: Int,
) -> StepResult {
  list.fold(result.state.attacks, result, fn(r, a) {
    case list.contains(ids, a.attacker) || list.contains(ids, a.target) {
      False -> r
      True -> {
        let r =
          StepResult(
            ..r,
            state: Match(
              ..r.state,
              attacks: list.filter(r.state.attacks, fn(x) {
                x.encounter != a.encounter
              }),
            ),
          )
        emit(
          r,
          "attack_interrupted",
          Some(a.attacker),
          Some(a.target),
          None,
          Some(reason),
          None,
          None,
          now,
        )
      }
    }
  })
}

fn reason(
  state: Match,
  a: Player,
  b: Player,
  now: Int,
  radius: Float,
) -> Option(String) {
  case state.parameters {
    None -> Some("Parameters are not set.")
    Some(p) -> {
      case
        !proximity.usable(state, a, now, p.accuracy)
        || !proximity.usable(state, b, now, p.accuracy)
      {
        True -> Some("Location is stale or unavailable.")
        False ->
          case a.grace > 0 || b.grace > 0 {
            True -> Some("Grace period.")
            False ->
              case !is_superior(a.faction, b.faction) {
                True -> Some("Faction changed.")
                False ->
                  case proximity.upper_distance(state, a.id, b.id) >. radius {
                    True -> Some("Outside confirmed range.")
                    False -> None
                  }
              }
          }
      }
    }
  }
}

pub fn resolve(result: StepResult, now: Int) -> StepResult {
  case result.state.phase, result.state.parameters {
    "running", Some(p) -> {
      let checked =
        list.fold(result.state.attacks, result, fn(r, attack) {
          let problem = case
            list.find(r.state.players, fn(x) { x.id == attack.attacker }),
            list.find(r.state.players, fn(x) { x.id == attack.target })
          {
            Ok(a), Ok(b) -> reason(r.state, a, b, now, p.retention)
            _, _ -> Some("Player left.")
          }
          case problem {
            None -> r
            Some(why) -> {
              let r =
                StepResult(
                  ..r,
                  state: Match(
                    ..r.state,
                    attacks: list.filter(r.state.attacks, fn(x) {
                      x.encounter != attack.encounter
                    }),
                  ),
                )
              emit(
                r,
                "attack_interrupted",
                Some(attack.attacker),
                Some(attack.target),
                None,
                Some(why),
                None,
                None,
                now,
              )
            }
          }
        })
      let started =
        list.fold(checked.state.players, checked, fn(r, a) {
          case list.any(r.state.attacks, fn(x) { x.attacker == a.id }) {
            True -> r
            False -> {
              let candidates =
                list.filter(r.state.players, fn(b) {
                  a.id != b.id && reason(r.state, a, b, now, p.entry) == None
                })
              let candidates =
                list.sort(candidates, fn(b, c) {
                  case
                    float_order(
                      proximity.estimated_distance(r.state, a.id, b.id),
                      proximity.estimated_distance(r.state, a.id, c.id),
                    )
                  {
                    Eq -> string.compare(b.id, c.id)
                    other -> other
                  }
                })
              case candidates {
                [] -> r
                [b, ..] -> {
                  let encounter = r.state.encounter_seq + 1
                  let attack = Attack(a.id, b.id, now, encounter)
                  let r =
                    StepResult(
                      ..r,
                      state: Match(
                        ..r.state,
                        encounter_seq: encounter,
                        attacks: list.append(r.state.attacks, [attack]),
                      ),
                    )
                  emit(
                    r,
                    "attack_started",
                    Some(a.id),
                    Some(b.id),
                    Some(a.faction),
                    None,
                    None,
                    None,
                    now,
                  )
                }
              }
            }
          }
        })
      let ready =
        started.state.attacks
        |> list.filter(fn(a) { now - a.started_at >= p.dwell })
        |> list.sort(fn(a, b) {
          case int.compare(a.started_at, b.started_at) {
            Eq -> int.compare(a.encounter, b.encounter)
            other -> other
          }
        })
      let #(accepted, _) =
        list.fold(ready, #([], []), fn(acc, a) {
          let #(attacks, targets) = acc
          case list.contains(targets, a.target) {
            True -> acc
            False -> #(list.append(attacks, [a]), [a.target, ..targets])
          }
        })
      let converted =
        list.fold(accepted, started, fn(r, a) {
          let assert Ok(attacker) =
            list.find(started.state.players, fn(x) { x.id == a.attacker })
          let r =
            StepResult(
              ..r,
              state: Match(
                ..r.state,
                players: list.map(r.state.players, fn(x) {
                  case x.id == a.target {
                    True ->
                      Player(..x, faction: attacker.faction, grace: p.grace)
                    False -> x
                  }
                }),
                attacks: list.filter(r.state.attacks, fn(x) {
                  x.encounter != a.encounter
                }),
              ),
            )
          emit(
            r,
            "conversion",
            Some(a.attacker),
            Some(a.target),
            Some(attacker.faction),
            None,
            None,
            None,
            now,
          )
        })
      invalidate(
        converted,
        list.map(accepted, fn(a) { a.target }),
        "Faction changed.",
        now,
      )
    }
    _, _ -> result
  }
}

import gleam/float

fn float_order(a: Float, b: Float) {
  float.compare(a, b)
}
