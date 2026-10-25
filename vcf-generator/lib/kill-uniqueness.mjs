// 「唯一杀法」判定器（R49 新模块）。
//
// 为什么要有它：真人 VCF 题的"唯一"从来不是"唯一首手"——同一套棋形经常有好几个能赢的首手，
// 但它们本质是同一个杀法、通往同一个终局（用户 2026-10-08 的定义）。现行验收里的
// `solve(...).winningFirst.length === 1` 是"≤maxDepth 内任意赢法的首手唯一"，既比棋书严格
// （实测真人局面只有 20.8% 合格），又不是"唯一解"的正确单位（同深度下 78.3% 才是唯一杀法）。
//
// 本模块只做判定，不替代任何验收：solve／verify／decoyAudit 全部照旧，各自仍按自己的口径把关。
import { Board, other } from './board.mjs';
import { solve, principalVariation } from './solve.mjs';

const cellsOf = board => Uint8Array.from(board.cells);

// 走完一条首手的强制线，返回终局盘面（攻方落定最后一击后的占位快照）；走不通返回 null。
// 终局有三种：末手直接成五／留出守方堵不住的双成五点（活四、双四、四三）／堵点本身非法。
export function routeTerminal(board, attacker, first, remaining, rule = 'renju') {
  const defender = other(attacker);
  if (!(first >= 0 && first < board.cells.length) || board.cells[first]) return null;
  const after = board.withMove(first, attacker, () => {
    if (board.wonAt(first, attacker, rule)) return cellsOf(board);
    const wins = board.winningPoints(attacker, rule);
    if (wins.length >= 2) return cellsOf(board);
    if (wins.length === 0) return null;
    if (!board.legal(wins[0], defender, rule)) return cellsOf(board);
    return null;
  });
  if (after) return { cells: after, depth: 1 };
  // 需要继续往下走：落上守方唯一的堵点，再交给精确求解器找剩下的强制线。
  const mid = new Board(board.size, cellsOf(board));
  mid.put(first, attacker);
  const block = mid.winningPoints(attacker, rule)[0];
  if (block === undefined || !mid.legal(block, defender, rule)) return null;
  mid.put(block, defender);
  const rest = solve(new Board(board.size, cellsOf(mid)), attacker, { rule, maxDepth: remaining - 1, timeMs: 3000, enumerateFirst: false });
  if (rest.status !== 'win') return null;
  const line = principalVariation(new Board(board.size, cellsOf(mid)), attacker, rest.proof, rule);
  const tail = new Board(board.size, cellsOf(mid));
  for (const m of line) {
    if (m.at === null) continue;
    if (tail.cells[m.at] || !tail.legal(m.at, m.player, rule)) return null;
    tail.put(m.at, m.player);
  }
  return { cells: cellsOf(tail), depth: 1 + rest.depth };
}

// 主入口：返回 { status, depth, firsts, terminals, uniqueKill, uniqueFirstShortest, uniqueFirstAny }
//  - depth：最短获胜深度（攻方手数，含最后一击）
//  - firstsAny：≤maxDepth 内任意赢法的首手（＝现行硬门的口径，仅供对照）
//  - firsts：最短获胜深度内的获胜首手（棋书口径"找最快赢法"）
//  - uniqueKill：这些首手是否全部通往同一终局（＝用户定义的"唯一杀法"）
export function killClass(board, attacker, { rule = 'renju', maxDepth = 12, timeMs = 4000 } = {}) {
  if (board.hasFive()) return { status: 'already-five' };
  const wide = solve(board, attacker, { rule, maxDepth, timeMs, enumerateFirst: true });
  if (wide.status !== 'win') return { status: wide.status === 'budget' ? 'budget' : 'no-win' };
  const depth = wide.depth;
  const exact = solve(board, attacker, { rule, maxDepth: depth, timeMs, enumerateFirst: true });
  const firsts = (exact.winningFirst || []).slice().sort((a, b) => a - b);
  const terminals = new Map();
  for (const f of firsts) {
    const t = routeTerminal(board, attacker, f, depth, rule);
    if (!t) { terminals.set('unresolved:' + f, [f]); continue; }
    const key = t.cells.join('');
    if (!terminals.has(key)) terminals.set(key, []);
    terminals.get(key).push(f);
  }
  const resolved = [...terminals.keys()].filter(k => !k.startsWith('unresolved:'));
  const uniqueKill = resolved.length === 1 && terminals.size === 1 && firsts.length >= 1;
  return {
    status: 'win', depth, firsts,
    firstsAny: (wide.winningFirst || []).slice().sort((a, b) => a - b),
    terminalGroups: resolved.map(key => ({ terminal: key, firsts: terminals.get(key) })),
    unresolved: [...terminals.keys()].filter(k => k.startsWith('unresolved:')).map(k => +k.slice(11)),
    uniqueKill, uniqueFirstShortest: firsts.length === 1, uniqueFirstAny: (wide.winningFirst || []).length === 1,
  };
}
