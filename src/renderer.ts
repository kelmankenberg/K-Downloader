import type { GuiFormatPolicy, GuiInspection, GuiInspectionState, GuiProgress, GuiTrack } from "./gui-types.js";
import { ArrowLeft, Bug, CircleHelp, Copy, createIcons, EllipsisVertical, ExternalLink, Keyboard, LoaderCircle, Minus, Palette, Scan, ScrollText, Settings, Square, X } from "lucide";
import { initializeAppearance } from "./appearance.js";
import { initializeChangelog } from "./changelog.js";
import { initializeHelp } from "./help.js";

declare const __APP_VERSION__: string;
document.querySelector<HTMLElement>("#menu-app-version")!.textContent = __APP_VERSION__;

initializeAppearance();

const windowIcons = { ArrowLeft, Bug, CircleHelp, Copy, EllipsisVertical, ExternalLink, Keyboard, LoaderCircle, Minus, Palette, Scan, ScrollText, Settings, Square, X };
createIcons({ icons: windowIcons });
const changelog = initializeChangelog();
const help = initializeHelp();

const albumInput = document.querySelector<HTMLTextAreaElement>("#album-url")!;
document.querySelector("#khinsider-link")!.addEventListener("click", (event) => {
  event.preventDefault();
  void window.khinsiderDownloader.openKhinsider();
});
const outputInput = document.querySelector<HTMLInputElement>("#output-root")!;
const formatSelect = document.querySelector<HTMLSelectElement>("#format-policy")!;
const discLabelSelect = document.querySelector<HTMLSelectElement>("#disc-label")!;
const discLabelSetting = document.querySelector<HTMLElement>("#disc-label-setting")!;
const skipInput = document.querySelector<HTMLInputElement>("#skip-unavailable")!;
const inspectButton = document.querySelector<HTMLButtonElement>("#inspect-button")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download-button")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-button")!;
const browseButton = document.querySelector<HTMLButtonElement>("#browse-button")!;
const tableBody = document.querySelector<HTMLTableSectionElement>("#track-rows")!;
const albumTitle = document.querySelector<HTMLElement>("#album-title")!;
const trackCount = document.querySelector<HTMLElement>("#track-count")!;
const statusText = document.querySelector<HTMLElement>("#status-text")!;
const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
const statusStrip = document.querySelector<HTMLElement>(".status-strip")!;
const inspectionIndicator = document.querySelector<HTMLButtonElement>("#inspection-indicator")!;
const inspectionIndicatorText = document.querySelector<HTMLElement>("#inspection-indicator-text")!;
const progress = document.querySelector<HTMLProgressElement>("#download-progress")!;
const progressText = document.querySelector<HTMLElement>("#progress-text")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const trackTable = document.querySelector<HTMLTableElement>("#track-table")!;
const errorText = document.querySelector<HTMLElement>("#error-text")!;
const minimizeWindowButton = document.querySelector<HTMLButtonElement>("#minimize-window")!;
const maximizeWindowButton = document.querySelector<HTMLButtonElement>("#maximize-window")!;
const closeWindowButton = document.querySelector<HTMLButtonElement>("#close-window")!;
const moreMenuWrap = document.querySelector<HTMLElement>("#more-menu-wrap")!;
const moreButton = document.querySelector<HTMLButtonElement>("#more-button")!;
const moreMenu = document.querySelector<HTMLElement>("#more-menu")!;
const settingsMenuItem = document.querySelector<HTMLButtonElement>("#settings-menu-item")!;
const restoreBoundsMenuItem = document.querySelector<HTMLButtonElement>("#restore-bounds-menu-item")!;
const changelogMenuItem = document.querySelector<HTMLButtonElement>("#changelog-menu-item")!;
const helpMenuItem = document.querySelector<HTMLButtonElement>("#help-menu-item")!;
const reportIssueMenuItem = document.querySelector<HTMLButtonElement>("#report-issue-menu-item")!;
const workspaceView = document.querySelector<HTMLElement>("#workspace")!;
const settingsView = document.querySelector<HTMLElement>("#settings-view")!;
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings")!;
const appearanceNav = document.querySelector<HTMLButtonElement>("#appearance-nav")!;
const shortcutsNav = document.querySelector<HTMLButtonElement>("#shortcuts-nav")!;
const appearancePage = document.querySelector<HTMLElement>("#appearance-page")!;
const shortcutsPage = document.querySelector<HTMLElement>("#shortcuts-page")!;

let inspection: GuiInspection | undefined;
let busy = false;
let inspecting = false;
let inspectionCancelRequested = false;
let inspectionBrowserVisible = false;
let settingsOpen = false;

function updateInspectionIndicator(state: GuiInspectionState): void {
  inspectionBrowserVisible = state.browserVisible;
  statusStrip.hidden = state.active;
  inspectionIndicator.hidden = !state.active;
  inspectionIndicator.disabled = !state.browserReady;
  inspectionIndicator.setAttribute("aria-pressed", String(state.browserVisible));
  inspectionIndicatorText.textContent = state.browserReady
    ? state.browserVisible ? "Hide browser" : "Show browser"
    : "Starting browser…";
}

function closeMoreMenu(): void {
  moreMenu.hidden = true;
  moreButton.setAttribute("aria-expanded", "false");
}

function setSettingsOpen(open: boolean): void {
  settingsOpen = open;
  workspaceView.hidden = open;
  settingsView.hidden = !open;
  closeMoreMenu();
  if (open) closeSettingsButton.focus();
  else albumInput.focus();
}

function selectSettingsPage(page: "appearance" | "shortcuts"): void {
  appearancePage.hidden = page !== "appearance";
  shortcutsPage.hidden = page !== "shortcuts";
  if (page === "appearance") {
    appearanceNav.setAttribute("aria-current", "page");
    shortcutsNav.removeAttribute("aria-current");
  } else {
    shortcutsNav.setAttribute("aria-current", "page");
    appearanceNav.removeAttribute("aria-current");
  }
  document.querySelector<HTMLElement>(".settings-content")!.scrollTop = 0;
}

function updateMaximizeButton(maximized: boolean): void {
  const label = maximized ? "Restore window" : "Maximize window";
  maximizeWindowButton.setAttribute("aria-label", label);
  maximizeWindowButton.title = label;
  maximizeWindowButton.innerHTML = `<i data-lucide="${maximized ? "copy" : "square"}" aria-hidden="true"></i>`;
  createIcons({ icons: windowIcons });
}

function isValidAlbumUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === "downloads.khinsider.com" &&
      url.pathname.startsWith("/game-soundtracks/album/") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function setStatus(label: string, tone: "idle" | "working" | "success" | "error" = "idle"): void {
  statusText.textContent = label;
  statusDot.dataset.tone = tone;
}

function selectedFormat(track: GuiTrack): { format?: string; state: string; fallback: boolean } {
  const value = formatSelect.value;
  if (value === "prefer-lossless") {
    const lossless = ["FLAC", "ALAC", "WAV"].find((format) => track.formats.includes(format));
    if (lossless) return { format: lossless, state: "Ready", fallback: false };
    const lossy = track.formats.find((format) => format === "MP3") ?? track.formats[0];
    return lossy
      ? { format: lossy, state: "Ready", fallback: true }
      : { state: "Unavailable", fallback: false };
  }
  const requested = value === "lossless-only" ? ["FLAC", "ALAC", "WAV"].find((format) => track.formats.includes(format)) : value.slice("format:".length);
  if (requested && track.formats.includes(requested)) return { format: requested, state: "Ready", fallback: false };
  return skipInput.checked
    ? { state: "Skipped", fallback: false }
    : { state: "Unavailable", fallback: false };
}

function renderTracks(): void {
  if (!inspection) return;
  const rows = inspection.tracks.map((track) => {
    const selected = selectedFormat(track);
    const row = document.createElement("tr");
    row.innerHTML = `<td class="track-disc"></td><td class="track-number"></td><td class="track-title"></td><td class="track-formats"></td><td class="track-choice"></td><td class="track-state"></td>`;
    row.querySelector(".track-disc")!.textContent = track.discNumber === undefined ? "-" : `${discLabelSelect.value}${track.discNumber}`;
    row.querySelector(".track-number")!.textContent = String(track.number).padStart(2, "0");
    row.querySelector(".track-title")!.textContent = track.title;
    row.querySelector(".track-formats")!.textContent = track.formats.join(", ") || "None found";
    row.querySelector(".track-choice")!.textContent = selected.format ?? "-";
    const state = row.querySelector<HTMLElement>(".track-state")!;
    state.textContent = selected.state;
    state.dataset.state = selected.state.toLowerCase();
    if (selected.fallback) state.textContent += " · fallback";
    return row;
  });
  tableBody.replaceChildren(...rows);
  const blocked = inspection.tracks.some((track) => selectedFormat(track).state === "Unavailable");
  downloadButton.disabled = busy || blocked;
  trackCount.textContent = `${inspection.trackCount} tracks`;
  emptyState.hidden = true;
  trackTable.hidden = false;
}

function currentPolicy(): GuiFormatPolicy {
  if (formatSelect.value === "prefer-lossless") return { kind: "prefer-lossless" };
  if (formatSelect.value === "lossless-only") return { kind: "lossless-only", skipUnavailable: skipInput.checked };
  return { kind: "specific", format: formatSelect.value.slice("format:".length), skipUnavailable: skipInput.checked };
}

function updateFormatOptions(): void {
  if (!inspection) return;
  const formats = [...new Set(inspection.tracks.flatMap((track) => track.formats))].sort();
  const discs = [...new Set(inspection.tracks.flatMap((track) => track.discNumber === undefined ? [] : [track.discNumber]))];
  discLabelSetting.hidden = discs.length < 2;
  const previous = formatSelect.value;
  formatSelect.querySelectorAll("option[data-discovered]").forEach((option) => option.remove());
  for (const format of formats) {
    const option = document.createElement("option");
    option.value = `format:${format}`;
    option.textContent = `Specific format: ${format}`;
    option.dataset.discovered = "true";
    formatSelect.append(option);
  }
  if ([...formatSelect.options].some((option) => option.value === previous)) formatSelect.value = previous;
  renderTracks();
}

function setBusy(value: boolean): void {
  busy = value;
  inspectButton.disabled = value;
  browseButton.disabled = value;
  albumInput.disabled = value;
  outputInput.disabled = value;
  formatSelect.disabled = value;
  discLabelSelect.disabled = value;
  skipInput.disabled = value || formatSelect.value === "prefer-lossless";
  cancelButton.disabled = !value;
  cancelButton.textContent = inspecting ? "Cancel inspection" : "Cancel active download";
  if (inspection) renderTracks();
}

minimizeWindowButton.addEventListener("click", () => { void window.khinsiderDownloader.minimizeWindow(); });
maximizeWindowButton.addEventListener("click", async () => {
  const maximized = await window.khinsiderDownloader.toggleMaximizeWindow();
  updateMaximizeButton(maximized);
});
closeWindowButton.addEventListener("click", () => { void window.khinsiderDownloader.closeWindow(); });
window.khinsiderDownloader.onWindowState(({ maximized }) => updateMaximizeButton(maximized));

moreButton.addEventListener("click", () => {
  moreMenu.hidden = !moreMenu.hidden;
  moreButton.setAttribute("aria-expanded", String(!moreMenu.hidden));
});
settingsMenuItem.addEventListener("click", () => setSettingsOpen(true));
appearanceNav.addEventListener("click", () => selectSettingsPage("appearance"));
shortcutsNav.addEventListener("click", () => selectSettingsPage("shortcuts"));
restoreBoundsMenuItem.addEventListener("click", () => {
  closeMoreMenu();
  void window.khinsiderDownloader.restoreWindowBounds();
});
changelogMenuItem.addEventListener("click", () => {
  closeMoreMenu();
  help.close();
  changelog.open();
});
helpMenuItem.addEventListener("click", () => {
  closeMoreMenu();
  changelog.close();
  help.open();
});
reportIssueMenuItem.addEventListener("click", () => {
  closeMoreMenu();
  void window.khinsiderDownloader.reportIssue();
});
closeSettingsButton.addEventListener("click", () => setSettingsOpen(false));
document.addEventListener("click", (event) => {
  if (!moreMenuWrap.contains(event.target as Node)) closeMoreMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && ["0", "-", "_", "=", "+"].includes(event.key)) {
    event.preventDefault();
    const direction = event.key === "0" ? "reset" : ["-", "_"].includes(event.key) ? "out" : "in";
    void window.khinsiderDownloader.zoom(direction);
  } else if ((event.ctrlKey || event.metaKey) && event.key === ",") {
    event.preventDefault();
    setSettingsOpen(!settingsOpen);
  } else if (event.key === "Escape") {
    if (!moreMenu.hidden) {
      closeMoreMenu();
      moreButton.focus();
    } else if (help.isOpen()) help.close();
    else if (changelog.isOpen()) changelog.close();
    else if (settingsOpen) setSettingsOpen(false);
  }
});
document.addEventListener("wheel", (event) => {
  if (!event.ctrlKey || event.deltaY === 0) return;
  event.preventDefault();
  void window.khinsiderDownloader.zoom(event.deltaY < 0 ? "in" : "out");
}, { passive: false });

inspectButton.addEventListener("click", async () => {
  errorText.textContent = "";
  const albumUrl = albumInput.value.trim();
  if (!isValidAlbumUrl(albumUrl)) {
    errorText.textContent = "Paste a valid HTTPS KHInsider album URL.";
    setStatus("Album URL required", "error");
    albumInput.focus();
    return;
  }
  inspection = undefined;
  downloadButton.disabled = true;
  tableBody.replaceChildren();
  trackTable.hidden = true;
  emptyState.hidden = false;
  inspecting = true;
  inspectionCancelRequested = false;
  setBusy(true);
  updateInspectionIndicator({ active: true, browserReady: false, browserVisible: false });
  try {
    inspection = await window.khinsiderDownloader.inspect(albumUrl);
    if (!inspection) {
      setStatus("Inspection canceled");
      return;
    }
    albumTitle.textContent = inspection.albumTitle;
    updateFormatOptions();
    setStatus("Preview ready", "success");
  } catch (error) {
    if (inspectionCancelRequested) setStatus("Inspection canceled");
    else {
      errorText.textContent = error instanceof Error ? error.message : String(error);
      setStatus("Inspection failed", "error");
    }
  } finally {
    inspecting = false;
    inspectionCancelRequested = false;
    updateInspectionIndicator({ active: false, browserReady: false, browserVisible: false });
    setBusy(false);
    if (inspection) renderTracks();
  }
});

inspectionIndicator.addEventListener("click", async () => {
  if (inspectionIndicator.disabled) return;
  try {
    inspectionBrowserVisible = await window.khinsiderDownloader.toggleInspectionBrowser();
    inspectionIndicator.setAttribute("aria-pressed", String(inspectionBrowserVisible));
    inspectionIndicatorText.textContent = inspectionBrowserVisible ? "Hide browser" : "Show browser";
  } catch (error) {
    errorText.textContent = error instanceof Error ? error.message : String(error);
  }
});

window.khinsiderDownloader.onInspectionState(updateInspectionIndicator);

browseButton.addEventListener("click", async () => {
  const selected = await window.khinsiderDownloader.chooseOutput();
  if (selected) outputInput.value = selected;
});

formatSelect.addEventListener("change", () => {
  skipInput.disabled = busy || formatSelect.value === "prefer-lossless";
  renderTracks();
});
discLabelSelect.addEventListener("change", renderTracks);
skipInput.addEventListener("change", renderTracks);

downloadButton.addEventListener("click", async () => {
  if (!inspection) return;
  errorText.textContent = "";
  progress.value = 0;
  progressText.textContent = "Preparing album";
  setBusy(true);
  setStatus("Downloading", "working");
  try {
    const result = await window.khinsiderDownloader.download({
      policy: currentPolicy(),
      outputRoot: outputInput.value,
      discLabel: discLabelSelect.value === "Disc" ? "Disc" : "CD",
    });
    progress.value = inspection.trackCount;
    progress.max = inspection.trackCount;
    progressText.textContent = `${result.state} · ${result.directory}`;
    setStatus(result.state === "complete" ? "Download complete" : result.state, result.state === "complete" ? "success" : "error");
  } catch (error) {
    errorText.textContent = error instanceof Error ? error.message : String(error);
    setStatus("Download failed", "error");
  } finally {
    setBusy(false);
  }
});

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  const cancelingInspection = inspecting;
  if (cancelingInspection) {
    inspectionCancelRequested = true;
    inspectionIndicator.disabled = true;
    inspectionIndicatorText.textContent = "Canceling…";
  } else setStatus("Canceling active track…", "working");
  try {
    await window.khinsiderDownloader.cancel();
  } catch (error) {
    errorText.textContent = error instanceof Error ? error.message : String(error);
    inspectionCancelRequested = false;
    cancelButton.disabled = !busy;
  }
});

window.khinsiderDownloader.onProgress((event: GuiProgress) => {
  progress.max = event.totalTracks;
  progress.value = event.completedTracks;
  progressText.textContent = event.stage === "track-start"
    ? `Downloading ${String(event.number).padStart(2, "0")} · ${event.title}`
    : event.stage === "track-complete"
      ? `Completed ${event.completedTracks} of ${event.totalTracks} tracks`
      : event.stage === "track-failed"
        ? `Failed ${String(event.number).padStart(2, "0")} · ${event.title}`
        : "Canceled";
});

void window.khinsiderDownloader.defaultOutputRoot().then((value) => { outputInput.value = value; });