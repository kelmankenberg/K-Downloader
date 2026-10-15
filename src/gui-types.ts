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

export type KhinsiderDownloaderApi = {
  openKhinsider: (target: WebsiteTarget) => Promise<void>;
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