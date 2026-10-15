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
  openKhinsider: () => Promise<void>;
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