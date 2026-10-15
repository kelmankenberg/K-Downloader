import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GuiFormatPolicy } from "./gui-types.js";
import {
  MAX_PLAYLIST_ENTRIES,
  MAX_PLAYLISTS,
  NewerPlaylistSchemaError,
  PLAYLIST_SCHEMA_VERSION,
  albumUrlForTrack,
  moveItem,
  normalizePlaylistName,
  normalizeTrackUrl,
  parsePlaylistData,
  playlistNameError,
  type NewPlaylistTrack,
  type Playlist,
  type PlaylistData,
} from "./playlist.js";

export const PLAYLIST_FILENAME = "playlists.json";

export type PlaylistStoreState = {
  playlists: Playlist[];
  activePlaylistId?: string;
  readOnly: boolean;
  warning: string;
};

export type AddEntriesResult = {
  playlistName: string;
  added: number;
  duplicates: number;
  rejected: number;
};

function emptyData(): PlaylistData {
  return { schemaVersion: PLAYLIST_SCHEMA_VERSION, playlists: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class PlaylistStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private data: PlaylistData,
    private readonly readOnly: boolean,
    private warning: string,
  ) {}

  /** Loads playlists, backing up unreadable files so a corrupt store never blocks the app. */
  static async open(file: string): Promise<PlaylistStore> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new PlaylistStore(file, emptyData(), false, "");
      return new PlaylistStore(file, emptyData(), true, `Playlists could not be read: ${(error as Error).message}`);
    }
    try {
      return new PlaylistStore(file, parsePlaylistData(JSON.parse(raw)), false, "");
    } catch (error) {
      if (error instanceof NewerPlaylistSchemaError) return new PlaylistStore(file, emptyData(), true, error.message);
      const backup = `${file}.invalid-${Date.now()}`;
      try {
        await rename(file, backup);
      } catch (renameError) {
        return new PlaylistStore(file, emptyData(), true, `Playlists file is invalid and could not be backed up: ${(renameError as Error).message}`);
      }
      return new PlaylistStore(file, emptyData(), false, `Playlists file was invalid and has been moved to ${backup}. Starting with no playlists.`);
    }
  }

  static defaultPath(userData: string): string {
    return join(userData, PLAYLIST_FILENAME);
  }

  state(): PlaylistStoreState {
    return {
      playlists: clone(this.data.playlists),
      ...(this.data.activePlaylistId ? { activePlaylistId: this.data.activePlaylistId } : {}),
      readOnly: this.readOnly,
      warning: this.warning,
    };
  }

  get(id: string): Playlist | undefined {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    return playlist ? clone(playlist) : undefined;
  }

  create(name: string): Promise<Playlist> {
    return this.mutate((data) => {
      if (data.playlists.length >= MAX_PLAYLISTS) throw new Error(`You can have up to ${MAX_PLAYLISTS} playlists.`);
      const error = playlistNameError(name, data.playlists);
      if (error) throw new Error(error);
      const now = new Date().toISOString();
      const playlist: Playlist = { id: randomUUID(), name: normalizePlaylistName(name), createdAt: now, updatedAt: now, entries: [] };
      data.playlists.push(playlist);
      data.activePlaylistId = playlist.id;
      return clone(playlist);
    });
  }

  rename(id: string, name: string): Promise<Playlist> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      const error = playlistNameError(name, data.playlists, id);
      if (error) throw new Error(error);
      playlist.name = normalizePlaylistName(name);
      playlist.updatedAt = new Date().toISOString();
      return clone(playlist);
    });
  }

  delete(id: string): Promise<void> {
    return this.mutate((data) => {
      findPlaylist(data, id);
      data.playlists = data.playlists.filter((playlist) => playlist.id !== id);
      if (data.activePlaylistId === id) {
        if (data.playlists[0]) data.activePlaylistId = data.playlists[0].id;
        else delete data.activePlaylistId;
      }
    });
  }

  setActive(id: string): Promise<void> {
    return this.mutate((data) => {
      findPlaylist(data, id);
      data.activePlaylistId = id;
    });
  }

  addEntries(id: string, tracks: NewPlaylistTrack[]): Promise<AddEntriesResult> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      const existing = new Set(playlist.entries.map((entry) => entry.trackUrl));
      let added = 0;
      let duplicates = 0;
      let rejected = 0;
      const now = new Date().toISOString();
      for (const track of tracks) {
        let trackUrl: string;
        try {
          trackUrl = normalizeTrackUrl(track.trackUrl);
        } catch {
          rejected += 1;
          continue;
        }
        if (existing.has(trackUrl)) {
          duplicates += 1;
          continue;
        }
        if (playlist.entries.length >= MAX_PLAYLIST_ENTRIES) {
          throw new Error(`Playlists can hold up to ${MAX_PLAYLIST_ENTRIES} tracks.`);
        }
        existing.add(trackUrl);
        playlist.entries.push({
          id: randomUUID(),
          trackUrl,
          albumUrl: albumUrlForTrack(trackUrl),
          albumTitle: track.albumTitle.trim().slice(0, 500) || "Unknown album",
          title: track.title.trim().slice(0, 500) || "Untitled",
          ...(track.discNumber ? { discNumber: track.discNumber } : {}),
          ...(track.trackNumber ? { trackNumber: track.trackNumber } : {}),
          ...(track.formats ? { formats: [...track.formats] } : {}),
          addedAt: now,
        });
        added += 1;
      }
      if (added > 0) playlist.updatedAt = now;
      return { playlistName: playlist.name, added, duplicates, rejected };
    });
  }

  removeEntries(id: string, entryIds: string[]): Promise<void> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      const remove = new Set(entryIds);
      playlist.entries = playlist.entries.filter((entry) => !remove.has(entry.id));
      playlist.updatedAt = new Date().toISOString();
    });
  }

  clear(id: string): Promise<void> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      playlist.entries = [];
      playlist.updatedAt = new Date().toISOString();
    });
  }

  moveEntry(id: string, entryId: string, toIndex: number): Promise<void> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      const from = playlist.entries.findIndex((entry) => entry.id === entryId);
      if (from < 0) throw new Error("Track is no longer in this playlist.");
      playlist.entries = moveItem(playlist.entries, from, toIndex);
      playlist.updatedAt = new Date().toISOString();
    });
  }

  updateFormats(id: string, formatsByTrackUrl: Map<string, string[]>): Promise<void> {
    return this.mutate((data) => {
      const playlist = findPlaylist(data, id);
      for (const entry of playlist.entries) {
        const formats = formatsByTrackUrl.get(entry.trackUrl);
        if (formats) entry.formats = [...formats];
      }
    });
  }

  setDownloaded(id: string, directory: string, policy?: GuiFormatPolicy): Promise<void> {
    return this.mutate((data) => {
      const playlist = data.playlists.find((candidate) => candidate.id === id);
      if (!playlist) return;
      playlist.lastDirectory = directory;
      if (policy) playlist.formatPolicy = clone(policy);
    });
  }

  /** Applies a change to a copy, persists it, and only then makes it visible. */
  private mutate<T>(change: (data: PlaylistData) => T): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.readOnly) throw new Error(this.warning || "Playlists are read-only.");
      const next = clone(this.data);
      const result = change(next);
      await writeAtomic(this.file, `${JSON.stringify(parsePlaylistData(next), null, 2)}\n`);
      this.data = next;
      return result;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function findPlaylist(data: PlaylistData, id: string): Playlist {
  const playlist = data.playlists.find((candidate) => candidate.id === id);
  if (!playlist) throw new Error("Playlist not found.");
  return playlist;
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
