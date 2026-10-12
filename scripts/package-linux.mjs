import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const targets = process.argv.slice(2);
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Packaging currently requires a Linux x64 build host.");
if (targets.some((target) => !["deb", "AppImage", "dir"].includes(target))) throw new Error("Supported targets: deb, AppImage, dir");
const selected = targets.length ? targets : ["deb", "AppImage"];
const config = require(resolve(root, "electron-builder.config.cjs"));

function command(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, stdio: "inherit", ...options });
}

function maintainer() {
  if (process.env.K_DOWNLOADER_MAINTAINER) return process.env.K_DOWNLOADER_MAINTAINER;
  try {
    const name = command("git", ["config", "user.name"], { encoding: "utf8", stdio: "pipe" }).trim();
    const email = command("git", ["config", "user.email"], { encoding: "utf8", stdio: "pipe" }).trim();
    if (name && email) return `${name} <${email}>`;
  } catch {}
  throw new Error("Set K_DOWNLOADER_MAINTAINER='Name <email>' or configure Git user.name/user.email for .deb metadata.");
}

const packageMaintainer = selected.includes("deb") ? maintainer() : undefined;
command(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit"]);
command(process.execPath, [resolve(root, "scripts/build-gui.mjs")]);

const browserEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve(root, ".packaging/browser-cache") };
const playwrightCli = resolve(dirname(require.resolve("playwright/package.json")), "cli.js");
command(process.execPath, [playwrightCli, "install", "chromium", "--no-shell"], { env: browserEnv });
const browserPath = command(process.execPath, ["-e", "console.log(require('playwright').chromium.executablePath())"], {
  env: browserEnv, stdio: "pipe", encoding: "utf8",
}).trim();
await mkdir(resolve(root, ".packaging"), { recursive: true });
await rm(resolve(root, ".packaging/chromium"), { recursive: true, force: true });
await cp(dirname(browserPath), resolve(root, ".packaging/chromium"), { recursive: true, force: true });

const electronExecutable = require("electron");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const artifacts = await build({
  projectDir: root,
  targets: Platform.LINUX.createTarget(selected, Arch.x64),
  publish: "never",
  config: {
    ...config,
    electronDist: dirname(electronExecutable),
    electronVersion: require("electron/package.json").version,
    ...(packageMaintainer ? { deb: { ...config.deb, maintainer: packageMaintainer } } : {}),
  },
});
const checksums = [];
for (const artifact of artifacts.filter((path) => path.endsWith(".deb") || path.endsWith(".AppImage"))) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  checksums.push(`${hash.digest("hex")}  ${artifact.split("/").at(-1)}`);
}
if (checksums.length) {
  const filename = `K-Downloader-${manifest.version}-SHA256SUMS.txt`;
  await writeFile(resolve(root, "release", filename), `${checksums.join("\n")}\n`);
}
console.log("Package output: release/ (nothing was published to GitHub).");