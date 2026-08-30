import { useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, ZoomIn } from "lucide-react";
import { coordinateName } from "./game";
import { compactChildCount, compactChildWindow, compactIndexOf, compactNodeIndex } from "./compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "./types";

const TREE_NODE_WIDTH = 132;
const TREE_NODE_HEIGHT = 42;
const TREE_X_GAP = 28;
const TREE_Y_GAP = 14;
const TREE_CHILD_WINDOW = 12;
const TREE_NODE_BUDGET = 240;
const TREE_MIN_SCALE = 0.65;
const TREE_MAX_SCALE = 10;

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

interface TreePanelProps {
  document: GameDocument;
  currentId: string;
  path: RecordNode[];
  compactIndex?: CompactRenLibIndex;
  onSelect: (id: string, pivotId?: string) => void;
}

const labelForNode = (node: RecordNode) => node.move
  ? coordinateName(node.move)
  : node.passPlayer
    ? `${node.passPlayer === "black" ? "黑" : "白"}方过手`
    : node.setup
      ? "设置局面"
      : node.parentId
        ? "注释节点"
        : "起始局面";

const playerForNode = (node: RecordNode) => node.move?.player || node.passPlayer;

export function TreePanel({ document, currentId, path, compactIndex, onSelect }: TreePanelProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 18, y: 18 });
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const pathIds = useMemo(() => new Set(path.map((node) => node.id)), [path]);
  const pathDepths = useMemo(() => new Map(path.map((node, index) => [node.id, index])), [path]);
  const isCompact = Boolean(compactIndex || compactIndexOf(document));
  const nudgeScale = (direction: -1 | 1) => setScale((value) => {
    const step = direction > 0 ? value < 2 ? 0.15 : value < 5 ? 0.5 : 1 : value <= 2 ? 0.15 : value <= 5 ? 0.5 : 1;
    return Math.min(TREE_MAX_SCALE, Math.max(TREE_MIN_SCALE, Number((value + direction * step).toFixed(2))));
  });

  const tree = useMemo(() => {
    const entries: TreeEntry[] = [];
    const visited = new Set<string>();
    const compact = compactIndex || compactIndexOf(document);
    const rootId = document.rootId;

    const readChildren = (id: string, node: RecordNode, pathIndex: number) => {
      const index = compact ? compactNodeIndex(document, id) : undefined;
      const total = index === undefined || !compact ? node.children.length : compactChildCount(compact, index);
      const ids = index === undefined || !compact
        ? node.children.slice(0, TREE_CHILD_WINDOW)
        : compactChildWindow(compact, index, 0, Math.min(total, TREE_CHILD_WINDOW));
      const pathChild = path[pathIndex + 1]?.id;
      if (pathChild && !ids.includes(pathChild)) ids.push(pathChild);
      return { ids, total };
    };

    const visitPath = (id: string, depth: number, turnDepth: number, pathIndex: number) => {
      if (entries.length >= TREE_NODE_BUDGET || visited.has(id)) return;
      const node = document.nodes[id];
      if (!node) return;
      visited.add(id);
      const children = readChildren(id, node, pathIndex);
      entries.push({
        id,
        parentId: node.parentId,
        depth,
        turnDepth,
        node,
        childCount: children.total,
        truncated: Math.max(0, children.total - children.ids.length),
        onPath: pathIds.has(id),
        isCurrent: id === currentId,
      });
      for (const childId of children.ids) {
        if (entries.length >= TREE_NODE_BUDGET) break;
        const child = document.nodes[childId];
        if (!child || visited.has(childId)) continue;
        if (pathIds.has(childId)) {
          visitPath(childId, depth + 1, turnDepth + (child.move || child.passPlayer ? 1 : 0), pathIndex + 1);
          continue;
        }
        visited.add(childId);
        const childIndex = compact ? compactNodeIndex(document, childId) : undefined;
        const childCount = childIndex === undefined || !compact ? child.children.length : compactChildCount(compact, childIndex);
        entries.push({
          id: childId,
          parentId: id,
          depth: depth + 1,
          turnDepth: turnDepth + (child.move || child.passPlayer ? 1 : 0),
          node: child,
          childCount,
          truncated: 0,
          onPath: false,
          isCurrent: childId === currentId,
        });
      }
    };

    const rootPathIndex = pathDepths.get(rootId) ?? 0;
    visitPath(rootId, 0, 0, rootPathIndex);
    return entries;
  }, [compactIndex, currentId, document, path, pathDepths, pathIds]);

  const positions = useMemo(() => {
    const maxDepth = tree.reduce((max, entry) => Math.max(max, entry.depth), 0);
    const contentWidth = Math.max(430, (maxDepth + 1) * (TREE_NODE_WIDTH + TREE_X_GAP) + 30);
    const contentHeight = Math.max(220, tree.length * (TREE_NODE_HEIGHT + TREE_Y_GAP) + 36);
    const byId = new Map(tree.map((entry, index) => [entry.id, {
      x: 18 + entry.depth * (TREE_NODE_WIDTH + TREE_X_GAP),
      y: 18 + index * (TREE_NODE_HEIGHT + TREE_Y_GAP),
    }]));
    return { contentWidth, contentHeight, byId };
  }, [tree]);

  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { active: true, moved: false, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    setPan({ x: drag.panX + dx, y: drag.panY + dy });
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="tree-panel">
    <div className="tree-toolbar">
      <div><b>当前路径附近</b><small>{isCompact ? "大型棋谱按需显示可视窗口" : `${tree.length} 个可视节点`}</small></div>
      <div className="tree-zoom-controls" aria-label="棋谱树缩放">
        <button type="button" onClick={() => nudgeScale(-1)} aria-label="缩小"><Minus size={15}/></button>
        <input className="tree-zoom-range" type="range" min={TREE_MIN_SCALE} max={TREE_MAX_SCALE} step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="缩放比例" />
        <span>{scale >= TREE_MAX_SCALE ? "10×" : `${Math.round(scale * 100)}%`}</span>
        <button type="button" onClick={() => nudgeScale(1)} aria-label="放大"><Plus size={15}/></button>
        <button type="button" onClick={() => { setScale(1); setPan({ x: 18, y: 18 }); }} aria-label="重置视图" title="重置视图"><RotateCcw size={14}/></button>
      </div>
      <div className="tree-zoom-presets" aria-label="快速缩放"><button type="button" onClick={() => setScale(2)}>2×</button><button type="button" onClick={() => setScale(5)}>5×</button><button type="button" onClick={() => setScale(10)}>10×</button></div>
    </div>
    <div className="tree-viewport" aria-label="棋谱树，可拖动查看">
      <svg
        className="tree-canvas"
        width="100%"
        height="340"
        viewBox={`0 0 ${positions.contentWidth} ${positions.contentHeight}`}
        role="img"
        aria-label="棋谱树形图"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
          <g className="tree-edges">
            {tree.map((entry) => {
              const child = positions.byId.get(entry.id);
              const parent = entry.parentId ? positions.byId.get(entry.parentId) : undefined;
              if (!child || !parent) return null;
              const startX = parent.x + TREE_NODE_WIDTH;
              const startY = parent.y + TREE_NODE_HEIGHT / 2;
              const endX = child.x;
              const endY = child.y + TREE_NODE_HEIGHT / 2;
              const midX = startX + Math.max(18, (endX - startX) / 2);
              return <path key={`${entry.parentId}-${entry.id}`} d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`} className={entry.onPath ? "tree-edge path" : "tree-edge"}/>;
            })}
          </g>
          <g className="tree-nodes">
            {tree.map((entry) => {
              const point = positions.byId.get(entry.id);
              if (!point) return null;
              const player = playerForNode(entry.node);
              const title = labelForNode(entry.node);
              const childHint = entry.truncated > 0 ? ` · 还有 ${entry.truncated} 个分支` : entry.childCount > 0 && !entry.onPath ? ` · 后续 ${entry.childCount} 支` : "";
              const select = () => onSelect(entry.id, entry.parentId || undefined);
              return <g
                key={entry.id}
                className={`tree-node ${entry.isCurrent ? "current" : ""} ${entry.onPath ? "path" : ""} ${player || "neutral"}`}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${title}${entry.isCurrent ? "，当前局面" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={select}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } }}
              >
                <rect width={TREE_NODE_WIDTH} height={TREE_NODE_HEIGHT} rx="12"/>
                <circle cx="16" cy="21" r="7" className="tree-node-dot"/>
                <text x="30" y="18" className="tree-node-label">{title}</text>
                <text x="30" y="32" className="tree-node-meta">{entry.turnDepth === 0 ? "起始局面" : `第 ${entry.turnDepth} 手`}{childHint}</text>
                {entry.isCurrent && <circle cx={TREE_NODE_WIDTH - 12} cy="12" r="4" className="tree-current-dot"/>}
              </g>;
            })}
          </g>
        </g>
      </svg>
    </div>
    <div className="tree-legend"><span><i className="path"/>当前路径</span><span><i className="black"/>黑</span><span><i className="white"/>白</span><span><ZoomIn size={13}/>拖动、缩放、点击节点跳转</span></div>
    {isCompact && <p className="helper tree-helper">这是大型棋谱的可视窗口：只读取当前路径和附近分支，不会一次性加载全部节点。点击已显示分支可继续读取。</p>}
    {!tree.length && <div className="sheet-empty"><ZoomIn/><b>棋谱树暂时为空</b><span>返回棋盘后继续落子即可生成节点。</span></div>}
  </div>;
}
