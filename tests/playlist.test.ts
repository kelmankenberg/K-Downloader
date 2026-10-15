import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTrackDetails } from "../src/khinsider.js";
import {
  albumUrlForTrack,
  moveItem,
  normalizeTrackUrl,
  parsePlaylistData,
  playlistNameError,
  NewerPlaylistSchemaError,
} from "../src/playlist.js";
import { PlaylistStore } from "../src/playlist-store.js";

const trackUrl = "https://downloads.khinsider.com/game-soundtracks/album/example-ost/01.%2520Final%2520Battle.mp3";
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "khinsider-downloader-playlist-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function track(url = trackUrl, title = "Final Battle") {
  return { trackUrl: url, albumUrl: "", albumTitle: "Example OST", title };
}

describe("playlist model", () => {
  it("normalizes track URLs and rejects other pages", () => {
    expect(normalizeTrackUrl(`${trackUrl}?x=1#top`)).toBe(trackUrl);
    expect(albumUrlForTrack(trackUrl)).toBe("https://downloads.khinsider.com/game-soundtracks/album/example-ost");
    expect(() => normalizeTrackUrl("https://downloads.khinsider.com/game-soundtracks/album/example-ost")).toThrow();
    expect(() => normalizeTrackUrl("http://downloads.khinsider.com/game-soundtracks/album/a/b.mp3")).toThrow();
    expect(() => normalizeTrackUrl("https://evil.example/game-soundtracks/album/a/b.mp3")).toThrow();
  });

  it("validates playlist names", () => {
    const existing = [{ id: "1", name: "Boss Themes" }];
    expect(playlistNameError("  ", existing)).toMatch(/Enter/);
    expect(playlistNameError("boss themes", existing)).toMatch(/already exists/);
    expect(playlistNameError("boss themes", existing, "1")).toBeUndefined();
    expect(playlistNameError("...", existing)).toMatch(/letter or number/);
    expect(playlistNameError("x".repeat(101), existing)).toMatch(/100/);
    expect(playlistNameError("Chill", existing)).toBeUndefined();
  });

  it("moves items and rejects newer or invalid data", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(() => parsePlaylistData({ schemaVersion: 2, playlists: [] })).toThrow(NewerPlaylistSchemaError);
    expect(() => parsePlaylistData({ schemaVersion: 1, playlists: [{ id: "x" }] })).toThrow(/Invalid/);
  });
});

describe("track page details", () => {
  it("reads album and song names", () => {
    const html = `<html><body><p align="left">Album name: <b>Example OST</b><br>Song name: <b>Final Battle</b><br>
      <a href="https://media.example.test/1.flac">Click here to download as FLAC</a></p></body></html>`;
    const details = parseTrackDetails(html, new URL(trackUrl));
    expect(details).toMatchObject({ albumTitle: "Example OST", title: "Final Battle" });
    expect(details.audioLinks.map(({ format }) => format)).toEqual(["FLAC"]);
  });

  it("falls back to the URL when names are missing", () => {
    const details = parseTrackDetails("<html><body></body></html>", new URL(trackUrl));
    expect(details).toMatchObject({ albumTitle: "example ost", title: "01. Final Battle" });
  });
});

describe("playlist store", () => {
  it("persists playlists, active selection, ordering, and duplicates", async () => {
    const file = join(await temporaryDirectory(), "playlists.json");
    const store = await PlaylistStore.open(file);
    const playlist = await store.create("Boss Themes");
    await expect(store.create("boss themes")).rejects.toThrow(/already exists/);
    const second = trackUrl.replace("01.%2520Final", "02.%2520Last");
    expect(await store.addEntries(playlist.id, [track(), track(second, "Last Stand"), track(`${trackUrl}?again`), track("https://x.test/a")]))
      .toEqual({ playlistName: "Boss Themes", added: 2, duplicates: 1, rejected: 1 });
    const [first] = store.get(playlist.id)!.entries;
    await store.moveEntry(playlist.id, first!.id, 1);
    await store.rename(playlist.id, "Bosses");

    const reopened = await PlaylistStore.open(file);
    const state = reopened.state();
    expect(state.activePlaylistId).toBe(playlist.id);
    expect(state.playlists[0]!.name).toBe("Bosses");
    expect(state.playlists[0]!.entries.map((entry) => entry.title)).toEqual(["Last Stand", "Final Battle"]);
    expect(state.playlists[0]!.entries[0]!.albumUrl).toBe(albumUrlForTrack(trackUrl));
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    await reopened.removeEntries(playlist.id, [state.playlists[0]!.entries[0]!.id]);
    expect(reopened.get(playlist.id)!.entries).toHaveLength(1);
    await reopened.delete(playlist.id);
    expect(reopened.state()).toMatchObject({ playlists: [] });
    expect(reopened.state().activePlaylistId).toBeUndefined();
  });

  it("backs up an invalid file and treats newer files as read-only", async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, "playlists.json");
    await writeFile(file, "{not json");
    const recovered = await PlaylistStore.open(file);
    expect(recovered.state().warning).toMatch(/invalid/);
    expect((await readdir(directory)).some((name) => name.startsWith("playlists.json.invalid-"))).toBe(true);
    await recovered.create("New");

    await writeFile(file, JSON.stringify({ schemaVersion: 9, playlists: [] }));
    const newer = await PlaylistStore.open(file);
    expect(newer.state().readOnly).toBe(true);
    await expect(newer.create("Other")).rejects.toThrow(/newer version/);
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(9);
  });
});
