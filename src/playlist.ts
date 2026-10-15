import type { GuiFormatPolicy } from "./gui-types.js";

export const PLAYLIST_SCHEMA_VERSION = 1;
export const MAX_PLAYLISTS = 200;
export const MAX_PLAYLIST_ENTRIES = 2000;
export const MAX_PLAYLIST_NAME_LENGTH = 100;
const SITE_ORIGIN = "https://downloads.khinsider.com";
const TRACK_PATH = /^\/game-soundtracks\/album\/([^/]+)\/([^/]+)$/;

export type PlaylistEntry = {
  id: string;
  trackUrl: string;
  albumUrl: string;
  albumTitle: string;
  title: string;
  discNumber?: number;
  trackNumber?: number;
  formats?: string[];
  addedAt: string;
};

export type Playlist = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  formatPolicy?: GuiFormatPolicy;
  lastDirectory?: string;
  entries: PlaylistEntry[];
};

export type PlaylistData = {
  schemaVersion: typeof PLAYLIST_SCHEMA_VERSION;
  activePlaylistId?: string;
  playlists: Playlist[];
};

export type NewPlaylistTrack = Omit<PlaylistEntry, "id" | "addedAt">;

/** Returns the canonical track page URL used for duplicate detection, or throws. */
export function normalizeTrackUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected an HTTPS KHInsider track page URL");
  }
  if (url.origin !== SITE_ORIGIN || url.username || url.password || !TRACK_PATH.test(url.pathname)) {
    throw new Error("Expected an HTTPS KHInsider track page URL");
  }
  return `${SITE_ORIGIN}${url.pathname}`;
}

export function isTrackUrl(input: string): boolean {
  try {
    normalizeTrackUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function albumUrlForTrack(trackUrl: string): string {
  const match = new URL(normalizeTrackUrl(trackUrl)).pathname.match(TRACK_PATH)!;
  return `${SITE_ORIGIN}/game-soundtracks/album/${match[1]}`;
}

export function normalizePlaylistName(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Returns an error message for an invalid name, or undefined when the name is usable. */
export function playlistNameError(input: string, existing: Pick<Playlist, "id" | "name">[], ignoreId?: string): string | undefined {
  const name = normalizePlaylistName(input);
  if (!name) return "Enter a playlist name.";
  if (name.length > MAX_PLAYLIST_NAME_LENGTH) return `Playlist names can be up to ${MAX_PLAYLIST_NAME_LENGTH} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Playlist names cannot contain control characters.";
  if (!/[^<>:"/\\|?*.\s-]/.test(name)) return "Playlist names need at least one letter or number for the folder name.";
  const folded = name.toLocaleLowerCase();
  if (existing.some((playlist) => playlist.id !== ignoreId && playlist.name.toLocaleLowerCase() === folded)) {
    return "A playlist with this name already exists.";
  }
  return undefined;
}

/** Moves one item to a new index, clamping the destination. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(Math.max(0, Math.min(result.length, to)), 0, item!);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= max);
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0 && (value as number) < 100_000);
}

function isFormatPolicy(value: unknown): value is GuiFormatPolicy {
  if (!isRecord(value)) return false;
  if (value.kind === "prefer-lossless") return true;
  if (value.kind === "lossless-only") return typeof value.skipUnavailable === "boolean";
  return value.kind === "specific" && typeof value.format === "string" && /^[A-Za-z0-9.+-]{1,16}$/.test(value.format) &&
    typeof value.skipUnavailable === "boolean";
}

function isEntry(value: unknown): value is PlaylistEntry {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id || value.id.length > 64) return false;
  if (typeof value.trackUrl !== "string" || !isTrackUrl(value.trackUrl)) return false;
  if (typeof value.albumUrl !== "string" || value.albumUrl !== albumUrlForTrack(value.trackUrl)) return false;
  if (typeof value.albumTitle !== "string" || value.albumTitle.length > 500) return false;
  if (typeof value.title !== "string" || value.title.length > 500) return false;
  if (typeof value.addedAt !== "string" || value.addedAt.length > 64) return false;
  if (!optionalPositiveInteger(value.discNumber) || !optionalPositiveInteger(value.trackNumber)) return false;
  return value.formats === undefined || (Array.isArray(value.formats) && value.formats.length <= 16 &&
    value.formats.every((format) => typeof format === "string" && /^[A-Z0-9]{1,16}$/.test(format)));
}

function isPlaylist(value: unknown): value is Playlist {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id || value.id.length > 64) return false;
  if (typeof value.name !== "string" || playlistNameError(value.name, []) !== undefined) return false;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return false;
  if (value.formatPolicy !== undefined && !isFormatPolicy(value.formatPolicy)) return false;
  if (!optionalString(value.lastDirectory, 4096)) return false;
  if (!Array.isArray(value.entries) || value.entries.length > MAX_PLAYLIST_ENTRIES || !value.entries.every(isEntry)) return false;
  const trackUrls = new Set(value.entries.map((entry) => (entry as PlaylistEntry).trackUrl));
  const entryIds = new Set(value.entries.map((entry) => (entry as PlaylistEntry).id));
  return trackUrls.size === value.entries.length && entryIds.size === value.entries.length;
}

export class NewerPlaylistSchemaError extends Error {
  constructor(version: number) {
    super(`Playlists were saved by a newer version of Khinsider Downloader (schema ${version}). They are read-only here.`);
    this.name = "NewerPlaylistSchemaError";
  }
}

/** Validates stored playlist data. Throws NewerPlaylistSchemaError for future schemas and Error for invalid data. */
export function parsePlaylistData(value: unknown): PlaylistData {
  if (!isRecord(value) || typeof value.schemaVersion !== "number") throw new Error("Invalid playlist file");
  if (value.schemaVersion > PLAYLIST_SCHEMA_VERSION) throw new NewerPlaylistSchemaError(value.schemaVersion);
  if (value.schemaVersion !== PLAYLIST_SCHEMA_VERSION) throw new Error("Invalid playlist file");
  if (!Array.isArray(value.playlists) || value.playlists.length > MAX_PLAYLISTS || !value.playlists.every(isPlaylist)) {
    throw new Error("Invalid playlist file");
  }
  const playlists = value.playlists as Playlist[];
  const ids = new Set(playlists.map((playlist) => playlist.id));
  const names = new Set(playlists.map((playlist) => playlist.name.toLocaleLowerCase()));
  if (ids.size !== playlists.length || names.size !== playlists.length) throw new Error("Invalid playlist file");
  const active = typeof value.activePlaylistId === "string" && ids.has(value.activePlaylistId) ? value.activePlaylistId : undefined;
  return {
    schemaVersion: PLAYLIST_SCHEMA_VERSION,
    ...(active ? { activePlaylistId: active } : {}),
    playlists,
  };
}
