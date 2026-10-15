import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import type { InspectionBrowser } from "../khinsider.js";
import { isKhinsiderWebsiteUrl } from "../website.js";

export async function createInspectionBrowser(): Promise<InspectionBrowser> {
  const browserSession = session.fromPartition(`inspection-${randomUUID()}`);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on("will-download", (event) => event.preventDefault());
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    autoHideMenuBar: true,
    title: "KHInsider album inspection",
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  let closing: Promise<void> | undefined;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isKhinsiderWebsiteUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isKhinsiderWebsiteUrl(url)) event.preventDefault();
  });
  return {
    readPage: async (url) => {
      if (!isKhinsiderWebsiteUrl(url)) throw new Error("Invalid inspection URL");
      let status = 0;
      const onResponse = (_event: Electron.Event, _url: string, code: number): void => { status = code; };
      contents.on("did-navigate", onResponse);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          contents.loadURL(url),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              contents.stop();
              reject(new Error("Inspection page request timed out after 30 seconds"));
            }, 30_000);
          }),
        ]);
        const html: unknown = await contents.executeJavaScript("document.documentElement.outerHTML");
        if (typeof html !== "string") throw new Error("Could not read inspection page");
        return { status, html };
      } finally {
        clearTimeout(timeout);
        contents.removeListener("did-navigate", onResponse);
      }
    },
    setVisible: async (visible) => {
      if (window.isDestroyed()) throw new Error("Inspection browser has been closed");
      if (visible) window.show();
      else window.hide();
    },
    isClosed: () => window.isDestroyed(),
    onClose: (listener) => { window.on("closed", listener); },
    close: async () => {
      closing ??= (async () => {
        if (!window.isDestroyed()) window.destroy();
        await browserSession.clearStorageData();
      })();
      await closing;
    },
  };
}
