/**
 * 落子方式（用户 2026-10-13：「我们的落子好像只有点击直接落子这一个方式……
 * 出一个点击后是一个圈圈、再点击后才落子的模式，然后做一个选项」）。
 *
 *  - `false`（默认）＝点一下空位直接落子，与历史行为逐字相同；
 *  - `true` ＝点一下空位先在落点画一个圈（待确认），**再点同一格才真正落子**；
 *    点别的空位是把圈挪过去，不是落子。
 *
 * ⚠ 为什么单独一个标量键，而不是并进「可选增强功能」那份 `banbu-enhancement-settings-v1`：
 *   那个 blob 在 App 挂载时就整份 `JSON.stringify` 写回，新字段一进去就与"用户显式选过"
 *   再也分不开——以后想把默认从"直接"翻成"确认"，对全部老用户都是空操作
 *   （`buttonOverflow` 为同样的坑换过三次键，见 enhancement-settings.ts 的头注）。
 *   这里的范式与 `board-opacity.ts` 一样：**没有值＝默认**，只有用户真动过才写盘。
 */
export const PLACEMENT_CONFIRM_KEY = "banbu-placement-confirm-v1";

export const loadPlacementConfirm = (): boolean => {
  try {
    return localStorage.getItem(PLACEMENT_CONFIRM_KEY) === "true";
  } catch {
    return false;
  }
};

export const savePlacementConfirm = (value: boolean) => {
  try {
    localStorage.setItem(PLACEMENT_CONFIRM_KEY, value ? "true" : "false");
  } catch { /* 存不下只影响下次打开时的默认，不影响这一局的下法 */ }
};
