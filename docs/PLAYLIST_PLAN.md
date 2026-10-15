# Download Playlists Plan

Status: **Planned — design decisions confirmed (see [Decisions](#decisions)).**
Nothing in this document is implemented yet.

## Summary

A download playlist is a named, user-curated list of individual KHInsider
tracks, which may come from many different albums. The user builds the list
while browsing KHInsider (in the embedded website view or album preview), then
downloads every track in the list into one folder named after the playlist.

This complements the existing album-centric flow; it does not replace it.

## Goals

- Create, rename, and delete named playlists.
- Add individual tracks from any public KHInsider album while browsing.
- Review, reorder, and remove tracks before downloading.
- Download all playlist tracks into `<output root>/<playlist name>/`.
- Reuse the existing safety guarantees: HTTPS-only KHInsider sources, safe
  filenames, `.part` streaming, no overwrites, one active transfer, pacing,
  cancellation, and manifest-backed reruns.
- Keep multiple named playlists across app restarts.
- Write an `.m3u8` file in playlist order alongside the downloaded tracks.

## Non-goals (initial release)

- Audio transcoding, tag editing, or embedding artwork.
- Playlist import/export.
- CLI playlist support (GUI only for the first release).
- Choosing a per-playlist destination; playlists use the existing output root.
- Per-track format selection.
- Logged-in or account-based KHInsider features.
- Syncing playlists between machines or with online services.
- Downloading all formats of a track.
- Bypassing site rules; playlist downloads use the same pacing and access
  policies as album downloads.

## Terminology

| Term | Meaning |
| --- | --- |
| Playlist | Named, ordered list of playlist entries stored locally. |
| Entry | One track reference: album URL, track page URL, and display metadata captured when added. |
| Source track identity | Normalized track page URL (`/game-soundtracks/album/<album>/<track>`). Used for duplicate detection and reruns. |
| Playlist folder | Download destination named after the playlist under the selected output root. |

## User Workflows

### 1. Create a playlist

1. User opens the dedicated **Playlists** page from the header/menu (like
   Settings).
2. Selects **New playlist** and enters a name.
3. Name is validated: non-empty after trimming, unique among playlists
   (case-insensitive), and produces a non-empty safe folder name.

### 2. Add tracks while browsing

Both entry points are supported:

- **Embedded website view:** when the current page is a KHInsider track page,
  show **Add track to playlist**. On an album page, offer per-track add (via an
  album preview) rather than scraping arbitrary page UI.
- **Album preview (existing downloader view):** each track row gets an
  **Add to playlist** action, plus **Add selected to playlist**.

Adding a track:

1. Track is added to the **active playlist** in one click. A dropdown next to
   the button switches the active playlist or creates a new one. If no
   playlist exists yet, the user is prompted to create one.
2. Validate the track URL belongs to `downloads.khinsider.com` and matches
   the track path pattern.
3. Capture metadata: album title, album URL, disc number, track number, track
   title, track page URL, and (if already known) available formats.
4. Show a brief confirmation and the new playlist count.

Note: The embedded website view is a sandboxed `WebContentsView` with no
preload. Detection of track pages is done in the main process from the
navigated URL (and, if needed, a parsed fetch of the page HTML), never by
injecting privileged code into remote content.

### 3. Manage a playlist

- View entries with album, disc/track, title, and format availability.
- Reorder by drag-and-drop and move up/down buttons (keyboard accessible).
- Remove entries; clear the playlist; rename; delete (with confirmation).
- Open the source album or track page in the configured browser target.

### 4. Download a playlist

1. Select the playlist and choose **Download playlist**.
2. Choose format policy (reuses existing policies: prefer lossless,
   lossless-only, MP3, specific format) once for the whole playlist.
3. App resolves each track page to discover formats and the audio URL; shows
   unavailable formats before transfer, like the album preview does.
4. Downloads stream into `<output root>/<safe playlist name>/`.
5. Progress shows playlist-level and track-level status; cancel stops the
   active transfer and prevents later tracks from starting.
6. Summary reports completed, skipped (already present), failed, unavailable,
   and canceled tracks.

## Data Model

### Stored playlist (app data)

Stored as JSON in the Electron `userData` directory, e.g.
`~/.config/khinsider-downloader/playlists.json` (not `localStorage`, so the
main process owns validation and file writes).

```jsonc
{
  "schemaVersion": 1,
  "activePlaylistId": "8f6c…",
  "playlists": [
    {
      "id": "8f6c…",                // random UUID, stable across renames
      "name": "Boss Themes",
      "createdAt": "2026-01-01T12:00:00Z",
      "updatedAt": "2026-01-01T12:30:00Z",
      "formatPolicy": "prefer-lossless",   // last policy used for this playlist
      "entries": [
        {
          "id": "b21a…",
          "trackUrl": "https://downloads.khinsider.com/game-soundtracks/album/<album>/<track>",
          "albumUrl": "https://downloads.khinsider.com/game-soundtracks/album/<album>",
          "albumTitle": "Example OST",
          "discNumber": 1,
          "trackNumber": 7,
          "title": "Final Battle",
          "addedAt": "2026-01-01T12:05:00Z"
        }
      ]
    }
  ]
}
```

Writes are atomic (write temp file, then rename). Invalid or newer-schema files
are not overwritten; the app reports the problem and keeps a backup.

### Playlist download manifest

A new manifest type, separate from `AlbumManifest`, saved as
`.download-manifest.json` in the playlist folder:

```jsonc
{
  "schemaVersion": 1,
  "kind": "playlist",
  "playlistId": "8f6c…",
  "playlistName": "Boss Themes",
  "updatedAt": "…",
  "tracks": [
    {
      "trackUrl": "https://downloads.khinsider.com/…",
      "albumUrl": "https://downloads.khinsider.com/…",
      "format": "flac",
      "relativePath": "001 - Example OST - Final Battle.flac",
      "state": "completed",       // pending | downloading | completed | failed | skipped
      "bytes": 12345678,
      "error": null
    }
  ]
}
```

`readManifest` must distinguish album and playlist manifests so an album
download never adopts a playlist folder (and vice versa). Existing album
manifests without `kind` are treated as `"album"`.

## Output Layout

Flat folder, filenames made of playlist position, source album title, and
track title:

```text
~/Music/Khinsider Downloader/Boss Themes/
  001 - Example OST - Final Battle.flac
  002 - Another OST - Last Stand.mp3
  Boss Themes.m3u8
  .download-manifest.json
```

The position prefix is zero-padded to at least three digits and widens for
larger playlists. The `.m3u8` file (UTF-8, relative paths) lists completed
tracks in current playlist order and is rewritten after every run.

Rules regardless of layout:

- Folder and filenames use `safeFileComponent` (invalid characters replaced,
  normalized, truncated to 120 characters). The album and track titles are
  sanitized separately; if the combined name would be too long, the album
  title is shortened first so the track title stays readable.
- Two different tracks with the same resulting filename get a deterministic
  disambiguating suffix based on source track identity; never overwrite.
- Extensions reflect the actual downloaded format.
- Cover artwork is not saved: a mixed playlist has no single cover.

### Playlist folder conflicts

- If the folder does not exist: create it.
- If it contains a playlist manifest with the same `playlistId`: rerun mode
  (skip verified completed tracks, retry failed/pending ones).
- If it exists with no manifest, an album manifest, or a different playlist:
  use a suffixed folder such as `Boss Themes (2)` and tell the user, never
  merging into unrelated content. The chosen folder is remembered for the
  playlist so reruns return to it.

### Edits after download

- **Added tracks:** downloaded on the next run.
- **Removed tracks:** files are left on disk; manifest marks them as no longer
  in the playlist. No automatic deletion.
- **Reordered tracks:** existing files are not renamed by default; new
  position prefixes apply only to new files. Optional "Renumber files" action
  later.
- **Renamed playlist:** if the playlist was downloaded, the app offers to
  rename the existing folder (and the `.m3u8`). Declining keeps downloading
  into the original folder. Renaming never replaces an existing folder.

## Duplicate Handling

- Duplicate detection uses normalized track URL (lowercase host, no trailing
  slash, no query/fragment).
- Adding a track already in the playlist is ignored with an
  "Already in playlist" notice.
- The same track may appear in different playlists.

## Format Selection

One playlist-wide policy is chosen at download time, reusing existing
policies. Tracks lacking a lossless format follow the same fallback rules and
are reported, never silently substituted for lossless-only.

Formats are always re-resolved at download time; audio URLs captured earlier
are never trusted because they may be transient.

## Architecture

| Area | Change |
| --- | --- |
| `src/playlist.ts` *(new)* | Playlist types, validation, normalization, duplicate detection, ordering, store read/write. Pure logic is unit-testable. |
| `src/khinsider.ts` | Add `validateTrackUrl` and a `resolveTrack(trackUrl)` helper that fetches one track page via the inspection browser and returns `DiscoveredTrack`. |
| `src/output.ts` | `PlaylistManifest` type, manifest `kind` discriminator, `preparePlaylistDirectory`, playlist filename helper. |
| `src/downloader.ts` | Extract the shared per-track transfer loop from `downloadAlbum` into a reusable function; add `downloadPlaylist`. Album behavior must remain unchanged. |
| `src/electron/main.ts` | IPC handlers: list/create/rename/delete playlists, add/remove/reorder entries, set active playlist, download/cancel playlist. All inputs validated in main. |
| `src/electron/website-browser.ts` | Report whether the current URL is a track or album page in `website:state`, enabling the **Add to playlist** button. |
| `src/electron/preload.ts`, `src/gui-types.ts` | Narrow typed playlist API. |
| `src/renderer.ts`, `gui/index.html`, `gui/styles.css` | Playlists panel/page, add buttons in album preview and website toolbar, playlist download progress. |

### Security

- Only `https://downloads.khinsider.com` track and album URLs are accepted;
  credentials, other hosts, and non-track paths are rejected in the main
  process.
- The embedded site has no preload and no IPC access; add actions are triggered
  from the app toolbar, not from remote page content.
- Playlist names never become paths without `safeFileComponent`; path
  traversal is impossible by construction and verified by tests.
- Playlist store and imported files are size-limited and schema-validated.

## Testing Plan

- **Unit:** name validation, URL normalization, duplicate detection,
  reorder/remove, store read/write (including corrupt and newer-schema files),
  filename generation and collisions, folder conflict resolution, manifest kind
  discrimination.
- **Downloader:** playlist download with local HTTPS fixtures spanning
  multiple albums; rerun skips completed tracks; failed tracks retried;
  cancellation; lossless-only unavailable reporting; no overwrite of unrelated
  files; album downloads unchanged (existing tests still pass).
- **Electron:** add track from album preview and from embedded website track
  page (fixtures via `protocol.handle` on `khinsider-website`), manage the
  playlist, persistence across app restart, download progress UI.
- **M3U8:** order, relative paths, only completed tracks, rewritten on rerun.

## Implementation Phases

1. **Core model and storage** — `src/playlist.ts`, store, unit tests.
2. **Track resolution and download engine** — `resolveTrack`, shared transfer
   loop refactor, `downloadPlaylist`, playlist manifest, tests.
3. **GUI management** — Playlists panel, create/rename/delete, entries list,
   reorder/remove.
4. **Add-to-playlist entry points** — album preview rows, embedded website
   toolbar.
5. **Playlist download UI** — format policy, preview, progress, summary,
   cancel, rerun.
6. **Docs and polish** — `README.md`, `docs/HELP.md`, `changelog.md`;
   later: CLI, import/export.

## Risks

- **Many track-page requests:** resolving a large playlist hits one track page
  per entry; existing pacing applies and progress must show resolution state.
- **Site changes:** track page URLs or format markup may change; entries keep
  enough metadata to show meaningful errors.
- **Removed tracks/albums:** downloads report them as failed/unavailable
  without stopping the whole playlist (except site-wide denial/rate limits).
- **Refactoring `downloadAlbum`:** shared-loop extraction must not change
  album output or manifests; guarded by existing tests.

## Decisions

| Topic | Decision |
| --- | --- |
| Add entry points | Embedded website track pages and album preview rows. |
| Playlists | Multiple named playlists. |
| Persistence | Persist across restarts; no import/export yet. |
| Add target | One click adds to the active playlist; dropdown switches target. |
| Management UI | Dedicated Playlists page opened from the header/menu. |
| Format | One playlist-wide policy chosen at download time. |
| Layout | Flat folder; `001 - Album - Title.ext`. |
| Duplicates | Ignored with an "Already in playlist" notice. |
| Folder conflict | Use a suffixed folder (`Name (2)`) and tell the user. |
| Edits after download | Keep files; new tracks download on rerun; removed files stay; no auto-renumbering. |
| Playlist rename | Offer to rename the existing folder. |
| Destination | Existing output root setting. |
| Extras | `.m3u8` in playlist order; no cover art. |
| CLI | GUI only for the first release. |
