import { expect, test, type Page } from "@playwright/test";

async function seek(page: Page, milliseconds: number) {
  await page.getByLabel("Sequence position").evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected the award timeline");
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, milliseconds);
}

async function motion(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    const matrix = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
    return { x: matrix.e, y: matrix.f, opacity: Number(style.opacity), dash: parseFloat(style.strokeDashoffset) };
  });
}

test.beforeEach(async ({ page }) => { await page.goto("/brand/award-motion.html"); });

test("opens a paused production champion preview without game services", async ({ page }) => {
  const gameRequests: string[] = [], sockets: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) gameRequests.push(request.url()); });
  page.on("websocket", socket => sockets.push(socket.url()));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition() { throw new Error("The award demo must not request location"); },
      watchPosition() { throw new Error("The award demo must not watch location"); },
    } });
  });
  await page.reload();
  await expect(page.getByLabel("Sequence position")).toHaveValue("1500");
  await expect(page.locator("[data-award]")).toHaveAttribute("data-award", "conversion_champion");
  await expect(page.locator("[data-award-winner]")).toHaveText(["Alex"]);
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByText("Fictional data. Testing preview only.", { exact: true })).toBeVisible();
  expect(gameRequests).toEqual([]);
  expect(sockets).toEqual([]);
});

test("renders all five compositions at entrance, settle, hold, and exit", async ({ page }) => {
  const categories = ["hat_trick", "comeback_kid", "social_butterfly", "hot_streak", "conversion_champion"];
  for (const category of categories) {
    await page.getByLabel("Award category").selectOption(category);
    for (const age of [400, 850, 1500, 2900]) {
      await seek(page, age);
      await expect(page.locator("[data-award]")).toHaveAttribute("data-award", category);
      await expect(page.locator(".award-artwork")).toHaveCount(1);
      await expect(page.locator("[data-award-winner]")).not.toHaveCount(0);
      if (age === 1500) await expect(page.locator(".award-winner-copy")).toHaveCSS("opacity", "1");
      if (age === 2900) await expect(page.locator("[data-award]")).toHaveCSS("opacity", "0.5");
    }
  }
  await expect(page.locator(".conversion-takeover, .conversion-bubble, .conversion-hold-countdown")).toHaveCount(0);
});

test("uses five distinct real entrance paths, not just different titles", async ({ page }) => {
  await page.getByLabel("Award category").selectOption("hat_trick");
  await seek(page, 400);
  expect((await motion(page, '[data-hand="rock"]')).x).toBeLessThan(0);
  expect((await motion(page, '[data-hand="paper"]')).y).toBeLessThan(0);
  expect((await motion(page, '[data-hand="scissors"]')).x).toBeGreaterThan(0);
  await seek(page, 850);
  expect((await motion(page, '[data-hand="rock"]')).x).toBeCloseTo(0);

  await page.getByLabel("Award category").selectOption("comeback_kid");
  await seek(page, 200);
  const low = await motion(page, ".award-trophy");
  await seek(page, 427);
  const turn = await motion(page, ".award-trophy");
  expect(turn.y).toBeGreaterThan(low.y);
  expect(turn.x).toBeGreaterThan(low.x);
  await seek(page, 850);
  expect((await motion(page, ".award-trophy")).y).toBeCloseTo(0);

  await page.getByLabel("Award category").selectOption("social_butterfly");
  await seek(page, 400);
  expect((await motion(page, '[data-arch="left"]')).x).toBeLessThan(0);
  expect((await motion(page, '[data-arch="right"]')).x).toBeGreaterThan(0);

  await page.getByLabel("Award category").selectOption("hot_streak");
  await seek(page, 400);
  expect((await motion(page, '[data-streak="0"]')).opacity).toBeGreaterThan(0);
  expect((await motion(page, '[data-streak="1"]')).opacity).toBeGreaterThan(0);
  expect((await motion(page, '[data-streak="2"]')).opacity).toBe(0);
  expect((await motion(page, ".award-trophy")).opacity).toBe(0);
  await seek(page, 650);
  expect((await motion(page, '[data-streak="2"]')).opacity).toBeGreaterThan(0);
  expect((await motion(page, ".award-trophy")).x).toBeLessThan(0);

  await page.getByLabel("Award category").selectOption("conversion_champion");
  await seek(page, 400);
  expect((await motion(page, '[data-curtain="left"]')).x).toBeLessThan(0);
  expect((await motion(page, '[data-curtain="right"]')).x).toBeGreaterThan(0);
  expect((await motion(page, ".award-trophy")).y).toBeGreaterThan(0);
  await seek(page, 1500);
  expect((await motion(page, ".award-trophy")).y).toBeCloseTo(0);
  await expect(page.locator(".award-podium")).toHaveCSS("opacity", "1");
});

test("replays, pauses, resumes, and seeks backwards without stale effects", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Replay award", exact: true }).click();
  await expect(page.getByLabel("Sequence position")).toHaveValue("0");
  await page.clock.runFor(450);
  await page.getByRole("button", { name: "Replay award", exact: true }).click();
  await page.clock.runFor(100);
  expect(Number(await page.getByLabel("Sequence position").inputValue())).toBeLessThanOrEqual(100);
  await page.clock.runFor(350);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.getByLabel("Sequence position").inputValue();
  await page.clock.runFor(300);
  await expect(page.getByLabel("Sequence position")).toHaveValue(paused);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.clock.runFor(100);
  expect(Number(await page.getByLabel("Sequence position").inputValue())).toBeGreaterThan(Number(paused));
  await seek(page, 1500);
  expect((await motion(page, ".award-trophy")).y).toBeCloseTo(0);
  await seek(page, 200);
  expect((await motion(page, ".award-trophy")).y).toBeCloseTo(130);
  await expect(page.locator(".award-winner-copy")).toHaveCSS("opacity", "0");
});

test("system and forced reduced motion remove travel mid-preview without changing names or age", async ({ page }) => {
  for (const category of ["hat_trick", "comeback_kid", "social_butterfly", "hot_streak", "conversion_champion"]) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByLabel("Motion preference").selectOption("system");
    await page.getByLabel("Award category").selectOption(category);
    await seek(page, 750);
    const names = await page.locator("[data-award-winner]").allTextContents();
    for (const mode of ["system", "reduced"]) {
      if (mode === "system") await page.emulateMedia({ reducedMotion: "reduce" });
      else {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.getByLabel("Motion preference").selectOption("reduced");
      }
      if (mode === "system") {
        await expect(page.locator("[data-award]")).toHaveClass(/is-reduced/);
        await page.locator("[data-award]").evaluate(element => element.classList.remove("is-reduced"));
      }
      await expect(page.getByLabel("Sequence position")).toHaveValue("750");
      await expect(page.locator("[data-award-winner]")).toHaveText(names);
      const transforms = await page.locator("[data-award-motion]:not(.award-curtain)").evaluateAll(elements =>
        elements.map(element => getComputedStyle(element).transform));
      expect(transforms.every(transform => transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)"),
        `${category}, ${mode}: ${transforms.join("; ")}`).toBe(true);
      await expect(page.locator(".award-curtain:visible")).toHaveCount(0);
      if (category === "hot_streak") expect((await motion(page, '[data-streak="0"]')).dash).toBe(0);
      if (mode === "system") await page.locator("[data-award]").evaluate(element => element.classList.add("is-reduced"));
    }
  }
});

test("plays the exact full ceremony into lasting results and stops on fixture changes", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Play full ceremony", exact: true }).click();
  await expect(page.locator(".award-introduction")).toBeVisible();
  await expect(page.getByLabel("Sequence position")).toHaveAttribute("max", "15500");
  await page.clock.runFor(15520);
  await expect(page.getByLabel("Sequence position")).toHaveValue("15500");
  await expect(page.locator("[data-result-player]")).toHaveCount(4);
  await expect(page.locator("[data-award]")).toHaveCount(0);
  await page.getByRole("button", { name: "Play full ceremony", exact: true }).click();
  await page.clock.runFor(800);
  await page.getByLabel("Fixture", { exact: true }).selectOption("ties");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByLabel("Sequence position")).toHaveValue("1500");
  await page.clock.runFor(400);
  await expect(page.getByLabel("Sequence position")).toHaveValue("1500");
});

test("retains literal and duplicate names, shared ties, and every large-group result", async ({ page }) => {
  await page.getByLabel("Fixture", { exact: true }).selectOption("long_names");
  await page.getByRole("button", { name: "Show fixture results", exact: true }).click();
  await expect(page.locator("[data-result-player]")).toHaveCount(4);
  await expect(page.locator(".round-results")).toContainText("<b>Alex</b>");
  await expect(page.locator(".round-results b")).toHaveCount(0);
  await expect(page.locator("[data-result-player] strong").filter({ hasText: /^Alex$/ })).toHaveCount(2);
  await page.getByLabel("Fixture", { exact: true }).selectOption("ties");
  await page.getByLabel("Award category").selectOption("conversion_champion");
  await expect(page.locator("[data-award-winner]")).toHaveCount(2);
  await page.getByLabel("Fixture", { exact: true }).selectOption("large_group");
  await page.getByRole("button", { name: "Show fixture results", exact: true }).click();
  await expect(page.locator("[data-result-player]")).toHaveCount(120);
  await expect(page.locator(".round-results")).toContainText("Former player 119");
  await expect(page.locator('[data-result-player="large-119"] .result-score strong')).toHaveText("0");
  await page.getByLabel("Fixture", { exact: true }).selectOption("large_hat_trick");
  await page.getByLabel("Award category").selectOption("hat_trick");
  await expect(page.locator("[data-award-winner]")).toHaveCount(120);
  expect(await page.locator(".award-winners").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
});

test("does not invent trophies or scores for unearned and incomplete fixtures", async ({ page }) => {
  for (const fixture of ["no_awards", "partial"]) {
    await page.getByLabel("Fixture", { exact: true }).selectOption(fixture);
    await expect(page.getByText("This trophy was not earned in this fixture", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay award", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Play full ceremony", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Show fixture results", exact: true }).click();
    await expect(page.locator(".round-results")).toContainText(fixture === "partial" ?
      "Round statistics are incomplete." : "No trophies earned this round.");
    if (fixture === "partial") await expect(page.locator(".result-score, .result-rank, .result-trophies")).toHaveCount(0);
  }
});

test("fits phone, landscape, and desktop widths with enlarged text and reachable controls", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.getByLabel("Fixture", { exact: true }).selectOption("long_names");
    await page.addStyleTag({ content: "html { font-size: 150%; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Replay award", exact: true })).toBeEnabled();
    await page.getByLabel("Fixture", { exact: true }).selectOption("large_group");
    await page.getByRole("button", { name: "Show fixture results", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("keeps playback controls and the animation reachable together on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Replay award", exact: true }).click();
  await expect(page.locator(".award-artwork")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeInViewport();
});

test("links from the identity kit to the compiled demo", async ({ page }) => {
  await page.goto("/brand/index.html");
  await page.locator('a[href="award-motion.html"]').click();
  await expect(page.locator("[data-award]")).toHaveAttribute("data-award", "conversion_champion");
});
