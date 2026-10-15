import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const config = require(resolve(root, "electron-builder.config.cjs"));
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const cases = [
  { extension: "deb", artifact: `Khinsider-Downloader-${version}-amd64.deb` },
  { extension: "AppImage", artifact: `Khinsider-Downloader-${version}-x86_64.AppImage` },
  { extension: "pacman", artifact: `Khinsider-Downloader-${version}-x86_64.pkg.tar.xz` },
];
const targets = process.argv.slice(2);
if (targets.some((target) => !cases.some((item) => item.extension === target))) throw new Error("Supported test targets: deb, AppImage, pacman");
const selected = targets.length ? cases.filter((item) => targets.includes(item.extension)) : cases;
const temporary = await mkdtemp(resolve(tmpdir(), "khinsider-downloader-artifacts-"));
const env = { ...process.env, XDG_CURRENT_DESKTOP: "Test" };
const headlessEnv = { ...env };
delete headlessEnv.DISPLAY;
delete headlessEnv.WAYLAND_DISPLAY;

async function findBinary(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === "khinsider-downloader-bin") return path;
    if (entry.isDirectory()) {
      const found = await findBinary(path);
      if (found) return found;
    }
  }
}

try {
  for (const [index, item] of selected.entries()) {
    const artifact = resolve(root, "release", item.artifact);
    const directory = await mkdtemp(resolve(temporary, `${item.extension}-`));
    if (item.extension === "deb") execFileSync("dpkg-deb", ["--extract", artifact, directory]);
    else if (item.extension === "pacman") {
      execFileSync("bsdtar", ["--no-same-owner", "-xf", artifact, "-C", directory]);
      const metadata = await readFile(resolve(directory, ".PKGINFO"), "utf8");
      if (!/^pkgname = khinsider-downloader$/m.test(metadata) || !/^arch = x86_64$/m.test(metadata) || !metadata.includes(`pkgver = ${version}-`)) {
        throw new Error(`Unexpected pacman metadata in ${item.artifact}`);
      }
      const dependencies = metadata.split("\n").filter((line) => line.startsWith("depend = ")).map((line) => line.slice("depend = ".length));
      if (config.pacman.depends.some((dependency) => !dependencies.includes(dependency))) {
        throw new Error(`Missing Arch dependencies in ${item.artifact}`);
      }
    }
    else execFileSync(artifact, ["--appimage-extract"], { cwd: directory, stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });
    const binary = await findBinary(directory);
    if (!binary) throw new Error(`Missing application executable in ${item.artifact}`);
    const appDir = dirname(binary);
    const cli = spawnSync(resolve(appDir, "khinsider-downloader"), ["--help"], { env: headlessEnv, encoding: "utf8" });
    if (cli.error || cli.status !== 0 || !cli.stderr.includes("khinsider-downloader inspect")) {
      throw new Error(`Packaged CLI help failed: ${cli.error?.message ?? cli.stderr}`);
    }
    const app = await electron.launch({ executablePath: binary, args: [`--user-data-dir=${resolve(temporary, `profile-${index}`)}`], env });
    let state;
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      state = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), browserPath: process.env.KHINSIDER_DOWNLOADER_CHROMIUM_PATH }));
      if (!state.packaged) throw new Error("Artifact did not start in packaged mode");
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Help", exact: true }).click();
      if (await page.locator("#help-content details").count() < 12) throw new Error("Missing bundled Help");
      await page.screenshot({ path: resolve(temporary, `${item.extension}-gui.png`) });
    } finally {
      await app.close();
    }
    const script = `const {chromium}=require(${JSON.stringify(`${state.appPath}/node_modules/playwright`)}); (async()=>{const browser=await chromium.launch({executablePath:${JSON.stringify(state.browserPath)},headless:true});try{const page=await browser.newPage();await page.setContent('<h1>Bundled Chromium</h1>');if(await page.locator('h1').textContent()!=='Bundled Chromium')throw new Error('Browser failed');}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});`;
    execFileSync(binary, ["--eval", script], { env: { ...headlessEnv, ELECTRON_RUN_AS_NODE: "1" } });
    console.log(`${item.artifact}: packaged GUI, Help, bundled Chromium, and CLI help passed without system installation.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}