import { expect, test, type Page } from "@playwright/test";

async function seek(page: Page, milliseconds: number) {
  await page.getByLabel("Sequence position").evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected the preview timeline");
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, milliseconds);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/brand/conversion-motion.html");
});

test("reveals the new faction with a screen-covering bubble and a stamp", async ({ page }) => {
  await expect(page.getByLabel("Sequence position")).toBeEnabled();
  await seek(page, 5100);
  await expect(page.locator("#conversion-state")).toContainText("Confirming");
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#own-name")).toHaveText("Rock");

  await seek(page, 5680);
  const coverage = await page.locator("#bubble").evaluate(element => {
    const screen = document.querySelector("#game-screen");
    if (!screen) throw new Error("Missing the game screen");
    const bubble = element.getBoundingClientRect();
    const bounds = screen.getBoundingClientRect();
    return {
      radius: bubble.width / 2,
      required: Math.hypot(bounds.width, bounds.height) / 2,
      centerX: bubble.x + bubble.width / 2,
      centerY: bubble.y + bubble.height / 2,
      screenX: bounds.x + bounds.width / 2,
      screenY: bounds.y + bounds.height / 2,
    };
  });
  expect(coverage.radius).toBeGreaterThan(coverage.required);
  expect(coverage.centerX).toBeCloseTo(coverage.screenX, 0);
  expect(coverage.centerY).toBeCloseTo(coverage.screenY, 0);

  await seek(page, 5920);
  await expect(page.locator("#faction-stamp")).toBeVisible();
  await expect(page.locator("#reveal-name")).toHaveText("Paper");
  await expect(page.locator("#reveal-copy")).toContainText("You are now");
  await expect(page.locator("#impact-ring")).toBeVisible();

  await seek(page, 9160);
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await expect(page.locator("#result-message")).toContainText("You are now Paper");
});

test("holds the stamped screen for three seconds with a bottom countdown", async ({ page }) => {
  await seek(page, 5830);
  await expect(page.locator("#hold-countdown")).toBeHidden();
  for (const [at, number, offset] of [
    [5840, "3", 0], [6840, "2", 33.3333], [7840, "1", 66.6667], [8830, "1", 99.6667],
  ] as const) {
    await seek(page, at);
    await expect(page.locator("#takeover")).toBeVisible();
    await expect(page.locator("#takeover")).toHaveCSS("opacity", "1");
    await expect(page.locator("#countdown-number")).toHaveText(number);
    expect(Number(await page.locator("#countdown-ring").getAttribute("stroke-dashoffset"))).toBeCloseTo(offset, 3);
  }
  const location = await page.locator("#hold-countdown").evaluate(element => {
    const screen = document.querySelector("#game-screen")!;
    const countdown = element.getBoundingClientRect(), bounds = screen.getBoundingClientRect();
    return {
      center: countdown.x + countdown.width / 2,
      screenCenter: bounds.x + bounds.width / 2,
      bottomGap: bounds.bottom - countdown.bottom,
      width: countdown.width,
    };
  });
  expect(location.center).toBeCloseTo(location.screenCenter, 0);
  expect(location.bottomGap).toBeGreaterThan(0);
  expect(location.bottomGap).toBeLessThan(40);
  expect(location.width).toBeLessThanOrEqual(40);
  await seek(page, 8840);
  await expect(page.locator("#hold-countdown")).toBeHidden();
  await seek(page, 9000);
  await expect(page.locator("#takeover")).toHaveCSS("opacity", "0.5");
  await seek(page, 9160);
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#own-name")).toHaveText("Paper");
});

for (const faction of [
  { id: "rock", name: "Rock", color: "rgb(235, 98, 86)" },
  { id: "paper", name: "Paper", color: "rgb(242, 207, 69)" },
  { id: "scissors", name: "Scissors", color: "rgb(105, 181, 245)" },
]) {
  test(`finishes and replays the ${faction.name} conversion`, async ({ page }) => {
    await page.getByLabel("Resulting faction").selectOption(faction.id);
    await seek(page, 9160);
    await expect(page.locator("#own-name")).toHaveText(faction.name);
    await expect(page.locator("#game-screen")).toHaveCSS("background-color", faction.color);
    await page.getByRole("button", { name: "Play stamp", exact: true }).click();
    await expect(page.locator("#takeover")).toBeVisible();
    await expect(page.locator("#result-message")).toBeVisible();
    await expect(page.locator("#takeover")).toBeHidden();
    await expect(page.locator("#hold-countdown")).toBeHidden();
    await expect(page.locator("#own-name")).toHaveText(faction.name);
  });
}

test("stamps the converted player without taking over your screen", async ({ page }) => {
  await page.getByRole("button", { name: "You convert someone", exact: true }).click();
  await seek(page, 5100);
  await expect(page.locator("#conversion-state")).toContainText("Confirming");
  await expect(page.locator("#target-marker")).toHaveAttribute("data-faction", "rock");
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await seek(page, 5400);
  await expect(page.locator("#signal")).toBeVisible();
  await seek(page, 5920);
  await expect(page.locator("#target-marker")).toHaveAttribute("data-faction", "paper");
  await expect(page.locator("#target-stamp")).toBeVisible();
  await expect(page.locator("#result-message")).toContainText("Alex joined Paper");
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#hold-countdown")).toBeHidden();
  await expect(page.getByLabel("Sequence position")).toHaveAttribute("max", "6500");
  await expect(page.locator("#own-name")).toHaveText("Paper");
});

test("cracks the target ring before expanding and fading on interruption", async ({ page }) => {
  await page.getByRole("button", { name: "Conversion stops", exact: true }).click();
  await seek(page, 2990);
  const ring = page.locator("#target-ring");
  await expect(ring).toBeVisible();
  await expect(page.locator("#target-ring circle")).toHaveAttribute("stroke-dasharray", "60 100");
  const originalWidth = await ring.evaluate(element => element.getBoundingClientRect().width);
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await expect(page.locator("#target-marker")).toHaveAttribute("data-faction", "rock");

  await seek(page, 3040);
  await expect(ring).toBeVisible();
  await expect(page.locator("#target-ring circle")).toHaveAttribute("stroke-dasharray", "3 3");
  await expect(ring).toHaveCSS("opacity", "1");
  expect(await ring.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(originalWidth, 1);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

  await seek(page, 3300);
  expect(await ring.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(originalWidth);
  const opacity = Number(await ring.evaluate(element => getComputedStyle(element).opacity));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
  await seek(page, 3650);
  await expect(ring).toBeHidden();
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await expect(page.locator("#target-marker")).toHaveAttribute("data-faction", "rock");
  await expect(page.locator("#target-stamp")).toBeHidden();
  await expect(page.locator("#result-message")).toBeHidden();

  await page.getByRole("button", { name: "Play interruption", exact: true }).click();
  await expect(ring).toBeVisible();
  await expect(page.locator("#target-ring circle")).toHaveAttribute("stroke-dasharray", /^\d+ 100$/);
  await seek(page, 3040);
  await expect(ring).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "You convert someone", exact: true }).click();
  await seek(page, 3300);
  await expect(ring).toHaveCSS("opacity", "1");
  expect(await ring.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(originalWidth, 1);
  await expect(page.locator("#target-ring circle")).toHaveAttribute("stroke-dasharray", "66 100");
});

test("interruption clears progress without showing a successful conversion", async ({ page }) => {
  await seek(page, 5920);
  await page.getByRole("button", { name: "Conversion stops", exact: true }).click();
  await seek(page, 3200);
  await expect(page.locator("#conversion-state")).toContainText("Conversion stopped");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#target-stamp")).toBeHidden();
  await expect(page.locator("#result-message")).toBeHidden();
  await expect(page.locator("#hold-countdown")).toBeHidden();
  await page.getByRole("button", { name: "Replay sequence", exact: true }).click();
  await expect(page.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const value = await page.getByLabel("Sequence position").inputValue();
  await page.waitForTimeout(150);
  expect(await page.getByLabel("Sequence position").inputValue()).toBe(value);
});

test("reduced motion keeps the result but removes expansion and impact", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByLabel("Reduced motion", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Reduced motion", { exact: true })).toBeDisabled();
  await seek(page, 5300);
  await expect(page.locator("#bubble")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await seek(page, 5920);
  await expect(page.locator("#faction-stamp")).toBeVisible();
  await expect(page.locator("#reveal-name")).toHaveText("Paper");
  await expect(page.locator("#impact-ring")).toBeHidden();
  await seek(page, 6840);
  await expect(page.locator("#takeover")).toHaveCSS("opacity", "1");
  await expect(page.locator("#countdown-number")).toHaveText("2");
  await expect(page.locator("#countdown-ring")).toHaveAttribute("stroke-dashoffset", "0");
  await seek(page, 9160);
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await page.getByRole("button", { name: "You convert someone", exact: true }).click();
  await seek(page, 5400);
  await expect(page.locator("#signal")).toBeHidden();
  await seek(page, 6500);
  await expect(page.locator("#result-message")).toContainText("Alex joined Paper");
  await page.getByRole("button", { name: "Conversion stops", exact: true }).click();
  await seek(page, 3040);
  await expect(page.locator("#target-ring circle")).toHaveAttribute("stroke-dasharray", "3 3");
  const width = await page.locator("#target-ring").evaluate(element => element.getBoundingClientRect().width);
  await seek(page, 3300);
  await expect(page.locator("#target-ring")).toBeVisible();
  await expect(page.locator("#target-ring")).toHaveCSS("transform", "none");
  expect(await page.locator("#target-ring").evaluate(element => element.getBoundingClientRect().width)).toBe(width);
  const ringOpacity = Number(await page.locator("#target-ring").evaluate(element => getComputedStyle(element).opacity));
  expect(ringOpacity).toBeGreaterThan(0);
  expect(ringOpacity).toBeLessThan(1);
  await seek(page, 3650);
  await expect(page.locator("#target-ring")).toBeHidden();
});

test("scene changes cancel playback and do not leak the previous result", async ({ page }) => {
  await page.getByRole("button", { name: "Play stamp", exact: true }).click();
  await page.getByRole("button", { name: "Conversion stops", exact: true }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator("#own-name")).toHaveText("Paper");
  await expect(page.locator("#takeover")).toBeHidden();
  await expect(page.locator("#result-message")).toBeHidden();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeDisabled();
});

test("the mobile preview and controls fit without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "Play stamp", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Play stamp", exact: true }).click();
  const visibleScreen = await page.locator("#game-screen").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, viewport: innerHeight };
  });
  expect(visibleScreen.top).toBeGreaterThanOrEqual(0);
  expect(visibleScreen.bottom).toBeLessThanOrEqual(visibleScreen.viewport);
  await expect(page.locator("#result-message")).toBeVisible();
  await expect(page.locator("#own-name")).toHaveText("Paper");
});
