import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, runningMatch } from "./helpers";
import { receivePush } from "./phoenix-transport";
import type { MatchRecord } from "../../src/worker/storage";
import { loadRecord } from "../../src/worker/storage";

afterEach(async () => { await closeSockets(); vi.restoreAllMocks(); await reset(); });

it("returns the same room deadline on create and late join, before either socket opens", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const deadline = now + 86_400_000;
  const host = await createMatch();
  now += 86_399_000;
  const guest = await joinMatch(host.matchCode);
  expect(host).toMatchObject({ expiresAtMs: deadline });
  expect(guest).toMatchObject({ expiresAtMs: deadline });
});

it("does not create a room if its expiry alarm cannot be saved", async () => {
  const code = "ABCDEFGH";
  const stub = env.MATCHES.get(env.MATCHES.idFromName(code));
  await runInDurableObject(stub, async (instance, state) => {
    const transaction = state.storage.transaction.bind(state.storage);
    const reject = () => Promise.reject(new Error("Cannot save expiry"));
    vi.spyOn(state.storage, "setAlarm").mockImplementation(reject);
    vi.spyOn(state.storage, "transaction").mockImplementation(fn => transaction(async tx => {
      vi.spyOn(tx, "setAlarm").mockImplementation(reject);
      return fn(tx);
    }));
    await expect(instance.fetch(new Request(`https://monk.test/api/matches/${code}/create`, {
      method: "POST", body: "{}",
    }))).rejects.toThrow("Cannot save expiry");
    expect(await loadRecord(state.storage)).toBeNull();
    expect(await state.storage.getAlarm()).toBeNull();
  });
});

it("discards expired rooms during wake-up without waiting for an alarm or request", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const credentials = await createMatch();
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await evictDurableObject(stub);
  now += 86_400_000;
  expect(await runInDurableObject(stub, (_, state) => loadRecord(state.storage))).toBeNull();
});

it.each(["pause", "join"])("ends the round before a %s between its deadline and the next tick", async action => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { host, credentials } = await runningMatch(1000);
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  await runInDurableObject(stub, instance => {
    clearTimeout(Reflect.get(instance, "timer"));
    Reflect.set(instance, "timer", null);
  });
  now += 1000;
  if (action === "pause") {
    const result = await hostCommand(host, { type: "pause" });
    expect(result.outcome?.accepted).toBe(false);
    expect(result.snapshot.phase).toBe("ended");
  } else {
    const reply = await SELF.fetch(`https://monk.test/api/matches/${credentials.matchCode}/join`, { method: "POST", body: "{}" });
    expect(reply.status).toBe(409);
  }
  host.send({ version: 1, type: "snapshot_request" });
  const { snapshot } = await host.next("snapshot");
  expect(snapshot).toMatchObject({ phase: "ended", remainingMs: 0 });
  expect(snapshot.roundResults?.players).toHaveLength(2);
});

it("keeps the existing wake-up when a position broadcast changes no deadline", async () => {
  const credentials = await createMatch();
  const host = await connect(credentials);
  await connect(await joinMatch(credentials.matchCode));
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const writes = await runInDurableObject(stub, (_, state) => {
    const spy = vi.spyOn(state.storage, "setAlarm");
    return () => spy.mock.calls.length;
  });
  await receivePush(host.channel.push("position", { version: 1, type: "position",
    report: { seq: 1, capturedAtMs: Date.now(), latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs: 0 } }));
  expect(writes()).toBe(0);
});

it("delivers a committed start even if the earlier wake-up cannot be saved", async () => {
  const credentials = await createMatch();
  const host = await connect(credentials);
  const peer = await connect(await joinMatch(credentials.matchCode));
  const stub = env.MATCHES.get(env.MATCHES.idFromName(credentials.matchCode));
  const failed = await runInDurableObject(stub, (instance, state) => {
    const set = state.storage.setAlarm.bind(state.storage);
    let injected = false;
    vi.spyOn(state.storage, "setAlarm").mockImplementation(async (time, options) => {
      if (!injected && (Reflect.get(instance, "record") as MatchRecord).checkpoint.phase === "running") {
        injected = true;
        throw new Error("Cannot save alarm");
      }
      return set(time, options);
    });
    return () => injected;
  });
  const started = await hostCommand(host, { type: "start" });
  expect(started.outcome?.accepted).toBe(true);
  expect((await peer.next("update")).events.some(e => e.type === "lifecycle")).toBe(true);
  await receivePush(host.channel.push("snapshot_request", { version: 1, type: "snapshot_request" }));
  expect(failed()).toBe(true);
});
