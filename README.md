# K-Downloader

K-Downloader is a Linux-first KHInsider album downloader. The current slice
implements public single-album discovery, format preview and policy, sequential
streaming, and manifest-backed reruns. Multi-album queues, artwork, the GUI,
optional account features, and packaging are not implemented yet.

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

**More > Restore Size/Position** restores the development default (1120x780)
and centers the window on its current monitor. Window size, position, and
maximized state are saved on close and restored on the next launch, with
off-screen positions corrected if monitor arrangements change.

**More > Changelog** opens a panel from the right. Drag its left edge to adjust
the width up to 40% of the window; the focused resize handle also accepts arrow
keys. Close it with its close button or `Esc`. Content is embedded from the root
`changelog.md` during `npm run build:gui` (also run by `npm run gui`).

Use `Ctrl+=` or `Ctrl++` to enlarge the UI, `Ctrl+-` to reduce it, and `Ctrl+0`
to reset to 100%. `Ctrl+mousewheel` also changes scale. Zoom is limited to
50%-200% and does not change the window's saved geometry.

The GUI uses a context-isolated, sandboxed renderer with a narrow preload API.
It currently supports one album per run; multi-album queues and packaging are
not available yet.

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