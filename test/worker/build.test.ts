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
