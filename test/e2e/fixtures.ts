import { test as base, expect } from "@playwright/test";
import type { Page, WebSocket, WebSocketRoute } from "@playwright/test";
import { parseServerMessage } from "../../src/shared/protocol";
import { installGeolocation } from "./geolocation";

export type Duel = {
  host: Page;
  guest: Page;
  moveGuest(eastM: number, accuracyM?: number): Promise<void>;
};

function geolocation(eastM: number, accuracy = 1) {
  return { latitude: 0, longitude: eastM / 6371000 * 180 / Math.PI, accuracy };
}

export const test = base.extend<{
  duel: Duel;
  hostSocketRoute: ((socket: WebSocketRoute) => void) | undefined;
}>({
  hostSocketRoute: [undefined, { option: true }],
  duel: async ({ browser, baseURL, hostSocketRoute }, use) => {
    if (!baseURL) throw new Error("The duel fixture requires a local base URL.");
    const origin = new URL(baseURL).origin;
    const hostContext = await browser.newContext({
      baseURL, viewport: { width: 1280, height: 1000 },
    });
    try {
      const guestContext = await browser.newContext({
        baseURL, viewport: { width: 1280, height: 1000 },
      });
      try {
        await installGeolocation(hostContext, geolocation(0));
        await installGeolocation(guestContext, geolocation(60));
        const host = await hostContext.newPage();
        const guest = await guestContext.newPage();
        if (hostSocketRoute) await host.routeWebSocket("**/socket/websocket?**", hostSocketRoute);
        let connection: WebSocket | undefined;
        const observeConnection = (socket: WebSocket) => { connection = socket; };
        host.on("websocket", observeConnection);
        try {
          await host.goto("/");
          await host.getByLabel("Display name (optional)", { exact: true }).fill("Test Rock");
          await host.getByRole("button", { name: "Create room", exact: true }).click();
          const invite = host.locator("#room-invite-link");
          await expect(invite).toBeVisible();
          const url = await invite.getAttribute("href");
          if (!url || new URL(url).origin !== origin) throw new Error("Expected a local room invite.");
          await guest.goto(url);
          await guest.getByLabel("Display name (optional)", { exact: true }).fill("Test Scissors");
          await guest.getByRole("button", { name: "Join room", exact: true }).click();
          for (const page of [host, guest]) {
            await expect(page.locator(".radar-players li")).toHaveCount(2);
            await expect(page.locator(".radar-players")).toContainText("Test Rock");
            await expect(page.locator(".radar-players")).toContainText("Test Scissors");
            await expect(page.locator("#player-roster-toggle")).toHaveCount(0);
            expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
          }

          await host.locator("#host-tools-toggle").click();
          await host.locator("#advanced-settings-toggle").click();
          await expect(host.getByLabel("Conversion time (seconds)", { exact: true })).toHaveValue("30");
          await host.getByLabel("Conversion time (seconds)", { exact: true }).fill("5");
          await host.getByLabel("Grace period (ms)", { exact: true }).fill("1");
          if (!connection) throw new Error("The host WebSocket was not observed.");
          await Promise.all([
            connection.waitForEvent("framereceived", {
              timeout: 10000,
              predicate: frame => {
                let input: unknown;
                try { input = JSON.parse(frame.payload.toString()); }
                catch { throw new Error("The server sent invalid JSON."); }
                if (!Array.isArray(input) || input.length !== 5 ||
                  typeof input[2] !== "string" || !input[2].startsWith("match:")) return false;
                const payload: unknown = input[4];
                const application = input[3] === "phx_reply" && typeof payload === "object" &&
                  payload !== null && "response" in payload ? payload.response : payload;
                const parsed = parseServerMessage(application);
                if (!parsed.ok) return false;
                const message = parsed.value;
                if (message.type !== "update" || !message.outcome) return false;
                if (!message.outcome.accepted) throw new Error(`Round settings rejected: ${message.outcome.reason}`);
                return message.snapshot.parameters?.dwellMs === 5000 &&
                  message.snapshot.parameters.graceMs === 1;
              },
            }),
            host.getByRole("button", { name: "Save round settings", exact: true }).click(),
          ]);
          await host.locator("#faction-controls-toggle").click();
          await host.getByLabel("Faction for Test Scissors", { exact: true }).selectOption("scissors");
          await expect(host.locator(".own-faction h2")).toHaveText("Rock");
          await expect(guest.locator(".own-faction h2")).toHaveText("Scissors");
          await host.locator("#room-invite").getByRole("button", { name: "Start game", exact: true }).click();
          for (const page of [host, guest]) {
            await expect(page.getByText("Round running", { exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Share location", exact: true })).toBeVisible();
          }
          await host.getByRole("button", { name: "Share location", exact: true }).click();
          await guest.getByRole("button", { name: "Share location", exact: true }).click();
          for (const page of [host, guest]) await page.locator("#radar-details-toggle").click();
          await expect(host.locator(".radar-players")).toContainText("about 60 m E");
          await expect(guest.locator(".radar-players")).toContainText("about 60 m W");
          await use({
            host, guest,
            moveGuest: (eastM, accuracyM = 1) => guest.evaluate(
              coordinates => window.monkTestGeolocation.setPosition(coordinates), geolocation(eastM, accuracyM)),
          });
        } finally {
          try {
            const endRound = host.locator('[data-action="end"]');
            if (await endRound.count()) {
              if (!(await endRound.isVisible())) await host.locator("#host-tools-toggle").click();
              await endRound.click();
              await expect(host.getByText("Round ended", { exact: true })).toBeVisible();
            }
          } finally {
            host.off("websocket", observeConnection);
          }
        }
      } finally {
        await guestContext.close();
      }
    } finally {
      await hostContext.close();
    }
  },
});

export { expect };
