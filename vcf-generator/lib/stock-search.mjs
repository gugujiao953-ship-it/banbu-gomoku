import { Board, BLACK, WHITE, AXES, BudgetExceeded, budget, other } from './board.mjs';
import { solve } from './solve.mjs';
import { analyzeDifficulty } from './difficulty.mjs';
import { positionGeometry, meetsHardPosition, searchHardPosition } from './hard-search.mjs';

// A future black stock point is initially a double four. The preceding white
// block destroys its second four, making it legal. This orders independent
// diagram threes without requiring every four to borrow the preceding black
// attack. This construction applies only to black under Renju rules.
function buildStock(rng, guard, nodeLimit) {
  const board = new Board(15), reserved = new Set(), path = [], blocks = [];
  let nodes = 0;
  const index = (r, c) => r >= 2 && r <= 12 && c >= 2 && c <= 12 ? r * 15 + c : -1;
  const shuffle = values => values.map(value => ({ value, order: rng() }))
    .sort((a, b) => a.order - b.order).map(item => item.value);
  const place = assignments => {
    guard.check();
    const unique = new Map();
    for (const [at, player] of assignments) {
      if (at < 0 || unique.has(at) && unique.get(at) !== player) return null;
      unique.set(at, player);
    }
    for (const [at, player] of unique) {
      if (board.cells[at] ? board.cells[at] !== player : reserved.has(at) && player) return null;
    }
    const added = [], holes = [];
    for (const [at, player] of unique) {
      if (player && !board.cells[at]) { board.put(at, player); added.push(at); }
      else if (!player && !reserved.has(at)) { reserved.add(at); holes.push(at); }
    }
    const undo = () => { for (const at of added) board.undo(at); for (const at of holes) reserved.delete(at); };
    if (added.some(at => board.incidence[at].some(w => board.counts[board.cells[at]][w] >= 4 && !board.counts[other(board.cells[at])][w]))) {
      undo(); return null;
    }
    const candidates = new Set();
    for (const at of added) for (const w of board.incidence[at]) {
      if (board.counts[BLACK][w] === 3 && !board.counts[WHITE][w]) {
        for (const q of board.windows[w]) if (!board.cells[q]) candidates.add(q);
      }
    }
    // A raw open four may be intentionally forbidden. Only a legal one is a
    // premature finish. The exact solver later also checks indirect shortcuts.
    for (const at of candidates) {
      if (board.legal(at, BLACK, 'renju', guard) && board.withMove(at, BLACK,
        () => board.fourGroups(at, BLACK, 'renju').some(g => g.wins.length >= 2))) {
        undo(); return null;
      }
    }
    return undo;
  };
  const validPrefix = final => replayStock({ board, path, blocks }, guard, final);
  const finish = (at, inhibitionAxis) => {
    const r = Math.floor(at / 15), c = at % 15;
    for (const axis of shuffle([0, 1, 2, 3].filter(axis => axis !== inhibitionAxis))) {
      const [dr, dc] = AXES[axis];
      // A broken three has just one extension to an open four. Contiguous
      // threes would introduce a second extension requiring a second lock.
      for (const offset of shuffle([1, 2])) {
        guard.check();
        const core = Array.from({ length: 4 }, (_, k) => index(r + (k - offset) * dr, c + (k - offset) * dc));
        if (core.some(q => q < 0 || path.includes(q))) continue;
        const ends = [index(r + (-1 - offset) * dr, c + (-1 - offset) * dc), index(r + (4 - offset) * dr, c + (4 - offset) * dc)];
        const undo = place([...core.map(q => [q, q === at ? 0 : BLACK]), ...ends.map(q => [q, 0])]);
        if (!undo) continue;
        path.push(at);
        if (validPrefix(true) && path.slice(1).every(q => !board.legal(q, BLACK, 'renju', guard))) return true;
        path.pop(); undo();
      }
    }
    return false;
  };
  const stock = (at, stage, inhibitionAxis = -1) => {
    guard.check();
    if (++nodes > nodeLimit) return false;
    if (stage === 4) return finish(at, inhibitionAxis);
    const r = Math.floor(at / 15), c = at % 15;
    const options = shuffle(AXES.flatMap(([dr, dc], axis) => [1, 2, 3].flatMap(offset =>
      [-1, 1].map(sign => ({ dr: dr * sign, dc: dc * sign, axis, offset })))));
    for (const { dr, dc, axis, offset } of options) {
      guard.check();
      if (axis === inhibitionAxis) continue;
      const line = Array.from({ length: 5 }, (_, k) => index(r + (k - offset) * dr, c + (k - offset) * dc));
      const reply = line[4], back = index(r + (-1 - offset) * dr, c + (-1 - offset) * dc);
      if (reply < 0 || reserved.has(reply) || board.cells[reply]) continue;
      const undo = place([...line.map(q => [q, q === at || q === reply ? 0 : BLACK]), [back, WHITE]]);
      if (!undo) continue;
      path.push(at); blocks.push(reply);
      if (validPrefix(false) && lock(reply, stage + 1)) return true;
      path.pop(); blocks.pop(); undo();
      if (nodes > nodeLimit) break;
    }
    return false;
  };
  const lock = (reply, stage) => {
    const r = Math.floor(reply / 15), c = reply % 15;
    const options = shuffle(AXES.flatMap(([dr, dc], axis) => [0, 1, 2, 3, 4].flatMap(offset =>
      [0, 1, 2, 3, 4].filter(hole => hole !== offset).map(hole => ({ dr, dc, axis, offset, hole })))));
    for (const { dr, dc, axis, offset, hole } of options) {
      guard.check();
      if (nodes > nodeLimit) return false;
      const line = Array.from({ length: 5 }, (_, k) => index(r + (k - offset) * dr, c + (k - offset) * dc)), at = line[hole];
      if (at < 0 || reserved.has(at) || board.cells[at]) continue;
      const ends = [index(r + (-1 - offset) * dr, c + (-1 - offset) * dc), index(r + (5 - offset) * dr, c + (5 - offset) * dc)];
      const undo = place([...line.map(q => [q, q === reply || q === at ? 0 : BLACK]), ...ends.map(q => [q, WHITE])]);
      if (!undo) continue;
      if (stock(at, stage, axis)) return true;
      undo();
    }
    return false;
  };
  return stock(7 * 15 + 7, 0) ? { board, reserved, path, blocks, nodes } : null;
}

function replayStock(candidate, guard, final = true) {
  const board = new Board(15, candidate.board.cells), { path, blocks } = candidate;
  for (let i = 0; i < path.length; i++) {
    guard.check();
    if (!board.legal(path[i], BLACK, 'renju', guard)) return false;
    board.put(path[i], BLACK);
    if (board.winningPoints(WHITE, 'renju', guard).length) return false;
    const wins = board.winningPoints(BLACK, 'renju', guard);
    if (final && i === path.length - 1) return wins.length >= 2;
    if (wins.length !== 1 || wins[0] !== blocks[i]) return false;
    board.put(wins[0], WHITE);
  }
  return true;
}

// Find a genuine alternative win at any turn, allowing play until the board
// fills. Solving only to the requested six moves would miss longer wins.
function alternateWin(candidate, guard, remaining) {
  const board = new Board(15, candidate.board.cells);
  try {
    for (let i = 0; i < candidate.path.length; i++) {
      guard.check();
      // Repair only bounded shortcuts. The final full analyzeDifficulty pass
      // independently checks longer alternatives, so a timeout here can never
      // certify a candidate as hard.
      const result = solve(board, BLACK, { rule: 'renju', maxDepth: 6,
        enumerateFirst: true, timeMs: remaining(120), nodeLimit: 30000 });
      if (result.status === 'budget') return { unknown: true };
      if (result.status !== 'win') return { unknown: true };
      const at = result.winningFirst.find(q => q !== candidate.path[i]);
      if (at !== undefined) return { at, turn: i + 1, line: [{ at, player: BLACK }] };
      board.put(candidate.path[i], BLACK);
      if (i < candidate.blocks.length) board.put(candidate.blocks[i], WHITE);
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { unknown: true };
  }
  return null;
}

function eliminateWins(candidate, guard, remaining, diagnostics) {
  for (let i = 0; i < 35; i++) {
    guard.check();
    const alternative = alternateWin(candidate, guard, remaining);
    if (!alternative) return true;
    if (alternative.unknown) { diagnostics.unproven++; return false; }
    let changed = false;
    // Occupy the tempting entrance when possible. This refutes the shortcut
    // while preserving the planned route and its reserved holes.
    // A proof is not needed for the repair: any alternative bounded win is
    // enough to choose a later attack point as a white anti-shortcut stone.
    for (const move of (alternative.line || []).filter(m => m.player === BLACK && m.at !== null).reverse()) {
      const at = move.at, r = Math.floor(at / 15), c = at % 15;
      if (candidate.board.cells[at] || candidate.reserved.has(at) || r < 2 || r > 12 || c < 2 || c > 12) continue;
      candidate.board.put(at, WHITE);
      if (replayStock(candidate, guard) && !candidate.board.winningPoints(WHITE, 'renju', guard).length) { changed = true; break; }
      candidate.board.undo(at);
    }
    if (!changed) { diagnostics.unblockable++; return false; }
  }
  diagnostics.unproven++;
  return false;
}

function balanceStock(candidate, rng, guard) {
  const board = candidate.board;
  const difference = board.cells.filter(p => p === BLACK).length - board.cells.filter(p => p === WHITE).length;
  const player = difference >= 0 ? WHITE : BLACK;
  let left = Math.abs(difference);
  const free = [...board.cells.keys()].filter(at => !board.cells[at] && !candidate.reserved.has(at) &&
    Math.floor(at / 15) >= 2 && Math.floor(at / 15) <= 12 && at % 15 >= 2 && at % 15 <= 12);
  const neighbours = at => {
    let n = 0; const r = Math.floor(at / 15), c = at % 15;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const q = board.index(r + dr, c + dc); if (q >= 0 && board.cells[q]) n++;
    }
    return n;
  };
  const ordered = free.map(at => ({ at, rank: neighbours(at) + rng() * 2 })).sort((a, b) => b.rank - a.rank);
  for (const { at } of ordered) {
    guard.check();
    if (!left) break;
    board.put(at, player);
    if (!replayStock(candidate, guard) || board.winningPoints(WHITE, 'renju', guard).length ||
      board.winningPoints(BLACK, 'renju', guard).length) { board.undo(at); continue; }
    left--;
  }
  return left === 0;
}

// Experimental, deliberately narrow: an original six-move black Renju
// position. Return only a fully analysed hard board, never a simpler fallback.
// The caller must still rebuild certificates and run the independent verifier.
export function searchStockPosition({ rng, timeMs = 30000, signal, maxAttempts = 100,
  constructionNodes = 3000, onProgress = () => {} } = {}) {
  const guard = budget({ timeMs, signal }), diagnostics = {
    attempts: 0, constructed: 0, repaired: 0, balanced: 0, exact: 0, global: 0, unproven: 0, unblockable: 0,
  };
  const remaining = cap => { guard.check(); return Math.min(cap, timeMs - guard.elapsedMs); };
  try {
    for (; diagnostics.attempts < maxAttempts; diagnostics.attempts++) {
      guard.check();
      onProgress({ ...diagnostics });
      // Restart hard geometry rather than allowing one layout to consume all
      // of a request. Both this local guard and every solve share the deadline.
      let candidate;
      try { candidate = buildStock(rng, budget({ timeMs: remaining(700), signal }), constructionNodes); }
      catch (error) { if (!(error instanceof BudgetExceeded)) throw error; continue; }
      if (!candidate) continue;
      diagnostics.constructed++;
      let repaired = false;
      for (let cycle = 0; cycle < 3; cycle++) {
        if (!eliminateWins(candidate, guard, remaining, diagnostics)) break;
        diagnostics.repaired++;
        if (!balanceStock(candidate, rng, guard)) break;
        diagnostics.balanced++;
        const alternative = alternateWin(candidate, guard, remaining);
        if (!alternative) { repaired = true; break; }
        if (alternative.unknown) { diagnostics.unproven++; break; }
      }
      if (!repaired) continue;
      const result = solve(candidate.board, BLACK, { rule: 'renju', maxDepth: 6,
        enumerateFirst: true, timeMs: remaining(300), nodeLimit: 50000, signal });
      if (result.status !== 'win' || result.depth !== 6 || result.winningFirst.length !== 1) continue;
      diagnostics.exact++;
      const difficulty = analyzeDifficulty(candidate.board, BLACK, result.proof, {
        rule: 'renju', timeMs: remaining(500), nodeLimit: 100000, signal,
      });
      if (difficulty.status !== 'complete' || difficulty.secondLines || difficulty.eats < 2) continue;
      diagnostics.global++;
      const geometry = positionGeometry(candidate.board);
      let hard = { board: candidate.board, result, difficulty, geometry, iterations: 0, accepted: 0, elapsedMs: 0 };
      if (!meetsHardPosition(difficulty, geometry, 6)) {
        hard = searchHardPosition(candidate.board, result, BLACK, { rule: 'renju', depth: 6, rng,
          timeMs: remaining(3000), minimumEats: 2, signal });
      }
      if (hard) {
        guard.check();
        return { ...hard, path: candidate.path, nodes: candidate.nodes,
          stockSearch: { ...diagnostics, attempts: diagnostics.attempts + 1, elapsedMs: guard.elapsedMs } };
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
  }
  return null;
}
