# Build and GitHub Release Guide

Run the commands below from the repository root. This guide describes the
current Linux packaging and release workflow.

## What Can Be Released Today

The project builds Linux x64 AppImage and Debian `.deb` artifacts, with Electron,
production dependencies, Chromium, a desktop icon, and CLI support included.
Recipients do not need npm or a separate Node.js/Playwright installation.
Linux shared libraries and a graphical session are still required for discovery.

Fedora `.rpm` and ARM packaging are not configured. Builds and extracted-artifact
smoke tests have been verified on the development host; installed-package behavior
and compatibility across distribution versions still require target-machine tests.
The Chromium build is Playwright's Ubuntu 24.04 x64 fallback on this host.
Do not claim certification for all Debian/Ubuntu versions based on package format.

The generated `dist/` directory contains Electron main/preload bundles and the
local renderer assets. It is **not a standalone application**: it still depends
on Electron, external Node packages, and Playwright's browser runtime. Uploading
only `dist/` does not provide a runnable installer.

## Prerequisites

- Linux x64 with a graphical desktop session for packaging and smoke tests.
- Node.js 22 (22.12 or later), Node.js 24, or Node.js 26 or later, as required by
  the installed Electron and Vitest toolchain. An older system Node may fail
  even if it satisfies the application's declared Node.js 20 minimum.
- npm, Git, and access to the target GitHub repository.
- `dpkg-deb` for extracted Debian package smoke tests.
- GitHub CLI (`gh`) for the command-line release steps, or the GitHub website.

Check the environment:

```sh
node --version
npm --version
git --version
gh --version
gh auth status
```

If GitHub authentication is missing, run `gh auth login` and complete its browser
or terminal flow directly. Never put passwords or tokens in commit messages,
release notes, command arguments, or project files.

## Install and Build

Install the exact locked dependencies and the discovery browser:

```sh
npm ci
npx playwright install chromium
```

Allow required package installation scripts according to your npm installation
policy. Electron must have its platform binary installed before its tests or
GUI can launch. A missing native library is a host setup issue; follow the
runtime's supported dependency instructions rather than disabling its sandbox.

Validate and generate the GUI:

```sh
npm test
npm run build
npm run build:gui
npm audit
```

- `npm test` first builds the GUI, then runs unit, Chromium, and isolated
  Electron regression tests. Tests make no live site requests or audio downloads.
- `npm run build` performs a TypeScript check only; it does not emit an installer.
- `npm run build:gui` recreates `dist/`, bundles the Electron and renderer code,
  and copies the local HTML/CSS assets.
- The GUI build embeds the root [changelog.md](../changelog.md) and the version
  from [package.json](../package.json). Rebuild after changing either file.
- Help content is embedded from [HELP.md](HELP.md). Its level-two headings
  become expandable sections in the Help drawer. Rebuild after editing it.
- The build copies [assets/k-downloader.png](../assets/k-downloader.png) into
  `dist/assets/`; Electron uses it as the window/taskbar icon. Regenerate the
  source icon with `node scripts/generate-icon.mjs` if the brand mark changes.
- `npm audit` reports dependency advisories. Review and resolve release-blocking
  issues; do not blindly apply a forced dependency upgrade.

Launch the app for a manual smoke check:

```sh
npm run gui
```

Check startup/close, Settings navigation and appearance, keyboard shortcuts,
changelog resizing, window restore, and saved geometry. Only test site discovery
or real audio transfers when authorized; they are not required for building.

## Build Installers

Build both formats:

```sh
npm run package:linux
```

Or choose one output:

```sh
npm run package:deb
npm run package:appimage
npm run package:dir
```

The scripts type-check and rebuild the app, install the pinned Playwright
Chromium into `.packaging/browser-cache/`, stage it outside `app.asar`, and run
electron-builder. Browser and builder tools may be downloaded on the first run.
`.packaging/` and `release/` are ignored build output, not source files to commit.

For version 0.1.0, outputs are:

```text
release/K-Downloader-0.1.0-amd64.deb
release/K-Downloader-0.1.0-x86_64.AppImage
release/K-Downloader-0.1.0-SHA256SUMS.txt
release/linux-unpacked/
```

Versioned filenames follow package.json. A single-target command writes checksums
for its produced artifact; `package:linux` writes checksums for both formats.
Nothing is uploaded or released automatically.

Debian requires maintainer metadata. The script uses Git's configured user.name
and user.email by default. These become public package metadata; review them
before distributing. Override them explicitly with a real maintainer identity:

```sh
K_DOWNLOADER_MAINTAINER='Your Name <your-real-email@example.org>' npm run package:linux
```

Replace the example with your chosen identity. The manifest currently declares
`UNLICENSED`; choose an appropriate distribution license before a public release
if you intend to grant redistribution rights. Packaging does not choose a license
or change existing copyright ownership for you.

## Test the Artifacts

```sh
npm run test:packages
cd release
sha256sum -c K-Downloader-0.1.0-SHA256SUMS.txt
```

Adjust the checksum filename for the release version. Run from the repository
root again for subsequent build commands. `test:packages` extracts both current
artifacts to temporary directories and verifies packaged GUI/Help, Chromium,
and CLI help without display variables. It makes no site requests, does not
install system-wide, and cleans its temporary files. It requires a desktop
session for the GUI portion. No sandbox-disabling flags are added.

On a disposable target machine, also test real Debian installation/removal,
desktop-launcher behavior, download destinations, and authorized discovery.
Installing a `.deb` requires system privileges; do that manually, not as part
of these automated smoke tests.

For AppImage, mark it executable and launch it:

```sh
chmod +x release/K-Downloader-0.1.0-x86_64.AppImage
./release/K-Downloader-0.1.0-x86_64.AppImage
```

If the host cannot mount AppImages via FUSE, extraction mode is available:

```sh
./release/K-Downloader-0.1.0-x86_64.AppImage --appimage-extract-and-run
```

The installed Debian launcher is `k-downloader`. The packaged CLI uses Electron's
embedded Node runtime without opening the GUI:

```sh
k-downloader --help
k-downloader inspect 'https://downloads.khinsider.com/game-soundtracks/album/ALBUM'
k-downloader download 'https://downloads.khinsider.com/game-soundtracks/album/ALBUM'
```

An AppImage accepts the same CLI arguments. Help needs no display; inspection
and download discovery still require a graphical session.

## Prepare the Release Commit

1. Check `git status` and review the intended diff. Exclude local settings,
   session history, secrets, downloaded music, and generated dependencies/assets.
   Use explicit file paths when staging; do not automatically stage everything.
2. Decide the release version. The current app version is `0.1.0`; the first
   release can use that version. For a subsequent release, update the root
   manifest and lockfile without creating a tag automatically, for example:

   ```sh
   npm version 0.1.1 --no-git-tag-version
   ```

3. Replace the changelog's `Unreleased` heading for the released entries with
   the selected version and release date, and leave a new `Unreleased` section
   above it for future work. Keep the release notes accurate about unfinished
   features and the graphical-session/browser requirements.
4. Repeat the build/test checks and rebuild/test artifacts after version and
  changelog updates. Release binaries must match the tagged source commit.
5. Stage only intended release files, review, and commit. For example, when
   these are the only changed release files:

   ```sh
   git add package.json package-lock.json changelog.md
   git diff --cached
   git diff --cached --check
   git commit -m "chore: prepare release"
   git push origin main
   ```

If `main` is protected, use the repository's pull-request workflow instead.
Create the tag from the final merged, validated commit, not an unmerged branch.
The application is marked `private` in its manifest; this workflow publishes to
GitHub, not npm.

## Tag and Create a Draft Release

Ensure the selected commit and version are ready, and the tag does not already
exist. The commands below derive the tag from the app's manifest:

```sh
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
git status
git ls-remote --tags origin "refs/tags/$TAG"
```

Stop if the remote tag already exists. Also stop if a local tag with that name
exists (`git tag --list "$TAG"`); inspect it rather than moving or overwriting it.

Create and push the annotated tag:

```sh
git tag -a "$TAG" -m "K-Downloader $VERSION"
git push origin "$TAG"
```

Create a draft using the verified remote tag and the changelog as the initial
notes source:

```sh
gh release create "$TAG" \
  --repo kelmankenberg/K-Downloader \
  --verify-tag \
  --draft \
  --title "K-Downloader $VERSION" \
  --notes-file changelog.md
```

For experimental versions, also pass `--prerelease`. Review the draft notes:
`--notes-file` includes the whole changelog, so trim older entries in the draft
and identify the actual Linux architectures and distributions tested. Attach
the validated artifacts and checksum file to the draft before publication:

```sh
gh release upload "$TAG" \
  "release/K-Downloader-$VERSION-amd64.deb" \
  "release/K-Downloader-$VERSION-x86_64.AppImage" \
  "release/K-Downloader-$VERSION-SHA256SUMS.txt" \
  --repo kelmankenberg/K-Downloader
```

## Publish and Verify

Open the draft, review its tag, notes, and release type, then publish:

```sh
gh release view "$TAG" --repo kelmankenberg/K-Downloader --web
gh release edit "$TAG" --repo kelmankenberg/K-Downloader --draft=false
gh release view "$TAG" --repo kelmankenberg/K-Downloader
```

On the GitHub website, the equivalent is **Releases > Draft a new release**:
select the pushed tag, enter the title/notes, save as draft, review, and publish.

After publication, verify installer assets, checksums, and source archives are
available and correspond to the selected tag. Download and verify the artifacts
on each supported target. Do not assume development launch or extraction-only
smoke testing proves installed-package compatibility.

## Packaging Scope

Linux x64 AppImage and `.deb` generation are implemented. Multi-distribution
certification, ARM builds, `.rpm`, automatic updates, signing, and automated
release publishing remain separate work. Do not upload builder debug files,
unpacked directories, browser caches, or unrelated build output as installers.