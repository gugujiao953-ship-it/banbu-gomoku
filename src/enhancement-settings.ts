export const ENHANCEMENT_SETTINGS_KEY = "banbu-enhancement-settings-v1";

export interface EnhancementSettings {
  tabletSplit: boolean;
  gestureZoom: boolean;
  gestureSwipe: boolean;
  recentImports: boolean;
  aiBoardHints: boolean;
  coachMarks: boolean;
}

export const DEFAULT_ENHANCEMENT_SETTINGS: EnhancementSettings = {
  tabletSplit: false,
  gestureZoom: false,
  gestureSwipe: false,
  recentImports: false,
  aiBoardHints: false,
  coachMarks: false,
};

export const normalizeEnhancementSettings = (value: unknown): EnhancementSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ENHANCEMENT_SETTINGS };
  const partial = value as Partial<EnhancementSettings>;
  return {
    tabletSplit: partial.tabletSplit === true,
    gestureZoom: partial.gestureZoom === true,
    gestureSwipe: partial.gestureSwipe === true,
    recentImports: partial.recentImports === true,
    aiBoardHints: partial.aiBoardHints === true,
    coachMarks: partial.coachMarks === true,
  };
};

export const loadEnhancementSettings = (): EnhancementSettings => {
  try {
    return normalizeEnhancementSettings(JSON.parse(localStorage.getItem(ENHANCEMENT_SETTINGS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_ENHANCEMENT_SETTINGS };
  }
};

export const saveEnhancementSettings = (settings: EnhancementSettings) => {
  try { localStorage.setItem(ENHANCEMENT_SETTINGS_KEY, JSON.stringify(normalizeEnhancementSettings(settings))); } catch { /* storage can be unavailable */ }
};
