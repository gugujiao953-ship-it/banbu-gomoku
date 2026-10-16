// 键盘流补全（用户 09-17 第二批⑤）：数字键跳手、空格播放/暂停、Delete 删当前节点。
// 这里只放纯逻辑（缓冲与忽略判定），事件绑定留在 App 里，便于单测。

/** 数字键跳手的组合窗：连续敲的数字在窗口内拼成多位数（敲 1 再敲 2 = 第 12 手）。
 * 800ms 是"手速"与"停顿"的分界：慢于此视为重新开始输入。 */
export const DIGIT_JUMP_WINDOW_MS = 800;
/** 最多拼三位（棋谱主线不会超过 999 手）。 */
export const MAX_JUMP_DIGITS = 3;

export interface DigitJumpState {
  /** 已敲入的数字串（""=无待续输入）。 */
  digits: string;
  /** 上一次敲数字的时间戳（Date.now()）。 */
  at: number;
}

export const EMPTY_DIGIT_JUMP: DigitJumpState = { digits: "", at: 0 };

/** 敲一个数字键：返回新的缓冲与"本次应跳到第几手"。
 * 每敲一位就立刻跳一次（敲 1 跳第 1 手、紧接敲 2 跳第 12 手），
 * 这样不会出现"敲完还要等窗口关闭才动"的迟滞感。 */
export function feedMoveJumpDigit(
  state: DigitJumpState,
  digit: string,
  now: number,
): { state: DigitJumpState; jump: number } | null {
  if (!/^[0-9]$/.test(digit)) return null;
  const continuing = state.digits !== "" && now - state.at <= DIGIT_JUMP_WINDOW_MS;
  const digits = (continuing ? state.digits + digit : digit).slice(-MAX_JUMP_DIGITS);
  const jump = Number(digits);
  if (!Number.isFinite(jump)) return null;
  return { state: { digits, at: now }, jump };
}

/** 数字键跳手是否还要继续吃键（决定要不要 preventDefault 等）。 */
export const digitJumpPending = (state: DigitJumpState, now: number): boolean =>
  state.digits !== "" && now - state.at <= DIGIT_JUMP_WINDOW_MS;

/** 文本输入目标：焦点在输入框/文本域/下拉/可编辑区时不响应快捷键。
 * 这段判定原先内联在键盘 effect 里，另有几处重复实现，抽出来共用。 */
export const isTextEntryTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

/** 快捷键是否应当被忽略：任一面板/浮层打开时都让路，避免和面板内操作打架。 */
export const shortcutsBlocked = (blockers: { layoutEditorOpen: boolean; quickDrawerOpen: boolean; sheetOpen: boolean; moveJumpOpen: boolean; enabled: boolean }): boolean =>
  !blockers.enabled || blockers.layoutEditorOpen || blockers.quickDrawerOpen || blockers.sheetOpen || blockers.moveJumpOpen;
