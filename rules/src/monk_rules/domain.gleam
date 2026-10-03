pub type Faction {
  Rock
  Paper
  Scissors
}

pub type Match {
  Match(id: String, host_id: String, created_at: Int, phase: String, mode: String)
}
