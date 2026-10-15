import { contextBridge, ipcRenderer } from "electron";
import type {
  GuiDownloadRequest,
  GuiInspectionState,
  GuiPlaylistProgress,
  GuiPlaylistsState,
  GuiProgress,
  GuiWindowState,
  KhinsiderDownloaderApi,
} from "../gui-types.js";

const api: KhinsiderDownloaderApi = {
  openKhinsider: (target, url) => ipcRenderer.invoke("source:open-khinsider", target, url),
  websiteCommand: (command) => ipcRenderer.invoke("website:command", command),
  setWebsiteBounds: (bounds) => ipcRenderer.invoke("website:bounds", bounds),
  useWebsiteAlbum: () => ipcRenderer.invoke("website:use-album"),
  onWebsiteState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on("website:state", handler);
    return () => ipcRenderer.removeListener("website:state", handler);
  },
  onWebsiteShortcut: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, action: Parameters<typeof listener>[0]) => listener(action);
    ipcRenderer.on("website:shortcut", handler);
    return () => ipcRenderer.removeListener("website:shortcut", handler);
  },
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
  getPlaylists: () => ipcRenderer.invoke("playlists:get"),
  onPlaylists: (listener: (state: GuiPlaylistsState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GuiPlaylistsState) => listener(state);
    ipcRenderer.on("playlists:state", handler);
    return () => ipcRenderer.removeListener("playlists:state", handler);
  },
  createPlaylist: (name) => ipcRenderer.invoke("playlist:create", name),
  renamePlaylist: (playlistId, name) => ipcRenderer.invoke("playlist:rename", playlistId, name),
  deletePlaylist: (playlistId) => ipcRenderer.invoke("playlist:delete", playlistId),
  clearPlaylist: (playlistId) => ipcRenderer.invoke("playlist:clear", playlistId),
  setActivePlaylist: (playlistId) => ipcRenderer.invoke("playlist:set-active", playlistId),
  addInspectedTracks: (playlistId, indices) => ipcRenderer.invoke("playlist:add-inspected", playlistId, indices),
  addWebsiteTrack: (playlistId) => ipcRenderer.invoke("playlist:add-website-track", playlistId),
  removePlaylistEntries: (playlistId, entryIds) => ipcRenderer.invoke("playlist:remove", playlistId, entryIds),
  movePlaylistEntry: (playlistId, entryId, toIndex) => ipcRenderer.invoke("playlist:move", playlistId, entryId, toIndex),
  checkPlaylistFormats: (playlistId) => ipcRenderer.invoke("playlist:check-formats", playlistId),
  downloadPlaylist: (request) => ipcRenderer.invoke("playlist:download", request),
  onPlaylistProgress: (listener: (progress: GuiPlaylistProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GuiPlaylistProgress) => listener(progress);
    ipcRenderer.on("playlist:progress", handler);
    return () => ipcRenderer.removeListener("playlist:progress", handler);
  },
};

contextBridge.exposeInMainWorld("khinsiderDownloader", api);