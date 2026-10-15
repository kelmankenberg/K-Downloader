import { WebContentsView, type BrowserWindow } from "electron";
import type { GuiWebsiteBounds, GuiWebsiteState } from "../gui-types.js";
import { isTrackUrl, normalizeTrackUrl } from "../playlist.js";
import { isKhinsiderAlbumUrl, isKhinsiderWebsiteUrl, khinsiderHome } from "../website.js";

const MAX_TRACK_PAGE_BYTES = 5 * 1024 * 1024;

export class WebsiteBrowser {
  private view: WebContentsView | undefined;
  private error = "";
  private readonly preventDownload = (event: Electron.Event): void => {
    event.preventDefault();
    this.error = "Website downloads are disabled. Open an album and select Use this album to download through the app.";
    this.sendState();
  };

  constructor(private readonly window: BrowserWindow) {}

  private sendState(): void {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed() || this.window.webContents.isDestroyed()) return;
    const state: GuiWebsiteState = {
      url: contents.getURL(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: this.error,
    };
    this.window.webContents.send("website:state", state);
  }

  private async navigate(url: string): Promise<void> {
    if (!this.view) throw new Error("KHInsider browser is not open");
    this.error = "";
    try {
      await this.view.webContents.loadURL(url);
    } catch (error) {
      // Replaced navigations are normal when following a link before a page finishes.
      if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) {
        this.error = `Could not load KHInsider: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    this.sendState();
  }

  /** Shows the embedded site, keeping the current page unless a KHInsider URL is given. */
  open(url?: string): void {
    const target = url && isKhinsiderWebsiteUrl(url) ? url : undefined;
    if (this.view) {
      if (target) void this.navigate(target);
      else this.sendState();
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "khinsider-website",
      },
    });
    this.view = view;
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const contents = view.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.on("will-download", this.preventDownload);
    const guardNavigation = (event: Electron.Event, url: string): void => {
      if (isKhinsiderWebsiteUrl(url)) return;
      event.preventDefault();
      this.error = "Only downloads.khinsider.com can open here. Use the system browser for other websites.";
      this.sendState();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.setWindowOpenHandler(({ url }) => {
      if (isKhinsiderWebsiteUrl(url)) void this.navigate(url);
      else {
        this.error = "This link cannot open inside the app. Use the system browser for other websites.";
        this.sendState();
      }
      return { action: "deny" };
    });
    contents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.error = "";
    });
    contents.on("did-start-loading", () => this.sendState());
    contents.on("did-stop-loading", () => this.sendState());
    contents.on("did-navigate-in-page", () => this.sendState());
    contents.on("did-navigate", (_event, _url, statusCode) => {
      if (statusCode >= 400) this.error = `KHInsider returned HTTP ${statusCode}. Use Reload or the system browser; access restrictions are not bypassed.`;
      this.sendState();
    });
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta)) return;
      const action = input.key === "," ? "settings" : input.key === "0" ? "reset" :
        ["-", "_"].includes(input.key) ? "out" : ["=", "+"].includes(input.key) ? "in" : undefined;
      if (!action) return;
      event.preventDefault();
      this.window.webContents.send("website:shortcut", action);
    });
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.error = `Could not load KHInsider: ${description}. Try Reload or use the system browser.`;
      this.sendState();
    });
    contents.on("render-process-gone", (_event, details) => {
      this.error = `The website stopped (${details.reason}). Select Reload to try again.`;
      this.sendState();
    });
    void this.navigate(target ?? khinsiderHome);
  }

  setBounds(input: unknown): void {
    if (input === null) {
      this.view?.setVisible(false);
      return;
    }
    if (typeof input !== "object" || !input) throw new Error("Invalid website bounds");
    const bounds = input as Record<string, unknown>;
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof bounds[key] !== "number" || !Number.isFinite(bounds[key]) || bounds[key] < 0 || bounds[key] > 100_000) {
        throw new Error("Invalid website bounds");
      }
    }
    if (!this.view) return;
    const rectangle = bounds as GuiWebsiteBounds;
    const zoom = this.window.webContents.getZoomFactor();
    const area = this.window.getContentBounds();
    const x = Math.min(area.width, Math.round(rectangle.x * zoom));
    const y = Math.min(area.height, Math.round(rectangle.y * zoom));
    const width = Math.max(0, Math.min(area.width - x, Math.round(rectangle.width * zoom)));
    const height = Math.max(0, Math.min(area.height - y, Math.round(rectangle.height * zoom)));
    this.view.setBounds({ x, y, width, height });
    this.view.setVisible(width > 0 && height > 0);
  }

  async command(command: unknown): Promise<void> {
    if (!this.view) throw new Error("KHInsider browser is not open");
    const contents = this.view.webContents;
    switch (command) {
      case "back":
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        break;
      case "forward":
        if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
        break;
      case "reload":
        await this.navigate(contents.getURL() || khinsiderHome);
        break;
      case "home":
        await this.navigate(khinsiderHome);
        break;
      default:
        throw new Error("Invalid website command");
    }
  }

  useAlbum(): string {
    const url = this.view?.webContents.getURL() ?? "";
    if (!isKhinsiderAlbumUrl(url)) throw new Error("Open a KHInsider album page first");
    const album = new URL(url);
    album.hash = "";
    return album.href;
  }

  /** Returns the current track page URL and markup for adding the track to a playlist. */
  async readTrack(): Promise<{ url: string; html: string }> {
    const contents = this.view?.webContents;
    const url = contents?.getURL() ?? "";
    if (!contents || !isTrackUrl(url)) throw new Error("Open a KHInsider track page first");
    if (contents.isLoading()) throw new Error("Wait for the track page to finish loading");
    const html: unknown = await contents.executeJavaScript("document.documentElement.outerHTML");
    if (typeof html !== "string" || html.length > MAX_TRACK_PAGE_BYTES) throw new Error("Could not read the track page");
    if (contents.getURL() !== url) throw new Error("The page changed while reading it. Try again.");
    return { url: normalizeTrackUrl(url), html };
  }

  destroy(): void {
    if (!this.view) return;
    this.view.webContents.session.removeListener("will-download", this.preventDownload);
    this.window.contentView.removeChildView(this.view);
    this.view.webContents.close();
    this.view = undefined;
  }
}
