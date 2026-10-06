import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "brand-kit",
      apply: "build",
      closeBundle() {
        for (const path of ["index.html", "styles.css", "README.md", "DESIGN.md", "assets", "samples", "studies"]) {
          cpSync(new URL(`./brand/${path}`, import.meta.url), new URL(`./dist/brand/${path}`, import.meta.url),
            { recursive: true });
        }
      },
    },
  ],
  build: { target: "es2022" },
});
