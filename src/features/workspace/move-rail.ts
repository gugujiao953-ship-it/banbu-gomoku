// 棋盘手数滑轨（用户 09-17 第二批③）：棋盘两侧贴边竖条，拖动=连续跳手、点击=单步。
// 这里只放纯映射逻辑，DOM 与手势在 BoardMoveRail 组件里，便于单测。

/** 轨道位置比例（0=顶部/起始局面，1=底部/最后一手）→ 手数。 */
export const railDepthFromRatio = (ratio: number, total: number): number => {
  if (!Number.isFinite(ratio) || total <= 0) return 0;
  return Math.max(0, Math.min(total, Math.round(ratio * total)));
};

/** 手数 → 轨道位置比例（画滑块用）。 */
export const railRatioForDepth = (depth: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, depth / total));
};

/** 点击轨道时的单步方向：点在上方=上一手（-1），下方=下一手（+1），
 * 落在滑块附近的死区里=0（不动，避免手抖点一下反而跳走）。 */
export const RAIL_TAP_DEAD_ZONE = 0.04;
export const railTapDirection = (tapRatio: number, thumbRatio: number, deadZone = RAIL_TAP_DEAD_ZONE): -1 | 0 | 1 => {
  if (tapRatio < thumbRatio - deadZone) return -1;
  if (tapRatio > thumbRatio + deadZone) return 1;
  return 0;
};

/** 判定一次指针交互是"拖动"还是"点击"：位移超过阈值算拖动（进入连续跳手）。 */
export const RAIL_DRAG_THRESHOLD_PX = 6;
export const isRailDrag = (startY: number, currentY: number, threshold = RAIL_DRAG_THRESHOLD_PX): boolean =>
  Math.abs(currentY - startY) > threshold;
