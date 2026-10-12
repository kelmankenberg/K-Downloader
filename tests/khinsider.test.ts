import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { inspectAlbum, parseAlbumPage, parseTrackPage, validateAlbumUrl } from "../src/khinsider.js";

const albumUrl = new URL("https://downloads.khinsider.com/game-soundtracks/album/fixture-album");
const albumHtml = readFileSync(fileURLToPath(new URL("./fixtures/album.html", import.meta.url)), "utf8");
const multiDiscAlbumHtml = readFileSync(fileURLToPath(new URL("./fixtures/multi-disc-album.html", import.meta.url)), "utf8");
const trackHtml = readFileSync(fileURLToPath(new URL("./fixtures/track.html", import.meta.url)), "utf8");

describe("KHInsider page parsing", () => {
  it("keeps ordered track-page links and ignores bulk and recommendation links", () => {
    const result = parseAlbumPage(albumHtml, albumUrl);
    expect(result.title).toBe("Fixture Album");
    expect(result.advertisedTrackCount).toBe(2);
    expect(result.tracks.map(({ number, title }) => [number, title])).toEqual([
      [1, "Opening"],
      [2, "Finale"],
    ]);
    expect(result.tracks.every(({ pageUrl }) => pageUrl.pathname.startsWith(`${albumUrl.pathname}/`))).toBe(true);
  });

  it("extracts only explicit audio-download links and their format", () => {
    const result = parseTrackPage(trackHtml, new URL(`${albumUrl.href}/01-Opening.mp3`));
    expect(result).toHaveLength(1);
    expect(result[0].format).toBe("MP3");
    expect(result[0].url.hostname).toBe("media.example.test");
  });

  it("keeps CD numbers separate from per-disc track numbers", () => {
    const result = parseAlbumPage(
      multiDiscAlbumHtml,
      new URL("https://downloads.khinsider.com/game-soundtracks/album/multi-disc"),
    );
    expect(result.tracks.map(({ discNumber, number, title }) => [discNumber, number, title])).toEqual([
      [1, 1, "Opening"],
      [1, 2, "Menu"],
      [2, 1, "Serenity"],
      [2, 2, "Finale"],
    ]);
  });

  it("rejects unrelated or insecure album URLs", () => {
    expect(() => validateAlbumUrl("http://downloads.khinsider.com/game-soundtracks/album/test")).toThrow();
    expect(() => validateAlbumUrl("https://example.com/game-soundtracks/album/test")).toThrow();
  });
});

describe("inspection cancellation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not launch Chromium when already canceled", async () => {
    const launch = vi.spyOn(chromium, "launch");
    const controller = new AbortController();
    controller.abort();
    await expect(inspectAlbum(albumUrl.href, { signal: controller.signal })).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  });

  it("closes a browser that finishes launching after Cancel was requested", async () => {
    const controller = new AbortController();
    let finishLaunch!: (browser: Browser) => void;
    const browser = { newContext: vi.fn(), close: vi.fn(async () => {}) };
    vi.spyOn(chromium, "launch").mockImplementation(() => new Promise((resolve) => { finishLaunch = resolve; }));
    const run = inspectAlbum(albumUrl.href, { signal: controller.signal });
    const rejection = expect(run).rejects.toThrow();
    controller.abort();
    finishLaunch(browser as unknown as Browser);
    await rejection;
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it("closes Chromium to interrupt active navigation and never starts track requests", async () => {
    vi.stubEnv("K_DOWNLOADER_CHROMIUM_PATH", "/test/resources/chromium/chrome");
    const controller = new AbortController();
    let rejectNavigation!: (error: Error) => void;
    let navigationStarted!: () => void;
    const started = new Promise<void>((resolve) => { navigationStarted = resolve; });
    const page = {
      on: vi.fn(),
      isClosed: () => false,
      goto: vi.fn(() => new Promise((_, reject) => {
        rejectNavigation = reject;
        navigationStarted();
      })),
    };
    const context = {
      newPage: async () => page,
      newCDPSession: async () => ({ send: async () => ({ windowId: 1 }) }),
      close: vi.fn(async () => {}),
    };
    const browser = {
      newContext: async () => context,
      close: vi.fn(async () => { rejectNavigation?.(new Error("Browser closed")); }),
    };
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    const run = inspectAlbum(albumUrl.href, { signal: controller.signal });
    const rejection = expect(run).rejects.toThrow("Browser closed");
    await started;
    controller.abort();
    await rejection;
    expect(browser.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: "/test/resources/chromium/chrome" }));
  });
});