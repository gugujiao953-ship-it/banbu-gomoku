// VCF（连续冲四胜）题目生成器 —— 独立实现，不依赖 app 状态。
// 语义：进攻方（默认黑）每手必须成四（直四/成五即终局）；防守方应手 = 堵四点 ∪ 反击冲四；
// 连珠规则下黑方受三三/四四/长连禁手约束（与 game.ts 的 evaluateRenjuMove 同语义）。
import type { Player, Position, RuleSet } from "../../types";

export type VcfRules = Extract<RuleSet, "renju" | "freestyle">;
export type VcfStone = Position & { player: Player };
export interface VcfPuzzleDraft {
  title: string;
  rules: VcfRules;
  attacker: "black";
  black: Position[];
  white: Position[];
  solution: Array<Position & { player: Player; note: string }>;
  depth: number;
}

const SIZE = 15;
export const VCF_BLACK = 1, VCF_WHITE = 2, VCF_EMPTY = 0;
const BLACK = VCF_BLACK, WHITE = VCF_WHITE, EMPTY = VCF_EMPTY;
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const idx = (row: number, col: number) => row * SIZE + col;
const inside = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
export const vcfCoordName = ({ row, col }: Position) => `${String.fromCharCode(65 + col)}${SIZE - row}`;

type Board = Int8Array;
const emptyBoard = (): Board => new Int8Array(SIZE * SIZE);

const contiguous = (board: Board, row: number, col: number, player: number, dr: number, dc: number): number[] => {
  if (board[idx(row, col)] !== player) return [];
  const line: number[] = [];
  for (let s = 1; inside(row - dr * s, col - dc * s) && board[idx(row - dr * s, col - dc * s)] === player; s += 1) line.unshift(idx(row - dr * s, col - dc * s));
  line.push(idx(row, col));
  for (let s = 1; inside(row + dr * s, col + dc * s) && board[idx(row + dr * s, col + dc * s)] === player; s += 1) line.push(idx(row + dr * s, col + dc * s));
  return line;
};

const runsAround = (board: Board, row: number, col: number, player: number) =>
  DIRECTIONS.map(([dr, dc]) => contiguous(board, row, col, player, dr, dc).length);

const fiveAt = (board: Board, row: number, col: number, player: number, rules: VcfRules) => {
  if (board[idx(row, col)] !== EMPTY) return false;
  board[idx(row, col)] = player;
  const runs = runsAround(board, row, col, player);
  board[idx(row, col)] = EMPTY;
  return rules === "renju" && player === BLACK ? runs.some((n) => n === 5) : runs.some((n) => n >= 5);
};

interface FourPattern { direction: number; stones: number[]; win: number[] }

const fourPatternsThrough = (board: Board, row: number, col: number, player: number, rules: VcfRules): FourPattern[] => {
  const patterns = new Map<string, FourPattern>();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (let off = -5; off <= 5; off += 1) {
      const wr = row + dr * off, wc = col + dc * off;
      if (!inside(wr, wc) || board[idx(wr, wc)] !== EMPTY || !fiveAt(board, wr, wc, player, rules)) continue;
      board[idx(wr, wc)] = player;
      const line = contiguous(board, wr, wc, player, dr, dc);
      board[idx(wr, wc)] = EMPTY;
      if (line.length !== 5 || !line.includes(idx(row, col))) continue;
      const stones = line.filter((i) => i !== idx(wr, wc)).sort((a, b) => a - b);
      const key = `${direction}:${stones.join("|")}`;
      const cur = patterns.get(key);
      if (cur) { if (!cur.win.includes(idx(wr, wc))) cur.win.push(idx(wr, wc)); }
      else patterns.set(key, { direction, stones, win: [idx(wr, wc)] });
    }
  });
  return [...patterns.values()];
};

const exactFiveAt = (board: Board, row: number, col: number, player: number) => runsAround(board, row, col, player).some((n) => n === 5);
const overlineAt = (board: Board, row: number, col: number, player: number) => runsAround(board, row, col, player).some((n) => n >= 6);

const openThreePatternsThrough = (board: Board, row: number, col: number, rules: VcfRules, deep = true): string[] => {
  const patterns = new Set<string>();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (let off = -4; off <= 4; off += 1) {
      const er = row + dr * off, ec = col + dc * off;
      if (!inside(er, ec) || board[idx(er, ec)] !== EMPTY) continue;
      board[idx(er, ec)] = BLACK;
      const fours = fourPatternsThrough(board, er, ec, BLACK, rules);
      let illegal = true;
      const qualifying = fours.filter((f) => f.direction === direction && f.win.length >= 2 && f.stones.includes(idx(row, col)));
      if (qualifying.length) {
        const extWins = exactFiveAt(board, er, ec, BLACK);
        illegal = overlineAt(board, er, ec, BLACK) || (!extWins && fours.length >= 2);
        if (!illegal && !extWins && deep) illegal = openThreePatternsThrough(board, er, ec, rules, false).length >= 2;
      }
      board[idx(er, ec)] = EMPTY;
      if (illegal || !qualifying.length) continue;
      for (const four of qualifying) {
        const three = four.stones.filter((i) => i !== idx(er, ec));
        if (three.length === 3 && three.includes(idx(row, col))) patterns.add(`${direction}:${three.slice().sort((a, b) => a - b).join("|")}`);
      }
    }
  });
  return [...patterns];
};

// 黑方全部合法成四手（近子剪枝；成五手/禁手排除）
export const blackFourMoves = (board: Board, rules: VcfRules): Array<{ row: number; col: number; win: number[]; open: boolean }> => {
  const freestyle = rules !== "renju";
  let hasBlack = false;
  for (let i = 0; i < board.length; i += 1) if (board[i] === BLACK) { hasBlack = true; break; }
  if (!hasBlack) return [];
  const nearBlack = (r: number, c: number) => {
    for (let dr = -4; dr <= 4; dr += 1) for (let dc = -4; dc <= 4; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[idx(rr, cc)] === BLACK) return true;
    }
    return false;
  };
  const out: Array<{ row: number; col: number; win: number[]; open: boolean }> = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY || !nearBlack(r, c)) continue;
    board[idx(r, c)] = BLACK;
    const runs = runsAround(board, r, c, BLACK);
    if (runs.some((n) => (freestyle ? n >= 5 : n === 5))) { board[idx(r, c)] = EMPTY; continue; }
    if (!freestyle && runs.some((n) => n >= 6)) { board[idx(r, c)] = EMPTY; continue; }
    const fours = fourPatternsThrough(board, r, c, BLACK, rules);
    if (!fours.length) { board[idx(r, c)] = EMPTY; continue; }
    if (!freestyle && fours.length >= 2) { board[idx(r, c)] = EMPTY; continue; } // 双四禁手
    if (!freestyle && openThreePatternsThrough(board, r, c, rules).length >= 2) { board[idx(r, c)] = EMPTY; continue; }
    board[idx(r, c)] = EMPTY;
    out.push({ row: r, col: c, win: fours[0].win.slice(), open: fours.some((f) => f.win.length >= 2) });
  }
  return out;
};

const fourMovesOf = (board: Board, player: number, rules: VcfRules) => (player === BLACK ? blackFourMoves(board, rules) : whiteFourMoves(board));

const whiteFourMoves = (board: Board) => {
  const out: Array<{ row: number; col: number; win: number[]; open: boolean }> = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY) continue;
    // 白方（无禁手）：与黑方同一套“过该点的四模式”检测。
    // 修复：旧实现要求四连 line.includes(空点 r,c) 恒为假，导致白方冲四手永远为 0（白先 VCF 全部不可解）。
    board[idx(r, c)] = WHITE;
    const fours = fourPatternsThrough(board, r, c, WHITE, "renju");
    board[idx(r, c)] = EMPTY;
    if (fours.length) out.push({ row: r, col: c, win: fours[0].win.slice(), open: fours.some((f) => f.win.length >= 2) });
  }
  return out;
};

export const vcfFivePoints = (board: Board, player: number, rules: VcfRules) => {
  const out: number[] = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY) continue;
    let near = false;
    for (let dr = -4; dr <= 4 && !near; dr += 1) for (let dc = -4; dc <= 4 && !near; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[idx(rr, cc)] === player) near = true;
    }
    if (near && fiveAt(board, r, c, player, rules)) out.push(idx(r, c));
  }
  return out;
};

export const emptyVcfBoard = emptyBoard;
export const vcfPlace = (board: Board, p: Position, player: number) => { board[idx(p.row, p.col)] = player; };

// ---------- 求解 ----------
export interface VcfSolution { win: boolean; line: Array<Position & { player: number; note: string }>; nodes: number; aborted?: boolean }

export function solveVcf(board: Board, { attacker = BLACK, rules = "renju", maxDepth = 9, timeBudget = 0 }: { attacker?: number; rules?: VcfRules; maxDepth?: number; timeBudget?: number } = {}): VcfSolution {
  const defender = attacker === BLACK ? WHITE : BLACK;
  let nodes = 0;
  let aborted = false;
  const deadline = timeBudget > 0 ? Date.now() + timeBudget : 0;
  let bestLine: Array<Position & { player: number; note: string }> | null = null;
  const path: Array<Position & { player: number; note: string }> = [];

  const fiveList = (p: number) => vcfFivePoints(board, p, rules);
  const attackerFours = () => (attacker === BLACK ? blackFourMoves(board, rules) : fourMovesOf(board, attacker, rules));

  const attack = (depth: number): boolean => {
    nodes += 1;
    if (deadline && Date.now() > deadline) { aborted = true; return false; }
    const fives = fiveList(attacker);
    if (fives.length) {
      const p = fives[0];
      path.push({ row: Math.floor(p / SIZE), col: p % SIZE, player: attacker, note: "成五" });
      bestLine = path.slice();
      path.pop();
      return true;
    }
    if (depth <= 0) return false;
    const threats = fiveList(defender);
    for (const m of attackerFours()) {
      if (m.open) {
        path.push({ row: m.row, col: m.col, player: attacker, note: "活四" });
        bestLine = path.slice();
        path.pop();
        return true;
      }
      if (threats.length && !(threats.length === 1 && m.win.includes(threats[0]))) continue;
      place(board, m, attacker);
      path.push({ row: m.row, col: m.col, player: attacker, note: "冲四" });
      const won = defend(depth, m);
      remove(board, m);
      path.pop();
      if (won) return true;
    }
    return false;
  };

  const defend = (depth: number, attackerMove: { win: number[] }): boolean => {
    nodes += 1;
    if (deadline && Date.now() > deadline) { aborted = true; return false; }
    if (fiveList(defender).length) return false;
    const replies: Array<[number, number, string]> = [];
    if (attackerMove.win.length === 1) {
      const br = Math.floor(attackerMove.win[0] / SIZE), bc = attackerMove.win[0] % SIZE;
      if (defender === BLACK) {
        const legality = evaluateBlackLegality(board, br, bc);
        if (legality) replies.push([br, bc, "堵四"]);
      } else replies.push([br, bc, "堵四"]);
    } else return true;
    for (const cf of fourMovesOf(board, defender, rules)) {
      // 连珠下防守方为黑时，反击四手也必须合法（不能是三三/四四/长连禁手点）
      if (defender === BLACK && rules === "renju" && !blackMoveLegal(board, cf.row, cf.col)) continue;
      replies.push([cf.row, cf.col, "反击四"]);
    }
    if (!replies.length) return true;
    for (const [rr, cc, note] of replies) {
      place(board, { row: rr, col: cc }, defender);
      path.push({ row: rr, col: cc, player: defender, note });
      const survived = attack(depth - 1);
      remove(board, { row: rr, col: cc });
      path.pop();
      if (!survived) return false;
    }
    return true;
  };

  const started = Date.now();
  const win = attack(maxDepth);
  void started;
  return { win, line: bestLine || [], nodes, aborted };
}

const place = (board: Board, p: Position, player: number) => { board[idx(p.row, p.col)] = player; };
const remove = (board: Board, p: Position) => { board[idx(p.row, p.col)] = EMPTY; };

// 独立复核器（与求解器不同路径，逐手重放）。
// line 的 player 同时接受应用层 Player（"black"/"white"）与求解器数字（1/2），内部归一化为棋盘数值。
export function verifyVcfLine(puzzle: { rules: VcfRules; attacker: Player; black: Position[]; white: Position[]; line: Array<Position & { player: Player | number }> }): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const fail = (msg: string) => { failures.push(msg); };
  const board = emptyBoard();
  for (const s of puzzle.black) {
    if (board[idx(s.row, s.col)] !== EMPTY) fail(`开局黑子重叠 ${s.row},${s.col}`);
    board[idx(s.row, s.col)] = BLACK;
  }
  for (const s of puzzle.white) {
    if (board[idx(s.row, s.col)] !== EMPTY) fail(`开局白子重叠 ${s.row},${s.col}`);
    board[idx(s.row, s.col)] = WHITE;
  }
  const attacker = puzzle.attacker === "white" ? WHITE : BLACK;
  const defender = attacker === BLACK ? WHITE : BLACK;
  const cellOf = (p: Player | number): number => (p === "black" || p === BLACK ? BLACK : WHITE);
  const moves = puzzle.line;
  const name = (p: Position) => `${String.fromCharCode(65 + p.col)}${SIZE - p.row}`;
  let solved = false;
  if (!moves.length) fail("正解为空");
  if (moves.length && cellOf(moves[0].player) !== attacker) fail("正解第一手不是进攻方");
  for (let i = 0; i < moves.length && !failures.length && !solved; i += 2) {
    const m = moves[i];
    if (cellOf(m.player) !== attacker) { fail(`第 ${i + 1} 手应由进攻方行棋`); break; }
    if (board[idx(m.row, m.col)] !== EMPTY) { fail(`第 ${i + 1} 手落在已占点 ${name(m)}`); break; }
    if (vcfFivePoints(board, attacker, puzzle.rules).includes(idx(m.row, m.col))) {
      place(board, m, attacker);
      solved = true;
      break;
    }
    let four: { win: number[] } | undefined;
    if (attacker === BLACK && puzzle.rules === "renju") {
      const legality = evaluateBlackLegality(board, m.row, m.col);
      if (!legality) { fail(`第 ${i + 1} 手黑方禁手`); break; }
      four = blackFourMoves(board, puzzle.rules).find((f) => f.row === m.row && f.col === m.col);
      if (!four) { fail(`第 ${i + 1} 手 ${name(m)} 不是冲四`); break; }
    } else {
      four = fourMovesOf(board, attacker, puzzle.rules).find((f) => f.row === m.row && f.col === m.col);
      if (!four) { fail(`第 ${i + 1} 手 ${name(m)} 不是冲四`); break; }
    }
    place(board, m, attacker);
    if (four.win.length >= 2) { solved = true; break; }
    const next = moves[i + 1];
    if (!next) { fail(`第 ${i + 1} 手后无防守应手且未成胜势`); break; }
    if (cellOf(next.player) !== defender) { fail(`第 ${i + 2} 手应由防守方行棋`); break; }
    if (vcfFivePoints(board, defender, puzzle.rules).length) { fail(`第 ${i + 1} 手后防守方自已成五，进攻链不成立`); break; }
    const isBlock = four.win.length === 1 && next.row === Math.floor(four.win[0] / SIZE) && next.col === four.win[0] % SIZE;
    if (isBlock && defender === BLACK && puzzle.rules === "renju" && !evaluateBlackLegality(board, next.row, next.col)) {
      fail(`第 ${i + 2} 手堵四点为黑方禁手，正解不成立`);
      break;
    }
    let counter = fourMovesOf(board, defender, puzzle.rules).find((f) => f.row === next.row && f.col === next.col);
    // 连珠下防守方为黑：反击四点若是禁手点，则该“反击”不合法（视为非反击四）
    if (counter && defender === BLACK && puzzle.rules === "renju" && !blackMoveLegal(board, next.row, next.col)) counter = undefined;
    if (!isBlock && !counter) { fail(`第 ${i + 2} 手 ${name(next)} 既非堵四也非反击四`); break; }
    place(board, next, defender);
    if (counter && !isBlock) {
      const after = moves[i + 2];
      if (!after) { fail(`第 ${i + 2} 手反击四后正解缺少应对`); break; }
      const dWin = vcfFivePoints(board, defender, puzzle.rules);
      if (dWin.length) {
        const aWin = vcfFivePoints(board, attacker, puzzle.rules);
        const blocks = dWin.length === 1 && after.row === Math.floor(dWin[0] / SIZE) && after.col === dWin[0] % SIZE;
        const winsNow = aWin.includes(idx(after.row, after.col));
        if (!winsNow && !blocks) { fail(`第 ${i + 3} 手未处理防守方反击四`); break; }
      }
    }
  }
  if (!failures.length && !solved) fail("正解结束但未形成胜势");
  return { ok: failures.length === 0 && solved, failures };
}

// 黑手合法性（连珠禁手；freestyle 全合法）
export const blackMoveLegal = (board: Board, row: number, col: number): boolean => evaluateBlackLegality(board, row, col);
const evaluateBlackLegality = (board: Board, row: number, col: number): boolean => {
  board[idx(row, col)] = BLACK;
  const runs = runsAround(board, row, col, BLACK);
  const exactFive = runs.some((n) => n === 5);
  const overline = runs.some((n) => n >= 6);
  let legal: boolean;
  if (exactFive) legal = true;
  else if (overline) legal = false;
  else {
    const fours = fourPatternsThrough(board, row, col, BLACK, "renju");
    if (fours.length >= 2) legal = false;
    else legal = openThreePatternsThrough(board, row, col, "renju").length < 2;
  }
  board[idx(row, col)] = EMPTY;
  return legal;
};

// ---------- 生成（线基构造） ----------
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const areaFree = (board: Board, cells: Array<[number, number]>) => {
  for (const [r, c] of cells) {
    if (!inside(r, c) || board[idx(r, c)] !== EMPTY) return false;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[idx(rr, cc)] !== EMPTY) return false;
    }
  }
  return true;
};

const lineCells = (r0: number, c0: number, dr: number, dc: number, n: number): Array<[number, number]> | null => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const r = r0 + dr * i, c = c0 + dc * i;
    if (!inside(r, c)) return null;
    out.push([r, c]);
  }
  return out;
};

function constructLines(rnd: () => number, rules: VcfRules, k: number): { board: Board; black: Position[]; white: Position[] } | null {
  for (let tries = 0; tries < 80; tries += 1) {
    const board = emptyBoard();
    const black: Position[] = [], white: Position[] = [];
    let ok = true;
    const dirs = DIRECTIONS;
    for (let i = 0; i < k - 1 && ok; i += 1) {
      let committed = false;
      for (let t = 0; t < 60 && !committed; t += 1) {
        const [dr, dc] = dirs[Math.floor(rnd() * 4)];
        const r0 = Math.floor(rnd() * SIZE), c0 = Math.floor(rnd() * SIZE);
        const cells = lineCells(r0, c0, dr, dc, 6);
        if (!cells || !areaFree(board, cells)) continue;
        place(board, { row: cells[0][0], col: cells[0][1] }, WHITE); white.push({ row: cells[0][0], col: cells[0][1] });
        for (let j = 1; j <= 3; j += 1) { place(board, { row: cells[j][0], col: cells[j][1] }, BLACK); black.push({ row: cells[j][0], col: cells[j][1] }); }
        committed = true;
      }
      if (!committed) ok = false;
    }
    if (!ok) continue;
    let finalOk = false;
    for (let t = 0; t < 60 && !finalOk; t += 1) {
      const [dr, dc] = dirs[Math.floor(rnd() * 4)];
      const r0 = Math.floor(rnd() * SIZE), c0 = Math.floor(rnd() * SIZE);
      const cells = lineCells(r0, c0, dr, dc, 5);
      if (!cells || !areaFree(board, cells)) continue;
      for (let j = 1; j <= 3; j += 1) { place(board, { row: cells[j][0], col: cells[j][1] }, BLACK); black.push({ row: cells[j][0], col: cells[j][1] }); }
      finalOk = true;
    }
    if (!finalOk) continue;
    if (vcfFivePoints(board, BLACK, rules).length) continue;
    return { board, black, white };
  }
  return null;
}

const makeTransform = (rnd: () => number) => {
  const rotate = Math.floor(rnd() * 4);
  const mirror = rnd() < 0.5;
  return (p: Position): Position => {
    let r = p.row, c = p.col;
    for (let i = 0; i < rotate; i += 1) { const nr = c, nc = SIZE - 1 - r; r = nr; c = nc; }
    if (mirror) c = SIZE - 1 - c;
    return { row: r, col: c };
  };
};

export interface VcfGenerateOptions { minDepth: number; maxDepth: number; rules: VcfRules; seed: number }
export interface VcfPuzzle { title: string; rules: VcfRules; black: Position[]; white: Position[]; solution: Array<Position & { player: Player; note: string }>; depth: number; nodes: number }

// 生成器：每次 next() 尝试构造一个局面；yield 一次 = 一次尝试（供 UI 分批消费）
export function* generateVcfPuzzles(options: VcfGenerateOptions): Generator<{ attempts: number; puzzle?: VcfPuzzle }, void, void> {
  const rnd = mulberry32(options.seed);
  let attempts = 0;
  let made = 0;
  while (made < Number.POSITIVE_INFINITY) {
    attempts += 1;
    const k = options.minDepth + Math.floor(rnd() * (options.maxDepth - options.minDepth + 1));
    const boot = constructLines(rnd, options.rules, k);
    if (!boot) { yield { attempts }; continue; }
    const board = boot.board;
    const black = boot.black.slice(), white = boot.white.slice();
    if (vcfFivePoints(board, BLACK, options.rules).length) { yield { attempts }; continue; }
    const sol = solveVcf(board, { attacker: BLACK, rules: options.rules, maxDepth: k + 1 });
    if (!sol.win) { yield { attempts }; continue; }
    const attackerMoves = sol.line.filter((m) => m.player === BLACK);
    if (attackerMoves.length < options.minDepth || attackerMoves.length > options.maxDepth) { yield { attempts }; continue; }
    const solution = sol.line.map((m) => ({ row: m.row, col: m.col, player: (m.player === BLACK ? "black" : "white") as Player, note: m.note }));
    const check = verifyVcfLine({ rules: options.rules, attacker: "black", black, white, line: solution.map((m) => ({ row: m.row, col: m.col, player: m.player })) });
    if (!check.ok) { yield { attempts }; continue; }
    const t = makeTransform(rnd);
    const tp = (p: Position): Position => t(p);
    made += 1;
    yield {
      attempts,
      puzzle: {
        title: `VCF ${attackerMoves.length} 手题 · ${options.rules === "renju" ? "连珠有禁" : "无禁手"}`,
        rules: options.rules,
        black: black.map(tp),
        white: white.map(tp),
        solution: solution.map((m) => ({ ...tp(m), player: m.player, note: m.note })),
        depth: attackerMoves.length,
        nodes: sol.nodes,
      },
    };
  }
}
