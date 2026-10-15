# Khinsider Downloader Rebrand Status

## Scope

The application, source files, build configuration, active documentation, and
tests have been rebranded as **Khinsider Downloader**. This report records the
scope completed and the remaining actions that require access outside the
source tree.

The visible product name is `Khinsider Downloader`. Machine-facing slugs use
`khinsider-downloader`; release archives use `Khinsider-Downloader` to avoid
spaces in filenames and URLs.

## Proposed Naming Map

Use one canonical spelling for the product, and stable lowercase slugs for
commands and technical identifiers. Confirm these conventions before changing
published package or repository identities.

| Surface | Proposed value |
| --- | --- |
| Product/display name | `Khinsider Downloader` |
| npm/package and Linux package slug | `khinsider-downloader` |
| CLI and executable | `khinsider-downloader` |
| Linux desktop file | `khinsider-downloader.desktop` |
| Chromium environment-variable prefix | `KHINSIDER_DOWNLOADER_` |
| GUI preload API | `khinsiderDownloader` / `KhinsiderDownloaderApi` |
| Icon asset | `assets/khinsider-downloader.png` |
| Default output directory | `~/Music/Khinsider Downloader` |
| Electron application ID | `com.kelmankenberg.khinsiderdownloader` |
| GitHub repository URL | `https://github.com/kelmankenberg/Khinsider-Downloader` (the hosted rename is still external) |

The package name, Linux package name, executable, desktop file, AUR package,
Electron application ID, and display name are related but not interchangeable.
These identities are now set independently in their owning configuration and
scripts.

## Change Inventory

### Product UI and Runtime

- Update the window title, GUI title/menu branding, duplicate-instance dialog,
  CLI error text, and issue-reporting URL in [gui/index.html](../gui/index.html),
  [src/electron/main.ts](../src/electron/main.ts), and [src/cli.ts](../src/cli.ts).
- Review and regenerate the application icon, then rename its source asset and
  update references in [electron-builder.config.cjs](../electron-builder.config.cjs),
  [scripts/build-gui.mjs](../scripts/build-gui.mjs), and
  [scripts/generate-icon.mjs](../scripts/generate-icon.mjs). Renaming the PNG
  alone does not update the artwork.
- Rename the preload bridge property and type (`window.khinsiderDownloader`,
  `KhinsiderDownloaderApi`) consistently in [src/gui-types.ts](../src/gui-types.ts),
  [src/electron/preload.ts](../src/electron/preload.ts),
  [src/renderer.ts](../src/renderer.ts), and their tests. This is an internal
  contract, but inconsistent names would leave old branding in source.

### Package, CLI, and Linux Integration

- Update `name`, `desktopName`, homepage, and other package metadata in
  [package.json](../package.json), then regenerate [package-lock.json](../package-lock.json)
  with npm rather than editing the lockfile by hand.
- Update `productName`, `appId`, executable, desktop entry/WM class, icon path,
  artifact names, native package names, and launcher renaming in
  [electron-builder.config.cjs](../electron-builder.config.cjs).
- Update CLI command examples and Chromium/maintainer/contact environment
  variables in [src/cli.ts](../src/cli.ts), [src/khinsider.ts](../src/khinsider.ts),
  [scripts/linux-launcher.sh](../scripts/linux-launcher.sh),
  [scripts/package-linux.mjs](../scripts/package-linux.mjs), and
  [scripts/verify-khinsider-access.mjs](../scripts/verify-khinsider-access.mjs).
  Consider accepting old environment-variable names as deprecated aliases for
  one transition period so existing scripts keep working.
- Update generated AUR identifiers, paths, archive names, symlinks, metadata,
  and package smoke-test expectations in [scripts/generate-aur.mjs](../scripts/generate-aur.mjs)
  and [scripts/test-packages.mjs](../scripts/test-packages.mjs).
- Update corresponding config assertions, output examples, fixture/temp names,
  app-link expectations, and smoke tests under `tests/`, especially
  [tests/packaging.test.ts](../tests/packaging.test.ts). Keep test-generated
  temporary names consistent, but prioritize assertions of actual shipped
  identity and behavior.

### Existing User Data

- The default output is now `~/Music/Khinsider Downloader`. Existing downloaded
  files were not moved or renamed; users can still select their previous folder.
- Appearance preferences use the newly branded storage key. The existing key is
  not migrated, so saved appearance preferences may reset once.
- Electron's new application name/ID can create a new settings/profile location;
  old window geometry and Chromium profile data are not migrated. Confirm this
  behavior on installed package upgrades before public release.
- Linux package names, the desktop entry, AUR recipe name, and CLI command now
  use the new slug. Existing installations may require removing the previous
  package/launcher, and scripts using the former CLI or environment-variable
  names need updating. No compatibility aliases are retained.

### Documentation and Project Metadata

- Rebrand active product descriptions, screenshots/icon references, default
  paths, commands, install/remove steps, release filenames, and release commands
  in [README.md](../README.md), [docs/HELP.md](HELP.md),
  [docs/BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md),
  [docs/GITHUB_ISSUES_SETUP.md](GITHUB_ISSUES_SETUP.md), and
  [.github/ISSUE_TEMPLATE/bug_report.yml](../.github/ISSUE_TEMPLATE/bug_report.yml)
  / [feature_request.yml](../.github/ISSUE_TEMPLATE/feature_request.yml).
- Update the product name and examples in [docs/PROJECT_PLAN.md](PROJECT_PLAN.md),
  including its historical “confirmed requirements” wording, so it does not
  specify the old name or old default output path.
- Review [changelog.md](../changelog.md): use the new name for current/future
  entries; preserve the historical wording of past releases unless the project
  explicitly requires a historical rewrite.
- Update copyright-independent project metadata, repository badges/links, and
  issue URLs wherever they point to the old GitHub repository.

### Filesystem, Repository, and Archives

- Rename the workspace/repository directory from `Khinsider Downloader` if the local
  folder name is part of the requirement. Update the GitHub repository name
  separately and revise clone URLs, issue links, release commands, and any
  automation that uses the old path or slug.
- Rename `assets/khinsider-downloader.png` and any other brand-named tracked files.
  Search all tracked files and directory names after implementation, including
  case and separator variants.
- Archived `.specstory/history/` records were updated where they were part of
  the workspace files. Git commit history naturally retains past names and was
  not rewritten.
- Check for generated artifacts and ignored build/package outputs that still
  contain old filenames. Regenerate or remove only known generated outputs;
  do not hand-edit release artifacts.

## Remaining Actions

1. Completed: the local workspace directory is now `Khinsider-Downloader`.
2. Rename the hosted GitHub repository to `Khinsider-Downloader` and verify the
  new URLs. The source currently points to that destination, which will not
  resolve until the hosted rename is completed.
3. Decide whether to add a one-time migration for existing Electron settings and
  appearance preferences before publishing an upgrade.
4. Test package installation, upgrade, and removal on supported Linux targets.

## Acceptance Checks

- No previous product-name variants remain in active source, tests, build
  configuration, package metadata, user-facing docs, issue templates, or release
  scripts. Git history is unchanged.
- The GUI, CLI help/errors, Linux desktop entry, executable, package metadata,
  artifact names, icon, and repository/issue links consistently identify
  Khinsider Downloader.
- Fresh installs use `~/Music/Khinsider Downloader`; existing download files are
  left untouched. Existing preferences/profile data are not migrated yet.
- The focused packaging suite passes. Full-suite validation still has Electron
  desktop test failures involving screenshot timeouts, window geometry, and
  single-instance behavior on this host; rerun on a supported desktop session.
- A final case-insensitive search of tracked paths and file contents is reviewed.
  Archived logs and Git history are reported separately according to the policy
  chosen above.