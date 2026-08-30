export const MOTION_SETTINGS_KEY = "banbu-motion-enabled-v1";

export const normalizeMotionEnabled = (value: unknown) => typeof value === "boolean" ? value : false;

export const loadMotionEnabled = () => {
  try {
    return normalizeMotionEnabled(JSON.parse(localStorage.getItem(MOTION_SETTINGS_KEY) || "null"));
  } catch {
    return false;
  }
};

export const saveMotionEnabled = (enabled: boolean) => {
  try { localStorage.setItem(MOTION_SETTINGS_KEY, JSON.stringify(enabled)); } catch { /* storage can be unavailable */ }
};
