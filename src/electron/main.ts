import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell } from "electron";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { centeredBounds, parseWindowState, startupBounds } from "./window-state.js";
import { monitorCinnamonTheme } from "./system-theme.js";
import { WebsiteBrowser } from "./website-browser.js";
import { isKhinsiderWebsiteUrl, khinsiderHome } from "../website.js";
import { createInspectionBrowser } from "./inspection-browser.js";
import { resolve } from "node:path";
import { downloadAlbum, type DownloadProgress } from "../downloader.js";
import { planFormats } from "../formats.js";
import {
  inspectAlbum,
  parseTrackDetails,
  resolveTrackPages,
  validateAlbumUrl,
  type AlbumPage,
  type DiscoveredTrack,
  type ResolvedTrack,
} from "../khinsider.js";
import { defaultOutputRoot } from "../output.js";
import type {
  GuiDownloadRequest,
  GuiFormatPolicy,
  GuiInspection,
  GuiInspectionState,
  GuiPlaylistCheckResult,
  GuiPlaylistDownloadResult,
  GuiPlaylistProgress,
  GuiPlaylistRenameResult,
  GuiPlaylistsState,
} from "../gui-types.js";
import { PlaylistStore } from "../playlist-store.js";
import { downloadPlaylist, renamePlaylistFolder, type PlaylistProgress } from "../playlist-download.js";
import { formatsFromLinks } from "../formats.js";

type CachedInspection = {
  sourceAlbum: string;
  album: AlbumPage;
  tracks: DiscoveredTrack[];
};

let mainWindow: BrowserWindow | undefined;
let playlistStore: PlaylistStore | undefined;
const playlistDownloads = new Map<number, string>();
let websiteBrowser: WebsiteBrowser | undefined;
let mainWindowReady = false;
let duplicateLaunchPending = false;
let instanceNoticeOpen = false;
let cinnamonDark: boolean | undefined;
let stopThemeMonitor: (() => void) | undefined;

app.setName("Khinsider Downloader");
if (process.platform === "linux") app.setDesktopName("khinsider-downloader.desktop");
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on("second-instance", () => {
  duplicateLaunchPending = true;
  void notifyExistingInstance();
});

function bringWindowForward(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function notifyExistingInstance(): Promise<void> {
  const window = mainWindow;
  if (!duplicateLaunchPending || instanceNoticeOpen || !mainWindowReady || !window || window.isDestroyed()) return;
  duplicateLaunchPending = false;
  instanceNoticeOpen = true;
  bringWindowForward(window);
  try {
    await dialog.showMessageBox(window, {
      type: "info",
      title: "Khinsider Downloader is already running",
      message: "Khinsider Downloader is already running.",
      detail: "Only one instance can run. Continue in the existing window.",
      buttons: ["Show running app"],
      defaultId: 0,
      noLink: true,
    });
    bringWindowForward(window);
  } finally {
    instanceNoticeOpen = false;
    duplicateLaunchPending = false;
  }
}

function systemThemeIsDark(): boolean {
  return cinnamonDark ?? nativeTheme.shouldUseDarkColors;
}

function sendSystemTheme(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("appearance:system-theme", systemThemeIsDark());
  }
}

const inspections = new Map<number, CachedInspection>();
const downloads = new Map<number, AbortController>();
const activeInspections = new Map<number, {
  controller: AbortController;
  setBrowserVisible?: (visible: boolean) => Promise<void>;
  browserVisible: boolean;
}>();

function assertWindowSender(senderId: number): BrowserWindow {
  if (!mainWindow || mainWindow.webContents.id !== senderId) throw new Error("Untrusted IPC sender");
  return mainWindow;
}

function parseFormatPolicy(policy: unknown): GuiFormatPolicy {
  if (typeof policy !== "object" || policy === null || !("kind" in policy)) {
    throw new Error("Invalid format policy");
  }
  const value = policy as Record<string, unknown>;
  const skipUnavailable = value.skipUnavailable === true;
  if (value.kind === "prefer-lossless" && !skipUnavailable) return { kind: "prefer-lossless" };
  if (value.kind === "lossless-only") return { kind: "lossless-only", skipUnavailable };
  if (value.kind === "specific" && typeof value.format === "string" && /^[A-Za-z0-9.+-]{1,16}$/.test(value.format)) {
    return { kind: "specific", format: value.format.toUpperCase(), skipUnavailable };
  }
  throw new Error("Invalid format policy");
}

function serializeInspection(cached: CachedInspection): GuiInspection {
  return {
    albumTitle: cached.album.title,
    trackCount: cached.tracks.length,
    tracks: cached.tracks.map((track) => ({
      ...(track.discNumber === undefined ? {} : { discNumber: track.discNumber }),
      number: track.number,
      title: track.title,
      formats: [...new Set(track.audioLinks.map(({ format }) => format))],
    })),
  };
}

function sendProgress(sender: Electron.WebContents, progress: DownloadProgress): void {
  if (!sender.isDestroyed()) sender.send("album:progress", progress);
}

function sendInspectionState(sender: Electron.WebContents, state: GuiInspectionState): void {
  if (!sender.isDestroyed()) sender.send("inspection:state", state);
}

function sendWindowState(window: BrowserWindow): void {
  if (!window.webContents.isDestroyed()) {
    window.webContents.send("window:state", { maximized: window.isMaximized() });
  }
}

function store(): PlaylistStore {
  if (!playlistStore) throw new Error("Playlists are not loaded yet");
  return playlistStore;
}

function sendPlaylists(): void {
  if (playlistStore && mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("playlists:state", playlistStore.state() satisfies GuiPlaylistsState);
  }
}

function playlistId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) throw new Error("Invalid playlist");
  return value;
}

function sendPlaylistProgress(sender: Electron.WebContents, id: string, progress: PlaylistProgress): void {
  if (!sender.isDestroyed()) sender.send("playlist:progress", { playlistId: id, ...progress } satisfies GuiPlaylistProgress);
}

async function confirm(window: BrowserWindow, message: string, detail: string, action: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: "question",
    message,
    detail,
    buttons: [action, "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}

function storeResolvedFormats(id: string, results: ResolvedTrack[]): Promise<void> {
  const formats = new Map(results.flatMap((result) => result.details ? [[result.trackUrl, formatsFromLinks(result.details.audioLinks)] as const] : []));
  return formats.size > 0 ? store().updateFormats(id, formats) : Promise.resolve();
}

function registerPlaylistIpc(): void {
  ipcMain.handle("playlists:get", (event) => {
    assertWindowSender(event.sender.id);
    return store().state();
  });
  ipcMain.handle("playlist:create", async (event, name: unknown) => {
    assertWindowSender(event.sender.id);
    if (typeof name !== "string" || name.length > 1000) throw new Error("Invalid playlist name");
    const playlist = await store().create(name);
    sendPlaylists();
    return playlist;
  });
  ipcMain.handle("playlist:rename", async (event, id: unknown, name: unknown): Promise<GuiPlaylistRenameResult> => {
    const window = assertWindowSender(event.sender.id);
    const playlist = store().get(playlistId(id));
    if (!playlist) throw new Error("Playlist not found.");
    if (typeof name !== "string" || name.length > 1000) throw new Error("Invalid playlist name");
    const renamed = await store().rename(playlist.id, name);
    sendPlaylists();
    if (!playlist.lastDirectory || renamed.name === playlist.name) return {};
    if ([...playlistDownloads.values()].includes(playlist.id)) {
      return { folderError: "The download folder was not renamed because the playlist is downloading." };
    }
    const renameFolder = await confirm(
      window,
      `Rename the download folder too?`,
      `The playlist was downloaded to:\n${playlist.lastDirectory}\n\nRenaming keeps the files and moves the folder to match "${renamed.name}". Keeping the old name continues downloading into the existing folder.`,
      "Rename folder",
    );
    if (!renameFolder) return {};
    try {
      const folder = await renamePlaylistFolder(playlist.lastDirectory, playlist.id, renamed.name);
      await store().setDownloaded(playlist.id, folder);
      sendPlaylists();
      return { folder };
    } catch (error) {
      return { folderError: `The folder was not renamed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  ipcMain.handle("playlist:delete", async (event, id: unknown) => {
    const window = assertWindowSender(event.sender.id);
    const playlist = store().get(playlistId(id));
    if (!playlist) throw new Error("Playlist not found.");
    if ([...playlistDownloads.values()].includes(playlist.id)) throw new Error("Cancel the playlist download first.");
    if (!(await confirm(window, `Delete "${playlist.name}"?`, "Downloaded files are kept on disk.", "Delete playlist"))) return false;
    await store().delete(playlist.id);
    sendPlaylists();
    return true;
  });
  ipcMain.handle("playlist:clear", async (event, id: unknown) => {
    const window = assertWindowSender(event.sender.id);
    const playlist = store().get(playlistId(id));
    if (!playlist) throw new Error("Playlist not found.");
    if ([...playlistDownloads.values()].includes(playlist.id)) throw new Error("Cancel the playlist download first.");
    if (playlist.entries.length === 0) return true;
    const detail = `Remove all ${playlist.entries.length} tracks from the playlist? Downloaded files are kept on disk.`;
    if (!(await confirm(window, `Clear "${playlist.name}"?`, detail, "Clear playlist"))) return false;
    await store().clear(playlist.id);
    sendPlaylists();
    return true;
  });
  ipcMain.handle("playlist:set-active", async (event, id: unknown) => {
    assertWindowSender(event.sender.id);
    await store().setActive(playlistId(id));
    sendPlaylists();
  });
  ipcMain.handle("playlist:add-inspected", async (event, id: unknown, indices: unknown) => {
    assertWindowSender(event.sender.id);
    const cached = inspections.get(event.sender.id);
    if (!cached) throw new Error("Inspect an album before adding its tracks");
    if (!Array.isArray(indices) || indices.length === 0 || indices.length > cached.tracks.length ||
      !indices.every((index) => Number.isInteger(index) && index >= 0 && index < cached.tracks.length)) {
      throw new Error("Choose tracks to add");
    }
    const result = await store().addEntries(playlistId(id), [...new Set(indices as number[])].map((index) => {
      const track = cached.tracks[index]!;
      return {
        trackUrl: track.pageUrl.href,
        albumUrl: cached.sourceAlbum,
        albumTitle: cached.album.title,
        title: track.title,
        ...(track.discNumber ? { discNumber: track.discNumber } : {}),
        trackNumber: track.number,
        formats: formatsFromLinks(track.audioLinks),
      };
    }));
    sendPlaylists();
    return result;
  });
  ipcMain.handle("playlist:add-website-track", async (event, id: unknown) => {
    assertWindowSender(event.sender.id);
    if (!websiteBrowser) throw new Error("KHInsider browser is not open");
    const target = playlistId(id);
    const page = await websiteBrowser.readTrack();
    const details = parseTrackDetails(page.html, new URL(page.url));
    const result = await store().addEntries(target, [{
      trackUrl: page.url,
      albumUrl: "",
      albumTitle: details.albumTitle,
      title: details.title,
      formats: formatsFromLinks(details.audioLinks),
    }]);
    sendPlaylists();
    return result;
  });
  ipcMain.handle("playlist:remove", async (event, id: unknown, entryIds: unknown) => {
    assertWindowSender(event.sender.id);
    if (!Array.isArray(entryIds) || entryIds.length > 5000 || !entryIds.every((entry) => typeof entry === "string")) {
      throw new Error("Invalid tracks");
    }
    await store().removeEntries(playlistId(id), entryIds as string[]);
    sendPlaylists();
  });
  ipcMain.handle("playlist:move", async (event, id: unknown, entryId: unknown, toIndex: unknown) => {
    assertWindowSender(event.sender.id);
    if (typeof entryId !== "string" || !Number.isInteger(toIndex)) throw new Error("Invalid move");
    await store().moveEntry(playlistId(id), entryId, toIndex as number);
    sendPlaylists();
  });
  ipcMain.handle("playlist:check-formats", async (event, id: unknown): Promise<GuiPlaylistCheckResult | undefined> => {
    assertWindowSender(event.sender.id);
    if (downloads.has(event.sender.id) || activeInspections.has(event.sender.id)) throw new Error("Another task is already active");
    const playlist = store().get(playlistId(id));
    if (!playlist) throw new Error("Playlist not found.");
    if (playlist.entries.length === 0) throw new Error("This playlist has no tracks.");
    const controller = new AbortController();
    downloads.set(event.sender.id, controller);
    playlistDownloads.set(event.sender.id, playlist.id);
    try {
      const results = await resolveTrackPages(playlist.entries.map((entry) => entry.trackUrl), {
        createBrowser: createInspectionBrowser,
        signal: controller.signal,
        onProgress: (index, result) => sendPlaylistProgress(event.sender, playlist.id, {
          stage: result.error ? "resolve-failed" : "resolve-complete",
          number: index + 1,
          title: playlist.entries[index]?.title ?? "",
          completedTracks: index + 1,
          totalTracks: playlist.entries.length,
        }),
      });
      await storeResolvedFormats(playlist.id, results);
      sendPlaylists();
      return {
        checked: results.length,
        failed: results.flatMap((result) => result.error ? [{ trackUrl: result.trackUrl, error: result.error }] : []),
      };
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      throw error;
    } finally {
      downloads.delete(event.sender.id);
      playlistDownloads.delete(event.sender.id);
    }
  });
  ipcMain.handle("playlist:download", async (event, request: unknown): Promise<GuiPlaylistDownloadResult | undefined> => {
    assertWindowSender(event.sender.id);
    if (downloads.has(event.sender.id) || activeInspections.has(event.sender.id)) throw new Error("Another task is already active");
    if (typeof request !== "object" || request === null) throw new Error("Invalid download request");
    const payload = request as Record<string, unknown>;
    if (typeof payload.outputRoot !== "string" || payload.outputRoot.length > 4096 || payload.outputRoot.includes("\0")) {
      throw new Error("Invalid output folder");
    }
    const playlist = store().get(playlistId(payload.playlistId));
    if (!playlist) throw new Error("Playlist not found.");
    const policy = parseFormatPolicy(payload.policy);
    const outputRoot = resolve(payload.outputRoot);
    const controller = new AbortController();
    downloads.set(event.sender.id, controller);
    playlistDownloads.set(event.sender.id, playlist.id);
    try {
      const result = await downloadPlaylist({
        playlist,
        outputRoot,
        ...(playlist.lastDirectory ? { preferredDirectory: playlist.lastDirectory } : {}),
        policy,
        signal: controller.signal,
        resolveTracks: (urls, onResult) => resolveTrackPages(urls, {
          createBrowser: createInspectionBrowser,
          signal: controller.signal,
          onProgress: onResult,
        }),
        onResolved: (results) => {
          void storeResolvedFormats(playlist.id, results).then(sendPlaylists, (error: unknown) => console.warn("Could not save formats:", error));
        },
        onProgress: (progress) => sendPlaylistProgress(event.sender, playlist.id, progress),
      });
      if (store().get(playlist.id)) {
        await store().setDownloaded(playlist.id, result.directory, policy);
        sendPlaylists();
      }
      return {
        state: result.state,
        directory: result.directory,
        suffixed: result.suffixed,
        warnings: result.warnings,
        tracks: result.tracks.filter((track) => track.inPlaylist).map((track) => ({
          trackUrl: track.trackUrl,
          state: track.state,
          ...(track.error ? { error: track.error } : {}),
        })),
      };
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      throw error;
    } finally {
      downloads.delete(event.sender.id);
      playlistDownloads.delete(event.sender.id);
    }
  });
}

function registerIpc(): void {
  registerPlaylistIpc();
  ipcMain.handle("source:open-khinsider", async (event, target: unknown, requestedUrl: unknown) => {
    const window = assertWindowSender(event.sender.id);
    if (target !== "external" && target !== "internal") throw new Error("Invalid website target");
    if (requestedUrl !== undefined && (typeof requestedUrl !== "string" || !isKhinsiderWebsiteUrl(requestedUrl))) {
      throw new Error("Only KHInsider pages can be opened");
    }
    if (target === "internal") {
      websiteBrowser ??= new WebsiteBrowser(window);
      websiteBrowser.open(requestedUrl);
      return;
    }
    const url = requestedUrl ?? khinsiderHome;
    try {
      await shell.openExternal(url);
    } catch {
      await dialog.showMessageBox(window, {
        type: "error",
        title: "Could not open KHInsider",
        message: "Your browser could not be opened.",
        detail: `Open this address manually:\n${url}`,
        buttons: ["OK"],
      });
    }
  });
  ipcMain.handle("website:bounds", (event, bounds: unknown) => {
    assertWindowSender(event.sender.id);
    websiteBrowser?.setBounds(bounds);
  });
  ipcMain.handle("website:command", (event, command: unknown) => {
    assertWindowSender(event.sender.id);
    if (!websiteBrowser) throw new Error("KHInsider browser is not open");
    return websiteBrowser.command(command);
  });
  ipcMain.handle("website:use-album", (event) => {
    assertWindowSender(event.sender.id);
    if (!websiteBrowser) throw new Error("KHInsider browser is not open");
    return websiteBrowser.useAlbum();
  });
  ipcMain.handle("support:report-issue", async (event) => {
    const window = assertWindowSender(event.sender.id);
    const url = "https://github.com/kelmankenberg/Khinsider-Downloader/issues/new/choose";
    try {
      await shell.openExternal(url);
    } catch {
      await dialog.showMessageBox(window, {
        type: "error",
        title: "Could not open GitHub",
        message: "Your browser could not be opened.",
        detail: `Open this address manually to report an issue:\n${url}`,
        buttons: ["OK"],
      });
    }
  });
  ipcMain.handle("window:restore-bounds", (event) => {
    const window = assertWindowSender(event.sender.id);
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    if (window.isFullScreen()) window.setFullScreen(false);
    if (window.isMaximized()) window.unmaximize();
    window.setBounds(centeredBounds(area));
    sendWindowState(window);
  });

  ipcMain.handle("window:zoom", (event, direction: unknown) => {
    const window = assertWindowSender(event.sender.id);
    if (direction !== "in" && direction !== "out" && direction !== "reset") throw new Error("Invalid zoom command");
    const current = window.webContents.getZoomFactor();
    const zoom = direction === "reset" ? 1 : Math.max(.5, Math.min(2, Math.round((current + (direction === "in" ? .1 : -.1)) * 10) / 10));
    window.webContents.setZoomFactor(zoom);
    return zoom;
  });
  ipcMain.handle("appearance:system-theme", (event) => {
    assertWindowSender(event.sender.id);
    return systemThemeIsDark();
  });
  ipcMain.handle("window:minimize", (event) => {
    assertWindowSender(event.sender.id).minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = assertWindowSender(event.sender.id);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    sendWindowState(window);
    return window.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    assertWindowSender(event.sender.id).close();
  });

  ipcMain.handle("output:default", (event) => {
    assertWindowSender(event.sender.id);
    return defaultOutputRoot();
  });

  ipcMain.handle("output:choose", async (event) => {
    const window = assertWindowSender(event.sender.id);
    const result = await dialog.showOpenDialog(window, {
      title: "Choose download folder",
      defaultPath: defaultOutputRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("album:inspect", async (event, input: unknown) => {
    assertWindowSender(event.sender.id);
    if (typeof input !== "string" || input.length > 2048) throw new Error("Enter one valid album URL");
    if (activeInspections.has(event.sender.id)) throw new Error("Album inspection is already active");
    if (playlistDownloads.has(event.sender.id)) throw new Error("Wait for the playlist task to finish or cancel it first");
    let sourceAlbum: string;
    try {
      sourceAlbum = validateAlbumUrl(input).href;
    } catch {
      throw new Error("Paste a valid HTTPS KHInsider album URL.");
    }
    const active: {
      controller: AbortController;
      setBrowserVisible?: (visible: boolean) => Promise<void>;
      browserVisible: boolean;
    } = { controller: new AbortController(), browserVisible: false };
    inspections.delete(event.sender.id);
    activeInspections.set(event.sender.id, active);
    sendInspectionState(event.sender, { active: true, browserReady: false, browserVisible: false });
    try {
      const result = await inspectAlbum(sourceAlbum, {
        createBrowser: createInspectionBrowser,
        signal: active.controller.signal,
        onBrowserReady: (setBrowserVisible) => {
          active.setBrowserVisible = setBrowserVisible;
          sendInspectionState(event.sender, { active: true, browserReady: true, browserVisible: false });
        },
      });
      const cached = { sourceAlbum, album: result.album, tracks: result.tracks };
      inspections.set(event.sender.id, cached);
      return serializeInspection(cached);
    } catch (error) {
      if (active.controller.signal.aborted) return undefined;
      throw error;
    } finally {
      activeInspections.delete(event.sender.id);
      sendInspectionState(event.sender, { active: false, browserReady: false, browserVisible: false });
    }
  });

  ipcMain.handle("inspection:toggle-browser", async (event) => {
    assertWindowSender(event.sender.id);
    const active = activeInspections.get(event.sender.id);
    if (!active?.setBrowserVisible) throw new Error("Inspection browser is not ready");
    const browserVisible = !active.browserVisible;
    await active.setBrowserVisible(browserVisible);
    active.browserVisible = browserVisible;
    sendInspectionState(event.sender, { active: true, browserReady: true, browserVisible });
    return browserVisible;
  });

  ipcMain.handle("album:download", async (event, request: unknown) => {
    const window = assertWindowSender(event.sender.id);
    if (downloads.has(event.sender.id)) throw new Error("A download is already active");
    if (typeof request !== "object" || request === null || !("outputRoot" in request)) {
      throw new Error("Invalid download request");
    }
    const payload = request as GuiDownloadRequest;
    if (typeof payload.outputRoot !== "string" || payload.outputRoot.length > 4096 || payload.outputRoot.includes("\0")) {
      throw new Error("Invalid output folder");
    }
    if (payload.discLabel !== "CD" && payload.discLabel !== "Disc") throw new Error("Invalid disc folder label");
    const cached = inspections.get(event.sender.id);
    if (!cached) throw new Error("Inspect an album before starting a download");
    const policy = parseFormatPolicy(payload.policy);
    const plan = planFormats(cached.tracks, policy);
    if (plan.blocked) throw new Error("The format preview has unavailable tracks; skip them explicitly or choose another policy");

    const controller = new AbortController();
    downloads.set(event.sender.id, controller);
    try {
      const result = await downloadAlbum({
        ...cached,
        outputRoot: resolve(payload.outputRoot),
        policy,
        discLabel: payload.discLabel,
        signal: controller.signal,
        onProgress: (progress) => sendProgress(window.webContents, progress),
      });
      return { state: result.state, directory: result.directory };
    } finally {
      downloads.delete(event.sender.id);
    }
  });

  ipcMain.handle("album:cancel", (event) => {
    assertWindowSender(event.sender.id);
    activeInspections.get(event.sender.id)?.controller.abort();
    downloads.get(event.sender.id)?.abort();
  });
}

async function createWindow(): Promise<void> {
  const statePath = resolve(app.getPath("userData"), "window-state.json");
  let savedState;
  try { savedState = parseWindowState(readFileSync(statePath, "utf8")); } catch {}
  const displays = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter((display) => display.id !== screen.getPrimaryDisplay().id)];
  const window = new BrowserWindow({
    frame: false,
    autoHideMenuBar: true,
    ...startupBounds(savedState, displays.map((display) => display.workArea)),
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#101715",
    title: "Khinsider Downloader",
    icon: resolve(__dirname, "../assets/khinsider-downloader.png"),
    webPreferences: {
      preload: resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  const senderId = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  window.on("maximize", () => sendWindowState(window));
  window.on("unmaximize", () => sendWindowState(window));
  window.webContents.on("did-finish-load", () => sendWindowState(window));
  window.on("close", () => {
    websiteBrowser?.destroy();
    websiteBrowser = undefined;
    try {
      writeFileSync(`${statePath}.tmp`, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }), { mode: 0o600 });
      renameSync(`${statePath}.tmp`, statePath);
    } catch (error) {
      console.warn("Could not save window size and position:", error);
    }
  });
  window.on("closed", () => {
    inspections.delete(senderId);
    activeInspections.get(senderId)?.controller.abort();
    activeInspections.delete(senderId);
    downloads.get(senderId)?.abort();
    downloads.delete(senderId);
    playlistDownloads.delete(senderId);
    if (mainWindow === window) {
      mainWindow = undefined;
      mainWindowReady = false;
    }
  });
  await window.loadFile(resolve(__dirname, "../gui/index.html"));
  if (savedState?.maximized) window.maximize();
  mainWindowReady = true;
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  if (app.isPackaged) process.env.KHINSIDER_DOWNLOADER_CHROMIUM_PATH = resolve(process.resourcesPath, "chromium/chrome");
  nativeTheme.themeSource = "system";
  nativeTheme.on("updated", sendSystemTheme);
  stopThemeMonitor = await monitorCinnamonTheme((dark) => {
    cinnamonDark = dark;
    sendSystemTheme();
  });
  Menu.setApplicationMenu(null);
  playlistStore = await PlaylistStore.open(PlaylistStore.defaultPath(app.getPath("userData")));
  registerIpc();
  await createWindow();
  await notifyExistingInstance();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("will-quit", () => stopThemeMonitor?.());

app.on("window-all-closed", () => {
  for (const controller of downloads.values()) controller.abort();
  if (process.platform !== "darwin") app.quit();
});