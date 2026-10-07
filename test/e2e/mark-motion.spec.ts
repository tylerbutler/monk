import { test, expect, type Page } from "@playwright/test";

async function seek(page: Page, frame: number) {
  await page.getByLabel("Animation progress").evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected the timeline");
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);
}

async function paint(page: Page, referenceFile: "symbol-paired.svg" | "wordmark-paired.svg" = "symbol-paired.svg") {
  return page.locator("#animation svg").evaluate(async (element, file) => {
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
    const source = await (await fetch(`/brand/assets/${file}`)).text();
    const bounds = file === "wordmark-paired.svg"
      ? 'x="20" y="73.2183908045977" width="240" height="73.5632183908046" viewBox="0 0 522 160"'
      : 'x="70" y="50" width="140" height="120" viewBox="0 0 140 120"';
    const reference = await pixels(`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="220" viewBox="0 0 280 220">
      <svg ${bounds}>${source}</svg></svg>`);
    const colors = { yellow: 0, red: 0, blue: 0, ink: 0 };
    const letters = { o: 0, n: 0, k: 0 };
    const palette = new Set(["255,255,255", "242,207,69", "235,98,86", "105,181,245", "23,23,25"]);
    let left = 560;
    let right = 0;
    let different = 0;
    let solidDifferent = 0;
    let outlined = 0;
    for (let index = 0; index < rendered.length; index += 4) {
      const [r, g, b] = rendered.slice(index, index + 3);
      if (r === 242 && g === 207 && b === 69) colors.yellow++;
      if (r === 235 && g === 98 && b === 86) colors.red++;
      if (r === 105 && g === 181 && b === 245) colors.blue++;
      if (r === 23 && g === 23 && b === 25) colors.ink++;
      const x = index / 4 % 560;
      if ((r === 235 && g === 98 && b === 86) || (r === 105 && g === 181 && b === 245)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      if (r < 210 && g < 210 && b < 210) {
        if (x >= 190 && x < 292) letters.o++;
        if (x >= 306 && x < 388) letters.n++;
        if (x >= 414 && x < 522) letters.k++;
      }
      if (r >= 250 && g >= 250 && b >= 250
        && [0, 1, 2].some(channel => reference[index + channel] < 220)) outlined++;
      if ([0, 1, 2].some(channel => Math.abs(rendered[index + channel] - reference[index + channel]) > 24)) {
        different++;
        if (palette.has(`${r},${g},${b}`) && palette.has(reference.slice(index, index + 3).join(","))) solidDifferent++;
      }
    }
    // Sample the center of the shared stem at artboard coordinates (140, 140).
    const stemPixel = (280 * 560 + 280) * 4;
    const sharedStem = Array.from(rendered.slice(stemPixel, stemPixel + 4));
    return { ...colors, different, solidDifferent, outlined, sharedStem, letters, left, width: Math.max(0, right - left + 1) };
  }, referenceFile);
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

async function timing(page: Page) {
  const href = await page.getByRole("link", { name: "Download Lottie" }).getAttribute("href");
  if (!href) throw new Error("Animation download is missing");
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null
    || !("ip" in data) || typeof data.ip !== "number"
    || !("op" in data) || typeof data.op !== "number"
    || !("fr" in data) || typeof data.fr !== "number") throw new Error("Invalid animation timing");
  return { seconds: (data.op - data.ip) / data.fr, frameRate: data.fr };
}

async function risingOutlines(page: Page) {
  return page.locator('#animation path[stroke="rgb(255,255,255)"]').evaluateAll(elements =>
    elements.filter(element => element.getClientRects().length > 0
      && element instanceof SVGPathElement && element.getTotalLength() > 0).length);
}

const treatments = [
  { id: "stops", archFrames: 42, redStart: 78, blueStart: 114, blueSecond: 156,
    secondStart: 78, secondColor: "red", thirdStart: 114, thirdColor: "blue",
    revealStart: 156, revealMiddle: 177, revealColor: "red", finish: 198, lastFrame: 221,
    seconds: 3.7, archSeconds: 0.7, time: "3.70 s", file: "monk-entrance.json" },
  { id: "all-arches", archFrames: 21, redStart: 78, blueStart: 39, blueSecond: 60,
    secondStart: 39, secondColor: "blue", thirdStart: 78, thirdColor: "red",
    revealStart: 120, revealMiddle: 130, revealColor: "blue", finish: 141, lastFrame: 152,
    seconds: 1.275, archSeconds: 0.175, time: "1.275 s", file: "monk-entrance-all-arches.json" },
  { id: "realistic", archFrames: 30, redStart: 114, blueStart: 57, blueSecond: 87,
    secondStart: 57, secondColor: "blue", thirdStart: 114, thirdColor: "red",
    revealStart: 174, revealMiddle: 189, revealColor: "blue", finish: 204, lastFrame: 221,
    seconds: 3.7, archSeconds: 0.5, time: "3.70 s", file: "monk-entrance-realistic.json" },
] as const;

for (const treatment of treatments) {
  test.describe(treatment.id, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/brand/motion.html");
      await expect(page.getByLabel("Animation progress")).toBeEnabled();
      if (treatment.id !== "stops") {
        await expect(page.locator(`#treatment option[value="${treatment.id}"]`)).toHaveCount(1);
        await page.getByLabel("Treatment").selectOption(treatment.id);
      }
      await expect(page.getByLabel("Animation progress")).toBeEnabled();
    });

    test("uses the required real-time duration in its download and player", async ({ page }) => {
      const data = await timing(page);
      expect(data.seconds).toBe(treatment.seconds);
      expect(treatment.archFrames / data.frameRate).toBe(treatment.archSeconds);
      await seek(page, treatment.lastFrame);
      await expect(page.locator("#time")).toHaveText(treatment.time);
      await expect(page.locator("#format")).toContainText(`${data.frameRate} fps`);
    });

    test("outlines rising strokes and removes the outline at the peak", async ({ page }) => {
      await seek(page, treatment.thirdStart + 6);
      expect(await risingOutlines(page)).toBeGreaterThan(0);
      expect((await paint(page)).outlined).toBeGreaterThan(20);
      await seek(page, Math.ceil(treatment.thirdStart + treatment.archFrames / 2));
      expect(await risingOutlines(page)).toBe(0);
    });

    test("keeps every painted frame above the mark baseline", async ({ page }) => {
      for (let frame = 0; frame <= treatment.lastFrame; frame++) {
        await seek(page, frame);
        expect(await belowBaseline(page), `paint below baseline at frame ${frame}`).toBe(0);
      }
    });

    test("starts every color at the left baseline", async ({ page }) => {
      for (const [frame, color] of [
        [1, "242,207,69"], [treatment.redStart + 1, "235,98,86"], [treatment.blueStart + 1, "105,181,245"],
      ] as const) {
        await seek(page, frame);
        const starts = await page.locator(`#animation path[stroke="rgb(${color})"]`).evaluateAll(elements => {
          return elements.flatMap(element => {
            if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
            if (element.getClientRects().length === 0 || element.getTotalLength() === 0) return [];
            const point = element.getPointAtLength(0);
            return [[point.x, point.y]];
          });
        });
        expect(starts).toEqual([[14, 120]]);
      }
    });

    test("draws each bounce with the specified timing", async ({ page }) => {
      const archLength = 156 + Math.PI * 28;
      const bounces = [
        [0, "242,207,69", 0], [treatment.archFrames, "242,207,69", 1],
        [treatment.redStart, "235,98,86", 0], [treatment.blueStart, "105,181,245", 0],
      ] as const;
      const secondBounces = treatment.id === "all-arches"
        ? [[99, "235,98,86", 1], [60, "105,181,245", 1]] as const
        : treatment.id === "realistic" ? [[144, "235,98,86", 1], [87, "105,181,245", 1]] as const : [];
      const samples = treatment.id === "realistic"
        ? [[6, .32], [12, .48], [15, .5], [18, .52], [24, .68], [30, 1]]
        : [1, 2, 3, 4, 5, 6, 7].map(step => [step * treatment.archFrames / 7, step / 7]);
      for (const [start, color, completed] of [...bounces, ...secondBounces]) {
        for (const [elapsed, fraction] of samples) {
          await seek(page, start + elapsed);
          const length = await page.locator(`#animation path[stroke="rgb(${color})"]`).evaluateAll(elements => {
            return elements.reduce((total, element) => {
              if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
              if (element.getClientRects().length === 0) return total;
              return total + element.getTotalLength();
            }, 0);
          });
          expect(length, `${color} from frame ${start} after ${elapsed} frames`)
            .toBeCloseTo(archLength * (completed + fraction), 0);
        }
      }
      if (treatment.id === "stops") {
        for (const elapsed of [7, 14, 21, 28, 35, 42]) {
          await seek(page, treatment.blueSecond + elapsed);
          const length = await page.locator('#animation path[stroke="rgb(105,181,245)"]').evaluateAll(elements =>
            elements.reduce((total, element) => {
              if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
              if (element.getClientRects().length === 0) return total;
              return total + element.getTotalLength();
            }, 0));
          expect(length).toBeCloseTo(archLength, 0);
        }
      }
    });

    test("reveals the final color as the last trail clears", async ({ page }) => {
      await seek(page, treatment.revealStart);
      const before = await paint(page);
      await seek(page, treatment.revealMiddle);
      const during = await paint(page);
      await seek(page, treatment.finish);
      const after = await paint(page);
      expect(during[treatment.revealColor]).toBeGreaterThan(before[treatment.revealColor] + 1000);
      expect(after[treatment.revealColor]).toBeGreaterThan(during[treatment.revealColor] + 1000);
      expect(after.sharedStem).toEqual([105, 181, 245, 255]);
    });

    if (treatment.id === "all-arches") {
      test("shows red completing the first bounce before starting the second", async ({ page }) => {
        for (const [frame, color] of [
          [95, [105, 181, 245, 255]], [97, [235, 98, 86, 255]], [99, [235, 98, 86, 255]],
        ] as const) {
          await seek(page, frame);
          expect((await paint(page)).sharedStem, `shared stem at frame ${frame}`).toEqual(color);
        }
      });
    }

    test("introduces colors in order and holds the original mark", async ({ page }) => {
      const timeline = page.getByLabel("Animation progress");
      for (const [frame, visible] of [
        [treatment.secondStart, ["yellow"]], [treatment.secondStart + 1, ["yellow", treatment.secondColor]],
        [treatment.thirdStart, ["yellow", treatment.secondColor]],
        [treatment.thirdStart + 1, ["yellow", treatment.secondColor, treatment.thirdColor]],
      ] as const) {
        await seek(page, frame);
        const result = await paint(page);
        for (const color of ["yellow", "red", "blue"] as const) {
          if (visible.some(value => value === color)) expect(result[color], `${color} at frame ${frame}`).toBeGreaterThan(100);
          else expect(result[color], `${color} at frame ${frame}`).toBe(0);
        }
      }
      await expect(timeline).toHaveAttribute("max", String(treatment.lastFrame));
      await expect(page.locator(".stage")).toHaveAttribute("aria-label", treatment.id === "stops"
        ? "Monk arches painted in yellow, then red and blue"
        : "Monk arches painted in yellow, then blue and red");
      await expect(page.locator("#lead")).toHaveText(treatment.id === "stops"
        ? "Yellow leads. Red follows. Blue brings it home."
        : "Yellow leads. Blue follows. Red brings it home.");
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

test.describe("wordmark", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/brand/motion.html");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    await expect(page.locator('#treatment option[value="wordmark"]')).toHaveCount(1);
    await page.getByLabel("Treatment").selectOption("wordmark");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "329");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
  });

  test("preserves the Realistic bounce opening before the wordmark transition", async ({ page }) => {
    await page.getByLabel("Treatment").selectOption("realistic");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "221");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    const samples = [];
    for (const frame of [0, 6, 15, 30, 57, 87, 114, 120, 144, 174, 189, 204, 221]) {
      await seek(page, frame);
      samples.push({ frame, result: await paint(page) });
    }
    await page.getByLabel("Treatment").selectOption("wordmark");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "329");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    for (const { frame, result } of samples) {
      await seek(page, frame);
      expect(await paint(page), `Realistic bounce pixels at frame ${frame}`).toEqual(result);
    }
    await seek(page, 120);
    expect(await risingOutlines(page)).toBeGreaterThan(0);
    await seek(page, 204);
    expect(await risingOutlines(page)).toBe(0);
  });

  test("moves and scales the finished colored m left before revealing letters", async ({ page }) => {
    await seek(page, 222);
    const before = await paint(page);
    await seek(page, 238);
    const during = await paint(page);
    await seek(page, 255);
    const after = await paint(page);
    expect(before.different).toBeLessThan(200);
    expect(during.left).toBeLessThan(before.left);
    expect(after.left).toBeLessThan(during.left);
    expect(during.width).toBeLessThan(before.width);
    expect(during.width).toBeGreaterThan(after.width);
    expect(after.left).toBeCloseTo(40, -1);
    expect(after.width).toBeGreaterThanOrEqual(127);
    expect(after.width).toBeLessThanOrEqual(130);
    expect(after.red).toBeGreaterThan(2000);
    expect(after.blue).toBeGreaterThan(2000);
    expect(after.yellow).toBe(0);
    expect(after.letters).toEqual({ o: 0, n: 0, k: 0 });
    expect(await risingOutlines(page)).toBe(0);
  });

  test("reveals o, n, then k and finishes on the supplied wordmark geometry", async ({ page }) => {
    for (const [frame, visible] of [[259, ["o"]], [265, ["o", "n"]], [271, ["o", "n", "k"]]] as const) {
      await seek(page, frame);
      const result = await paint(page, "wordmark-paired.svg");
      for (const letter of ["o", "n", "k"] as const) {
        if (visible.some(value => value === letter)) expect(result.letters[letter]).toBeGreaterThan(100);
        else expect(result.letters[letter]).toBe(0);
      }
    }
    for (const frame of [282, 329]) {
      await seek(page, frame);
      const result = await paint(page, "wordmark-paired.svg");
      // Native SVG and Lottie smooth edges differently; solid pixels must still agree.
      expect(result.solidDifferent).toBe(0);
      expect(result.different).toBeLessThan(600);
      expect(result.ink).toBeGreaterThan(10000);
      expect(result.red).toBeGreaterThan(2000);
      expect(result.blue).toBeGreaterThan(2000);
      expect(result.yellow).toBe(0);
      expect(await risingOutlines(page)).toBe(0);
    }
  });

  test("plays the 5.5-second sequence once and downloads the matching vector asset", async ({ page }) => {
    expect(await timing(page)).toEqual({ seconds: 5.5, frameRate: 60 });
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toHaveText("Playing.");
    await expect(page.getByRole("status")).toHaveText("Finished.");
    await expect(page.getByLabel("Animation progress")).toHaveValue("329");
    await expect(page.locator("#time")).toHaveText("5.50 s");
    await page.waitForTimeout(150);
    await expect(page.getByLabel("Animation progress")).toHaveValue("329");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download Lottie" }).click();
    expect((await download).suggestedFilename()).toBe("monk-entrance-wordmark.json");
  });

  test("keeps all paint and letters above the original baseline", async ({ page }) => {
    for (let frame = 0; frame < 330; frame++) {
      await seek(page, frame);
      expect(await belowBaseline(page), `wordmark pixels below baseline at ${frame}`).toBe(0);
    }
  });

  test("shows the full static wordmark for reduced motion and restores the symbol when switched", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#still")).toBeVisible();
    await expect(page.locator("#still image")).toHaveAttribute("href", "./assets/wordmark-paired.svg");
    await expect(page.locator("#still image")).toHaveAttribute("width", "240");
    await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Treatment").selectOption("stops");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "221");
    await expect(page.locator("#still image")).toHaveAttribute("href", "./assets/symbol-paired.svg");
    await expect(page.locator("#still image")).toHaveAttribute("width", "140");
    await page.getByLabel("Treatment").selectOption("wordmark");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "329");
    await expect(page.locator("#still image")).toHaveAttribute("href", "./assets/wordmark-paired.svg");
    await expect(page.getByLabel("Animation progress")).toBeDisabled();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toHaveText("Playing.");
  });

  test("keeps the full static wordmark when its animation fails to load", async ({ page }) => {
    await page.route("**/monk-entrance-wordmark.json", route => route.abort());
    await page.getByLabel("Treatment").selectOption("stops");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "221");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    await page.getByLabel("Treatment").selectOption("wordmark");
    await expect(page.getByRole("status")).toContainText("Could not load the animation.");
    await expect(page.locator("#still")).toBeVisible();
    await expect(page.locator("#still image")).toHaveAttribute("href", "./assets/wordmark-paired.svg");
    await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
    await page.getByLabel("Treatment").selectOption("stops");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    await expect(page.locator("#still image")).toHaveAttribute("href", "./assets/symbol-paired.svg");
  });
});

test.describe("loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/brand/motion.html");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    await expect(page.locator('#treatment option[value="loading"]')).toHaveCount(1);
    await page.getByLabel("Treatment").selectOption("loading");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "125");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
  });

  test("uses realistic timing for every bounce while retaining the 2.1-second loop", async ({ page }) => {
    const archLength = 156 + Math.PI * 28;
    for (const [start, color, completed] of [
      [0, "242,207,69", 0], [21, "242,207,69", 1],
      [42, "105,181,245", 0], [63, "105,181,245", 1],
      [84, "235,98,86", 2], [105, "235,98,86", 3],
    ] as const) {
      for (const [elapsed, fraction] of [
        [3, 12 / 49], [6, 20 / 49], [9, 24 / 49],
        [12, 25 / 49], [15, 29 / 49], [18, 37 / 49],
      ]) {
        await seek(page, start + elapsed);
        const length = await page.locator(`#animation path[stroke="rgb(${color})"]`).evaluateAll(elements =>
          elements.reduce((total, element) => {
            if (!(element instanceof SVGPathElement)) throw new Error("Expected a paint path");
            if (element.getClientRects().length === 0) return total;
            return total + element.getTotalLength();
          }, 0));
        expect(length, `${color} bounce from ${start} after ${elapsed} frames`)
          .toBeCloseTo(archLength * (completed + fraction), 0);
      }
    }
    expect(await timing(page)).toEqual({ seconds: 2.1, frameRate: 60 });
  });

  test("keeps the complete m visible as yellow, blue, and red cycle", async ({ page }) => {
    for (const [frame, color] of [[0, "red"], [42, "yellow"], [84, "blue"]] as const) {
      await seek(page, frame);
      const result = await paint(page);
      expect(result[color]).toBeGreaterThan(20000);
      for (const other of ["yellow", "blue", "red"] as const) {
        if (other !== color) expect(result[other]).toBe(0);
      }
    }
    // Sample the early rise before the leading white edge narrows near the peak.
    await seek(page, 88);
    expect(await risingOutlines(page)).toBeGreaterThan(0);
    expect((await paint(page)).outlined).toBeGreaterThan(20);
    await seek(page, 90);
    expect(await risingOutlines(page)).toBeGreaterThan(0);
    await seek(page, 95);
    expect(await risingOutlines(page)).toBe(0);
    for (let frame = 0; frame < 126; frame++) {
      await seek(page, frame);
      expect(await belowBaseline(page), `loading paint below baseline at ${frame}`).toBe(0);
    }
    await seek(page, 125);
    expect((await paint(page)).red).toBeGreaterThan(20000);
    await expect(page.getByRole("status")).toHaveText("Paused.");
    expect((await timing(page)).seconds).toBe(2.1);
  });

  test("loops without a final hold and downloads the loading asset", async ({ page }) => {
    await page.getByLabel("Slow motion").check();
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toHaveText("Looping at half speed.");
    const progress = page.getByLabel("Animation progress");
    await expect.poll(async () => Number(await progress.inputValue()), { timeout: 6000 }).toBeGreaterThan(100);
    await expect.poll(async () => Number(await progress.inputValue()), { timeout: 6000 }).toBeLessThan(30);
    await expect(page.getByRole("status")).toHaveText("Looping at half speed.");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download Lottie" }).click();
    expect((await download).suggestedFilename()).toBe("monk-loading.json");
    await page.getByLabel("Treatment").selectOption("all-arches");
    await expect(progress).toHaveAttribute("max", "152");
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toHaveText("Playing at half speed.");
    await expect(page.getByRole("status")).toHaveText("Finished.");
    await expect(progress).toHaveValue("152");
  });

  test("stays paused when hidden before the loading asset arrives", async ({ page }) => {
    await page.getByLabel("Treatment").selectOption("stops");
    await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "221");
    await expect(page.getByLabel("Animation progress")).toBeEnabled();
    await page.route("**/monk-loading.json", async route => {
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await route.continue();
    });
    await page.getByLabel("Treatment").selectOption("loading");
    const progress = page.getByLabel("Animation progress");
    await expect(progress).toHaveAttribute("max", "125");
    await expect(progress).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("Paused.");
    const frame = await progress.inputValue();
    await page.waitForTimeout(100);
    await expect(progress).toHaveValue(frame);
  });

  test("pauses the loop when hidden and shows the static reduced-motion fallback", async ({ page }) => {
    await expect(page.getByRole("status")).toHaveText("Looping.");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("status")).toHaveText("Paused.");
    const frame = await page.getByLabel("Animation progress").inputValue();
    await page.waitForTimeout(100);
    await expect(page.getByLabel("Animation progress")).toHaveValue(frame);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toHaveText("Looping.");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#still")).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
    await expect(page.getByLabel("Animation progress")).toBeDisabled();
  });
});

test("shows the static mark when the loading asset cannot load", async ({ page }) => {
  await page.route("**/monk-loading.json", route => route.abort());
  await page.goto("/brand/motion.html");
  await expect(page.getByLabel("Animation progress")).toBeEnabled();
  await expect(page.locator('#treatment option[value="loading"]')).toHaveCount(1);
  await page.getByLabel("Treatment").selectOption("loading");
  await expect(page.getByRole("status")).toContainText("Could not load the animation.");
  await expect(page.locator("#still")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
});

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
  await expect(timeline).toHaveAttribute("max", "152");
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
  await expect(page.getByLabel("Animation progress")).toHaveAttribute("max", "152");
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
