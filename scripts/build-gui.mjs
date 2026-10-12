import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "electron"), { recursive: true });
await mkdir(resolve(output, "gui"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(root, "src/electron/main.ts")],
    outfile: resolve(output, "electron/main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron", "playwright", "parse5"],
  }),
  build({
    entryPoints: [resolve(root, "src/electron/preload.ts")],
    outfile: resolve(output, "electron/preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    entryPoints: [resolve(root, "src/renderer.ts")],
    outfile: resolve(output, "gui/renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
  }),
]);

await Promise.all([
  cp(resolve(root, "gui/index.html"), resolve(output, "gui/index.html")),
  cp(resolve(root, "gui/styles.css"), resolve(output, "gui/styles.css")),
]);
console.log("Built Electron main/preload and local renderer into dist/.");