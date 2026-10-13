import { test, expect } from "./fixtures";

test("ends with pausable trophy announcements and persistent full-player results", async ({ duel }, testInfo) => {
  await duel.guest.setViewportSize({ width: 320, height: 568 });
  await duel.moveGuest(8);
  await expect(duel.host.locator(".conversion-result")).toContainText("joined Rock");
  const end = duel.host.getByRole("button", { name: "End round", exact: true });
  if (!await end.isVisible()) await duel.host.locator("#host-tools-toggle").click();
  await end.click();
  await Promise.all([duel.host, duel.guest].map(async page => {
    const dialog = page.locator("#award-ceremony");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
    await expect(page.locator(".award-winner-copy")).toHaveCSS("opacity", "1");
    const pause = page.getByRole("button", { name: "Tap to pause", exact: true });
    await expect(pause).toBeInViewport();
    await pause.click();
    await expect(page.getByRole("button", { name: "Paused. Tap to resume", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: testInfo.outputPath(page === duel.host ? "award-desktop.png" : "award-mobile.png") });
    await page.locator(".award-artwork").click();
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Skip to results", exact: true }).click();
    await expect(page.locator("#round-results-heading")).toBeFocused();
    await expect(page.locator("[data-result-player]")).toHaveCount(2);
    await expect(page.locator(".round-results")).toContainText("Test Rock");
    await expect(page.locator(".round-results")).toContainText("Test Scissors");
    await expect(page.locator(".round-results")).toContainText("Conversion Champion");
    await expect(page.locator(".conversion-takeover, #player-roster")).toHaveCount(0);
  }));
  await duel.guest.reload();
  await expect(duel.guest.locator("[data-result-player]")).toHaveCount(2);
  await expect(duel.guest.locator("#award-ceremony")).toHaveCount(0);
});
