import type { BoardMark, Cell, GameDocument, Player, Position, RecordNode, RuleSet } from "./types";

export const BOARD_SIZE = 15;
export const MIN_BOARD_SIZE = 5;
export const MAX_BOARD_SIZE = 25;
export const isSupportedBoardSize = (size: number): boolean => Number.isInteger(size) && size >= MIN_BOARD_SIZE && size <= MAX_BOARD_SIZE;
const makeId = (prefix = "node") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const otherPlayer = (player: Player): Player => player === "black" ? "white" : "black";
export const emptyBoard = (size = BOARD_SIZE): Cell[][] => Array.from({ length: size }, () => Array<Cell>(size).fill(null));

export const createDocument = (title = "未命名棋谱", boardSize = BOARD_SIZE): GameDocument => {
  if (!isSupportedBoardSize(boardSize)) throw new Error(`不支持的棋盘尺寸：${boardSize}`);
  const rootId = makeId("root");
  const now = new Date().toISOString();
  return {
    id: makeId("record"), version: 1, rootId,
    nodes: { [rootId]: { id: rootId, parentId: null, children: [], move: null, comment: "", marks: [] } },
    metadata: { title, black: "黑方", white: "白方", event: "", date: now.slice(0, 10), result: "", rule: "renju", openingRule: "free", boardSize, tags: [] },
    createdAt: now, updatedAt: now,
  };
};

const pathCache = new WeakMap<object, Map<string, RecordNode[]>>();
const boardCache = new WeakMap<object, Map<string, Cell[][]>>();

export const pathToNode = (document: GameDocument, nodeId: string): RecordNode[] => {
  const cached = pathCache.get(document.nodes)?.get(nodeId);
  if (cached) return cached;
  const result: RecordNode[] = [];
  let node: RecordNode | undefined = document.nodes[nodeId];
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id); result.unshift(node);
    node = node.parentId ? document.nodes[node.parentId] : undefined;
  }
  let cache = pathCache.get(document.nodes);
  if (!cache) { cache = new Map(); pathCache.set(document.nodes, cache); }
  cache.set(nodeId, result);
  return result;
};

export const boardAt = (document: GameDocument, nodeId: string): Cell[][] => {
  const cached = boardCache.get(document.nodes)?.get(nodeId);
  if (cached) return cached;
  const node = document.nodes[nodeId];
  const parentId = node?.parentId;
  const parentBoard = parentId ? boardCache.get(document.nodes)?.get(parentId) : undefined;
  const board = parentBoard
    ? parentBoard.map((row) => row.slice())
    : emptyBoard(document.metadata.boardSize);
  const applyNode = (target: Cell[][], entry?: RecordNode) => {
    if (!entry) return;
    entry.setup?.empty.forEach(({ row, col }) => { target[row][col] = null; });
    entry.setup?.black.forEach(({ row, col }) => { target[row][col] = "black"; });
    entry.setup?.white.forEach(({ row, col }) => { target[row][col] = "white"; });
    if (entry.move) target[entry.move.row][entry.move.col] = entry.move.player;
  };
  applyNode(board, node);
  if (!parentBoard && node?.parentId) {
    board.forEach((row) => row.fill(null));
    pathToNode(document, nodeId).forEach((pathNode) => applyNode(board, pathNode));
  }
  let cache = boardCache.get(document.nodes);
  if (!cache) { cache = new Map(); boardCache.set(document.nodes, cache); }
  cache.set(nodeId, board);
  return board;
};
export const depthOf = (document: GameDocument, nodeId: string) => pathToNode(document, nodeId).filter((node) => Boolean(node.move || node.passPlayer)).length;
export const nextPlayerAt = (document: GameDocument, nodeId: string): Player => {
  let player: Player = "black";
  pathToNode(document, nodeId).forEach((node) => {
    if (node.setup?.nextPlayer) player = node.setup.nextPlayer;
    const turnPlayer = node.move?.player || node.passPlayer;
    if (turnPlayer) player = otherPlayer(turnPlayer);
  });
  return player;
};

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
  const size = document.metadata.boardSize || BOARD_SIZE;
  if (!node?.move || !node.parentId || position.row < 0 || position.row >= size || position.col < 0 || position.col >= size) {
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
export const coordinateName = ({ row, col }: Position, size = BOARD_SIZE) => `${String.fromCharCode(65 + col)}${size - row}`;
export const parseCoordinate = (text: string, size = BOARD_SIZE): Position | null => {
  const match = text.trim().toUpperCase().match(/^([A-Y])(\d{1,2})$/);
  if (!match) return null;
  const col = match[1].charCodeAt(0) - 65, row = size - Number(match[2]);
  return col < size && row >= 0 ? { col, row } : null;
};

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const pointKey = ({ row, col }: Position) => `${row},${col}`;
const samePoint = (left: Position, right: Position) => left.row === right.row && left.col === right.col;
const cloneBoard = (board: Cell[][]): Cell[][] => board.map((row) => [...row]);
const insideBoard = (board: Cell[][], row: number, col: number) => row >= 0 && row < board.length && col >= 0 && col < (board[row]?.length || 0);

const contiguousLine = (board: Cell[][], position: Position, player: Player, dr: number, dc: number): Position[] => {
  if (board[position.row]?.[position.col] !== player) return [];
  const before: Position[] = [];
  for (let step = 1; board[position.row - dr * step]?.[position.col - dc * step] === player; step += 1) {
    before.unshift({ row: position.row - dr * step, col: position.col - dc * step });
  }
  const after: Position[] = [];
  for (let step = 1; board[position.row + dr * step]?.[position.col + dc * step] === player; step += 1) {
    after.push({ row: position.row + dr * step, col: position.col + dc * step });
  }
  return [...before, position, ...after];
};

const pointsOnAxis = (board: Cell[][], origin: Position, dr: number, dc: number, radius = board.length - 1): Position[] => {
  const result: Position[] = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const row = origin.row + dr * offset, col = origin.col + dc * offset;
    if (insideBoard(board, row, col)) result.push({ row, col });
  }
  return result;
};

interface FourPattern { direction: number; stones: Position[]; winningPoints: Position[] }

/** A four is keyed by its four existing stones. This keeps the two ends of one
 * straight four together while still detecting two distinct fours on one axis. */
const fourPatternsThrough = (board: Cell[][], origin: Position): FourPattern[] => {
  const patterns = new Map<string, FourPattern>();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (const winningPoint of pointsOnAxis(board, origin, dr, dc, 5)) {
      if (board[winningPoint.row]?.[winningPoint.col] !== null) continue;
      board[winningPoint.row][winningPoint.col] = "black";
      const line = contiguousLine(board, winningPoint, "black", dr, dc);
      board[winningPoint.row][winningPoint.col] = null;
      if (line.length !== 5 || !line.some((point) => samePoint(point, origin))) continue;
      const stones = line.filter((point) => !samePoint(point, winningPoint));
      const key = `${direction}:${stones.map(pointKey).sort().join("|")}`;
      const current = patterns.get(key);
      if (current) {
        if (!current.winningPoints.some((point) => samePoint(point, winningPoint))) current.winningPoints.push(winningPoint);
      } else patterns.set(key, { direction, stones, winningPoints: [winningPoint] });
    }
  });
  return [...patterns.values()];
};

const hasOverlineAt = (board: Cell[][], position: Position) => DIRECTIONS.some(([dr, dc]) => contiguousLine(board, position, "black", dr, dc).length > 5);
const hasExactFiveAt = (board: Cell[][], position: Position) => DIRECTIONS.some(([dr, dc]) => contiguousLine(board, position, "black", dr, dc).length === 5);

/** Find independent open-three shapes by checking whether a legal continuation
 * creates a straight four with two winning points. */
const openThreePatternsThrough = (board: Cell[][], origin: Position): string[] => {
  const patterns = new Set<string>();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (const extension of pointsOnAxis(board, origin, dr, dc, 4)) {
      if (board[extension.row]?.[extension.col] !== null) continue;
      board[extension.row][extension.col] = "black";
      const extensionFours = fourPatternsThrough(board, extension);
      const illegalExtension = hasOverlineAt(board, extension) || extensionFours.length >= 2;
      board[extension.row][extension.col] = null;
      if (illegalExtension) continue;
      for (const four of extensionFours) {
        if (four.direction !== direction || four.winningPoints.length < 2 || !four.stones.some((point) => samePoint(point, extension))) continue;
        const three = four.stones.filter((point) => !samePoint(point, extension));
        if (three.length === 3 && three.some((point) => samePoint(point, origin))) patterns.add(`${direction}:${three.map(pointKey).sort().join("|")}`);
      }
    }
  });
  return [...patterns];
};

export type ForbiddenKind = "overline" | "double-four" | "double-three";
export interface RenjuMoveEvaluation {
  legal: boolean;
  forbidden: ForbiddenKind | null;
  reason: string | null;
  exactFive: boolean;
  fourCount: number;
  openThreeCount: number;
}

const renjuEvaluationCache = new WeakMap<Cell[][], Map<string, RenjuMoveEvaluation>>();
export const evaluateRenjuMove = (board: Cell[][], position: Position): RenjuMoveEvaluation => {
  // Some analysis callers reuse and mutate a scratch board. Include its content
  // in the cache key so those evaluations cannot leak into the next position.
  const boardKey = board.map((row) => row.map((cell) => cell === "black" ? "1" : cell === "white" ? "2" : "0").join("")).join("/");
  const cacheKey = `${pointKey(position)}:${boardKey}`;
  const cached = renjuEvaluationCache.get(board)?.get(cacheKey);
  if (cached) return cached;
  const remember = (evaluation: RenjuMoveEvaluation) => {
    let cache = renjuEvaluationCache.get(board);
    if (!cache) { cache = new Map(); renjuEvaluationCache.set(board, cache); }
    cache.set(cacheKey, evaluation);
    return evaluation;
  };
  if (board[position.row]?.[position.col] !== null) return remember({ legal: false, forbidden: null, reason: "该位置已有棋子", exactFive: false, fourCount: 0, openThreeCount: 0 });
  const next = cloneBoard(board); next[position.row][position.col] = "black";
  const overline = hasOverlineAt(next, position);
  const exactFive = hasExactFiveAt(next, position);
  if (overline) return remember({ legal: false, forbidden: "overline", reason: "长连禁手", exactFive, fourCount: 0, openThreeCount: 0 });
  // Under the competition profile used by the existing VCF engine, an exact
  // black five wins before double-three/double-four are considered.
  if (exactFive) return remember({ legal: true, forbidden: null, reason: null, exactFive: true, fourCount: 0, openThreeCount: 0 });
  const fours = fourPatternsThrough(next, position);
  if (fours.length >= 2) return remember({ legal: false, forbidden: "double-four", reason: "四四禁手", exactFive: false, fourCount: fours.length, openThreeCount: 0 });
  const threes = openThreePatternsThrough(next, position);
  if (threes.length >= 2) return remember({ legal: false, forbidden: "double-three", reason: "三三禁手", exactFive: false, fourCount: fours.length, openThreeCount: threes.length });
  return remember({ legal: true, forbidden: null, reason: null, exactFive: false, fourCount: fours.length, openThreeCount: threes.length });
};

export const forbiddenReason = (board: Cell[][], position: Position): string | null => evaluateRenjuMove(board, position).reason;

export const forbiddenPoints = (board: Cell[][]): Array<Position & { reason: string }> => {
  const result: Array<Position & { reason: string }> = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < (board[row]?.length || 0); col += 1) {
    if (board[row][col] !== null) continue;
    const reason = forbiddenReason(board, { row, col });
    if (reason) result.push({ row, col, reason });
  }
  return result;
};

export const winningLinesAt = (board: Cell[][], position: Position, rule: RuleSet = "freestyle"): Position[][] => {
  const player = board[position.row]?.[position.col];
  if (!player) return [];
  return DIRECTIONS.map(([dr, dc]) => contiguousLine(board, position, player, dr, dc)).filter((line) => {
    if (rule === "renju" && player === "black") return line.length === 5;
    return line.length >= 5;
  });
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
export const setLabelMark = (marks: BoardMark[], position: Position, label: string, style: BoardMark["style"] = "text", color?: string): BoardMark[] => {
  const normalized = Array.from(label.trim()).slice(0, 4).join("");
  if (!normalized) return marks;
  const existing = marks.find((mark) => mark.row === position.row && mark.col === position.col);
  if (existing?.kind === "label" && existing.label === normalized) {
    return marks.filter((mark) => mark !== existing);
  }
  return [
    ...marks.filter((mark) => mark.row !== position.row || mark.col !== position.col),
    { ...position, kind: "label", label: normalized, style, color },
  ];
};
