import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamMediaToFile } from "../src/transfer.js";

const mediaUrl = new URL("https://lambda.vgmtreasurechest.com/track.mp3");
const allowedHosts = new Set([mediaUrl.hostname]);
const resolveAddresses = async () => [{ address: "93.184.216.34", family: 4 }];
const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "k-downloader-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("streamMediaToFile", () => {
  it("streams a valid response to the final path", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "01 - Intro.mp3");
    const result = await streamMediaToFile(mediaUrl, outputPath, {
      allowedHosts,
      expectedFormat: "MP3",
      resolveAddresses,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": "3" },
      }),
    });
    expect(result).toEqual({ bytes: 3, contentType: "audio/mpeg" });
    expect([...await readFile(outputPath)]).toEqual([1, 2, 3]);
  });

  it("refuses to overwrite an existing file before making a request", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "existing.mp3");
    await writeFile(outputPath, "keep existing");
    const fetchImpl = vi.fn();
    await expect(streamMediaToFile(mediaUrl, outputPath, {
      allowedHosts,
      expectedFormat: "MP3",
      resolveAddresses,
      fetchImpl,
    })).rejects.toThrow("File already exists");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(outputPath, "utf8")).toBe("keep existing");
  });

  it("rejects HTML and removes the partial file", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "error.mp3");
    await expect(streamMediaToFile(mediaUrl, outputPath, {
      allowedHosts,
      expectedFormat: "MP3",
      resolveAddresses,
      fetchImpl: async () => new Response("not audio", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    })).rejects.toThrow("Expected audio data");
    await expect(readFile(outputPath)).rejects.toThrow();
    await expect(readFile(`${outputPath}.part`)).rejects.toThrow();
  });

  it("rejects redirect hosts outside the approved list", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://other.example.test/audio.mp3" },
    }));
    await expect(streamMediaToFile(mediaUrl, join(await temporaryDirectory(), "redirect.mp3"), {
      allowedHosts,
      expectedFormat: "MP3",
      resolveAddresses,
      fetchImpl,
    })).rejects.toThrow("approved HTTPS hosts");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});