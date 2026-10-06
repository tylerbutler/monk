import { expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { isSuperior } from "../../src/worker/engine";

it("runs compiled Gleam inside the Workers runtime", () => {
  expect(isSuperior("paper", "rock")).toBe(true);
});

it("returns a JSON 404 for unknown API routes", async () => {
  const response = await SELF.fetch("https://monk.test/api/unknown");
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toContain("application/json");
});

it("delivers the install manifest and exact-size PNG icons through the Worker", async () => {
  const response = await SELF.fetch("https://monk.test/manifest.webmanifest");
  expect(response.status).toBe(200);
  const manifest: unknown = await response.json();
  expect(manifest).toMatchObject({ name: "Monk", short_name: "Monk", display: "standalone", start_url: "/" });
  for (const size of [192, 512]) {
    const icon = await SELF.fetch(`https://monk.test/icons/icon-${size}.png`);
    expect(icon.headers.get("content-type")).toContain("image/png");
    const bytes = new DataView(await icon.arrayBuffer());
    expect(bytes.getUint32(16)).toBe(size);
    expect(bytes.getUint32(20)).toBe(size);
  }
});
it("serves the Monk game page identity", async () => {
  const response = await SELF.fetch("https://monk.test/");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("<title>Monk</title>");
  expect(html).not.toContain("outdoor playtest");
});
it("serves the avatar artwork as the game favicon", async () => {
  const html = await (await SELF.fetch("https://monk.test/")).text();
  const path = html.match(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"/)?.[1];
  if (!path) throw new Error("The game favicon is missing");
  const response = await SELF.fetch(new URL(path, "https://monk.test"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("image/svg+xml");
  const svg = await response.text();
  expect(svg).toContain('viewBox="0 0 512 512"');
  for (const color of ["#eb6256", "#f2cf45", "#69b5f5"]) expect(svg).toContain(color);
});
it("redirects the brand kit to its directory URL and preserves query parameters", async () => {
  const response = await SELF.fetch("https://monk.test/brand?source=invite", { redirect: "manual" });
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get("location") ?? "", "https://monk.test").href)
    .toBe("https://monk.test/brand/?source=invite");
});
it("serves the brand page and every linked asset and download", async () => {
  const url = "https://monk.test/brand/";
  const response = await SELF.fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("<title>Monk - Side by Side identity kit</title>");
  expect(html).toContain("Change sides.");
  const links = new Set(Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), match => match[1])
    .filter(path => !path.startsWith("#")));
  expect(links.size).toBeGreaterThan(10);
  expect(links.has("studies/")).toBe(true);
  for (const path of links) {
    const asset = await SELF.fetch(new URL(path, url));
    expect(asset.status, path).toBe(200);
    expect((await asset.arrayBuffer()).byteLength, path).toBeGreaterThan(0);
  }
});
it("publishes the faction palette and exact-size brand samples", async () => {
  const css = await (await SELF.fetch("https://monk.test/brand/styles.css")).text();
  const avatar = await (await SELF.fetch("https://monk.test/brand/assets/avatar.svg")).text();
  for (const color of ["#eb6256", "#f2cf45", "#69b5f5"]) {
    expect(css).toContain(color);
    expect(avatar).toContain(color);
  }
  for (const [file, width, height] of [
    ["social-1200x630.png", 1200, 630],
    ["invite-1080.png", 1080, 1080],
    ["avatar-512.png", 512, 512],
  ] as const) {
    const response = await SELF.fetch(`https://monk.test/brand/samples/${file}`);
    expect(response.status, file).toBe(200);
    expect(response.headers.get("content-type"), file).toContain("image/png");
    const bytes = new DataView(await response.arrayBuffer());
    expect(bytes.getUint32(16), file).toBe(width);
    expect(bytes.getUint32(20), file).toBe(height);
  }
});
it("serves the faction workups and every linked download", async () => {
  const url = "https://monk.test/brand/studies/";
  const response = await SELF.fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  const links = new Set(Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), match => match[1]));
  for (const path of ["../", "rock.png", "paper.png", "scissors.png", "comparison.png", "LICENSE-tabler.txt"]) {
    expect(links.has(path), path).toBe(true);
  }
  for (const path of links) {
    const asset = await SELF.fetch(new URL(path, url));
    expect(asset.status, path).toBe(200);
    expect((await asset.arrayBuffer()).byteLength, path).toBeGreaterThan(0);
  }
});
it("does not publish internal design records", async () => {
  const response = await SELF.fetch("https://monk.test/brand/.impeccable/design.json");
  expect(response.status).toBe(404);
});
it("refuses private session creation on an insecure non-loopback origin", async () => {
  const response = await SELF.fetch("http://monk.test/api/matches", { method: "POST", body: "{}" });
  expect(response.status).toBe(426);
});
