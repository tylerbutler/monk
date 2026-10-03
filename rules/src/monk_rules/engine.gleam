import gleam/int
import gleam/list
import gleam/option.{None, Some}
import monk_rules/conversion
import monk_rules/domain.{
  type Checkpoint, type Faction, type Match, type Player, type PlayerView,
  type StepInput, type StepResult, BeginResume, CancelResume, Checkpoint,
  Configure, End, Join, Leave, Match, Pause, Player, PlayerView, SetFaction,
  Start, StepResult,
}
import monk_rules/proximity

pub fn is_superior(attacker: Faction, target: Faction) -> Bool {
  conversion.is_superior(attacker, target)
}

pub fn new_match(id: String, host_id: String, created_at: Int) -> Match {
  Match(
    id,
    host_id,
    created_at,
    "lobby",
    "test",
    None,
    False,
    "",
    "",
    [],
    [],
    [],
    600_000,
    created_at,
    0,
    0,
    None,
  )
}

fn elapsed(state: Match, now: Int) -> Match {
  let delta = case state.phase == "running" {
    True -> int.max(0, now - state.last_at)
    False -> 0
  }
  Match(
    ..state,
    remaining: int.max(0, state.remaining - delta),
    last_at: now,
    players: list.map(state.players, fn(p) {
      Player(..p, grace: int.max(0, p.grace - delta))
    }),
  )
}

fn reject(result: StepResult, reason: String) -> StepResult {
  StepResult(..result, rejections: list.append(result.rejections, [reason]))
}

fn phase(
  result: StepResult,
  next: String,
  reason: String,
  now: Int,
) -> StepResult {
  let result =
    conversion.invalidate(
      result,
      list.map(result.state.players, fn(p) { p.id }),
      reason,
      now,
    )
  let result =
    StepResult(
      ..result,
      state: Match(
        ..result.state,
        phase: next,
        resume_at: None,
        observations: case next == "running" {
          True -> result.state.observations
          False -> []
        },
      ),
    )
  conversion.emit(
    result,
    "lifecycle",
    None,
    None,
    None,
    Some(reason),
    None,
    None,
    now,
  )
}

fn active(state: Match, now: Int) -> List(Player) {
  case state.parameters {
    None -> []
    Some(p) ->
      list.filter(state.players, fn(x) {
        proximity.usable(state, x, now, p.accuracy)
      })
  }
}

fn populations(players: List(Player)) -> Bool {
  list.all([domain.Rock, domain.Paper, domain.Scissors], fn(f) {
    list.any(players, fn(p) { p.faction == f })
  })
}

fn ready(state: Match, now: Int, start: Bool) -> Bool {
  let players = active(state, now)
  case state.mode {
    "test" -> list.length(players) >= 2
    _ ->
      list.length(players) == 6
      && populations(players)
      && {
        !start
        || list.all([domain.Rock, domain.Paper, domain.Scissors], fn(f) {
          list.count(players, fn(p) { p.faction == f }) == 2
        })
      }
  }
}

fn apply_command(
  result: StepResult,
  command: domain.Command,
  input: StepInput,
) -> StepResult {
  let state = result.state
  let host = case input.actor {
    Some(actor) -> actor.host && actor.id == state.host_id
    None -> False
  }
  case command {
    Leave(id) -> {
      let allowed = case input.actor {
        Some(actor) -> host || actor.player_id == Some(id)
        None -> False
      }
      case allowed {
        False -> reject(result, "Not authorized.")
        True -> {
          let result =
            conversion.invalidate(result, [id], "Player left.", input.now)
          StepResult(
            ..result,
            state: Match(
              ..result.state,
              players: list.filter(state.players, fn(p) { p.id != id }),
              observations: list.filter(state.observations, fn(p) { p.id != id }),
            ),
          )
        }
      }
    }
    _ if !host -> reject(result, "Host authorization is required.")
    Join(id, label, faction) -> {
      case
        state.phase != "lobby"
        || list.any(state.players, fn(p) { p.id == id })
        || list.length(state.players) >= 100
      {
        True -> reject(result, "Roster is closed or player already joined.")
        False ->
          StepResult(
            ..result,
            state: Match(
              ..state,
              players: list.append(state.players, [
                Player(id, label, faction, 0),
              ]),
            ),
          )
      }
    }
    Configure(mode, parameters, approved, limitations, play_area) -> {
      case state.phase != "lobby" {
        True -> reject(result, "Settings are fixed for this round.")
        False -> {
          // Approval belongs to the supplied complete parameter set.
          StepResult(
            ..result,
            state: Match(
              ..state,
              mode: mode,
              parameters: Some(parameters),
              approved: approved && limitations != "" && state.parameters == Some(parameters),
              limitations: limitations,
              play_area: play_area,
              remaining: parameters.duration,
            ),
          )
        }
      }
    }
    Start ->
      case state.phase, state.parameters {
        "lobby", Some(_) -> {
          case
            ready(state, input.now, True)
            && state.play_area != ""
            && { state.mode == "test" || state.approved }
          {
            True -> phase(result, "running", "Round started.", input.now)
            False ->
              reject(
                result,
                "Fresh consenting players, balanced normal factions, approved parameters and play area are required.",
              )
          }
        }
        _, _ ->
          reject(result, "Set all parameters before starting a lobby round.")
      }
    Pause ->
      case state.phase == "running" {
        True -> phase(result, "paused", "Host paused the round.", input.now)
        False -> reject(result, "Round is not running.")
      }
    BeginResume ->
      case state.phase == "paused" && state.resume_at == None {
        True ->
          StepResult(
            ..result,
            state: Match(..state, observations: [], resume_at: Some(input.now)),
          )
        False -> reject(result, "Round must be paused before a resume check.")
      }
    CancelResume ->
      case state.phase == "paused" {
        True ->
          StepResult(
            ..result,
            state: Match(..state, observations: [], resume_at: None),
          )
        False -> reject(result, "Round is not paused.")
      }
    End ->
      case state.phase == "ended" {
        True -> reject(result, "Round has ended.")
        False -> phase(result, "ended", "Host ended the round.", input.now)
      }
    SetFaction(id, faction) ->
      case list.find(state.players, fn(p) { p.id == id }) {
        Error(_) -> reject(result, "Player is not in the roster.")
        Ok(player) ->
          case
            state.phase == "ended"
            || { state.mode == "normal" && state.phase != "lobby" }
          {
            True ->
              reject(
                result,
                "Manual faction changes are not allowed in this round.",
              )
            False ->
              case player.faction == faction {
                True -> result
                False -> {
                  let result =
                    conversion.invalidate(
                      result,
                      [id],
                      "Host changed faction.",
                      input.now,
                    )
                  let grace = case state.parameters, state.phase {
                    Some(p), "running" | Some(p), "paused" -> p.grace
                    _, _ -> 0
                  }
                  let result =
                    StepResult(
                      ..result,
                      state: Match(
                        ..result.state,
                        players: list.map(state.players, fn(p) {
                          case p.id == id {
                            True -> Player(..p, faction: faction, grace: grace)
                            False -> p
                          }
                        }),
                      ),
                    )
                  conversion.emit(
                    result,
                    "manual_faction_change",
                    None,
                    Some(id),
                    Some(faction),
                    None,
                    Some(state.host_id),
                    Some(player.faction),
                    input.now,
                  )
                }
              }
          }
      }
  }
}

pub fn step(state: Match, input: StepInput) -> StepResult {
  let now = int.max(state.last_at, input.now)
  let state = elapsed(state, now)
  let initial = StepResult(state, [], [])
  // Check the previous fixes before replacement: fresh endpoints cannot bridge a gap.
  let lost =
    list.filter(state.players, fn(player) {
      case list.find(state.observations, fn(p) { p.id == player.id }) {
        Ok(p) -> p.expires_at <= now
        Error(_) -> True
      }
    })
    |> list.map(fn(p) { p.id })
  let initial =
    conversion.invalidate(
      initial,
      lost,
      "Location is stale or unavailable.",
      now,
    )
  let observations =
    list.fold(input.observations, initial.state.observations, fn(all, fresh) {
      case list.any(state.players, fn(p) { p.id == fresh.id }) {
        False -> all
        True -> [fresh, ..list.filter(all, fn(p) { p.id != fresh.id })]
      }
    })
  let initial =
    StepResult(
      ..initial,
      state: Match(
        ..initial.state,
        observations: list.filter(observations, fn(p) { p.expires_at > now }),
      ),
    )
  let applied =
    list.fold(input.commands, initial, fn(r, c) { apply_command(r, c, input) })
  let applied = case applied.state.phase, applied.state.resume_at {
    "paused", Some(started) ->
      case now - started >= 10_000 {
        True -> phase(applied, "paused", "Resume check timed out.", now)
        False ->
          case ready(applied.state, now, False) {
            True -> phase(applied, "running", "Freshness check passed.", now)
            False -> applied
          }
      }
    _, _ -> applied
  }
  let applied = case applied.state.phase {
    "running" ->
      case applied.state.remaining == 0 {
        True -> phase(applied, "ended", "Round time elapsed.", now)
        False ->
          case
            applied.state.mode == "normal"
            && !populations(active(applied.state, now))
          {
            True ->
              phase(
                applied,
                "paused",
                "A faction has no fresh active player.",
                now,
              )
            False -> applied
          }
      }
    _ -> applied
  }
  let resolved = conversion.resolve(applied, now)
  case
    resolved.state.phase == "running"
    && resolved.state.mode == "normal"
    && !populations(resolved.state.players)
  {
    True -> phase(resolved, "ended", "A faction was eliminated.", now)
    False -> resolved
  }
}

pub fn forget(state: Match, player_id: String) -> Match {
  Match(
    ..state,
    observations: list.filter(state.observations, fn(p) { p.id != player_id }),
  )
}

pub fn checkpoint(state: Match, now: Int) -> Checkpoint {
  let state = elapsed(state, int.max(now, state.last_at))
  Checkpoint(
    state.id,
    state.host_id,
    state.created_at,
    state.phase,
    state.mode,
    state.parameters,
    state.approved,
    state.limitations,
    state.play_area,
    state.players,
    state.remaining,
    state.event_seq,
  )
}

pub fn restore(saved: Checkpoint, now: Int) -> Match {
  Match(
    saved.id,
    saved.host_id,
    saved.created_at,
    case saved.phase == "running" {
      True -> "paused"
      False -> saved.phase
    },
    saved.mode,
    saved.parameters,
    saved.approved,
    saved.limitations,
    saved.play_area,
    saved.players,
    [],
    [],
    saved.remaining,
    now,
    saved.event_seq,
    0,
    None,
  )
}

pub fn view_for(
  state: Match,
  player_id: option.Option(String),
  now: Int,
) -> PlayerView {
  let state = elapsed(state, int.max(now, state.last_at))
  let own = case player_id {
    None -> None
    Some(id) ->
      case list.find(state.players, fn(p) { p.id == id }) {
        Ok(p) -> Some(p)
        Error(_) -> None
      }
  }
  let active = active(state, now)
  let nearby = case own, state.parameters {
    Some(player), Some(p) ->
      case proximity.usable(state, player, now, p.accuracy) {
        False -> []
        True ->
          list.filter(active, fn(other) {
            other.id != player.id
            && proximity.upper_distance(state, player.id, other.id)
            <=. p.retention
          })
      }
    _, _ -> []
  }
  let quality = case own, state.parameters {
    None, _ -> []
    Some(_), None -> ["Parameters are not set."]
    Some(player), Some(p) ->
      case proximity.usable(state, player, now, p.accuracy) {
        True -> []
        False -> ["Location is stale, unavailable, or too uncertain."]
      }
  }
  PlayerView(
    checkpoint(state, now),
    own,
    state.attacks,
    list.map(active, fn(p) { p.id }),
    nearby,
    quality,
    state.resume_at != None,
  )
}
