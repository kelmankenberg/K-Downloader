import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

export async function writeManifest(directory: string, manifest: AlbumManifest): Promise<void> {
  const destination = join(directory, MANIFEST_FILENAME);
  const temporary = join(dirname(destination), `${MANIFEST_FILENAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}