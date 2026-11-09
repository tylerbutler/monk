// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectMatch } from "./connection";
import type { ConnectionStatus, ServerMessage } from "../shared/protocol";
import { snapshotFor } from "../worker/engine";
import { lobbyFixture } from "../../test/fixtures";

class Socket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = 0;
  frames: string[] = [];
  constructor(public url: string | URL) { super(); instances.push(this); }
  send(frame: string) { this.frames.push(frame); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  receive(message: ServerMessage) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}
let instances: Socket[];
beforeEach(() => { instances = []; vi.stubGlobal("WebSocket", Socket); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const credentials = { matchCode: "ABCDEFGH", hostToken: "h".repeat(64), playerToken: null };
function auth(socket: Socket) {
  socket.open();
  socket.receive({ version: 1, type: "authenticated", streamId: "stream-a", streamSeq: 1, canHost: true, playerId: null, expiresAtMs: Date.now() + 86400000 });
}
function snapshot(streamId: string, streamSeq: number): ServerMessage {
  return { version: 1, type: "snapshot", streamId, streamSeq,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false };
}
it("authenticates in the first frame and never puts credentials in its URL", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; socket.open();
  expect(String(socket.url)).not.toContain(credentials.hostToken);
  expect(JSON.parse(socket.frames[0])).toMatchObject({
    type: "authenticate", hostToken: credentials.hostToken, supportsFactionHistory: true, supportsRoundResults: true,
  });
  connection.close();
});
it("allows authenticated reporting without a clock check", () => {
  const statuses: ConnectionStatus[] = [];
  const connection = connectMatch(credentials, { onMessage() {}, onStatus: s => statuses.push(s) });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs: 1,
    latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } });
  vi.advanceTimersByTime(30000);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toEqual([]);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "position")).toHaveLength(1);
  expect(statuses.at(-1)?.state).toBe("connected");
  connection.close();
});
it("keeps a requested diagnostic clock timeout from failing the connection", () => {
  const statuses: ConnectionStatus[] = [];
  const connection = connectMatch(credentials, { onMessage() {}, onStatus: s => statuses.push(s) });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "clock_probe", nonce: "diagnostic", clientSendMs: Date.now() });
  vi.advanceTimersByTime(5000);
  connection.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs: 1,
    latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } });
  expect(statuses.filter(s => s.state === "failed")).toEqual([]);
  expect(socket.frames.map(f => JSON.parse(f)).at(-1)?.type).toBe("position");
  connection.close();
});
it("keeps invalid diagnostic clock replies from stopping ordinary reports", () => {
  const statuses: ConnectionStatus[] = [];
  const connection = connectMatch(credentials, { onMessage() {}, onStatus: s => statuses.push(s) });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "clock_probe", nonce: "diagnostic", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "clock_reply", streamId: "stream-a", streamSeq: 3,
    nonce: "wrong", clientSendMs: Date.now(), serverReceiveMs: Date.now(), serverSendMs: Date.now() });
  connection.send({ version: 1, type: "position", report: { seq: 1, capturedAtMs: 1,
    latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } });
  expect(statuses.filter(s => s.state === "failed")).toEqual([]);
  expect(socket.frames.map(f => JSON.parse(f)).at(-1)?.type).toBe("position");
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(1);
  connection.close();
});
it("requires snapshots after stream changes or cursor gaps, not global private-event gaps", () => {
  const messages: ServerMessage[] = [];
  const connection = connectMatch(credentials, { onMessage: m => messages.push(m), onStatus() {} });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  socket.receive({ version: 1, type: "update", streamId: "stream-a", streamSeq: 3,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false, outcome: null,
    events: [{ type: "lifecycle", eventSeq: 99, atMs: 0, attackerId: null, targetId: null, faction: null, reason: "Paused", hostId: null, oldFaction: null }] });
  expect(messages.at(-1)?.type).toBe("update");
  const before = socket.frames.filter(f => JSON.parse(f).type === "snapshot_request").length;
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 5, code: "sample_error", reason: "Gap", commandId: null });
  expect(socket.frames.filter(f => JSON.parse(f).type === "snapshot_request")).toHaveLength(before + 1);
  socket.receive({ version: 1, type: "update", streamId: "stream-b", streamSeq: 1,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false, events: [], outcome: null });
  expect(socket.frames.filter(f => JSON.parse(f).type === "snapshot_request")).toHaveLength(before + 2);
  connection.close();
});
it("retries a lost command reply using the same command ID", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "host_command", commandId: "stable-id", command: { type: "pause" } });
  vi.advanceTimersByTime(1500);
  const commands = socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "host_command");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  connection.close();
});
it.each(["command_limit", "forbidden"])("does not retry the permanent %s command error or fail a healthy connection", code => {
  const statuses: ConnectionStatus[] = [];
  const connection = connectMatch(credentials, { onMessage() {}, onStatus: s => statuses.push(s) });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "host_command", commandId: "terminal", command: { type: "end" } });
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 3, code,
    reason: "Command cannot be accepted.", commandId: "terminal" });
  vi.advanceTimersByTime(9000);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "host_command")).toHaveLength(1);
  expect(statuses.at(-1)?.state).toBe("connected");
  connection.close();
});
it("keeps retrying a storage failure with the original command ID", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
  connection.send({ version: 1, type: "host_command", commandId: "retry", command: { type: "pause" } });
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 3,
    code: "storage_failed", reason: "Retry the same command ID.", commandId: "retry" });
  vi.advanceTimersByTime(1500);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "host_command").map(m => m.commandId))
    .toEqual(["retry", "retry"]);
  connection.close();
});

it("renews the clock through a long consented trial and stops renewing when the trial ends", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket);
  const state = snapshot("stream-a", 2);
  if (state.type !== "snapshot") throw new Error("Missing snapshot");
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  let streamSeq = 2;
  function confirm() {
    const probe = socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe").at(-1);
    socket.receive({ version: 1, type: "clock_reply", streamId: "stream-a", streamSeq: ++streamSeq,
      nonce: probe.nonce, clientSendMs: probe.clientSendMs, serverReceiveMs: Date.now(), serverSendMs: Date.now() });
    socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: ++streamSeq,
      clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  }
  confirm();
  for (let count = 2; count <= 4; count++) {
    vi.advanceTimersByTime(20000);
    expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(count);
    confirm();
  }
  socket.receive({ ...state, streamSeq: ++streamSeq, trial: null });
  const count = socket.frames.length;
  vi.advanceTimersByTime(60000);
  expect(socket.frames).toHaveLength(count);
  connection.close();
});

it("retries an expired diagnostic clock without probing ordinary gameplay or after close", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket);
  const state = snapshot("stream-a", 2);
  if (state.type !== "snapshot") throw new Error("Missing snapshot");
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "error", streamId: "stream-a", streamSeq: 3,
    code: "clock_invalid", reason: "Clock is invalid.", commandId: null });
  vi.advanceTimersByTime(5000);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(2);
  connection.close();
  const count = socket.frames.length;
  vi.advanceTimersByTime(60000);
  expect(socket.frames).toHaveLength(count);
});
it("refreshes a clock that expired while waiting for the other player's consent", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket);
  const state = snapshot("stream-a", 2);
  if (state.type !== "snapshot") throw new Error("Missing snapshot");
  const waiting = { ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"] as [string, string], readyIds: ["p1"], collecting: false, referenceM: 4 } };
  socket.receive(waiting);
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  socket.receive({ version: 1, type: "clock_ready", streamId: "stream-a", streamSeq: 3,
    clock: { offsetMs: 0, uncertaintyMs: 0, measuredAtMs: Date.now() } });
  vi.advanceTimersByTime(60000);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(1);
  socket.receive({ ...waiting, streamSeq: 4,
    trial: { ...waiting.trial, readyIds: ["p1", "p2"], collecting: true } });
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(2);
  connection.close();
});
it("retries a timed-out trial probe but cancels renewal immediately on local trial stop", () => {
  const connection = connectMatch(credentials, { onMessage() {}, onStatus() {} });
  const socket = instances[0]; auth(socket);
  const state = snapshot("stream-a", 2);
  if (state.type !== "snapshot") throw new Error("Missing snapshot");
  socket.receive({ ...state, snapshot: { ...state.snapshot, ownPlayerId: "p1" },
    trial: { playerIds: ["p1", "p2"], readyIds: ["p1", "p2"], collecting: true, referenceM: 4 } });
  connection.send({ version: 1, type: "clock_probe", nonce: "initial", clientSendMs: Date.now() });
  vi.advanceTimersByTime(10000);
  expect(socket.frames.map(f => JSON.parse(f)).filter(m => m.type === "clock_probe")).toHaveLength(2);
  connection.send({ version: 1, type: "trial_end" });
  const count = socket.frames.length;
  vi.advanceTimersByTime(60000);
  expect(socket.frames).toHaveLength(count);
  connection.close();
});
it("keeps an authoritative ten-second start check connected until its outcome arrives", () => {
  const statuses: ConnectionStatus[] = [];
  const connection = connectMatch(credentials, { onMessage() {}, onStatus: s => statuses.push(s) });
  const socket = instances[0]; auth(socket); socket.receive(snapshot("stream-a", 2));
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
  socket.receive({ version: 1, type: "update", streamId: "stream-a", streamSeq: 14,
    snapshot: snapshotFor(lobbyFixture(["rock", "paper"]), null, 0), trial: null, startChecking: false, events: [],
    outcome: { commandId: "slow-start", accepted: false, reason: "Freshness check timed out." } });
  const count = socket.frames.filter(f => JSON.parse(f).type === "host_command").length;
  vi.advanceTimersByTime(1500);
  expect(socket.frames.filter(f => JSON.parse(f).type === "host_command")).toHaveLength(count);
  connection.close();
});
