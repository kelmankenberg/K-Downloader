import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormatPlanBlockedError } from "../src/downloader.js";
import type { ResolvedTrack } from "../src/khinsider.js";
import { MANIFEST_FILENAME, playlistTrackFilename, readManifest } from "../src/output.js";
import type { PlaylistEntry } from "../src/playlist.js";
import { downloadPlaylist, renamePlaylistFolder } from "../src/playlist-download.js";

const base = "https://downloads.khinsider.com/game-soundtracks/album";
const resolveAddresses = async () => [{ address: "93.184.216.34", family: 4 }];
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "khinsider-downloader-playlist-dl-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function entry(album: string, slug: string, title: string): PlaylistEntry {
  return {
    id: `${album}-${slug}`,
    trackUrl: `${base}/${album}/${slug}.mp3`,
    albumUrl: `${base}/${album}`,
    albumTitle: album === "a" ? "Example OST" : "Another OST",
    title,
    addedAt: "2024-01-01T00:00:00.000Z",
  };
}

const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(new Uint8Array([1, 2, 3]), {
  status: 200,
  headers: { "content-type": String(input).endsWith(".flac") ? "audio/flac" : "audio/mpeg", "content-length": "3" },
}));

function resolver(formats: Record<string, string[]> = {}, failures: string[] = []) {
  const visited: string[] = [];
  const resolveTracks = async (urls: string[], onResult: (index: number, result: ResolvedTrack) => void) => urls.map((trackUrl, index) => {
    visited.push(trackUrl);
    const result: ResolvedTrack = failures.includes(trackUrl)
      ? { trackUrl, error: "Track page request failed with HTTP 404" }
      : {
        trackUrl,
        details: {
          albumTitle: "x",
          title: "y",
          audioLinks: (formats[trackUrl] ?? ["MP3"]).map((format) => ({
            format,
            url: new URL(`https://media.example.test/${encodeURIComponent(trackUrl)}.${format.toLowerCase()}`),
          })),
        },
      };
    onResult(index, result);
    return result;
  });
  return { resolveTracks, visited };
}

describe("playlist filenames", () => {
  it("uses position, album, and title, shortening the album first", () => {
    expect(playlistTrackFilename(1, 12, "Example OST", "Final Battle", "FLAC")).toBe("001 - Example OST - Final Battle.flac");
    expect(playlistTrackFilename(7, 1200, "A", "B", "MP3")).toBe("0007 - A - B.mp3");
    const long = playlistTrackFilename(1, 1, "Album ".repeat(40), "Track Title", "MP3");
    expect(long.length).toBeLessThanOrEqual(124);
    expect(long).toMatch(/ - Track Title\.mp3$/);
  });
});

describe("playlist download", () => {
  it("downloads a flat folder with an m3u8 and resumes after edits", async () => {
    const outputRoot = await temporaryDirectory();
    const first = entry("a", "01", "Final Battle");
    const second = entry("b", "07", "Last Stand");
    const playlist = { id: "p1", name: "Boss Themes", entries: [first, second] };
    const { resolveTracks, visited } = resolver({ [first.trackUrl]: ["MP3", "FLAC"] });

    const result = await downloadPlaylist({ playlist, outputRoot, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses });
    expect(result.state).toBe("complete");
    expect(result.directory).toBe(join(outputRoot, "Boss Themes"));
    expect((await readdir(result.directory)).sort()).toEqual([
      MANIFEST_FILENAME,
      "001 - Example OST - Final Battle.flac",
      "002 - Another OST - Last Stand.mp3",
      "Boss Themes.m3u8",
    ].sort());
    expect(await readFile(join(result.directory, "Boss Themes.m3u8"), "utf8")).toBe(
      "#EXTM3U\n#EXTINF:-1,Example OST - Final Battle\n001 - Example OST - Final Battle.flac\n" +
      "#EXTINF:-1,Another OST - Last Stand\n002 - Another OST - Last Stand.mp3\n",
    );
    await expect(readManifest(result.directory)).rejects.toThrow();

    // Reorder, remove the first track, and add a new one.
    const third = entry("a", "03", "Credits");
    visited.length = 0;
    const edited = { ...playlist, entries: [second, third] };
    const rerun = await downloadPlaylist({ playlist: edited, outputRoot, preferredDirectory: result.directory, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses });
    expect(visited).toEqual([third.trackUrl]);
    expect(rerun.directory).toBe(result.directory);
    const files = await readdir(rerun.directory);
    expect(files).toContain("001 - Example OST - Final Battle.flac");
    expect(files).toContain("002 - Example OST - Credits.mp3");
    expect(rerun.tracks.map((track) => [track.title, track.inPlaylist])).toEqual([
      ["Last Stand", true], ["Credits", true], ["Final Battle", false],
    ]);
    expect(await readFile(join(rerun.directory, "Boss Themes.m3u8"), "utf8")).toBe(
      "#EXTM3U\n#EXTINF:-1,Another OST - Last Stand\n002 - Another OST - Last Stand.mp3\n" +
      "#EXTINF:-1,Example OST - Credits\n002 - Example OST - Credits.mp3\n",
    );
  });

  it("uses a suffixed folder when the name is taken by something else", async () => {
    const outputRoot = await temporaryDirectory();
    await mkdir(join(outputRoot, "Mix"));
    await writeFile(join(outputRoot, "Mix", "mine.txt"), "keep");
    const { resolveTracks } = resolver();
    const result = await downloadPlaylist({
      playlist: { id: "p2", name: "Mix", entries: [entry("a", "01", "One")] },
      outputRoot, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses,
    });
    expect(result).toMatchObject({ directory: join(outputRoot, "Mix (2)"), suffixed: true });
    expect(await readdir(join(outputRoot, "Mix"))).toEqual(["mine.txt"]);
  });

  it("records failed track pages without blocking other tracks", async () => {
    const outputRoot = await temporaryDirectory();
    const broken = entry("a", "01", "Broken");
    const { resolveTracks } = resolver({}, [broken.trackUrl]);
    const result = await downloadPlaylist({
      playlist: { id: "p3", name: "Partial", entries: [broken, entry("b", "02", "Works")] },
      outputRoot, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses,
    });
    expect(result.state).toBe("failed");
    expect(result.tracks.map(({ state }) => state)).toEqual(["failed", "complete"]);
  });

  it("blocks lossless-only plans before creating a folder", async () => {
    const outputRoot = await temporaryDirectory();
    const { resolveTracks } = resolver();
    await expect(downloadPlaylist({
      playlist: { id: "p4", name: "Lossless", entries: [entry("a", "01", "One")] },
      outputRoot, policy: { kind: "lossless-only", skipUnavailable: false }, resolveTracks, fetchImpl, resolveAddresses,
    })).rejects.toBeInstanceOf(FormatPlanBlockedError);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("disambiguates colliding filenames and never overwrites", async () => {
    const outputRoot = await temporaryDirectory();
    await mkdir(join(outputRoot, "Same"));
    await writeFile(join(outputRoot, "Same", MANIFEST_FILENAME), JSON.stringify({ schemaVersion: 1, kind: "playlist", playlistId: "p5", playlistName: "Same", state: "complete", updatedAt: "", tracks: [] }));
    await writeFile(join(outputRoot, "Same", "001 - Example OST - One.mp3"), "foreign");
    const { resolveTracks } = resolver();
    const result = await downloadPlaylist({
      playlist: { id: "p5", name: "Same", entries: [entry("a", "01", "One")] },
      outputRoot, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses,
    });
    expect(result.tracks[0]!.filename).toMatch(/^001 - Example OST - One \[[0-9a-f]{8}\]\.mp3$/);
    expect(await readFile(join(outputRoot, "Same", "001 - Example OST - One.mp3"), "utf8")).toBe("foreign");
  });

  it("renames the folder and m3u8 when the playlist is renamed", async () => {
    const outputRoot = await temporaryDirectory();
    const { resolveTracks } = resolver();
    const result = await downloadPlaylist({
      playlist: { id: "p6", name: "Old", entries: [entry("a", "01", "One")] },
      outputRoot, policy: { kind: "prefer-lossless" }, resolveTracks, fetchImpl, resolveAddresses,
    });
    const renamed = await renamePlaylistFolder(result.directory, "p6", "New");
    expect(renamed).toBe(join(outputRoot, "New"));
    expect(await readdir(renamed)).toContain("New.m3u8");
    expect(await readdir(renamed)).not.toContain("Old.m3u8");
  });
});
