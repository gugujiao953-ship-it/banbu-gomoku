import { Board, other } from './board.mjs';
import { solve } from './solve.mjs';
import { sha256, bytesBase64 } from './portable.mjs';

// Board identity is an acceptance/orchestration concern, not a constructor
// concern.  The key is symmetry invariant and includes the board size.
export function canonicalKey(b) {
  const n = b.size, encodings = [];
  for (let mirror = 0; mirror < 2; mirror++) for (let turns = 0; turns < 4; turns++) {
    const bytes = new Uint8Array(n * n);
    for (let at = 0; at < b.cells.length; at++) {
      let r = Math.floor(at / n), c = at % n;
      if (mirror) c = n - 1 - c;
      for (let k = 0; k < turns; k++) [r, c] = [c, n - 1 - r];
      bytes[r * n + c] = b.cells[at];
    }
    encodings.push(bytesBase64(bytes));
  }
  return sha256(n + ':' + encodings.sort()[0]);
}

// Recheck every off-path forcing move after its only immediate block.  This is
// an alternative-line audit: a second line or unproven branch fails the hard
// gate, while the plausible count guides difficulty selection. It never
// certifies a puzzle by itself.
export function decoyAudit(board, attacker, rule, line, solveMs) {
  const defender = other(attacker), play = new Board(board.size, board.cells);
  const attackTotal = line.filter(move => move.player === attacker).length;
  let turns = 0, plausible = 0, secondLine = 0, unproven = 0, attacksUsed = 0;
  for (const move of line) {
    if (move.player !== attacker) { if (move.at !== null) play.put(move.at, defender); continue; }
    const left = attackTotal - attacksUsed - 1;
    let bestFollow = 0;
    turns++;
    for (const alt of play.forcingMoves(attacker, rule)) {
      if (alt.at === move.at) continue;
      if (alt.five) { secondLine++; continue; }
      const block = alt.wins[0];
      const out = play.withMove(alt.at, attacker, () => {
        if (play.winningPoints(defender, rule).length || left < 1) return { dead: true, follow: 0 };
        if (!play.legal(block, defender, rule)) return { dead: false, follow: 0 };
        return play.withMove(block, defender, () => {
          const result = solve(play, attacker, { rule, maxDepth: left, timeMs: solveMs() });
          return { dead: result.status === 'not-found', budget: result.status === 'budget', follow: play.forcingMoves(attacker, rule).length };
        });
      });
      if (out.budget) unproven++;
      else if (!out.dead) secondLine++;
      if (out.follow > bestFollow) bestFollow = out.follow;
    }
    if (bestFollow > 0) plausible++;
    play.put(move.at, attacker); attacksUsed++;
  }
  return { turns, plausible, secondLine, unproven };
}

// Compactness is used only to rank candidates that have already passed every
// correctness gate.  It must stay independent from the acceptance verifier.
export function compactness(stones, size) {
  const set = new Set();
  for (const color of ['black', 'white']) for (const s of stones[color]) set.add(s.row * size + s.col);
  const seen = new Set();
  let blocks = 0, top = size, left = size, bottom = -1, right = -1;
  for (const start of set) {
    const r = Math.floor(start / size), c = start % size;
    if (r < top) top = r; if (r > bottom) bottom = r; if (c < left) left = c; if (c > right) right = c;
    if (seen.has(start)) continue;
    blocks++; seen.add(start);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop(), cr = Math.floor(cur / size), cc = cur % size;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = cr + dr, ccc = cc + dc;
        if (rr < 0 || ccc < 0 || rr >= size || ccc >= size) continue;
        const q = rr * size + ccc;
        if (set.has(q) && !seen.has(q)) { seen.add(q); stack.push(q); }
      }
    }
  }
  return { blocks, span: Math.max(bottom - top + 1, right - left + 1), area: (bottom - top + 1) * (right - left + 1), stones: set.size };
}

const CREDIT_BANDS = [[1, 3], [6, 10], [0.39, 0.54]];
const bandCredit = (value, [lo, hi]) => {
  const width = Math.max(hi - lo, 0.05);
  const over = value < lo ? lo - value : value > hi ? value - hi : 0;
  return Math.max(0, 1 - over / width);
};

export const compactScore = c => bandCredit(c.blocks, CREDIT_BANDS[0]) + bandCredit(c.span, CREDIT_BANDS[1])
  + bandCredit(c.stones / c.area, CREDIT_BANDS[2]);

