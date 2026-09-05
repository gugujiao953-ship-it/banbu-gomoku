import { boardAt, nextPlayerAt, pathToNode, preferredNext } from "../../game";
import type { BoardSetup, GameDocument, RecordNode } from "../../types";

export type RecordExportScope = "whole" | "variation" | "position";

const cloneNode = (node: RecordNode): RecordNode => ({
  ...node,
  move: node.move ? { ...node.move } : null,
  setup: node.setup ? {
    black: node.setup.black.map((point) => ({ ...point })),
    white: node.setup.white.map((point) => ({ ...point })),
    empty: node.setup.empty.map((point) => ({ ...point })),
    nextPlayer: node.setup.nextPlayer,
  } : undefined,
  marks: (node.marks || []).map((mark) => ({ ...mark })),
  children: [...node.children],
  renLibAnnotations: node.renLibAnnotations?.map((annotation) => ({ ...annotation })),
});

export const createVariationExportDocument = (document: GameDocument, currentId: string, now = new Date().toISOString()): GameDocument => {
  const line = [...pathToNode(document, currentId)];
  let cursorId = currentId;
  const seen = new Set(line.map((node) => node.id));
  while (true) {
    const nextId = preferredNext(document, cursorId);
    if (!nextId || seen.has(nextId)) break;
    const next = document.nodes[nextId];
    if (!next) break;
    line.push(next);
    seen.add(nextId);
    cursorId = nextId;
  }
  const nodes: Record<string, RecordNode> = {};
  line.forEach((node, index) => {
    const next = line[index + 1];
    nodes[node.id] = {
      ...cloneNode(node),
      parentId: index === 0 ? null : line[index - 1].id,
      children: next ? [next.id] : [],
      preferredChildId: next?.id,
    };
  });
  return {
    ...document,
    id: `${document.id}-variation-${currentId}`,
    rootId: line[0]?.id || document.rootId,
    nodes,
    metadata: { ...document.metadata, title: `${document.metadata.title} · 当前变化`, sourceFormat: undefined, sourceFileName: undefined },
    updatedAt: now,
    savedCurrentId: line[line.length - 1]?.id,
  };
};

export const createPositionExportDocument = (document: GameDocument, currentId: string, now = new Date().toISOString()): GameDocument => {
  const board = boardAt(document, currentId);
  const setup: BoardSetup = { black: [], white: [], empty: [], nextPlayer: nextPlayerAt(document, currentId) };
  board.forEach((row, rowIndex) => row.forEach((player, colIndex) => {
    if (player) setup[player].push({ row: rowIndex, col: colIndex });
  }));
  const source = document.nodes[currentId] || document.nodes[document.rootId];
  const rootId = `${document.rootId}-position-${currentId}`;
  const root: RecordNode = {
    id: rootId,
    parentId: null,
    children: [],
    move: null,
    setup,
    comment: source?.comment || "",
    boardText: source?.boardText,
    marks: (source?.marks || []).map((mark) => ({ ...mark })),
    renLibAnnotations: source?.renLibAnnotations?.map((annotation) => ({ ...annotation })),
    startPosition: true,
  };
  return {
    id: `${document.id}-position-${currentId}`,
    version: 1,
    rootId,
    nodes: { [rootId]: root },
    metadata: { ...document.metadata, title: `${document.metadata.title} · 当前局面`, sourceFormat: undefined, sourceFileName: undefined },
    createdAt: now,
    updatedAt: now,
    savedCurrentId: rootId,
  };
};

export const documentForExportScope = (document: GameDocument, currentId: string, scope: RecordExportScope) => {
  if (scope === "variation") return createVariationExportDocument(document, currentId);
  if (scope === "position") return createPositionExportDocument(document, currentId);
  return document;
};

export const exportScopeSuffix = (scope: RecordExportScope) => scope === "whole" ? "整谱" : scope === "variation" ? "当前变化" : "当前局面";
