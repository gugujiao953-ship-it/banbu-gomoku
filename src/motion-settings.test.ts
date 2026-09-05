// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MOTION_ENABLED, loadMotionEnabled, MOTION_SETTINGS_KEY, normalizeMotionEnabled, saveMotionEnabled } from "./motion-settings";

describe("motion settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to enabled for fresh and upgraded installs", () => {
    expect(MOTION_SETTINGS_KEY).toBe("banbu-motion-enabled-v2");
    expect(loadMotionEnabled()).toBe(DEFAULT_MOTION_ENABLED);
    expect(normalizeMotionEnabled(null)).toBe(DEFAULT_MOTION_ENABLED);
    localStorage.setItem("banbu-motion-enabled-v1", "false");
    expect(loadMotionEnabled()).toBe(DEFAULT_MOTION_ENABLED);
  });

  it("persists the user's choice", () => {
    saveMotionEnabled(false);
    expect(localStorage.getItem(MOTION_SETTINGS_KEY)).toBe("false");
    expect(loadMotionEnabled()).toBe(false);
  });

  it("recovers safely from malformed storage", () => {
    localStorage.setItem(MOTION_SETTINGS_KEY, "not-json");
    expect(loadMotionEnabled()).toBe(DEFAULT_MOTION_ENABLED);
  });
});
