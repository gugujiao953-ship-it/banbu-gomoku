import type { BoardMark, Cell, GameDocument, Player, Position, RecordNode, RuleSet } from "./types";
import { foulReport } from "./renju-forbid";

export const BOARD_SIZE = 15;
export const MIN_BOARD_SIZE = 5;
export const MAX_BOARD_SIZE = 30;
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

/** 主线第 N 手对应的节点 id（N=0 即起始局面）。口径与 depthOf/mainLineLength 一致：
 * 过手（passPlayer）也算一手，否则滑轨与跳手的数字会和状态条对不上。沿 preferredChild
 * 链前进；主线尽头仍未凑够就返回尽头——滑轨拖到区间之外时，落在最后一手比抛错合用。
 * 定义放在 depthOf 之后，但它引用的 preferredNext 在文件下方（函数提升，运行时无碍）。 */
export const nodeIdAtDepth = (document: GameDocument, depth: number): string => {
  let id = document.rootId;
  const target = Math.max(0, Math.round(depth));
  if (target === 0) return id;
  let counted = 0;
  const seen = new Set<string>([id]);
  while (counted < target) {
    const next = preferredNext(document, id);
    if (!next || seen.has(next)) break;
    seen.add(next);
    id = next;
    const node = document.nodes[id];
    if (node?.move || node?.passPlayer) counted += 1;
  }
  return id;
};
export const nextPlayerAt = (document: GameDocument, nodeId: string): Player => {
  let player: Player = "black";
  pathToNode(document, nodeId).forEach((node) => {
    const turnPlayer = node.move?.player || node.passPlayer;
    if (turnPlayer) player = otherPlayer(turnPlayer);
    // 节点可以显式声明「本局面轮谁走」（SGF 的 PL、静态摆局 setup、题目预置局面）。
    // 声明的语义是「这个节点自身（含 setup 与落子）之后的轮次」，所以优先于由最后
    // 一手颜色推出来的行棋方——否则像白先题的预置子只要不是按手序排列，就会推反。
    if (node.setup?.nextPlayer) player = node.setup.nextPlayer;
  });
  return player;
};

export const addMove = (document: GameDocument, currentId: string, position: Position) => {
  return addMoveAs(document, currentId, position, nextPlayerAt(document, currentId));
};

const isValidPosition = (position: Position, size: number) => Number.isInteger(position.row) && Number.isInteger(position.col)
  && position.row >= 0 && position.row < size && position.col >= 0 && position.col < size;

/** Add an explicitly coloured move, used by puzzle positions whose setup does
 * not necessarily alternate in record order. */
export const addMoveAs = (document: GameDocument, currentId: string, position: Position, player: Player) => {
  const parent = document.nodes[currentId];
  if (!parent || !isValidPosition(position, document.metadata.boardSize || BOARD_SIZE) || boardAt(document, currentId)[position.row][position.col]) return { document, nodeId: currentId, created: false };
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
  if (!node?.move || !node.parentId || !isValidPosition(position, size)) {
    return { document, changed: false, reason: "只能修改已有着法" };
  }
  const parentBoard = boardAt(document, node.parentId);
  const occupied = parentBoard[position.row]?.[position.col];
  if (occupied) return { document, changed: false, reason: "该位置已经有棋子" };
  const sibling = document.nodes[node.parentId].children
    .map((id) => document.nodes[id])
    .find((child) => child?.id !== nodeId && child?.move?.row === position.row && child.move.col === position.col && child.move.player === node.move?.player);
  if (sibling) return { document, changed: false, reason: "该分支已有相同着法" };
  const descendantIds = descendantsOf(document, nodeId).slice(1);
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

export const updateNode = (document: GameDocument, nodeId: string, patch: Partial<Pick<RecordNode, "comment" | "marks" | "preferredChildId" | "boardText" | "evaluation" | "evaluationLevel">>): GameDocument => {
  const node = document.nodes[nodeId];
  if (!node || (patch.preferredChildId !== undefined && !node.children.includes(patch.preferredChildId))) return document;
  return { ...document, updatedAt: new Date().toISOString(), nodes: { ...document.nodes, [nodeId]: { ...node, ...patch } } };
};

const descendantsOf = (document: GameDocument, nodeId: string) => {
  const result: string[] = [];
  const stack = [nodeId], seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id); result.push(id);
    const children = document.nodes[id]?.children || [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
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
export const columnName = (col: number): string => {
  let name = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};
export const coordinateName = ({ row, col }: Position, size = BOARD_SIZE) => `${columnName(col)}${size - row}`;
export const parseCoordinate = (text: string, size = BOARD_SIZE): Position | null => {
  const match = text.trim().toUpperCase().match(/^([A-Z]{1,2})(\d{1,2})$/);
  if (!match) return null;
  const col = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1, row = size - Number(match[2]);
  // row 也要判上界：A0 会算出 row === size，越界索引写进棋盘会让后续渲染抛
  // 「Cannot set properties of undefined」。导入的题库 JSON 与 LIB 标注注释
  // 都会经过这里，非法坐标必须在这一层拦掉。
  return col < size && row >= 0 && row < size ? { col, row } : null;
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
const openThreePatternsThrough = (board: Cell[][], origin: Position, validateExtensionDoubleThree = true): string[] => {
  const patterns = new Set<string>();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (const extension of pointsOnAxis(board, origin, dr, dc, 4)) {
      if (board[extension.row]?.[extension.col] !== null) continue;
      board[extension.row][extension.col] = "black";
      const extensionFours = fourPatternsThrough(board, extension);
      const qualifyingFours = extensionFours.filter((four) => (
        four.direction === direction
        && four.winningPoints.length >= 2
        && four.stones.some((point) => samePoint(point, extension))
      ));
      if (!qualifyingFours.length) {
        board[extension.row][extension.col] = null;
        continue;
      }
      const extensionWins = hasExactFiveAt(board, extension);
      let illegalExtension = hasOverlineAt(board, extension) || (!extensionWins && extensionFours.length >= 2);
      // A three is only live when it can become a straight four through a legal
      // black move. Check double-three as well as overline/double-four. The
      // nested pass deliberately stops after one extra legality layer: it
      // resolves the extension point without recursively expanding an entire
      // board-sized forbidden-move tree for every candidate scan.
      if (!illegalExtension && !extensionWins && validateExtensionDoubleThree) {
        illegalExtension = openThreePatternsThrough(board, extension, false).length >= 2;
      }
      board[extension.row][extension.col] = null;
      // A winning extension — the extension point itself completes a five — ends
      // the game instead of creating a straight-four threat, so it cannot turn
      // this three into an "open three". An open three must be able to become a
      // live four that the opponent still has to answer; a direct five is a win,
      // not a four-threat. (Classic puzzle: a horizontal three whose only
      // extensions are diagonal five-in-a-row points is not live.) User 09-11.
      if (illegalExtension || extensionWins) continue;
      for (const four of qualifyingFours) {
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

/**
 * 判定「黑方在这个点落子」的结果——**不含占位检查与缓存**，调用方必须已经把那一点
 * 摆成黑子。抽出来是为了让整盘扫描（forbiddenPoints）能复用一块盘面：原先每个空点
 * 都走 evaluateRenjuMove，而它每次都要为缓存键把 225 格拼成字符串、再克隆整盘，
 * 15 路实测一次全盘扫描 65–85ms（每轮到黑方都要跑）。
 */
const toNumericBoard = (board: Cell[][]): number[][] =>
  board.map((row) => row.map((cell) => cell === "black" ? 1 : cell === "white" ? -1 : 0));

const blackMoveEvaluation = (next: Cell[][], position: Position): RenjuMoveEvaluation => {
  // 15 路走移植版（逐线图元 + 三三递归验完成点，见 src/renju-forbid.ts）：那份实现按 15 路
  // 哨兵写死，只对 15×15 成立，所以其它路数仍走下面这套"落子后推演图元"的实现。
  if (next.length === BOARD_SIZE && next.every((row) => row.length === BOARD_SIZE)) {
    const report = foulReport(toNumericBoard(next), position.row, position.col);
    const exactFive = hasExactFiveAt(next, position);
    if (!report.kind) return { legal: true, forbidden: null, reason: null, exactFive, fourCount: report.fours, openThreeCount: report.threes };
    const reason = report.kind === "double-three" ? "三三禁手" : report.kind === "double-four" ? "四四禁手" : "长连禁手";
    return { legal: false, forbidden: report.kind, reason, exactFive, fourCount: report.fours, openThreeCount: report.threes };
  }
  const overline = hasOverlineAt(next, position);
  const exactFive = hasExactFiveAt(next, position);
  // RIF rule 9.1/9.2: attaining an exact five wins before the forbidden-move
  // clauses are considered, including when another direction is an overline.
  if (exactFive) return { legal: true, forbidden: null, reason: null, exactFive: true, fourCount: 0, openThreeCount: 0 };
  if (overline) return { legal: false, forbidden: "overline", reason: "长连禁手", exactFive: false, fourCount: 0, openThreeCount: 0 };
  const fours = fourPatternsThrough(next, position);
  if (fours.length >= 2) return { legal: false, forbidden: "double-four", reason: "四四禁手", exactFive: false, fourCount: fours.length, openThreeCount: 0 };
  const threes = openThreePatternsThrough(next, position);
  if (threes.length >= 2) return { legal: false, forbidden: "double-three", reason: "三三禁手", exactFive: false, fourCount: fours.length, openThreeCount: threes.length };
  return { legal: true, forbidden: null, reason: null, exactFive: false, fourCount: fours.length, openThreeCount: threes.length };
};

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
  return remember(blackMoveEvaluation(next, position));
};

export const forbiddenReason = (board: Cell[][], position: Position): string | null => evaluateRenjuMove(board, position).reason;

export const forbiddenPoints = (board: Cell[][]): Array<Position & { reason: string }> => {
  const result: Array<Position & { reason: string }> = [];
  // 整盘扫描只克隆一次盘面，每个空点摆上黑子判完再还原——判定函数内部对盘面的
  // 临时读写都是配平的（fourPatternsThrough / openThreePatternsThrough 都会还原）。
  // 走这条路就不用为每个空点付一次「拼 225 格缓存键 + 克隆整盘」的钱。
  const scratch = cloneBoard(board);
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < (board[row]?.length || 0); col += 1) {
    if (board[row][col] !== null) continue;
    scratch[row][col] = "black";
    const evaluation = blackMoveEvaluation(scratch, { row, col });
    scratch[row][col] = null;
    if (evaluation.reason) result.push({ row, col, reason: evaluation.reason });
  }
  return result;
};

export const winningLinesAt = (board: Cell[][], position: Position, rule: RuleSet = "freestyle"): Position[][] => {
  const player = board[position.row]?.[position.col];
  if (!player) return [];
  return DIRECTIONS.map(([dr, dc]) => contiguousLine(board, position, player, dr, dc)).filter((line) => {
    if (rule === "renju" && player === "black") return line.length === 5;
    if (rule === "standard") return line.length === 5;
    return line.length >= 5;
  });
};

export const toggleMark = (marks: BoardMark[], position: Position, preset?: Partial<BoardMark>): BoardMark[] => {
  // 点已有标注 = 一步整点移除（不论文字还是形状），点空位 = 放圆圈。
  // 用户 09-10 反馈：长按已有标注期望「先去掉，再点才放新的」，原实现的
  // 形状循环（圆圈→三角→叉号→移除）让用户看到「点一下盖一层/变一个」。
  //
  // `preset` 是标注面板当前的画笔（形状/颜色/文字）。**不加这个参数曾经是个真 bug**：
  // 长按/右键标注走的就是这里，而它建标注时只写 `kind:"circle"`，于是面板里选好的颜色
  // 永远不生效（用户 09-17：「切换颜色标注后，那个颜色不生效」）。面板打开时由调用方
  // 把画笔传进来；不在标注模式时仍是默认的圆圈。
  const current = marks.find((mark) => mark.row === position.row && mark.col === position.col);
  if (!current) return [...marks, { ...position, kind: "circle", ...preset }];
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
