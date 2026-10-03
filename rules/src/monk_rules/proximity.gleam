import gleam/float
import gleam/list
import monk_rules/domain.{type Match, type Player, type Position}

@external(javascript, "./math.mjs", "sin")
fn sin(x: Float) -> Float

@external(javascript, "./math.mjs", "cos")
fn cos(x: Float) -> Float

@external(javascript, "./math.mjs", "sqrt")
fn sqrt(x: Float) -> Float

@external(javascript, "./math.mjs", "atan2")
fn atan2(y: Float, x: Float) -> Float

pub fn distance_between(a: Position, b: Position) -> Float {
  let radians = 0.017453292519943295
  let lat = sin({ b.latitude -. a.latitude } *. radians /. 2.0)
  let lon = sin({ b.longitude -. a.longitude } *. radians /. 2.0)
  let h =
    float.min(
      1.0,
      float.max(
        0.0,
        lat
          *. lat
          +. cos(a.latitude *. radians)
          *. cos(b.latitude *. radians)
          *. lon
          *. lon,
      ),
    )
  12_742_000.0 *. atan2(sqrt(h), sqrt(1.0 -. h))
}

pub fn usable(state: Match, player: Player, now: Int, accuracy: Float) -> Bool {
  list.any(state.observations, fn(p) {
    p.id == player.id && p.expires_at > now && p.accuracy <=. accuracy
  })
}

pub fn upper_distance(state: Match, a: String, b: String) -> Float {
  case
    list.find(state.observations, fn(p) { p.id == a }),
    list.find(state.observations, fn(p) { p.id == b })
  {
    Ok(x), Ok(y) -> distance_between(x, y) +. x.accuracy +. y.accuracy
    _, _ -> 1_000_000_000.0
  }

}

pub fn estimated_distance(state: Match, a: String, b: String) -> Float {
  case
    list.find(state.observations, fn(p) { p.id == a }),
    list.find(state.observations, fn(p) { p.id == b })
  {
    Ok(x), Ok(y) -> distance_between(x, y)
    _, _ -> 1_000_000_000.0
  }
}
