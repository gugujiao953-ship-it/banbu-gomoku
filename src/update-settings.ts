// Whether the app checks GitHub for a newer release at launch. Default on:
// the check is a single silent request and never blocks offline use.
export const UPDATE_AUTO_CHECK_KEY = "banbu-update-auto-check-v1";
export const DEFAULT_UPDATE_AUTO_CHECK = true;

export const normalizeUpdateAutoCheck = (value: unknown) => typeof value === "boolean" ? value : DEFAULT_UPDATE_AUTO_CHECK;

export const loadUpdateAutoCheck = () => {
  try {
    return normalizeUpdateAutoCheck(JSON.parse(localStorage.getItem(UPDATE_AUTO_CHECK_KEY) || "null"));
  } catch {
    return DEFAULT_UPDATE_AUTO_CHECK;
  }
};

export const saveUpdateAutoCheck = (enabled: boolean) => {
  try { localStorage.setItem(UPDATE_AUTO_CHECK_KEY, JSON.stringify(enabled)); } catch { /* storage can be unavailable */ }
};

// The launch update prompt is shown once per release: dismissing it records the
// version, so the same release never interrupts again, while a future release
// (different version) will prompt once again.
export const UPDATE_PROMPT_DISMISSED_KEY = "banbu-update-prompt-dismissed-v1";

export const loadUpdatePromptDismissed = (): string | null => {
  try { return localStorage.getItem(UPDATE_PROMPT_DISMISSED_KEY); } catch { return null; }
};

export const saveUpdatePromptDismissed = (version: string) => {
  try { localStorage.setItem(UPDATE_PROMPT_DISMISSED_KEY, version); } catch { /* storage can be unavailable */ }
};
