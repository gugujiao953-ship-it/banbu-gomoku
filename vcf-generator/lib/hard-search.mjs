import { Board, BudgetExceeded, budget, other } from './board.mjs';
import { solve } from './solve.mjs';
import { analyzeDifficulty } from './difficulty.mjs';

export function meetsHardDifficulty(difficulty, depth) {
  return difficulty.status === 'complete' && difficulty.secondLines === 0 &&
    difficulty.rootTrapDepth >= 3 && difficulty.deepTurns >= Math.ceil(depth * .35) &&
    difficulty.decisionTurns >= Math.ceil(depth * .7) && difficulty.states >= 40;
}

export function positionGeometry(board) {
  const occupied = [...board.cells.keys()].filter(at => board.cells[at]);
  let top = board.size, left = board.size, bottom = 0, right = 0, components = 0;
  const unseen = new Set(occupied);
  for (const at of occupied) {
    const row = Math.floor(at / board.size), col = at % board.size;
    top = Math.min(top, row); bottom = Math.max(bottom, row);
    left = Math.min(left, col); right = Math.max(right, col);
    if (!unseen.delete(at)) continue;
    components++;
    const stack = [at];
    while (stack.length) {
      const q = stack.pop(), r = Math.floor(q / board.size), c = q % board.size;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const next = board.index(r + dr, c + dc);
        if (next >= 0 && unseen.delete(next)) stack.push(next);
      }
    }
  }
  const span = Math.max(bottom - top + 1, right - left + 1);
  const density = occupied.length / ((bottom - top + 1) * (right - left + 1));
  return { occupied, top, left, bottom, right, components, span, density };
}

export function meetsHardPosition(difficulty, geometry, depth) {
  return meetsHardDifficulty(difficulty, depth) &&
    difficulty.rows.filter(row => row.trapDepth >= 2).length >= Math.ceil(depth * .7) &&
    geometry.span <= 11 && geometry.components <= 3 &&
    geometry.density >= .32 && geometry.density <= .65;
}

// Change complete original positions, not just the preselected solution path.
// Every retained mutation preserves side-to-move, exact depth and unique root.
// Returning null means no qualifying candidate; the caller must not substitute
// an easier puzzle. The caller rebuilds all certificates and independently
// verifies the final board before publishing it.
export function searchHardPosition(initial, initialResult, attacker, {
  rule = 'renju', depth, rng, timeMs = 5000, signal, maxIterations = 20000, minimumEats = 0,
} = {}) {
  const guard = budget({ timeMs, signal });
  const remaining = cap => { guard.check(); return Math.min(cap, timeMs - guard.elapsedMs); };
  const evaluate = (board, result) => {
    const difficulty = analyzeDifficulty(board, attacker, result.proof, {
      rule, timeMs: remaining(60), nodeLimit: 10000, signal,
    });
    if (difficulty.status !== 'complete') return null;
    const geometry = positionGeometry(board);
    const rank = -difficulty.secondLines * 1000 + difficulty.deepTurns * 100 +
      Math.min(10, difficulty.rootTrapDepth) * 30 + Math.log2(1 + difficulty.states) * 20 +
      difficulty.eats * 20 - Math.max(0, geometry.span - 10) * 20 -
      Math.max(0, geometry.components - 3) * 12 - geometry.occupied.length * .3;
    const qualified = meetsHardPosition(difficulty, geometry, depth) && difficulty.eats >= minimumEats;
    return { board, result, difficulty, geometry, rank, qualified };
  };
  let current = null, best = null, iterations = 0, accepted = 0;
  try {
    current = evaluate(new Board(initial.size, initial.cells), initialResult);
    if (!current) return null;
    if (current.qualified) best = current;
    for (; iterations < maxIterations; iterations++) {
      guard.check();
      const trial = new Board(initial.size, current.board.cells), { occupied, top, bottom, left, right } = current.geometry;
      const free = [...trial.cells.keys()].filter(at => !trial.cells[at] &&
        Math.floor(at / trial.size) >= Math.max(1, top) && Math.floor(at / trial.size) <= Math.min(trial.size - 2, bottom) &&
        at % trial.size >= Math.max(1, left) && at % trial.size <= Math.min(trial.size - 2, right));
      if (free.length < 2) break;
      const pick = xs => xs[Math.floor(rng() * xs.length)];
      const roll = rng();
      if (roll < .18 && occupied.length < 54) {
        const a = pick(free), b = pick(free.filter(at => at !== a));
        trial.put(a, attacker); trial.put(b, other(attacker));
      } else if (roll < .33 && occupied.length > 20) {
        for (const player of [1, 2]) trial.undo(pick(occupied.filter(at => trial.cells[at] === player)));
      } else if (roll < .55) {
        const a = pick(occupied.filter(at => trial.cells[at] === 1)), b = pick(occupied.filter(at => trial.cells[at] === 2));
        trial.undo(a); trial.undo(b); trial.put(a, 2); trial.put(b, 1);
      } else {
        const player = rng() < .65 ? attacker : other(attacker);
        trial.undo(pick(occupied.filter(at => trial.cells[at] === player))); trial.put(pick(free), player);
      }
      if (trial.hasFive() || trial.winningPoints(1, rule, guard).length || trial.winningPoints(2, rule, guard).length) continue;
      const result = solve(trial, attacker, {
        rule, maxDepth: depth, enumerateFirst: true, timeMs: remaining(20), nodeLimit: 10000, signal,
      });
      if (result.status !== 'win' || result.depth !== depth || result.winningFirst.length !== 1) continue;
      const candidate = evaluate(trial, result);
      if (!candidate) continue;
      if (candidate.qualified && (!best || candidate.rank > best.rank)) best = candidate;
      if (candidate.rank > current.rank || candidate.rank === current.rank && rng() < .7 || rng() < .015) {
        current = candidate; accepted++;
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
  }
  if (signal?.aborted || !best) return null;
  return { ...best, iterations, accepted, elapsedMs: guard.elapsedMs };
}
