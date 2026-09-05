// v1 defaulted to false before the setting was ever initialized. Bump the
// storage key so an existing install does not keep the broken default after
// upgrading to a fixed build.
export const MOTION_SETTINGS_KEY = "banbu-motion-enabled-v2";
export const DEFAULT_MOTION_ENABLED = true;

export const normalizeMotionEnabled = (value: unknown) => typeof value === "boolean" ? value : DEFAULT_MOTION_ENABLED;

export const loadMotionEnabled = () => {
  try {
    return normalizeMotionEnabled(JSON.parse(localStorage.getItem(MOTION_SETTINGS_KEY) || "null"));
  } catch {
    return DEFAULT_MOTION_ENABLED;
  }
};

export const saveMotionEnabled = (enabled: boolean) => {
  try { localStorage.setItem(MOTION_SETTINGS_KEY, JSON.stringify(enabled)); } catch { /* storage can be unavailable */ }
};
