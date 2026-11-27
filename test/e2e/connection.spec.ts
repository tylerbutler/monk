import { test as base, expect } from "./fixtures";
import type { Page, WebSocketRoute } from "@playwright/test";
import { joinReplySchema, parseServerMessage } from "../../src/shared/protocol";

function recoveryWire() {
  const joins: { playerId: string | null; topic: string; streamId: string }[] = [];
  const commands = new Map<string, number>();
  let connection: { client: WebSocketRoute; server: WebSocketRoute } | null = null;
  let dropCommandReply = false, holdJoin = false;
  let resumeJoin: (() => void) | null = null;
  let droppedCommandId: string | null = null, positions = 0, lastPositionSeq = 0;
  let rosterAfterUpdate: string[] | null = null;
  function close() {
    if (!connection) throw new Error("Missing match connection.");
    connection.client.close({ code: 1012, reason: "Recovery test" });
    connection.server.close({ code: 1012, reason: "Recovery test" });
  }
  return {
    joins, commands, close,
    get positions() { return positions; },
    get lastPositionSeq() { return lastPositionSeq; },
    get droppedCommandId() { return droppedCommandId; },
    get holdingJoin() { return resumeJoin !== null; },
    get rosterAfterUpdate() { return rosterAfterUpdate; },
    dropNextCommandReply() { dropCommandReply = true; },
    holdNextJoin() { holdJoin = true; },
    releaseJoin() { const resume = resumeJoin; resumeJoin = null; holdJoin = false; resume?.(); },
    route(client: WebSocketRoute) {
      const server = client.connectToServer();
      connection = { client, server };
      client.onMessage(raw => {
        const [, , , event, payload] = JSON.parse(raw.toString());
        if (event === "position") { positions++; lastPositionSeq = payload.report.seq; }
        if (event === "host_command") commands.set(payload.commandId, (commands.get(payload.commandId) ?? 0) + 1);
        server.send(raw);
      });
      server.onMessage(raw => {
        const [, , topic, event, payload] = JSON.parse(raw.toString());
        if (event === "update") {
          const parsed = parseServerMessage(payload);
          if (parsed.ok && parsed.value.type === "update") rosterAfterUpdate = parsed.value.snapshot.roster.map(player => player.id);
        }
        if (event === "phx_reply") {
          const join = joinReplySchema.safeParse(payload.response);
          if (join.success) {
            joins.push({ playerId: join.data.identity.playerId, topic, streamId: join.data.state.streamId });
            if (holdJoin) { resumeJoin = () => client.send(raw); return; }
          }
          const parsed = parseServerMessage(payload.response);
          if (dropCommandReply && parsed.ok && parsed.value.type === "update" && parsed.value.outcome) {
            droppedCommandId = parsed.value.outcome.commandId;
            dropCommandReply = false; close(); return;
          }
        }
        client.send(raw);
      });
    },
  };
}

const test = base.extend<{ wire: ReturnType<typeof recoveryWire> }>({
  wire: async ({}, use) => { await use(recoveryWire()); },
  hostSocketRoute: async ({ wire }, use) => { await use(socket => wire.route(socket)); },
});

async function visibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate(state => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("rejoins the same player and retries a lost reply without a second change or celebration", async ({ duel, wire }) => {
  const { host, guest } = duel, original = wire.joins[0];
  await duel.moveGuest(10);
  const notice = host.getByRole("status", { name: "Conversion notification", exact: true });
  await expect(notice).toContainText("You converted Test Scissors to Rock.");
  await host.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await duel.moveGuest(60);
  await expect(host.locator(".radar-players")).toContainText("about 60 m E");

  wire.dropNextCommandReply();
  await host.getByLabel("Faction for Test Scissors", { exact: true }).selectOption("paper");
  await expect.poll(() => wire.joins.length).toBe(2);
  await expect.poll(() => wire.droppedCommandId && wire.commands.get(wire.droppedCommandId)).toBe(2);
  expect(wire.joins[1]).toMatchObject({ playerId: original.playerId, topic: original.topic });
  expect(wire.joins[1].streamId).not.toBe(original.streamId);
  await expect(host.getByText("Connection: connected", { exact: true })).toHaveCount(1);
  await expect(guest.locator(".own-faction h2")).toHaveText("Paper");
  await expect(host.locator(".radar-players li")).toHaveCount(1);
  await expect(host.locator(".radar-players")).toContainText("Test Scissors");
  await host.locator("#faction-history-toggle").click();
  await expect(host.locator("#faction-history li")).toHaveCount(3);
  await expect(host.locator(".conversion-notice, .conversion-takeover, #award-ceremony")).toHaveCount(0);
});

test("hidden recovery sends no positions before visibility, readiness, consent, and another report", async ({ duel, wire }) => {
  const { host } = duel, positions = wire.positions, lastSeq = wire.lastPositionSeq;
  wire.holdNextJoin(); wire.close();
  await expect.poll(() => wire.holdingJoin).toBe(true);
  await visibility(host, "hidden");
  await host.evaluate(() => window.monkTestGeolocation.setPosition({ latitude: 0, longitude: 0.0002, accuracy: 1 }));
  expect(wire.positions).toBe(positions);
  wire.releaseJoin();
  await expect(host.getByText("Connection: connected", { exact: true })).toHaveCount(1);
  expect(wire.positions).toBe(positions);
  expect(wire.lastPositionSeq).toBe(lastSeq);

  const stopSharing = host.getByRole("button", { name: "Stop sharing", exact: true });
  if (await stopSharing.count()) await stopSharing.click();
  await visibility(host, "visible");
  await expect(host.getByRole("button", { name: "Share location", exact: true })).toBeVisible();
  expect(wire.positions).toBe(positions);
  await host.getByRole("button", { name: "Share location", exact: true }).click();
  await expect.poll(() => wire.positions).toBe(positions + 1);
  await host.evaluate(() => window.monkTestGeolocation.setPosition({
    latitude: 0, longitude: 5 / 6371000 * 180 / Math.PI, accuracy: 1,
  }));
  await expect.poll(() => wire.positions).toBe(positions + 2);
  expect(wire.lastPositionSeq).toBeGreaterThan(lastSeq);
  await expect(host.locator(".radar-players")).toContainText("about 55 m E");
  await expect(host.locator(".conversion-notice, .conversion-takeover, #award-ceremony")).toHaveCount(0);
});

test("leaving during reconnect removes the player when the channel is ready", async ({ page, wire }) => {
  await page.routeWebSocket("**/socket/websocket?**", socket => wire.route(socket));
  await page.goto("/");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect.poll(() => wire.joins.length).toBe(1);
  wire.holdNextJoin(); wire.close();
  await expect.poll(() => wire.holdingJoin).toBe(true);
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(page.getByText(/^Leaving the room\. Waiting for server confirmation/)).toBeVisible();
  wire.releaseJoin();
  await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeVisible();
  expect(wire.rosterAfterUpdate).toEqual([]);
});
