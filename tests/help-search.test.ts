import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

describe("Help panel search in Chromium", () => {
  it("hides sections without the search text, expands and highlights matches, and restores on clear", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const values: Record<string, unknown> = {
          getPlaylists: { playlists: [], readOnly: false, warning: "" },
          defaultOutputRoot: "/tmp/Khinsider Downloader",
          systemTheme: false,
          zoom: 1,
        };
        window.khinsiderDownloader = new Proxy({}, {
          get: (_target, name: string) => name.startsWith("on") ? () => () => {} : async () => values[name],
        }) as typeof window.khinsiderDownloader;
      });
      await page.goto(pathToFileURL(resolve("dist/gui/index.html")).href);
      await page.locator("#more-button").click();
      await page.locator("#help-menu-item").click();
      await page.locator("#help-drawer[data-open='true']").waitFor();

      for (const width of [1120, 760]) {
        await page.setViewportSize({ width, height: 700 });
        const layout = await page.evaluate(() => {
          const box = document.querySelector("#help-search")!.getBoundingClientRect();
          const expand = document.querySelector("#expand-help")!.getBoundingClientRect();
          const collapse = document.querySelector("#collapse-help")!.getBoundingClientRect();
          const drawer = document.querySelector("#help-drawer")!.getBoundingClientRect();
          const sameRow = Math.abs(box.top + box.height / 2 - (expand.top + expand.height / 2)) < 4;
          return { width: box.width, ordered: sameRow ? box.right < expand.left : box.bottom <= expand.top, inside: collapse.right <= drawer.right && box.right <= drawer.right };
        });
        expect(layout).toMatchObject({ ordered: true, inside: true });
        expect(layout.width).toBeGreaterThan(150);
      }
      const visibleSections = () => page.locator("#help-content details:not([hidden]) summary").allTextContents();
      const total = await page.locator("#help-content details").count();
      await page.locator("#help-content summary", { hasText: "Audio Formats" }).click();
      const openBefore = await page.locator("#help-content details[open] summary").allTextContents();
      expect(openBefore).toEqual(["Getting Started", "Audio Formats"]);

      await page.keyboard.press("Control+f");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("help-search");
      await page.keyboard.type("m3u8");
      expect(await visibleSections()).toEqual(["Download Playlists"]);
      expect(await page.locator("#help-content details:not([hidden])").evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
      expect(await page.locator("#help-search-status").textContent()).toBe(`1 of ${total} sections contain "m3u8".`);
      expect(await page.evaluate(() => CSS.highlights.get("help-match")?.size ?? 0)).toBeGreaterThan(0);

      await page.locator("#help-search").fill("  ADD   TRACK to playlist ");
      expect(await visibleSections()).toContain("Download Playlists");
      expect(await page.locator("#help-content details:not([hidden]):not([open])").count()).toBe(0);

      await page.locator("#help-search").fill("zzzz-not-in-help");
      expect(await visibleSections()).toEqual([]);
      expect(await page.locator("#help-search-status").textContent()).toBe('No help sections contain "zzzz-not-in-help".');

      await page.keyboard.press("Escape");
      expect(await page.locator("#help-search").inputValue()).toBe("");
      expect(await page.locator("#help-drawer").getAttribute("data-open")).toBe("true");
      expect(await page.locator("#help-content details:not([hidden])").count()).toBe(total);
      expect(await page.locator("#help-content details[open] summary").allTextContents()).toEqual(openBefore);
      expect(await page.locator("#help-search-status").textContent()).toBe("");
      expect(await page.evaluate(() => CSS.highlights.has("help-match"))).toBe(false);

      await page.keyboard.press("Escape");
      expect(await page.locator("#help-drawer").getAttribute("data-open")).toBe("false");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
