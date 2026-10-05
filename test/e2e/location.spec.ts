import { test, expect } from "./fixtures";

test("converts two independently located players through the real server", async ({ duel }) => {
  await expect(duel.host.locator(".radar-players")).toContainText("about 60 m E");
  await expect(duel.guest.locator(".radar-players")).toContainText("about 60 m W");
  await expect(duel.host.locator("[data-direction]")).toHaveCount(0);
  await expect(duel.guest.locator("[data-direction]")).toHaveCount(0);

  await duel.moveGuest(10);
  await expect(duel.host.locator(".radar-players")).toContainText("about 10 m E");
  await expect(duel.host.getByRole("progressbar", {
    name: "Influencing Test Scissors", exact: true,
  })).toBeVisible();
  await expect(duel.guest.getByRole("progressbar", {
    name: "Test Rock is influencing you", exact: true,
  })).toBeVisible();
  await expect(duel.host.getByRole("status", {
    name: "Conversion notification", exact: true,
  })).toContainText("You converted Test Scissors to Rock.");
  await expect(duel.guest.getByRole("status", {
    name: "Conversion notification", exact: true,
  })).toContainText("Test Rock converted you to Rock.");
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
});
