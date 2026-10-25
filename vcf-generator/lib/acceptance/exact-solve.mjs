import { Board } from '../board.mjs';
import { solve } from '../solve.mjs';

// A construction prior or decoration cache never replaces the exact depth and
// uniqueness checks. Any rescue returns the board matched by its fresh proof.
export function solveExactCandidate(board, candidate, { attacker, rules, depth, uniqueFirst, solveMs, signal }, { guard, remainingTime }) {
  let b = board;
  let result = candidate.compact?.pairSolve ?? solve(b, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(solveMs), signal, prior: candidate.path, enumerateFirst: uniqueFirst });
  if (result.status === 'budget') { return { ok: false, reason: 'solverBudget' }; }
  if (result.status !== 'win') { return { ok: false, reason: 'noWin' }; }
  if (result.depth !== depth) {
    // 第 38 轮：非桥短赢的「撤 decoy 对」抢救（R34 对桥做过同型）。实测 D8 s12 的 41 次
    // shortcut 里 ~34 次撤掉干扰对后恢复目标深度（D14 s102 5/8）——干扰对虽不在短解线上，
    // 仍可能带短。decoy 对是攻守各一颗，撤掉仍保手数配平；撤后须按目标深度赢才采用，
    // 之后照走 solve/verify/唯一首手/最短解/decoyAudit 全部下游门，验收不放松。
    let rescued = null;
    const decoyCells = candidate.compact?.decoyCells;
    if (decoyCells && decoyCells.length) {
      guard.check();
      const trial = new Board(b.size, b.cells);
      for (const q of decoyCells) trial.undo(q);
      const retry = solve(trial, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(Math.min(solveMs, 5000)), signal, prior: candidate.path, enumerateFirst: uniqueFirst });
      if (retry.status === 'win' && retry.depth === depth) rescued = { board: trial, result: retry };
    }
    if (rescued) {
      b = rescued.board; result = rescued.result;
      if (candidate.compact) { candidate.compact.decoyRescued = (candidate.compact.decoyRescued || 0) + 1; candidate.compact.decoyCells = []; candidate.compact.pairSolve = rescued.result; }
    } else { return { ok: false, reason: 'shortcut' }; }
  }
  if (uniqueFirst) {
    // A useful "唯一首手" puzzle has at least one tempting forcing
    // alternative. It is rejected only when there is no decoy at all;
    // the complete solver below still proves the single winning move.
    const rootForcing = b.forcingMoves(attacker, rules, guard);
    if (rootForcing.length < 2) { return { ok: false, reason: 'shallow' }; }
    if (result.winningFirst.length !== 1) { return { ok: false, reason: 'nonunique' }; }
  }
  return { ok: true, board: b, result };
}
