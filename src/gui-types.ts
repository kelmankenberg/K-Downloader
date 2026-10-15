export type GuiFormatPolicy =
  | { kind: "prefer-lossless" }
  | { kind: "lossless-only"; skipUnavailable: boolean }
  | { kind: "specific"; format: string; skipUnavailable: boolean };

export type GuiTrack = {
  discNumber?: number;
  number: number;
  title: string;
  formats: string[];
};

export type GuiInspection = {
  albumTitle: string;
  trackCount: number;
  tracks: GuiTrack[];
};

export type GuiInspectionState = {
  active: boolean;
  browserReady: boolean;
  browserVisible: boolean;
};

export type GuiWindowState = {
  maximized: boolean;
};

export type WebsiteTarget = "external" | "internal";
export type GuiWebsiteState = {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string;
};
export type GuiWebsiteBounds = { x: number; y: number; width: number; height: number };

export type GuiProgress = {
  stage: "track-start" | "track-complete" | "track-failed" | "canceled";
  number: number;
  title: string;
  completedTracks: number;
  totalTracks: number;
  bytesReceived?: number;
};

export type GuiDownloadRequest = {
  policy: GuiFormatPolicy;
  outputRoot: string;
  discLabel: "CD" | "Disc";
};

export type GuiPlaylistEntry = {
  id: string;
  trackUrl: string;
  albumUrl: string;
  albumTitle: string;
  title: string;
  discNumber?: number;
  trackNumber?: number;
  formats?: string[];
  addedAt: string;
};

export type GuiPlaylist = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  formatPolicy?: GuiFormatPolicy;
  lastDirectory?: string;
  entries: GuiPlaylistEntry[];
};

export type GuiPlaylistsState = {
  playlists: GuiPlaylist[];
  activePlaylistId?: string;
  readOnly: boolean;
  warning: string;
};

export type GuiPlaylistAddResult = {
  playlistName: string;
  added: number;
  duplicates: number;
  rejected: number;
};

export type GuiPlaylistProgress = {
  playlistId: string;
  stage: "resolve-start" | "resolve-complete" | "resolve-failed" | GuiProgress["stage"];
  number: number;
  title: string;
  completedTracks: number;
  totalTracks: number;
  bytesReceived?: number;
};

export type GuiPlaylistDownloadRequest = {
  playlistId: string;
  policy: GuiFormatPolicy;
  outputRoot: string;
};

export type GuiPlaylistDownloadResult = {
  state: string;
  directory: string;
  suffixed: boolean;
  warnings: string[];
  tracks: { trackUrl: string; state: string; error?: string }[];
};

export type GuiPlaylistCheckResult = {
  checked: number;
  failed: { trackUrl: string; error: string }[];
};

export type GuiPlaylistRenameResult = {
  folder?: string;
  folderError?: string;
};

export type GuiPlaylistApi = {
  getPlaylists: () => Promise<GuiPlaylistsState>;
  onPlaylists: (listener: (state: GuiPlaylistsState) => void) => () => void;
  createPlaylist: (name: string) => Promise<GuiPlaylist>;
  renamePlaylist: (playlistId: string, name: string) => Promise<GuiPlaylistRenameResult>;
  deletePlaylist: (playlistId: string) => Promise<boolean>;
  clearPlaylist: (playlistId: string) => Promise<boolean>;
  setActivePlaylist: (playlistId: string) => Promise<void>;
  addInspectedTracks: (playlistId: string, indices: number[]) => Promise<GuiPlaylistAddResult>;
  addWebsiteTrack: (playlistId: string) => Promise<GuiPlaylistAddResult>;
  removePlaylistEntries: (playlistId: string, entryIds: string[]) => Promise<void>;
  movePlaylistEntry: (playlistId: string, entryId: string, toIndex: number) => Promise<void>;
  checkPlaylistFormats: (playlistId: string) => Promise<GuiPlaylistCheckResult | undefined>;
  downloadPlaylist: (request: GuiPlaylistDownloadRequest) => Promise<GuiPlaylistDownloadResult | undefined>;
  onPlaylistProgress: (listener: (progress: GuiPlaylistProgress) => void) => () => void;
};

export type KhinsiderDownloaderApi = GuiPlaylistApi & {
  openKhinsider: (target: WebsiteTarget, url?: string) => Promise<void>;
  websiteCommand: (command: "back" | "forward" | "reload" | "home") => Promise<void>;
  setWebsiteBounds: (bounds: GuiWebsiteBounds | null) => Promise<void>;
  useWebsiteAlbum: () => Promise<string>;
  onWebsiteState: (listener: (state: GuiWebsiteState) => void) => () => void;
  onWebsiteShortcut: (listener: (action: "settings" | "in" | "out" | "reset") => void) => () => void;
  reportIssue: () => Promise<void>;
  restoreWindowBounds: () => Promise<void>;
  zoom: (direction: "in" | "out" | "reset") => Promise<number>;
  systemTheme: () => Promise<boolean>;
  onSystemTheme: (listener: (dark: boolean) => void) => () => void;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  onWindowState: (listener: (state: GuiWindowState) => void) => () => void;
  defaultOutputRoot: () => Promise<string>;
  chooseOutput: () => Promise<string | undefined>;
  inspect: (albumUrl: string) => Promise<GuiInspection | undefined>;
  toggleInspectionBrowser: () => Promise<boolean>;
  onInspectionState: (listener: (state: GuiInspectionState) => void) => () => void;
  download: (request: GuiDownloadRequest) => Promise<{ state: string; directory: string }>;
  cancel: () => Promise<void>;
  onProgress: (listener: (progress: GuiProgress) => void) => () => void;
};

declare global {
  interface Window {
    khinsiderDownloader: KhinsiderDownloaderApi;
  }
}