import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`room entry leads the page and keeps rules available at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const rules = page.getByRole("region", { name: "How to play", exact: true });
    const heading = rules.getByRole("heading", { name: "How to play", exact: true });
    await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.locator("#play").evaluate(element => {
      const rules = document.getElementById("how-to-play");
      return !!rules && !!(element.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(page.locator("#rules-details")).not.toHaveAttribute("open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to play", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#play")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Display name (optional)", { exact: true })).toBeFocused();

    await page.goto("/?room=ABCDEFGH");
    await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue("ABCDEFGH");
    await expect(page.getByLabel("Room code", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeInViewport({ ratio: 1 });
    await heading.scrollIntoViewIfNeeded();
    await expect(rules).toBeVisible();
  });

  test(`room errors stay visible after skipping the rules at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/matches**", route => route.fulfill({
      status: 503, json: { error: "Room service is unavailable. Try again." },
    }));
    await page.goto("/");
    await page.getByRole("link", { name: "Skip to play", exact: true }).click();
    await page.getByLabel("Room code", { exact: true }).fill("BAD");
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    const error = page.getByRole("alert");
    await expect(error).toContainText("eight-character room code");
    await expect(error).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue("BAD");
    await expect(page.getByLabel("Room code", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(error).toContainText("Room service is unavailable");
    await expect(error).toBeInViewport({ ratio: 1 });
    await page.getByLabel("Room code", { exact: true }).fill("ABCDEFGH");
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(error).toContainText("Room service is unavailable");
    await expect(error).toBeInViewport({ ratio: 1 });
  });
}
