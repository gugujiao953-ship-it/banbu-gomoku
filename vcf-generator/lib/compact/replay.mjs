import { Board, other } from '../board.mjs';

// Replay and legality repair are deliberately separate from compact decoration.
// They only answer whether a constructed plan can be placed on a legal starting
// position; they never add setup texture or certify a final solution.
export function repairRenjuSetup(candidate, size, attacker, rule, rng, guard) {
  let initial = Uint8Array.from(candidate.cells);
  let repairs = 0;
  if (rule !== 'renju') return { ok: true, initial, repairs };

  for (;;) {
    guard.check();
    const replay = new Board(size, initial);
    let bad = -1;
    for (let k = 0; k < candidate.path.length; k++) {
      const at = candidate.path[k];
      if (!replay.legal(at, attacker, rule, guard)) { bad = at; break; }
      replay.put(at, attacker);
      if (k < candidate.path.length - 1) {
        const reply = candidate.blocks[k];
        if (!replay.legal(reply, other(attacker), rule, guard)) { bad = reply; break; }
        replay.put(reply, other(attacker));
      }
    }
    if (bad < 0) break;
    if (repairs >= 16) return { ok: false, reason: 'black-repair-limit' };

    const base = new Board(size, initial);
    const baseline = [null,
      new Set(base.forcingMoves(1, rule, guard).map(move => move.at)),
      new Set(base.forcingMoves(2, rule, guard).map(move => move.at)),
    ];
    const candidates = [];
    const row = Math.floor(bad / size), col = bad % size;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      for (let k = -5; k <= 5; k++) {
        const q = replay.index(row + dr * k, col + dc * k);
        if (q < 0 || replay.cells[q] || initial[q] || candidate.reserved.has(q)) continue;
        guard.check();
        if (!replay.withMove(q, 2, () => replay.legal(bad, 1, rule, guard))) continue;
        const safe = base.withMove(q, 2, () => !base.hasFive()
          && ![1, 2].some(player => base.winningPoints(player, rule, guard).length
            || base.forcingMoves(player, rule, guard).some(move => !baseline[player].has(move.at))));
        if (safe) candidates.push(q);
      }
    }
    if (!candidates.length) return { ok: false, reason: 'black-repair-unavailable' };
    initial[candidates[Math.floor(rng() * candidates.length)]] = 2;
    repairs++;
  }
  return { ok: true, initial, repairs };
}

export function replayPlan(board, candidate, attacker, rule, guard) {
  const placed = [];
  const defender = other(attacker);
  try {
    for (let k = 0; k < candidate.path.length; k++) {
      guard.check();
      const at = candidate.path[k];
      if (!board.legal(at, attacker, rule, guard)) return { ok: false, reason: 'illegal-attack' };
      board.put(at, attacker); placed.push(at);
      if (board.wonAt(at, attacker, rule)) return { ok: false, reason: 'premature-five' };
      if (board.winningPoints(defender, rule, guard).length) return { ok: false, reason: 'defender-five' };
      const wins = board.winningPoints(attacker, rule, guard);
      if (k === candidate.path.length - 1) {
        const answerable = wins.length >= 2 || wins.length === 1 && !board.legal(wins[0], defender, rule, guard);
        return answerable ? { ok: true } : { ok: false, reason: 'terminal-answerable' };
      }
      if (wins.length !== 1) return { ok: false, reason: wins.length ? 'premature-unanswerable' : 'no-four' };
      if (wins[0] !== candidate.blocks[k]) return { ok: false, reason: 'different-block' };
      if (!board.legal(wins[0], defender, rule, guard)) return { ok: false, reason: 'illegal-defense' };
      board.put(wins[0], defender); placed.push(wins[0]);
    }
    return { ok: false, reason: 'empty-plan' };
  } finally {
    for (let i = placed.length - 1; i >= 0; i--) board.undo(placed[i]);
  }
}
