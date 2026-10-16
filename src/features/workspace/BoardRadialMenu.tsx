import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RADIAL_MENU_PAGES, RADIAL_MENU_RADIUS, RADIAL_PAGE_INNER_RADIUS, RADIAL_PAGE_OUTER_RADIUS, radialPageAt, radialSlotPosition,
  type RadialMenuPage, type RadialMenuPageId, type RadialMenuItem } from "./radial-menu";
import "./radial-menu.css";

/** 贴边保护用的半径余量：外环半径 + 半个按钮（64/2）+ 8px 呼吸。 */
const RADIAL_MENU_RADIUS_GUARD = RADIAL_MENU_RADIUS + 32 + 8;

interface BoardRadialMenuProps {
  /** 屏幕坐标（按下点）。 */
  x: number;
  y: number;
  /** 当前是哪一页（内环选中格）。 */
  page: RadialMenuPageId;
  pages?: RadialMenuPage[];
  items: RadialMenuItem[];
  onPick: (id: RadialMenuItem["id"]) => void;
  /** 切页：只换外环按钮，菜单保持打开。 */
  onPickPage: (page: RadialMenuPageId) => void;
  onClose: () => void;
}

/** 一格扇区的 SVG 路径。第一格以正上方为中心跨 ±(180/n)°，缝落在两格中间，
 * 这样手指压在 12 点上永远是「通用」，不会正好落在切换边界上。 */
const wedgePath = (index: number, count: number, inner: number, outer: number): string => {
  const step = (Math.PI * 2) / count;
  const start = -Math.PI / 2 - step / 2 + index * step;
  const end = start + step;
  const at = (radius: number, angle: number) => `${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)}`;
  return `M ${at(outer, start)} A ${outer} ${outer} 0 0 1 ${at(outer, end)} L ${at(inner, end)} A ${inner} ${inner} 0 0 0 ${at(inner, start)} Z`;
};

/** 页名放在这一格的正中，不跟着旋转——转 180° 的「编辑」是倒着读的。 */
const wedgeLabel = (index: number, count: number) => {
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / count);
  const radius = (RADIAL_PAGE_INNER_RADIUS + RADIAL_PAGE_OUTER_RADIUS) / 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

/** 长按环形菜单（用户 09-17 第二批①）。10-01 起是两层：
 * 内环四格切页（通用/标注/分支/编辑），外环六槽摆这一页的动作。
 * 用 portal 挂到 body——棋盘容器有 overflow 裁剪，留在里面会被切掉。
 * 关闭方式：点空白、Esc、选中外环任一项。**切页不关闭**（不然没法连着选）。 */
export function BoardRadialMenu({ x, y, page, pages = RADIAL_MENU_PAGES, items, onPick, onPickPage, onClose }: BoardRadialMenuProps) {
  const ringRef = useRef<SVGSVGElement | null>(null);
  const [sliding, setSliding] = useState<RadialMenuPageId | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  // 六槽固定：切页时同一个动作不会在屏幕上跳位置。
  const positions = items.map((item) => radialSlotPosition(item.slot));
  // 贴边保护：菜单整体不越出视口。外沿 = 外环半径 + 半个按钮（64/2）＝128，比单圈时的 110 大。
  const margin = RADIAL_MENU_RADIUS_GUARD;
  const centerX = Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - margin));
  const centerY = Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - margin));
  const ring = (event: { clientX: number; clientY: number }): RadialMenuPageId | null => {
    const element = ringRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const index = radialPageAt({ x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) }, pages.length);
    return index === null ? null : pages[index].id;
  };
  const cycle = (delta: number) => {
    const index = pages.findIndex((item) => item.id === page);
    onPickPage(pages[(index + delta + pages.length) % pages.length].id);
  };
  return createPortal(<>
    <div className="radial-menu-backdrop" onClick={onClose} aria-hidden="true"/>
    <div className="radial-menu" style={{ left: centerX, top: centerY }} role="menu" aria-label="棋盘操作"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); cycle(1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); cycle(-1); }
      }}>
      <span className="radial-menu-anchor" aria-hidden="true"/>
      {/* 内环：四格扇区。按下（含滑动经过）先高亮，抬起才切页——沿环划着找页更顺手。 */}
      <svg ref={ringRef} className="radial-menu-pages" data-ring={page}
        width={RADIAL_PAGE_OUTER_RADIUS * 2} height={RADIAL_PAGE_OUTER_RADIUS * 2}
        viewBox={`${-RADIAL_PAGE_OUTER_RADIUS} ${-RADIAL_PAGE_OUTER_RADIUS} ${RADIAL_PAGE_OUTER_RADIUS * 2} ${RADIAL_PAGE_OUTER_RADIUS * 2}`}
        role="tablist" aria-label="菜单分类"
        onPointerDown={(event) => {
          event.stopPropagation();
          const hit = ring(event);
          if (hit) { setSliding(hit); event.currentTarget.setPointerCapture(event.pointerId); }
        }}
        onPointerMove={(event) => { if (sliding) { const hit = ring(event); if (hit) setSliding(hit); } }}
        onPointerUp={(event) => {
          event.stopPropagation();
          const hit = sliding || ring(event);
          setSliding(null);
          if (hit && hit !== page) onPickPage(hit);
        }}
        onPointerCancel={() => setSliding(null)}>
        {pages.map((item, index) => {
          const active = item.id === (sliding || page);
          return <g key={item.id} role="tab" aria-selected={active} tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPickPage(item.id); } }}>
            <path className={`radial-page-wedge ${active ? "is-active" : ""}`}
              d={wedgePath(index, pages.length, RADIAL_PAGE_INNER_RADIUS, RADIAL_PAGE_OUTER_RADIUS)} />
            <text className="radial-page-label" x={wedgeLabel(index, pages.length).x} y={wedgeLabel(index, pages.length).y + 4}>
              {item.label}
            </text>
          </g>;
        })}
      </svg>
      {items.map((item, index) => <button
        key={item.id}
        type="button"
        role="menuitem"
        className={`radial-menu-item ${item.id === "cancel" ? "is-cancel" : ""}`}
        style={{ transform: `translate(${positions[index].x}px, ${positions[index].y}px)` }}
        disabled={item.disabled}
        onClick={() => { onPick(item.id); }}
      >{item.label}</button>)}
    </div>
  </>, window.document.body);
}
