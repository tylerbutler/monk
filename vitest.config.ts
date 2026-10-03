import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"], environment: "node",
    environmentOptions: { jsdom: { url: "https://monk.test" } },
  },
});
