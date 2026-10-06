import { test, expect, type Page } from "@playwright/test";

async function seek(page: Page, frame: number) {
  await page.getByLabel("Animation progress").evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected the timeline");
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);
}

async function paint(page: Page) {
  return page.locator("#animation svg").evaluate(async element => {
    async function pixels(source: string) {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 560; canvas.height = 440;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 560, 440);
      context.drawImage(image, 0, 0, 560, 440);
      return context.getImageData(0, 0, 560, 440).data;
    }
    const rendered = await pixels(new XMLSerializer().serializeToString(element));
    const source = await (await fetch("/brand/assets/symbol-paired.svg")).text();
    const reference = await pixels(`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="220" viewBox="0 0 280 220">
      <svg x="70" y="50" width="140" height="120" viewBox="0 0 140 120">${source}</svg></svg>`);
    const colors = { yellow: 0, red: 0, blue: 0 };
    let different = 0;
    let belowBaseline = 0;
    for (let index = 0; index < rendered.length; index += 4) {
      const [r, g, b] = rendered.slice(index, index + 3);
      if (r === 242 && g === 207 && b === 69) colors.yellow++;
      if (r === 235 && g === 98 && b === 86) colors.red++;
      if (r === 105 && g === 181 && b === 245) colors.blue++;
      if (index >= 560 * 340 * 4 && (r < 250 || g < 250 || b < 250)) belowBaseline++;
      if ([0, 1, 2].some(channel => Math.abs(rendered[index + channel] - reference[index + channel]) > 24)) different++;
    }
    // Sample the center of the shared stem at artboard coordinates (140, 140).
    const stemPixel = (280 * 560 + 280) * 4;
    const sharedStem = Array.from(rendered.slice(stemPixel, stemPixel + 4));
    return { ...colors, different, belowBaseline, sharedStem };
  });
}

test("keeps every painted frame above the mark baseline", async ({ page }) => {
  await page.goto("/brand/motion.html");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  for (let frame = 0; frame < 180; frame++) {
    await seek(page, frame);
    expect((await paint(page)).belowBaseline, `paint below baseline at frame ${frame}`).toBe(0);
  }
});

test("draws each color at constant speed with equal time per arch", async ({ page }) => {
  await page.goto("/brand/motion.html");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  const archLength = 156 + Math.PI * 28;
  for (const [start, color, completed] of [
    [0, "242,207,69", 0], [42, "242,207,69", 1],
    [78, "235,98,86", 0], [114, "105,181,245", 0],
  ] as const) {
    for (const elapsed of [7, 14, 21, 28, 35, 42]) {
      await seek(page, start + elapsed);
      const length = await page.locator(`#animation path[stroke="rgb(${color})"]`).evaluateAll(elements => {
        return elements.reduce((total, element) => {
          if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
          return total + element.getTotalLength();
        }, 0);
      });
      expect(length, `${color} from frame ${start} after ${elapsed} frames`)
        .toBeCloseTo(archLength * (completed + elapsed / 42), 0);
    }
  }
});

test("shows the second yellow upswing over red before blue covers it", async ({ page }) => {
  await page.goto("/brand/motion.html");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  for (const [frame, color] of [[118, [242, 207, 69, 255]], [122, [105, 181, 245, 255]]] as const) {
    await seek(page, frame);
    expect((await paint(page)).sharedStem, `shared stem at frame ${frame}`).toEqual(color);
  }
});

test("introduces colors almost one at a time and holds the original mark", async ({ page }) => {
  await page.goto("/brand/motion.html");
  await expect(page.getByRole("heading", { name: "Paint the bounce." })).toBeVisible();
  const timeline = page.getByLabel("Animation progress");
  await expect(timeline).toBeEnabled();
  for (const [frame, visible] of [
    [78, ["yellow"]], [79, ["yellow", "red"]],
    [114, ["yellow", "red"]], [115, ["yellow", "red", "blue"]],
  ] as const) {
    await seek(page, frame);
    const result = await paint(page);
    for (const color of ["yellow", "red", "blue"] as const) {
      if (visible.some(value => value === color)) expect(result[color], `${color} at frame ${frame}`).toBeGreaterThan(100);
      else expect(result[color], `${color} at frame ${frame}`).toBe(0);
    }
  }
  await expect(timeline).toHaveAttribute("max", "179");
  await seek(page, 179);
  await expect(page.locator("#time")).toHaveText("3.00 s");
  const final = await paint(page);
  expect(final.yellow).toBe(0);
  expect(final.red).toBeGreaterThan(10000);
  expect(final.blue).toBeGreaterThan(10000);
  // The Lottie cubic curves must match the original SVG arcs to subpixel accuracy.
  expect(final.different).toBeLessThan(200);

  await page.getByLabel("Slow motion").check();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("status")).toHaveText("Playing at half speed.");
  await expect.poll(() => timeline.inputValue()).not.toBe("179");
  await expect(page.getByRole("status")).toHaveText("Finished.");
  await expect(timeline).toHaveValue("179");
  await page.waitForTimeout(250);
  await expect(timeline).toHaveValue("179");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Lottie" }).click();
  expect((await download).suggestedFilename()).toBe("monk-entrance.json");
});

test("keeps the static mark for reduced motion, including a live preference change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/brand/motion.html");
  await expect(page.getByRole("status")).toHaveText("Reduced motion: showing the finished mark.");
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.locator("#animation")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "Replay" })).toBeEnabled();
  await page.getByRole("button", { name: "Replay" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.getByLabel("Animation progress")).toBeDisabled();
});

test("shows the original mark and an error when the animation cannot load", async ({ page }) => {
  await page.route("**/monk-entrance.json", route => route.abort());
  await page.goto("/brand/motion.html");
  await expect(page.getByRole("status")).toContainText("Could not load the animation.");
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
});
