# K-Downloader

K-Downloader is a Linux-first KHInsider album downloader. The current slice
implements public single-album discovery, format preview and policy, sequential
streaming, manifest-backed reruns, an Electron GUI, and Linux x64 AppImage/.deb
packaging. Multi-album queues, artwork, and optional account features are not
implemented yet.

## Discovery check

Requirements: Node.js 20 or newer, npm, and a graphical desktop session.

```sh
npm install
npx playwright install chromium
npm run inspect -- 'https://downloads.khinsider.com/game-soundtracks/album/unreal-ii-the-awakening-original-soundtrack'
```

The command opens a fresh visible Chromium context without a stored browser
profile, visits the album and track pages sequentially, and prints every
track's discovered format selection. It does not sign in or download audio.
Visible mode is currently needed: plain Node fetch and headless Chromium
received HTTP 403 during feasibility checks, while a fresh visible Chromium
context succeeded. No attempt is made to imitate a browser or evade a challenge.
If access is denied or a challenge appears, stop and review the site's permitted
access methods.

## Download One Album

The CLI previews the selected formats before starting any transfer. The default
format policy prefers lossless, falling back to MP3 when needed. The default
destination is `~/Music/K-Downloader`.

```sh
npm run download -- 'https://downloads.khinsider.com/game-soundtracks/album/unreal-ii-the-awakening-original-soundtrack'
```

Use `--format lossless-only` to block when a track has no lossless source. Add
`--skip-unavailable` to explicitly skip those tracks and mark the album
incomplete. A specific format such as `--format MP3` never silently substitutes
another format. Use `--output /path/to/music` for another destination.

Multi-disc albums are saved into per-disc folders such as `CD1/` and `CD2/`.
The GUI offers `CD` and `Disc` folder labels; the CLI accepts
`--disc-label CD` or `--disc-label Disc` and defaults to `CD`. Single-disc
albums keep the flat album folder.

Files are streamed through temporary `.part` files, validated, and moved into
place without overwriting. A per-album manifest records completion so verified
files can be skipped on rerun. Transfers are covered by local mocked tests; an
authorized live audio download has not yet been run.

## Desktop GUI

Requirements: Node.js 20 or newer, npm, and a graphical Linux session.

```sh
npm install
npx playwright install chromium
npm run gui
```

Only one desktop instance runs per application profile. A second launch exits,
restores the existing window if minimized, and shows an already-running
confirmation with **Show running app** to focus that window.

Paste one album URL and choose **Inspect album**. A Chromium inspection window
starts minimized while an in-progress indicator appears in the app; click that
indicator to show or hide the browser. Review the per-track format preview, choose the
destination and format policy, then select **Download**. The default destination
is `~/Music/K-Downloader`. **Cancel active download** stops the current transfer
and prevents later tracks from starting.

While inspection is running, the same button becomes **Cancel inspection**.
It closes the inspection browser and stops scanning track pages, including
during browser startup. A canceled inspection can be started again.

Open **More > Settings** in the titlebar or press `Ctrl+,`. Under **Appearance**,
select Light, Dark, or System mode and a Mint, Ocean, Amber, Rose, or Monochrome
color theme. System follows desktop appearance changes; System + Mint is the
default. Choices apply immediately and are saved locally across restarts.
On Cinnamon, System mode follows the GTK theme (for example, Mint-Y versus
Mint-Y-Dark); other desktops use Electron's native appearance notifications.
Return with **Back to downloader** or press `Esc`.
Settings has its own left navigation rail. **Appearance** retains the mode and
theme controls; **Shortcuts** lists navigation, zoom, and changelog-resize
commands with their key combinations. Switching pages preserves selections.

**More > Restore Size/Position** restores the development default (1120x780)
and centers the window on its current monitor. Window size, position, and
maximized state are saved on close and restored on the next launch, with
off-screen positions corrected if monitor arrangements change.

**More > Changelog** opens a panel from the right. Drag its left edge to adjust
the width up to 40% of the window; the focused resize handle also accepts arrow
keys. Close it with its close button or `Esc`. Content is embedded from the root
`changelog.md` during `npm run build:gui` (also run by `npm run gui`).

**More > Help**, directly below Changelog, opens a matching right-side panel.
Expand or collapse individual help sections, or use **Expand all** and
**Collapse all**. It covers the GUI, CLI, formats, disc folders, cancellation,
reruns, Settings, shortcuts, window controls, and troubleshooting. Resize its
left edge up to 40%, and close with its button or `Esc`. Opening Help closes
Changelog, and vice versa. Help is embedded from [docs/HELP.md](docs/HELP.md)
during the GUI build and is available offline.

Use `Ctrl+=` or `Ctrl++` to enlarge the UI, `Ctrl+-` to reduce it, and `Ctrl+0`
to reset to 100%. `Ctrl+mousewheel` also changes scale. Zoom is limited to
50%-200% and does not change the window's saved geometry.

The GUI uses a context-isolated, sandboxed renderer with a narrow preload API.
It currently supports one album per run; multi-album queues are not available yet.

## Linux Packages

On a Linux x64 build host with dependencies installed:

```sh
npm run package:linux
npm run test:packages
```

The first command creates `.deb`, AppImage, Arch `.pkg.tar.xz`, and SHA-256 checksum files under
`release/`, with Electron and Chromium included. To build separately, use
`npm run package:deb`, `npm run package:appimage`, or `npm run package:arch`; `npm run package:dir` creates
an unpacked application. Recipients do not need npm or a separate Node runtime.
The packaged `k-downloader` launcher supports `inspect`, `download`, and `--help`.
Arch builds/tests require `bsdtar`. Select smoke-test targets with
`npm run test:packages -- pacman` (or `deb AppImage`). After building Arch,
`npm run package:aur` generates a checksum-pinned `k-downloader-bin` AUR recipe
under `release/aur/`; it does not submit to AUR. Arch/Omarchy desktop validation
and distribution-license review are required before claiming support publicly.

See [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md) for maintainer metadata,
build prerequisites, installation/testing caveats, and GitHub release commands.
Artifacts are smoke-tested on the build host, not certified across all Linux
versions. Packaging does not automatically publish a GitHub release.

## Issue Reporting

Use **More > Report an Issue** to open the repository's GitHub issue chooser
in your default browser. Choose **Bug Report** or **Feature Request**; a GitHub
account is required. Include the app version from the More menu and relevant
details. The app never uploads logs automatically. Remove credentials, cookies,
tokens, signed media URLs, and private paths before submitting or attaching files.

Repository administrators can follow [docs/GITHUB_ISSUES_SETUP.md](docs/GITHUB_ISSUES_SETUP.md)
to enable Issues and activate the supplied templates on the default branch.

## Development

```sh
npm test
npm run build
npm audit
```

Tests build the GUI first and use the installed Playwright Chromium and Electron
for local appearance checks. The Electron checks require a graphical session
and use an isolated profile. No desktop settings, site requests, or audio
transfers are changed or made by those tests.