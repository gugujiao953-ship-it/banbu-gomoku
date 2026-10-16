// 棋盘侧边（四边坐标缝）宽度。viewBox 固定 572，缝越窄棋盘本体越大——所以
// 「调小侧边」等于「压榨坐标空间、把棋盘撑大」。默认 34 必须与改造前逐像素一致；
// 最小档只留「勉强放下一行两位数坐标」的余量，随坐标字号缩放。
export const BOARD_VIEWBOX = 572;
/** 棋盘底板矩形距画布边缘的距离（board-bg 的 x/y）。 */
export const BOARD_EDGE_INSET = 4;
export const DEFAULT_BOARD_MARGIN = 34;

/** 最小侧边：两位数坐标 + 一点呼吸位，字号越大留得越多。 */
export const minBoardMargin = (coordinateFontSize: number): number => {
  const fontSize = Number.isFinite(coordinateFontSize) && coordinateFontSize > 0 ? coordinateFontSize : 12;
  return Math.max(12, Math.round(BOARD_EDGE_INSET + fontSize * 1.25));
};

/** 用户存下来的值可能来自别的字号/旧版本，用前一律收敛到当前字号允许的区间。 */
export const clampBoardMargin = (value: unknown, coordinateFontSize: number): number => {
  const min = minBoardMargin(coordinateFontSize);
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_BOARD_MARGIN;
  return Math.min(DEFAULT_BOARD_MARGIN, Math.max(min, numeric));
};

export interface CoordinateLayout {
  topY: number;
  bottomY: number;
  leftX: number;
  rightX: number;
}

/**
 * 四条边的坐标文字位置。默认档返回改造前的原值（上 20 / 下 560 / 左 18 / 右 554）；
 * 侧边压窄时按比例贴向各自缝隙中线，保证文字仍落在板内、不被 viewBox 裁掉。
 */
export const coordinateLayout = (margin: number, coordinateFontSize: number): CoordinateLayout => {
  const min = minBoardMargin(coordinateFontSize);
  const span = DEFAULT_BOARD_MARGIN - min;
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (DEFAULT_BOARD_MARGIN - margin) / span));
  const baselineBias = coordinateFontSize * 0.35;
  const blend = (current: number, target: number) => current + (target - current) * t;
  const nearCenter = (BOARD_EDGE_INSET + margin) / 2;
  const farCenter = BOARD_VIEWBOX - nearCenter;
  return {
    topY: blend(20, nearCenter + baselineBias),
    bottomY: blend(560, farCenter + baselineBias),
    leftX: blend(18, nearCenter),
    rightX: blend(554, farCenter),
  };
};

/** 滑杆与设置项右侧的读数：默认/最小档带语义后缀，中间档给像素值。 */
export const boardMarginLabel = (margin: number, coordinateFontSize: number): string => {
  if (margin >= DEFAULT_BOARD_MARGIN) return `${DEFAULT_BOARD_MARGIN}px（默认）`;
  if (margin <= minBoardMargin(coordinateFontSize)) return `${margin}px（最小）`;
  return `${margin}px`;
};
