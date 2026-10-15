import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAlbumDirectory, trackFilename, trackRelativePath, writeManifest } from "../src/output.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "khinsider-downloader-output-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("output paths and manifest", () => {
  it("creates padded, sanitized track names", () => {
    expect(trackFilename(1, 19, "Intro/Theme", "MP3")).toBe("01 - Intro-Theme.mp3");
    expect(trackFilename(100, 120, "Finale", "FLAC")).toBe("100 - Finale.flac");
    expect(trackRelativePath({ discNumber: 2, number: 1, title: "Serenity" }, 24, "MP3", "CD", true)).toBe("CD2/01 - Serenity.mp3");
    expect(trackRelativePath({ discNumber: 2, number: 1, title: "Serenity" }, 24, "MP3", "Disc", true)).toBe("Disc2/01 - Serenity.mp3");
    expect(trackRelativePath({ number: 1, title: "Opening" }, 19, "MP3", "CD", false)).toBe("01 - Opening.mp3");
  });

  it("reuses a manifest-owned folder and separates colliding album titles", async () => {
    const root = await temporaryDirectory();
    const firstSource = "https://downloads.khinsider.com/game-soundtracks/album/first";
    const secondSource = "https://downloads.khinsider.com/game-soundtracks/album/second";
    const firstDirectory = await prepareAlbumDirectory(root, "Same: Title", firstSource);
    await writeManifest(firstDirectory, {
      schemaVersion: 1,
      sourceAlbum: firstSource,
      title: "Same: Title",
      state: "downloading",
      updatedAt: new Date().toISOString(),
      tracks: [],
    });

    expect(await readFile(join(firstDirectory, ".download-manifest.json"), "utf8")).toContain(firstSource);
    expect(await prepareAlbumDirectory(root, "Same: Title", firstSource)).toBe(firstDirectory);
    const secondDirectory = await prepareAlbumDirectory(root, "Same: Title", secondSource);
    expect(secondDirectory).not.toBe(firstDirectory);
    expect(secondDirectory).toContain("Same- Title [");
  });
});