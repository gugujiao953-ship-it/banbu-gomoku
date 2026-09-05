import { boardAt, createDocument, nextPlayerAt } from "../../game";
import type { GameDocument, Player, Position, RecordNode } from "../../types";

export interface PuzzleSetupMove extends Position {
  player: Player;
}

export interface PuzzleSetupSession {
  id: string;
  sourceDocument: GameDocument;
  sourceCurrentId: string;
  moves: PuzzleSetupMove[];
  cursor: number;
}

export interface PuzzleSetupView {
  document: GameDocument;
  currentId: string;
}

const sessionId = () => `puzzle-setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createPuzzleSetupSession(sourceDocument: GameDocument, sourceCurrentId: string): PuzzleSetupSession {
  return {
    id: sessionId(),
    sourceDocument,
    sourceCurrentId: sourceDocument.nodes[sourceCurrentId] ? sourceCurrentId : sourceDocument.rootId,
    moves: [],
    cursor: 0,
  };
}

export function puzzleSetupView(session: PuzzleSetupSession): PuzzleSetupView {
  const base = createDocument(`${session.sourceDocument.metadata.title} · 摆棋`, session.sourceDocument.metadata.boardSize);
  const baseBoard = boardAt(session.sourceDocument, session.sourceCurrentId);
  const black: Position[] = [];
  const white: Position[] = [];
  baseBoard.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
    if (cell === "black") black.push({ row: rowIndex, col: colIndex });
    else if (cell === "white") white.push({ row: rowIndex, col: colIndex });
  }));

  const rootId = `${session.id}-root`;
  const root: RecordNode = {
    id: rootId,
    parentId: null,
    children: [],
    move: null,
    setup: { black, white, empty: [], nextPlayer: nextPlayerAt(session.sourceDocument, session.sourceCurrentId) },
    comment: "",
    marks: [],
  };
  const nodes: Record<string, RecordNode> = { [rootId]: root };
  let parentId = rootId;
  session.moves.slice(0, session.cursor).forEach((move, index) => {
    const id = `${session.id}-move-${index + 1}`;
    nodes[parentId] = { ...nodes[parentId], children: [id], preferredChildId: id };
    nodes[id] = { id, parentId, children: [], move: { ...move }, comment: "", marks: [] };
    parentId = id;
  });

  return {
    document: {
      ...base,
      id: `${session.id}-document`,
      rootId,
      nodes,
      metadata: { ...session.sourceDocument.metadata, title: `${session.sourceDocument.metadata.title} · 摆棋` },
    },
    currentId: parentId,
  };
}

export function movePuzzleSetupCursor(session: PuzzleSetupSession, cursor: number): PuzzleSetupSession {
  const nextCursor = Math.max(0, Math.min(session.moves.length, cursor));
  return nextCursor === session.cursor ? session : { ...session, cursor: nextCursor };
}

export function placePuzzleSetupStone(session: PuzzleSetupSession, position: Position, player: Player): { session: PuzzleSetupSession; placed: boolean } {
  const view = puzzleSetupView(session);
  if (boardAt(view.document, view.currentId)[position.row]?.[position.col]) return { session, placed: false };
  const moves = [...session.moves.slice(0, session.cursor), { ...position, player }];
  return { session: { ...session, moves, cursor: moves.length }, placed: true };
}
