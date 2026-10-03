import monk_rules/domain.{type Faction, type Match, Match, Paper, Rock, Scissors}

pub fn is_superior(attacker: Faction, target: Faction) -> Bool {
  case attacker, target {
    Rock, Scissors | Paper, Rock | Scissors, Paper -> True
    _, _ -> False
  }
}

pub fn new_match(id: String, host_id: String, created_at: Int) -> Match {
  Match(id, host_id, created_at, "lobby", "test")
}
