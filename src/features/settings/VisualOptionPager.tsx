import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OPTIONS_PER_PAGE, paginateOptions } from "./pagination";

/** 触屏/触控板横向滑动一页，桌面鼠标走圆点与箭头 —— 桌面没有横向滑动，别让他们翻不了页。
 *
 *  实现用 **CSS scroll-snap 横向分页**（最省事且天然支持滑动）：
 *    · 外层 `.visual-pager-track` = overflow-x:auto + scroll-snap-type:x mandatory + flex；
 *    · 每页 `flex: 0 0 100%` + scroll-snap-align:start；
 *    · 每页内部复用既有类名 `.visual-option-grid` / `.theme-preference`（2 列 × 5 行）。
 *  ⚠ 不用 CSS multi-column：column 会把 grid 拆坏、也控不住"每页 5 行"。
 *  ⚠ 内层网格必须**沿用既有类名**，不另起一套卡片视觉（用户要求只改布局）。
 *  ⚠ prefers-reduced-motion 下 scrollTo 用 behavior:"auto"，不做平滑动画的强依赖。 */

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface VisualOptionPagerProps {
  /** 无障碍名称：横向滚动容器与翻页控件的 aria-label 都用它，例如「棋盘材质」。 */
  label: string;
  /** 选项按钮（key 由调用方给）；每页最多 OPTIONS_PER_PAGE 个。 */
  options: ReactNode[];
  /** 内层网格复用的既有类名。 */
  gridClassName?: string;
  /** 内层网格的 ARIA role（主题那组按钮是 radio，需要 radiogroup 归组）。 */
  gridRole?: "radiogroup";
  /** 内层网格的 aria-label（配合 gridRole 用）。 */
  gridLabel?: string;
  perPage?: number;
}

export function VisualOptionPager({ label, options, gridClassName = "visual-option-grid", gridRole, gridLabel, perPage = OPTIONS_PER_PAGE }: VisualOptionPagerProps) {
  const pages = useMemo(() => paginateOptions(options, perPage), [options, perPage]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pageCount = pages.length;
  const current = Math.max(0, Math.min(page, pageCount - 1));

  const goTo = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(pageCount - 1, index));
    const left = target * track.clientWidth;
    if (typeof track.scrollTo === "function") track.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    else track.scrollLeft = left;
    setPage(target);
  }, [pageCount]);

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setPage(Math.max(0, Math.min(pageCount - 1, next)));
  }, [pageCount]);

  // 不足一页就不出翻页控件（也不该占一行空白）。
  if (pageCount <= 1) return <div className={gridClassName} role={gridRole} aria-label={gridLabel}>{options}</div>;

  return <div className="visual-pager">
    <div
      className="visual-pager-track"
      ref={trackRef}
      onScroll={handleScroll}
      role="group"
      aria-label={`${label}，共 ${pageCount} 页，可左右滑动切换`}
      tabIndex={0}
      data-page={current + 1}
      data-page-count={pageCount}
    >
      {pages.map((items, index) => <div className="visual-pager-page" key={index} data-page-index={index + 1}>
        <div className={gridClassName} role={gridRole} aria-label={gridLabel}>{items}</div>
      </div>)}
    </div>
    <div className="visual-pager-controls">
      <button type="button" className="visual-pager-arrow" aria-label={`${label}上一页`} disabled={current === 0} onClick={() => goTo(current - 1)}><ChevronLeft aria-hidden="true"/></button>
      <div className="visual-pager-dots" role="group" aria-label={`${label}页码`}>
        {pages.map((_, index) => <button
          key={index}
          type="button"
          className={`visual-pager-dot${index === current ? " selected" : ""}`}
          aria-label={`${label}第 ${index + 1} 页`}
          aria-current={index === current ? "true" : undefined}
          onClick={() => goTo(index)}
        />)}
      </div>
      <button type="button" className="visual-pager-arrow" aria-label={`${label}下一页`} disabled={current === pageCount - 1} onClick={() => goTo(current + 1)}><ChevronRight aria-hidden="true"/></button>
    </div>
  </div>;
}
