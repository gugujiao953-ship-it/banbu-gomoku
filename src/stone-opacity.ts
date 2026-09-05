export const STONE_OPACITY_KEY = "banbu-stone-opacity-v1";
export const LEGACY_DISPLAY_SETTINGS_KEY = "renju-note-display-settings-v1";
export const DEFAULT_STONE_OPACITY = 1;
export const MIN_STONE_OPACITY = 0.4;

export const normalizeStoneOpacity = (value: unknown): number => {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_STONE_OPACITY;
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(MIN_STONE_OPACITY, Math.round(ratio * 100) / 100));
};

export const loadStoneOpacity = (): number => {
  try {
    const stored = localStorage.getItem(STONE_OPACITY_KEY);
    if (stored !== null) return normalizeStoneOpacity(stored);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DISPLAY_SETTINGS_KEY) || "null") as { stoneOpacity?: unknown; stoneOpacityPercent?: unknown } | null;
    return normalizeStoneOpacity(legacy?.stoneOpacity ?? legacy?.stoneOpacityPercent);
  } catch {
    return DEFAULT_STONE_OPACITY;
  }
};

export const saveStoneOpacity = (value: number) => {
  try { localStorage.setItem(STONE_OPACITY_KEY, String(normalizeStoneOpacity(value))); } catch { /* optional visual preference */ }
};
