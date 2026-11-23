// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectMatch } from "./connection";
import type { ConnectionHandlers, ConnectionStatus, ServerMessage } from "../shared/protocol";
import { snapshotFor } from "../worker/engine";
import { lobbyFixture } from "../../test/fixtures";
import { TestSocket, joinReply } from "../../test/phoenix-socket";

const credentials = { matchCode: "ABCDEFGH", hostToken: "h".repeat(64), playerToken: null };
const connections: ReturnType<typeof connectMatch>[] = [];
beforeEach(() => {
  TestSocket.instances = []; vi.stubGlobal("WebSocket", TestSocket); vi.useFakeTimers();
});
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function snapshot(streamId = "stream-a", streamSeq = 1): Extract<ServerMessage, { type: "snapshot" }> {
  return { version: 1, type: "snapshot", streamId, streamSeq,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false };
}
function setup(overrides: Partial<ConnectionHandlers> = {}) {
  const statuses: ConnectionStatus[] = [], messages: ServerMessage[] = [];
  const handlers: ConnectionHandlers = {
    onMessage: message => messages.push(message), onStatus: status => statuses.push(status),
    onReady: vi.fn(), onCommandUnconfirmed: vi.fn(), ...overrides,
  };
  const connection = connectMatch(credentials, handlers); connections.push(connection);
  return { connection, socket: TestSocket.instances[0], statuses, messages, handlers };
}
function authorize(socket: TestSocket, streamId = "stream-a") {
  socket.open();
  const join = socket.decoded().findLast(frame => frame[3] === "phx_join");
  expect(join, "Phoenix join frame missing").toBeDefined();
  socket.reply(join!, joinReply(snapshot(streamId)));
}
const position = { version: 1, type: "position", report: { seq: 1, capturedAtMs: 1,
  latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } } as const;
function gap(socket: TestSocket) {
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 4,
    code: "sample", reason: "Gap", commandId: null });
}
it("waits for a validated join snapshot before becoming ready", () => {
  const { connection, socket, statuses, handlers } = setup();
  socket.open(); connection.send(position);
  expect(statuses.at(-1)?.state).not.toBe("connected");
  expect(socket.positionFrames()).toHaveLength(0);
  const join = socket.decoded()[0];
  expect(join[3]).toBe("phx_join");
  expect(join[4]).toEqual({ hostToken: credentials.hostToken, playerToken: null });
  expect(String(socket.url)).not.toContain(credentials.hostToken);
  socket.reply(join, joinReply(snapshot()));
  expect(statuses.at(-1)?.state).toBe("connected");
  expect(handlers.onReady).toHaveBeenCalledOnce();
});
it("rejects a join response without a valid private snapshot", () => {
  const { socket, statuses } = setup();
  socket.open(); socket.reply(socket.decoded()[0], { identity: {}, state: {} });
  expect(statuses.at(-1)?.state).toBe("failed");
});
it("does not buffer positions during recovery", () => {
  const { connection, socket } = setup(); authorize(socket);
  gap(socket); connection.send(position);
  expect(socket.positionFrames()).toHaveLength(0);
  const request = socket.decoded().find(frame => frame[3] === "snapshot_request")!;
  socket.reply(request, snapshot("stream-a", 5));
  expect(socket.positionFrames()).toHaveLength(0);
  connection.send({ ...position, report: { ...position.report, seq: 2 } });
  expect(socket.positionFrames()).toHaveLength(1);
});
it("requests one snapshot per unresolved stream gap", () => {
  const { socket } = setup(); authorize(socket);
  gap(socket); gap(socket);
  socket.receive({ ...snapshot("stream-b", 1), type: "update", events: [], outcome: null });
  expect(socket.applicationFrames().filter(frame => frame.type === "snapshot_request")).toHaveLength(1);
});
it("private event-number gaps do not trigger recovery", () => {
  const { socket, messages } = setup(); authorize(socket);
  socket.receive({ ...snapshot("stream-a", 2), type: "update", outcome: null,
    events: [{ type: "lifecycle", eventSeq: 99, atMs: 0, attackerId: null, targetId: null,
      faction: null, reason: "Paused", hostId: null, oldFaction: null }] });
  expect(messages.at(-1)?.type).toBe("update");
  expect(socket.applicationFrames().filter(frame => frame.type === "snapshot_request")).toHaveLength(0);
});
it("ignores replies from an obsolete socket or join", () => {
  const { connection, socket, messages } = setup(); authorize(socket);
  connection.send({ version: 1, type: "host_command", commandId: "stable", command: { type: "pause" } });
  const command = socket.decoded().find(frame => frame[3] === "host_command")!;
  socket.close(1006); vi.advanceTimersByTime(10);
  const replacement = TestSocket.instances.at(-1)!; authorize(replacement, "stream-new");
  const count = messages.length;
  socket.reply(command, { ...snapshot("stream-a", 2), type: "update", events: [],
    outcome: { commandId: "stable", accepted: true, reason: "Old" } });
  replacement.receiveFrame([command[0], command[1], command[2], "phx_reply", { status: "ok", response: snapshot("wrong", 20) }]);
  expect(messages).toHaveLength(count);
});
it("missing heartbeat replies trigger reconnect and stop position sends", () => {
  const { socket, statuses, connection } = setup(); authorize(socket);
  vi.advanceTimersByTime(25_000);
  expect(socket.decoded().filter(frame => frame[3] === "heartbeat")).toHaveLength(1);
  vi.advanceTimersByTime(25_000);
  connection.send(position);
  expect(statuses.at(-1)?.state).toBe("reconnecting");
  expect(socket.positionFrames()).toHaveLength(0);
  vi.advanceTimersByTime(10);
  expect(TestSocket.instances).toHaveLength(2);
});
it("a timed-out snapshot request reconnects instead of remaining blocked", () => {
  const { connection, socket, statuses } = setup(); authorize(socket); gap(socket);
  vi.advanceTimersByTime(5000);
  expect(TestSocket.instances).toHaveLength(2);
  const replacement = TestSocket.instances.at(-1)!; authorize(replacement, "fresh");
  expect(statuses.at(-1)?.state).toBe("connected");
  connection.send(position);
  expect(replacement.positionFrames()).toHaveLength(1);
});
it("keeps a requested diagnostic clock timeout from failing the connection", () => {
  const { connection, socket, statuses } = setup(); authorize(socket);
  connection.send({ version: 1, type: "clock_probe", nonce: "diagnostic", clientSendMs: Date.now() });
  vi.advanceTimersByTime(5000); connection.send(position);
  expect(statuses.filter(status => status.state === "failed")).toEqual([]);
  expect(socket.positionFrames()).toHaveLength(1);
});
it("keeps invalid diagnostic clock replies from stopping ordinary reports", () => {
  const { connection, socket, statuses } = setup(); authorize(socket);
  connection.send({ version: 1, type: "clock_probe", nonce: "diagnostic", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "clock_reply", streamId: "stream-a", streamSeq: 2,
    nonce: "wrong", clientSendMs: Date.now(), serverReceiveMs: Date.now(), serverSendMs: Date.now() });
  connection.send(position);
  expect(statuses.filter(status => status.state === "failed")).toEqual([]);
  expect(socket.positionFrames()).toHaveLength(1);
});
it("retries a lost command reply five times with the same ID then reports unconfirmed", () => {
  const { connection, socket, handlers, statuses } = setup(); authorize(socket);
  connection.send({ version: 1, type: "host_command", commandId: "stable-id", command: { type: "pause" } });
  vi.advanceTimersByTime(25_000);
  const commands = socket.applicationFrames().filter(frame => frame.type === "host_command");
  expect(commands).toHaveLength(5);
  expect(commands.every(frame => frame.commandId === "stable-id")).toBe(true);
  expect(handlers.onCommandUnconfirmed).toHaveBeenCalledExactlyOnceWith("stable-id");
  expect(statuses.at(-1)?.state).toBe("connected");
});
it.each(["forbidden", "invalid_message", "command_limit"])("does not retry the final rejection %s", code => {
  const { connection, socket } = setup(); authorize(socket);
  connection.send({ version: 1, type: "host_command", commandId: "final", command: { type: "pause" } });
  socket.reply(socket.decoded().find(frame => frame[3] === "host_command")!,
    { version: 1, type: "error", streamId: "stream-a", streamSeq: 2, code, reason: "Rejected", commandId: "final" }, "error");
  vi.advanceTimersByTime(15_000);
  expect(socket.applicationFrames().filter(frame => frame.type === "host_command")).toHaveLength(1);
});
it("retries storage failures but treats a saved rejected outcome as final", () => {
  const { connection, socket } = setup(); authorize(socket);
  connection.send({ version: 1, type: "host_command", commandId: "stable", command: { type: "pause" } });
  const request = socket.decoded().find(frame => frame[3] === "host_command")!;
  socket.reply(request, { version: 1, type: "error", streamId: "stream-a", streamSeq: 2,
    code: "storage_failed", reason: "Retry", commandId: "stable" }, "error");
  const commands = socket.decoded().filter(frame => frame[3] === "host_command");
  expect(commands).toHaveLength(2);
  socket.reply(commands[1], { ...snapshot("stream-a", 3), type: "update", events: [],
    outcome: { commandId: "stable", accepted: false, reason: "Not allowed" } });
  vi.advanceTimersByTime(15_000);
  expect(socket.applicationFrames().filter(frame => frame.type === "host_command")).toHaveLength(2);
});
function advanceConnected(socket: TestSocket, duration: number) {
  let cursor = socket.frames.length;
  for (let elapsed = 0; elapsed < duration; elapsed += 1000) {
    vi.advanceTimersByTime(Math.min(1000, duration - elapsed));
    const frames = socket.decoded();
    for (const frame of frames.slice(cursor)) if (frame[3] === "heartbeat") socket.reply(frame, {});
    cursor = frames.length;
  }
}
it("renews the clock through a long consented trial and stops renewing when the trial ends", () => {
  const { connection, socket } = setup(); authorize(socket);
  const state = snapshot("stream-a", 2);
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  let streamSeq = 2;
  function confirm() {
    const probe = socket.applicationFrames().filter(m => m.type === "clock_probe").at(-1)!;
    if (typeof probe.nonce !== "string" || typeof probe.clientSendMs !== "number") throw new Error("Missing clock probe");
    socket.receive({ version: 1, type: "clock_reply", streamId: "stream-a", streamSeq: ++streamSeq,
      nonce: probe.nonce, clientSendMs: probe.clientSendMs, serverReceiveMs: Date.now(), serverSendMs: Date.now() });
    socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: ++streamSeq,
      clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  }
  confirm();
  for (let count = 2; count <= 4; count++) {
    advanceConnected(socket, 20000);
    expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(count);
    confirm();
  }
  socket.receive({ ...state, streamSeq: ++streamSeq, trial: null });
  const count = socket.applicationFrames().filter(m => m.type === "clock_probe").length;
  advanceConnected(socket, 60000);
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(count);
});

it("retries an expired diagnostic clock without probing ordinary gameplay or after close", () => {
  const { connection, socket } = setup(); authorize(socket);
  const state = snapshot("stream-a", 2);
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 3,
    code: "clock_invalid", reason: "Clock is invalid.", commandId: null });
  vi.advanceTimersByTime(5000);
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(2);
  connection.close();
  const count = socket.frames.length;
  vi.advanceTimersByTime(60000);
  expect(socket.frames).toHaveLength(count);
});
it("refreshes a clock that expired while waiting for the other player's consent", () => {
  const { connection, socket } = setup(); authorize(socket);
  const state = snapshot("stream-a", 2);
  const waiting = { ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"] as [string, string], readyIds: ["p1"], collecting: false, referenceM: 4 } };
  socket.receive(waiting);
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: 3,
    clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  advanceConnected(socket, 60000);
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(1);
  socket.receive({ ...waiting, streamSeq: 4,
    trial: { ...waiting.trial, readyIds: ["p1", "p2"], collecting: true } });
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(2);
});
it("starts the consented trial clock when collecting first appears in a recovery snapshot", () => {
  const { connection, socket, statuses } = setup(); authorize(socket);
  const waiting = { ...snapshot("stream-a", 2), snapshot: {
    ...snapshot().snapshot, ownPlayerId: "p1",
  }, trial: { playerIds: ["p1", "p2"] as [string, string], readyIds: ["p1"], collecting: false, referenceM: 4 } };
  socket.receive(waiting);
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: 3,
    clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 6,
    code: "sample", reason: "Gap", commandId: null });
  const request = socket.decoded().find(frame => frame[3] === "snapshot_request")!;
  socket.reply(request, { ...waiting, streamSeq: 7,
    trial: { ...waiting.trial, readyIds: ["p1", "p2"], collecting: true } });
  expect(statuses.at(-1)?.state).toBe("connected");
  expect(socket.applicationFrames().filter(message => message.type === "clock_probe")).toHaveLength(2);
});
it("retries a timed-out trial probe but cancels renewal immediately on local trial stop", () => {
  const { connection, socket } = setup(); authorize(socket);
  const state = snapshot("stream-a", 2);
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  vi.advanceTimersByTime(10000);
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(2);
  connection.send({ version: 1, type: "trial_end" });
  const count = socket.applicationFrames().filter(m => m.type === "clock_probe").length;
  advanceConnected(socket, 60000);
  expect(socket.applicationFrames().filter(m => m.type === "clock_probe")).toHaveLength(count);
});
it("keeps an authoritative ten-second start check connected until its outcome arrives", () => {
  const { connection, socket, statuses, handlers } = setup(); authorize(socket);
  socket.receive(snapshot("stream-a", 2));
  socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: 3,
    clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  connection.send({ version: 1, type: "host_command", commandId: "slow-start", command: { type: "start" } });
  for (let seq = 4; seq <= 13; seq++) {
    vi.advanceTimersByTime(1000);
    const current = snapshot("stream-a", seq);
    if (current.type !== "snapshot") throw new Error("Invalid test snapshot");
    socket.receive({ ...current, startChecking: true });
  }
  expect(statuses.filter(s => s.state === "failed")).toHaveLength(0);
  expect(handlers.onCommandUnconfirmed).not.toHaveBeenCalled();
  socket.receive({ version: 1, type: "update", streamId: "stream-a", streamSeq: 14,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false, events: [],
    outcome: { commandId: "slow-start", accepted: false, reason: "Freshness check timed out." } });
  const count = socket.applicationFrames().filter(f => f.type === "host_command").length;
  vi.advanceTimersByTime(15000);
  expect(socket.applicationFrames().filter(f => f.type === "host_command")).toHaveLength(count);
});
it("disposal stops request callbacks, reconnects and heartbeats", () => {
  const { connection, socket, handlers } = setup(); authorize(socket);
  connection.send({ version: 1, type: "host_command", commandId: "disposed", command: { type: "pause" } });
  connection.close();
  const count = socket.frames.length;
  vi.advanceTimersByTime(120_000);
  expect(socket.frames).toHaveLength(count);
  expect(TestSocket.instances).toHaveLength(1);
  expect(handlers.onCommandUnconfirmed).not.toHaveBeenCalled();
});
