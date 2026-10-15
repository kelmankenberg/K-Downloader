import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const changelog = await readFile(resolve(root, "changelog.md"), "utf8");
const help = await readFile(resolve(root, "docs/HELP.md"), "utf8");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("package.json must contain a version");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "electron"), { recursive: true });
await mkdir(resolve(output, "gui"), { recursive: true });
await mkdir(resolve(output, "assets"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(root, "src/cli.ts")],
    outfile: resolve(output, "cli.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["playwright", "parse5"],
  }),
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
    define: {
      __CHANGELOG_MARKDOWN__: JSON.stringify(changelog),
      __HELP_MARKDOWN__: JSON.stringify(help),
      __APP_VERSION__: JSON.stringify(manifest.version),
    },
  }),
]);

await Promise.all([
  cp(resolve(root, "gui/index.html"), resolve(output, "gui/index.html")),
  cp(resolve(root, "gui/styles.css"), resolve(output, "gui/styles.css")),
  cp(resolve(root, "assets/khinsider-downloader.png"), resolve(output, "assets/khinsider-downloader.png")),
]);
console.log("Built Electron main/preload and local renderer into dist/.");