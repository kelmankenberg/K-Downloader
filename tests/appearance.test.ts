import { describe, expect, it } from "vitest";
import { appearanceModes, colorThemes, defaultAppearance, parseAppearance, resolvedMode } from "../src/appearance.js";
import { chromium, _electron as electron } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cinnamonThemeIsDark } from "../src/electron/system-theme.js";

describe("appearance preferences", () => {
  it("defaults to System and Mint for absent or malformed settings", () => {
    for (const raw of [null, "broken", "null", "[]", '{"mode":"invalid","theme":"invalid"}']) {
      expect(parseAppearance(raw)).toEqual(defaultAppearance);
    }
  });

  it("round-trips every supported mode and theme", () => {
    for (const mode of appearanceModes) for (const theme of colorThemes) {
      expect(parseAppearance(JSON.stringify({ mode, theme }))).toEqual({ mode, theme });
    }
  });

  it("follows the system only in System mode", () => {
    expect(resolvedMode("system", true)).toBe("dark");
    expect(resolvedMode("system", false)).toBe("light");
    expect(resolvedMode("light", true)).toBe("light");
    expect(resolvedMode("dark", false)).toBe("dark");
  });

  it("recognizes Cinnamon GTK light and dark theme names", () => {
    expect(cinnamonThemeIsDark("'Mint-Y'\n")).toBe(false);
    expect(cinnamonThemeIsDark("'Mint-Y-Dark'\n")).toBe(true);
    expect(cinnamonThemeIsDark("'Mint-Y-Dark-Aqua'\n")).toBe(true);
    expect(cinnamonThemeIsDark("'Adwaita-dark'\n")).toBe(true);
    expect(cinnamonThemeIsDark("unrecognized output")).toBeUndefined();
  });
});

describe("appearance controls in Chromium", () => {
  it("applies every palette, persists preferences, and responds to System mode", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1120, height: 780 }, colorScheme: "light" });
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.kDownloader = {
          systemTheme: async () => matchMedia("(prefers-color-scheme: dark)").matches,
          onSystemTheme: (listener) => {
            const media = matchMedia("(prefers-color-scheme: dark)");
            const handler = () => listener(media.matches);
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
          },
          defaultOutputRoot: async () => "/tmp/K-Downloader",
          chooseOutput: async () => undefined,
          inspect: async () => ({ albumTitle: "Fixture", trackCount: 0, tracks: [] }),
          download: async () => ({ state: "complete", directory: "/tmp" }),
          cancel: async () => {},
          minimizeWindow: async () => {},
          toggleMaximizeWindow: async () => false,
          closeWindow: async () => {},
          toggleInspectionBrowser: async () => false,
          onInspectionState: () => () => {},
          onProgress: () => () => {},
          onWindowState: () => () => {},
        };
      });
      await page.goto(pathToFileURL(resolve("dist/gui/index.html")).href);
      await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
      await page.keyboard.press("Control+Comma");
      await page.locator("#settings-view").waitFor({ state: "visible" });
      for (const mode of ["light", "dark"] as const) {
        await page.getByRole("radio", { name: new RegExp(`^${mode}$`, "i") }).check();
        const accents = new Set<string>();
        for (const theme of colorThemes) {
          await page.getByRole("radio", { name: new RegExp(`^${theme}$`, "i") }).check();
          const palette = await page.evaluate(() => {
            const styles = getComputedStyle(document.documentElement);
            return {
              mode: document.documentElement.dataset.mode,
              theme: document.documentElement.dataset.theme,
              accent: styles.getPropertyValue("--mint").trim(),
              surface: styles.getPropertyValue("--panel").trim(),
              scheme: styles.colorScheme,
            };
          });
          expect(palette.mode).toBe(mode);
          expect(palette.theme).toBe(theme);
          expect(palette.scheme).toBe(mode);
          expect(palette.surface).not.toBe(palette.accent);
          accents.add(palette.accent);
        }
        expect(accents.size).toBe(5);
      }
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "monochrome");
      expect(await page.locator("html").getAttribute("data-mode")).toBe("dark");
      await page.keyboard.press("Control+Comma");
      await page.getByRole("radio", { name: "System", exact: true }).check();
      await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
      await page.getByRole("radio", { name: "Light", exact: true }).check();
      await page.emulateMedia({ colorScheme: "light" });
      await page.emulateMedia({ colorScheme: "dark" });
      expect(await page.locator("html").getAttribute("data-mode")).toBe("light");
      await page.screenshot({ path: "/tmp/k-downloader-appearance-light.png" });
      await page.setViewportSize({ width: 760, height: 620 });
      await page.getByRole("radio", { name: "Dark", exact: true }).check();
      await page.getByRole("radio", { name: "Mint", exact: true }).check();
      await page.screenshot({ path: "/tmp/k-downloader-appearance-dark.png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press("Escape");
      await page.locator("#workspace").waitFor({ state: "visible" });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe("Electron native theme updates", () => {
  it("updates System mode through preload but preserves explicit Light and Dark", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "k-downloader-theme-test-"));
    const require = createRequire(import.meta.url);
    const app = await electron.launch({
      executablePath: require("electron"),
      args: [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`],
      env: { ...process.env, XDG_CURRENT_DESKTOP: "Test" },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      await page.keyboard.press("Control+Comma");
      await page.getByRole("radio", { name: "System", exact: true }).check();
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "dark"; });
      await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });
      await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
      await page.getByRole("radio", { name: "Dark", exact: true }).check();
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });
      expect(await page.locator("html").getAttribute("data-mode")).toBe("dark");
      await page.getByRole("radio", { name: "Light", exact: true }).check();
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "dark"; });
      expect(await page.locator("html").getAttribute("data-mode")).toBe("light");
      await page.getByRole("radio", { name: "System", exact: true }).check();
      await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  }, 30_000);
});