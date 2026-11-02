import { expect, it } from "vitest";
import * as bridge from "../../rules/build/dev/javascript/monk_rules/monk_rules/channels.mjs";
import { Some } from "../../rules/build/dev/javascript/gleam_stdlib/gleam/option.mjs";
import type { Result } from "../../rules/build/dev/javascript/monk_rules/gleam.mjs";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.isOk()) throw new Error(JSON.stringify(result[0]));
  return result[0];
}
function frames(transition: bridge.Transition$) {
  return transition.actions.toArray().flatMap(action =>
    bridge.Action$isSendText(action) ? [JSON.parse(bridge.Action$SendText$data(action)) as unknown[]] : []);
}
function joining() {
  const state = unwrap(bridge.new_connection("epoch-1", 1_000));
  const transition = unwrap(bridge.receive_text(state,
    JSON.stringify(["join-1", "join-1", "match:ABCDEFGH", "phx_join", { hostToken: "private" }]), 1_001));
  const authorization = transition.actions.toArray().find((action): action is bridge.Authorize => bridge.Action$isAuthorize(action));
  if (!authorization) throw new Error("Missing authorization");
  return { transition, authorization };
}
function joined() {
  const { transition, authorization } = joining();
  return unwrap(bridge.join_accepted(transition.state, authorization.operation, "{}", 1_002));
}

it("uses the last heartbeat, not application traffic, for its deadline", () => {
  const state = unwrap(bridge.new_connection("epoch-1", 1_000));
  const heartbeat = unwrap(bridge.receive_text(state,
    JSON.stringify([null, "hb-1", "phoenix", "heartbeat", {}]), 2_000));
  expect(bridge.next_deadline(heartbeat.state)).toBe(62_001);
  expect(frames(heartbeat)[0]).toEqual([null, "hb-1", "phoenix", "phx_reply", { status: "ok", response: {} }]);
});
it("authorizes before joining", () => {
  const { transition, authorization } = joining();
  expect(frames(transition)).toEqual([]);
  expect(authorization.topic).toBe("match:ABCDEFGH");
  const accepted = unwrap(bridge.join_accepted(transition.state, authorization.operation, '{"identity":"verified"}', 1_002));
  expect(frames(accepted)[0]).toEqual(["join-1", "join-1", "match:ABCDEFGH", "phx_reply",
    { status: "ok", response: { identity: "verified" } }]);
});
it("replies once with the supplied ref", () => {
  const delivery = unwrap(bridge.receive_text(joined().state,
    JSON.stringify(["join-1", "request-1", "match:ABCDEFGH", "snapshot_request", {}]), 1_003));
  const action = delivery.actions.toArray().find((action): action is bridge.Deliver => bridge.Action$isDeliver(action));
  if (!action) throw new Error("Missing delivery");
  expect(action.operation).toBeInstanceOf(Some);
  const replied = unwrap(bridge.reply(delivery.state, action.operation, '{"snapshot":true}', true, 1_004));
  expect(frames(replied)[0]?.[1]).toBe("request-1");
  const duplicate = unwrap(bridge.reply(replied.state, action.operation, "{}", true, 1_005));
  expect(frames(duplicate)).toEqual([]);
});
it("waits for cleanup before replacement authorization", () => {
  const replacement = unwrap(bridge.receive_text(joined().state,
    JSON.stringify(["join-2", "join-2", "match:ABCDEFGH", "phx_join", {}]), 1_003));
  expect(replacement.actions.toArray().some(bridge.Action$isAuthorize)).toBe(false);
  const cleanup = replacement.actions.toArray().find((action): action is bridge.Cleanup => bridge.Action$isCleanup(action));
  if (!cleanup) throw new Error("Missing cleanup barrier");
  const completed = unwrap(bridge.cleaned_up(replacement.state, cleanup.operation, 1_004));
  expect(completed.actions.toArray().some(bridge.Action$isAuthorize)).toBe(true);
});
it("restores lost work as a rejoin requirement", () => {
  const pending = unwrap(bridge.receive_text(joined().state,
    JSON.stringify(["join-1", "lost", "match:ABCDEFGH", "host_command", {}]), 1_003));
  const exported = unwrap(bridge.snapshot(pending.state, 1_004));
  expect(exported).not.toContain("private");
  const restored = unwrap(bridge.restore(exported, 2_004, 1_000));
  expect(frames(restored)).toContainEqual(["join-1", null, "match:ABCDEFGH", "phx_error", {}]);
  const stale = unwrap(bridge.receive_text(restored.state,
    JSON.stringify(["join-1", "later", "match:ABCDEFGH", "snapshot_request", {}]), 2_005));
  expect(stale.actions.toArray().some(bridge.Action$isDeliver)).toBe(false);
});
it("returns malformed outbound JSON as an error without throwing", () => {
  const { transition, authorization } = joining();
  expect(bridge.join_accepted(transition.state, authorization.operation, "{", 1_002).isOk()).toBe(false);
});
