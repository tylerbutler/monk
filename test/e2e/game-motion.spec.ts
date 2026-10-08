import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";

async function sampleAnimation(element: Locator, milliseconds: number) {
  await element.evaluate((node, time) => {
    if (!node.getAnimations().length) throw new Error("Expected a game animation");
    node.setAttribute("data-motion-sample", "");
    let style = document.querySelector<HTMLStyleElement>("#motion-sample");
    if (!style) {
      style = document.createElement("style");
      style.id = "motion-sample";
      document.head.append(style);
    }
    style.textContent = `[data-motion-sample] { --motion-age: ${time}ms !important; }`;
  }, milliseconds);
}

test("confirmed live conversions use a viewport bubble and an outgoing radar stamp", async ({ duel }) => {
  await duel.guest.setViewportSize({ width: 375, height: 812 });
  await duel.moveGuest(8);
  await expect(duel.host.locator('.influence[data-direction="outgoing"]')).toBeVisible();
  await expect(duel.guest.locator('.influence[data-direction="incoming"]')).toBeVisible();
  await expect(duel.host.locator(".conversion-takeover")).toHaveCount(0);
  await expect(duel.guest.locator(".conversion-takeover")).toHaveCount(0);
  await expect(duel.host.locator(".conversion-progress-fill")).toHaveCSS("background-color", "rgb(235, 98, 86)");
  await expect(duel.guest.locator(".conversion-progress-fill")).toHaveCSS("background-color", "rgb(235, 98, 86)");
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
  const takeover = duel.guest.locator(".conversion-takeover");
  await expect(takeover).toBeVisible();
  await expect(takeover.locator(".conversion-hold-countdown")).toBeVisible();
  await expect(takeover.locator(".conversion-hold-number")).toHaveText("3");
  await expect(takeover.locator(".conversion-reveal-copy")).toContainText("You are nowRock");
  const coverage = await takeover.locator(".conversion-bubble").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return {
      radius: bounds.width / 2, required: Math.hypot(innerWidth, innerHeight) / 2,
      x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
      centerX: innerWidth / 2, centerY: innerHeight / 2,
      scrolling: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(coverage.radius).toBeGreaterThan(coverage.required);
  expect(coverage.x).toBeCloseTo(coverage.centerX, 0);
  expect(coverage.y).toBeCloseTo(coverage.centerY, 0);
  expect(coverage.scrolling).toBe(false);
  await expect(duel.host.locator(".conversion-takeover")).toHaveCount(0);
  await expect(duel.host.locator(".radar-conversion-stamp")).toHaveCSS("opacity", "1");
  await expect(duel.host.locator(".conversion-result")).toContainText("Test Scissors joined Rock");
  const alignment = await duel.host.locator(".radar-conversion-stamp circle").evaluate(element => {
    const body = document.querySelector('[data-radar-player] .radar-marker-body');
    if (!body) throw new Error("Missing the converted player's radar marker");
    const stamp = element.getBoundingClientRect(), marker = body.getBoundingClientRect();
    return { dx: stamp.x + stamp.width / 2 - marker.x - marker.width / 2,
      dy: stamp.y + stamp.height / 2 - marker.y - marker.height / 2 };
  });
  expect(alignment.dx).toBeCloseTo(0, 0);
  expect(alignment.dy).toBeCloseTo(0, 0);
  await Promise.all([
    duel.guest.screenshot({ path: test.info().outputPath("converted-mobile.png") }),
    duel.host.screenshot({ path: test.info().outputPath("conversion-desktop.png") }),
  ]);
  await expect(takeover.locator(".conversion-hold-number")).toHaveText("2");
  await expect(takeover.locator(".conversion-hold-number")).toHaveText("1");
  await expect(takeover).toHaveCount(0);
  await expect(duel.host.locator(".radar-conversion-stamp")).toHaveCount(0);
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
});

for (const reduced of [false, true]) {
  test(`live interruption cracks the ring${reduced ? " with reduced motion" : " and expands it"}`, async ({ duel }) => {
    if (reduced) {
      await duel.host.emulateMedia({ reducedMotion: "reduce" });
      await duel.guest.emulateMedia({ reducedMotion: "reduce" });
    }
    await duel.moveGuest(8);
    await expect(duel.host.locator(".conversion-progress-fill")).toBeVisible();
    await duel.moveGuest(60);
    const ring = duel.host.locator(".radar-failure");
    await expect(ring).toHaveCount(1);
    await sampleAnimation(ring, 40);
    await expect(ring.locator("circle")).toHaveAttribute("stroke-dasharray", "3 3");
    const before = await ring.evaluate(node => node.getBoundingClientRect().width);
    await expect(ring).toHaveCSS("opacity", "1");
    await sampleAnimation(ring, 300);
    const after = await ring.evaluate(node => ({
      width: node.getBoundingClientRect().width, opacity: Number(getComputedStyle(node).opacity),
    }));
    if (reduced) expect(after.width).toBeCloseTo(before, 1);
    else expect(after.width).toBeGreaterThan(before);
    expect(after.opacity).toBeGreaterThan(0);
    expect(after.opacity).toBeLessThan(1);
    await expect(duel.host.locator(".conversion-takeover")).toHaveCount(0);
    await expect(duel.host.locator(".radar-conversion-stamp")).toHaveCount(0);
    await expect(duel.host.locator(".own-faction h2")).toHaveText("Rock");
    await expect(duel.guest.locator(".own-faction h2")).toHaveText("Scissors");
    await expect(ring).toHaveCount(0);
  });
}

test("reduced-motion conversion keeps the result and countdown without expansion", async ({ duel }) => {
  await duel.guest.emulateMedia({ reducedMotion: "reduce" });
  await duel.host.emulateMedia({ reducedMotion: "reduce" });
  await duel.moveGuest(8);
  await expect(duel.guest.locator(".conversion-progress-tip")).toBeHidden();
  await expect(duel.guest.locator(".conversion-takeover")).toBeVisible();
  await expect(duel.guest.locator(".conversion-bubble")).toHaveCSS("transform", "none");
  await expect(duel.guest.locator(".conversion-impact-ring")).toBeHidden();
  await expect(duel.guest.locator(".conversion-hold-countdown")).toBeVisible();
  await expect(duel.guest.locator(".conversion-countdown-ring")).toHaveCSS("stroke-dashoffset", "0px");
  await expect(duel.host.locator(".radar-conversion-signal")).toBeHidden();
  await expect(duel.host.locator(".conversion-result")).toContainText("joined Rock");
  await expect(duel.guest.locator(".conversion-takeover")).toHaveCount(0);
});
