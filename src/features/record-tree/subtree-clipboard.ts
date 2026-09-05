import { boardAt, evaluateRenjuMove, nextPlayerAt } from "../../game";
import type { Cell, GameDocument, Player, Position, RecordNode } from "../../types";
import type { RecordBookmark } from "./bookmarks";

export interface SubtreeClipboardBookmark extends Omit<RecordBookmark, "nodeId"> { nodeId: string }

export interface SubtreeClipboard {
  version: 1;
  sourceDocumentId: string;
  rootId: string;
  nodes: Record<string, RecordNode>;
  bookmarks: SubtreeClipboardBookmark[];
  copiedAt: string;
}

export type PasteFailureCode = "missing-source" | "missing-target" | "cycle" | "broken-tree" | "out-of-bounds" | "occupied" | "duplicate" | "wrong-player" | "forbidden" | "invalid-setup";

export type PasteSubtreeResult = {
  ok: true;
  document: GameDocument;
  rootId: string;
  nodes: Record<string, RecordNode>;
  bookmarks: RecordBookmark[];
  idMap: Record<string, string>;
} | {
  ok: false;
  code: PasteFailureCode;
  reason: string;
};

const clonePosition = <T extends Position>(value: T): T => ({ ...value });
const cloneNode = (node: RecordNode): RecordNode => ({
  ...node,
  children: [...node.children],
  move: node.move ? clonePosition(node.move) : null,
  marks: (node.marks || []).map(clonePosition),
  setup: node.setup ? {
    ...node.setup,
    black: node.setup.black.map(clonePosition),
    white: node.setup.white.map(clonePosition),
    empty: node.setup.empty.map(clonePosition),
  } : undefined,
  renLibAnnotations: node.renLibAnnotations?.map((annotation) => ({
    ...annotation,
    rawBytes: annotation.rawBytes ? new Uint8Array(annotation.rawBytes) : undefined,
  })),
});

const pointKey = (point: Position) => `${point.row},${point.col}`;
const inside = (point: Position, size: number) => point.row >= 0 && point.row < size && point.col >= 0 && point.col < size;
const other = (player: Player): Player => player === "black" ? "white" : "black";
const cloneBoard = (board: Cell[][]): Cell[][] => board.map((row) => [...row]);

export const copyRecordSubtree = (
  document: GameDocument,
  rootId: string,
  bookmarks: RecordBookmark[] = [],
  copiedAt = new Date().toISOString(),
): SubtreeClipboard | null => {
  if (!document.nodes[rootId]) return null;
  const nodes: Record<string, RecordNode> = {};
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const node = document.nodes[id];
    if (!node) return false;
    visiting.add(id);
    nodes[id] = cloneNode(node);
    for (const childId of node.children) if (!visit(childId)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if (!visit(rootId)) return null;
  return {
    version: 1,
    sourceDocumentId: document.id,
    rootId,
    nodes,
    bookmarks: bookmarks.filter((bookmark) => visited.has(bookmark.nodeId)).map((bookmark) => ({ ...bookmark })),
    copiedAt,
  };
};

const validateSetup = (board: Cell[][], node: RecordNode, size: number): string | null => {
  if (!node.setup) return null;
  const black = new Set(node.setup.black.map(pointKey));
  const white = new Set(node.setup.white.map(pointKey));
  const positions = [...node.setup.black, ...node.setup.white, ...node.setup.empty];
  if (positions.some((point) => !inside(point, size))) return "设置局面包含棋盘范围外的坐标";
  if ([...black].some((key) => white.has(key))) return "设置局面的黑白棋子使用了同一坐标";
  for (const point of node.setup.empty) board[point.row][point.col] = null;
  for (const point of node.setup.black) board[point.row][point.col] = "black";
  for (const point of node.setup.white) board[point.row][point.col] = "white";
  return null;
};

const directMoveKey = (node: RecordNode) => node.move ? `move:${pointKey(node.move)}` : node.passPlayer ? `pass:${node.passPlayer}` : null;

export const pasteRecordSubtree = (
  document: GameDocument,
  targetId: string,
  clipboard: SubtreeClipboard,
  options: { makeId?: (sourceId: string, index: number) => string; now?: string } = {},
): PasteSubtreeResult => {
  if (!clipboard.nodes[clipboard.rootId]) return { ok: false, code: "missing-source", reason: "复制内容的起始节点已缺失" };
  const target = document.nodes[targetId];
  if (!target) return { ok: false, code: "missing-target", reason: "目标节点不存在，请重新选择粘贴位置" };
  const size = document.metadata.boardSize || 15;
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let traversalError: PasteSubtreeResult | null = null;
  const visit = (id: string) => {
    if (visiting.has(id)) { traversalError = { ok: false, code: "cycle", reason: "复制内容包含循环引用，已停止粘贴" }; return; }
    if (visited.has(id) || traversalError) return;
    const node = clipboard.nodes[id];
    if (!node) { traversalError = { ok: false, code: "broken-tree", reason: "复制内容存在缺失节点，已停止粘贴" }; return; }
    visiting.add(id);
    order.push(id);
    for (const childId of node.children) visit(childId);
    visiting.delete(id);
    visited.add(id);
  };
  visit(clipboard.rootId);
  if (traversalError) return traversalError;

  const rootMoveKey = directMoveKey(clipboard.nodes[clipboard.rootId]);
  if (rootMoveKey && target.children.some((childId) => {
    const child = document.nodes[childId];
    return child && directMoveKey(child) === rootMoveKey;
  })) return { ok: false, code: "duplicate", reason: "目标节点下已经有相同着法，未覆盖原分支" };

  const validate = (sourceId: string, parentBoard: Cell[][], expectedPlayer: Player): PasteSubtreeResult | null => {
    const node = clipboard.nodes[sourceId];
    const board = cloneBoard(parentBoard);
    const setupError = validateSetup(board, node, size);
    if (setupError) return { ok: false, code: "invalid-setup", reason: setupError };
    let nextPlayer = node.setup?.nextPlayer || expectedPlayer;
    if (node.passPlayer) {
      if (node.passPlayer !== nextPlayer) return { ok: false, code: "wrong-player", reason: `过手方与目标局面的轮次不一致，应由${nextPlayer === "black" ? "黑" : "白"}方行棋` };
      nextPlayer = other(node.passPlayer);
    }
    if (node.move) {
      if (!inside(node.move, size)) return { ok: false, code: "out-of-bounds", reason: "复制分支包含棋盘范围外的着法" };
      if (node.move.player !== nextPlayer) return { ok: false, code: "wrong-player", reason: `粘贴后轮次冲突：此处应由${nextPlayer === "black" ? "黑" : "白"}方行棋` };
      if (board[node.move.row]?.[node.move.col]) return { ok: false, code: "occupied", reason: "复制分支中的着法与目标局面已有棋子冲突" };
      if (document.metadata.rule === "renju" && node.move.player === "black") {
        const evaluation = evaluateRenjuMove(board, node.move);
        if (!evaluation.legal) return { ok: false, code: "forbidden", reason: `复制分支包含非法黑棋着法：${evaluation.reason || "禁手"}` };
      }
      board[node.move.row][node.move.col] = node.move.player;
      nextPlayer = other(node.move.player);
    }
    const childKeys = new Set<string>();
    for (const childId of node.children) {
      const child = clipboard.nodes[childId];
      const key = child && directMoveKey(child);
      if (key && childKeys.has(key)) return { ok: false, code: "duplicate", reason: "复制分支内部存在重复着法" };
      if (key) childKeys.add(key);
      const failure = validate(childId, board, nextPlayer);
      if (failure) return failure;
    }
    return null;
  };
  const failure = validate(clipboard.rootId, boardAt(document, targetId), nextPlayerAt(document, targetId));
  if (failure) return failure;

  const now = options.now || new Date().toISOString();
  const makeId = options.makeId || ((sourceId: string, index: number) => `tree-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}-${sourceId.slice(-4)}`);
  const used = new Set(Object.keys(document.nodes));
  const idMap: Record<string, string> = {};
  order.forEach((sourceId, index) => {
    let candidate = makeId(sourceId, index);
    let suffix = 1;
    while (!candidate || used.has(candidate)) candidate = `${makeId(sourceId, index)}-${suffix++}`;
    used.add(candidate);
    idMap[sourceId] = candidate;
  });
  const nodes: Record<string, RecordNode> = {};
  for (const sourceId of order) {
    const source = clipboard.nodes[sourceId];
    const id = idMap[sourceId];
    const cloned = cloneNode(source);
    nodes[id] = {
      ...cloned,
      id,
      parentId: sourceId === clipboard.rootId ? targetId : idMap[source.parentId || ""] || targetId,
      children: source.children.map((childId) => idMap[childId]),
      preferredChildId: source.preferredChildId ? idMap[source.preferredChildId] : undefined,
    };
  }
  const rootId = idMap[clipboard.rootId];
  const nextTarget = { ...target, children: [...target.children, rootId], preferredChildId: rootId };
  const nextDocument: GameDocument = { ...document, updatedAt: now, nodes: { ...document.nodes, [targetId]: nextTarget, ...nodes } };
  const bookmarks = clipboard.bookmarks.map((bookmark, index): RecordBookmark => ({
    ...bookmark,
    id: `bookmark-${Date.parse(now).toString(36)}-paste-${index.toString(36)}`,
    nodeId: idMap[bookmark.nodeId],
    createdAt: now,
    updatedAt: now,
  })).filter((bookmark) => Boolean(bookmark.nodeId));
  return { ok: true, document: nextDocument, rootId, nodes, bookmarks, idMap };
};
