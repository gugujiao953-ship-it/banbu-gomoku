// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadMotionEnabled, MOTION_SETTINGS_KEY, normalizeMotionEnabled, saveMotionEnabled } from "./motion-settings";

describe("motion settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to disabled", () => {
    expect(loadMotionEnabled()).toBe(false);
    expect(normalizeMotionEnabled(null)).toBe(false);
  });

  it("persists the user's choice", () => {
    saveMotionEnabled(false);
    expect(localStorage.getItem(MOTION_SETTINGS_KEY)).toBe("false");
    expect(loadMotionEnabled()).toBe(false);
  });

  it("recovers safely from malformed storage", () => {
    localStorage.setItem(MOTION_SETTINGS_KEY, "not-json");
    expect(loadMotionEnabled()).toBe(false);
  });
});
