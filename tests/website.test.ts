import { describe, expect, it } from "vitest";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isKhinsiderAlbumUrl, isKhinsiderWebsiteUrl, khinsiderHome } from "../src/website.js";
import type { WebContentsView } from "electron";

const albumUrl = `${khinsiderHome}game-soundtracks/album/test-album`;
const require = createRequire(import.meta.url);

describe("website destinations", () => {
  it("allows only the HTTPS website origin without credentials", () => {
    expect(isKhinsiderWebsiteUrl(khinsiderHome)).toBe(true);
    expect(isKhinsiderWebsiteUrl(albumUrl)).toBe(true);
    for (const url of [
      "invalid", "file:///tmp/index.html", "javascript:alert(1)",
      "http://downloads.khinsider.com/", "https://downloads.khinsider.com:8443/",
      "https://downloads.khinsider.com.example.com/", "https://khinsider.com/",
      "https://user:password@downloads.khinsider.com/",
    ]) expect(isKhinsiderWebsiteUrl(url)).toBe(false);
  });

  it("recognizes album pages but not home, track, or empty album paths", () => {
    expect(isKhinsiderAlbumUrl(albumUrl)).toBe(true);
    expect(isKhinsiderAlbumUrl(`${albumUrl}/`)).toBe(true);
    for (const url of [khinsiderHome, `${albumUrl}/song.mp3`, `${khinsiderHome}game-soundtracks/album/`, "https://example.com/game-soundtracks/album/test"]) {
      expect(isKhinsiderAlbumUrl(url)).toBe(false);
    }
  });
});

describe("embedded KHInsider browser in Electron", () => {
  it("stays in one window, navigates, hands off albums, handles failures, and persists the browser choice", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "khinsider-website-test-"));
    const launch = () => electron.launch({
      executablePath: require("electron"),
      args: [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`],
      env: { ...process.env, XDG_CURRENT_DESKTOP: "Test" },
    });
    let app = await launch();
    try {
      await app.evaluate(({ session, shell }) => {
        // All website responses are local fixtures; tests never contact KHInsider.
        session.fromPartition("khinsider-website").protocol.handle("https", (request) => {
          if (request.url.endsWith("/unavailable")) return new Response("Unavailable", { status: 503 });
          if (request.url.endsWith("/offline")) return Response.error();
          if (request.url.endsWith("/download")) {
            return new Response("Fixture audio", { headers: { "content-disposition": 'attachment; filename="fixture.mp3"' } });
          }
          if (request.url.endsWith("/redirect")) {
            return new Response(null, { status: 302, headers: { Location: "https://example.com/" } });
          }
          return new Response(`<!doctype html><title>KHInsider fixture</title>
            <a id="album" href="/game-soundtracks/album/test-album">Album</a>
            <a id="next" href="/game-soundtracks/album/another-album" target="_blank">Another album</a>
            <a id="offsite" href="https://example.com/">Offsite</a>
            <a id="popup" href="https://example.com/" target="_blank">Offsite popup</a>
            <a id="unavailable" href="/unavailable">Unavailable</a>
            <a id="offline" href="/offline">Offline</a>
            <a id="download" href="/download">Direct download</a>
            <a id="redirect" href="/redirect">Redirect</a>`, { headers: { "content-type": "text/html" } });
        });
        shell.openExternal = async (url) => {
          if (url !== "https://downloads.khinsider.com/") throw new Error("Unexpected external URL");
          process.env.KHINSIDER_TEST_EXTERNAL_OPENED = url;
        };
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.locator("#album-url").fill(albumUrl);
      await page.locator("#khinsider-link").click();
      expect(await app.evaluate(() => process.env.KHINSIDER_TEST_EXTERNAL_OPENED)).toBe(khinsiderHome);
      expect(await page.locator("#website-view").isVisible()).toBe(false);

      await page.keyboard.press("Control+Comma");
      await page.locator("#browsing-nav").click();
      await page.locator("#website-target").selectOption("internal");
      await page.locator("#close-settings").click();
      await page.locator("#khinsider-link").click();
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#website-address")?.value === "https://downloads.khinsider.com/");
      await page.waitForFunction(() => document.querySelector("#website-status")!.textContent === "KHInsider");
      expect(await page.locator("#website-view").isVisible()).toBe(true);
      expect(await page.locator("#workspace").isVisible()).toBe(false);
      expect(await page.locator("#website-use-album").isDisabled()).toBe(true);
      const viewVisible = () => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.contentView.children[0]?.getVisible() ?? false);
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(true);
      const clickSite = (id: string) => app.evaluate(({ BrowserWindow }, id) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0] as WebContentsView;
        return view.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`, true);
      }, id);
      await clickSite("album");
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#website-use-album")!.disabled);
      expect(await page.locator("#website-address").inputValue()).toBe(albumUrl);
      expect(await page.locator("#website-back").isDisabled()).toBe(false);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      expect(await app.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0] as WebContentsView;
        const prefs = view.webContents.getLastWebPreferences();
        return { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, preload: prefs.preload };
      })).toEqual({ nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined });

      await page.locator("#website-back").click();
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#website-address")!.value.endsWith(".com/"));
      await page.locator("#website-forward").click();
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#website-address")!.value.endsWith("/test-album"));
      await clickSite("next");
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#website-address")!.value.endsWith("/another-album"));
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await clickSite("offsite");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("Only downloads.khinsider.com"));
      expect(await page.locator("#website-address").inputValue()).toContain("/another-album");
      await clickSite("popup");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("cannot open inside"));
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

      await page.locator("#website-reload").click();
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent === "");
      await page.locator("#more-button").click();
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(false);
      await page.locator("#help-menu-item").click();
      expect(await viewVisible()).toBe(false);
      await page.locator("#close-help").click();
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(true);
      await page.keyboard.press("Control+Comma");
      await page.locator("#settings-view").waitFor({ state: "visible" });
      expect(await viewVisible()).toBe(false);
      await page.locator("#close-settings").click();
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0] as WebContentsView;
        view.webContents.focus();
        view.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["control"] });
      });
      await page.locator("#settings-view").waitFor({ state: "visible" });
      await page.locator("#close-settings").click();

      for (const [width, height, zoom] of [[1120, 780, 1], [760, 620, 1], [1120, 780, 1.5]]) {
        await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          window.setSize(width, height);
          window.webContents.setZoomFactor(zoom);
        }, { width: width!, height: height!, zoom: zoom! });
        await page.waitForTimeout(200);
        const host = await page.locator("#website-host").boundingBox();
        const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getBounds());
        expect(bounds.x).toBeCloseTo(Math.round(host!.x * zoom!), 0);
        expect(bounds.y).toBeCloseTo(Math.round(host!.y * zoom!), 0);
        expect(bounds.width).toBeCloseTo(Math.round(host!.width * zoom!), 0);
        expect(bounds.height).toBeCloseTo(Math.round(host!.height * zoom!), 0);
        expect(await page.evaluate(() => {
          const button = document.querySelector("#website-use-album")!.getBoundingClientRect();
          const footer = document.querySelector(".app-footer")!.getBoundingClientRect();
          return button.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth && footer.bottom <= innerHeight;
        })).toBe(true);
        await page.screenshot({ path: `/tmp/khinsider-downloader-website-${width}-${zoom}.png` });
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
      await page.locator("#website-use-album").click();
      expect(await page.locator("#album-url").inputValue()).toContain("/another-album");
      expect(await page.locator("#workspace").isVisible()).toBe(true);
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(false);
      await page.locator("#khinsider-link").click();
      expect(await page.locator("#website-address").inputValue()).toContain("/another-album");
      await clickSite("download");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("Website downloads are disabled"));
      await clickSite("unavailable");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("HTTP 503"));
      await page.locator("#website-home").click();
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent === "");
      await clickSite("offline");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("Could not load KHInsider"));
      await page.locator("#website-home").click();
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent === "");
      await clickSite("redirect");
      await page.waitForFunction(() => document.querySelector("#website-error")!.textContent!.includes("Only downloads.khinsider.com"));
      await page.locator("#website-close").click();
      expect(await page.locator("#album-url").inputValue()).toContain("/another-album");
      expect(errors).toEqual([]);
      await app.close();
      app = await launch();
      const restored = await app.firstWindow();
      await restored.keyboard.press("Control+Comma");
      await restored.locator("#browsing-nav").click();
      expect(await restored.locator("#website-target").inputValue()).toBe("internal");
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  }, 45_000);
});
