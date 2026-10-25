import { decoyAudit } from '../quality.mjs';

// Unknown alternatives fail the hard gate. The plausible-alternative floor is
// a separate quality decision; only the orchestrator may retain a verified
// fallback when the deep selection window is exhausted.
export function checkAlternativeLines(board, solution, { attacker, rules, solveMs }, { remainingTime }) {
  const audit = decoyAudit(board, attacker, rules, solution, () => remainingTime(Math.min(solveMs, 500)));
  return { ok: !audit.secondLine && !audit.unproven, audit };
}

export function meetsPlausibleFloor(audit, { options, theme, ending, layout, depth, deepLottery }) {
  // The final five cannot have a plausible dead continuation (left === 0).
  // D3 used to require ceil(3 * .7) === 3 plausible turns, while only two
  // turns can satisfy the definition. Keep all other depth thresholds intact.
  const minimum = depth <= 30
    ? Math.min(audit.turns - 1, Math.ceil(audit.turns * 0.7))
    : Math.ceil(audit.turns * 0.3);
  return !(options.simple !== true && !theme && ending === 'five' && layout === 'compact' && (depth <= 30 || deepLottery) &&
    audit.plausible < minimum);
}
