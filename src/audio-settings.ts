export const SOUND_SETTINGS_KEY = "banbu-sound-settings-v1";

export type SoundProfile = "classic" | "wood" | "crystal" | "real";

export interface SoundSettings {
  enabled: boolean;
  navigateEnabled: boolean;
  feedbackEnabled: boolean;
  volume: number;
  profile: SoundProfile;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: false,
  navigateEnabled: true,
  feedbackEnabled: true,
  volume: 0.55,
  profile: "classic",
};

const clampVolume = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : DEFAULT_SOUND_SETTINGS.volume;
};

const normalizeProfile = (value: unknown): SoundProfile => value === "wood" || value === "crystal" || value === "real" ? value : "classic";

export const normalizeSoundSettings = (value: unknown): SoundSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SOUND_SETTINGS };
  const partial = value as Partial<SoundSettings>;
  return {
    enabled: partial.enabled !== false,
    // moveEnabled (pre-2026-09-03) was dropped: stone sounds follow the master switch
    navigateEnabled: partial.navigateEnabled !== false,
    feedbackEnabled: partial.feedbackEnabled !== false,
    volume: clampVolume(partial.volume),
    profile: normalizeProfile(partial.profile),
  };
};

export const loadSoundSettings = (): SoundSettings => {
  try {
    return normalizeSoundSettings(JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
};

export const saveSoundSettings = (settings: SoundSettings) => {
  try { localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(normalizeSoundSettings(settings))); } catch { /* storage can be unavailable */ }
};
