import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset, runInDurableObject } from "cloudflare:test";
import { loadRecord } from "../../src/worker/storage";
import { connect, createMatch, joinMatch, openSocket, sockets } from "./helpers";

afterEach(async () => {
  await Promise.all(sockets.splice(0).map(s => new Promise<void>(resolve => {
    if (s.readyState === WebSocket.CLOSED) { resolve(); return; }
    s.addEventListener("close", () => resolve(), { once: true });
    s.close();
  })));
  vi.restoreAllMocks();
  await reset();
});

it("a join code grants no host authority, and wrong-match tokens fail", async () => {
  const a = await createMatch(), b = await createMatch();
  const socket = await openSocket(a.matchCode);
  socket.send({ version: 1, type: "authenticate", hostToken: a.matchCode, playerToken: null });
  expect(await socket.next("error")).toMatchObject({ code: "invalid_message" });
  const joined = await connect(await joinMatch(a.matchCode));
  joined.send({ version: 1, type: "host_command", commandId: "forged-host", command: { type: "end" } });
  expect(await joined.next("error")).toMatchObject({ code: "forbidden" });
  const wrong = await openSocket(a.matchCode);
  wrong.send({ version: 1, type: "authenticate", hostToken: b.hostToken, playerToken: null });
  expect(await wrong.next("error")).toMatchObject({ code: "unauthorized" });
});
it("the host can also join as a player without gaining credentials for others", async () => {
  const host = await createMatch();
  const player = await joinMatch(host.matchCode, host.hostToken);
  expect(player.hostToken).toBeNull();
  expect(player.playerToken).toBeTruthy();
  const client = await connect({ ...player, hostToken: host.hostToken });
  client.send({ version: 1, type: "snapshot_request" });
  expect(await client.next("snapshot")).toMatchObject({ snapshot: { canHost: true, ownFaction: "rock" } });
});
it("returns visible invalid-JSON errors without logging secrets or locations", async () => {
  const logs = vi.spyOn(console, "warn");
  const host = await createMatch();
  const client = await connect(host);
  client.socket.send(`{"token":"${host.hostToken}","latitude":42.12345`);
  expect(await client.next("error")).toMatchObject({ code: "invalid_json" });
  expect(JSON.stringify(logs.mock.calls)).not.toContain(host.hostToken);
  expect(JSON.stringify(logs.mock.calls)).not.toContain("42.12345");
});
it("deduplicates command outcomes without another event or grace change", async () => {
  const host = await createMatch(), player = await joinMatch(host.matchCode);
  const client = await connect(host);
  client.send({ version: 1, type: "snapshot_request" });
  const snapshot = await client.next("snapshot");
  const playerId = snapshot.snapshot.roster[0].id;
  const message = { version: 1 as const, type: "host_command" as const, commandId: "change-1",
    command: { type: "set_faction" as const, playerId, faction: "paper" as const } };
  client.send(message);
  const original = await client.next("update");
  client.send(message);
  const retry = await client.next("update");
  expect(retry.outcome).toEqual(original.outcome);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(record?.events.filter(e => e.type === "manual_faction_change")).toHaveLength(1);
  expect(JSON.stringify(record)).not.toContain(player.playerToken);
});
it("a failed storage commit emits no successful transition", async () => {
  const host = await createMatch();
  const client = await connect(host);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  const restore = await runInDurableObject(stub, (_, state) => {
    const spy = vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("disk failure"));
    return () => spy.mockRestore();
  });
  client.send({ version: 1, type: "host_command", commandId: "end-1", command: { type: "end" } });
  expect(await client.next("error")).toMatchObject({ code: "storage_failed" });
  restore();
  client.send({ version: 1, type: "snapshot_request" });
  expect(await client.next("snapshot")).toMatchObject({ snapshot: { phase: "lobby" } });
});
it("closed rosters reject new joins and corrupt records are not treated as new matches", async () => {
  const host = await createMatch();
  const client = await connect(host);
  client.send({ version: 1, type: "host_command", commandId: "end-1", command: { type: "end" } });
  await client.next("update");
  const response = await SELF.fetch(`https://monk.test/api/matches/${host.matchCode}/join`, { method: "POST", body: "{}" });
  expect(response.status).toBe(409);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(host.matchCode));
  await runInDurableObject(stub, async (_, state) => {
    await state.storage.put("record", { broken: true });
    await expect(loadRecord(state.storage)).rejects.toThrow("Stored match record is invalid");
  });
});
it("rejects cross-origin sockets and credentials in URLs", async () => {
  const host = await createMatch();
  for (const [suffix, origin] of [["", "https://other.test"], ["?token=secret", "https://monk.test"]]) {
    const response = await SELF.fetch(`https://monk.test/api/matches/${host.matchCode}/socket${suffix}`, {
      headers: { Upgrade: "websocket", Origin: origin },
    });
    expect(response.status).toBe(403);
  }
});
