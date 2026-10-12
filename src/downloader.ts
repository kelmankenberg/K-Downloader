import { lstat, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { planFormats, type FormatPolicy } from "./formats.js";
import type { AlbumPage, DiscoveredTrack } from "./khinsider.js";
import {
  prepareAlbumDirectory,
  readManifest,
  trackRelativePath,
  writeManifest,
  type AlbumManifest,
  type ManifestTrack,
} from "./output.js";
import { MediaResponseError, streamMediaToFile, type TransferOptions, type TransferResult } from "./transfer.js";

export type DownloadOptions = {
  sourceAlbum: string;
  album: AlbumPage;
  tracks: DiscoveredTrack[];
  outputRoot: string;
  policy: FormatPolicy;
  discLabel?: "CD" | "Disc";
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  fetchImpl?: TransferOptions["fetchImpl"];
  resolveAddresses?: TransferOptions["resolveAddresses"];
};

export type DownloadProgress = {
  stage: "track-start" | "track-complete" | "track-failed" | "canceled";
  number: number;
  title: string;
  completedTracks: number;
  totalTracks: number;
  bytesReceived?: number;
};

export type DownloadResult = {
  directory: string;
  state: AlbumManifest["state"];
  tracks: ManifestTrack[];
};

export class FormatPlanBlockedError extends Error {
  constructor(readonly tracks: string[]) {
    super(`Download blocked; resolve unavailable formats first: ${tracks.join(", ")}`);
    this.name = "FormatPlanBlockedError";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function isVerifiedComplete(directory: string, entry: ManifestTrack | undefined): Promise<boolean> {
  if (!entry || entry.state !== "complete" || !entry.bytes || !entry.filename) return false;
  try {
    const file = await stat(join(directory, entry.filename));
    return file.isFile() && file.size === entry.bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function createManifestTrack(
  number: number,
  title: string,
  filename: string,
  format: string,
  state: ManifestTrack["state"],
): ManifestTrack {
  return { number, title, filename, format, state };
}

export async function downloadAlbum(options: DownloadOptions): Promise<DownloadResult> {
  const plan = planFormats(options.tracks, options.policy);
  const blockedTracks = plan.tracks
    .filter((selection) => selection.state === "unavailable")
    .map(({ track, reason }) => `${track.number}. ${track.title}: ${reason}`);
  if (blockedTracks.length > 0) throw new FormatPlanBlockedError(blockedTracks);

  const discNumbers = new Set(options.tracks.flatMap((track) => track.discNumber ? [track.discNumber] : []));
  const useDiscFolders = discNumbers.size > 1;
  if (useDiscFolders && options.tracks.some((track) => track.discNumber === undefined)) {
    throw new Error("Multi-disc album contains tracks without a disc number");
  }
  const maxTrackNumberByDisc = new Map<number, number>();
  for (const track of options.tracks) {
    const discNumber = track.discNumber ?? 1;
    maxTrackNumberByDisc.set(discNumber, Math.max(maxTrackNumberByDisc.get(discNumber) ?? 0, track.number));
  }

  const directory = await prepareAlbumDirectory(options.outputRoot, options.album.title, options.sourceAlbum);
  const previous = await readManifest(directory);
  if (previous && previous.sourceAlbum !== options.sourceAlbum) {
    throw new Error(`Manifest source does not match album URL: ${directory}`);
  }

  const manifestTracks: ManifestTrack[] = [];
  for (const selection of plan.tracks) {
    const { track, selected, state } = selection;
    if (!selected || state === "skipped") {
      manifestTracks.push(createManifestTrack(track.number, track.title, "", "", "skipped"));
      continue;
    }

    const filename = trackRelativePath(
      track,
      maxTrackNumberByDisc.get(track.discNumber ?? 1) ?? plan.tracks.length,
      selected.format,
      options.discLabel ?? "CD",
      useDiscFolders,
    );
    const current = previous?.tracks.find((entry) => entry.filename === filename && entry.format === selected.format);
    const target = join(directory, filename);
    const partial = `${target}.part`;
    const targetExists = await fileExists(target);
    if (targetExists && !(await isVerifiedComplete(directory, current))) {
      throw new Error(`Existing file is not verified by the manifest: ${target}`);
    }
    if (await fileExists(partial)) {
      if (current?.state === "downloading" || current?.state === "failed") await rm(partial);
      else throw new Error(`Unverified partial file already exists: ${partial}`);
    }
    manifestTracks.push({
      ...createManifestTrack(track.number, track.title, filename, selected.format, targetExists ? "complete" : "queued"),
      ...(track.discNumber === undefined ? {} : { discNumber: track.discNumber }),
      ...(targetExists ? { bytes: current?.bytes } : {}),
    });
  }

  const manifest: AlbumManifest = {
    schemaVersion: 1,
    sourceAlbum: options.sourceAlbum,
    title: options.album.title,
    state: "downloading",
    updatedAt: new Date().toISOString(),
    tracks: manifestTracks,
  };
  await writeManifest(directory, manifest);

  let completedTracks = manifest.tracks.filter((track) => track.state === "complete" || track.state === "skipped").length;
  let canceled = false;
  for (const [index, selection] of plan.tracks.entries()) {
    const entry = manifest.tracks[index];
    if (entry.state === "complete" || entry.state === "skipped") continue;
    const audio = selection.selected;
    if (!audio) continue;

    if (options.signal?.aborted) {
      entry.state = "canceled";
      for (const queued of manifest.tracks.slice(index + 1)) {
        if (queued.state === "queued") queued.state = "canceled";
      }
      canceled = true;
      options.onProgress?.({ stage: "canceled", number: entry.number, title: entry.title, completedTracks, totalTracks: manifest.tracks.length });
      break;
    }

    entry.state = "downloading";
    options.onProgress?.({ stage: "track-start", number: entry.number, title: entry.title, completedTracks, totalTracks: manifest.tracks.length });
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(directory, manifest);
    try {
      const transferOptions: TransferOptions = {
        allowedHosts: new Set([audio.url.hostname.toLowerCase()]),
        expectedFormat: audio.format,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.resolveAddresses ? { resolveAddresses: options.resolveAddresses } : {}),
      };
      const result: TransferResult = await streamMediaToFile(audio.url, join(directory, entry.filename), transferOptions);
      entry.state = "complete";
      entry.bytes = result.bytes;
      delete entry.error;
      completedTracks += 1;
      options.onProgress?.({ stage: "track-complete", number: entry.number, title: entry.title, completedTracks, totalTracks: manifest.tracks.length, bytesReceived: result.bytes });
    } catch (error) {
      if (options.signal?.aborted) {
        entry.state = "canceled";
        for (const queued of manifest.tracks.slice(index + 1)) {
          if (queued.state === "queued") queued.state = "canceled";
        }
        canceled = true;
        options.onProgress?.({ stage: "canceled", number: entry.number, title: entry.title, completedTracks, totalTracks: manifest.tracks.length });
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(directory, manifest);
        break;
      }
      entry.state = "failed";
      entry.error = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      options.onProgress?.({ stage: "track-failed", number: entry.number, title: entry.title, completedTracks, totalTracks: manifest.tracks.length });
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(directory, manifest);
      if (error instanceof MediaResponseError && [403, 429].includes(error.status)) break;
      continue;
    }
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(directory, manifest);
  }

  const hasFailures = manifest.tracks.some((track) => track.state === "failed");
  const hasSkips = manifest.tracks.some((track) => track.state === "skipped");
  manifest.state = canceled ? "canceled" : hasFailures ? "failed" : hasSkips ? "incomplete" : "complete";
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(directory, manifest);
  return { directory, state: manifest.state, tracks: manifest.tracks };
}