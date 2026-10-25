import { Board, BudgetExceeded, budget, other } from './board.mjs';
import { principalVariation } from './solve.mjs';

// Structural evidence about the winning route. Long unrelated losing branches
// do not count as decisions here. A future correct move played too early is an
// order trap only when the full difficulty search actually refuted it.
// These measurements are not a calibrated rating of human difficulty.
export function analyzeMainline(initial, attacker, proof, {
  rule = 'renju', timeMs = 1000, nodeLimit = 30000, signal, difficulty,
} = {}) {
  const guard = budget({ timeMs, nodeLimit, signal });
  const board = new Board(initial.size, initial.cells), defender = other(attacker);
  const rows = [], played = new Map();
  try {
    guard.check();
    const line = principalVariation(initial, attacker, proof, rule);
    const attacks = line.filter(s => s.player === attacker && s.at !== null);
    const fullAlternatives = difficulty?.status === 'complete';
    let previous = null, previousReply = null;
    for (const step of line) {
      guard.tick();
      if (step.player !== attacker) {
        previousReply = step.at;
        if (step.at !== null) board.put(step.at, defender);
        continue;
      }
      const turn = rows.length + 1, five = step.note === 'five';
      const counterPoints = board.winningPoints(defender, rule, guard);
      const forcing = five ? [] : board.forcingMoves(attacker, rule, guard);
      const future = new Set(attacks.slice(turn).filter(s => s.note !== 'five').map(s => s.at));
      const futureChoices = forcing.filter(m => future.has(m.at)).map(m => m.at);
      const alternatives = fullAlternatives ? difficulty.rows.find(r => r.turn === turn)?.alternatives ?? [] : [];
      const orderTraps = alternatives.filter(a => future.has(a.at) && !a.winning).map(a => ({ at: a.at, length: a.length }));
      const supports = five ? [] : board.withMove(step.at, attacker, () =>
        board.fourGroups(step.at, attacker, rule).map(g => ({
          stones: g.stones.filter(q => q !== step.at),
          earlierTurns: g.stones.filter(q => played.has(q)).map(q => played.get(q)),
          fromDiagram: g.stones.filter(q => initial.cells[q] === attacker).length,
        })));
      const followsPrevious = previous !== null && supports.length > 0 && supports.every(g => g.stones.includes(previous));
      const returnsToOld = supports.some(g => g.earlierTurns.length > 0 && !g.stones.includes(previous));
      let unlockedByReply = false;
      if (!five && previousReply !== null) {
        const withoutReply = new Board(board.size, board.cells);
        withoutReply.undo(previousReply);
        unlockedByReply = !withoutReply.legal(step.at, attacker, rule, guard);
      }
      rows.push({ turn, at: step.at, five, counterPoints,
        answersCounter: !five && counterPoints.length > 0,
        forcingChoices: forcing.length, futureChoices, orderTraps,
        followsPrevious, returnsToOld, unlockedByReply, supports });
      board.put(step.at, attacker);
      played.set(step.at, turn); previous = step.at;
    }
    const nonfinal = rows.filter(r => !r.five);
    let run = 0, maxFollowRun = 0;
    for (const row of nonfinal) {
      run = row.followsPrevious && !row.answersCounter && !row.orderTraps.length && !row.unlockedByReply ? run + 1 : 0;
      maxFollowRun = Math.max(maxFollowRun, run);
    }
    return { status: 'complete', orderAnalysis: fullAlternatives ? 'complete' : 'unknown',
      counterTurns: nonfinal.filter(r => r.answersCounter).length,
      orderDecisionTurns: fullAlternatives ? nonfinal.filter(r => r.orderTraps.length).length : null,
      returnTurns: nonfinal.filter(r => r.returnsToOld).length,
      jointSupportTurns: nonfinal.filter(r => r.supports.some(g => g.earlierTurns.length >= 2)).length,
      unlockedTurns: nonfinal.filter(r => r.unlockedByReply).length,
      maxFollowRun, rows, states: guard.nodes, elapsedMs: guard.elapsedMs };
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { status: 'budget', states: guard.nodes, elapsedMs: guard.elapsedMs };
  }
}
