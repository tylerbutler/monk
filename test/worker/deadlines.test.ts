import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset, runInDurableObject } from "cloudflare:test";
import { closeSockets, connect, createMatch, hostCommand, joinMatch, runningMatch } from "./helpers";
import { receivePush } from "./phoenix-transport";
import type { MatchRecord } from "../../src/worker/storage";

afterEach(async () => { await closeSockets(); vi.restoreAllMocks(); await reset(); });

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
