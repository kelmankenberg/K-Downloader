#!/usr/bin/env node

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parse } from "parse5";

const DEFAULT_ALBUM_URL =
  "https://downloads.khinsider.com/game-soundtracks/album/unreal-ii-the-awakening-original-soundtrack";
const SITE_HOST = "downloads.khinsider.com";
const USER_AGENT = `Khinsider-Downloader-feasibility-probe/0.1${process.env.KHINSIDER_DOWNLOADER_CONTACT ? ` (${process.env.KHINSIDER_DOWNLOADER_CONTACT})` : ""}`;
const PAGE_LIMIT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const REDIRECT_LIMIT = 5;
const AUDIO_FORMATS = ["mp3", "flac", "ogg", "opus", "m4a", "aac", "wav", "wma", "alac"];

function usage() {
  console.log(`Usage: node verify-khinsider-access.mjs [album-url] [options]

Options:
  --media-url URL       Probe this media URL directly (no album-page request)
  --expected-tracks N   Require exactly N discovered track links
  --probe-media         Make one bounded request to the first audio link found
  --max-media-bytes N   Maximum response bytes read (default: 65536; max: 65536)
  --help                Show this help

Without --probe-media or --media-url, the script stops after resolving an audio
link on one track page. No login, cookies, or full audio downloads are used.`);
}

function parseArgs(args) {
  let albumUrl = DEFAULT_ALBUM_URL;
  let mediaUrl;
  let expectedTracks;
  let probeMedia = false;
  let maxMediaBytes = 65_536;
  let urlSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--probe-media") {
      probeMedia = true;
    } else if (arg === "--media-url") {
      if (!args[index + 1]) throw new Error("--media-url requires a URL");
      mediaUrl = new URL(args[index + 1]);
      index += 1;
    } else if (arg === "--expected-tracks" || arg === "--max-media-bytes") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${arg} requires a positive integer`);
      }
      index += 1;
      if (arg === "--expected-tracks") expectedTracks = value;
      else maxMediaBytes = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!urlSeen) {
      albumUrl = arg;
      urlSeen = true;
    } else {
      throw new Error("Provide at most one album URL");
    }
  }

  if (maxMediaBytes > 65_536) {
    throw new Error("--max-media-bytes cannot exceed 65536");
  }

  if (mediaUrl) {
    if (urlSeen || probeMedia || expectedTracks !== undefined) {
      throw new Error("--media-url cannot be combined with an album URL, --probe-media, or --expected-tracks");
    }
    if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password) {
      throw new Error("Media URL must use HTTPS and must not contain URL credentials");
    }
  } else {
    const parsedAlbumUrl = new URL(albumUrl);
    if (
      parsedAlbumUrl.protocol !== "https:" ||
      parsedAlbumUrl.hostname.toLowerCase() !== SITE_HOST ||
      parsedAlbumUrl.username ||
      parsedAlbumUrl.password ||
      !parsedAlbumUrl.pathname.startsWith("/game-soundtracks/album/")
    ) {
      throw new Error(`Album URL must be an HTTPS KHInsider album URL on ${SITE_HOST}`);
    }
    albumUrl = parsedAlbumUrl;
  }

  return { albumUrl, mediaUrl, expectedTracks, probeMedia, maxMediaBytes };
}

function displayUrl(url) {
  return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}`;
}

function nodeText(node) {
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? []).map(nodeText).join(" ").replace(/\s+/g, " ").trim();
}

function* walk(node) {
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

function attributes(node) {
  return Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
}

function hrefFrom(node, baseUrl) {
  const href = attributes(node).href;
  if (!href) return undefined;
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function numberedRow(row) {
  const cells = (row.childNodes ?? []).filter((node) => node.tagName === "td" || node.tagName === "th");
  return cells.some((cell) => /^\s*\d+\.?\s*$/.test(nodeText(cell)));
}

function findTracks(document, albumUrl) {
  const tracks = [];
  const seen = new Set();
  for (const row of walk(document)) {
    if (row.tagName !== "tr" || !numberedRow(row)) continue;
    const rowLinks = [...walk(row)].filter((node) => node.tagName === "a");
    const candidates = rowLinks
      .map((node) => ({ node, url: hrefFrom(node, albumUrl), title: nodeText(node) }))
      .filter(({ url }) =>
        url &&
        url.hostname.toLowerCase() === SITE_HOST &&
        url.pathname.startsWith("/game-soundtracks/album/") &&
        url.pathname.replace(/\/$/, "") !== albumUrl.pathname.replace(/\/$/, "") &&
        !url.pathname.startsWith("/cp/")
      );

    const chosen = candidates.find(({ title }) => title.length > 0) ?? candidates[0];
    if (chosen && !seen.has(chosen.url.href)) {
      seen.add(chosen.url.href);
      tracks.push({ title: chosen.title || `Track ${tracks.length + 1}`, url: chosen.url });
    }
  }
  return tracks;
}

function findAdvertisedTrackCount(document) {
  const text = nodeText(document);
  const match = text.match(/Number of Files:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function audioFormat(url, label) {
  const match = `${url.pathname} ${label}`.match(new RegExp(`\\b(${AUDIO_FORMATS.join("|")})\\b`, "i"));
  return match?.[1]?.toUpperCase();
}

function findAudioLinks(document, pageUrl) {
  const links = [];
  const seen = new Set();
  for (const node of walk(document)) {
    let url;
    let label;
    if (node.tagName === "a") {
      url = hrefFrom(node, pageUrl);
      label = nodeText(node);
    } else if (node.tagName === "source" || node.tagName === "audio") {
      const attrs = attributes(node);
      url = attrs.src ? hrefFrom({ attrs: [{ name: "href", value: attrs.src }] }, pageUrl) : undefined;
      label = attrs.type ?? "audio source";
    }
    if (!url || seen.has(url.href)) continue;
    const format = audioFormat(url, label);
    if (format || /download/i.test(label)) {
      seen.add(url.href);
      links.push({ url, label: label || "audio download", format });
    }
  }
  return links;
}

function isPrivateAddress(address) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  const octets = address.split(".").map(Number);
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] >= 224
  );
}

async function validateMediaUrl(url) {
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`Refusing non-public or non-HTTPS media URL: ${url.origin}`);
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`Refusing private media IP: ${hostname}`);
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Refusing media host that resolves to a private address: ${hostname}`);
  }
}

async function requestFollowingRedirects(initialUrl, { media = false, headers = {} } = {}) {
  let url = new URL(initialUrl);
  for (let redirectCount = 0; redirectCount <= REDIRECT_LIMIT; redirectCount += 1) {
    if (media) await validateMediaUrl(url);
    else if (url.protocol !== "https:" || url.hostname.toLowerCase() !== SITE_HOST) {
      throw new Error(`Refusing album or track redirect outside https://${SITE_HOST}`);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url };

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error(`Redirect from ${url.origin} did not include a Location header`);
    if (redirectCount === REDIRECT_LIMIT) throw new Error(`More than ${REDIRECT_LIMIT} redirects`);
    url = new URL(location, url);
  }
  throw new Error("Redirect limit exceeded");
}

async function readLimited(response, byteLimit) {
  if (!response.body) return { bytes: 0, truncated: false, data: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  while (bytes < byteLimit) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = byteLimit - bytes;
    const chunk = value.subarray(0, remaining);
    chunks.push(Buffer.from(chunk));
    bytes += chunk.length;
    if (chunk.length < value.length || bytes === byteLimit) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  return { bytes, truncated, data: Buffer.concat(chunks) };
}

async function fetchHtml(url) {
  const { response, url: finalUrl } = await requestFollowingRedirects(url);
  console.log(`GET ${displayUrl(url)} -> HTTP ${response.status} (${displayUrl(finalUrl)})`);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Page request failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "unknown";
  if (!contentType.toLowerCase().includes("text/html")) {
    await response.body?.cancel();
    throw new Error(`Expected an HTML page, received ${contentType}`);
  }
  const result = await readLimited(response, PAGE_LIMIT_BYTES);
  if (result.truncated) throw new Error(`HTML response exceeded ${PAGE_LIMIT_BYTES} bytes`);
  return { document: parse(result.data.toString("utf8")), finalUrl };
}

async function probeMedia(candidate, maxBytes) {
  console.log(`\nBounded media probe: ${displayUrl(candidate.url)}`);
  const { response, url } = await requestFollowingRedirects(candidate.url, {
    media: true,
    headers: { range: "bytes=0-0" },
  });
  const contentType = response.headers.get("content-type") ?? "unknown";
  const contentRange = response.headers.get("content-range");
  const responseLimit = response.status === 206 && /^bytes 0-0\//i.test(contentRange ?? "") ? 1 : maxBytes;
  const result = await readLimited(response, responseLimit);
  console.log(`GET with Range: bytes=0-0 -> HTTP ${response.status} (${displayUrl(url)})`);
  console.log(`Content-Type: ${contentType}; Content-Range: ${contentRange ?? "not provided"}`);
  console.log(`Read ${result.bytes} byte(s)${result.truncated ? ` (stopped at the ${responseLimit}-byte limit)` : ""}.`);

  if (!response.ok) throw new Error(`Media request failed with HTTP ${response.status}`);
  if (/text\/html/i.test(contentType)) throw new Error("Media link returned HTML, not audio");
  if (!(contentType.toLowerCase().startsWith("audio/") || /application\/octet-stream/i.test(contentType))) {
    throw new Error(`Media response has an unexpected content type: ${contentType}`);
  }
  if (result.bytes === 0) throw new Error("Media endpoint returned no response bytes");
  if (/application\/octet-stream/i.test(contentType) && !candidate.format) {
    console.warn("Warning: generic binary content type; audio could not be confirmed from MIME type or link format.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Probe user-agent: ${USER_AGENT}`);
  console.log("Authentication: none; cookies: none; automatic retries: none");
  if (options.mediaUrl) {
    const candidate = { url: options.mediaUrl, format: audioFormat(options.mediaUrl, "") };
    await probeMedia(candidate, options.maxMediaBytes);
    console.log("\nRESULT: PASS for the direct media check.");
    return;
  }

  console.log(`Album: ${displayUrl(options.albumUrl)}\n`);

  const { document: albumDocument, finalUrl: albumFinalUrl } = await fetchHtml(options.albumUrl);
  const advertisedCount = findAdvertisedTrackCount(albumDocument);
  const tracks = findTracks(albumDocument, albumFinalUrl);
  console.log(`Advertised tracks: ${advertisedCount ?? "not found"}`);
  console.log(`Track-page links found in numbered rows: ${tracks.length}`);
  tracks.forEach((track, index) => console.log(`  ${index + 1}. ${track.title}: ${displayUrl(track.url)}`));

  const expectedTracks = options.expectedTracks ?? advertisedCount;
  if (expectedTracks && tracks.length !== expectedTracks) {
    throw new Error(`Expected ${expectedTracks} track links but found ${tracks.length}`);
  }
  if (tracks.length === 0) throw new Error("No track-page links were found in numbered table rows");

  const track = tracks[0];
  console.log(`\nInspecting one track page: ${track.title}`);
  const { document: trackDocument, finalUrl: trackFinalUrl } = await fetchHtml(track.url);
  const audioLinks = findAudioLinks(trackDocument, trackFinalUrl);
  if (audioLinks.length === 0) throw new Error("No audio/download link was found on the track page");
  console.log(`Audio/download links found: ${audioLinks.length}`);
  audioLinks.forEach((link) => console.log(`  ${link.format ?? "format unknown"}: ${link.label} -> ${displayUrl(link.url)}`));

  if (options.probeMedia) await probeMedia(audioLinks[0], options.maxMediaBytes);
  else console.log("\nMedia request not made. Re-run with --probe-media to test the first audio link.");

  console.log("\nRESULT: PASS for the checks performed.");
}

main().catch((error) => {
  console.error(`\nRESULT: FAIL: ${error.message}`);
  process.exitCode = 1;
});