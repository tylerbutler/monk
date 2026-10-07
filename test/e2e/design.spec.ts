import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 641, height: 844 },
  { width: 768, height: 844 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`keeps the brand mark and room actions together at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator(".entry-intro img")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeInViewport({ ratio: 1 });
    const code = page.getByLabel("Room code", { exact: true });
    await code.fill("ABCDEFGH");
    expect(await code.evaluate(element => {
      const style = getComputedStyle(element);
      return element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    })).toBeGreaterThanOrEqual(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("entry.png"), fullPage: true });
  });
}

test("keeps lobby invitations and players visible without an empty radar", async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByLabel("Display name (optional)", { exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  const start = page.getByRole("button", { name: "Start game", exact: true });
  await expect(start).toBeDisabled();
  await expect(page.locator(".radar-empty")).toBeHidden();
  await expect(page.locator(".radar-players")).toContainText("Alex");
  const invite = await page.locator("#room-invite-link").getAttribute("href");
  if (!invite) throw new Error("Missing room invitation");
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    await guest.goto(invite);
    await guest.getByLabel("Display name (optional)", { exact: true }).fill("Sam");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(start).toBeEnabled();
    await expect(page.locator(".radar-players")).toContainText("Sam");
    await expect(page.locator("#invite-qr").getByRole("img")).toBeVisible();
    await expect(page.getByRole("button", { name: "Share location", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop sharing", exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("lobby-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("lobby-mobile.png"), fullPage: true });
    await start.click();
    await expect(guest.getByText("Round running", { exact: true })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Share location", exact: true })).toBeVisible();
    await guest.screenshot({ path: test.info().outputPath("game-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: test.info().outputPath("game-desktop.png"), fullPage: true });
  } finally {
    await context.close();
  }
});
