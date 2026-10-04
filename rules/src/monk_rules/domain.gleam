pub type Faction {
  Rock
  Paper
  Scissors
}

pub type Match {
  Match(
    id: String,
    host_id: String,
    created_at: Int,
    phase: String,
    mode: String,
    parameters: Option(Parameters),
    approved: Bool,
    limitations: String,
    players: List(Player),
    observations: List(Position),
    attacks: List(Attack),
    remaining: Int,
    last_at: Int,
    event_seq: Int,
    encounter_seq: Int,
    resume_at: Option(Int),
  )
}

pub type Parameters {
  Parameters(
    entry: Float,
    retention: Float,
    accuracy: Float,
    freshness: Int,
    dwell: Int,
    grace: Int,
    duration: Int,
  )
}

pub type Player {
  Player(id: String, label: String, faction: Faction, grace: Int)
}

pub type Position {
  Position(
    id: String,
    latitude: Float,
    longitude: Float,
    accuracy: Float,
    captured_at: Int,
    expires_at: Int,
    seq: Int,
  )
}

pub type Attack {
  Attack(attacker: String, target: String, started_at: Int, encounter: Int)
}

pub type Actor {
  Actor(id: String, host: Bool, player_id: Option(String))
}

pub type Command {
  Join(id: String, label: String, faction: Faction)
  Leave(id: String)
  Configure(
    mode: String,
    parameters: Parameters,
    approved: Bool,
    limitations: String,
  )
  Start
  Pause
  BeginResume
  CancelResume
  End
  SetFaction(id: String, faction: Faction)
}

pub type StepInput {
  StepInput(
    now: Int,
    actor: Option(Actor),
    commands: List(Command),
    observations: List(Position),
  )
}

pub type Event {
  Event(
    kind: String,
    attacker: Option(String),
    target: Option(String),
    faction: Option(Faction),
    reason: Option(String),
    host: Option(String),
    old_faction: Option(Faction),
    seq: Int,
    at: Int,
  )
}

pub type StepResult {
  StepResult(state: Match, events: List(Event), rejections: List(String))
}

pub type Checkpoint {
  Checkpoint(
    id: String,
    host_id: String,
    created_at: Int,
    phase: String,
    mode: String,
    parameters: Option(Parameters),
    approved: Bool,
    limitations: String,
    players: List(Player),
    remaining: Int,
    event_seq: Int,
  )
}

pub type PlayerView {
  PlayerView(
    state: Checkpoint,
    own: Option(Player),
    attacks: List(Attack),
    active: List(String),
    nearby: List(Player),
    quality: List(String),
    resume_checking: Bool,
  )
}

import gleam/option.{type Option}
