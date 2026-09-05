export const FIRST_RUN_WELCOME_KEY = "banbu-first-run-welcome-v1";

const legacyInstallKeys = ["renju-note-active-v1", "renju-note-library-v1", "renju-note-default-v1", "banbu-active-large-record-v1", "renju-note-puzzle-progress-v1"];

export const shouldShowFirstRunWelcome = (storage: Storage = localStorage): boolean => {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("qa") === "1") return false;
    if (storage.getItem(FIRST_RUN_WELCOME_KEY) === "true") return false;
    if (legacyInstallKeys.some((key) => storage.getItem(key) !== null)) {
      storage.setItem(FIRST_RUN_WELCOME_KEY, "true");
      return false;
    }
    return true;
  } catch { return false; }
};

export const markFirstRunWelcomeRead = (storage: Storage = localStorage) => {
  try { storage.setItem(FIRST_RUN_WELCOME_KEY, "true"); } catch { /* storage is optional */ }
};
