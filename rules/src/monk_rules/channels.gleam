import beryl_protocol as protocol
import gleam/dynamic.{type Dynamic}
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import roost
import roost/frame

pub type Transition {
  Transition(state: protocol.State, actions: List(Action))
}

pub type Action {
  Authorize(operation: protocol.Operation, topic: String, payload: Dynamic)
  Deliver(
    operation: Option(protocol.Operation),
    topic: String,
    event: String,
    payload: Dynamic,
  )
  Cleanup(operation: protocol.Operation, topic: String)
  SendText(data: String)
  Disconnect(reason: String)
  Schedule(deadline: Option(Int))
}

pub type HostError {
  Protocol(protocol.Error)
  Decode(frame.DecodeError)
  Encode(frame.EncodeError)
  InvalidPayload(String)
}

@external(javascript, "./channels_ffi.mjs", "parse")
fn parse_payload(value: String) -> Result(json.Json, String)

pub fn new_connection(
  epoch: String,
  now: Int,
) -> Result(protocol.State, HostError) {
  use config <- result.try(
    protocol.with_limits(
      protocol.config(),
      max_topic_bytes: 255,
      max_event_bytes: 64,
      max_channels: 1,
      max_pending: 64,
      heartbeat_timeout_ms: 60_000,
    )
    |> result.map_error(Protocol),
  )
  protocol.new(config, epoch, now) |> result.map_error(Protocol)
}

pub fn receive_text(
  state: protocol.State,
  data: String,
  now: Int,
) -> Result(Transition, HostError) {
  use incoming <- result.try(
    roost.decode(frame.TextData(data), frame.ClientToServer)
    |> result.map_error(Decode),
  )
  use decoded <- result.try(case incoming {
    frame.Push(join_ref, ref, topic, event, frame.JsonPayload(payload)) ->
      Ok(case event, topic {
        "phx_join", _ -> protocol.Join(topic, payload, join_ref, ref)
        "phx_leave", _ -> protocol.Leave(topic, join_ref, ref)
        "heartbeat", "phoenix" -> protocol.Heartbeat(ref)
        _, _ -> protocol.Message(topic, event, payload, join_ref, ref)
      })
    _ -> Error(Decode(frame.InvalidFormat("Expected a JSON client push")))
  })
  advance(state, protocol.Receive(decoded), now)
}

pub fn join_accepted(
  state: protocol.State,
  operation: protocol.Operation,
  payload: String,
  now: Int,
) -> Result(Transition, HostError) {
  use payload <- result.try(
    parse_payload(payload) |> result.map_error(InvalidPayload),
  )
  advance(
    state,
    protocol.AcceptJoin(operation, payload, protocol.InvalidateImmediately),
    now,
  )
}

pub fn join_rejected(
  state: protocol.State,
  operation: protocol.Operation,
  payload: String,
  now: Int,
) -> Result(Transition, HostError) {
  use payload <- result.try(
    parse_payload(payload) |> result.map_error(InvalidPayload),
  )
  advance(state, protocol.RejectJoin(operation, payload), now)
}

pub fn reply(
  state: protocol.State,
  operation: Option(protocol.Operation),
  payload: String,
  succeeded: Bool,
  now: Int,
) -> Result(Transition, HostError) {
  case operation {
    None -> Ok(Transition(state, []))
    Some(operation) -> {
      use payload <- result.try(
        parse_payload(payload) |> result.map_error(InvalidPayload),
      )
      let status = case succeeded {
        True -> protocol.StatusOk
        False -> protocol.StatusError
      }
      advance(state, protocol.Reply(operation, status, payload), now)
    }
  }
}

pub fn push(
  state: protocol.State,
  topic: String,
  event: String,
  payload: String,
  now: Int,
) -> Result(Transition, HostError) {
  case protocol.channel(state, topic) {
    Error(Nil) -> Ok(Transition(state, []))
    Ok(channel) -> {
      use payload <- result.try(
        parse_payload(payload) |> result.map_error(InvalidPayload),
      )
      advance(state, protocol.Push(channel, event, payload), now)
    }
  }
}

pub fn cleaned_up(
  state: protocol.State,
  operation: protocol.Operation,
  now: Int,
) -> Result(Transition, HostError) {
  advance(state, protocol.CleanupFinished(operation), now)
}

pub fn expire(
  state: protocol.State,
  now: Int,
) -> Result(Transition, HostError) {
  advance(state, protocol.CheckDeadline, now)
}

pub fn disconnect(
  state: protocol.State,
  now: Int,
) -> Result(Transition, HostError) {
  advance(state, protocol.Disconnect(protocol.Normal), now)
}

pub fn snapshot(state: protocol.State, now: Int) -> Result(String, HostError) {
  protocol.export(state, now) |> result.map_error(Protocol)
}

pub fn restore(
  snapshot: String,
  now: Int,
  elapsed: Int,
) -> Result(Transition, HostError) {
  use restored <- result.try(
    protocol.restore(snapshot, elapsed, now) |> result.map_error(Protocol),
  )
  convert(restored.0, restored.1, [], now)
}

pub fn next_deadline(state: protocol.State) -> Int {
  protocol.next_deadline(state) |> option.unwrap(-1)
}

fn advance(
  state: protocol.State,
  input: protocol.Input,
  now: Int,
) -> Result(Transition, HostError) {
  use next <- result.try(
    protocol.step(state, input, now) |> result.map_error(Protocol),
  )
  convert(next.0, next.1, [], now)
}

fn convert(
  state: protocol.State,
  actions: List(protocol.Action),
  reversed: List(Action),
  now: Int,
) -> Result(Transition, HostError) {
  case actions {
    [] -> Ok(Transition(state, list.reverse(reversed)))
    [action, ..rest] ->
      case action {
        protocol.DeliverJoin(_, operation, topic, payload) ->
          convert(
            state,
            rest,
            [Authorize(operation, topic, payload), ..reversed],
            now,
          )
        protocol.AdmitJoin(_, operation, _) -> {
          use admitted <- result.try(
            protocol.step(
              state,
              protocol.AdmissionFinished(operation, True),
              now,
            )
            |> result.map_error(Protocol),
          )
          convert(admitted.0, list.append(admitted.1, rest), reversed, now)
        }
        protocol.Joined(_, _) -> convert(state, rest, reversed, now)
        protocol.DeliverMessage(_, topic, event, payload, operation) ->
          convert(
            state,
            rest,
            [Deliver(operation, topic, event, payload), ..reversed],
            now,
          )
        protocol.CloseChannel(_, operation, topic, _) ->
          convert(state, rest, [Cleanup(operation, topic), ..reversed], now)
        protocol.Send(outbound) -> {
          use data <- result.try(encode(outbound))
          convert(state, rest, [SendText(data), ..reversed], now)
        }
        protocol.CloseConnection(reason) ->
          convert(
            state,
            rest,
            [Disconnect(close_reason(reason)), ..reversed],
            now,
          )
        protocol.Deadline(deadline) ->
          convert(state, rest, [Schedule(deadline), ..reversed], now)
      }
  }
}

fn encode(outbound: protocol.Outbound) -> Result(String, HostError) {
  let wire = case outbound {
    protocol.ReplyMessage(join_ref, ref, topic, status, payload) ->
      reply_frame(join_ref, ref, topic, status == protocol.StatusOk, payload)
    protocol.PushMessage(topic, event, payload) ->
      frame.Push(None, None, topic, event, frame.JsonPayload(payload))
    protocol.TerminalMessage(join_ref, topic, reason) ->
      frame.Push(
        join_ref,
        None,
        topic,
        case reason {
          protocol.Fault(_) -> frame.error_event
          _ -> frame.close_event
        },
        frame.JsonPayload(json.object([])),
      )
    protocol.HeartbeatReply(ref) ->
      reply_frame(None, ref, frame.heartbeat_topic, True, json.object([]))
  }
  use encoded <- result.try(
    roost.encode(wire, frame.ServerToClient) |> result.map_error(Encode),
  )
  case encoded {
    frame.TextData(data) -> Ok(data)
    frame.BinaryData(_) -> Error(Encode(frame.InvalidBinaryPayload))
  }
}

fn reply_frame(
  join_ref: Option(String),
  ref: Option(String),
  topic: String,
  succeeded: Bool,
  payload: json.Json,
) -> frame.Frame(json.Json) {
  let status = case succeeded {
    True -> frame.StatusOk
    False -> frame.StatusError
  }
  case ref {
    Some(ref) ->
      frame.Reply(join_ref, ref, topic, status, frame.JsonPayload(payload))
    None ->
      frame.Push(
        join_ref,
        None,
        topic,
        frame.reply_event,
        frame.JsonPayload(
          json.object([
            #(
              "status",
              json.string(case succeeded {
                True -> "ok"
                False -> "error"
              }),
            ),
            #("response", payload),
          ]),
        ),
      )
  }
}

fn close_reason(reason: protocol.CloseReason) -> String {
  case reason {
    protocol.Normal -> "normal"
    protocol.Shutdown -> "shutdown"
    protocol.HeartbeatTimeout -> "heartbeat_timeout"
    protocol.Fault(reason) -> reason
  }
}
