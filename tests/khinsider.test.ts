import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAlbumPage, parseTrackPage, validateAlbumUrl } from "../src/khinsider.js";

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