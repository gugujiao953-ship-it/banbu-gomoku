import { BOARD_SIZE, forbiddenReason, otherPlayer } from "./game";
import type { Cell, Player, Position } from "./types";

export interface CandidateScore {
  position: Position;
  score: number;
  reasons: string[];
  attack: number;
  defense: number;
  forbidden?: string;
}

const DIRECTIONS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inBoard = (row: number, col: number) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

function lineStats(board: Cell[][], position: Position, player: Player, dr: number, dc: number) {
  let contiguous = 1;
  let openEnds = 0;
  for (const sign of [-1, 1]) {
    let step = 1;
    while (true) {
      const row = position.row + dr * step * sign;
      const col = position.col + dc * step * sign;
      if (!inBoard(row, col)) break;
      if (board[row][col] === player) { contiguous += 1; step += 1; continue; }
      if (board[row][col] === null) openEnds += 1;
      break;
    }
  }
  return { contiguous, openEnds };
}

function threatValue(board: Cell[][], position: Position, player: Player) {
  const stats = DIRECTIONS.map(([dr, dc]) => lineStats(board, position, player, dr, dc));
  const win = stats.some(({ contiguous }) => contiguous >= 5);
  const liveFour = stats.filter(({ contiguous, openEnds }) => contiguous === 4 && openEnds === 2).length;
  const rushFour = stats.filter(({ contiguous, openEnds }) => contiguous === 4 && openEnds >= 1).length;
  const liveThree = stats.filter(({ contiguous, openEnds }) => contiguous === 3 && openEnds === 2).length;
  const rushThree = stats.filter(({ contiguous, openEnds }) => contiguous === 3 && openEnds >= 1).length;
  const links = stats.reduce((total, item) => total + Math.max(0, item.contiguous - 1), 0);
  return { win, liveFour, rushFour, liveThree, rushThree, links };
}

function scoreThreats(threats: ReturnType<typeof threatValue>) {
  return (threats.win ? 100000 : 0) + threats.liveFour * 9000 + threats.rushFour * 2500 +
    threats.liveThree * 900 + threats.rushThree * 180 + threats.links * 18;
}

/**
 * Lightweight, explainable candidate evaluator. It deliberately does not claim
 * to be a VCF/VCT solver: it ranks forcing moves and defensive points using
 * local line geometry, so the result is useful for study without pretending to
 * prove a tactical win.
 */
export function analyzeCandidates(board: Cell[][], player: Player, limit = 8): CandidateScore[] {
  const opponent = otherPlayer(player);
  const result: CandidateScore[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) {
    if (board[row][col]) continue;
    const position = { row, col };
    const ownBoard = board.map((line) => [...line]);
    ownBoard[row][col] = player;
    const attackThreat = threatValue(ownBoard, position, player);
    const defenseBoard = board.map((line) => [...line]);
    defenseBoard[row][col] = opponent;
    const defenseThreat = threatValue(defenseBoard, position, opponent);
    const forbidden = player === "black" ? forbiddenReason(board, position) : null;
    const reasons: string[] = [];
    if (attackThreat.win) reasons.push("成五");
    if (attackThreat.liveFour) reasons.push(`活四×${attackThreat.liveFour}`);
    else if (attackThreat.rushFour) reasons.push(`冲四×${attackThreat.rushFour}`);
    if (attackThreat.liveThree) reasons.push(`活三×${attackThreat.liveThree}`);
    if (defenseThreat.liveFour || defenseThreat.rushFour) reasons.push("防守对方四")
    else if (defenseThreat.liveThree) reasons.push("防守对方活三");
    if (attackThreat.links >= 2) reasons.push("形成连接");
    if (forbidden) reasons.push(forbidden);
    const center = 7 - Math.min(7, Math.abs(row - 7), Math.abs(col - 7));
    const score = scoreThreats(attackThreat) + scoreThreats(defenseThreat) * 0.82 + center * 2 - (forbidden ? 120000 : 0);
    if (reasons.length || score > 20) result.push({ position, score, reasons: reasons.length ? reasons : ["靠近现有棋形"], attack: scoreThreats(attackThreat), defense: scoreThreats(defenseThreat), forbidden: forbidden || undefined });
  }
  return result.sort((a, b) => b.score - a.score || (a.position.row + a.position.col) - (b.position.row + b.position.col)).slice(0, limit);
}
