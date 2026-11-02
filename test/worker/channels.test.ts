import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { createMatch } from "./helpers";
import { closeChannels, openChannel } from "./phoenix-transport";
import { loadRecord } from "../../src/worker/storage";

const rawSockets: WebSocket[] = [];
afterEach(async () => {
  closeChannels();
  for (const socket of rawSockets.splice(0)) if (socket.readyState === WebSocket.OPEN) socket.close();
  vi.restoreAllMocks(); await reset();
});
async function dial(code: string, search = "?vsn=2.0.0", origin: string | null = "https://monk.test") {
  return SELF.fetch(`https://monk.test/api/matches/${code}/socket/websocket${search}`, {
    headers: { Upgrade: "websocket", ...(origin === null ? {} : { Origin: origin }) },
  });
}
async function rawSocket(code: string) {
  const response = await dial(code);
  if (!response.webSocket) throw new Error(`Failed to dial: ${response.status}`);
  response.webSocket.accept(); rawSockets.push(response.webSocket);
  return response.webSocket;
}
it("joins with verified host identity and a private snapshot", async () => {
  const client = await openChannel(await createMatch());
  expect(client.joined.identity.canHost).toBe(true);
  expect(client.joined.state.type).toBe("snapshot");
  expect(client.joined.state.snapshot.ownPlayerId).not.toBeNull();
});
it.each([
  ["URL credentials", "?vsn=2.0.0&hostToken=private", 403],
  ["duplicate parameters", "?vsn=2.0.0&vsn=2.0.0", 403],
  ["unknown parameters", "?vsn=2.0.0&other=1", 403],
  ["missing version", "", 400], ["unsupported version", "?vsn=1.0.0", 400],
] as const)("rejects %s", async (_, query, status) => {
  const credentials = await createMatch();
  expect((await dial(credentials.matchCode, query)).status).toBe(status);
});
it.each([null, "https://other.test"])("rejects missing or cross-origin requests: %s", async origin => {
  expect((await dial((await createMatch()).matchCode, "?vsn=2.0.0", origin)).status).toBe(403);
});
it("requires a WebSocket upgrade", async () => {
  const credentials = await createMatch();
  expect((await SELF.fetch(`https://monk.test/api/matches/${credentials.matchCode}/socket/websocket?vsn=2.0.0`,
    { headers: { Origin: "https://monk.test" } })).status).toBe(426);
});
it("rejects wrong topics and wrong-room tokens without mutation", async () => {
  const a = await createMatch(), b = await createMatch();
  await expect(openChannel(a, "match:WRONGROOM")).rejects.toThrow("unauthorized");
  await expect(openChannel({ ...a, hostToken: b.hostToken })).rejects.toThrow("unauthorized");
  const client = await openChannel(a);
  expect(client.joined.state.snapshot.roster).toHaveLength(1);
});
it("rejects invalid application fields and event disagreement without mutation", async () => {
  const client = await openChannel(await createMatch());
  const error = new Promise<unknown>(resolve => {
    client.channel.push("host_command", { version: 1, type: "host_command", commandId: "bad",
      command: { type: "end", latitude: 10 } }).receive("error", resolve);
  });
  expect(await error).toMatchObject({ type: "error", code: "invalid_message" });
  const mismatch = new Promise<unknown>(resolve => {
    client.channel.push("position", { version: 1, type: "host_command", commandId: "mismatch",
      command: { type: "end" } }).receive("error", resolve);
  });
  expect(await mismatch).toMatchObject({ code: "invalid_message" });
  client.send({ version: 1, type: "snapshot_request" });
  expect((await client.next("snapshot")).snapshot.phase).toBe("lobby");
});
it("rejects binary frames with 1003", async () => {
  const socket = await rawSocket((await createMatch()).matchCode);
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  socket.send(new Uint8Array([0]).buffer);
  expect((await closed).code).toBe(1003);
});
it("enforces the 16 KiB UTF-8 frame boundary", async () => {
  const credentials = await createMatch();
  const socket = await rawSocket(credentials.matchCode);
  const message = '["j","j","match:' + credentials.matchCode + '","phx_join",{}]';
  const reply = new Promise<MessageEvent>(resolve => socket.addEventListener("message", resolve, { once: true }));
  socket.send(message.padEnd(16384, " "));
  expect(JSON.parse(String((await reply).data))[4]).toMatchObject({ status: "error" });
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  socket.send("é".repeat(8193));
  expect((await closed).code).toBe(1009);
});
it("unauthorized sockets expire at the five-second deadline", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const credentials = await createMatch();
  const socket = await rawSocket(credentials.matchCode);
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve, { once: true }));
  now += 5000;
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runDurableObjectAlarm(stub);
  expect((await closed).code).toBe(1008);
  expect((await runInDurableObject(stub, (_, state) => loadRecord(state.storage)))?.checkpoint.phase).toBe("lobby");
});
