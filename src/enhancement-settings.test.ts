// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENHANCEMENT_SETTINGS, ENHANCEMENT_SETTINGS_KEY, loadEnhancementSettings, normalizeEnhancementSettings, saveEnhancementSettings } from "./enhancement-settings";

describe("enhancement settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults every optional enhancement to off", () => {
    expect(loadEnhancementSettings()).toEqual(DEFAULT_ENHANCEMENT_SETTINGS);
  });

  it("only accepts explicit true values for opt-in features, but defaults moves labels on", () => {
    expect(normalizeEnhancementSettings({ tabletSplit: 1, gestureZoom: 1, gestureSwipe: "yes", recentImports: true, aiBoardHints: false, coachMarks: null })).toEqual({
      tabletSplit: false,
      gestureZoom: false,
      gestureSwipe: false,
      recentImports: true,
      aiBoardHints: false,
      coachMarks: false,
      movesTextDisplay: true,
      dockMergeMoves: false,
    });
  });

  it("honours explicit opt-out of moves labels and opt-in of dock-merged moves", () => {
    expect(normalizeEnhancementSettings({ movesTextDisplay: false, dockMergeMoves: true })).toMatchObject({ movesTextDisplay: false, dockMergeMoves: true });
  });

  it("persists the user's choices", () => {
    const value = { ...DEFAULT_ENHANCEMENT_SETTINGS, tabletSplit: true, gestureZoom: true, recentImports: true };
    saveEnhancementSettings(value);
    expect(JSON.parse(localStorage.getItem(ENHANCEMENT_SETTINGS_KEY) || "null")).toEqual(value);
    expect(loadEnhancementSettings()).toEqual(value);
  });

  it("recovers safely from malformed storage", () => {
    localStorage.setItem(ENHANCEMENT_SETTINGS_KEY, "not-json");
    expect(loadEnhancementSettings()).toEqual(DEFAULT_ENHANCEMENT_SETTINGS);
  });
});
