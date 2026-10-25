import { Board, BudgetExceeded, budget, other } from './board.mjs';
import { principalVariation } from './solve.mjs';

// Explore wrong continuations until they actually fail, without cutting them
// off at the requested solution length. A longer winning line is not a trap.
// Cache complete positions so independent move orders are counted once.
export function analyzeDifficulty(initial, attacker, proof, {
  rule = 'renju', timeMs = 1000, nodeLimit = 30000, signal,
} = {}) {
  const guard = budget({ timeMs, nodeLimit, signal });
  const board = new Board(initial.size, initial.cells), defender = other(attacker);
  const memo = new Map(), line = principalVariation(initial, attacker, proof, rule);
  const rows = [];
  const search = () => {
    guard.check();
    const key = board.key();
    if (memo.has(key)) return memo.get(key);
    guard.tick();
    if (board.winningPoints(attacker, rule, guard).length) return { win: true, length: 1 };
    let length = 0, line = [];
    for (const move of board.forcingMoves(attacker, rule, guard)) {
      const sub = follow(move);
      if (sub.win) { memo.set(key, sub); return sub; }
      if (sub.length > length) { length = sub.length; line = sub.line; }
    }
    const result = { win: false, length, line };
    memo.set(key, result);
    return result;
  };
  const follow = move => board.withMove(move.at, attacker, () => {
    if (move.five) return { win: true, length: 1 };
    if (board.winningPoints(defender, rule, guard).length) return { win: false, length: 0, line: [] };
    const wins = board.winningPoints(attacker, rule, guard);
    if (wins.length > 1 || !board.legal(wins[0], defender, rule, guard)) return { win: true, length: 2 };
    const sub = board.withMove(wins[0], defender, search);
    return { win: sub.win, length: 1 + sub.length,
      ...(!sub.win ? { line: [{ at: move.at, player: attacker }, { at: wins[0], player: defender }, ...sub.line] } : {}) };
  });
  try {
    let eats = 0, attacks = 0, secondLines = 0;
    for (const step of line) {
      guard.check();
      if (step.at === null) continue;
      if (step.player !== attacker) { board.put(step.at, defender); continue; }
      attacks++;
      if (step.note === 'five') { board.put(step.at, attacker); continue; }
      const fromDiagram = board.withMove(step.at, attacker, () => Math.max(0,
        ...board.fourGroups(step.at, attacker, rule).map(g => g.stones.filter(q => q !== step.at && initial.cells[q] === attacker).length)));
      if (fromDiagram >= 3) eats++;
      let trapDepth = 0, deepTraps = 0, choices = 1;
      const alternatives = [];
      for (const move of board.forcingMoves(attacker, rule, guard)) {
        if (move.at === step.at) continue;
        const before = guard.nodes, result = follow(move);
        if (result.win) secondLines++;
        if (result.length > 0) choices++;
        if (!result.win) {
          trapDepth = Math.max(trapDepth, result.length);
          if (result.length >= 3) deepTraps++;
        }
        alternatives.push({ at: move.at, winning: result.win, length: result.length, states: guard.nodes - before,
          ...(!result.win && result.length >= 3 ? { refutedVariation: result.line } : {}) });
      }
      rows.push({ turn: attacks, at: step.at, fromDiagram, choices, trapDepth, deepTraps, alternatives });
      board.put(step.at, attacker);
    }
    return { status: 'complete', secondLines, eats, eatShare: eats / attacks,
      deepTurns: rows.filter(r => r.deepTraps > 0).length,
      rootTrapDepth: rows[0]?.trapDepth ?? 0,
      maxTrapDepth: Math.max(0, ...rows.map(r => r.trapDepth)),
      decisionTurns: rows.filter(r => r.choices >= 2).length,
      states: guard.nodes, elapsedMs: guard.elapsedMs, rows };
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { status: 'budget', states: guard.nodes, elapsedMs: guard.elapsedMs };
  }
}
