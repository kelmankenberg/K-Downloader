import { expect, it } from "vitest";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

it("keeps GUI inspection hidden through navigation until Show browser, then really hides it and supports cancellation", async () => {
  const userData = await mkdtemp(resolve(tmpdir(), "khinsider-inspection-test-"));
  const require = createRequire(import.meta.url);
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("dist/electron/main.cjs"), `--user-data-dir=${userData}`],
    env: { ...process.env, XDG_CURRENT_DESKTOP: "Test" },
  });
  try {
    const album = await readFile(new URL("./fixtures/album.html", import.meta.url), "utf8");
    const track = await readFile(new URL("./fixtures/track.html", import.meta.url), "utf8");
    await app.evaluate(({ app }, { album, track }) => {
      app.on("browser-window-created", (_event, window) => {
        if (window.getTitle() !== "KHInsider album inspection") return;
        window.on("show", () => { process.env.INSPECTION_TEST_SHOWN = "true"; });
        window.webContents.session.protocol.handle("https", async (request) => {
          if (request.url.endsWith("/fixture-album")) {
            return new Response(album, { headers: { "content-type": "text/html" } });
          }
          process.env.INSPECTION_TEST_TRACK_STARTED = "true";
          while (process.env.INSPECTION_TEST_RELEASE !== "true" && !window.isDestroyed()) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return new Response(track, { headers: { "content-type": "text/html" } });
        });
      });
    }, { album, track });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const start = async () => {
      await app.evaluate(() => {
        delete process.env.INSPECTION_TEST_RELEASE;
        delete process.env.INSPECTION_TEST_TRACK_STARTED;
        delete process.env.INSPECTION_TEST_SHOWN;
      });
      await page.locator("#album-url").fill("https://downloads.khinsider.com/game-soundtracks/album/fixture-album");
      await page.locator("#inspect-button").click();
      await page.waitForFunction(() => document.querySelector("#inspection-indicator-text")!.textContent === "Show browser");
      await expect.poll(() => app.evaluate(() => process.env.INSPECTION_TEST_TRACK_STARTED)).toBe("true");
    };
    const visible = () => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith("https://downloads.khinsider.com/"))?.isVisible());
    await start();
    expect(await visible()).toBe(false);
    expect(await app.evaluate(() => process.env.INSPECTION_TEST_SHOWN)).toBeUndefined();
    await page.locator("#inspection-indicator").click();
    expect(await visible()).toBe(true);
    expect(await page.locator("#inspection-indicator-text").textContent()).toBe("Hide browser");
    await page.locator("#inspection-indicator").click();
    expect(await visible()).toBe(false);
    expect(await page.locator("#inspection-indicator-text").textContent()).toBe("Show browser");
    await app.evaluate(() => { process.env.INSPECTION_TEST_RELEASE = "true"; });
    await page.waitForFunction(() => document.querySelector("#status-text")!.textContent === "Preview ready");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await page.locator("#track-rows tr").count()).toBe(2);
    await start();
    expect(await visible()).toBe(false);
    await page.locator("#cancel-button").click();
    await page.waitForFunction(() => document.querySelector("#status-text")!.textContent === "Inspection canceled");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await start();
    await page.locator("#inspection-indicator").click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith("https://downloads.khinsider.com/"))!.close();
    });
    await page.waitForFunction(() => document.querySelector("#status-text")!.textContent === "Inspection failed");
    expect(await page.locator("#error-text").textContent()).not.toBe("");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
}, 30_000);
