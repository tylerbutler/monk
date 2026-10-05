import { test as base, expect } from "@playwright/test";
import type { Page, WebSocket } from "@playwright/test";
import { parseServerMessage } from "../../src/shared/protocol";

export type Duel = {
  host: Page;
  guest: Page;
  moveGuest(eastM: number, accuracyM?: number): Promise<void>;
};

function geolocation(eastM: number, accuracy = 1) {
  return { latitude: 0, longitude: eastM / 6371000 * 180 / Math.PI, accuracy };
}

export const test = base.extend<{ duel: Duel }>({
  duel: async ({ browser, baseURL }, use) => {
    if (!baseURL) throw new Error("The duel fixture requires a local base URL.");
    const origin = new URL(baseURL).origin;
    const hostContext = await browser.newContext({
      baseURL, viewport: { width: 1280, height: 1000 }, geolocation: geolocation(0),
    });
    try {
      const guestContext = await browser.newContext({
        baseURL, viewport: { width: 1280, height: 1000 }, geolocation: geolocation(60),
      });
      try {
        await hostContext.grantPermissions(["geolocation"], { origin });
        await guestContext.grantPermissions(["geolocation"], { origin });
        const host = await hostContext.newPage();
        const guest = await guestContext.newPage();
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
            await expect(page.locator("#player-roster li")).toHaveCount(2);
            await expect(page.locator("#player-roster")).toContainText("Test Rock");
            await expect(page.locator("#player-roster")).toContainText("Test Scissors");
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
                const parsed = parseServerMessage(input);
                if (!parsed.ok) throw new Error(parsed.error);
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
          await host.getByRole("button", { name: "Start game", exact: true }).click();
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
            moveGuest: (eastM, accuracyM = 1) => guestContext.setGeolocation(geolocation(eastM, accuracyM)),
          });
        } finally {
          host.off("websocket", observeConnection);
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
