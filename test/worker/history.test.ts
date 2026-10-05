import { afterEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { loadRecord } from "../../src/worker/storage";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, openSocket, runningMatch } from "./helpers";

afterEach(async () => { await closeSockets(); await reset(); });

it("keeps snapshot and live event fields compatible with clients that do not opt into history", async () => {
  const credentials = await createMatch("Host");
  const host = await connect(credentials);
  const legacy = await openSocket(credentials.matchCode);
  legacy.send({ version: 1, type: "authenticate", hostToken: credentials.hostToken, playerToken: credentials.playerToken });
  const authenticated = await legacy.next("authenticated");
  expect(await legacy.next("snapshot")).not.toHaveProperty("factionHistory");
  const changed = await hostCommand(host, { type: "set_faction", playerId: authenticated.playerId!, faction: "paper" });
  expect(changed.events[0]).toHaveProperty("targetLabel", "Host");
  const update = await legacy.next("update");
  expect(update.events).toHaveLength(1);
  expect(update.events[0]).toMatchObject({ type: "manual_faction_change", faction: "paper" });
  expect(update.events[0]).not.toHaveProperty("attackerLabel");
  expect(update.events[0]).not.toHaveProperty("targetLabel");
  legacy.send({ version: 1, type: "snapshot_request" });
  expect(await legacy.next("snapshot")).not.toHaveProperty("factionHistory");
});

it("restores saved faction changes with names and filters history for each player", async () => {
  const credentials = await createMatch("Host");
  const host = await connect(credentials);
  const firstCredentials = await joinMatch(credentials.matchCode);
  const first = await connect(firstCredentials);
  const secondCredentials = await joinMatch(credentials.matchCode);
  const second = await connect(secondCredentials);
  first.send({ version: 1, type: "snapshot_request" });
  second.send({ version: 1, type: "snapshot_request" });
  const firstId = (await first.next("snapshot")).snapshot.ownPlayerId!;
  const secondId = (await second.next("snapshot")).snapshot.ownPlayerId!;
  const changed = await hostCommand(host, { type: "set_faction", playerId: firstId, faction: "rock" });
  await hostCommand(host, { type: "set_faction", playerId: secondId, faction: "paper" });
  for (const [client, expectedIds] of [[host, [firstId, secondId]], [first, [firstId]], [second, [secondId]]] as const) {
    client.send({ version: 1, type: "snapshot_request" });
    const reply = await client.next("snapshot");
    expect(reply.factionHistory?.map(event => event.targetId)).toEqual(expectedIds);
    expect(reply.factionHistory?.every(event => event.type === "manual_faction_change")).toBe(true);
  }
  expect(changed.events.find(event => event.type === "manual_faction_change")).toMatchObject({
    targetLabel: "Test player", oldFaction: "paper", faction: "rock",
  });

  first.send({ version: 1, type: "leave" });
  while ((await host.next("update")).snapshot.roster.some(player => player.id === firstId)) { /* wait for leave */ }
  const restored = await connect(credentials);
  restored.send({ version: 1, type: "snapshot_request" });
  const history = (await restored.next("snapshot")).factionHistory;
  expect(history).toHaveLength(2);
  expect(history?.[0]).toMatchObject({ targetId: firstId, targetLabel: "Test player" });
  const newcomer = await connect(await joinMatch(credentials.matchCode));
  newcomer.send({ version: 1, type: "snapshot_request" });
  expect((await newcomer.next("snapshot")).factionHistory).toEqual([]);

  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const record = await runInDurableObject(stub, (_, state) => loadRecord(state.storage));
  expect(record?.events.find(event => event.targetId === firstId && event.type === "manual_faction_change"))
    .toMatchObject({ targetLabel: "Test player", faction: "rock" });
  await closeSockets();
  await evictDurableObject(stub);
  const recovered = await connect(credentials);
  recovered.send({ version: 1, type: "snapshot_request" });
  expect((await recovered.next("snapshot")).factionHistory).toEqual(history);
});

it("records conversion participants and old factions without sending other players their history", async () => {
  const { credentials, host, other, ids } = await runningMatch(600000, { dwellMs: 1000, graceMs: 1 });
  await hostCommand(host, { type: "set_faction", playerId: ids[1], faction: "scissors" });
  const outsider = await connect(await joinMatch(credentials.matchCode));
  other.send({ version: 1, type: "position", report: {
    seq: 2, capturedAtMs: Date.now(), reportedAgeMs: 0, latitude: 0, longitude: 0, accuracyM: 1,
  } });
  for (;;) {
    const message = await host.next("update");
    const event = message.events.find(event => event.type === "conversion");
    if (event) {
      expect(event).toMatchObject({ attackerId: ids[0], targetId: ids[1],
        attackerLabel: "Player 1", targetLabel: "Test player", oldFaction: "scissors", faction: "rock" });
      break;
    }
  }
  for (const client of [host, other]) {
    client.send({ version: 1, type: "snapshot_request" });
    expect((await client.next("snapshot")).factionHistory?.map(event => event.type)).toEqual(["manual_faction_change", "conversion"]);
  }
  outsider.send({ version: 1, type: "snapshot_request" });
  expect((await outsider.next("snapshot")).factionHistory).toEqual([]);
  expect(outsider.messages.filter(message => message.type === "update").flatMap(message => message.events))
    .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "conversion" })]));
});
