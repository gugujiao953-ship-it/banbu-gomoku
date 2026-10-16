// 棋盘缩放（双指捏合 / 桌面端 Ctrl+滚轮）的量程与「围着一个点缩放」的换算。
// 缩放是瞬态视图状态：不进 localStorage、换棋谱即复位，但两件事必须钉死——
// ① 上限：用户明确要求「能放大很多」（原值 2.35 太小，一次捏合就顶死）；
// ② 锚点稳定：围着指针/双指中心缩放时，指针下的那一点不能跑，否则手感是「放大就跑偏」。
export const MIN_BOARD_SCALE = 1;
/** 上限 6：用户记忆里「五倍还多」，留一点余量。再大也只是纯像素放大，没有信息增量。 */
export const MAX_BOARD_SCALE = 6;
/** 桌面端每格滚轮的缩放倍率（Ctrl/⌘ + wheel）。 */
export const WHEEL_ZOOM_STEP = 1.12;

export const clampBoardScale = (value: number): number => {
  if (!Number.isFinite(value)) return MIN_BOARD_SCALE;
  return Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, value));
};

/**
 * 触摸板捏合在 Chromium/WebKit 里是**带 ctrlKey 的 wheel**（不是 touch 指针事件），
 * 所以缩放必须同时认这两种。带 ⌘ 也一并认，macOS 上有人习惯这么按。
 */
export const shouldZoomOnWheel = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey;

/**
 * 缩放前后让锚点（光标/手指中心）在内容里的那一处仍然贴在视口同一位置，据此换算滚动量。
 *
 * 棋盘是正方形且宽度按 scale 等比放大（`width: scale*100%`、`height: auto`），所以两个
 * 轴向共用同一个缩放比：内容坐标 = (scroll + 视口坐标) / scale。要求缩放后同一个内容
 * 坐标仍然落在同一个视口坐标上，于是 新滚动 = 目标内容坐标 × 新 scale − 视口坐标。
 */
export const zoomAnchorScroll = (params: {
  anchorX: number; anchorY: number;
  scrollLeft: number; scrollTop: number;
  fromScale: number; toScale: number;
}): { left: number; top: number } => {
  const from = clampBoardScale(params.fromScale);
  const to = clampBoardScale(params.toScale);
  const ratio = to / from;
  return {
    left: (params.scrollLeft + params.anchorX) * ratio - params.anchorX,
    top: (params.scrollTop + params.anchorY) * ratio - params.anchorY,
  };
};
