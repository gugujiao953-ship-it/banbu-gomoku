// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SOUND_SETTINGS, loadSoundSettings, normalizeSoundSettings, saveSoundSettings, SOUND_SETTINGS_KEY } from "./audio-settings";
import { AUDIO_OUTPUT_BOOST, outputGainForVolume } from "./audio-engine";

describe("sound settings", () => {
  beforeEach(() => localStorage.clear());

  it("uses lightweight safe defaults", () => {
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it("normalizes malformed values and clamps volume", () => {
    expect(normalizeSoundSettings({ enabled: false, moveEnabled: false, feedbackEnabled: true, volume: 4 })).toEqual({
      enabled: false, navigateEnabled: true, feedbackEnabled: true, volume: 1, profile: "classic",
    });
  });

  it("keeps legacy settings compatible and rejects unknown profiles", () => {
    expect(normalizeSoundSettings({ enabled: true, volume: 0.4 }).profile).toBe("classic");
    expect(normalizeSoundSettings({ profile: "unknown" }).profile).toBe("classic");
    expect(normalizeSoundSettings({ profile: "wood" }).profile).toBe("wood");
    expect(normalizeSoundSettings({ profile: "crystal" }).profile).toBe("crystal");
    expect(normalizeSoundSettings({ profile: "jade" }).profile).toBe("classic");
    expect(normalizeSoundSettings({ profile: "real" }).profile).toBe("real");
  });

  it("persists all adjustable settings", () => {
    saveSoundSettings({ enabled: true, navigateEnabled: false, feedbackEnabled: true, volume: 0.28, profile: "wood" });
    expect(JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY) || "null")).toEqual({ enabled: true, navigateEnabled: false, feedbackEnabled: true, volume: 0.28, profile: "wood" });
    expect(loadSoundSettings().volume).toBe(0.28);
    expect(loadSoundSettings().profile).toBe("wood");
  });

  it("boosts the output stage without changing the 0-100% slider semantics", () => {
    expect(outputGainForVolume(0)).toBe(0);
    expect(outputGainForVolume(0.55)).toBeCloseTo(0.99);
    expect(outputGainForVolume(1)).toBe(AUDIO_OUTPUT_BOOST);
    expect(outputGainForVolume(1, false)).toBe(0);
  });
});
