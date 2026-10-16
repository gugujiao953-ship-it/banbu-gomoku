import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isRailDrag, railDepthFromRatio, railRatioForDepth, railTapDirection } from "./move-rail";
import "./move-rail.css";

interface BoardMoveRailProps {
  /** 主线总手数（0 = 没有可跳的手数，不渲染）。 */
  total: number;
  /** 当前手数。 */
  current: number;
  /** 跳到主线第 N 手（调用点负责按模式分流：普通谱/分页库/动态库）。 */
  onSeek: (depth: number) => void;
  /** 浮层打开等场景让位（不做指针处理、不渲染）。 */
  disabled?: boolean;
}

/** 棋盘手数滑轨（用户 09-17 第二批③；09-23 按用户改版：从棋盘两侧改成
 * 棋盘下方的横向条——两侧竖条既别扭又挡棋盘，横向条紧贴棋盘下沿、在首行功能区之上）。
 * 拖动=连续跳手；点击=朝点击方向走一手（滑块附近有死区，手抖不会跳走）。 */
export function BoardMoveRail({ total, current, onSeek, disabled }: BoardMoveRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; dragging: boolean; pointerId: number } | null>(null);
  const [active, setActive] = useState(false);
  // 钩子已在上面无条件调用完，这里可以按条件不渲染。
  if (total <= 0 || disabled) return null;
  const thumb = railRatioForDepth(current, total);
  const ratioAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const ratio = ratioAt(event.clientX);
    if (ratio === null) return;
    dragRef.current = { startX: event.clientX, dragging: false, pointerId: event.pointerId };
    setActive(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && !isRailDrag(drag.startX, event.clientX)) return;
    drag.dragging = true;
    const ratio = ratioAt(event.clientX);
    if (ratio !== null) onSeek(railDepthFromRatio(ratio, total));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setActive(false);
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) return;
    const ratio = ratioAt(event.clientX);
    if (ratio === null) return;
    const step = railTapDirection(ratio, thumb);
    if (step !== 0) onSeek(current + step);
  };
  // 键盘可达：左右方向键各走一手（焦点在轨道上时才响应，不抢全局方向键）。
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const next = current + (event.key === "ArrowRight" ? 1 : -1);
    onSeek(Math.max(0, Math.min(total, next)));
  };
  return <div className="board-move-rail" data-active={active ? "true" : "false"}>
    <div
      ref={trackRef}
      className="board-move-rail-track"
      role="slider"
      aria-label={`手数滑轨，当前第 ${current} 手，共 ${total} 手`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={`第 ${current} 手，共 ${total} 手`}
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; setActive(false); }}
    >
      <span className="board-move-rail-fill" style={{ width: `${Math.round(thumb * 100)}%` }}/>
      {/* 轨道里直接读手数（用户 09-23）：拖动时不用去看别处。数字跟着滑块走，
          但会被夹在轨道内（靠两端时不会溢出）。 */}
      <span className="board-move-rail-readout" style={{ left: `${Math.round(Math.min(88, Math.max(12, thumb * 100)))}%` }}>
        <b>{current}</b><i>/</i>{total}
      </span>
      <span className="board-move-rail-thumb" style={{ left: `${Math.round(thumb * 100)}%` }}/>
    </div>
  </div>;
}
