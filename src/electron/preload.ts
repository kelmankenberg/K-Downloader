import { contextBridge, ipcRenderer } from "electron";
import type { GuiDownloadRequest, GuiInspectionState, GuiProgress, GuiWindowState, KDownloaderApi } from "../gui-types.js";

const api: KDownloaderApi = {
  reportIssue: () => ipcRenderer.invoke("support:report-issue"),
  restoreWindowBounds: () => ipcRenderer.invoke("window:restore-bounds"),
  zoom: (direction) => ipcRenderer.invoke("window:zoom", direction),
  systemTheme: () => ipcRenderer.invoke("appearance:system-theme"),
  onSystemTheme: (listener: (dark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, dark: boolean) => listener(dark);
    ipcRenderer.on("appearance:system-theme", handler);
    return () => ipcRenderer.removeListener("appearance:system-theme", handler);
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onWindowState: (listener: (state: GuiWindowState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GuiWindowState) => listener(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
  defaultOutputRoot: () => ipcRenderer.invoke("output:default"),
  chooseOutput: () => ipcRenderer.invoke("output:choose"),
  inspect: (albumUrl: string) => ipcRenderer.invoke("album:inspect", albumUrl),
  toggleInspectionBrowser: () => ipcRenderer.invoke("inspection:toggle-browser"),
  onInspectionState: (listener: (state: GuiInspectionState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GuiInspectionState) => listener(state);
    ipcRenderer.on("inspection:state", handler);
    return () => ipcRenderer.removeListener("inspection:state", handler);
  },
  download: (request: GuiDownloadRequest) => ipcRenderer.invoke("album:download", request),
  cancel: () => ipcRenderer.invoke("album:cancel"),
  onProgress: (listener: (progress: GuiProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GuiProgress) => listener(progress);
    ipcRenderer.on("album:progress", handler);
    return () => ipcRenderer.removeListener("album:progress", handler);
  },
};

contextBridge.exposeInMainWorld("kDownloader", api);