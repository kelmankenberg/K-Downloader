import type { AudioLink, DiscoveredTrack } from "./khinsider.js";

const LOSSLESS_PREFERENCE = ["FLAC", "ALAC", "WAV"];

export type FormatPolicy =
  | { kind: "prefer-lossless" }
  | { kind: "lossless-only"; skipUnavailable?: boolean }
  | { kind: "specific"; format: string; skipUnavailable?: boolean };

export type TrackFormatSelection = {
  track: DiscoveredTrack;
  selected?: AudioLink;
  fallback?: boolean;
  state: "ready" | "skipped" | "unavailable";
  reason?: string;
};

export type FormatPlan = {
  tracks: TrackFormatSelection[];
  blocked: boolean;
  incomplete: boolean;
};

function selectLossless(links: AudioLink[]): AudioLink | undefined {
  for (const format of LOSSLESS_PREFERENCE) {
    const match = links.find((link) => link.format.toUpperCase() === format);
    if (match) return match;
  }
  return undefined;
}

export function planFormats(tracks: DiscoveredTrack[], policy: FormatPolicy): FormatPlan {
  const planned = tracks.map((track): TrackFormatSelection => {
    let selected: AudioLink | undefined;
    if (policy.kind === "prefer-lossless") {
      const lossless = selectLossless(track.audioLinks);
      selected = lossless
        ?? track.audioLinks.find((link) => link.format.toUpperCase() === "MP3")
        ?? track.audioLinks[0];
      if (selected) return { track, selected, fallback: !lossless, state: "ready" };
      return { track, state: "unavailable", reason: "No audio format was discovered" };
    }

    const requested = policy.kind === "specific" ? policy.format.toUpperCase() : undefined;
    selected = requested
      ? track.audioLinks.find((link) => link.format.toUpperCase() === requested)
      : selectLossless(track.audioLinks);
    if (selected) return { track, selected, state: "ready" };

    const reason = requested ? `${requested} is unavailable` : "No lossless format is available";
    return policy.skipUnavailable
      ? { track, state: "skipped", reason }
      : { track, state: "unavailable", reason };
  });

  const unavailable = planned.some((selection) => selection.state === "unavailable");
  const skipped = planned.some((selection) => selection.state === "skipped");
  return {
    tracks: planned,
    blocked: unavailable,
    incomplete: skipped,
  };
}
export function formatsFromLinks(links: AudioLink[]): string[] {
  return [...new Set(links.map(({ format }) => format.toUpperCase()))];
}
