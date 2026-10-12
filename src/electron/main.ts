import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell } from "electron";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { centeredBounds, parseWindowState, startupBounds } from "./window-state.js";
import { monitorCinnamonTheme } from "./system-theme.js";
import { resolve } from "node:path";
import { downloadAlbum, type DownloadProgress } from "../downloader.js";
import { planFormats } from "../formats.js";
import { inspectAlbum, validateAlbumUrl, type AlbumPage, type DiscoveredTrack } from "../khinsider.js";
import { defaultOutputRoot } from "../output.js";
import type { GuiDownloadRequest, GuiFormatPolicy, GuiInspection, GuiInspectionState } from "../gui-types.js";

type CachedInspection = {
  sourceAlbum: string;
  album: AlbumPage;
  tracks: DiscoveredTrack[];
};

let mainWindow: BrowserWindow | undefined;
let mainWindowReady = false;
let duplicateLaunchPending = false;
let instanceNoticeOpen = false;
let cinnamonDark: boolean | undefined;
let stopThemeMonitor: (() => void) | undefined;

app.setName("K-Downloader");
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
      title: "K-Downloader is already running",
      message: "K-Downloader is already running.",
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

function registerIpc(): void {
  ipcMain.handle("support:report-issue", async (event) => {
    const window = assertWindowSender(event.sender.id);
    const url = "https://github.com/kelmankenberg/K-Downloader/issues/new/choose";
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
    title: "K-Downloader",
    icon: resolve(__dirname, "../assets/k-downloader.png"),
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
  nativeTheme.themeSource = "system";
  nativeTheme.on("updated", sendSystemTheme);
  stopThemeMonitor = await monitorCinnamonTheme((dark) => {
    cinnamonDark = dark;
    sendSystemTheme();
  });
  Menu.setApplicationMenu(null);
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