import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const temporary = await mkdtemp(resolve(tmpdir(), "k-downloader-artifacts-"));
const env = { ...process.env, XDG_CURRENT_DESKTOP: "Test" };
const headlessEnv = { ...env };
delete headlessEnv.DISPLAY;
delete headlessEnv.WAYLAND_DISPLAY;

async function findBinary(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === "k-downloader-bin") return path;
    if (entry.isDirectory()) {
      const found = await findBinary(path);
      if (found) return found;
    }
  }
}

try {
  const cases = [
    { extension: "deb", artifact: `K-Downloader-${version}-amd64.deb` },
    { extension: "AppImage", artifact: `K-Downloader-${version}-x86_64.AppImage` },
  ];
  for (const [index, item] of cases.entries()) {
    const artifact = resolve(root, "release", item.artifact);
    const directory = await mkdtemp(resolve(temporary, `${item.extension}-`));
    if (item.extension === "deb") execFileSync("dpkg-deb", ["--extract", artifact, directory]);
    else execFileSync(artifact, ["--appimage-extract"], { cwd: directory, stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });
    const binary = await findBinary(directory);
    if (!binary) throw new Error(`Missing application executable in ${item.artifact}`);
    const appDir = dirname(binary);
    const cli = spawnSync(resolve(appDir, "k-downloader"), ["--help"], { env: headlessEnv, encoding: "utf8" });
    if (cli.error || cli.status !== 0 || !cli.stderr.includes("k-downloader inspect")) {
      throw new Error(`Packaged CLI help failed: ${cli.error?.message ?? cli.stderr}`);
    }
    const app = await electron.launch({ executablePath: binary, args: [`--user-data-dir=${resolve(temporary, `profile-${index}`)}`], env });
    let state;
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      state = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), browserPath: process.env.K_DOWNLOADER_CHROMIUM_PATH }));
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