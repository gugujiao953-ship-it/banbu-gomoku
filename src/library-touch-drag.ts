// Touch drag ordering for the library: long-press a draggable row to lift it,
// move to reorder (insert indicator reuses .drag-before/.drag-after), a SECOND
// finger scrolls the list, and holding near the viewport edge auto-scrolls at
// a steady pace. Auto-scroll and finger scrolling are clamped to the dragged
// item's container: an item never scrolls out of its folder, a folder only to
// its parent's bottom, a top-level folder to the page bottom.
import type { LibraryOrderKind } from "./library-order";

export interface LibraryTouchDragOptions {
  enabled: () => boolean;
  performDrop: (kind: LibraryOrderKind, key: string, draggedId: string, targetId: string, placeBefore: boolean) => void;
}

const LONG_PRESS_MS = 220;
const MOVE_CANCEL_PX = 12;
const EDGE_ZONE = 76;
const AUTO_SPEED_PX_S = 300;

interface DragCandidate {
  kind: LibraryOrderKind;
  key: string;
  id: string;
  element: HTMLElement;
  fingerId: number;
  startX: number;
  startY: number;
  timer: number | null;
}

interface ActiveDrag {
  kind: LibraryOrderKind;
  key: string;
  id: string;
  source: HTMLElement;
  ghost: HTMLElement;
  grabDx: number;
  grabDy: number;
  fingerId: number;
  scrollFinger: { id: number; lastY: number } | null;
  lastX: number;
  lastY: number;
  scope: HTMLElement | null;
  target: { element: HTMLElement; before: boolean } | null;
  raf: number | null;
  lastFrame: number;
}

const cssEscape = (value: string) => (window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
const scrollElement = () => document.scrollingElement as HTMLElement;

export const attachLibraryTouchDrag = ({ enabled, performDrop }: LibraryTouchDragOptions) => {
  let candidate: DragCandidate | null = null;
  let active: ActiveDrag | null = null;

  const clearIndicator = () => {
    document.querySelectorAll(".drag-before, .drag-after").forEach((node) => node.classList.remove("drag-before", "drag-after"));
  };

  const scopeRectFor = () => active?.scope?.getBoundingClientRect() ?? null;

  const hitTest = () => {
    if (!active) return;
    clearIndicator();
    active.target = null;
    const hit = document.elementFromPoint(active.lastX, active.lastY);
    const found = hit?.closest<HTMLElement>("[data-order-id][data-drag-kind]");
    if (!found || found.dataset.dragKind !== active.kind || found.dataset.dragKey !== active.key) return;
    if (found.dataset.orderId === active.id || found === active.source || active.source.contains(found)) return;
    const rect = found.getBoundingClientRect();
    const before = active.lastY < rect.top + rect.height / 2;
    found.classList.add(before ? "drag-before" : "drag-after");
    active.target = { element: found, before };
  };

  const autoScrollFrame = (timestamp: number) => {
    if (!active) return;
    const dt = active.lastFrame ? Math.min(48, timestamp - active.lastFrame) : 16;
    active.lastFrame = timestamp;
    const element = scrollElement();
    const viewHeight = window.innerHeight;
    const pointerY = active.lastY;
    const scope = scopeRectFor();
    let scrolled = false;
    if (pointerY > viewHeight - EDGE_ZONE) {
      const allowed = !scope || pointerY < scope.bottom - 6;
      if (allowed) { element.scrollTop += (AUTO_SPEED_PX_S * dt) / 1000; scrolled = true; }
    } else if (pointerY < EDGE_ZONE + 20) {
      const allowed = !scope || pointerY > scope.top + 6;
      if (allowed) { element.scrollTop -= (AUTO_SPEED_PX_S * dt) / 1000; scrolled = true; }
    }
    if (scrolled) hitTest();
    active.raf = requestAnimationFrame(autoScrollFrame);
  };

  const startDrag = () => {
    if (!candidate) return;
    const entry = candidate;
    candidate = null;
    if (!enabled()) return;
    const rect = entry.element.getBoundingClientRect();
    const ghost = entry.element.cloneNode(true) as HTMLElement;
    ghost.classList.add("touch-drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.querySelectorAll("[data-drag-kind]").forEach((node) => node.removeAttribute("data-drag-kind"));
    document.body.appendChild(ghost);
    entry.element.classList.add("touch-drag-source");
    navigator.vibrate?.(12);
    active = {
      kind: entry.kind,
      key: entry.key,
      id: entry.id,
      source: entry.element,
      ghost,
      grabDx: entry.startX - rect.left,
      grabDy: entry.startY - rect.top,
      fingerId: entry.fingerId,
      scrollFinger: null,
      lastX: entry.startX,
      lastY: entry.startY,
      scope: scopeFor(entry),
      target: null,
      raf: null,
      lastFrame: 0,
    };
    moveGhost(entry.startX, entry.startY);
    active.raf = requestAnimationFrame(autoScrollFrame);
  };

  const scopeFor = (entry: DragCandidate): HTMLElement | null => {
    if (entry.kind === "puzzles") return entry.element.closest(".puzzle-manager-list");
    const section = entry.element.closest(".library-folder-section");
    if (entry.kind === "records" || entry.kind === "puzzleCollections") return section?.querySelector(":scope > .folder-items") ?? null;
    // folders: the parent folder's expanded block; "" means top level (page)
    if (!entry.key) return null;
    const parentHead = document.querySelector(`.library-folder-head[data-order-id="${cssEscape(entry.key)}"][data-drag-kind="${entry.kind}"]`);
    return parentHead?.closest(".library-folder-section")?.querySelector(":scope > .folder-items") ?? null;
  };

  const moveGhost = (x: number, y: number) => {
    if (!active) return;
    active.ghost.style.transform = `translate(${x - active.grabDx}px, ${y - active.grabDy}px)`;
  };

  const cancelCandidate = () => {
    if (candidate?.timer) window.clearTimeout(candidate.timer);
    candidate = null;
  };

  const finishDrag = (drop: boolean) => {
    const entry = active;
    if (!entry) return;
    active = null;
    if (entry.raf) cancelAnimationFrame(entry.raf);
    entry.ghost.remove();
    entry.source.classList.remove("touch-drag-source");
    clearIndicator();
    const target = entry.target;
    if (drop && target && target.element.dataset.orderId && target.element.dataset.orderId !== entry.id) {
      performDrop(entry.kind, entry.key, entry.id, target.element.dataset.orderId, target.before);
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    if (active) {
      // second finger while dragging: dedicate it to scrolling the list
      if (!active.scrollFinger) active.scrollFinger = { id: touch.identifier, lastY: touch.clientY };
      return;
    }
    if (!enabled() || candidate) return;
    const origin = (touch.target as HTMLElement | null)?.closest<HTMLElement>("[data-drag-kind][data-order-id]");
    if (!origin || !origin.dataset.dragKind) return;
    const kind = origin.dataset.dragKind as LibraryOrderKind;
    const key = origin.dataset.dragKey ?? "";
    const id = origin.dataset.orderId ?? "";
    if (!id) return;
    const next: DragCandidate = {
      kind, key, id,
      element: kind === "recordFolders" || kind === "puzzleFolders" ? origin : origin,
      fingerId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      timer: null,
    };
    // folder heads carry data-order-id of themselves; the drag id is the folder path
    next.timer = window.setTimeout(() => { if (candidate === next) { candidate.timer = null; startDrag(); } }, LONG_PRESS_MS);
    candidate = next;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (active) {
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        if (touch.identifier === active.fingerId) {
          active.lastX = touch.clientX;
          active.lastY = touch.clientY;
          moveGhost(touch.clientX, touch.clientY);
          hitTest();
        } else if (active.scrollFinger && touch.identifier === active.scrollFinger.id) {
          const delta = touch.clientY - active.scrollFinger.lastY;
          active.scrollFinger.lastY = touch.clientY;
          if (!delta) continue;
          const element = scrollElement();
          const previous = element.scrollTop;
          const pointerY = active.lastY;
          element.scrollTop += delta;
          const scope = scopeRectFor();
          if (scope && (pointerY > scope.bottom - 4 || pointerY < scope.top + 4)) element.scrollTop = previous;
        }
      }
      return;
    }
    if (!candidate) return;
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier !== candidate.fingerId) continue;
      // movement before the long-press fires means the user is scrolling
      if (Math.hypot(touch.clientX - candidate.startX, touch.clientY - candidate.startY) > MOVE_CANCEL_PX) cancelCandidate();
    }
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (active) {
      for (const touch of Array.from(event.changedTouches)) {
        if (touch.identifier === active.fingerId) {
          event.preventDefault();
          finishDrag(true);
          return;
        }
        if (active.scrollFinger && touch.identifier === active.scrollFinger.id) active.scrollFinger = null;
      }
      return;
    }
    if (candidate && Array.from(event.changedTouches).some((touch) => touch.identifier === candidate?.fingerId)) cancelCandidate();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (active || candidate) event.preventDefault();
  };

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: false });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false });
  document.addEventListener("contextmenu", onContextMenu);

  return () => {
    cancelCandidate();
    if (active) finishDrag(false);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchEnd);
    document.removeEventListener("contextmenu", onContextMenu);
  };
};
