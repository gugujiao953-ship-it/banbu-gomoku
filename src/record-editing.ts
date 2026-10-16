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
 * 棋谱库里那份还是不是「带手序的原谱」？只有它是，把当前盘面拍平回去才叫坏谱
 * （用户 2026-09-28：「去子和位移功能，是在原谱的情况下修改的，做好后没有任何提示，
 * 而是直接覆盖了这个棋谱，这点很严重，会坏谱」）。
 * 库里没有这份（新建的、或刚识谱导入还没入库）、或库里那份本来就是静态局面
 * （识谱导入、摆好的局面），拍平都不毁掉任何**已保存**的手序，所以不该弹三选打断用户
 * ——这也正好是「识谱里面那两个功能不受影响」的口径。
 */
export const storedRecordHasMoveOrder = (stored: GameDocument | undefined | null): boolean => {
  if (!stored) return false;
  const root = stored.nodes?.[stored.rootId];
  return Boolean(root && root.children.length > 0);
};

/**
 * 「创建修改副本」：把当前这份（含未保存草稿、含刚拍平的结果）复制成棋谱库里
 * **另一份**独立棋谱，原谱一个字都不动。
 * 与 createEditableViewCopy 同源（同一套深拷贝，连带"不把不可枚举的后端标记带进副本"
 * 的处理），只改两处口径：id 用 -copy- 而不是 -study-，标题写「· 修改副本」。
 */
export const createModificationCopy = (source: GameDocument, currentId: string, options: { token?: string; now?: string } = {}): GameDocument => {
  const token = options.token || Date.now().toString(36);
  const copy = createEditableViewCopy(source, currentId, { ...options, token });
  const baseTitle = source.metadata.title.replace(/ · (编辑副本|修改副本)$/, "");
  return {
    ...copy,
    id: `${source.id}-copy-${token}`,
    metadata: { ...copy.metadata, title: `${baseTitle} · 修改副本` },
  };
};
/**
 * Dynamic database and paged-library documents are bounded projections, not
 * writable full trees. Editing therefore starts a normal local study copy of
 * the currently loaded path and visible variations, leaving the source intact.
 * Non-enumerable backend markers deliberately do not cross this object spread.
 *
 * 但 `partial` 是**可枚举的普通字段**，会随下面的 `...source` 一起带过来——这是故意的
 * （2026-10-11 P5）：副本继承的正是「只加载了一部分」这个事实。没带过去的话，
 * 副本上「同型局面 / 查找 / 复制分支」会把子集当全谱给结论（早先靠不可枚举的
 * DP_VIEW/RENLIB_WEB_VIEW Symbol 判断，而它们刻意不跨展开）。
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
