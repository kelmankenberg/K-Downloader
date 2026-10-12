import { describe, expect, it } from "vitest";
import { centeredBounds, parseWindowState, startupBounds } from "../src/electron/window-state.js";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const screen = { x: 0, y: 0, width: 1920, height: 1080 };

describe("window geometry", () => {
  it("centers the default development size", () => {
    expect(centeredBounds(screen)).toEqual({ x: 400, y: 150, width: 1120, height: 780 });
  });
  it("rejects malformed state and preserves valid bounds", () => {
    expect(parseWindowState("bad")).toBeUndefined();
    expect(parseWindowState('{"bounds":{"x":0}}')).toBeUndefined();
    const state = { bounds: { x: 50, y: 60, width: 900, height: 700 }, maximized: true };
    expect(startupBounds(parseWindowState(JSON.stringify(state)), [screen])).toEqual(state.bounds);
  });
  it("recenters off-screen state and clamps partly visible windows", () => {
    expect(startupBounds({ bounds: { x: 3000, y: 2000, width: 900, height: 700 }, maximized: false }, [screen])).toEqual(centeredBounds(screen));
    expect(startupBounds({ bounds: { x: 1800, y: 900, width: 900, height: 700 }, maximized: false }, [screen])).toEqual({ x: 1020, y: 380, width: 900, height: 700 });
  });
});

describe("desktop More menu and zoom", () => {
  it("renders and resizes the changelog, zooms, and persists window bounds", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "k-downloader-window-test-"));
    const require = createRequire(import.meta.url);
    const launch = () => electron.launch({
      executablePath: require("electron"),
      args: [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`],
      env: { ...process.env, XDG_CURRENT_DESKTOP: "Test" },
    });
    let app = await launch();
    try {
      let page = await app.firstWindow();
      page.setDefaultTimeout(5_000);
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      await page.getByRole("button", { name: "More options", exact: true }).click();
      expect((await page.getByRole("menuitem").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim())).toEqual([
        "Restore Size/Position", "Settings Ctrl+,", "Changelog",
      ]);
      const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
      expect(await page.locator("#menu-app-version").textContent()).toBe(manifest.version);
      expect(await page.locator(".more-menu-info").innerText()).toContain("K-Downloader");
      expect(await page.locator(".more-menu-separator").isVisible()).toBe(true);
      await page.getByRole("menuitem", { name: "Changelog", exact: true }).click();
      await page.locator("#changelog-drawer").waitFor({ state: "visible" });
      await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector("#changelog-drawer")!).transform).m41 === 0);
      expect(await page.locator("#changelog-content").innerText()).toContain("Persistent window size");
      await page.getByRole("separator", { name: "Changelog panel width" }).focus();
      await page.keyboard.press("End");
      expect(await page.locator("#changelog-drawer").evaluate((element) => element.getBoundingClientRect().width / innerWidth)).toBeCloseTo(.4, 2);
      const handle = await page.locator("#changelog-resize").boundingBox();
      if (!handle) throw new Error("Changelog resize handle is not visible");
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
      await page.mouse.down();
      await page.mouse.move(1, handle.y + 40);
      await page.mouse.up();
      expect(await page.locator("#changelog-drawer").evaluate((element) => element.getBoundingClientRect().width / innerWidth)).toBeCloseTo(.4, 2);
      await page.screenshot({ path: "/tmp/k-downloader-changelog.png" });
      await page.keyboard.press("Escape");
      expect(await page.locator("#changelog-drawer").getAttribute("data-open")).toBe("false");
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Changelog", exact: true }).click();
      await page.getByRole("button", { name: "Close changelog", exact: true }).click();
      const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
      await page.keyboard.press("Control+Equal");
      await expect.poll(zoom).toBeCloseTo(1.1);
      await page.keyboard.press("Control+Minus");
      await expect.poll(zoom).toBeCloseTo(1);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -100);
      await page.keyboard.up("Control");
      await expect.poll(zoom).toBeCloseTo(1.1);
      await page.keyboard.press("Control+0");
      await expect.poll(zoom).toBe(1);
      const moved = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setBounds({ x: 80, y: 90, width: 900, height: 700 });
        return window.getBounds();
      });
      const closing = app.waitForEvent("close");
      await page.getByRole("button", { name: "Close window", exact: true }).click();
      await closing;
      expect(JSON.parse(await readFile(resolve(userData, "window-state.json"), "utf8")).bounds).toEqual(moved);
      app = await launch();
      page = await app.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).toEqual(moved);
      await page.keyboard.press("Control+Comma");
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).toEqual(moved);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Maximize window", exact: true }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Restore Size/Position", exact: true }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
      const restored = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return { bounds: window.getBounds(), area: screen.getDisplayMatching(window.getBounds()).workArea };
      });
      expect(restored.bounds).toEqual(centeredBounds(restored.area));
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("single-instance desktop", () => {
  it("rejects a second launch, restores the primary window, and shows a confirmation", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "k-downloader-instance-test-"));
    const require = createRequire(import.meta.url);
    const executablePath: string = require("electron");
    const args = [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`];
    const env = { ...process.env, XDG_CURRENT_DESKTOP: "Test" };
    const primary = await electron.launch({ executablePath, args, env });
    let secondary: ChildProcess | undefined;
    try {
      const page = await primary.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.mode);
      await primary.evaluate(({ dialog, BrowserWindow }) => {
        Reflect.set(globalThis, "singleInstanceNotices", []);
        dialog.showMessageBox = async (...args: unknown[]) => {
          Reflect.get(globalThis, "singleInstanceNotices").push(args.at(-1));
          return { response: 0, checkboxChecked: false };
        };
        BrowserWindow.getAllWindows()[0].minimize();
      });
      await expect.poll(() => primary.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
      secondary = spawn(executablePath, args, { env, stdio: "ignore" });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        secondary!.once("error", reject);
        secondary!.once("close", resolve);
      });
      expect(exitCode).toBe(0);
      await expect.poll(() => primary.evaluate(() => Reflect.get(globalThis, "singleInstanceNotices").length)).toBe(1);
      await expect.poll(() => primary.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
      await expect.poll(() => primary.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
      const state = await primary.evaluate(({ BrowserWindow }) => ({
        windowCount: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0].isVisible(),
        notice: Reflect.get(globalThis, "singleInstanceNotices")[0],
      }));
      expect(state.windowCount).toBe(1);
      expect(state.visible).toBe(true);
      expect(state.notice.message).toBe("K-Downloader is already running.");
      expect(state.notice.buttons).toEqual(["Show running app"]);
    } finally {
      if (secondary && secondary.exitCode === null) secondary.kill();
      await primary.close();
      await rm(userData, { recursive: true, force: true });
    }
  }, 30_000);
});