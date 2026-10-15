import type { GuiWebsiteState, WebsiteTarget } from "./gui-types.js";
import { isKhinsiderAlbumUrl, websiteTargetStorageKey } from "./website.js";

export function initializeWebsiteControls(options: {
  showBrowser: () => void;
  showDownloader: (albumUrl?: string) => void;
}): { isOpen: () => boolean; syncBounds: () => void } {
  const page = document.querySelector<HTMLElement>("#website-view")!;
  const host = document.querySelector<HTMLElement>("#website-host")!;
  const setting = document.querySelector<HTMLSelectElement>("#website-target")!;
  const storageStatus = document.querySelector<HTMLElement>("#website-storage-status")!;
  const errorText = document.querySelector<HTMLElement>("#website-error")!;
  const address = document.querySelector<HTMLInputElement>("#website-address")!;
  const status = document.querySelector<HTMLElement>("#website-status")!;
  const back = document.querySelector<HTMLButtonElement>("#website-back")!;
  const forward = document.querySelector<HTMLButtonElement>("#website-forward")!;
  const useAlbum = document.querySelector<HTMLButtonElement>("#website-use-album")!;
  const link = document.querySelector<HTMLAnchorElement>("#khinsider-link")!;
  let opened = false;
  let target: WebsiteTarget = "external";
  try {
    const stored = localStorage.getItem(websiteTargetStorageKey);
    if (stored === "internal" || stored === "external") target = stored;
    else if (stored !== null) storageStatus.textContent = "The saved browser choice is invalid. Select a browser option again.";
  } catch {
    storageStatus.textContent = "The saved browser choice could not be read. Using the system browser for this session.";
  }
  function updateSetting(): void {
    setting.value = target;
    link.title = target === "internal" ? "Open KHInsider inside the app" : "Open KHInsider in your default system browser";
  }
  updateSetting();
  setting.addEventListener("change", () => {
    target = setting.value === "internal" ? "internal" : "external";
    updateSetting();
    try {
      localStorage.setItem(websiteTargetStorageKey, target);
      storageStatus.textContent = "";
    } catch {
      storageStatus.textContent = "Browser choice could not be saved. Changes apply to this session only.";
    }
  });

  function reportError(error: unknown): void {
    errorText.textContent = error instanceof Error ? error.message : String(error);
  }

  function syncBounds(): void {
    const overlayOpen = !document.querySelector<HTMLElement>("#more-menu")!.hidden ||
      !!document.querySelector('.changelog-drawer[data-open="true"]');
    const rect = host.getBoundingClientRect();
    const visible = opened && !page.hidden && !overlayOpen && rect.width > 0 && rect.height > 0;
    void window.khinsiderDownloader.setWebsiteBounds(visible
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null).catch(reportError);
  }

  link.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await window.khinsiderDownloader.openKhinsider(target);
      if (target === "internal") {
        opened = true;
        options.showBrowser();
        syncBounds();
        document.querySelector<HTMLButtonElement>("#website-close")!.focus();
      }
    } catch (error) {
      document.querySelector<HTMLElement>("#error-text")!.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  function close(albumUrl?: string): void {
    opened = false;
    options.showDownloader(albumUrl);
    syncBounds();
  }
  document.querySelector("#website-close")!.addEventListener("click", () => close());
  useAlbum.addEventListener("click", async () => {
    try {
      close(await window.khinsiderDownloader.useWebsiteAlbum());
    } catch (error) {
      reportError(error);
    }
  });
  for (const command of ["back", "forward", "reload", "home"] as const) {
    document.querySelector(`#website-${command}`)!.addEventListener("click", () => {
      errorText.textContent = "";
      void window.khinsiderDownloader.websiteCommand(command).catch(reportError);
    });
  }
  window.khinsiderDownloader.onWebsiteState((state: GuiWebsiteState) => {
    address.value = state.url;
    status.textContent = state.loading ? "Loading KHInsider..." : "KHInsider";
    back.disabled = !state.canGoBack;
    forward.disabled = !state.canGoForward;
    useAlbum.disabled = state.loading || !!state.error || !isKhinsiderAlbumUrl(state.url);
    errorText.textContent = state.error;
  });
  new ResizeObserver(syncBounds).observe(host);
  window.addEventListener("resize", syncBounds);
  const observer = new MutationObserver(syncBounds);
  observer.observe(page, { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(document.querySelector("#more-menu")!, { attributes: true, attributeFilter: ["hidden"] });
  document.querySelectorAll(".changelog-drawer").forEach((drawer) => {
    observer.observe(drawer, { attributes: true, attributeFilter: ["data-open"] });
  });
  return { isOpen: () => opened, syncBounds };
}
