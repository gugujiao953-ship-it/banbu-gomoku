/** 外观选项分页的**纯逻辑**（不碰 DOM，单独可测）。
 *
 *  用户 2026-10-06：设置里「外观与音效」的选项太多（主题 22 / 棋盘材质 28 / 棋子材质 31），
 *  一长条排下去把**预览棋盘挤到屏幕外**，要滑很久才看得到预览。要求改成翻页：
 *  每页 **2 列 × 5 行 = 10 项**，多出来的排到下一页，左右滑动切页。
 *
 *  这里只负责"怎么切"这一件事 —— 顺序不变、每页 ≤ perPage、最后一页可以不满；
 *  翻页交互（scroll-snap / 圆点 / 箭头）在 VisualOptionPager 里。 */

/** 每页容量：2 列 × 5 行。 */
export const OPTIONS_PER_PAGE = 10;

/** 把一组选项按每页 perPage 个切成若干页（顺序不变，最后一页可不足）。
 *  空数组 → `[]`（0 页），调用方据此不渲染翻页控件。 */
export function paginateOptions<T>(items: readonly T[], perPage: number = OPTIONS_PER_PAGE): T[][] {
  if (!Number.isInteger(perPage) || perPage < 1) throw new RangeError(`perPage 必须是正整数，收到 ${perPage}`);
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += perPage) pages.push(items.slice(index, index + perPage));
  return pages;
}

/** 页数 = ceil(总数 / 每页容量)；空列表算 0 页。 */
export function pageCount(total: number, perPage: number = OPTIONS_PER_PAGE): number {
  if (!Number.isInteger(perPage) || perPage < 1) throw new RangeError(`perPage 必须是正整数，收到 ${perPage}`);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / perPage);
}
