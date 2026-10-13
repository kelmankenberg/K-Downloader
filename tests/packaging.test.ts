import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../electron-builder.config.cjs");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("Linux packaging configuration", () => {
  it("includes application entry, icon, and browser resources", () => {
    expect(manifest.main).toBe("dist/electron/main.cjs");
    expect(config.asar).toBe(true);
    expect(config.extraResources).toContainEqual({ from: ".packaging/chromium", to: "chromium" });
    expect(config.linux.target).toEqual(["deb", "AppImage", "pacman"]);
    expect(config.linux.icon).toBe("assets/k-downloader.png");
    expect(config.linux.desktop.entry.StartupWMClass).toBe("k-downloader");
    expect(manifest.desktopName).toBe("k-downloader.desktop");
  });

  it("provides package targets and smoke testing commands", () => {
    for (const name of ["package:linux", "package:deb", "package:arch", "package:aur", "package:appimage", "package:dir", "test:packages"]) {
      expect(manifest.scripts[name]).toBeTruthy();
    }
  });

  it("uses explicit Arch dependencies and a pacman archive filename", () => {
    expect(config.pacman.packageName).toBe("k-downloader");
    expect(config.pacman.compression).toBe("xz");
    expect(config.pacman.artifactName).toBe("K-Downloader-${version}-x86_64.pkg.tar.xz");
    expect(config.pacman.depends).toEqual(expect.arrayContaining(["glibc", "gtk3", "nss", "alsa-lib", "mesa"]));
    expect(config.pacman.depends).not.toContain("libgtk-3-0");
  });

  it("reports a missing Arch build tool before building the app", () => {
    const result = spawnSync(process.execPath, ["scripts/package-linux.mjs", "pacman"], {
      env: { ...process.env, PATH: "" }, encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Arch packaging requires bsdtar");
  });

  it("routes CLI through embedded Node and GUI through the sandboxed executable", () => {
    const launcher = readFileSync(new URL("../scripts/linux-launcher.sh", import.meta.url), "utf8");
    expect(launcher).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(launcher).toContain("resources/app.asar/dist/cli.cjs");
    expect(launcher).toContain("resources/chromium/chrome");
    expect(launcher).not.toContain("--no-sandbox");
  });
});

describe("AUR binary recipe", () => {
  it("pins the release source and shares native package dependencies", async () => {
    const { renderAurFiles } = await import("../scripts/generate-aur.mjs");
    const checksum = "a".repeat(64);
    const { pkgbuild, srcinfo } = renderAurFiles("0.1.0", checksum);
    expect(pkgbuild).toContain("releases/download/v0.1.0/K-Downloader-0.1.0-x86_64.pkg.tar.xz");
    expect(pkgbuild).toContain(`sha256sums_x86_64=('${checksum}')`);
    expect(srcinfo).toContain(`sha256sums_x86_64 = ${checksum}`);
    for (const dependency of config.pacman.depends) {
      expect(pkgbuild).toContain(`'${dependency}'`);
      expect(srcinfo).toContain(`depends = ${dependency}\n`);
    }
    expect(pkgbuild).toContain("--exclude='.INSTALL'");
    expect(pkgbuild).toContain("/usr/bin/k-downloader");
    expect(pkgbuild).toContain('chmod 4755 "$pkgdir/opt/K-Downloader/chrome-sandbox"');
    expect(pkgbuild).not.toContain("--no-sandbox");
    execFileSync("bash", ["-n"], { input: pkgbuild });
  });

  it("rejects unsafe versions and unpinned sources", async () => {
    const { renderAurFiles } = await import("../scripts/generate-aur.mjs");
    expect(() => renderAurFiles("0.1.0; command", "a".repeat(64))).toThrow("stable numeric");
    expect(() => renderAurFiles("0.1.0", "SKIP")).toThrow("SHA-256");
  });

  it("hashes the artifact and writes both AUR metadata files", async () => {
    const { generateAur } = await import("../scripts/generate-aur.mjs");
    const directory = await mkdtemp(resolve(tmpdir(), "k-downloader-aur-"));
    try {
      const artifact = resolve(directory, "archive.pkg.tar.xz");
      await writeFile(artifact, "offline test artifact");
      const output = resolve(directory, "aur");
      await generateAur(artifact, output, "0.1.0");
      const checksum = createHash("sha256").update("offline test artifact").digest("hex");
      expect(await readFile(resolve(output, "PKGBUILD"), "utf8")).toContain(checksum);
      expect(await readFile(resolve(output, ".SRCINFO"), "utf8")).toContain(checksum);
      await expect(generateAur(resolve(directory, "missing"), output, "0.1.0")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});