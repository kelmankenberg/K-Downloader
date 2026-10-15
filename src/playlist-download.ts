import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  FormatPlanBlockedError,
  fileExists,
  isVerifiedComplete,
  runTransfers,
  type DownloadOptions,
  type DownloadProgress,
} from "./downloader.js";
import { planFormats, type FormatPolicy, type TrackFormatSelection } from "./formats.js";
import type { DiscoveredTrack, ResolvedTrack } from "./khinsider.js";
import {
  disambiguatedFilename,
  locatePlaylistDirectory,
  m3u8Contents,
  playlistFileName,
  playlistTrackFilename,
  readPlaylistManifest,
  safeFileComponent,
  writeManifest,
  writeTextAtomic,
  type PlaylistManifest,
  type PlaylistManifestTrack,
} from "./output.js";
import type { Playlist } from "./playlist.js";

export type PlaylistProgress = {
  stage: "resolve-start" | "resolve-complete" | "resolve-failed" | DownloadProgress["stage"];
  number: number;
  title: string;
  completedTracks: number;
  totalTracks: number;
  bytesReceived?: number;
};

export type PlaylistDownloadOptions = {
  playlist: Pick<Playlist, "id" | "name" | "entries">;
  outputRoot: string;
  preferredDirectory?: string;
  policy: FormatPolicy;
  /** Visits track pages for tracks that are not already downloaded. */
  resolveTracks: (trackUrls: string[], onResult: (index: number, result: ResolvedTrack) => void) => Promise<ResolvedTrack[]>;
  onResolved?: (results: ResolvedTrack[]) => void;
  onProgress?: (progress: PlaylistProgress) => void;
} & Pick<DownloadOptions, "signal" | "fetchImpl" | "resolveAddresses">;

export type PlaylistDownloadResult = {
  directory: string;
  suffixed: boolean;
  state: PlaylistManifest["state"];
  tracks: PlaylistManifestTrack[];
  playlistFile?: string;
  warnings: string[];
};

const RECOVERABLE_PARTIAL_STATES = new Set(["downloading", "failed", "canceled"]);

export async function downloadPlaylist(options: PlaylistDownloadOptions): Promise<PlaylistDownloadResult> {
  const { playlist } = options;
  if (playlist.entries.length === 0) throw new Error("This playlist has no tracks.");
  options.signal?.throwIfAborted();

  const located = await locatePlaylistDirectory(options.outputRoot, playlist.name, playlist.id, options.preferredDirectory);
  const { directory } = located;
  const previous = located.exists ? await readPlaylistManifest(directory) : undefined;
  const previousByUrl = new Map(previous?.tracks.map((track) => [track.trackUrl, track]) ?? []);
  const total = playlist.entries.length;

  const kept = new Map<string, PlaylistManifestTrack>();
  for (const entry of playlist.entries) {
    const prior = previousByUrl.get(entry.trackUrl);
    if (prior && await isVerifiedComplete(directory, prior)) kept.set(entry.trackUrl, prior);
  }

  const pending = playlist.entries
    .map((entry, index) => ({ entry, position: index + 1 }))
    .filter(({ entry }) => !kept.has(entry.trackUrl));
  let results: ResolvedTrack[] = [];
  if (pending.length > 0) {
    options.onProgress?.({ stage: "resolve-start", number: pending[0]!.position, title: pending[0]!.entry.title, completedTracks: 0, totalTracks: pending.length });
    results = await options.resolveTracks(pending.map(({ entry }) => entry.trackUrl), (index, result) => {
      const item = pending[index];
      if (!item) return;
      options.onProgress?.({
        stage: result.error ? "resolve-failed" : "resolve-complete",
        number: item.position,
        title: item.entry.title,
        completedTracks: index + 1,
        totalTracks: pending.length,
      });
    });
    options.onResolved?.(results);
  }
  options.signal?.throwIfAborted();
  const resolvedByUrl = new Map(results.map((result) => [result.trackUrl, result]));

  const discovered: DiscoveredTrack[] = pending.flatMap(({ entry, position }) => {
    const resolved = resolvedByUrl.get(entry.trackUrl);
    if (!resolved?.details || resolved.error) return [];
    return [{ number: position, title: entry.title, pageUrl: new URL(entry.trackUrl), audioLinks: resolved.details.audioLinks }];
  });
  const plan = planFormats(discovered, options.policy);
  const blocked = plan.tracks
    .filter((selection) => selection.state === "unavailable")
    .map(({ track, reason }) => `${track.number}. ${track.title}: ${reason}`);
  if (blocked.length > 0) throw new FormatPlanBlockedError(blocked);
  const selections = new Map<string, TrackFormatSelection>(plan.tracks.map((selection) => [selection.track.pageUrl.href, selection]));

  if (!located.exists) {
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Playlist folder appeared while preparing the download: ${directory}`);
      throw error;
    }
  }

  const currentUrls = new Set(playlist.entries.map((entry) => entry.trackUrl));
  const used = new Set<string>();
  for (const track of previous?.tracks ?? []) {
    if (track.filename && (!currentUrls.has(track.trackUrl) || kept.has(track.trackUrl))) used.add(track.filename);
  }
  const isTaken = async (filename: string, prior?: PlaylistManifestTrack): Promise<boolean> => {
    if (used.has(filename)) return true;
    const target = join(directory, filename);
    if (await fileExists(target)) return true;
    if (await fileExists(`${target}.part`)) {
      if (prior?.filename !== filename || !RECOVERABLE_PARTIAL_STATES.has(prior.state)) return true;
      await rm(`${target}.part`);
    }
    return false;
  };

  const tracks: PlaylistManifestTrack[] = [];
  for (const [index, entry] of playlist.entries.entries()) {
    const position = index + 1;
    const identity = { trackUrl: entry.trackUrl, albumUrl: entry.albumUrl, albumTitle: entry.albumTitle, title: entry.title, inPlaylist: true };
    const keptTrack = kept.get(entry.trackUrl);
    if (keptTrack) {
      tracks.push({ ...keptTrack, ...identity, state: "complete" });
      continue;
    }
    const resolved = resolvedByUrl.get(entry.trackUrl);
    if (!resolved?.details || resolved.error) {
      tracks.push({ ...identity, number: position, filename: "", format: "", state: "failed", error: resolved?.error ?? "Track page could not be checked" });
      continue;
    }
    const selection = selections.get(new URL(entry.trackUrl).href);
    if (!selection?.selected || selection.state === "skipped") {
      tracks.push({ ...identity, number: position, filename: "", format: "", state: "skipped", ...(selection?.reason ? { error: selection.reason } : {}) });
      continue;
    }
    const format = selection.selected.format;
    const prior = previousByUrl.get(entry.trackUrl);
    const reusePrior = prior?.filename && prior.format === format && !(await isTaken(prior.filename, prior));
    const number = reusePrior ? prior.number : position;
    let filename = reusePrior ? prior.filename : playlistTrackFilename(position, total, entry.albumTitle, entry.title, format);
    if (!reusePrior && await isTaken(filename, prior)) {
      filename = disambiguatedFilename(filename, entry.trackUrl);
      if (await isTaken(filename, prior)) {
        tracks.push({ ...identity, number, filename: "", format, state: "failed", error: "A different file already uses this track's file name" });
        continue;
      }
    }
    used.add(filename);
    tracks.push({ ...identity, number, filename, format, state: "queued" });
  }
  for (const track of previous?.tracks ?? []) {
    if (!currentUrls.has(track.trackUrl)) tracks.push({ ...track, inPlaylist: false });
  }

  const manifest: PlaylistManifest = {
    schemaVersion: 1,
    kind: "playlist",
    playlistId: playlist.id,
    playlistName: playlist.name,
    state: "downloading",
    updatedAt: new Date().toISOString(),
    ...(previous?.playlistFile ? { playlistFile: previous.playlistFile } : {}),
    tracks,
  };
  await writeManifest(directory, manifest);

  const current = tracks.filter((track) => track.inPlaylist);
  const canceled = await runTransfers(
    directory,
    manifest,
    current.map((entry) => ({ entry, audio: selections.get(new URL(entry.trackUrl).href)?.selected })),
    total,
    {
      ...options,
      onProgress: (progress) => {
        const { index, ...rest } = progress;
        options.onProgress?.({ ...rest, number: index === undefined ? progress.number : index + 1 });
      },
    },
  );

  const warnings = await writePlaylistFile(directory, manifest);
  const hasFailures = current.some((track) => track.state === "failed");
  const hasSkips = current.some((track) => track.state === "skipped");
  manifest.state = canceled ? "canceled" : hasFailures ? "failed" : hasSkips ? "incomplete" : "complete";
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(directory, manifest);
  return {
    directory,
    suffixed: located.suffixed,
    state: manifest.state,
    tracks: manifest.tracks,
    ...(manifest.playlistFile ? { playlistFile: manifest.playlistFile } : {}),
    warnings,
  };
}

/** Writes the .m3u8 for completed tracks in playlist order, never replacing a file this app did not create. */
async function writePlaylistFile(directory: string, manifest: PlaylistManifest): Promise<string[]> {
  const warnings: string[] = [];
  const name = playlistFileName(manifest.playlistName);
  if (manifest.playlistFile && manifest.playlistFile !== name) {
    await rm(join(directory, manifest.playlistFile), { force: true });
    delete manifest.playlistFile;
  }
  const target = join(directory, name);
  if (manifest.playlistFile !== name && await fileExists(target)) {
    warnings.push(`${name} already exists and was not created by this app, so it was not updated.`);
    return warnings;
  }
  const completed = manifest.tracks.filter((track) => track.inPlaylist && track.state === "complete");
  await writeTextAtomic(target, m3u8Contents(completed));
  manifest.playlistFile = name;
  return warnings;
}

/**
 * Renames a downloaded playlist folder and its .m3u8 after the playlist is renamed.
 * Never replaces an existing folder. Returns the new folder path.
 */
export async function renamePlaylistFolder(directory: string, playlistId: string, newName: string): Promise<string> {
  const manifest = await readPlaylistManifest(directory);
  if (!manifest || manifest.playlistId !== playlistId) throw new Error(`Folder does not belong to this playlist: ${directory}`);
  const target = join(dirname(directory), safeFileComponent(newName));
  if (target === directory) {
    manifest.playlistName = newName;
  } else {
    if (await fileExists(target)) throw new Error(`A folder named "${basename(target)}" already exists.`);
    await rename(directory, target);
    manifest.playlistName = newName;
  }
  const oldFile = manifest.playlistFile;
  const newFile = playlistFileName(newName);
  if (oldFile && oldFile !== newFile && !(await fileExists(join(target, newFile)))) {
    try {
      await rename(join(target, oldFile), join(target, newFile));
      manifest.playlistFile = newFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      delete manifest.playlistFile;
    }
  }
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(target, manifest);
  return target;
}
