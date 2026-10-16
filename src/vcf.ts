import { evaluateRenjuMove, otherPlayer } from "./game";
import type { Cell, Player, Position, RuleSet } from "./types";

const DIRECTIONS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];

export interface VcfProofNode {
  move: Position;
  player: Player;
  kind: "attack" | "defense";
  terminal?: "five" | "unanswerable-four";
  winningPoints?: Position[];
  children: VcfProofNode[];
}

export interface VcfResult {
  status: "win" | "not-found" | "budget";
  attacker: Player;
  proof?: VcfProofNode;
  principalVariation: Array<Position & { player: Player }>;
  nodes: number;
  elapsedMs: number;
  maxAttackMoves: number;
}

export interface VcfOptions {
  rule?: RuleSet;
  maxAttackMoves?: number;
  timeBudgetMs?: number;
  nodeBudget?: number;
}

const cloneBoard = (board: Cell[][]) => board.map((row) => [...row]);
// 路数取自 board 本身（引擎已支持 22 路以内任意路数）；坐标越界判断统一走 inBoard。
const inBoard = (board: Cell[][], row: number, col: number) =>
  row >= 0 && row < board.length && col >= 0 && col < (board[row]?.length ?? 0);
const centerPoint = (board: Cell[][]): Position => ({ row: Math.floor(board.length / 2), col: Math.floor((board[0]?.length ?? 1) / 2) });

const emptyPoints = (board: Cell[][]) => {
  const result: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < (board[row]?.length ?? 0); col += 1) if (!board[row][col]) result.push({ row, col });
  return result;
};

/** VCF moves must touch the existing tactical shape. Avoid repeatedly
 * traversing every intersection at each recursive node. */
const tacticalPoints = (board: Cell[][]) => {
  const ids = new Set<string>();
  let hasStone = false;
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < (board[row]?.length ?? 0); col += 1) {
    if (!board[row][col]) continue;
    hasStone = true;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
      const nextRow = row + dr, nextCol = col + dc;
      if (inBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === null) ids.add(`${nextRow},${nextCol}`);
    }
  }
  if (!hasStone) return [centerPoint(board)];
  return [...ids].map((id) => { const [row, col] = id.split(",").map(Number); return { row, col }; });
};

const lineLength = (board: Cell[][], position: Position, player: Player, dr: number, dc: number) => {
  let count = 1;
  for (const sign of [-1, 1]) {
    let step = 1;
    while (board[position.row + dr * step * sign]?.[position.col + dc * step * sign] === player) { count += 1; step += 1; }
  }
  return count;
};

const lineLengthsAfter = (board: Cell[][], position: Position, player: Player) => {
  const next = cloneBoard(board); next[position.row][position.col] = player;
  return DIRECTIONS.map(([dr, dc]) => lineLength(next, position, player, dr, dc));
};

export const isLegalMove = (board: Cell[][], position: Position, player: Player, rule: RuleSet) => {
  if (board[position.row]?.[position.col] !== null) return false;
  if (rule !== "renju" || player !== "black") return true;
  // Keep VCF move legality on the same canonical path as board play. In
  // particular, RIF exact-five priority must also apply when another axis made
  // by the same move is an overline.
  return evaluateRenjuMove(board, position).legal;
};

export const isWinningMove = (board: Cell[][], position: Position, player: Player, rule: RuleSet) => {
  if (!isLegalMove(board, position, player, rule)) return false;
  const lengths = lineLengthsAfter(board, position, player);
  if (rule === "freestyle" || (rule === "renju" && player === "white")) return lengths.some((length) => length >= 5);
  return lengths.some((length) => length === 5);
};

const winningMoves = (board: Cell[][], player: Player, rule: RuleSet, tick: () => boolean) => {
  const result: Position[] = [];
  for (const position of tacticalPoints(board)) {
    if (!tick()) break;
    if (isWinningMove(board, position, player, rule)) result.push(position);
  }
  return result;
};

const samePosition = (a: Position, b: Position) => a.row === b.row && a.col === b.col;

export function searchVcf(board: Cell[][], attacker: Player, options: VcfOptions = {}): VcfResult {
  const rule = options.rule || "renju";
  const maxAttackMoves = Math.max(1, Math.min(8, options.maxAttackMoves || 5));
  const timeBudgetMs = Math.max(20, options.timeBudgetMs || 450);
  const nodeBudget = Math.max(100, options.nodeBudget || 30000);
  const started = performance.now();
  let nodes = 0, stopped = false;
  const tick = () => {
    nodes += 1;
    if (nodes > nodeBudget || performance.now() - started > timeBudgetMs) stopped = true;
    return !stopped;
  };
  const defender = otherPlayer(attacker);

  const attack = (state: Cell[][], remaining: number): VcfProofNode | null => {
    if (!tick()) return null;
    const empties = tacticalPoints(state);
    for (const move of empties) {
      if (!tick()) return null;
      if (isWinningMove(state, move, attacker, rule)) return { move, player: attacker, kind: "attack", terminal: "five", winningPoints: [], children: [] };
    }
    const forcing: Array<{ move: Position; wins: Position[] }> = [];
    for (const move of empties) {
      if (!tick()) return null;
      if (!isLegalMove(state, move, attacker, rule)) continue;
      const after = cloneBoard(state); after[move.row][move.col] = attacker;
      const wins = winningMoves(after, attacker, rule, tick);
      if (stopped) return null;
      if (wins.length) forcing.push({ move, wins });
    }
    // 平手时靠近棋盘中心优先：中心取 board 自身的中点，不能再写死 15 路的 (7,7)——
    // 本文件其余部分（inBoard / centerPoint）都已按 board.length 走，非 15 路棋盘上
    // 这个硬编码会改变搜索顺序，配合节点/时间预算可能把胜局报成 not-found。
    const center = centerPoint(state);
    const centerDistance = (move: Position) => Math.abs(move.row - center.row) + Math.abs(move.col - center.col);
    forcing.sort((a, b) => b.wins.length - a.wins.length || centerDistance(a.move) - centerDistance(b.move));

    for (const candidate of forcing) {
      if (!tick()) return null;
      if (remaining <= 1) continue;
      const afterAttack = cloneBoard(state); afterAttack[candidate.move.row][candidate.move.col] = attacker;
      const defenses: Array<{ move: Position; board: Cell[][]; wins: boolean }> = [];
      const counterWins = winningMoves(afterAttack, defender, rule, tick);
      if (stopped) return null;
      const defenseCandidates = [...candidate.wins, ...counterWins.filter((move) => !candidate.wins.some((item) => samePosition(item, move)))];
      for (const move of defenseCandidates) {
        if (!tick()) return null;
        if (!isLegalMove(afterAttack, move, defender, rule)) continue;
        const defenderWins = isWinningMove(afterAttack, move, defender, rule);
        const afterDefense = cloneBoard(afterAttack); afterDefense[move.row][move.col] = defender;
        const remainingWins = defenderWins ? [] : winningMoves(afterDefense, attacker, rule, tick);
        if (stopped) return null;
        if (defenderWins || remainingWins.length === 0) defenses.push({ move, board: afterDefense, wins: defenderWins });
      }
      if (!defenses.length) return { move: candidate.move, player: attacker, kind: "attack", terminal: "unanswerable-four", winningPoints: candidate.wins, children: [] };
      const defenseNodes: VcfProofNode[] = [];
      let refuted = false;
      for (const defense of defenses) {
        if (!tick()) return null;
        if (defense.wins) { refuted = true; break; }
        const continuation = attack(defense.board, remaining - 1);
        if (!continuation) { refuted = true; break; }
        defenseNodes.push({ move: defense.move, player: defender, kind: "defense", children: [continuation] });
      }
      if (!refuted) return { move: candidate.move, player: attacker, kind: "attack", winningPoints: candidate.wins, children: defenseNodes };
    }
    return null;
  };

  const proof = attack(cloneBoard(board), maxAttackMoves);
  const principalVariation: Array<Position & { player: Player }> = [];
  let cursor: VcfProofNode | undefined = proof || undefined;
  while (cursor) {
    principalVariation.push({ ...cursor.move, player: cursor.player });
    cursor = cursor.children.reduce<VcfProofNode | undefined>((best, child) => {
      if (!best) return child;
      const depth = (node: VcfProofNode): number => 1 + (node.children.length ? Math.max(...node.children.map(depth)) : 0);
      return depth(child) > depth(best) ? child : best;
    }, undefined);
  }
  const elapsedMs = performance.now() - started;
  return { status: proof ? "win" : stopped ? "budget" : "not-found", attacker, proof: proof || undefined, principalVariation, nodes, elapsedMs, maxAttackMoves };
}

export const proofContainsMove = (proof: VcfProofNode | undefined, position: Position): boolean => {
  if (!proof) return false;
  return samePosition(proof.move, position) || proof.children.some((child) => proofContainsMove(child, position));
};

const positionId = (position: Position) => `${position.row},${position.col}`;
const legalDefenses = (afterAttack: Cell[][], attacker: Player, rule: RuleSet) => {
  const defender = otherPlayer(attacker);
  const attackWins = winningMoves(afterAttack, attacker, rule, () => true);
  const counterWins = winningMoves(afterAttack, defender, rule, () => true);
  const candidates = [...attackWins, ...counterWins.filter((move) => !attackWins.some((item) => samePosition(item, move)))];
  return candidates.filter((move) => {
    if (!isLegalMove(afterAttack, move, defender, rule)) return false;
    if (isWinningMove(afterAttack, move, defender, rule)) return true;
    const next = cloneBoard(afterAttack); next[move.row][move.col] = defender;
    return winningMoves(next, attacker, rule, () => true).length === 0;
  });
};

/** Replays a returned proof and independently checks every attack, terminal,
 * and complete legal-defense set. UI must not label a line as proven unless
 * this verifier succeeds. */
export const verifyVcfProof = (board: Cell[][], proof: VcfProofNode | undefined, attacker: Player, rule: RuleSet): { valid: boolean; error?: string } => {
  const defender = otherPlayer(attacker);
  const verifyAttack = (state: Cell[][], node: VcfProofNode): string | null => {
    if (node.kind !== "attack" || node.player !== attacker) return "证明节点的进攻方不一致";
    if (!isLegalMove(state, node.move, attacker, rule)) return `进攻着 ${positionId(node.move)} 非法`;
    if (node.terminal === "five") return isWinningMove(state, node.move, attacker, rule) && node.children.length === 0 ? null : "五连终结节点无效";
    const afterAttack = cloneBoard(state); afterAttack[node.move.row][node.move.col] = attacker;
    const wins = winningMoves(afterAttack, attacker, rule, () => true);
    if (!wins.length) return "进攻着没有形成下一手成五点";
    const defenses = legalDefenses(afterAttack, attacker, rule);
    if (node.terminal === "unanswerable-four") return defenses.length === 0 && node.children.length === 0 ? null : "不可防四仍存在合法防点";
    const expected = new Set(defenses.map(positionId));
    const actual = new Set(node.children.map((child) => positionId(child.move)));
    if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) return "证明未覆盖全部合法防点";
    for (const defenseNode of node.children) {
      if (defenseNode.kind !== "defense" || defenseNode.player !== defender || defenseNode.children.length !== 1) return "防守节点结构无效";
      if (!isLegalMove(afterAttack, defenseNode.move, defender, rule) || isWinningMove(afterAttack, defenseNode.move, defender, rule)) return "防守方存在直接获胜反击";
      const afterDefense = cloneBoard(afterAttack); afterDefense[defenseNode.move.row][defenseNode.move.col] = defender;
      const error = verifyAttack(afterDefense, defenseNode.children[0]);
      if (error) return error;
    }
    return null;
  };
  if (!proof) return { valid: false, error: "没有证明树" };
  const error = verifyAttack(cloneBoard(board), proof);
  return error ? { valid: false, error } : { valid: true };
};
