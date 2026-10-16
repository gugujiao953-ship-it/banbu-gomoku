// 棋子序号大小（用户 09-26：默认档从 100% 提到 150%，上限从 180% 提到 200%）。
// 口径集中在这一处：读设置的兜底、设置页与快捷中心两条滑杆、「恢复默认显示」的复位值
// 都从这里取。以前这些数字散在 App / SettingsPage / QuickDrawer 三个文件里，
// 动默认值必须三处一起动，漏一处就会出现「滑杆拉到顶还是比默认小」这类自相矛盾。
export const MIN_MOVE_NUMBER_SCALE = 0.7;
export const DEFAULT_MOVE_NUMBER_SCALE = 1.5;
export const MAX_MOVE_NUMBER_SCALE = 2;
export const MOVE_NUMBER_SCALE_STEP = 0.05;

/** 把任意来源的值收进合法区间：非有限数（NaN/Infinity）与 0 回落默认档。 */
export const clampMoveNumberScale = (value: number) => Number.isFinite(value) && value > 0
  ? Math.min(MAX_MOVE_NUMBER_SCALE, Math.max(MIN_MOVE_NUMBER_SCALE, value))
  : DEFAULT_MOVE_NUMBER_SCALE;
