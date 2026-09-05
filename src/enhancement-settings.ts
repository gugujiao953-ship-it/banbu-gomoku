export const ENHANCEMENT_SETTINGS_KEY = "banbu-enhancement-settings-v1";

export interface EnhancementSettings {
  tabletSplit: boolean;
  gestureZoom: boolean;
  gestureSwipe: boolean;
  recentImports: boolean;
  aiBoardHints: boolean;
  coachMarks: boolean;
  // 走棋栏文字显示：默认开启（沿用带标签的现状）；关闭则纯图标、绝不换行。
  movesTextDisplay: boolean;
  // 走棋并入功能栏：把走棋导航从独立常驻行改回底部功能栏的一个标签页。默认关闭。
  dockMergeMoves: boolean;
}

export const DEFAULT_ENHANCEMENT_SETTINGS: EnhancementSettings = {
  tabletSplit: false,
  gestureZoom: false,
  gestureSwipe: false,
  recentImports: false,
  aiBoardHints: false,
  coachMarks: false,
  movesTextDisplay: true,
  dockMergeMoves: false,
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
    // 走棋文字默认开启，因此用 !== false 收窄（仅显式关闭才为 false），其余新功能用 === true。
    movesTextDisplay: partial.movesTextDisplay !== false,
    dockMergeMoves: partial.dockMergeMoves === true,
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
