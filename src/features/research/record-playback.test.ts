import { describe, expect, it } from "vitest";
import { loadPlaybackPreferences, playbackDelayMs, resolvePlaybackStep, savePlaybackPreferences } from "./record-playback";

describe("record playback", () => {
  it("stops at a branch when configured to pause", () => {
    expect(resolvePlaybackStep(["a", "b"], "b", "pause")).toEqual({ kind: "branch" });
  });

  it("follows the preferred child, then falls back to the first child", () => {
    expect(resolvePlaybackStep(["a", "b"], "b", "mainline")).toEqual({ kind: "advance", targetId: "b" });
    expect(resolvePlaybackStep(["a", "b"], "missing", "mainline")).toEqual({ kind: "advance", targetId: "a" });
  });

  it("reports the end and maps speed to shorter delays", () => {
    expect(resolvePlaybackStep([], undefined, "pause")).toEqual({ kind: "end" });
    expect(playbackDelayMs(2)).toBeLessThan(playbackDelayMs(1));
    expect(playbackDelayMs(0.5)).toBeGreaterThan(playbackDelayMs(1));
  });

  it("persists playback preferences with compatible defaults", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    savePlaybackPreferences({ speed: 1.5, branchPolicy: "mainline", loop: true }, storage);
    expect(loadPlaybackPreferences(storage)).toEqual({ speed: 1.5, branchPolicy: "mainline", loop: true });
    values.clear();
    values.set("banbu-record-playback-preferences-v1", "{not-json");
    expect(loadPlaybackPreferences(storage)).toEqual({ speed: 1, branchPolicy: "pause", loop: false });
  });
});
