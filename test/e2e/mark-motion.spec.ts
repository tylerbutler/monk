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
    for (let index = 0; index < rendered.length; index += 4) {
      const [r, g, b] = rendered.slice(index, index + 3);
      if (r === 242 && g === 207 && b === 69) colors.yellow++;
      if (r === 235 && g === 98 && b === 86) colors.red++;
      if (r === 105 && g === 181 && b === 245) colors.blue++;
      if ([0, 1, 2].some(channel => Math.abs(rendered[index + channel] - reference[index + channel]) > 24)) different++;
    }
    // Sample the center of the shared stem at artboard coordinates (140, 140).
    const stemPixel = (280 * 560 + 280) * 4;
    const sharedStem = Array.from(rendered.slice(stemPixel, stemPixel + 4));
    return { ...colors, different, sharedStem };
  });
}

async function belowBaseline(page: Page) {
  return page.locator("#animation svg").evaluate(async element => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(element))}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 560; canvas.height = 100;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 560, 100);
    context.drawImage(image, 0, -340, 560, 440);
    const pixels = context.getImageData(0, 0, 560, 100).data;
    let painted = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250) painted++;
    }
    return painted;
  });
}

const treatments = [
  { id: "stops", blueStart: 114, blueSecond: 156, revealStart: 156, finish: 198, lastFrame: 221,
    time: "3.70 s", file: "monk-entrance.json" },
  { id: "all-arches", blueStart: 156, blueSecond: 198, revealStart: 240, finish: 282, lastFrame: 305,
    time: "5.10 s", file: "monk-entrance-all-arches.json" },
] as const;

for (const treatment of treatments) {
  test.describe(treatment.id, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/brand/motion.html");
      await expect(page.getByLabel("Animation progress")).toBeEnabled();
      if (treatment.id !== "stops") {
        await page.getByLabel("Treatment").selectOption(treatment.id);
        await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", String(treatment.lastFrame));
      }
      await expect(page.getByLabel("Animation progress")).toBeEnabled();
    });

    test("keeps every painted frame above the mark baseline", async ({ page }) => {
      for (let frame = 0; frame <= treatment.lastFrame; frame++) {
        await seek(page, frame);
        expect(await belowBaseline(page), `paint below baseline at frame ${frame}`).toBe(0);
      }
    });

    test("starts every color at the left baseline", async ({ page }) => {
      for (const [frame, color] of [
        [1, "242,207,69"], [79, "235,98,86"], [treatment.blueStart + 1, "105,181,245"],
      ] as const) {
        await seek(page, frame);
        const starts = await page.locator(`#animation path[stroke="rgb(${color})"]`).evaluateAll(elements => {
          return elements.flatMap(element => {
            if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
            if (element.getTotalLength() === 0) return [];
            const point = element.getPointAtLength(0);
            return [[point.x, point.y]];
          });
        });
        expect(starts).toEqual([[14, 120]]);
      }
    });

    test("draws each bounce at constant speed with equal time per arch", async ({ page }) => {
      const archLength = 156 + Math.PI * 28;
      const bounces = [
        [0, "242,207,69", 0], [42, "242,207,69", 1],
        [78, "235,98,86", 0], [treatment.blueStart, "105,181,245", 0],
      ] as const;
      const secondBounces = treatment.id === "all-arches"
        ? [[120, "235,98,86", 1], [198, "105,181,245", 1]] as const
        : [];
      for (const [start, color, completed] of [...bounces, ...secondBounces]) {
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
      if (treatment.id === "stops") {
        for (const elapsed of [7, 14, 21, 28, 35, 42]) {
          await seek(page, treatment.blueSecond + elapsed);
          const length = await page.locator('#animation path[stroke="rgb(105,181,245)"]').evaluateAll(elements =>
            elements.reduce((total, element) => {
              if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
              return total + element.getTotalLength();
            }, 0));
          expect(length).toBeCloseTo(archLength, 0);
        }
      }
    });

    test("reveals red as blue clears the first arch", async ({ page }) => {
      await seek(page, treatment.revealStart);
      const before = await paint(page);
      await seek(page, treatment.revealStart + 21);
      const during = await paint(page);
      await seek(page, treatment.finish);
      const after = await paint(page);
      expect(during.red).toBeGreaterThan(before.red + 1000);
      expect(after.red).toBeGreaterThan(during.red + 1000);
      expect(after.sharedStem).toEqual([105, 181, 245, 255]);
    });

    test("introduces colors in order and holds the original mark", async ({ page }) => {
      const timeline = page.getByLabel("Animation progress");
      for (const [frame, visible] of [
        [78, ["yellow"]], [79, ["yellow", "red"]],
        [treatment.blueStart, ["yellow", "red"]], [treatment.blueStart + 1, ["yellow", "red", "blue"]],
      ] as const) {
        await seek(page, frame);
        const result = await paint(page);
        for (const color of ["yellow", "red", "blue"] as const) {
          if (visible.some(value => value === color)) expect(result[color], `${color} at frame ${frame}`).toBeGreaterThan(100);
          else expect(result[color], `${color} at frame ${frame}`).toBe(0);
        }
      }
      for (const frame of [treatment.finish, treatment.lastFrame]) {
        await seek(page, frame);
        const final = await paint(page);
        expect(final.yellow).toBe(0);
        expect(final.red).toBeGreaterThan(10000);
        expect(final.blue).toBeGreaterThan(10000);
        // The Lottie cubic curves must match the original SVG arcs to subpixel accuracy.
        expect(final.different).toBeLessThan(200);
      }
      await expect(page.locator("#time")).toHaveText(treatment.time);

      await page.getByLabel("Slow motion").check();
      await page.getByRole("button", { name: "Replay" }).click();
      await expect(page.getByRole("status")).toHaveText("Playing at half speed.");
      await expect.poll(() => timeline.inputValue()).not.toBe(String(treatment.lastFrame));
      await expect(page.getByRole("status")).toHaveText("Finished.", { timeout: 15000 });
      await expect(timeline).toHaveValue(String(treatment.lastFrame));
      await page.waitForTimeout(250);
      await expect(timeline).toHaveValue(String(treatment.lastFrame));

      const download = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download Lottie" }).click();
      expect((await download).suggestedFilename()).toBe(treatment.file);
    });
  });
}

test("switches treatments without stale playback or downloads", async ({ page }) => {
  await page.goto("/brand/motion.html");
  const selector = page.getByLabel("Treatment");
  const timeline = page.getByLabel("Animation progress");
  await expect(timeline).toBeEnabled();
  await selector.selectOption("all-arches");
  await selector.selectOption("stops");
  await expect(timeline).toBeEnabled();
  await expect(timeline).toHaveAttribute("max", "221");
  await expect(page.locator("#animation svg")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Download Lottie" })).toHaveAttribute("download", "monk-entrance.json");
  await selector.selectOption("all-arches");
  await expect(timeline).toHaveAttribute("max", "305");
  await expect(timeline).toBeEnabled();
  await expect(page.locator("#animation svg")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Download Lottie" })).toHaveAttribute("download", "monk-entrance-all-arches.json");
});

test("keeps the static mark for reduced motion, including a live preference change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/brand/motion.html");
  await expect(page.getByRole("status")).toHaveText("Reduced motion: showing the finished mark.");
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.locator("#animation")).toBeHidden();
  await page.getByLabel("Treatment").selectOption("all-arches");
  await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "305");
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
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
  await page.getByLabel("Treatment").selectOption("all-arches");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("status")).toHaveText("Playing.");
});

test("shows the original mark when the second treatment cannot load", async ({ page }) => {
  await page.route("**/monk-entrance-all-arches.json", route => route.abort());
  await page.goto("/brand/motion.html");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  await page.getByLabel("Treatment").selectOption("all-arches");
  await expect(page.getByRole("status")).toContainText("Could not load the animation.");
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
});
