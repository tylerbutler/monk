import { SELF } from "cloudflare:test";
import { sessionCredentialsSchema, parseServerMessage } from "../../src/shared/protocol";
import type { ClientMessage, ServerMessage, SessionCredentials } from "../../src/shared/protocol";

export const sockets: WebSocket[] = [];
export async function createMatch(): Promise<SessionCredentials> {
  const response = await SELF.fetch("https://monk.test/api/matches", { method: "POST", body: "{}" });
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
