import { app, BrowserWindow, dialog, ipcMain } from "electron";
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

function registerIpc(): void {
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
    downloads.get(event.sender.id)?.abort();
  });
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#101715",
    title: "K-Downloader",
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
  window.on("closed", () => {
    inspections.delete(senderId);
    activeInspections.get(senderId)?.controller.abort();
    activeInspections.delete(senderId);
    downloads.get(senderId)?.abort();
    downloads.delete(senderId);
    if (mainWindow === window) mainWindow = undefined;
  });
  await window.loadFile(resolve(__dirname, "../gui/index.html"));
}

app.whenReady().then(async () => {
  app.setName("K-Downloader");
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const controller of downloads.values()) controller.abort();
  if (process.platform !== "darwin") app.quit();
});