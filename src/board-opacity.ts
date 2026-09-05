export const BOARD_OPACITY_KEY = "banbu-board-opacity-v1";
export const DEFAULT_BOARD_OPACITY = 1;
export const MIN_BOARD_OPACITY = 0.35;

export const normalizeBoardOpacity = (value: unknown): number => {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_BOARD_OPACITY;
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(MIN_BOARD_OPACITY, Math.round(ratio * 100) / 100));
};

export const loadBoardOpacity = (): number => {
  try {
    return normalizeBoardOpacity(localStorage.getItem(BOARD_OPACITY_KEY));
  } catch {
    return DEFAULT_BOARD_OPACITY;
  }
};

export const saveBoardOpacity = (value: number) => {
  try { localStorage.setItem(BOARD_OPACITY_KEY, String(normalizeBoardOpacity(value))); } catch { /* optional visual preference */ }
};
