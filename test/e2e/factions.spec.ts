import { test, expect } from "./fixtures";

function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Expected an opaque RGB color: ${color}`);
  const [r, g, b] = channels.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return r * .2126 + g * .7152 + b * .0722;
}

test("loads legible faction icons and keeps badge colors consistent through faction changes", async ({ page, duel }) => {
  await page.goto("/");
  await duel.host.setViewportSize({ width: 320, height: 640 });
  for (const screen of [page, duel.host, duel.guest]) {
    const icons = screen.locator("img.ui-icon");
    expect(await icons.count()).toBeGreaterThan(0);
    await icons.evaluateAll(elements => Promise.all(elements.map(element => {
      if (!(element instanceof HTMLImageElement)) throw new Error("Expected an image icon");
      return element.decode();
    })));
  }
  if (!(await duel.host.locator("#faction-controls-toggle").isVisible())) {
    await duel.host.locator("#host-tools-toggle").click();
  }
  if (!(await duel.host.getByLabel("Faction for Test Rock", { exact: true }).isVisible())) {
    await duel.host.locator("#faction-controls-toggle").click();
  }
  for (const faction of ["paper", "scissors", "rock"]) {
    const icon = page.locator(`.faction-cycle [data-faction="${faction}"] svg`);
    const source = await icon.locator("image").getAttribute("href");
    if (!source) throw new Error(`Missing ${faction} icon`);
    await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty faction icon");
    }, source);
    const background = await icon.evaluate(element => getComputedStyle(element).backgroundColor);
    expect((luminance(background) + .05) / .05).toBeGreaterThanOrEqual(3);

    await duel.host.getByLabel("Faction for Test Rock", { exact: true }).selectOption(faction);
    const own = duel.host.locator(".own-faction");
    const marker = duel.guest.locator('[data-radar-player][data-relationship]');
    await expect(own).toHaveAttribute("data-faction", faction);
    await expect.poll(() => own.locator("h2").evaluate(element =>
      element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight))).toBe(1);
    await expect(marker).toHaveAttribute("data-faction", faction);
    await expect(own.locator("svg")).toHaveCSS("background-color", background);
    await expect(marker.locator(".radar-marker-body")).toHaveCSS("fill", background);
    await expect(own.locator("image")).toHaveAttribute("href", source);
    await expect(marker.locator("image")).toHaveAttribute("href", source);
    const badge = duel.guest.locator('.radar-players .faction-icon');
    await expect(badge).toHaveAttribute("data-faction", faction);
    await expect(badge).toHaveAttribute("src", source);
  }
});
