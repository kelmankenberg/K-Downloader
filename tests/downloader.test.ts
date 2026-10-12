import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAlbum, FormatPlanBlockedError } from "../src/downloader.js";
import type { AlbumPage, DiscoveredTrack } from "../src/khinsider.js";

const sourceAlbum = "https://downloads.khinsider.com/game-soundtracks/album/fixture-album";
const audioHost = "lambda.vgmtreasurechest.com";
const resolveAddresses = async () => [{ address: "93.184.216.34", family: 4 }];
const temporaryDirectories: string[] = [];

const album: AlbumPage = {
  title: "Fixture Album",
  advertisedTrackCount: 2,
  tracks: [],
};

function tracks(formats: string[][] = [["MP3"], ["MP3"]]): DiscoveredTrack[] {
  return formats.map((available, index) => ({
    number: index + 1,
    title: index === 0 ? "Opening" : "Finale",
    pageUrl: new URL(`${sourceAlbum}/${String(index + 1).padStart(2, "0")}.mp3`),
    audioLinks: available.map((format) => ({
      format,
      url: new URL(`https://${audioHost}/${index + 1}.${format.toLowerCase()}`),
    })),
  }));
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "k-downloader-album-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("single-album download", () => {
  it("streams selected tracks and skips size-verified files on rerun", async () => {
    const outputRoot = await temporaryDirectory();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": "3" },
    }));
    const options = {
      sourceAlbum,
      album,
      tracks: tracks(),
      outputRoot,
      policy: { kind: "prefer-lossless" as const },
      fetchImpl,
      resolveAddresses,
    };

    const first = await downloadAlbum(options);
    expect(first.state).toBe("complete");
    expect(first.tracks.map(({ state }) => state)).toEqual(["complete", "complete"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readdir(first.directory)).toEqual([
      ".download-manifest.json",
      "01 - Opening.mp3",
      "02 - Finale.mp3",
    ]);

    const manifest = JSON.parse(await readFile(join(first.directory, ".download-manifest.json"), "utf8"));
    expect(manifest.state).toBe("complete");
    expect(manifest.tracks.map((track: { bytes: number }) => track.bytes)).toEqual([3, 3]);

    const rerunFetch = vi.fn();
    const second = await downloadAlbum({ ...options, fetchImpl: rerunFetch });
    expect(second.directory).toBe(first.directory);
    expect(second.state).toBe("complete");
    expect(rerunFetch).not.toHaveBeenCalled();
  });

  it("blocks unavailable lossless tracks before creating output or transferring", async () => {
    const outputRoot = join(await temporaryDirectory(), "not-created");
    const fetchImpl = vi.fn();
    await expect(downloadAlbum({
      sourceAlbum,
      album,
      tracks: tracks([["FLAC"], ["MP3"]]),
      outputRoot,
      policy: { kind: "lossless-only" },
      fetchImpl,
      resolveAddresses,
    })).rejects.toBeInstanceOf(FormatPlanBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readdir(outputRoot)).rejects.toThrow();
  });

  it("stops the album on site-wide 403 and leaves later tracks queued", async () => {
    const outputRoot = await temporaryDirectory();
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const result = await downloadAlbum({
      sourceAlbum,
      album,
      tracks: tracks(),
      outputRoot,
      policy: { kind: "prefer-lossless" },
      fetchImpl,
      resolveAddresses,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("failed");
    expect(result.tracks.map(({ state }) => state)).toEqual(["failed", "queued"]);
  });

  it("cancels the active stream, removes its partial file, and prevents later tracks", async () => {
    const outputRoot = await temporaryDirectory();
    const controller = new AbortController();
    let signalStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => { signalStreamStarted = resolve; });
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Response(new ReadableStream({
      start(controllerStream) {
        controllerStream.enqueue(new Uint8Array([1, 2, 3]));
        init?.signal?.addEventListener("abort", () => controllerStream.error(new Error("aborted")), { once: true });
        signalStreamStarted();
      },
    }), { status: 200, headers: { "content-type": "audio/mpeg" } }));

    const run = downloadAlbum({
      sourceAlbum,
      album,
      tracks: tracks(),
      outputRoot,
      policy: { kind: "prefer-lossless" },
      signal: controller.signal,
      fetchImpl,
      resolveAddresses,
    });
    await streamStarted;
    controller.abort();
    const result = await run;
    expect(result.state).toBe("canceled");
    expect(result.tracks.map(({ state }) => state)).toEqual(["canceled", "canceled"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await readdir(result.directory)).some((filename) => filename.endsWith(".part"))).toBe(false);
  });

  it("stores tracks in per-disc folders with track numbers reset per disc", async () => {
    const outputRoot = await temporaryDirectory();
    const multiDiscTracks: DiscoveredTrack[] = [
      { discNumber: 1, number: 1, title: "Opening", pageUrl: new URL(`${sourceAlbum}/cd1/01.mp3`), audioLinks: [{ format: "MP3", url: new URL(`https://${audioHost}/cd1-01.mp3`) }] },
      { discNumber: 1, number: 2, title: "Menu", pageUrl: new URL(`${sourceAlbum}/cd1/02.mp3`), audioLinks: [{ format: "MP3", url: new URL(`https://${audioHost}/cd1-02.mp3`) }] },
      { discNumber: 2, number: 1, title: "Serenity", pageUrl: new URL(`${sourceAlbum}/cd2/01.mp3`), audioLinks: [{ format: "MP3", url: new URL(`https://${audioHost}/cd2-01.mp3`) }] },
      { discNumber: 2, number: 2, title: "Finale", pageUrl: new URL(`${sourceAlbum}/cd2/02.mp3`), audioLinks: [{ format: "MP3", url: new URL(`https://${audioHost}/cd2-02.mp3`) }] },
    ];
    const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": "3" },
    });
    const result = await downloadAlbum({
      sourceAlbum,
      album: { ...album, title: "Multi Disc Fixture", tracks: [] },
      tracks: multiDiscTracks,
      outputRoot,
      policy: { kind: "prefer-lossless" },
      discLabel: "Disc",
      fetchImpl,
      resolveAddresses,
    });
    expect(result.state).toBe("complete");
    expect(await readdir(join(result.directory, "Disc1"))).toEqual(["01 - Opening.mp3", "02 - Menu.mp3"]);
    expect(await readdir(join(result.directory, "Disc2"))).toEqual(["01 - Serenity.mp3", "02 - Finale.mp3"]);
    expect(result.tracks.map(({ discNumber, filename }) => [discNumber, filename])).toEqual([
      [1, "Disc1/01 - Opening.mp3"],
      [1, "Disc1/02 - Menu.mp3"],
      [2, "Disc2/01 - Serenity.mp3"],
      [2, "Disc2/02 - Finale.mp3"],
    ]);
  });
});