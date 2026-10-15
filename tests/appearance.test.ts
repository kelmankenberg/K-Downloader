import { describe, expect, it } from "vitest";
import { appearanceModes, colorThemes, defaultAppearance, parseAppearance, resolvedMode } from "../src/appearance.js";
import { chromium, _electron as electron } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cinnamonThemeIsDark } from "../src/electron/system-theme.js";
import type { GuiInspectionState } from "../src/gui-types.js";

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
  it("applies appearance preferences and keeps statusbars visible with a long preview", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1120, height: 780 }, colorScheme: "light" });
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        let inspectionListener: ((state: GuiInspectionState) => void) | undefined;
        let browserVisible = false;
        window.khinsiderDownloader = {
          openKhinsider: async () => {},
          reportIssue: async () => {},
          restoreWindowBounds: async () => {},
          zoom: async () => 1,
          systemTheme: async () => matchMedia("(prefers-color-scheme: dark)").matches,
          onSystemTheme: (listener) => {
            const media = matchMedia("(prefers-color-scheme: dark)");
            const handler = () => listener(media.matches);
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
          },
          defaultOutputRoot: async () => "/tmp/Khinsider Downloader",
          chooseOutput: async () => undefined,
          inspect: async () => {
            let canceled = false;
            browserVisible = false;
            inspectionListener?.({ active: true, browserReady: true, browserVisible });
            try {
              await new Promise<void>((complete, fail) => {
                window.addEventListener("finish-inspection", (event) => {
                  if ((event as CustomEvent).detail === "fail") fail(new Error("Mock inspection failed"));
                  else {
                    canceled = (event as CustomEvent).detail === "cancel";
                    complete();
                  }
                }, { once: true });
              });
            } finally {
              inspectionListener?.({ active: false, browserReady: false, browserVisible: false });
            }
            if (canceled) return undefined;
            return {
            albumTitle: "Large multi-disc fixture",
            trackCount: 200,
            tracks: Array.from({ length: 200 }, (_, index) => ({
              discNumber: Math.floor(index / 100) + 1,
              number: index % 100 + 1,
              title: `Track ${index + 1}`,
              formats: ["MP3", "FLAC"],
            })),
            };
          },
          download: async () => ({ state: "complete", directory: "/tmp" }),
          cancel: async () => {
            window.dispatchEvent(new CustomEvent("finish-inspection", { detail: "cancel" }));
          },
          minimizeWindow: async () => {},
          toggleMaximizeWindow: async () => false,
          closeWindow: async () => {},
          toggleInspectionBrowser: async () => {
            browserVisible = !browserVisible;
            inspectionListener?.({ active: true, browserReady: true, browserVisible });
            return browserVisible;
          },
          onInspectionState: (listener) => {
            inspectionListener = listener;
            return () => { inspectionListener = undefined; };
          },
          onProgress: () => () => {},
          onWindowState: () => () => {},
        };
      });
      await page.goto(pathToFileURL(resolve("dist/gui/index.html")).href);
      await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
      await page.keyboard.press("Control+Comma");
      await page.locator("#settings-view").waitFor({ state: "visible" });
      expect(await page.locator("#appearance-nav").getAttribute("aria-current")).toBe("page");
      const initialSelection = await page.getByRole("radio", { name: "System", exact: true }).isChecked();
      await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
      expect(await page.locator("#shortcuts-page").isVisible()).toBe(true);
      expect(await page.locator("#appearance-page").isVisible()).toBe(false);
      expect(await page.locator("#shortcuts-nav").getAttribute("aria-current")).toBe("page");
      expect(await page.locator(".shortcut-row dt").allTextContents()).toEqual([
        "Open or close Settings",
        "Close the active menu, Help, Changelog, or Settings",
        "Zoom in", "Zoom out", "Reset to 100%", "Zoom with the mouse",
        "Widen panel", "Narrow panel", "Minimum panel width", "Maximum panel width (40%)",
      ]);
      for (const viewport of [{ width: 1120, height: 780 }, { width: 760, height: 620 }]) {
        await page.setViewportSize(viewport);
        await page.screenshot({ path: `/tmp/khinsider-downloader-shortcuts-${viewport.width}.png` });
        expect(await page.evaluate(() => {
          const content = document.querySelector<HTMLElement>(".settings-content")!;
          const footer = document.querySelector<HTMLElement>(".app-footer")!.getBoundingClientRect();
          return content.scrollWidth <= content.clientWidth && footer.bottom === innerHeight;
        })).toBe(true);
      }
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      expect(await page.getByRole("radio", { name: "System", exact: true }).isChecked()).toBe(initialSelection);
      expect(await page.locator("#shortcuts-page").isVisible()).toBe(false);
      await page.setViewportSize({ width: 1120, height: 780 });
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
      await page.screenshot({ path: "/tmp/khinsider-downloader-appearance-light.png" });
      await page.setViewportSize({ width: 760, height: 620 });
      await page.getByRole("radio", { name: "Dark", exact: true }).check();
      await page.getByRole("radio", { name: "Mint", exact: true }).check();
      await page.screenshot({ path: "/tmp/khinsider-downloader-appearance-dark.png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press("Escape");
      await page.locator("#workspace").waitFor({ state: "visible" });
      await page.locator("#album-url").fill("https://downloads.khinsider.com/game-soundtracks/album/fixture");
      await page.getByRole("button", { name: "Inspect album", exact: true }).click();
      await page.getByRole("button", { name: "Cancel inspection", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#status-text")?.textContent === "Inspection canceled");
      expect(await page.locator("#inspection-indicator").isVisible()).toBe(false);
      expect(await page.locator(".status-strip").isVisible()).toBe(true);
      expect(await page.locator("#inspect-button").isEnabled()).toBe(true);
      expect(await page.locator("#download-button").isEnabled()).toBe(false);
      expect(await page.locator("#error-text").textContent()).toBe("");
      await page.getByRole("button", { name: "Inspect album", exact: true }).click();
      await page.locator("#inspection-indicator").waitFor({ state: "visible" });
      expect(await page.getByText("Inspection in progress", { exact: true }).filter({ visible: true }).count()).toBe(1);
      expect(await page.locator(".status-strip").isVisible()).toBe(false);
      expect(await page.locator(".inspection-spinner").evaluate((element) => {
        const animation = element.getAnimations()[0];
        return animation?.playState === "running" && animation.effect?.getTiming().iterations === Infinity;
      })).toBe(true);
      await page.screenshot({ path: "/tmp/khinsider-downloader-single-inspection-indicator.png" });
      await page.locator("#inspection-indicator").click();
      expect(await page.locator("#inspection-indicator-text").textContent()).toBe("Hide browser");
      await page.locator("#inspection-indicator").click();
      expect(await page.locator("#inspection-indicator-text").textContent()).toBe("Show browser");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("finish-inspection")));
      await page.waitForFunction(() => document.querySelectorAll("#track-rows tr").length === 200);
      expect(await page.locator("#inspection-indicator").isVisible()).toBe(false);
      expect(await page.locator(".status-strip").isVisible()).toBe(true);
      expect(await page.locator("#status-text").textContent()).toBe("Preview ready");
      for (const viewport of [{ width: 760, height: 620 }, { width: 1120, height: 780 }]) {
        await page.setViewportSize(viewport);
        const measure = () => page.evaluate(() => {
          const footer = document.querySelector<HTMLElement>(".app-footer")!.getBoundingClientRect();
          const transfer = document.querySelector<HTMLElement>(".progress-footer")!.getBoundingClientRect();
          const table = document.querySelector<HTMLElement>(".table-wrap")!;
          return {
            footerTop: footer.top,
            footerBottom: footer.bottom,
            transferBottom: transfer.bottom,
            listScrolls: table.scrollHeight > table.clientHeight,
            pageHeight: document.documentElement.scrollHeight,
            listScrollTop: table.scrollTop,
          };
        });
        const initial = await measure();
        expect(initial.footerBottom).toBe(viewport.height);
        expect(initial.transferBottom).toBeLessThanOrEqual(initial.footerTop);
        expect(initial.pageHeight).toBe(viewport.height);
        expect(initial.listScrolls).toBe(true);
        await page.locator(".table-wrap").evaluate((element) => { element.scrollTop = element.scrollHeight; });
        const scrolled = await measure();
        expect(scrolled.listScrollTop).toBeGreaterThan(0);
        expect(scrolled.footerBottom).toBe(initial.footerBottom);
        expect(scrolled.transferBottom).toBe(initial.transferBottom);
        await page.screenshot({ path: `/tmp/khinsider-downloader-long-preview-${viewport.width}.png` });
      }
      await page.getByRole("button", { name: "Inspect album", exact: true }).click();
      await page.locator("#inspection-indicator").waitFor({ state: "visible" });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("finish-inspection", { detail: "fail" })));
      await page.waitForFunction(() => document.querySelector("#status-text")?.textContent === "Inspection failed");
      expect(await page.locator("#inspection-indicator").isVisible()).toBe(false);
      expect(await page.locator(".status-strip").isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe("Electron native theme updates", () => {
  it("updates System mode through preload but preserves explicit Light and Dark", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "khinsider-downloader-theme-test-"));
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