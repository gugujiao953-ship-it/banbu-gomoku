import { BOARD_SIZE, emptyBoard } from "./game";
import type { Cell, GameDocument, Player, Position } from "./types";

export interface PositionMatch {
  documentId: string;
  nodeId: string;
  depth: number;
  title: string;
  coordinate?: string;
}

type Transform = (row: number, col: number) => Position;
const transforms: Transform[] = [
  (row, col) => ({ row, col }),
  (row, col) => ({ row: col, col: BOARD_SIZE - 1 - row }),
  (row, col) => ({ row: BOARD_SIZE - 1 - row, col: BOARD_SIZE - 1 - col }),
  (row, col) => ({ row: BOARD_SIZE - 1 - col, col: row }),
  (row, col) => ({ row, col: BOARD_SIZE - 1 - col }),
  (row, col) => ({ row: BOARD_SIZE - 1 - row, col }),
  (row, col) => ({ row: col, col: row }),
  (row, col) => ({ row: BOARD_SIZE - 1 - col, col: BOARD_SIZE - 1 - row }),
];

const encode = (board: Cell[][], transform: Transform) => {
  const result: string[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) {
    if (!board[row][col]) continue;
    const target = transform(row, col);
    result.push(`${String(target.row * BOARD_SIZE + target.col).padStart(3, "0")}${board[row][col] === "black" ? "b" : "w"}`);
  }
  return result.sort().join(",");
};

export const positionKey = (board: Cell[][], nextPlayer: Player, includeSymmetry = true) => {
  const variants = (includeSymmetry ? transforms : transforms.slice(0, 1)).map((transform) => encode(board, transform));
  return `${nextPlayer === "black" ? "b" : "w"}:${variants.sort()[0]}`;
};

export const findPositionMatches = (documents: GameDocument[], target: Cell[][], nextPlayer: Player, includeSymmetry = true, limit = 60): PositionMatch[] => {
  const wanted = positionKey(target, nextPlayer, includeSymmetry);
  const matches: PositionMatch[] = [];
  for (const document of documents) {
    const board = emptyBoard();
    const visit = (nodeId: string, depth: number, player: Player, path: Set<string>) => {
      if (matches.length >= limit) return;
      if (path.has(nodeId)) return;
      const node = document.nodes[nodeId];
      if (!node) return;
      if (node.move && (node.move.row < 0 || node.move.row >= BOARD_SIZE || node.move.col < 0 || node.move.col >= BOARD_SIZE || board[node.move.row][node.move.col])) return;
      if (node.move) board[node.move.row][node.move.col] = node.move.player;
      const next = node.move ? (node.move.player === "black" ? "white" : "black") : player;
      if (positionKey(board, next, includeSymmetry) === wanted) {
        matches.push({
          documentId: document.id, nodeId, depth, title: document.metadata.title,
          coordinate: node.move ? `${String.fromCharCode(65 + node.move.col)}${BOARD_SIZE - node.move.row}` : undefined,
        });
      }
      const nextPath = new Set(path); nextPath.add(nodeId);
      node.children.forEach((childId) => visit(childId, depth + 1, next, nextPath));
      if (node.move) board[node.move.row][node.move.col] = null;
    };
    visit(document.rootId, 0, "black", new Set());
    if (matches.length >= limit) break;
  }
  return matches;
};
