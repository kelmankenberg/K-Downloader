# Changelog

## Unreleased

### Added

- Linux x64 Arch pacman packaging, target-selectable artifact smoke tests, and
	checksum-pinned AUR binary-recipe generation for manual submission.
- KHInsider website link beside the album URL label, opening in the default browser.
- Browsing settings with a saved choice between the default system browser and
  opening KHInsider inside the existing app window.
- Dedicated internal KHInsider page with Back, Forward, Reload, Home, and
  Back to downloader controls; Use this album fills the downloader's album URL.
- Isolated temporary internal website session with blocked off-site navigation,
  pop-up windows, permissions, and direct website downloads, plus visible load errors.
- Linux x64 AppImage and .deb packaging scripts with bundled Electron/Chromium,
  desktop integration, embedded-Node CLI launchers, checksums, and artifact smoke tests.
- Separate package:linux, package:deb, package:appimage, and package:dir commands.
- Report an Issue menu command opening the fixed GitHub issue chooser in the
	default browser, with a manual-link fallback if the browser cannot launch.
- GitHub bug-report and feature-request forms with required details and privacy
	acknowledgments, plus repository setup instructions.
- Right-side Help panel under Changelog in the More menu, with expandable
	feature guidance, bulk expand/collapse controls, resizing, and Escape support.
- Offline Help content embedded from docs/HELP.md during GUI builds.
- Mint K app icon matching the titlebar, included in the GUI build and used for
	the Electron window/taskbar icon.
- Single-instance desktop lock with an already-running confirmation and
	restoration/focus of the existing window on another launch.
- Settings left navigation rail with Appearance and Shortcuts pages.
- Grouped shortcut reference with keycaps for navigation, interface zoom,
  and focused changelog-panel resizing.
- Public KHInsider album discovery and sequential audio downloads.
- CLI and desktop GUI with format previews and lossless selection policies.
- Multi-disc output folders with CD and Disc labels.
- Manifest-backed reruns and safe, non-overwriting file transfers.
- Cancel inspection during browser startup, navigation, or track scanning;
	close the inspection browser and allow a fresh scan without an error.
- Single animated inspection indicator with a browser visibility toggle.
- Custom titlebar and More menu.
- Settings with Light, Dark, and System appearance modes.
- Mint, Ocean, Amber, Rose, and Monochrome color themes.
- Cinnamon desktop appearance updates.
- Persistent window size, position, and maximized state, with off-screen recovery
	when monitor arrangements change.
- Restore Size/Position command resets to 1120x780 and centers on the current monitor.
- Right-side changelog drawer with drag and keyboard resizing up to 40% of the
	window width, a close button, and Escape support.
- Build-time changelog loading from the root changelog.md with sanitized Markdown rendering.
- App title and version in the More menu, with the version read from package.json at build time.
- Ctrl+0, Ctrl+minus, Ctrl+plus/equal, and Ctrl+mousewheel zoom controls, limited
	to 50%-200% without changing saved window geometry.

### Changed

- Desktop album inspection uses an isolated, non-headless Electron browser that
  starts hidden. Show browser displays it, and Hide browser hides it again
  without interrupting scanning; completion or cancellation closes it.
- Internal website browsing preserves the download setup, preview, and active
  transfer, resumes the current page when reopened, and remains separate from
  album inspection. CLI inspection behavior is unchanged.
- Appearance controls retain their layout and selections when switching Settings pages.
- Settings content scrolls independently of its navigation rail, header, and statusbar.
- More menu order: Restore Size/Position, Settings, Changelog, Help, Report an Issue,
  separator, app title/version.
- Long Discovery Preview lists scroll inside the panel instead of expanding the app.
- Setup and Settings content scroll independently while the bottom statusbar remains visible.

### Fixed

- Inspection browser appearing on the desktop before Show browser is selected
  on window managers that do not reliably honor Chromium's minimized state.
- Duplicate inspection status rows.
- Empty preview space after discovery.
- Statusbar visibility for long track lists.
- Main-process exception when closing the window.
- Inspection cancellation no longer produces an inspection-failure error or
	leaves stale discovery results available for download.