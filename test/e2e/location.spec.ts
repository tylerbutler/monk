import { test, expect } from "./fixtures";
import type { Duel } from "./fixtures";

async function expectInfluence(duel: Duel) {
  await expect(duel.host.getByRole("progressbar", {
    name: "Influencing Test Scissors", exact: true,
  })).toBeVisible();
  await expect(duel.guest.getByRole("progressbar", {
    name: "Test Rock is influencing you", exact: true,
  })).toBeVisible();
  await expect(duel.host.locator(".conversion-heading")).toHaveText("You are converting Test Scissors");
  await expect(duel.guest.locator(".conversion-heading")).toHaveText("You are being converted by Test Rock");
  for (const page of [duel.host, duel.guest]) {
    await expect(page.locator(".conversion-countdown")).toHaveText(/[1-5] s left/);
  }
}

async function expectConversion(duel: Duel) {
  await expect(duel.host.getByRole("status", {
    name: "Conversion notification", exact: true,
  })).toContainText("You converted Test Scissors to Rock.");
  await expect(duel.guest.getByRole("status", {
    name: "Conversion notification", exact: true,
  })).toContainText("Test Rock converted you to Rock.");
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
}

async function expectNoInfluence(duel: Duel) {
  for (const page of [duel.host, duel.guest]) {
    await expect(page.locator("[data-direction]")).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Conversion notification", exact: true })).toHaveCount(0);
  }
}

test("converts two independently located players through the real server", async ({ duel }) => {
  await expect(duel.host.locator(".radar-players")).toContainText("about 60 m E");
  await expect(duel.guest.locator(".radar-players")).toContainText("about 60 m W");
  await expectNoInfluence(duel);
  await duel.moveGuest(10);
  await expect(duel.host.locator(".radar-players")).toContainText("about 10 m E");
  await expectInfluence(duel);
  await expectConversion(duel);
  for (const page of [duel.host, duel.guest]) {
    await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
    await page.locator("#faction-history-toggle").click();
    const history = page.locator("#faction-history");
    await expect(history.locator("li")).toHaveCount(2);
    await expect(history).toContainText(page === duel.host ? "You converted Test Scissors to Rock." : "Test Rock converted you to Rock.");
    await expect(history.locator("li").first().locator(".faction-icon")).toHaveAttribute("data-faction", "rock");
  }
  await duel.guest.reload();
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
  await duel.guest.locator("#faction-history-toggle").click();
  await expect(duel.guest.locator("#faction-history li")).toHaveCount(2);
  await expect(duel.guest.locator("#faction-history")).toContainText("Test Rock converted you to Rock.");
  await expect(duel.guest.locator(".conversion-notice")).toHaveCount(0);
});

for (const interruption of ["range exit", "stop sharing"] as const) {
  test(`clears both influence roles after ${interruption}`, async ({ duel }) => {
    await duel.moveGuest(10);
    await expect(duel.host.locator(".radar-players")).toContainText("about 10 m E");
    await expectInfluence(duel);
    const outgoing = duel.host.getByRole("progressbar", { name: "Influencing Test Scissors", exact: true });
    await expect.poll(async () => {
      const progress = await outgoing.evaluate((element: HTMLProgressElement) => element.value);
      return progress > 0 && progress < 1;
    }).toBe(true);

    if (interruption === "range exit") {
      await duel.moveGuest(60);
      await expect(duel.host.locator(".radar-players")).toContainText("about 60 m E");
    } else {
      await duel.guest.getByRole("button", { name: "Stop sharing", exact: true }).click();
      await expect(duel.guest.getByRole("button", { name: "Share location", exact: true })).toBeVisible();
      const marker = duel.host.locator('[data-radar-player][data-faction="scissors"]');
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute("data-current", "false");
    }
    await expectNoInfluence(duel);
    for (const page of [duel.host, duel.guest]) {
      await expect(page.locator(".conversion-stopped")).toContainText("Conversion stopped");
      await expect(page.locator(".conversion-countdown")).toHaveCount(0);
    }
    await expect(duel.guest.locator(".own-faction h2")).toHaveText("Scissors");
    for (const page of [duel.host, duel.guest]) {
      await expect(page.locator("#radar-details-toggle")).toContainText("(2)");
    }

    if (interruption === "range exit") await duel.moveGuest(10);
    else {
      await duel.guest.getByRole("button", { name: "Share location", exact: true }).click();
      await duel.moveGuest(10.1);
    }
    await expect(duel.host.locator(".radar-players")).toContainText("about 10 m E");
    await expect(duel.host.locator('[data-radar-player][data-faction="scissors"]')).toHaveAttribute("data-current", "true");
    await expectInfluence(duel);
    await expectConversion(duel);
  });
}

test("shows an inaccurate nearby player without allowing influence", async ({ duel }) => {
  const details = duel.host.locator(".radar-players li").filter({ hasText: "Test Scissors" });
  await duel.moveGuest(10, 16);
  await expect(details).toContainText("about 10 m E");
  await expect(details).toContainText("GPS uncertainty 16 m.");
  await expect(details).toContainText("Location is approximate.");
  await expect(duel.host.locator('[data-radar-player][data-faction="scissors"]')).toBeVisible();
  await expectNoInfluence(duel);
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Scissors");

  await duel.moveGuest(10.1);
  await expect(details).toContainText("GPS uncertainty 1 m.");
  await expect(details).not.toContainText("Location is approximate.");
  await expectInfluence(duel);
  await expectConversion(duel);
});
