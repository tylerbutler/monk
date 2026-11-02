import { SELF } from "cloudflare:test";
import { Socket } from "phoenix";
import type { Channel, Push } from "phoenix";
import { joinReplySchema, parseServerMessage } from "../../src/shared/protocol";
import type { ClientMessage, JoinReply, ServerMessage, SessionCredentials } from "../../src/shared/protocol";

export const transports = new Set<WorkerTransport>();
export class WorkerTransport {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  binaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  worker: WebSocket | null = null;
  frames: unknown[][] = [];
  dropReply: ((frame: unknown[]) => boolean) | null = null;
  suppressHeartbeats = false;
  constructor(public url: string) {
    transports.add(this);
    void this.dial();
  }
  private async dial() {
    try {
      const url = new URL(this.url);
      url.protocol = "https:";
      const response = await SELF.fetch(url, { headers: { Upgrade: "websocket", Origin: url.origin } });
      if (!response.webSocket) throw new Error(`WebSocket ${response.status}`);
      this.worker = response.webSocket;
      this.worker.accept();
      this.worker.addEventListener("message", event => {
        const frame: unknown[] = JSON.parse(String(event.data));
        if (this.dropReply?.(frame)) { this.dropReply = null; return; }
        this.onmessage?.(new MessageEvent("message", { data: event.data }));
      });
      this.worker.addEventListener("close", event => {
        this.readyState = 3;
        this.onclose?.(event);
      });
      this.worker.addEventListener("error", event => this.onerror?.(event));
      if (this.readyState === 3) { this.worker.close(); return; }
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    } catch {
      this.readyState = 3;
      this.onerror?.(new Event("error"));
      this.onclose?.({ code: 1006 } as CloseEvent);
    }
  }
  send(data: string) {
    const frame: unknown[] = JSON.parse(data);
    this.frames.push(frame);
    if (this.suppressHeartbeats && frame[2] === "phoenix") return;
    this.worker?.send(data);
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    if (this.worker?.readyState === WebSocket.OPEN) this.worker.close(code, reason);
  }
}
export function receivePush(push: Push): Promise<unknown> {
  return new Promise((resolve, reject) => {
    push.receive("ok", resolve).receive("error", error => reject(new Error(JSON.stringify(error))))
      .receive("timeout", () => reject(new Error("Phoenix request timed out")));
  });
}
const clients = new Set<Socket>();
export async function openChannel(credentials: SessionCredentials, topic = `match:${credentials.matchCode}`) {
  let transport: WorkerTransport;
  class Transport extends WorkerTransport {
    constructor(url: string) { super(url); transport = this; }
  }
  const socket = new Socket(`wss://monk.test/api/matches/${credentials.matchCode}/socket`, {
    transport: Transport as unknown as typeof WebSocket,
    heartbeatIntervalMs: 25_000,
    rejoinAfterMs: () => 0,
  });
  clients.add(socket);
  socket.connect();
  const channel: Channel = socket.channel(topic, { hostToken: credentials.hostToken, playerToken: credentials.playerToken });
  const messages: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  const accept = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return;
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    messages.push(parsed.value);
    for (const wake of waiters) wake();
  };
  for (const event of ["snapshot", "update", "clock_reply", "clock_ready", "trial_sample", "error"]) channel.on(event, accept);
  let joined: JoinReply, joinCount = 0;
  const join = channel.join();
  join.receive("ok", raw => {
    joined = joinReplySchema.parse(raw);
    if (joinCount++ > 0) accept(joined.state);
  });
  try { await receivePush(join); }
  catch (error) { socket.disconnect(); clients.delete(socket); throw error; }
  async function next<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const index = messages.findIndex(message => message.type === type);
      if (index >= 0) return messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { waiters.delete(wake); reject(new Error(`No ${type} reply`)); }, 3000);
        function wake() { clearTimeout(timeout); waiters.delete(wake); resolve(); }
        waiters.add(wake);
      });
    }
  }
  function send(message: ClientMessage) {
    channel.push(message.type, message, 5000).receive("ok", accept).receive("error", accept);
  }
  return { get socket() { return transport.worker!; }, get transport() { return transport; },
    phoenix: socket, channel, get joined() { return joined; }, messages, next, send };
}
export function closeChannels() {
  for (const socket of clients) socket.disconnect();
  clients.clear();
  for (const transport of transports) transport.close();
  transports.clear();
}
