import { inspectAlbum } from "./khinsider.js";
import { planFormats } from "./formats.js";
import type { FormatPolicy } from "./formats.js";
import { downloadAlbum } from "./downloader.js";
import { defaultOutputRoot } from "./output.js";
import { resolve } from "node:path";

function usage(exitCode = 2): never {
  const inspect = process.env.K_DOWNLOADER_CHROMIUM_PATH ? "k-downloader inspect" : "npm run inspect --";
  const download = process.env.K_DOWNLOADER_CHROMIUM_PATH ? "k-downloader download" : "npm run download --";
  console.error(`Usage:\n  ${inspect} <album-url>\n  ${download} <album-url> [--format prefer-lossless|lossless-only|FORMAT] [--skip-unavailable] [--disc-label CD|Disc] [--output DIR]`);
  process.exit(exitCode);
}

function printPlan(
  album: Awaited<ReturnType<typeof inspectAlbum>>["album"],
  tracks: Awaited<ReturnType<typeof inspectAlbum>>["tracks"],
  policy: FormatPolicy,
  discLabel: "CD" | "Disc" = "CD",
): boolean {
  const plan = planFormats(tracks, policy);
  console.log(`Album: ${album.title}`);
  console.log(`Tracks: ${album.tracks.length}${album.advertisedTrackCount ? ` / ${album.advertisedTrackCount}` : ""}`);
  for (const selection of plan.tracks) {
    const { track, selected, state, reason, fallback } = selection;
    const disc = track.discNumber ? `${discLabel}${track.discNumber} · ` : "";
    const prefix = `${disc}${String(track.number).padStart(2, "0")} - ${track.title}`;
    if (selected) console.log(`${prefix}: ${selected.format}${fallback ? " (lossy fallback)" : ""}`);
    else console.log(`${prefix}: ${state}${reason ? ` (${reason})` : ""}`);
  }
  return !plan.blocked;
}

async function inspectCommand(albumUrl: string, args: string[]): Promise<void> {
  if (args.length > 0) usage();
  const { album, tracks } = await inspectAlbum(albumUrl);
  if (printPlan(album, tracks, { kind: "prefer-lossless" })) {
    console.log("Format preview complete; no audio was downloaded.");
  } else process.exitCode = 1;
}

async function downloadCommand(albumUrl: string, args: string[]): Promise<void> {
  let format = "prefer-lossless";
  let outputRoot = defaultOutputRoot();
  let discLabel: "CD" | "Disc" = "CD";
  let skipUnavailable = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-unavailable") skipUnavailable = true;
    else if (arg === "--format" || arg === "--output" || arg === "--disc-label") {
      const value = args[index + 1];
      if (!value) usage();
      index += 1;
      if (arg === "--format") format = value;
      else if (arg === "--output") outputRoot = value;
      else if (value === "CD" || value === "Disc") discLabel = value;
      else throw new Error("--disc-label must be CD or Disc");
    } else usage();
  }
  if (skipUnavailable && format.toLowerCase() === "prefer-lossless") {
    throw new Error("--skip-unavailable is only valid with lossless-only or a specific --format");
  }

  const policy: FormatPolicy = format.toLowerCase() === "prefer-lossless"
    ? { kind: "prefer-lossless" }
    : format.toLowerCase() === "lossless-only"
      ? { kind: "lossless-only", skipUnavailable }
      : { kind: "specific", format, skipUnavailable };
  const sourceAlbum = new URL(albumUrl).href;
  const { album, tracks } = await inspectAlbum(sourceAlbum);
  if (!printPlan(album, tracks, policy, discLabel)) {
    console.error("No audio was downloaded. Resolve unavailable formats or explicitly pass --skip-unavailable.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nDestination: ${outputRoot}`);
  console.log("Starting sequential transfers...");
  const result = await downloadAlbum({ sourceAlbum, album, tracks, outputRoot: resolve(outputRoot), policy, discLabel });
  console.log(`\nAlbum result: ${result.state}`);
  console.log(`Folder: ${result.directory}`);
  if (result.state !== "complete") process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, albumUrl, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "help" || albumUrl === "--help") usage(0);
  if (!albumUrl) usage();
  if (command === "inspect") await inspectCommand(albumUrl, args);
  else if (command === "download") await downloadCommand(albumUrl, args);
  else usage();
}

main().catch((error: unknown) => {
  console.error(`K-Downloader failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});