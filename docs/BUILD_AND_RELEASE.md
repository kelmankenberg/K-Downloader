# Build and GitHub Release Guide

Run the commands below from the repository root. This guide describes the
current implementation, not the planned installer packaging.

## What Can Be Released Today

The project supports a source-only GitHub release. GitHub provides source ZIP
and tar archives automatically for its release tag. Users must install Node.js,
npm dependencies, and Playwright Chromium before running the app.

AppImage, Debian `.deb`, and Fedora `.rpm` packaging are not configured yet.
There is no installer-building command or automated GitHub release workflow.
Do not describe a source release as an installable Linux application package.

The generated `dist/` directory contains Electron main/preload bundles and the
local renderer assets. It is **not a standalone application**: it still depends
on Electron, external Node packages, and Playwright's browser runtime. Uploading
only `dist/` does not provide a runnable installer.

## Prerequisites

- Linux with a graphical desktop session for GUI and Electron tests.
- Node.js 22 (22.12 or later), Node.js 24, or Node.js 26 or later, as required by
  the installed Electron and Vitest toolchain. An older system Node may fail
  even if it satisfies the application's declared Node.js 20 minimum.
- npm, Git, and access to the target GitHub repository.
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
- `npm audit` reports dependency advisories. Review and resolve release-blocking
  issues; do not blindly apply a forced dependency upgrade.

Launch the app for a manual smoke check:

```sh
npm run gui
```

Check startup/close, Settings navigation and appearance, keyboard shortcuts,
changelog resizing, window restore, and saved geometry. Only test site discovery
or real audio transfers when authorized; they are not required for building.

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
4. Repeat the build/test checks after the version and changelog updates.
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
and prominently state **source-only release; no Linux installers included**.

## Publish and Verify

Open the draft, review its tag, notes, and release type, then publish:

```sh
gh release view "$TAG" --repo kelmankenberg/K-Downloader --web
gh release edit "$TAG" --repo kelmankenberg/K-Downloader --draft=false
gh release view "$TAG" --repo kelmankenberg/K-Downloader
```

On the GitHub website, the equivalent is **Releases > Draft a new release**:
select the pushed tag, enter the title/notes, save as draft, review, and publish.

After publication, verify the source archives are available and correspond to
the selected tag. Test setup from that tag in a clean directory, using `npm ci`
and the browser installation step above. Do not assume a successful development
build proves installer compatibility.

## When Installer Packaging Is Added

Before uploading AppImage, `.deb`, or `.rpm` assets, define supported Linux
versions/architectures and implement a packaging workflow. It must include
runtime dependencies, browser provisioning, desktop integration, CLI invocation,
and normal sandbox support. Test the actual artifacts on the declared targets.

Only then attach validated installers and checksums to a draft, using actual
artifact paths, for example `gh release upload "$TAG" <artifact-paths>` with
the same `--repo` option. Do not upload unrelated build output or claim installer
support until those packaging and compatibility checks pass.