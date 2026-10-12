import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../electron-builder.config.cjs");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("Linux packaging configuration", () => {
  it("includes application entry, icon, and browser resources", () => {
    expect(manifest.main).toBe("dist/electron/main.cjs");
    expect(config.asar).toBe(true);
    expect(config.extraResources).toContainEqual({ from: ".packaging/chromium", to: "chromium" });
    expect(config.linux.target).toEqual(["deb", "AppImage"]);
    expect(config.linux.icon).toBe("assets/k-downloader.png");
    expect(config.linux.desktop.entry.StartupWMClass).toBe("k-downloader");
    expect(manifest.desktopName).toBe("k-downloader.desktop");
  });

  it("provides both package targets and smoke testing commands", () => {
    for (const name of ["package:linux", "package:deb", "package:appimage", "package:dir", "test:packages"]) {
      expect(manifest.scripts[name]).toBeTruthy();
    }
  });

  it("routes CLI through embedded Node and GUI through the sandboxed executable", () => {
    const launcher = readFileSync(new URL("../scripts/linux-launcher.sh", import.meta.url), "utf8");
    expect(launcher).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(launcher).toContain("resources/app.asar/dist/cli.cjs");
    expect(launcher).toContain("resources/chromium/chrome");
    expect(launcher).not.toContain("--no-sandbox");
  });
});