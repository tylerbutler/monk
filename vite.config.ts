import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  resolve: {
    alias: {
      "lottie-web": fileURLToPath(new URL("./node_modules/lottie-web/build/player/lottie_light.js", import.meta.url)),
    },
  },
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
  build: {
    target: "es2022",
    rolldownOptions: {
      input: { app: "index.html", motion: "brand/motion.html", conversionMotion: "brand/conversion-motion.html" },
    },
  },
});
