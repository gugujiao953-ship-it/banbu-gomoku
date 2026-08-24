import type { BoardMark, Cell, GameDocument, Player, Position, RecordNode } from "./types";

export const BOARD_SIZE = 15;
const makeId = (prefix = "node") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const otherPlayer = (player: Player): Player => player === "black" ? "white" : "black";
export const emptyBoard = (): Cell[][] => Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null));

export const createDocument = (title = "未命名棋谱"): GameDocument => {
  const rootId = makeId("root");
  const now = new Date().toISOString();
  return {
    id: makeId("record"), version: 1, rootId,
    nodes: { [rootId]: { id: rootId, parentId: null, children: [], move: null, comment: "", marks: [] } },
    metadata: { title, black: "黑方", white: "白方", event: "", date: now.slice(0, 10), result: "", rule: "renju", boardSize: 15, tags: [] },
    createdAt: now, updatedAt: now,
  };
};

export const pathToNode = (document: GameDocument, nodeId: string): RecordNode[] => {
  const result: RecordNode[] = [];
  let node: RecordNode | undefined = document.nodes[nodeId];
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id); result.unshift(node);
    node = node.parentId ? document.nodes[node.parentId] : undefined;
  }
  return result;
};

export const boardAt = (document: GameDocument, nodeId: string): Cell[][] => {
  const board = emptyBoard();
  pathToNode(document, nodeId).forEach((node) => { if (node.move) board[node.move.row][node.move.col] = node.move.player; });
  return board;
};
export const depthOf = (document: GameDocument, nodeId: string) => Math.max(0, pathToNode(document, nodeId).length - 1);
export const nextPlayerAt = (document: GameDocument, nodeId: string): Player => document.nodes[nodeId]?.move ? otherPlayer(document.nodes[nodeId].move!.player) : "black";

export const addMove = (document: GameDocument, currentId: string, position: Position) => {
  const parent = document.nodes[currentId];
  if (!parent || boardAt(document, currentId)[position.row][position.col]) return { document, nodeId: currentId, created: false };
  const existing = parent.children.map((id) => document.nodes[id]).find((child) => child?.move?.row === position.row && child.move.col === position.col);
  if (existing) return { document, nodeId: existing.id, created: false };
  const id = makeId();
  const node: RecordNode = { id, parentId: currentId, children: [], move: { ...position, player: nextPlayerAt(document, currentId) }, comment: "", marks: [] };
  return {
    document: { ...document, updatedAt: new Date().toISOString(), nodes: { ...document.nodes, [currentId]: { ...parent, children: [...parent.children, id], preferredChildId: id }, [id]: node } },
    nodeId: id, created: true,
  };
};

/** Add an explicitly coloured move, used by puzzle positions whose setup does
 * not necessarily alternate in record order. */
export const addMoveAs = (document: GameDocument, currentId: string, position: Position, player: Player) => {
  const parent = document.nodes[currentId];
  if (!parent || boardAt(document, currentId)[position.row]?.[position.col]) return { document, nodeId: currentId, created: false };
  const existing = parent.children.map((id) => document.nodes[id]).find((child) => child?.move?.row === position.row && child.move.col === position.col && child.move.player === player);
  if (existing) return { document, nodeId: existing.id, created: false };
  const id = makeId("puzzle-move");
  const node: RecordNode = { id, parentId: currentId, children: [], move: { ...position, player }, comment: "", marks: [] };
  return {
    document: { ...document, updatedAt: new Date().toISOString(), nodes: { ...document.nodes, [currentId]: { ...parent, children: [...parent.children, id], preferredChildId: id }, [id]: node } },
    nodeId: id,
    created: true,
  };
};

/** Replace a node's coordinate while preserving its entire descendant tree. */
export const replaceMove = (document: GameDocument, nodeId: string, position: Position) => {
  const node = document.nodes[nodeId];
  if (!node?.move || !node.parentId || position.row < 0 || position.row >= BOARD_SIZE || position.col < 0 || position.col >= BOARD_SIZE) {
    return { document, changed: false, reason: "只能修改已有着法" };
  }
  const parentBoard = boardAt(document, node.parentId);
  const occupied = parentBoard[position.row]?.[position.col];
  if (occupied) return { document, changed: false, reason: "该位置已经有棋子" };
  const sibling = document.nodes[node.parentId].children
    .map((id) => document.nodes[id])
    .find((child) => child.id !== nodeId && child.move?.row === position.row && child.move.col === position.col);
  if (sibling) return { document, changed: false, reason: "该分支已有相同着法" };
  const descendantIds: string[] = [];
  const collect = (id: string) => document.nodes[id]?.children.forEach((childId) => { descendantIds.push(childId); collect(childId); });
  collect(nodeId);
  if (descendantIds.some((id) => document.nodes[id]?.move?.row === position.row && document.nodes[id]?.move?.col === position.col)) {
    return { document, changed: false, reason: "后续变化已经使用该坐标" };
  }
  const nextNode: RecordNode = { ...node, move: { ...position, player: node.move.player } };
  return {
    document: { ...document, updatedAt: new Date().toISOString(), nodes: { ...document.nodes, [nodeId]: nextNode } },
    changed: true,
  };
};

/** Insert a next move at the selected 支点; this is intentionally branch-safe. */
export const insertMove = (document: GameDocument, pivotId: string, position: Position) => addMove(document, pivotId, position);
export const changeMove = replaceMove;

export const updateNode = (document: GameDocument, nodeId: string, patch: Partial<Pick<RecordNode, "comment" | "marks" | "preferredChildId" | "boardText" | "evaluation" | "evaluationLevel">>): GameDocument => ({
  ...document, updatedAt: new Date().toISOString(), nodes: { ...document.nodes, [nodeId]: { ...document.nodes[nodeId], ...patch } },
});

const descendantsOf = (document: GameDocument, nodeId: string) => {
  const result: string[] = [];
  const visit = (id: string) => { result.push(id); document.nodes[id]?.children.forEach(visit); };
  visit(nodeId); return result;
};
export const deleteVariation = (document: GameDocument, nodeId: string) => {
  const node = document.nodes[nodeId];
  if (!node?.parentId) return { document, nextId: document.rootId };
  const removed = new Set(descendantsOf(document, nodeId));
  const nodes = Object.fromEntries(Object.entries(document.nodes).filter(([id]) => !removed.has(id)));
  const parent = nodes[node.parentId];
  nodes[node.parentId] = { ...parent, children: parent.children.filter((id) => id !== nodeId), preferredChildId: parent.preferredChildId === nodeId ? undefined : parent.preferredChildId };
  return { document: { ...document, nodes, updatedAt: new Date().toISOString() }, nextId: node.parentId };
};

export const preferredNext = (document: GameDocument, nodeId: string) => {
  const node = document.nodes[nodeId];
  if (!node?.children.length) return null;
  return node.preferredChildId && node.children.includes(node.preferredChildId) ? node.preferredChildId : node.children[0];
};
export const lastOnPreferredLine = (document: GameDocument, fromId: string) => {
  let current = fromId; const seen = new Set<string>();
  while (!seen.has(current)) { seen.add(current); const next = preferredNext(document, current); if (!next) break; current = next; }
  return current;
};
export const coordinateName = ({ row, col }: Position) => `${String.fromCharCode(65 + col)}${BOARD_SIZE - row}`;
export const parseCoordinate = (text: string): Position | null => {
  const match = text.trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) return null;
  return { col: match[1].charCodeAt(0) - 65, row: BOARD_SIZE - Number(match[2]) };
};

const lineThrough = (board: Cell[][], position: Position, dr: number, dc: number) => {
  let text = "";
  for (let offset = -5; offset <= 5; offset += 1) {
    const row = position.row + dr * offset, col = position.col + dc * offset;
    text += board[row]?.[col] === "black" ? "X" : board[row]?.[col] === "white" ? "O" : board[row]?.[col] === null ? "." : "#";
  }
  return text;
};
export const forbiddenReason = (board: Cell[][], position: Position): string | null => {
  if (board[position.row][position.col]) return null;
  const next = board.map((row) => [...row]); next[position.row][position.col] = "black";
  const lines = [[1, 0], [0, 1], [1, 1], [1, -1]].map(([dr, dc]) => lineThrough(next, position, dr, dc));
  if (lines.some((line) => /XXXXXX/.test(line))) return "长连禁手";
  const fours = lines.filter((line) => [/\.XXXX\./, /\.XXX\.X/, /X\.XXX\./, /\.XX\.XX\./].some((pattern) => pattern.test(line))).length;
  if (fours >= 2) return "四四禁手";
  const threes = lines.filter((line) => [/\.\.XXX\.\./, /\.XX\.X\./, /\.X\.XX\./].some((pattern) => pattern.test(line))).length;
  return threes >= 2 ? "三三禁手" : null;
};

export const toggleMark = (marks: BoardMark[], position: Position): BoardMark[] => {
  const current = marks.find((mark) => mark.row === position.row && mark.col === position.col);
  if (!current) return [...marks, { ...position, kind: "circle" }];
  if (current.kind === "circle") return marks.map((mark) => mark === current ? { ...mark, kind: "triangle" } : mark);
  if (current.kind === "triangle") return marks.map((mark) => mark === current ? { ...mark, kind: "cross" } : mark);
  return marks.filter((mark) => mark !== current);
};

/** Set or clear a labelled analysis candidate at a board point. Labels are
 * intentionally kept as node-local marks so each variation can carry its own
 * candidate set without changing the underlying move tree. */
export const setLabelMark = (marks: BoardMark[], position: Position, label: string): BoardMark[] => {
  const normalized = label.trim().slice(0, 2);
  if (!normalized) return marks;
  const existing = marks.find((mark) => mark.row === position.row && mark.col === position.col);
  if (existing?.kind === "label" && existing.label === normalized) {
    return marks.filter((mark) => mark !== existing);
  }
  return [
    ...marks.filter((mark) => mark.row !== position.row || mark.col !== position.col),
    { ...position, kind: "label", label: normalized },
  ];
};
