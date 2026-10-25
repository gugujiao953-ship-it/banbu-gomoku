import { Board, BudgetExceeded, budget, other } from './board.mjs';

// Exact AND/OR search. Attackers minimise, defenders maximise the number of
// attacker moves up to ACTUAL FIVE (an open four is therefore two, not one).
// All five-cell windows are represented; no candidate beam or depth heuristic.
export function solve(board, attacker, { rule = 'renju', maxDepth = 10, timeMs = 10000, nodeLimit = 2000000, signal, prior = [], enumerateFirst = false } = {}) {
  if (!(board instanceof Board) || ![1, 2].includes(attacker) || !['renju', 'freestyle'].includes(rule)) throw new Error('Invalid solve arguments');
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 500) throw new Error('Depth must be in 1..500');
  if (board.hasFive()) return { status: 'invalid', reason: 'Already five on starting board' };
  const guard = budget({ timeMs, nodeLimit, signal });
  const defender = other(attacker), tt = new Map();
  const attack = (remaining, isRoot = false) => {
    guard.tick();
    if (remaining < 1) return null;
    const key = board.key() + ':' + remaining;
    if (tt.has(key)) return tt.get(key);
    const wins = board.winningPoints(attacker, rule, guard);
    if (wins.length) return { depth: 1, proof: { at: wins[0], kind: 'five', depth: 1 }, ...(isRoot && enumerateFirst ? { winningFirst: wins } : {}) };
    if (remaining < 2) { tt.set(key, null); return null; }
    let best = null;
    const winningFirst = [];
    // With no immediate attacker five, an existing defender five threat must
    // be blocked on this move. Adding an attacker stone can only remove such
    // threats, so two distinct holes refute the node and one fixes its move.
    // This is the same compulsory-response reduction used below, applied
    // before enumerating and checking unrelated attacking fours.
    const threats = board.winningPoints(defender, rule, guard);
    if (threats.length > 1) { tt.set(key, null); return null; }
    let moves;
    if (threats.length) {
      const at = threats[0];
      moves = board.legal(at, attacker, rule, guard) ? board.withMove(at, attacker, () => {
        const points = [...new Set(board.fourGroups(at, attacker, rule).flatMap(g => g.wins))].sort((a,b)=>a-b);
        return points.length ? [{ at, wins: points }] : [];
      }) : [];
    } else moves = board.forcingMoves(attacker, rule, guard);
    const suggested = prior[maxDepth - remaining];
    moves.sort((a, b) => Number(b.at === suggested) - Number(a.at === suggested) || b.wins.length - a.wins.length || a.at - b.at);
    for (const move of moves) {
      guard.check();
      const limit = best && !(isRoot && enumerateFirst) ? Math.min(remaining, best.depth - 1) : remaining;
      if (limit < 2) break;
      const candidate = board.withMove(move.at, attacker, () => {
        // Defender can win right now, including on a block point: refutes.
        if (board.winningPoints(defender, rule, guard).length) return null;
        const points = board.winningPoints(attacker, rule, guard);
        if (!points.length) return null;
        // Universal response reduction: a non-winning reply can avert an
        // immediate five ONLY by occupying its hole. Else attacker makes five.
        // An unrelated counter-four loses to that five, so it is also covered.
        if (points.length >= 2 || !board.legal(points[0], defender, rule, guard)) {
          return { depth: 2, proof: { at: move.at, kind: 'unanswerable-four', depth: 2, wins: points } };
        }
        const reply = points[0];
        const sub = board.withMove(reply, defender, () => attack(limit - 1));
        return sub ? { depth: 1 + sub.depth, proof: { at: move.at, kind: 'four', depth: 1 + sub.depth, wins: points, replies: [{ at: reply, child: sub.proof }] } } : null;
      });
      if (candidate) {
        if (isRoot && enumerateFirst) winningFirst.push(move.at);
        if (!best || candidate.depth < best.depth) best = candidate;
      }
    }
    if (best && isRoot && enumerateFirst) best = { ...best, winningFirst: winningFirst.sort((a, b) => a - b) };
    tt.set(key, best);
    return best;
  };
  try {
    const result = attack(maxDepth, true);
    return { status: result ? 'win' : 'not-found', ...(result || {}), nodes: guard.nodes, elapsedMs: guard.elapsedMs, exhaustive: true, maxDepth };
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    return { status: 'budget', nodes: guard.nodes, elapsedMs: guard.elapsedMs, exhaustive: false, maxDepth };
  }
}

export function principalVariation(board, attacker, proof, rule = 'renju') {
  const copy = new Board(board.size, board.cells), line = [], defender = other(attacker);
  let node = proof;
  while (node) {
    copy.put(node.at, attacker); line.push({ at: node.at, player: attacker, note: node.kind });
    if (node.kind === 'five') break;
    if (node.kind === 'unanswerable-four') {
      const block = node.wins.find(q => copy.legal(q, defender, rule));
      // RIF allows a pass. Needed when the sole block is a forbidden black move.
      if (block === undefined) line.push({ at: null, player: defender, note: 'pass' });
      else { copy.put(block, defender); line.push({ at: block, player: defender, note: 'block' }); }
      const win = copy.winningPoints(attacker, rule)[0];
      copy.put(win, attacker); line.push({ at: win, player: attacker, note: 'five' });
      break;
    }
    const reply = node.replies[0];
    copy.put(reply.at, defender); line.push({ at: reply.at, player: defender, note: 'block' });
    node = reply.child;
  }
  return line;
}
