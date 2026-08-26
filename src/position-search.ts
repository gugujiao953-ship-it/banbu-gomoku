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
      const previous = new Map<string, Cell>();
      const write = (position: Position, value: Cell) => {
        const key = `${position.row},${position.col}`;
        if (!previous.has(key)) previous.set(key, board[position.row][position.col]);
        board[position.row][position.col] = value;
      };
      const restore = () => previous.forEach((value, key) => { const [row, col] = key.split(",").map(Number); board[row][col] = value; });
      node.setup?.empty.forEach((position) => write(position, null));
      node.setup?.black.forEach((position) => write(position, "black"));
      node.setup?.white.forEach((position) => write(position, "white"));
      if (node.move && (node.move.row < 0 || node.move.row >= BOARD_SIZE || node.move.col < 0 || node.move.col >= BOARD_SIZE || board[node.move.row][node.move.col])) { restore(); return; }
      if (node.move) write(node.move, node.move.player);
      let next = node.setup?.nextPlayer || player;
      const turnPlayer = node.move?.player || node.passPlayer;
      if (turnPlayer) next = turnPlayer === "black" ? "white" : "black";
      const nodeDepth = depth + (turnPlayer ? 1 : 0);
      if (positionKey(board, next, includeSymmetry) === wanted) {
        matches.push({
          documentId: document.id, nodeId, depth: nodeDepth, title: document.metadata.title,
          coordinate: node.move ? `${String.fromCharCode(65 + node.move.col)}${BOARD_SIZE - node.move.row}` : undefined,
        });
      }
      const nextPath = new Set(path); nextPath.add(nodeId);
      node.children.forEach((childId) => visit(childId, nodeDepth, next, nextPath));
      restore();
    };
    visit(document.rootId, 0, "black", new Set());
    if (matches.length >= limit) break;
  }
  return matches;
};
