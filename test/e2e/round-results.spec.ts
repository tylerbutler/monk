import { test, expect } from "./fixtures";

test("ends with unique trophy announcements and persistent full-player results", async ({ duel }) => {
  await duel.moveGuest(8);
  await expect(duel.host.locator(".conversion-result")).toContainText("joined Rock");
  const end = duel.host.getByRole("button", { name: "End round", exact: true });
  if (!await end.isVisible()) await duel.host.locator("#host-tools-toggle").click();
  await end.click();
  for (const page of [duel.host, duel.guest]) {
    const dialog = page.locator("#award-ceremony");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
    await page.getByRole("button", { name: "Skip to results", exact: true }).click();
    await expect(page.locator("#round-results-heading")).toBeFocused();
    await expect(page.locator("[data-result-player]")).toHaveCount(2);
    await expect(page.locator(".round-results")).toContainText("Test Rock");
    await expect(page.locator(".round-results")).toContainText("Test Scissors");
    await expect(page.locator(".round-results")).toContainText("Conversion Champion");
    await expect(page.locator(".conversion-takeover, #player-roster")).toHaveCount(0);
  }
  await duel.guest.reload();
  await expect(duel.guest.locator("[data-result-player]")).toHaveCount(2);
  await expect(duel.guest.locator("#award-ceremony")).toHaveCount(0);
});
