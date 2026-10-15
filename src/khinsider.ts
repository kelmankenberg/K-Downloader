import { chromium, type BrowserContext } from "playwright";
import { parse } from "parse5";
import { setTimeout as delay } from "node:timers/promises";

const SITE_HOST = "downloads.khinsider.com";
const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "ogg", "opus", "m4a", "aac", "wav", "wma", "alac"]);

export type TrackLink = {
  discNumber?: number;
  number: number;
  title: string;
  pageUrl: URL;
};

export type AudioLink = {
  format: string;
  url: URL;
};

export type AlbumPage = {
  title: string;
  advertisedTrackCount?: number;
  tracks: TrackLink[];
};

export type DiscoveredTrack = TrackLink & {
  audioLinks: AudioLink[];
};

export type InspectionOptions = {
  signal?: AbortSignal;
  onBrowserReady?: (setVisible: (visible: boolean) => Promise<void>) => void;
};

function* walk(node: any): Generator<any> {
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

function textContent(node: any): string {
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? []).map(textContent).join(" ").replace(/\s+/g, " ").trim();
}

function href(node: any, baseUrl: URL): URL | undefined {
  const value = node.attrs?.find((attribute: any) => attribute.name === "href")?.value;
  if (!value) return undefined;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function numberedTrack(
  row: any,
  albumUrl: URL,
  columns: { disc: number; track: number },
): TrackLink | undefined {
  const cells = (row.childNodes ?? []).filter((node: any) => node.tagName === "td" || node.tagName === "th");
  const cellNumber = (index: number): number | undefined => {
    if (index < 0 || index >= cells.length) return undefined;
    const value = textContent(cells[index]);
    return /^\s*\d+\.?\s*$/.test(value) ? Number.parseInt(value, 10) : undefined;
  };
  const discNumber = cellNumber(columns.disc);
  const number = cellNumber(columns.track);
  if (number === undefined) return undefined;

  const anchors = [...walk(row)].filter((node) => node.tagName === "a");
  for (const anchor of anchors) {
    const pageUrl = href(anchor, albumUrl);
    if (
      !pageUrl ||
      pageUrl.hostname.toLowerCase() !== SITE_HOST ||
      !pageUrl.pathname.startsWith(`${albumUrl.pathname.replace(/\/$/, "")}/`)
    ) continue;

    const title = textContent(anchor);
    if (!title) continue;
    return { ...(discNumber === undefined ? {} : { discNumber }), number, title, pageUrl };
  }
  return undefined;
}

export function validateAlbumUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== SITE_HOST ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/game-soundtracks/album/")
  ) {
    throw new Error(`Expected an HTTPS KHInsider album URL on ${SITE_HOST}`);
  }
  url.hash = "";
  return url;
}

export function parseAlbumPage(html: string, albumUrl: URL): AlbumPage {
  const document = parse(html);
  const text = textContent(document);
  const advertisedMatch = text.match(/Number of Files:\s*(\d+)/i);
  const pageTitle = [...walk(document)].find((node) => node.tagName === "title");
  const titleMatch = pageTitle && textContent(pageTitle).match(
    /^(.*?)\s+(?:MP3|FLAC|OGG|OPUS|M4A|AAC|WAV|WMA|ALAC)\s+-\s+Download Soundtracks/i,
  );
  const heading = [...walk(document)].find((node) => node.tagName === "h2" || node.tagName === "h1");
  const rows = [...walk(document)].filter((node) => node.tagName === "tr");
  const header = rows.find((row) => [...walk(row)].some((node) => node.tagName === "th"));
  const headers = header
    ? (header.childNodes ?? []).filter((node: any) => node.tagName === "th" || node.tagName === "td").map(textContent)
    : [];
  const discColumn = headers.findIndex((label: string) => /^\s*(?:cd|disc(?:\s*(?:number|#))?)\s*$/i.test(label));
  const trackColumn = headers.findIndex((label: string) => /^\s*(?:#|track(?:\s*(?:number|#))?)\s*$/i.test(label));
  const tracks = [...walk(document)]
    .filter((node) => node.tagName === "tr")
    .map((row) => {
      const cells = (row.childNodes ?? []).filter((node: any) => node.tagName === "td" || node.tagName === "th");
      const numericIndices = cells
        .map((cell: any, index: number) => /^\s*\d+\.?\s*$/.test(textContent(cell)) ? index : -1)
        .filter((index: number) => index >= 0);
      const disc = discColumn >= 0 ? discColumn : numericIndices.length > 1 ? numericIndices[0] : -1;
      const track = trackColumn >= 0
        ? trackColumn
        : numericIndices.find((index: number) => index !== disc) ?? numericIndices[0] ?? -1;
      return numberedTrack(row, albumUrl, { disc, track });
    })
    .filter((track): track is TrackLink => track !== undefined);

  return {
    title: titleMatch?.[1] ?? (heading ? textContent(heading) : albumUrl.pathname.split("/").filter(Boolean).at(-1) ?? "Album"),
    advertisedTrackCount: advertisedMatch ? Number(advertisedMatch[1]) : undefined,
    tracks,
  };
}

export function parseTrackPage(html: string, trackUrl: URL): AudioLink[] {
  const document = parse(html);
  const links: AudioLink[] = [];
  const seen = new Set<string>();

  for (const anchor of [...walk(document)].filter((node) => node.tagName === "a")) {
    const label = textContent(anchor);
    if (!/click here to download as/i.test(label)) continue;
    const url = href(anchor, trackUrl);
    if (!url || seen.has(url.href)) continue;
    const extension = url.pathname.split(".").at(-1)?.toLowerCase();
    const format = extension && AUDIO_EXTENSIONS.has(extension) ? extension.toUpperCase() : undefined;
    if (!format) continue;
    seen.add(url.href);
    links.push({ format, url });
  }

  return links;
}

export async function inspectAlbum(
  input: string,
  options: InspectionOptions = {},
): Promise<{ album: AlbumPage; tracks: DiscoveredTrack[] }> {
  const albumUrl = validateAlbumUrl(input);
  options.signal?.throwIfAborted();
  const browser = await chromium.launch({
    headless: false,
    args: ["--start-minimized"],
    ...(process.env.KHINSIDER_DOWNLOADER_CHROMIUM_PATH ? { executablePath: process.env.KHINSIDER_DOWNLOADER_CHROMIUM_PATH } : {}),
  });
  let context: BrowserContext | undefined;
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    void browser.close().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    options.signal?.throwIfAborted();
    context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("close", () => controller.abort());
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    let browserVisible: boolean | undefined;
    const setBrowserVisible = async (visible: boolean): Promise<void> => {
      if (page.isClosed()) throw new Error("Inspection browser has been closed");
      if (browserVisible === visible) return;
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: visible ? "normal" : "minimized" },
      });
      browserVisible = visible;
    };
    await setBrowserVisible(false);
    options.onBrowserReady?.(setBrowserVisible);

    const albumResponse = await page.goto(albumUrl.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!albumResponse || !albumResponse.ok()) {
      throw new Error(`Album page request failed with HTTP ${albumResponse?.status() ?? "no response"}`);
    }

    const album = parseAlbumPage(await albumResponse.text(), albumUrl);
    if (album.advertisedTrackCount !== undefined && album.tracks.length !== album.advertisedTrackCount) {
      throw new Error(`Album advertises ${album.advertisedTrackCount} tracks but ${album.tracks.length} track links were found`);
    }
    if (album.tracks.length === 0) throw new Error("No numbered track-page links were found");

    const tracks: DiscoveredTrack[] = [];
    for (const [index, track] of album.tracks.entries()) {
      if (controller.signal.aborted || page.isClosed()) throw new Error("Inspection browser was closed before inspection completed");
      if (index > 0) await delay(1_000, undefined, { signal: controller.signal });
      const trackResponse = await page.goto(track.pageUrl.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!trackResponse || !trackResponse.ok()) {
        throw new Error(`Track ${track.number} page request failed with HTTP ${trackResponse?.status() ?? "no response"}`);
      }
      tracks.push({ ...track, audioLinks: parseTrackPage(await trackResponse.text(), track.pageUrl) });
    }

    options.signal?.throwIfAborted();
    return { album, tracks };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}