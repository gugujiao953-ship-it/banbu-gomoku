export type FontScale = "normal" | "large" | "xlarge";

export const FONT_SCALE_STORAGE_KEY = "banbu-font-scale-v1";

export const FONT_SCALE_VALUES: Record<FontScale, number> = { normal: 1, large: 1.15, xlarge: 1.3 };

export const loadFontScale = (): FontScale => {
  try {
    const value = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return value === "large" || value === "xlarge" ? value : "normal";
  } catch { return "normal"; }
};

export const saveFontScale = (scale: FontScale) => {
  try { localStorage.setItem(FONT_SCALE_STORAGE_KEY, scale); } catch { /* optional preference */ }
};

export const fontScaleClass = (scale: FontScale) => `font-scale-${scale}`;
