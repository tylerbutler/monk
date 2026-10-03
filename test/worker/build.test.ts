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
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  for (const size of [192, 512]) {
    const icon = await SELF.fetch(`https://monk.test/icons/icon-${size}.png`);
    expect(icon.headers.get("content-type")).toContain("image/png");
    const bytes = new DataView(await icon.arrayBuffer());
    expect(bytes.getUint32(16)).toBe(size);
    expect(bytes.getUint32(20)).toBe(size);
  }
});
it("refuses private session creation on an insecure non-loopback origin", async () => {
  const response = await SELF.fetch("http://monk.test/api/matches", { method: "POST", body: "{}" });
  expect(response.status).toBe(426);
});
