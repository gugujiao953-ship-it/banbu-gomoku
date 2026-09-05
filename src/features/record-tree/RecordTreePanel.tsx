import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Clipboard, Copy, GitBranch, LocateFixed, Minus, MoreHorizontal, PencilLine, Plus, RotateCcw, Search, Scissors, Trash2, X, ZoomIn } from "lucide-react";
import { coordinateName } from "../../game";
import { compactChildCount, compactChildWindow, compactIndexOf, compactNodeIndex } from "../../compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";
import type { RecordBookmark } from "./bookmarks";
import { searchRecordBookmarks } from "./bookmarks";
import type { SubtreeClipboard } from "./subtree-clipboard";
import "./record-tree.css";

const TREE_NODE_WIDTH = 132;
const TREE_NODE_HEIGHT = 44;
const TREE_X_GAP = 30;
const TREE_Y_GAP = 14;
const TREE_CHILD_WINDOW = 12;
const TREE_NODE_BUDGET = 240;
const TREE_MIN_SCALE = 0.3;
const TREE_MAX_SCALE = 10;
const TREE_DRAG_THRESHOLD = 6;

interface TreeCanvasPoint {
  x: number;
  y: number;
}

const clientPointInTreeCanvas = (svg: SVGSVGElement, clientX: number, clientY: number): TreeCanvasPoint => {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) return { x: clientX, y: clientY };
  const renderedScale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const leftInset = (rect.width - viewBox.width * renderedScale) / 2;
  const topInset = (rect.height - viewBox.height * renderedScale) / 2;
  return {
    x: viewBox.x + (clientX - rect.left - leftInset) / renderedScale,
    y: viewBox.y + (clientY - rect.top - topInset) / renderedScale,
  };
};

interface TreeEntry {
  id: string;
  parentId: string | null;
  depth: number;
  turnDepth: number;
  node: RecordNode;
  childCount: number;
  truncated: number;
  onPath: boolean;
  isCurrent: boolean;
}

export interface RecordTreePanelProps {
  document: GameDocument;
  currentId: string;
  path: RecordNode[];
  compactIndex?: CompactRenLibIndex;
  bookmarks: RecordBookmark[];
  clipboard: SubtreeClipboard | null;
  busy?: boolean;
  readOnly?: boolean;
  branchNameOverrides?: Record<string, string>;
  onLocate: (id: string, pivotId?: string) => void;
  onCreateBranch: (id: string) => void;
  onRenameBranch: (id: string, title: string) => void;
  onDeleteBranch: (id: string) => void;
  onCopy: (id: string) => void;
  onCut: (id: string) => void;
  onPaste: (id: string) => void;
  onCancelCopy: () => void;
  onToggleBookmark: (id: string) => void;
  onEditBookmark: (bookmark: RecordBookmark, patch: Partial<Pick<RecordBookmark, "title" | "note" | "accent">>) => void;
  onDeleteBookmark: (bookmark: RecordBookmark) => void;
}

const baseLabelForNode = (node: RecordNode) => node.move
  ? coordinateName(node.move)
  : node.passPlayer
    ? `${node.passPlayer === "black" ? "黑" : "白"}方过手`
    : node.setup
      ? "设置局面"
      : node.parentId
        ? "注释节点"
        : "起始局面";

const labelForNode = (node: RecordNode) => node.boardText?.trim() || baseLabelForNode(node);
const playerForNode = (node: RecordNode) => node.move?.player || node.passPlayer;

export function RecordTreePanel(props: RecordTreePanelProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 18, y: 18 });
  const [selectedId, setSelectedId] = useState(props.currentId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<"tree" | "bookmarks">("tree");
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [branchTitle, setBranchTitle] = useState("");
  const dragRef = useRef({ active: false, moved: false, pointerId: -1, startX: 0, startY: 0, startClientX: 0, startClientY: 0, panX: 0, panY: 0 });
  const pinchRef = useRef({ points: new Map<number, { x: number; y: number }>(), distance: 0, scale: 1, active: false });
  const pinchGestureRef = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressProgressTimer = useRef<number | null>(null);
  const [longPressId, setLongPressId] = useState<string | null>(null);
  const [pressingId, setPressingId] = useState<string | null>(null);
  const [longPressProgress, setLongPressProgress] = useState(0);
  const readOnly = Boolean(props.readOnly);
  const displayLabel = (node: RecordNode, id: string) => props.branchNameOverrides?.[id]?.trim() || labelForNode(node);

  useEffect(() => { setSelectedId(props.currentId); }, [props.currentId]);
  useEffect(() => {
    setSelectedId(props.currentId);
    setExpandedIds(new Set());
    setView("tree");
  }, [props.document.id]);
  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (longPressProgressTimer.current !== null) window.clearInterval(longPressProgressTimer.current);
  }, []);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (longPressProgressTimer.current !== null) window.clearInterval(longPressProgressTimer.current);
    longPressTimer.current = null; longPressProgressTimer.current = null;
    setLongPressProgress(0); setPressingId(null);
  };
  const beginLongPress = (id: string) => {
    cancelLongPress();
    setLongPressId(null); setLongPressProgress(0); setPressingId(id);
    const started = Date.now();
    longPressProgressTimer.current = window.setInterval(() => setLongPressProgress(Math.min(1, (Date.now() - started) / 620)), 32);
    longPressTimer.current = window.setTimeout(() => {
      setLongPressProgress(1); setSelectedId(id); setLongPressId(id); cancelLongPress();
    }, 620);
  };

  const pathIds = useMemo(() => new Set(props.path.map((node) => node.id)), [props.path]);
  const pathDepths = useMemo(() => new Map(props.path.map((node, index) => [node.id, index])), [props.path]);
  const isCompact = Boolean(props.compactIndex || compactIndexOf(props.document));
  const bookmarkByNode = useMemo(() => new Map(props.bookmarks.map((bookmark) => [bookmark.nodeId, bookmark])), [props.bookmarks]);
  const selected = props.document.nodes[selectedId] || props.document.nodes[props.currentId];
  const selectedBookmark = selected ? bookmarkByNode.get(selected.id) : undefined;
  const filteredBookmarks = useMemo(() => searchRecordBookmarks(props.bookmarks, bookmarkQuery), [bookmarkQuery, props.bookmarks]);

  const nudgeScale = (direction: -1 | 1) => setScale((value) => {
    const step = direction > 0 ? value < 2 ? 0.15 : value < 5 ? 0.5 : 1 : value <= 2 ? 0.15 : value <= 5 ? 0.5 : 1;
    return Math.min(TREE_MAX_SCALE, Math.max(TREE_MIN_SCALE, Number((value + direction * step).toFixed(2))));
  });

  const tree = useMemo(() => {
    const entries: TreeEntry[] = [];
    const visited = new Set<string>();
    const compact = props.compactIndex || compactIndexOf(props.document);
    const rootId = props.document.rootId;

    const readChildren = (id: string, node: RecordNode, pathIndex: number) => {
      const index = compact ? compactNodeIndex(props.document, id) : undefined;
      const total = index === undefined || !compact ? node.children.length : compactChildCount(compact, index);
      const ids = index === undefined || !compact
        ? node.children.slice(0, TREE_CHILD_WINDOW)
        : compactChildWindow(compact, index, 0, Math.min(total, TREE_CHILD_WINDOW));
      const pathChild = props.path[pathIndex + 1]?.id;
      if (pathChild && !ids.includes(pathChild)) ids.push(pathChild);
      return { ids, total };
    };

    const visit = (id: string, depth: number, turnDepth: number, pathIndex: number) => {
      if (entries.length >= TREE_NODE_BUDGET || visited.has(id)) return;
      const node = props.document.nodes[id];
      if (!node) return;
      visited.add(id);
      const children = readChildren(id, node, pathIndex);
      const onPath = pathIds.has(id);
      entries.push({ id, parentId: node.parentId, depth, turnDepth, node, childCount: children.total, truncated: Math.max(0, children.total - children.ids.length), onPath, isCurrent: id === props.currentId });
      for (const childId of children.ids) {
        if (entries.length >= TREE_NODE_BUDGET) break;
        const child = props.document.nodes[childId];
        if (!child || visited.has(childId)) continue;
        const childTurnDepth = turnDepth + (child.move || child.passPlayer ? 1 : 0);
        const shouldExpand = pathIds.has(childId) || expandedIds.has(id) || expandedIds.has(childId);
        if (shouldExpand) visit(childId, depth + 1, childTurnDepth, pathIds.has(childId) ? pathIndex + 1 : -1);
        else {
          visited.add(childId);
          const childIndex = compact ? compactNodeIndex(props.document, childId) : undefined;
          const childCount = childIndex === undefined || !compact ? child.children.length : compactChildCount(compact, childIndex);
          entries.push({ id: childId, parentId: id, depth: depth + 1, turnDepth: childTurnDepth, node: child, childCount, truncated: 0, onPath: false, isCurrent: childId === props.currentId });
        }
      }
    };
    visit(rootId, 0, 0, pathDepths.get(rootId) ?? 0);
    return entries;
  }, [expandedIds, pathDepths, pathIds, props.compactIndex, props.currentId, props.document, props.path]);

  const positions = useMemo(() => {
    const maxDepth = tree.reduce((max, entry) => Math.max(max, entry.depth), 0);
    const contentWidth = Math.max(430, (maxDepth + 1) * (TREE_NODE_WIDTH + TREE_X_GAP) + 30);
    const contentHeight = Math.max(240, tree.length * (TREE_NODE_HEIGHT + TREE_Y_GAP) + 36);
    const byId = new Map(tree.map((entry, index) => [entry.id, { x: 18 + entry.depth * (TREE_NODE_WIDTH + TREE_X_GAP), y: 18 + index * (TREE_NODE_HEIGHT + TREE_Y_GAP) }]));
    return { contentWidth, contentHeight, byId };
  }, [tree]);

  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = clientPointInTreeCanvas(event.currentTarget, event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      pinchRef.current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current.points.size === 1) {
        pinchGestureRef.current = false;
        pinchRef.current.active = false;
        dragRef.current = {
          active: true,
          moved: false,
          pointerId: event.pointerId,
          startX: point.x,
          startY: point.y,
          startClientX: event.clientX,
          startClientY: event.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
      if (pinchRef.current.points.size >= 2) {
        const [a, b] = Array.from(pinchRef.current.points.values());
        pinchRef.current.distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        pinchRef.current.scale = scale;
        pinchRef.current.active = true;
        pinchGestureRef.current = true;
        dragRef.current.active = false;
        dragRef.current.moved = true;
        for (const pointerId of pinchRef.current.points.keys()) event.currentTarget.setPointerCapture(pointerId);
        cancelLongPress();
      }
      return;
    }
    dragRef.current = { active: true, moved: false, pointerId: event.pointerId, startX: point.x, startY: point.y, startClientX: event.clientX, startClientY: event.clientY, panX: pan.x, panY: pan.y };
  };
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      const points = pinchRef.current.points;
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size >= 2 && pinchRef.current.active) {
        const [a, b] = Array.from(points.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        setScale(Math.min(TREE_MAX_SCALE, Math.max(TREE_MIN_SCALE, Number((pinchRef.current.scale * distance / pinchRef.current.distance).toFixed(2)))));
        dragRef.current.moved = true;
        cancelLongPress();
        return;
      }
    }
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const clientDx = event.clientX - drag.startClientX;
    const clientDy = event.clientY - drag.startClientY;
    if (Math.hypot(clientDx, clientDy) > TREE_DRAG_THRESHOLD && !drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      cancelLongPress();
    }
    if (!drag.moved) return;
    const point = clientPointInTreeCanvas(event.currentTarget, event.clientX, event.clientY);
    setPan({ x: drag.panX + point.x - drag.startX, y: drag.panY + point.y - drag.startY });
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      pinchRef.current.points.delete(event.pointerId);
      if (pinchRef.current.points.size < 2) pinchRef.current.active = false;
      if (dragRef.current.pointerId === event.pointerId) dragRef.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (pinchRef.current.points.size === 0) window.setTimeout(() => { pinchGestureRef.current = false; }, 0);
      return;
    }
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const beginBookmarkEdit = (bookmark: RecordBookmark) => {
    setEditingBookmarkId(bookmark.id);
    setBookmarkTitle(bookmark.title);
    setBookmarkNote(bookmark.note);
  };
  const commitBookmarkEdit = () => {
    const bookmark = props.bookmarks.find((item) => item.id === editingBookmarkId);
    if (!bookmark || !bookmarkTitle.trim()) return;
    props.onEditBookmark(bookmark, { title: bookmarkTitle, note: bookmarkNote });
    setEditingBookmarkId(null);
  };

  return <div className="record-tree-panel">
    <div className="record-tree-tabs" role="tablist" aria-label="分支树视图">
      <button type="button" className={view === "tree" ? "active" : ""} onClick={() => setView("tree")} role="tab" aria-selected={view === "tree"}><GitBranch/>分支树</button>
      <button type="button" className={view === "bookmarks" ? "active" : ""} onClick={() => setView("bookmarks")} role="tab" aria-selected={view === "bookmarks"}><Bookmark/>书签{props.bookmarks.length ? ` ${props.bookmarks.length}` : ""}</button>
    </div>

    {props.clipboard && !readOnly && <div className="tree-copy-banner" role="status"><Clipboard/><span><b>已复制 {Object.keys(props.clipboard.nodes).length} 个节点</b><small>点选目标节点，再点“粘贴到这里”</small></span><button type="button" onClick={props.onCancelCopy}>取消</button></div>}

    {view === "bookmarks" ? <div className="tree-bookmark-browser">
      <label className="tree-bookmark-search"><Search/><input value={bookmarkQuery} onChange={(event) => setBookmarkQuery(event.target.value)} placeholder="搜索书签标题或备注" aria-label="搜索书签"/></label>
      <div className="tree-bookmark-list">
        {filteredBookmarks.map((bookmark) => <article key={bookmark.id} className={`tree-bookmark-card ${bookmark.accent || "jade"}`}>
          {!readOnly && editingBookmarkId === bookmark.id ? <div className="tree-bookmark-edit">
            <label>标题<input autoFocus value={bookmarkTitle} onChange={(event) => setBookmarkTitle(event.target.value)}/></label>
            <label>备注<textarea value={bookmarkNote} onChange={(event) => setBookmarkNote(event.target.value)} placeholder="自由记录研究想法"/></label>
            <div className="bookmark-accent-picker" aria-label="书签标识颜色">{(["jade", "gold", "blue", "rose"] as const).map((accent) => <button key={accent} type="button" className={accent} aria-label={`选择${accent}标识`} onClick={() => props.onEditBookmark(bookmark, { accent })}/>)}</div>
            <div className="tree-edit-actions"><button type="button" onClick={commitBookmarkEdit}><Check/>保存</button><button type="button" onClick={() => setEditingBookmarkId(null)}><X/>取消</button></div>
          </div> : <>
            <button type="button" className="tree-bookmark-jump" onClick={() => props.onLocate(bookmark.nodeId)}><Bookmark/><span><b>{bookmark.title}</b><small>{bookmark.note || labelForNode(props.document.nodes[bookmark.nodeId] || { parentId: null, move: null } as RecordNode)}</small></span><LocateFixed/></button>
            {!readOnly && <div className="tree-bookmark-actions"><button type="button" onClick={() => beginBookmarkEdit(bookmark)} aria-label={`编辑书签 ${bookmark.title}`}><PencilLine/>编辑</button><button type="button" onClick={() => props.onDeleteBookmark(bookmark)} aria-label={`删除书签 ${bookmark.title}`}><Trash2/>删除</button></div>}
          </>}
        </article>)}
        {!filteredBookmarks.length && <div className="sheet-empty"><Bookmark/><b>{bookmarkQuery ? "没有匹配的书签" : "还没有书签"}</b><span>{bookmarkQuery ? "换个标题或备注关键词试试。" : "回到变化树，选中节点后即可快速添加。"}</span></div>}
      </div>
    </div> : <>
      <div className="tree-toolbar">
        <div><b>当前路径附近</b><small>{isCompact ? "大型棋谱按需显示可视窗口" : `${tree.length} 个可视节点`}</small></div>
        <div className="tree-zoom-controls" aria-label="分支树缩放">
          <button type="button" onClick={() => nudgeScale(-1)} aria-label="缩小"><Minus/></button>
          <input className="tree-zoom-range" type="range" min={TREE_MIN_SCALE} max={TREE_MAX_SCALE} step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="缩放比例"/>
          <span>{scale >= TREE_MAX_SCALE ? "10×" : `${Math.round(scale * 100)}%`}</span>
          <button type="button" onClick={() => nudgeScale(1)} aria-label="放大"><Plus/></button>
          <button type="button" onClick={() => { setScale(1); setPan({ x: 18, y: 18 }); }} aria-label="重置视图"><RotateCcw/></button>
        </div>
        <div className="tree-zoom-presets" aria-label="快速缩放"><button type="button" onClick={() => setScale(0.3)}>30%</button><button type="button" onClick={() => setScale(0.5)}>50%</button><button type="button" onClick={() => setScale(1)}>100%</button><button type="button" onClick={() => setScale(2)}>2×</button><button type="button" onClick={() => setScale(5)}>5×</button><button type="button" onClick={() => setScale(10)}>10×</button></div>
      </div>
      <div className="tree-viewport" aria-label="棋谱树，可拖动查看">
        <svg className="tree-canvas" width="100%" height="340" viewBox={`0 0 ${positions.contentWidth} ${positions.contentHeight}`} role="img" aria-label="分支树，可拖动查看；双指可缩放" onPointerDownCapture={startDrag} onPointerMoveCapture={moveDrag} onPointerUpCapture={endDrag} onPointerCancelCapture={endDrag}>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            <g className="tree-edges">{tree.map((entry) => {
              const child = positions.byId.get(entry.id), parent = entry.parentId ? positions.byId.get(entry.parentId) : undefined;
              if (!child || !parent) return null;
              const startX = parent.x + TREE_NODE_WIDTH, startY = parent.y + TREE_NODE_HEIGHT / 2, endX = child.x, endY = child.y + TREE_NODE_HEIGHT / 2, midX = startX + Math.max(18, (endX - startX) / 2);
              return <path key={`${entry.parentId}-${entry.id}`} d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`} className={entry.onPath ? "tree-edge path" : "tree-edge"}/>;
            })}</g>
            <g className="tree-nodes">{tree.map((entry) => {
              const point = positions.byId.get(entry.id); if (!point) return null;
              const player = playerForNode(entry.node), title = displayLabel(entry.node, entry.id);
              const childHint = entry.truncated > 0 ? ` · 还有 ${entry.truncated} 支` : entry.childCount > 0 && !entry.onPath ? ` · 后续 ${entry.childCount} 支` : "";
              return <g key={entry.id} className={`tree-node ${entry.isCurrent ? "current" : ""} ${entry.id === selectedId ? "selected" : ""} ${entry.onPath ? "path" : ""} ${player || "neutral"}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`${title}${entry.isCurrent ? "，当前局面" : ""}${entry.id === selectedId ? "，已选中" : ""}`} onPointerDown={(event) => { event.stopPropagation(); if (!readOnly && event.pointerType === "touch" && !pinchGestureRef.current) beginLongPress(entry.id); }} onPointerUp={(event) => { const wasGesture = pinchGestureRef.current || dragRef.current.moved; cancelLongPress(); if (event.pointerType === "touch" && !wasGesture) setSelectedId(entry.id); }} onPointerCancel={() => cancelLongPress()} onClick={() => { if (dragRef.current.moved || pinchGestureRef.current) return; if (longPressId === entry.id) { setSelectedId(entry.id); return; } setSelectedId(entry.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(entry.id); } }}>
                {pressingId === entry.id && longPressProgress > 0 && <circle className="tree-long-press-progress" cx={TREE_NODE_WIDTH - 10} cy={TREE_NODE_HEIGHT - 10} r="7" style={{ strokeDashoffset: `${44 * (1 - longPressProgress)}` }} aria-label="正在加载分支操作"/>}
                <rect width={TREE_NODE_WIDTH} height={TREE_NODE_HEIGHT} rx="12"/><circle cx="16" cy="22" r="7" className="tree-node-dot"/><text x="30" y="19" className="tree-node-label">{title}</text><text x="30" y="34" className="tree-node-meta">{entry.turnDepth === 0 ? "起始局面" : `第 ${entry.turnDepth} 手`}{childHint}</text>{entry.isCurrent && <circle cx={TREE_NODE_WIDTH - 12} cy="12" r="4" className="tree-current-dot"/>}{bookmarkByNode.has(entry.id) && <path className="tree-node-bookmark" d={`M ${TREE_NODE_WIDTH - 24} 4 h 8 v 11 l -4 -2.8 -4 2.8 z`}/>} 
              </g>;
            })}</g>
          </g>
        </svg>
      </div>

      {selected && <section className="tree-node-actions" aria-label={`节点操作 ${displayLabel(selected, selected.id)}`}>
        {!readOnly && longPressId === selected.id && <div className="tree-long-press-menu" role="menu" aria-label="分支快捷操作"><b>分支操作</b><button type="button" onClick={() => { props.onCopy(selected.id); setLongPressId(null); }}><Copy/>复制</button><button type="button" onClick={() => { props.onCut(selected.id); setLongPressId(null); }}><Scissors/>剪切</button>{props.clipboard && <button type="button" onClick={() => { props.onPaste(selected.id); setLongPressId(null); }}><Clipboard/>粘贴</button>}<button type="button" className="danger" onClick={() => { props.onDeleteBranch(selected.id); setLongPressId(null); }}><Trash2/>删除分支</button></div>}
        <div className="tree-node-action-head"><span className={`tree-action-stone ${playerForNode(selected) || "neutral"}`}/><div><b>{displayLabel(selected, selected.id)}</b><small>{selected.id === props.currentId ? "当前局面" : "已选节点"}{selected.children.length ? ` · ${selected.children.length} 个后续` : " · 分支末端"}</small></div>{selectedBookmark && <Bookmark className="bookmarked"/>}</div>
        {!readOnly && renaming ? <div className="tree-inline-rename"><input autoFocus value={branchTitle} onChange={(event) => setBranchTitle(event.target.value)} placeholder="输入分支名称" onKeyDown={(event) => { if (event.key === "Enter" && branchTitle.trim()) { props.onRenameBranch(selected.id, branchTitle); setRenaming(false); } if (event.key === "Escape") setRenaming(false); }}/><button type="button" onClick={() => { if (branchTitle.trim()) props.onRenameBranch(selected.id, branchTitle); setRenaming(false); }}><Check/></button><button type="button" onClick={() => setRenaming(false)}><X/></button></div> : <div className="tree-node-action-grid">
          <button type="button" onClick={() => props.onLocate(selected.id, selected.parentId || undefined)} disabled={props.busy}><LocateFixed/>定位</button>
          {!readOnly && <><button type="button" onClick={() => props.onCreateBranch(selected.id)} disabled={props.busy}><GitBranch/>新分支</button><button type="button" onClick={() => props.onToggleBookmark(selected.id)}><Bookmark/>{selectedBookmark ? "取消书签" : "加书签"}</button><button type="button" onClick={() => props.onCopy(selected.id)} disabled={isCompact} title={isCompact ? "大型棋谱当前只加载可视窗口，请先创建编辑副本" : "复制此节点以下的完整子树"}><Copy/>复制分支</button>{props.clipboard && <button type="button" className="primary" onClick={() => props.onPaste(selected.id)} disabled={props.busy || isCompact}><Clipboard/>粘贴到这里</button>}</>}
          {selected.children.length > 0 && !pathIds.has(selected.id) && <button type="button" onClick={() => setExpandedIds((value) => { const next = new Set(value); if (next.has(selected.id)) next.delete(selected.id); else next.add(selected.id); return next; })}><MoreHorizontal/>{expandedIds.has(selected.id) ? "收起后续" : "展开后续"}</button>}
          {!readOnly && selected.parentId && <><button type="button" onClick={() => { setBranchTitle(displayLabel(selected, selected.id)); setRenaming(true); }}><PencilLine/>重命名</button><button type="button" className="danger" onClick={() => props.onDeleteBranch(selected.id)}><Trash2/>删除分支</button></>}
        </div>}
        {isCompact && <p className="helper">大型棋谱树是按需窗口。定位与浏览可直接使用；复制、粘贴等完整子树编辑需先进入可编辑副本。</p>}
      </section>}
      <div className="tree-legend"><span><i className="path"/>当前路径</span><span><i className="black"/>黑</span><span><i className="white"/>白</span><span><ZoomIn/>拖动、缩放，点节点后就近操作</span></div>
    </>}
  </div>;
}
