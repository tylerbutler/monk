import type { JoinReply, ServerMessage } from "../src/shared/protocol";

export type PhoenixFrame = [string | null, string | null, string, string, Record<string, unknown>];
export class TestSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  frames: string[] = [];
  constructor(public url: string | URL) {
    super(); TestSocket.instances.push(this);
  }
  override dispatchEvent(event: Event) {
    if (event.type === "open") this.onopen?.(event);
    if (event.type === "message") this.onmessage?.(event as MessageEvent);
    if (event.type === "error") this.onerror?.(event);
    if (event.type === "close") this.onclose?.(event as CloseEvent);
    return super.dispatchEvent(event);
  }
  send(frame: string) { this.frames.push(frame); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3; this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
  receiveFrame(frame: PhoenixFrame) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  reply(request: PhoenixFrame, response: unknown, status = "ok") {
    this.receiveFrame([request[0], request[1], request[2], "phx_reply", { status, response }]);
  }
  receive(message: ServerMessage) {
    const commandId = message.type === "update" ? message.outcome?.commandId :
      message.type === "error" ? message.commandId : null;
    const request = commandId ? this.decoded().findLast(frame => frame[3] === "host_command" && frame[4].commandId === commandId) : null;
    if (request) { this.reply(request, message, message.type === "error" ? "error" : "ok"); return; }
    const join = this.decoded().findLast(frame => frame[3] === "phx_join");
    this.receiveFrame([join?.[0] ?? null, null, join?.[2] ?? "match:ABCDEFGH", message.type, message]);
  }
  decoded(): PhoenixFrame[] { return this.frames.map(frame => JSON.parse(frame) as PhoenixFrame); }
  applicationFrames() { return this.decoded().filter(frame => !frame[3].startsWith("phx_") && frame[2] !== "phoenix").map(frame => frame[4]); }
  positionFrames() { return this.applicationFrames().filter(message => message.type === "position"); }
}
export function joinReply(state: Extract<ServerMessage, { type: "snapshot" }>): JoinReply {
  return { identity: { playerId: state.snapshot.ownPlayerId, canHost: state.snapshot.canHost, expiresAtMs: Date.now() + 86400000 }, state };
}
