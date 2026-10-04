import { SELF } from "cloudflare:test";
import { sessionCredentialsSchema, parseServerMessage } from "../../src/shared/protocol";
import type { ClientMessage, HostCommand, RuleParameters, ServerMessage, SessionCredentials } from "../../src/shared/protocol";
import { parameters } from "../fixtures";

export const sockets: WebSocket[] = [];
export async function createMatch(label?: string): Promise<SessionCredentials> {
  const response = await SELF.fetch("https://monk.test/api/matches", { method: "POST", body: JSON.stringify({ label }) });
  if (!response.ok) throw new Error(await response.text());
  return sessionCredentialsSchema.parse(await response.json());
}
export async function joinMatch(code: string, hostToken: string | null = null): Promise<SessionCredentials> {
  const response = await SELF.fetch(`https://monk.test/api/matches/${code}/join`, {
    method: "POST", body: JSON.stringify({ label: "Test player", hostToken }),
  });
  if (!response.ok) throw new Error(await response.text());
  return sessionCredentialsSchema.parse(await response.json());
}
export async function openSocket(code: string) {
  const response = await SELF.fetch(`https://monk.test/api/matches/${code}/socket`, {
    headers: { Upgrade: "websocket", Origin: "https://monk.test" },
  });
  const candidate = response.webSocket;
  if (!candidate) throw new Error(`Socket failed: ${response.status} ${await response.text()}`);
  const socket = candidate;
  socket.accept();
  sockets.push(socket);
  const messages: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener("message", event => {
    const parsed = parseServerMessage(JSON.parse(String(event.data)));
    if (!parsed.ok) throw new Error(parsed.error);
    messages.push(parsed.value);
    for (const wake of waiters) wake();
  });
  async function next<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const index = messages.findIndex(m => m.type === type);
      if (index >= 0) {
        const message = messages.splice(index, 1)[0];
        if (message.type === type) return message as Extract<ServerMessage, { type: T }>;
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { waiters.delete(wake); reject(new Error(`No ${type} reply`)); }, 3000);
        function wake() { clearTimeout(timeout); waiters.delete(wake); resolve(); }
        waiters.add(wake);
      });
    }
  }
  function send(message: ClientMessage) { socket.send(JSON.stringify(message)); }
  return { socket, send, next, messages };
}
export async function connect(credentials: SessionCredentials) {
  const client = await openSocket(credentials.matchCode);
  client.send({ version: 1, type: "authenticate", hostToken: credentials.hostToken, playerToken: credentials.playerToken });
  await client.next("authenticated");
  await client.next("snapshot");
  return client;
}

export async function probe(client: Awaited<ReturnType<typeof connect>>) {
  const nonce = crypto.randomUUID();
  client.send({ version: 1, type: "clock_probe", nonce, clientSendMs: Date.now() });
  await client.next("clock_reply");
  client.send({ version: 1, type: "clock_confirm", nonce, clientReceiveMs: Date.now() });
  return client.next("clock_ready");
}
export async function closeSockets() {
  await Promise.all(sockets.splice(0).map(s => new Promise<void>(resolve => {
    if (s.readyState === WebSocket.CLOSED) { resolve(); return; }
    s.addEventListener("close", () => resolve(), { once: true });
    s.close();
  })));
}

export async function hostCommand(client: Awaited<ReturnType<typeof connect>>, command: HostCommand, commandId = crypto.randomUUID()) {
  client.send({ version: 1, type: "host_command", commandId, command });
  for (;;) {
    const message = await client.next("update");
    if (message.outcome?.commandId === commandId) return message;
  }
}
export async function runningMatch(roundDurationMs = 600000, overrides: Partial<RuleParameters> = {}) {
  const credentials = await createMatch();
  const host = await connect(credentials);
  const other = await connect(await joinMatch(credentials.matchCode));
  await hostCommand(host, { type: "configure", mode: "test", parameters: { ...parameters, ...overrides, freshnessMs: 30000, roundDurationMs },
    approved: false, deviceLimitations: "Synthetic worker tests" });
  host.send({ version: 1, type: "snapshot_request" });
  const snapshot = await host.next("snapshot");
  const ids: [string, string] = [snapshot.snapshot.roster[0].id, snapshot.snapshot.roster[1].id];
  const started = await hostCommand(host, { type: "start" });
  if (!started.outcome?.accepted) throw new Error(started.outcome?.reason);
  await Promise.all([probe(host), probe(other)]);
  const capturedAtMs = Date.now();
  host.send({ version: 1, type: "position", report: { reportedAgeMs: 0, seq: 1, capturedAtMs, latitude: 0, longitude: 0, accuracyM: 1 } });
  other.send({ version: 1, type: "position", report: { reportedAgeMs: 0, seq: 1, capturedAtMs, latitude: 0, longitude: 100 / 6371000 * 180 / Math.PI, accuracyM: 1 } });
  for (;;) { if ((await host.next("update")).snapshot.roster.every(p => p.active)) break; }
  return { credentials, host, other, ids };
}
