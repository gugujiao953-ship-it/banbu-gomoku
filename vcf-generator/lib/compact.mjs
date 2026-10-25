import { Board, other } from './board.mjs';
export { constructCompact } from './compact/construct.mjs';
import { repairRenjuSetup, replayPlan } from './compact/replay.mjs';
import { fillBalance, addDecoyPairs } from './compact/decorate.mjs';
import { weaveBranches } from './compact/branch-weave.mjs';
import { repairBridges } from './compact/precheck.mjs';
import { addCounterThreat } from './compact/counter-threat.mjs';

// Fill only the count deficit. Adjacent setup stones are allowed when their
// actual tactics are safe; geometric separation is not a legality rule.
export function balanceCompact(candidate, size, attacker, rule, rng, guard, diagnostics = {}, naturalStyle = false, decoyPairs = 0, pairVerify, branchWeave = null, counterThreat = null, preserveWhiteDefender = false) {
  const reject = reason => {
    const reasons = diagnostics.balanceRejections ??= {};
    reasons[reason] = (reasons[reason] || 0) + 1;
    return null;
  };
  const repaired = repairRenjuSetup(candidate, size, attacker, rule, rng, guard);
  if (!repaired.ok) return reject(repaired.reason);
  const { initial, repairs } = repaired;
  if (candidate.compact) candidate.compact.blackLegalityRepairs = repairs;
  const b = new Board(size, initial);
  if (b.hasFive() || b.winningPoints(1, rule, guard).length || b.winningPoints(2, rule, guard).length) return reject('initial-win');
  let planFailure;
  const preservesPlan = () => {
    const result = replayPlan(b, candidate, attacker, rule, guard);
    if (!result.ok) { planFailure = result.reason; return false; }
    return true;
  };
  if (!preservesPlan()) return reject(planFailure);
  const decoration = fillBalance({ board: b, candidate, size, attacker, rule, rng, guard, naturalStyle, preserveWhiteDefender, preservesPlan });
  if (!decoration.ok) return reject(decoration.reason);
  const { baseline, networkScore, blendScore, nearDiagram, free } = decoration;
  weaveBranches({ board: b, candidate, size, attacker, rule, guard, diagnostics, branchWeave, nearDiagram, networkScore, preservesPlan });
  addDecoyPairs({ board: b, candidate, attacker, rule, rng, guard, decoyPairs, pairVerify, baseline, nearDiagram, blendScore, preservesPlan });
  const salvaged = repairBridges({ board: b, candidate, size, branchWeave });
  if (salvaged) return salvaged;
  addCounterThreat({ board: b, candidate, size, attacker, rule, guard, diagnostics, counterThreat, nearDiagram, blendScore, preservesPlan });
  if (naturalStyle && candidate.compact) {
    const stones = [...b.cells.keys()].filter(q => b.cells[q]);
    const localPairs = stones.reduce((n, q) => n + (stones.some(otherAt => otherAt !== q
      && Math.max(Math.abs(Math.floor(otherAt / size) - Math.floor(q / size)), Math.abs(otherAt % size - q % size)) <= 2
      && b.cells[otherAt] !== b.cells[q]) ? 1 : 0), 0);
    candidate.compact.networkFilled = free.filter(entry => entry.blend > 0 && b.cells[entry.q]).length;
    candidate.compact.mixedAdjacency = localPairs;
    candidate.compact.counterThreats = b.forcingMoves(other(attacker), rule, guard).length;
  }
  return b;
}
