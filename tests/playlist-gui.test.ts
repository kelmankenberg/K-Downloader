import { describe, expect, it } from "vitest";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { WebContentsView } from "electron";

const require = createRequire(import.meta.url);
const trackUrl = "https://downloads.khinsider.com/game-soundtracks/album/example-ost/01.%2520Final%2520Battle.mp3";

describe("playlists in Electron", () => {
  it("adds a track from the in-app website to a new playlist and shows it on the Playlists page", async () => {
    const userData = await mkdtemp(resolve(tmpdir(), "khinsider-playlist-test-"));
    const app = await electron.launch({
      executablePath: require("electron"),
      args: [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`],
      env: { ...process.env, XDG_CURRENT_DESKTOP: "Test" },
    });
    try {
      await app.evaluate(({ session }) => {
        // All website responses are local fixtures; tests never contact KHInsider.
        session.fromPartition("khinsider-website").protocol.handle("https", (request) => {
          if (request.url.includes(".mp3")) {
            return new Response(`<!doctype html><title>Example OST - Final Battle</title>
              <p>Album name: <b>Example OST</b><br>Song name: <b>Final Battle</b></p>
              <a href="/files/final-battle.mp3">Click here to download as MP3</a>`, { headers: { "content-type": "text/html" } });
          }
          return new Response(`<!doctype html><title>KHInsider fixture</title>
            <a id="track" href="/game-soundtracks/album/example-ost/01.%2520Final%2520Battle.mp3">Track</a>`, { headers: { "content-type": "text/html" } });
        });
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const viewVisible = () => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.contentView.children[0]?.getVisible() ?? false);

      await page.keyboard.press("Control+Comma");
      await page.locator("#browsing-nav").click();
      await page.locator("#website-target").selectOption("internal");
      await page.locator("#close-settings").click();
      await page.locator("#khinsider-link").click();
      await page.waitForFunction(() => document.querySelector("#website-status")!.textContent === "KHInsider");
      expect(await page.locator("#website-add-track").isDisabled()).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0] as WebContentsView;
        return view.webContents.executeJavaScript(`document.getElementById("track").click()`, true);
      });
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#website-add-track")!.disabled);
      expect(await page.locator("#website-address").inputValue()).toBe(trackUrl);

      await page.locator("#website-add-track").click();
      await page.locator("#playlist-name-dialog").waitFor({ state: "visible" });
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(false);
      await page.locator("#playlist-name-input").fill("Road Trip");
      await page.locator("#playlist-name-save").click();
      await page.waitForFunction(() => document.querySelector("#website-notice")!.textContent!.includes('to "Road Trip"'));
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(true);
      expect(await page.locator("#website-playlist-target option:checked").textContent()).toBe("Road Trip (1)");
      await page.locator("#website-add-track").click();
      await page.waitForFunction(() => document.querySelector("#website-notice")!.textContent === 'Already in playlist "Road Trip"');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const websiteImage = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"));
      await writeFile("/tmp/khinsider-downloader-playlist-website.png", Buffer.from(websiteImage, "base64"));

      await page.locator("#playlists-button").click();
      await page.locator("#playlists-view").waitFor({ state: "visible" });
      await page.waitForTimeout(100);
      expect(await viewVisible()).toBe(false);
      expect(await page.locator("#close-playlists").textContent()).toContain("Back to browser");
      expect(await page.locator("#playlist-name").textContent()).toBe("Road Trip");
      expect(await page.locator("#playlist-rows tr").count()).toBe(1);
      expect(await page.locator("#playlist-rows .playlist-album").textContent()).toBe("Example OST");
      expect(await page.locator("#playlist-rows .playlist-title").textContent()).toBe("Final Battle");
      expect(await page.locator("#playlist-download").isDisabled()).toBe(false);
      const image = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"));
      await writeFile("/tmp/khinsider-downloader-playlists.png", Buffer.from(image, "base64"));

      await page.locator("#playlist-rows button", { hasText: "Open" }).click();
      await page.locator("#website-view").waitFor({ state: "visible" });
      expect(await page.locator("#website-close").textContent()).toContain("Back to playlists");
      await page.locator("#website-close").click();
      await page.locator("#playlists-view").waitFor({ state: "visible" });

      const saved = JSON.parse(await readFile(resolve(userData, "playlists.json"), "utf8")) as {
        playlists: { name: string; entries: { trackUrl: string; albumTitle: string; title: string }[] }[];
      };
      expect(saved.playlists).toHaveLength(1);
      expect(saved.playlists[0]!.name).toBe("Road Trip");
      expect(saved.playlists[0]!.entries).toMatchObject([{ trackUrl, albumTitle: "Example OST", title: "Final Battle" }]);

      await page.locator("#playlist-rows button", { hasText: "Remove" }).click();
      await page.locator("#playlist-empty").waitFor({ state: "visible" });
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  }, 45_000);
});
