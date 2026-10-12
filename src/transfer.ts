import { createWriteStream } from "node:fs";
import { link, lstat, mkdir, rm, stat, unlink } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REDIRECT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 30_000;

export type TransferOptions = {
  allowedHosts: ReadonlySet<string>;
  expectedFormat: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveAddresses?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
};

export type TransferResult = {
  bytes: number;
  contentType: string;
};

export class MediaResponseError extends Error {
  constructor(readonly status: number) {
    super(`Media request failed with HTTP ${status}`);
    this.name = "MediaResponseError";
  }
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) return isPrivateAddress(mappedIpv4[1]);
    if (normalized === "::" || normalized === "::1") return true;
    const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return firstSegment === 0 ||
      (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
      (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
      firstSegment >= 0xff00;
  }

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

async function validateMediaUrl(
  url: URL,
  allowedHosts: ReadonlySet<string>,
  resolveAddresses: NonNullable<TransferOptions["resolveAddresses"]>,
): Promise<void> {
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.has(hostname)) {
    throw new Error(`Refusing media URL outside the approved HTTPS hosts: ${url.origin}`);
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`Refusing private media IP: ${hostname}`);
    return;
  }
  const addresses = await resolveAddresses(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Refusing media host that resolves to a private address: ${hostname}`);
  }
}

async function requestMedia(url: URL, options: TransferOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveAddresses = options.resolveAddresses ?? ((hostname) => dnsLookup(hostname, { all: true }));
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= REDIRECT_LIMIT; redirectCount += 1) {
    await validateMediaUrl(currentUrl, options.allowedHosts, resolveAddresses);
    const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (options.signal) signals.push(options.signal);
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.any(signals),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Media redirect did not include a Location header");
    if (redirectCount === REDIRECT_LIMIT) throw new Error(`More than ${REDIRECT_LIMIT} media redirects`);
    currentUrl = new URL(location, currentUrl);
  }
  throw new Error("Media redirect limit exceeded");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function streamMediaToFile(
  mediaUrl: URL,
  outputPath: string,
  options: TransferOptions,
): Promise<TransferResult> {
  if (await pathExists(outputPath)) throw new Error(`File already exists: ${outputPath}`);
  const partialPath = `${outputPath}.part`;
  if (await pathExists(partialPath)) throw new Error(`Partial file already exists: ${partialPath}`);

    await mkdir(dirname(outputPath), { recursive: true });
  let response: Response | undefined;
  let partialCreated = false;
  try {
    response = await requestMedia(mediaUrl, options);
    if (response.status !== 200) throw new MediaResponseError(response.status);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!(contentType.startsWith("audio/") || contentType === "application/octet-stream")) {
      await response.body?.cancel();
      throw new Error(`Expected audio data, received ${contentType || "unknown content type"}`);
    }
    if (contentType === "application/octet-stream" && !options.expectedFormat.trim()) {
      await response.body?.cancel();
      throw new Error("Generic binary response requires a discovered audio format");
    }
    const expectedTypes: Record<string, string[]> = {
      MP3: ["audio/mpeg", "audio/mp3"],
      FLAC: ["audio/flac", "audio/x-flac"],
      OGG: ["audio/ogg", "application/ogg"],
      OPUS: ["audio/ogg", "audio/opus"],
      WAV: ["audio/wav", "audio/x-wav", "audio/wave"],
      M4A: ["audio/mp4", "audio/x-m4a"],
      AAC: ["audio/aac", "audio/x-aac"],
      WMA: ["audio/x-ms-wma", "audio/wma"],
      ALAC: ["audio/mp4", "audio/x-m4a"],
    };
    const acceptedTypes = expectedTypes[options.expectedFormat.toUpperCase()];
    if (contentType !== "application/octet-stream" && acceptedTypes && !acceptedTypes.includes(contentType)) {
      await response.body?.cancel();
      throw new Error(`Expected ${options.expectedFormat} audio, received ${contentType}`);
    }
    if (!response.body) throw new Error("Media response has no body");

    const contentLengthHeader = response.headers.get("content-length");
    const expectedLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : undefined;
    const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    partialCreated = true;
    await pipeline(source, createWriteStream(partialPath, { flags: "wx" }), {
      signal: options.signal,
    });
    const file = await stat(partialPath);
    if (file.size === 0) throw new Error("Media response was empty");
    if (expectedLength !== undefined && file.size !== expectedLength) {
      throw new Error(`Incomplete media response: expected ${expectedLength} bytes, received ${file.size}`);
    }

    await link(partialPath, outputPath);
    await unlink(partialPath);
    partialCreated = false;
    return { bytes: file.size, contentType };
  } catch (error) {
    await response?.body?.cancel().catch(() => undefined);
    if (partialCreated) await rm(partialPath, { force: true });
    throw error;
  }
}