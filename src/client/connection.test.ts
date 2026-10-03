// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectMatch } from "./connection";
import type { ServerMessage } from "../shared/protocol";
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
  expect(JSON.parse(socket.frames[0])).toMatchObject({ type: "authenticate", hostToken: credentials.hostToken });
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
