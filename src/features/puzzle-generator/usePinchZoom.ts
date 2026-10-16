import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { MAX_BOARD_SCALE, clampBoardScale, shouldZoomOnWheel, zoomAnchorScroll } from "../../board-zoom";

/**
 * 捏合 / Ctrl+滚轮缩放，**围着手指（或光标）那一点放大**。
 *
 * 打谱界面的棋盘早就有这套手感，棋谱生成器原先只有一个「放大棋盘 / 适应屏幕」的
 * 固定档开关（用户 10-06：把它去掉，生成器也要能随手放大缩小）。
 * 量程与锚点换算全部复用 `src/board-zoom.ts`，所以两处的最大倍率、每格滚轮步长、
 * 「指针下那一点不能跑」是同一份实现，不会各调一套。
 */
export function usePinchZoom<T extends HTMLElement>(enabled = true): {
  containerRef: RefObject<T | null>;
  scale: number;
  reset: () => void;
} {
  const containerRef = useRef<T | null>(null);
  const [scale, setScale] = useState(1);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const previousScale = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureStart = useRef<{ distance: number; scale: number } | null>(null);

  const reset = useCallback(() => { anchorRef.current = null; setScale(1); }, []);

  const distance = () => {
    const [first, second] = Array.from(pointers.current.values());
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) || 1 : 0;
  };
  const center = () => {
    const list = Array.from(pointers.current.values());
    const sum = list.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / list.length, y: sum.y / list.length };
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !enabled) return;
    const rememberAnchor = () => {
      const box = node.getBoundingClientRect();
      const point = center();
      anchorRef.current = { x: point.x - box.left, y: point.y - box.top };
    };
    const onTouchStart = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) pointers.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      if (pointers.current.size === 2) { rememberAnchor(); gestureStart.current = { distance: distance(), scale }; }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (pointers.current.size < 2 || !gestureStart.current) return;
      for (const touch of Array.from(event.changedTouches)) {
        if (pointers.current.has(touch.identifier)) pointers.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
      const next = clampBoardScale(gestureStart.current.scale * (distance() / gestureStart.current.distance));
      if (Math.abs(next - scale) > 0.01) { rememberAnchor(); setScale(next); event.preventDefault(); }
    };
    const onTouchEnd = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) pointers.current.delete(touch.identifier);
      if (pointers.current.size < 2) gestureStart.current = null;
    };
    // 桌面端与打谱界面一致：触摸板捏合在 Chromium/WebKit 里是带 ctrlKey 的 wheel。
    const onWheel = (event: WheelEvent) => {
      if (!shouldZoomOnWheel(event)) return;
      event.preventDefault();
      const box = node.getBoundingClientRect();
      anchorRef.current = { x: event.clientX - box.left, y: event.clientY - box.top };
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((current) => clampBoardScale(current * factor));
    };
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      node.removeEventListener("wheel", onWheel);
    };
  }, [enabled, scale]);

  // 等新宽度上了布局再补滚动量：这时才拿得到新的 scrollWidth，锚点才不会跳回左上角。
  useLayoutEffect(() => {
    const node = containerRef.current;
    const anchor = anchorRef.current;
    const fromScale = previousScale.current;
    previousScale.current = scale;
    if (!node || !anchor || fromScale === scale) return;
    anchorRef.current = null;
    const next = zoomAnchorScroll({
      anchorX: anchor.x, anchorY: anchor.y,
      scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
      fromScale, toScale: scale,
    });
    node.scrollLeft = next.left;
    node.scrollTop = next.top;
  }, [scale]);

  return { containerRef, scale: enabled ? scale : 1, reset };
}

export const PINCH_ZOOM_MAX_SCALE = MAX_BOARD_SCALE;
