import { describe, expect, it } from "vitest";
import { planFormats } from "../src/formats.js";
import type { DiscoveredTrack } from "../src/khinsider.js";

function track(number: number, formats: string[]): DiscoveredTrack {
  return {
    number,
    title: `Track ${number}`,
    pageUrl: new URL(`https://downloads.khinsider.com/game-soundtracks/album/test/${number}.mp3`),
    audioLinks: formats.map((format) => ({
      format,
      url: new URL(`https://media.example.test/${number}.${format.toLowerCase()}`),
    })),
  };
}

describe("format policy", () => {
  it("prefers lossless and marks a lossy fallback", () => {
    const plan = planFormats([track(1, ["MP3", "FLAC"]), track(2, ["MP3"]), track(3, [])], {
      kind: "prefer-lossless",
    });
    expect(plan.tracks.map(({ selected, fallback, state }) => [selected?.format, fallback, state])).toEqual([
      ["FLAC", false, "ready"],
      ["MP3", true, "ready"],
      [undefined, undefined, "unavailable"],
    ]);
    expect(plan.blocked).toBe(true);
  });

  it("blocks lossless-only runs unless missing tracks are explicitly skipped", () => {
    const tracks = [track(1, ["FLAC", "MP3"]), track(2, ["MP3"] )];
    const blocked = planFormats(tracks, { kind: "lossless-only" });
    expect(blocked.blocked).toBe(true);
    expect(blocked.incomplete).toBe(false);
    const skipped = planFormats(tracks, { kind: "lossless-only", skipUnavailable: true });
    expect(skipped.blocked).toBe(false);
    expect(skipped.incomplete).toBe(true);
    expect(skipped.tracks[1].state).toBe("skipped");
  });

  it("never substitutes a missing explicitly selected format", () => {
    const plan = planFormats([track(1, ["MP3"])], { kind: "specific", format: "FLAC" });
    expect(plan.blocked).toBe(true);
    expect(plan.tracks[0].selected).toBeUndefined();
    expect(plan.tracks[0].reason).toBe("FLAC is unavailable");
  });
});