# Khinsider Downloader Help

## Getting Started

1. Paste one KHInsider album URL into **Album source**. Use the album page,
   not a track-page URL, media URL, or local folder path.
2. Select **Inspect album** and wait for the format preview.
3. Review available and selected formats for every track, including fallback
   or unavailable tracks. Choose a destination and format policy.
4. Select **Download**. Transfers run one track at a time.
5. Review the album result and destination shown in the transfer footer.

The desktop app requires a graphical Linux session. Public-track downloads
need no site login. Use only audio you are authorized to download and respect
the site's access policy. The current release accepts one album per run.

The **KHInsider** link to the right of the album URL label opens the website
in your default browser, where you can find and copy an album-page URL.

## Album Inspection

Use an HTTPS album URL beginning with
`https://downloads.khinsider.com/game-soundtracks/album/`.

Inspection reads the album's ordered track links, visits the individual track
pages, and discovers each track's audio formats. It does not save album audio.
The preview includes disc number, track number, title, available formats,
selected format, and availability status.

An animated **Inspection in progress** row appears during scanning. The
Chromium inspection browser starts minimized, not headless. Select **Show
browser** or **Hide browser** on that row to toggle its window. Closing the
browser manually interrupts inspection; use **Cancel inspection** instead.

Discovery can take time because pages are visited sequentially with pacing.
If the site denies access or presents a challenge, stop rather than trying to
bypass it. Download stays disabled until discovery and format selection allow it.

## Audio Formats

- **Prefer lossless** selects FLAC first, then ALAC or WAV when offered.
  Without a lossless source it uses MP3 if offered, otherwise another discovered
  source. The preview marks lossy fallback before transfers begin.
- **Lossless only** never substitutes lossy audio. A track without a lossless
  source blocks Download unless **Skip tracks without the selected format**
  is explicitly checked.
- **Specific format** options appear after inspection and reflect discovered
  formats. Selecting one never silently substitutes another format.
- **Skip tracks without the selected format** applies to lossless-only or
  specific-format policies. Any skipped audio makes the album incomplete.

The app saves the original bytes and matching extension. It does not transcode,
rewrite metadata, or turn lossy audio into lossless audio. Formats may differ
between tracks in the same album.

## Destination and Disc Folders

The default root is `~/Music/Khinsider Downloader`. Type another root in **Save album
under** or use the folder-picker button. The app creates an album-title folder
under that root. Select the root, not a pre-created album folder, to avoid
unintentional nesting.

Track names use zero-padded within-disc numbers and sanitized titles, for
example `01 - Intro.mp3`. Multi-disc albums go into separate **CD1**, **CD2**,
and subsequent folders. The **Disc folder label** setting offers **CD** or
**Disc** for multi-disc albums. Single-disc albums keep a flat album folder.

Disc and track numbers are distinct; track numbering can restart on each disc.
Identically titled albums are separated using their source identity where needed.
Changing the root, label, or selected format on a rerun can change the output
paths; existing completed audio is not moved automatically.

## Downloads and Progress

Download uses the inspected plan and selected destination. Tracks transfer
sequentially. The footer reports the active track, completed-track count, album
result, and destination. Long previews scroll inside the panel while the app's
statusbar and transfer footer remain visible.

Files stream to temporary `.part` files rather than being buffered entirely in
memory. The writer checks the response and available length evidence before
publishing the final file without overwriting. Small tracks are allowed; file
size alone is not a quality judgment.

A **complete** result means all selected tracks finished. **Incomplete** means
tracks were explicitly skipped. **Failed** means one or more transfers failed;
inspect the album manifest for recorded per-track errors. **Canceled** means
the run was stopped. An access-denied or rate-limited transfer stops further
track transfers for that album.

## Canceling and Rerunning

During scanning, the cancel button reads **Cancel inspection**. It closes the
inspection browser and stops visiting track pages, including if cancellation
is requested during browser startup. The app reports **Inspection canceled**
and allows a fresh scan. A canceled scan cannot be used to start Download.

During downloading, **Cancel active download** aborts the active transfer and
prevents later tracks from starting. Closing the app also cancels active work.
Completed files stay in place; a canceled partial transfer is not marked complete.

Each album folder has `.download-manifest.json`, which records its source,
selected formats, relative paths, states, and completed byte lengths. Inspect
the same album and download again with the same output choices to retry missing
or failed tracks. Completed files are skipped only when manifest evidence and
their current sizes match. Existing unverified files are conflicts, not trusted
downloads, and are not overwritten.

Interrupted tracks restart from the beginning; byte-range continuation is not
implemented. There is no automatic general retry/backoff workflow yet. Keep the
manifest with the audio files for reruns.

## Settings and Appearance

Open **More > Settings** or press **Ctrl+,**. Its left rail offers **Appearance**
and **Shortcuts**. Switching pages preserves the Appearance controls and choices.
Use **Back to downloader** or **Esc** to return.

- **Light** uses light surfaces; **Dark** uses dark surfaces.
- **System** follows the desktop preference. On Cinnamon it follows the GTK
  theme, such as Mint-Y versus Mint-Y-Dark; other desktops use Electron's native
  appearance notifications.
- **Mint**, **Ocean**, **Amber**, **Rose**, and **Monochrome** each support
  light and dark palettes. Mint Dark matches the app's original green look.

System + Mint is the default. Choices apply immediately and are saved locally
across restarts. If saving is unavailable, an appearance warning explains that
the changes apply only to the session. The taskbar icon retains the Mint K brand
mark independently of the selected color theme.

## Keyboard Shortcuts

The **Settings > Shortcuts** page provides a grouped reference with keycaps.

- **Ctrl+,** opens or closes Settings.
- **Esc** closes the active More menu first, then an open Help/Changelog panel,
  or Settings. Closing a drawer leaves the underlying Settings page intact.
- **Ctrl+=** or **Ctrl++** enlarges the interface.
- **Ctrl+-** reduces the interface.
- **Ctrl+0** resets scale to 100%.
- **Ctrl+mousewheel** adjusts scale. The range is 50%-200%; zoom does not change
  the saved window geometry.
- With a drawer's resize handle focused: **Left Arrow** widens it, **Right
  Arrow** narrows it, **Home** selects the minimum width, and **End** selects 40%.

Standard Tab/Shift+Tab move focus between controls. Press Enter or Space on a
help section heading to expand or collapse it.

## Window Controls and More Menu

The custom titlebar contains the app mark/title, More menu, and minimize,
maximize/restore, and close buttons. Drag the titlebar background to move the app.
Window size, position, and maximized state are saved on close and restored at
the next launch; off-screen positions are corrected if monitors change.

**More > Restore Size/Position** returns to 1120x780 and centers on the current
monitor (or fits the monitor if its work area is smaller). It also exits
maximized state. Settings navigation does not alter the window geometry.

The More menu also includes Settings, Changelog, Help, Report an Issue, and an informational
app title/version footer. The version is read from the manifest during build.
Only one desktop instance runs per application profile: another launch exits,
restores the running window, and shows **Show running app** in its confirmation.

## Help and Changelog Panels

Select **More > Help** for this guide, or **More > Changelog** for development
changes. Both panels slide from the right and leave the current workspace or
Settings view intact. Opening one closes the other.

Drag the panel's left edge to resize, up to 40% of the window width. The handle
also supports the keyboard shortcuts listed above. Content scrolls independently
of the header. Use the panel's Close button or **Esc** to dismiss it.

Help section headings expand or collapse their content. **Expand all** and
**Collapse all** affect every help section. Content is local and embedded at
build time; no network request is needed to read either panel.

## Command-Line Interface

From an installed source checkout with dependencies and Playwright Chromium:

```sh
npm run inspect -- 'https://downloads.khinsider.com/game-soundtracks/album/ALBUM'
npm run download -- 'https://downloads.khinsider.com/game-soundtracks/album/ALBUM'
```

Replace `ALBUM` with the album slug. `inspect` previews discovered formats and
downloads no audio. `download` prints its format plan before transferring audio.

Download options:

- `--format prefer-lossless` (default), `--format lossless-only`, or an explicit
  format such as `--format MP3`.
- `--skip-unavailable` explicitly skips missing formats for lossless-only or a
  specific format; it is not valid with prefer-lossless.
- `--output /path/to/music` selects the output root.
- `--disc-label CD` (default) or `--disc-label Disc` selects multi-disc labels.

CLI failures, incomplete albums, and canceled results have nonzero exit status.
The current discovery CLI also requires a graphical session because Chromium
runs visibly, starting minimized. Login and multiple-album input are not supported.

## Reporting Issues

Select **More > Report an Issue** to open GitHub's issue chooser in your default
browser. Choose **Bug Report** for a problem or **Feature Request** for an
improvement. A GitHub account is required. Search existing issues before submitting.

For bugs, include the version shown at the bottom of the More menu, Linux
distribution/version, reproduction steps, expected behavior, and what actually
happened. Screenshots and relevant sanitized logs are optional.

Do not post passwords, session cookies, tokens, signed download URLs, private
paths, or other sensitive information. The app does not collect or upload logs
automatically. Reports may be publicly visible. If the browser cannot open, the
app shows the GitHub URL so you can visit it manually.

## Troubleshooting and Current Limits

- **Invalid URL:** paste an HTTPS KHInsider album-page URL, not a media link
  or filesystem path.
- **HTTP 403 / access challenge:** stop and review permitted access. Plain Node
  fetch and headless Chromium were denied during feasibility testing; the app
  uses a normal visible Chromium context instead. It does not bypass challenges.
- **HTTP 429:** the server is rate limiting. Respect its limits and wait before
  manually retrying; do not start repeated scans to force access.
- **Missing browser/runtime:** install dependencies and Playwright Chromium as
  described in the repository README. Keep Electron's normal sandbox enabled.
- **Permission or disk-full errors:** select a writable root and check free
  space, then inspect and rerun after fixing the destination.
- **File conflict:** retain existing audio; check the source, format, paths,
  and manifest rather than deleting or overwriting unrelated files.
- **System mode not changing:** select System in Appearance. Cinnamon follows
  its GTK theme, not every desktop accent/wallpaper setting.

The current implementation is Linux-first and single-album. Linux x64 AppImage
and .deb builds include Electron and Chromium. The installed launcher supports
`khinsider-downloader inspect`, `khinsider-downloader download`, and `khinsider-downloader --help`.
Distribution compatibility still requires target-machine testing.
Multi-album queues, cover artwork, login/bulk downloads, .rpm/ARM packaging,
automatic updates, tagging, transcoding, and player integration are not
implemented. Build/release instructions are in the project's docs.