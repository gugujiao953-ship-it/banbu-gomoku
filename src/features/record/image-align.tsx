import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BoardRoi } from "../../image-recognition";

/**
 * Full-screen image preview (styled after Zhizi's import flow): the square
 * frame with corner brackets and a 3×3 guide stays put while the user drags
 * and zooms the IMAGE underneath to align the board. Recognition always runs
 * the whole-image recognizer on the original file (crop-confirm was removed —
 * cropped frames lost the off-board context the grid detector relies on).
 * The frame still matters: its position is reported as a normalized ROI so
 * the recognizer can bias grid selection, anchor its fallback grid and
 * discard false stones outside the board.
 */

const FRAME_INSET = 18; // gap between frame and screen edges, px

const formatPct = (zoom: number) => `${Math.round(zoom * 100)}%`;

export function BoardAlignScreen({
  src,
  alt,
  onCancel,
  onRecognize,
  busy,
  restoreMoveOrder,
  restoreEnabled,
  onRestoreMoveOrderChange,
}: {
  src: string;
  alt: string;
  onCancel: () => void;
  onRecognize: (roi: BoardRoi | null) => void;
  busy: boolean;
  restoreMoveOrder: boolean;
  // 「复原手序」是开发测试功能（设置→开发测试功能），未开启时整个开关不渲染。
  restoreEnabled: boolean;
  onRestoreMoveOrderChange: (value: boolean) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // 用户是否主动拖拽/缩放对齐过棋盘：未动过时不上报 ROI（默认框=画面中央，
  // 对多数居中截图反而是干扰；识别走原整图路径，行为与旧版完全一致）。
  const userAdjustedRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const pinchRef = useRef<{ distance: number; baseZoom: number; cx: number; cy: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [native, setNative] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const frame = useMemo(() => {
    // Integer geometry keeps the 1px guide lines and the frame border crisp;
    // fractional positions land on half-pixels and render as wavy lines.
    const side = Math.max(0, Math.round(Math.min(size.w, size.h) - FRAME_INSET * 2));
    return { x: Math.round((size.w - side) / 2), y: Math.round((size.h - side) / 2), side };
  }, [size]);

  // Keep the frame fully covered by the image (no empty frame areas): the
  // image's left edge can never pass the frame's left edge, and its right
  // edge can never fall short of the frame's right edge — same on Y. This is
  // what stops the frame from being dragged off the image.
  const clampTransform = useCallback((next: { scale: number; x: number; y: number }) => {
    if (!native.w || !native.h || !frame.side) return next;
    const minScale = Math.max(frame.side / native.w, frame.side / native.h);
    const scale = Math.max(minScale, Math.min(4, next.scale));
    const maxX = frame.x;
    const minX = frame.x + frame.side - native.w * scale;
    const maxY = frame.y;
    const minY = frame.y + frame.side - native.h * scale;
    return {
      scale,
      x: Math.max(minX, Math.min(maxX, next.x)),
      y: Math.max(minY, Math.min(maxY, next.y)),
    };
  }, [native.w, native.h, frame]);

  const onImageLoad = useCallback(() => {
    const img = imageRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    setNative({ w: nw, h: nh });
    const rect = stage.getBoundingClientRect();
    setSize({ w: rect.width, h: rect.height });
    const side = Math.max(0, Math.min(rect.width, rect.height) - FRAME_INSET * 2);
    // Initial zoom: cover the frame, centered on the frame centre.
    const scale = Math.max(side / nw, side / nh);
    setTransform({
      scale,
      x: (rect.width - nw * scale) / 2,
      y: (rect.height - nh * scale) / 2,
    });
    setZoom(1);
  }, []);

  const applyZoom = useCallback((nextZoom: number, anchor?: { x: number; y: number }) => {
    userAdjustedRef.current = true;
    const stage = stageRef.current;
    if (!stage || !native.w) return;
    const rect = stage.getBoundingClientRect();
    setTransform((current) => {
      const scale = current.scale * (nextZoom / zoom);
      const anchorX = anchor?.x ?? rect.width / 2;
      const anchorY = anchor?.y ?? rect.height / 2;
      const ix = (anchorX - current.x) / current.scale;
      const iy = (anchorY - current.y) / current.scale;
      return clampTransform({ scale, x: anchorX - ix * scale, y: anchorY - iy * scale });
    });
    setZoom(nextZoom);
  }, [native.w, zoom, clampTransform]);

  const resetTransform = useCallback(() => {
    userAdjustedRef.current = false;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const side = Math.max(0, Math.min(rect.width, rect.height) - FRAME_INSET * 2);
    const scale = Math.max(side / native.w, side / native.h);
    setTransform(clampTransform({ scale, x: (rect.width - native.w * scale) / 2, y: (rect.height - native.h * scale) / 2 }));
    setZoom(1);
  }, [native.w, native.h, clampTransform]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return; // single-finger touch handled in touch handlers
    userAdjustedRef.current = true;
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: transform.x, baseY: transform.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    setTransform((current) => clampTransform({ ...current, x: drag.baseX + (event.clientX - drag.startX), y: drag.baseY + (event.clientY - drag.startY) }));
  };
  const endDrag = () => { dragRef.current = null; };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touches = event.touches;
    pinchRef.current = null;
    userAdjustedRef.current = true;
    if (touches.length === 1) {
      dragRef.current = { pointerId: -1, startX: touches[0].clientX, startY: touches[0].clientY, baseX: transform.x, baseY: transform.y };
    }
  };
  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touches = event.touches;
    if (touches.length >= 2) {
      const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const cx = (touches[0].clientX + touches[1].clientX) / 2;
      const cy = (touches[0].clientY + touches[1].clientY) / 2;
      if (pinchRef.current) applyZoom((dist / pinchRef.current.distance) * pinchRef.current.baseZoom, { x: cx, y: cy });
      else pinchRef.current = { distance: dist, baseZoom: zoom, cx, cy };
      dragRef.current = null;
    } else if (touches.length === 1) {
      const t = touches[0];
      const drag = dragRef.current;
      if (drag && drag.pointerId === -1) {
        setTransform((current) => clampTransform({ ...current, x: drag.baseX + (t.clientX - drag.startX), y: drag.baseY + (t.clientY - drag.startY) }));
      }
    }
  };
  const onTouchEnd = () => { dragRef.current = null; pinchRef.current = null; };

  // 框选位置 → 原图上的归一化 ROI（不裁剪，只报坐标给识别器作先验）。
  // 仅当用户实际拖拽/缩放对齐过棋盘时上报；默认框不是用户的意图。
  const computeRoi = (): BoardRoi | null => {
    if (!userAdjustedRef.current) return null;
    const img = imageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight || !frame.side) return null;
    const s = transform.scale;
    const fx = (frame.x - transform.x) / s;
    const fy = (frame.y - transform.y) / s;
    const fw = frame.side / s;
    const x = Math.max(0, fx / img.naturalWidth);
    const y = Math.max(0, fy / img.naturalHeight);
    const w = Math.min(1 - x, fw / img.naturalWidth);
    const h = Math.min(1 - y, fw / img.naturalHeight);
    return w > 0.02 && h > 0.02 ? { x, y, w, h } : null;
  };

  const guides: React.ReactNode[] = [];
  for (const k of [1, 2]) {
    const pos = Math.round(frame.side * k / 3);
    guides.push(<span key={`v${k}`} className="board-fs-guide-v" style={{ left: pos }}/>);
    guides.push(<span key={`h${k}`} className="board-fs-guide-h" style={{ top: pos }}/>);
  }
  const corners = ["tl", "tr", "bl", "br"] as const;

  return (
    <div className="board-fs">
      <header className="board-fs-top">
        <button type="button" className="board-fs-icon" onClick={onCancel} aria-label="取消对齐" disabled={busy}>
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>
        </button>
        <b>对齐棋盘</b>
        <span className="board-fs-icon-placeholder" aria-hidden="true"/>
      </header>
      <div
        ref={stageRef}
        className="board-fs-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onImageLoad}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: "0 0" }}
        />
        <div className="board-fs-frame" style={{ left: frame.x, top: frame.y, width: frame.side, height: frame.side }}>
          {guides}
          {corners.map((corner) => <span key={corner} className={`board-fs-corner corner-${corner}`}/>)}
        </div>
      </div>
      <div className="board-fs-zoom">
        <span className="board-fs-zoom-pct">{formatPct(zoom)}</span>
        <div className="board-fs-ruler">
          <input
            type="range"
            min={40}
            max={260}
            step={1}
            value={Math.round(zoom * 100)}
            aria-label="缩放图片"
            onChange={(event) => applyZoom(Number(event.target.value) / 100)}
          />
        </div>
      </div>
      <div className="board-fs-bottom">
        {restoreEnabled && <label className="board-fs-restore-order">
          <span>
            <b>复原手序</b>
            <small>开启后按棋子上的序号恢复落子顺序；仅支持带手数标记的截图，序号需完整连续</small>
          </span>
          <input type="checkbox" checked={restoreMoveOrder} disabled={busy} onChange={(event) => onRestoreMoveOrderChange(event.target.checked)}/>
          <i/>
        </label>}
        <div className="board-fs-actions">
          <button type="button" className="board-fs-action" onClick={resetTransform} disabled={busy}>
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
            重置
          </button>
          <button type="button" className="board-fs-action" onClick={() => onRecognize(computeRoi())} disabled={busy}>
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>
            识别
          </button>
        </div>
      </div>
    </div>
  );
}
