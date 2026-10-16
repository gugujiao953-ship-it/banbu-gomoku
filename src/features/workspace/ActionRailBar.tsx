import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** 功能区三区：首行 / 常驻 / 走棋（子功能区不套滑动栏）。 */
export type RailZone = "bottom" | "top" | "moves";

interface RailState {
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
}

const INITIAL: RailState = { overflow: false, atStart: true, atEnd: true };

/** 贴边量的上限：比 12px 再宽就只是白伸出去（窄屏实测 .record-page 内边距只有 1px）。 */
const MAX_BLEED = 12;

/** 拖动超过这个距离才算「滑动」，否则当点击——不然按钮会被拖拽吃掉点击。 */
const DRAG_THRESHOLD = 6;

/** 行本体：调用方在区域元素上挂 `.rail-scroll`。溢出判定必须量它，不是外层包装。 */
const findRow = (track: HTMLElement | null): HTMLElement | null =>
  track?.querySelector<HTMLElement>(".rail-scroll") ?? (track?.firstElementChild as HTMLElement | null);

/**
 * 功能区行的「横向滚动」容器（用户 09-17 规格，09-17 晚按反馈重做，09-26 再改）：
 *  - 行两端各一个贴着屏幕边缘的**裸箭头**——没有底色方框、没有描边、没有底色渐变，
 *    就是一枚箭头图案，样式对齐首行功能栏的「无框融入背景」。用户 09-26 原话：
 *    「左右两边的按钮应该像首行功能栏一样，没有固定的框框包裹，而是直接就是图案」；
 *  - 按钮放不下时不换行、不挤压，而是在行内横向滑动（原生横向滚动 + 隐藏滚动条）；
 *  - 点一下箭头 = 整行按钮往那一侧挪一格（一格 = 第一个按钮宽度 + 间距）；长按持续挪；
 *  - **行本身可拖滑**：鼠标/触控笔按住行拖动即滑动（触摸屏走原生滚动，不去抢，
 *    原生的惯性滚动更顺）；拖动后那一次 click 会被吞掉，避免「滑完顺手点了按钮」。
 *
 * 这一行走「横向滚动」还是「自动换行」由设置 `buttonOverflow` 决定，**默认横向滚动**
 * （用户 09-26 先要「默认关闭、打开才出现」，10-03 又改回来：「现在我们默认横向滚动吧，
 * 感觉这个比自动换行省空间」——换行会把一行按钮挤成两行，正好吃掉砍出来的棋盘高度）。
 * 选「自动换行」时直接返回 children，DOM 与改造前逐字一致；换行本身由 CSS 负责
 * （见 action-layout.css 里 `:not(:has(.action-railbar))` 的几条规则）。
 *
 * ⚠ 三条踩过的坑（都会让 React 报 Maximum update depth，别改回去）：
 *  1. 「贴边量」只能从**不受它影响**的宿主量（包装层的父节点）：量自己被推开后的位置会自激
 *     （React 既报 Maximum update depth，也会把包装层伸出视口、让整页横向滚动）；
 *  2. 由 `data-overflow` 控制、又反过来影响溢出量的样式（如 `> * { flex-shrink: 0 }`）
 *     会构成双稳态来回翻 —— 防挤压只用与标志位无关的 min-width；行内边距也因此改成
 *     **无条件**的 `padding-inline: var(--rail-w)`（见 CSS）；
 *  3. 行本体的 `overflow-x` 必须**无条件**开着：非滚动容器会把溢出吃掉
 *     （scrollWidth 恒等于 clientWidth），而标志位正是由两者之差算出来的。
 */
export function ActionRailBar({ zone, label, enabled, children }: { zone: RailZone; label: string; enabled: boolean; children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const holdRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
  const swallowClickRef = useRef(false);
  const [state, setState] = useState<RailState>(INITIAL);
  const [bleed, setBleed] = useState(0);
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const row = rowRef.current ?? findRow(trackRef.current);
    if (!row) return;
    // 贴边量限于宿主两侧到外壳内容边界的留白，上限 12px。
    // 双栏右侧常只有 4px：只量左边会把右箭头推出外壳并触发隐藏的横向滚动。
    // 包装层宽度 = 宿主宽 + 2×贴边量、内边距也 = 贴边量 ⇒ 行的可用宽度与贴边量**无关**，
    // 所以这里不会自激（对比第一版：量自己被推开后的位置，直接死循环）。
    const host = trackRef.current?.parentElement?.parentElement;
    if (host) {
      const shell = host.closest<HTMLElement>(".app-shell");
      const hostRect = host.getBoundingClientRect();
      const shellLeft = shell ? shell.getBoundingClientRect().left + shell.clientLeft : 0;
      const shellRight = shell ? shellLeft + shell.clientWidth : window.innerWidth;
      // 去掉外壳已有滚动的位移，避免修复前的 scrollLeft 反过来影响贴边量。
      const scrollLeft = shell?.scrollLeft ?? 0;
      const next = Math.max(0, Math.min(MAX_BLEED,
        Math.floor(hostRect.left + scrollLeft - shellLeft),
        Math.floor(shellRight - hostRect.right - scrollLeft)));
      setBleed((prev) => (prev === next ? prev : next));
    }
    const max = row.scrollWidth - row.clientWidth;
    const next: RailState = { overflow: max > 2, atStart: row.scrollLeft <= 2, atEnd: max - row.scrollLeft <= 2 };
    setState((prev) => (prev.overflow === next.overflow && prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next));
  }, []);

  // 首帧测量太早（字体/文字还在落定），布局稳定后补测几次。
  useLayoutEffect(() => {
    rowRef.current = findRow(trackRef.current);
    measure();
    const frame = window.requestAnimationFrame(() => measure());
    const settle = window.setTimeout(measure, 260);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready?.then?.(() => measure()).catch?.(() => {});
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(settle); };
  });

  useEffect(() => {
    if (!enabled) return;
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of Array.from(row.children)) observer.observe(child);
    const mutations = new MutationObserver(measure);
    mutations.observe(row, { childList: true, subtree: true, characterData: true });
    row.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      row.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled, measure]);

  useEffect(() => () => { if (holdRef.current !== null) window.clearInterval(holdRef.current); }, []);

  /** 一格 = 第一个可见按钮的宽度 + 行间距（拿不到就退回 52px）。 */
  const step = useCallback(() => {
    const row = rowRef.current;
    if (!row) return 52;
    const first = row.firstElementChild as HTMLElement | null;
    const style = window.getComputedStyle(row);
    const gap = Number.parseFloat(style.columnGap || style.gap || "0");
    const width = first?.getBoundingClientRect().width || 44;
    return Math.max(40, Math.round(width + (Number.isFinite(gap) ? gap : 0)));
  }, []);

  const nudge = useCallback((direction: -1 | 1) => {
    rowRef.current?.scrollBy({ left: direction * step(), behavior: "smooth" });
  }, [step]);

  const stopHold = useCallback(() => {
    if (holdRef.current !== null) { window.clearInterval(holdRef.current); holdRef.current = null; }
  }, []);

  const startHold = useCallback((direction: -1 | 1) => {
    stopHold();
    holdRef.current = window.setInterval(() => nudge(direction), 320);
  }, [nudge, stopHold]);

  // ── 行本身可拖滑（鼠标/触控笔）──────────────────────────────────────────
  const onRowPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    swallowClickRef.current = false;
    if (!enabled) return;
    // 触摸屏交给原生横向滚动（有惯性、跟手），只有鼠标/笔才走 JS 拖动。
    if (event.pointerType === "touch" || event.button !== 0) return;
    const row = rowRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 2) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: row.scrollLeft, moved: false };
  }, [enabled]);

  const onRowPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const row = rowRef.current;
    if (!drag || !row || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDragging(true);
    }
    row.scrollLeft = drag.startScroll - dx;
    event.preventDefault();
  }, []);

  const endRowDrag = useCallback(() => {
    if (dragRef.current?.moved) swallowClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
  }, []);

  /** 拖动刚结束时浏览器还会补一次 click，吞掉它，别让滑动变成误点按钮。 */
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  if (!enabled) return <>{children}</>;

  const rail = (direction: -1 | 1) => {
    const active = state.overflow && (direction === -1 ? !state.atStart : !state.atEnd);
    const Icon = direction === -1 ? ChevronLeft : ChevronRight;
    return (
      <button
        type="button"
        className={`action-rail action-rail--${direction === -1 ? "left" : "right"}`}
        aria-label={`${label}：向${direction === -1 ? "左" : "右"}滑动一排按钮`}
        title={active ? `向${direction === -1 ? "左" : "右"}滑动一排（长按连续滑动，也可直接拖动按钮行）` : "这一侧没有更多按钮了"}
        disabled={!active}
        data-rail-dir={direction === -1 ? "left" : "right"}
        data-rail-active={active ? "true" : "false"}
        onPointerDown={(event) => {
          if (!active || event.pointerType === "touch") return;
          nudge(direction);
          startHold(direction);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onClick={(event) => {
          // 键盘激活（Enter/Space）时 detail === 0：指针路径已经挪过，别重复。
          if (event.detail === 0 && active) nudge(direction);
        }}
      >
        <Icon aria-hidden="true"/>
      </button>
    );
  };

  return (
    <div
      className="action-railbar"
      data-rail-zone={zone}
      data-overflow={state.overflow ? "true" : "false"}
      data-at-start={state.atStart ? "true" : "false"}
      data-at-end={state.atEnd ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      style={{ "--rail-bleed": `${bleed}px` } as CSSProperties}
    >
      {rail(-1)}
      <div
        className="action-rail-track"
        ref={trackRef}
        onPointerDown={onRowPointerDown}
        onPointerMove={onRowPointerMove}
        onPointerUp={endRowDrag}
        onPointerCancel={endRowDrag}
        onLostPointerCapture={endRowDrag}
        onClickCapture={onClickCapture}
      >{children}</div>
      {rail(1)}
    </div>
  );
}
