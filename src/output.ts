import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const MANIFEST_FILENAME = ".download-manifest.json";

export type ManifestTrack = {
  discNumber?: number;
  number: number;
  title: string;
  filename: string;
  format: string;
  state: "queued" | "downloading" | "complete" | "skipped" | "failed" | "canceled";
  bytes?: number;
  error?: string;
};

export type AlbumManifest = {
  schemaVersion: 1;
  sourceAlbum: string;
  title: string;
  state: "downloading" | "complete" | "incomplete" | "failed" | "canceled";
  updatedAt: string;
  tracks: ManifestTrack[];
};

export type PlaylistManifestTrack = ManifestTrack & {
  trackUrl: string;
  albumUrl: string;
  albumTitle: string;
  inPlaylist: boolean;
};

export type PlaylistManifest = {
  schemaVersion: 1;
  kind: "playlist";
  playlistId: string;
  playlistName: string;
  state: AlbumManifest["state"];
  updatedAt: string;
  playlistFile?: string;
  tracks: PlaylistManifestTrack[];
};

export function defaultOutputRoot(): string {
  return join(homedir(), "Music", "Khinsider Downloader");
}

export function safeFileComponent(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (normalized || "Untitled").slice(0, 120);
}

export function trackFilename(number: number, total: number, title: string, format: string): string {
  const width = Math.max(2, String(total).length);
  const extension = format.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!extension) throw new Error(`Invalid audio format: ${format}`);
  return `${String(number).padStart(width, "0")} - ${safeFileComponent(title)}.${extension}`;
}

export function trackRelativePath(
  track: Pick<ManifestTrack, "discNumber" | "number" | "title">,
  totalOnDisc: number,
  format: string,
  discLabel: "CD" | "Disc",
  useDiscFolders: boolean,
): string {
  const filename = trackFilename(track.number, totalOnDisc, track.title, format);
  if (!useDiscFolders) return filename;
  if (!Number.isInteger(track.discNumber) || (track.discNumber ?? 0) < 1) {
    throw new Error(`Missing valid disc number for track ${track.number}: ${track.title}`);
  }
  return join(`${discLabel}${track.discNumber}`, filename);
}

function sourceIdentity(sourceAlbum: string): string {
  return createHash("sha256").update(new URL(sourceAlbum).pathname).digest("hex").slice(0, 8);
}

async function readSourceFromManifest(directory: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, MANIFEST_FILENAME), "utf8"));
    if (typeof parsed === "object" && parsed !== null && "sourceAlbum" in parsed && typeof parsed.sourceAlbum === "string") {
      return parsed.sourceAlbum;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function prepareAlbumDirectory(outputRoot: string, title: string, sourceAlbum: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  if (!(await stat(outputRoot)).isDirectory()) throw new Error(`Output root is not a directory: ${outputRoot}`);

  const baseDirectory = join(outputRoot, safeFileComponent(title));
  if (!(await exists(baseDirectory))) {
    await mkdir(baseDirectory);
    return baseDirectory;
  }
  if (await readSourceFromManifest(baseDirectory) === sourceAlbum) return baseDirectory;

  const identifiedDirectory = `${baseDirectory} [${sourceIdentity(sourceAlbum)}]`;
  if (!(await exists(identifiedDirectory))) {
    await mkdir(identifiedDirectory);
    return identifiedDirectory;
  }
  if (await readSourceFromManifest(identifiedDirectory) === sourceAlbum) return identifiedDirectory;
  throw new Error(`Album output folder is occupied by unrelated or unverifiable files: ${identifiedDirectory}`);
}

export async function readManifest(directory: string): Promise<AlbumManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(directory, MANIFEST_FILENAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" || parsed === null ||
    !("schemaVersion" in parsed) || parsed.schemaVersion !== 1 ||
    !("sourceAlbum" in parsed) || typeof parsed.sourceAlbum !== "string" ||
    !("title" in parsed) || typeof parsed.title !== "string" ||
    !("state" in parsed) || typeof parsed.state !== "string" ||
    !("tracks" in parsed) || !Array.isArray(parsed.tracks)
  ) {
    throw new Error(`Invalid download manifest: ${join(directory, MANIFEST_FILENAME)}`);
  }
  if ("kind" in parsed && parsed.kind !== "album") {
    throw new Error(`Folder contains a different kind of download: ${directory}`);
  }
  return parsed as AlbumManifest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function writeManifest(directory: string, manifest: AlbumManifest | PlaylistManifest): Promise<void> {
  const destination = join(directory, MANIFEST_FILENAME);
  const temporary = join(dirname(destination), `${MANIFEST_FILENAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
const MAX_STEM_LENGTH = 120;
const MIN_ALBUM_LENGTH = 20;

function trimEnd(value: string, length: number): string {
  return value.slice(0, Math.max(0, length)).replace(/[. ]+$/g, "").trim();
}

/** Builds "NNN - Album - Title.ext", shortening the album before the track title to stay within 120 characters. */
export function playlistTrackFilename(position: number, total: number, albumTitle: string, title: string, format: string): string {
  const width = Math.max(3, String(total).length);
  const extension = format.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!extension) throw new Error(`Invalid audio format: ${format}`);
  const prefix = `${String(position).padStart(width, "0")} - `;
  let album = safeFileComponent(albumTitle);
  let track = safeFileComponent(title);
  const available = MAX_STEM_LENGTH - prefix.length - 3;
  if (album.length + track.length > available) {
    const albumBudget = Math.max(MIN_ALBUM_LENGTH, available - track.length);
    album = trimEnd(album, albumBudget) || "Album";
    track = trimEnd(track, available - album.length) || "Untitled";
  }
  return `${prefix}${album} - ${track}.${extension}`;
}

/** Adds a stable suffix derived from the source track so different tracks never share a filename. */
export function disambiguatedFilename(filename: string, trackUrl: string): string {
  const hash = createHash("sha256").update(trackUrl).digest("hex").slice(0, 8);
  const dot = filename.lastIndexOf(".");
  return `${filename.slice(0, dot)} [${hash}]${filename.slice(dot)}`;
}

export function playlistFileName(playlistName: string): string {
  return `${safeFileComponent(playlistName)}.m3u8`;
}

function isPlaylistManifestTrack(value: unknown): value is PlaylistManifestTrack {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Record<string, unknown>;
  return typeof track.trackUrl === "string" && typeof track.albumUrl === "string" &&
    typeof track.albumTitle === "string" && typeof track.title === "string" &&
    typeof track.filename === "string" && !track.filename.includes("/") && !track.filename.includes("\\") &&
    track.filename !== ".." && typeof track.format === "string" && typeof track.state === "string" &&
    typeof track.number === "number" && typeof track.inPlaylist === "boolean" &&
    (track.bytes === undefined || typeof track.bytes === "number");
}

/** Returns the playlist manifest in a folder, undefined when there is none, or throws for other manifests. */
export async function readPlaylistManifest(directory: string): Promise<PlaylistManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(directory, MANIFEST_FILENAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" || parsed === null ||
    !("schemaVersion" in parsed) || parsed.schemaVersion !== 1 ||
    !("kind" in parsed) || parsed.kind !== "playlist" ||
    !("playlistId" in parsed) || typeof parsed.playlistId !== "string" ||
    !("playlistName" in parsed) || typeof parsed.playlistName !== "string" ||
    !("tracks" in parsed) || !Array.isArray(parsed.tracks) || !parsed.tracks.every(isPlaylistManifestTrack) ||
    ("playlistFile" in parsed && parsed.playlistFile !== undefined &&
      (typeof parsed.playlistFile !== "string" || parsed.playlistFile.includes("/")))
  ) {
    throw new Error(`Not a playlist download manifest: ${join(directory, MANIFEST_FILENAME)}`);
  }
  return parsed as PlaylistManifest;
}

async function playlistIdIn(directory: string): Promise<string | undefined> {
  try {
    return (await readPlaylistManifest(directory))?.playlistId;
  } catch {
    return undefined;
  }
}

export type PlaylistDirectory = {
  directory: string;
  exists: boolean;
  /** True when the folder name differs from the playlist name because another folder was in the way. */
  suffixed: boolean;
};

/**
 * Finds the folder for a playlist without creating it: the remembered folder when it still belongs to
 * this playlist, otherwise "Name", "Name (2)", … skipping folders that hold anything else.
 */
export async function locatePlaylistDirectory(
  outputRoot: string,
  playlistName: string,
  playlistId: string,
  preferred?: string,
): Promise<PlaylistDirectory> {
  await mkdir(outputRoot, { recursive: true });
  if (!(await stat(outputRoot)).isDirectory()) throw new Error(`Output root is not a directory: ${outputRoot}`);
  const base = safeFileComponent(playlistName);
  if (preferred && resolve(dirname(preferred)) === resolve(outputRoot) && await playlistIdIn(preferred) === playlistId) {
    return { directory: preferred, exists: true, suffixed: basename(preferred) !== base };
  }
  for (let index = 1; index <= 100; index += 1) {
    const directory = join(outputRoot, index === 1 ? base : `${base} (${index})`);
    if (!(await exists(directory))) return { directory, exists: false, suffixed: index > 1 };
    if (await playlistIdIn(directory) === playlistId) return { directory, exists: true, suffixed: index > 1 };
  }
  throw new Error(`Could not find a free folder name for playlist "${playlistName}" in ${outputRoot}`);
}

export async function writeTextAtomic(destination: string, contents: string): Promise<void> {
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function m3u8Contents(tracks: Pick<PlaylistManifestTrack, "albumTitle" | "title" | "filename">[]): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, " ");
  const lines = ["#EXTM3U"];
  for (const track of tracks) {
    lines.push(`#EXTINF:-1,${clean(track.albumTitle)} - ${clean(track.title)}`, track.filename);
  }
  return `${lines.join("\n")}\n`;
}

export { exists as pathExists };
