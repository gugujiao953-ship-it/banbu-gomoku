import type { GameDocument, Position, RecordNode } from "./types";

const nodePoint = (node?: RecordNode) => node?.move || node?.anchor;
const pointKey = (point: Position) => `${point.row},${point.col}`;

export const visibleVariationPivot = (document: GameDocument, currentId: string) => {
  const current = document.nodes[currentId] || document.nodes[document.rootId];
  if (!current) return undefined;
  return current.children.length ? current : current.parentId ? document.nodes[current.parentId] || current : current;
};

export const visibleBoardVariationNodes = (document: GameDocument, currentId: string, limit = 512): RecordNode[] => {
  const current = document.nodes[currentId] || document.nodes[document.rootId];
  if (!current || limit <= 0) return [];

  // A board variation is a legal next move from the current position. Sibling
  // nodes belong to the previous position and must disappear as soon as the
  // cursor advances. Keeping them visible makes a tap switch the current ply
  // instead of creating/entering the next move. This mirrors RenjuTool's
  // getBranchNodes(currentPath) behavior: query and draw only current children.
  const candidates = current.children.slice(0, limit);
  const byPoint = new Map<string, RecordNode>();
  const boardSize = document.metadata.boardSize || 15;

  for (const id of candidates) {
    const node = document.nodes[id];
    const point = nodePoint(node);
    if (!node || !point || point.row < 0 || point.col < 0 || point.row >= boardSize || point.col >= boardSize) continue;
    const key = pointKey(point);
    // Never expose two visual labels or two click targets at one intersection.
    if (!byPoint.has(key)) byPoint.set(key, node);
  }

  return [...byPoint.values()].slice(0, limit);
};

export const renderableBoardVariationNodes = (
  document: GameDocument,
  currentId: string,
  occupiedPoints: ReadonlySet<string>,
  limit = 512,
): RecordNode[] => visibleBoardVariationNodes(document, currentId, limit).filter((node) => {
  const point = nodePoint(node);
  return Boolean(point && !occupiedPoints.has(pointKey(point)));
});

export const findVisibleVariationTarget = (document: GameDocument, currentId: string, position: Position) => {
  const target = visibleBoardVariationNodes(document, currentId).find((node) => {
    const point = nodePoint(node);
    return point?.row === position.row && point.col === position.col;
  });
  if (!target) return undefined;
  const pivot = target.parentId ? document.nodes[target.parentId] : visibleVariationPivot(document, currentId);
  return pivot ? { pivot, target } : undefined;
};

const cloneNode = (node: RecordNode, available: Set<string>): RecordNode => {
  const children = node.children.filter((id) => available.has(id));
  return {
    ...node,
    parentId: node.parentId && available.has(node.parentId) ? node.parentId : null,
    children,
    preferredChildId: node.preferredChildId && children.includes(node.preferredChildId) ? node.preferredChildId : undefined,
    move: node.move ? { ...node.move } : null,
    anchor: node.anchor ? { ...node.anchor } : undefined,
    marks: (node.marks || []).map((mark) => ({ ...mark })),
    setup: node.setup ? {
      black: node.setup.black.map((point) => ({ ...point })),
      white: node.setup.white.map((point) => ({ ...point })),
      empty: node.setup.empty.map((point) => ({ ...point })),
      nextPlayer: node.setup.nextPlayer,
    } : undefined,
    renLibAnnotations: node.renLibAnnotations?.map((annotation) => ({ ...annotation })),
  };
};

/**
 * Dynamic database and paged-library documents are bounded projections, not
 * writable full trees. Editing therefore starts a normal local study copy of
 * the currently loaded path and visible variations, leaving the source intact.
 * Non-enumerable backend markers deliberately do not cross this object spread.
 */
export const createEditableViewCopy = (source: GameDocument, currentId: string, options: { token?: string; now?: string } = {}): GameDocument => {
  const token = options.token || Date.now().toString(36);
  const now = options.now || new Date().toISOString();
  const available = new Set(Object.keys(source.nodes));
  const nodes = Object.fromEntries(Object.entries(source.nodes).map(([id, node]) => [id, cloneNode(node, available)]));
  const title = source.metadata.title.endsWith("· 编辑副本") ? source.metadata.title : `${source.metadata.title} · 编辑副本`;
  return {
    ...source,
    id: `${source.id}-study-${token}`,
    nodes,
    // A dynamic LIB/DP projection is only the currently loaded study window.
    // Its editable copy is a new native document and must not claim that it can
    // still be written back to the source database format.
    metadata: { ...source.metadata, title, sourceFormat: undefined, sourceFileName: undefined },
    createdAt: now,
    updatedAt: now,
    savedCurrentId: nodes[currentId] ? currentId : source.rootId,
  };
};
