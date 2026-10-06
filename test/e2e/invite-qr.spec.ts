import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import jsQR from "jsqr";

async function createInvite(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  const link = page.locator("#room-invite-link");
  await expect(link).toBeVisible();
  const url = await link.getAttribute("href");
  if (!url) throw new Error("The room invitation is missing");
  return url;
}

async function decode(page: Page, source: string) {
  const pixels = await page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height,
      data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, source);
  const result = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  expect(result, "The QR image must be readable").not.toBeNull();
  return { url: result?.data, width: pixels.width, height: pixels.height };
}

for (const width of [1280, 320]) {
  test(`offers a scannable invitation and PNG download at ${width}px without native sharing`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    });
    const url = await createInvite(page);
    const qr = page.locator("#invite-qr");
    await expect(qr.getByRole("img")).toBeVisible();
    await expect(qr.getByRole("button", { name: "Share QR code", exact: true })).toHaveCount(0);
    const code = new URL(url).searchParams.get("room");
    expect([...new URL(url).searchParams.keys()]).toEqual(["room"]);
    const svg = await qr.locator("svg").evaluate(element => {
      element.setAttribute("width", "240"); element.setAttribute("height", "240");
      return new XMLSerializer().serializeToString(element);
    });
    expect((await decode(page, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)).url).toBe(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Copy invite link", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();

    const download = page.waitForEvent("download");
    await qr.getByRole("link", { name: "Download QR code", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`monk-room-${code}.png`);
    const path = await file.path();
    if (!path) throw new Error("The QR download is unavailable");
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = await decode(page, `data:image/png;base64,${bytes.toString("base64")}`);
    expect(decoded).toEqual({ url, width: 1024, height: 1024 });
  });
}

test("shares a PNG containing only the public room invitation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "image/png" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0];
      if (!file) throw new Error("The shared QR file is missing");
      const bytes = new Uint8Array(await file.arrayBuffer());
      document.documentElement.dataset.sharedQr = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
      document.documentElement.dataset.sharedName = file.name;
      document.documentElement.dataset.sharedType = file.type;
    } });
  });
  const url = await createInvite(page);
  await page.getByRole("button", { name: "Share QR code", exact: true }).click();
  await expect(page.locator("#invite-qr").getByRole("status")).toContainText("opened for sharing");
  const shared = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  expect(shared.sharedType).toBe("image/png");
  expect(shared.sharedName).toBe(`monk-room-${new URL(url).searchParams.get("room")}.png`);
  expect((await decode(page, `data:image/png;base64,${shared.sharedQr}`)).url).toBe(url);
});

for (const error of ["AbortError", "NotAllowedError"]) {
  test(`keeps the QR download available after native sharing returns ${error}`, async ({ page }) => {
    await page.addInitScript(error => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: async () => {
        throw new DOMException("Sharing did not complete", error);
      } });
    }, error);
    await createInvite(page);
    const qr = page.locator("#invite-qr");
    await qr.getByRole("button", { name: "Share QR code", exact: true }).click();
    if (error === "AbortError") {
      await expect(qr.getByRole("status")).toContainText("Sharing canceled");
      await expect(qr.getByRole("alert")).toHaveCount(0);
    } else {
      await expect(qr.getByRole("alert")).toContainText("Could not share");
    }
    await expect(qr.getByRole("link", { name: "Download QR code", exact: true })).toBeVisible();
    await expect(qr.getByRole("button", { name: "Share QR code", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Copy invite link", exact: true })).toBeEnabled();
  });
}

test("keeps the link and scannable QR when PNG preparation fails", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
  });
  const url = await createInvite(page);
  const qr = page.locator("#invite-qr");
  await expect(qr.getByRole("alert")).toContainText("Could not prepare the QR image");
  await expect(qr.getByRole("img")).toBeVisible();
  await expect(qr.getByRole("link", { name: "Download QR code", exact: true })).toHaveCount(0);
  await expect(page.locator("#room-invite-link")).toHaveAttribute("href", url);
  await expect(page.getByRole("button", { name: "Copy invite link", exact: true })).toBeEnabled();
});
