import { boardFromPuzzle, playerId, other } from './board.mjs';
import { solve } from './solve.mjs';
export { generate, canonicalKey } from './generate-core.mjs';
export { verify } from './verify.mjs';

// Match a certified continuation cheaply. A different move is checked by a
// complete VCF search, never rejected just because it differs from the PV.
export function evaluateMove(puzzle, moves, proof, at) {
  const board = boardFromPuzzle(puzzle), attacker = playerId(puzzle.attacker), defender = other(attacker);
  for (const move of moves) if (move.at !== null) board.put(move.at, move.player);
  if (!Number.isInteger(at) || at < 0 || at >= board.cells.length || board.cells[at] || !board.legal(at, attacker, puzzle.rules))
    return { status: 'wrong', note: '这里不能落子，请换一个点。' };
  // 试走岔路（用户 2026-10-07：「支线根本走不进去，点一下就说不成立」）：点到
  // "确实是冲四、但剩余手数里算不赢"的手，不再一拒了之——按 VCF 的规矩把这一手和
  // 对方的唯一挡住走完，让玩家自己把这条岔路走到头（走到头才提示此路不通）。
  // 生成端已证明这类岔路在剩余手数内赢不了（secondLine 门），这里只读、不改变验收；
  // 主解线（proof 在场且真算得赢）的路径逐字不变。proof 为空＝正在岔路上，继续同一条走法。
  const trialStep = () => {
    if (puzzle.ending === 'forbidden') return { status: 'wrong', note: '这一步不能在剩余手数内完成 VCF，请再试一手。' };
    const used = moves.filter(m => m.player === attacker).length;
    const fullTrial = puzzle.provenance?.hardSearch === true;
    if (!fullTrial && used >= puzzle.depth) return { status: 'wrong', note: '这条岔路的手数已经用完——此路不通，点「撤销」回到主路。' };
    const move = board.forcingMoves(attacker, puzzle.rules).find(m => m.at === at);
    if (!move) return { status: 'wrong', note: '这一步没有形成连续冲四，请再试一手。' };
    if (move.five) return { status: 'won', moves: [{ at, player: attacker, note: 'five' }], proof: null, note: '已连成五，解题成功。' };
    if (move.wins.length !== 1 || !board.legal(move.wins[0], defender, puzzle.rules))
      return { status: 'wrong', note: '这一步的应法超出这道题的证明范围，请换一手。' };
    const block = move.wins[0];
    board.put(at, attacker);
    if (board.winningPoints(defender, puzzle.rules).length) return { status: 'wrong', note: '对方可以先连五，这条冲四不能获胜——此路不通，点「撤销」回退。' };
    board.put(block, defender);
    const left = puzzle.depth - used - 1;
    const continuations = board.forcingMoves(attacker, puzzle.rules);
    const canContinue = fullTrial ? continuations.some(m => m.five || board.withMove(m.at, attacker,
      () => !board.winningPoints(defender, puzzle.rules).length)) : continuations.length > 0;
    const dead = !fullTrial && left <= 0 ? '手数用完也没能连五' : !canContinue ? '这里再也续不出有效的冲四了' : null;
    return { status: 'accepted', moves: [{ at, player: attacker, note: 'trial' }, { at: block, player: defender, note: 'block' }], proof: null,
      note: dead ? `对方挡这里——${dead}，此路不通，点「撤销」回退。` : '对方挡这里，继续。' };
  };
  if (!proof) return trialStep();
  let node = proof;
  if (at !== proof.at) {
    const candidates = board.forcingMoves(attacker, puzzle.rules);
    if (!board.winningPoints(attacker, puzzle.rules).includes(at) && !candidates.some(move => move.at === at))
      return { status: 'wrong', note: '这一步没有形成连续冲四，请再试一手。' };
    const result = solve(board, attacker, { rule: puzzle.rules, maxDepth: proof.depth, prior: [at], enumerateFirst: true, timeMs: 8000 });
    if (result.status === 'budget') return { status: 'budget', note: '这一步尚未验完，可以重试或继续尝试其他落点。' };
    if (result.status !== 'win' || !result.winningFirst.includes(at)) return trialStep();
    // The shortest root may differ from the chosen winning move. Solve its
    // actual forced reply separately to obtain the right continuation.
    board.put(at, attacker);
    if (board.wonAt(at, attacker, puzzle.rules)) return { status: 'won', moves: [{ at, player: attacker, note: 'five' }], proof: null, note: '已连成五，解题成功。' };
    const wins = board.winningPoints(attacker, puzzle.rules);
    if (wins.length >= 2 || !board.legal(wins[0], defender, puzzle.rules)) node = { at, kind: 'unanswerable-four', depth: 2, wins };
    else {
      board.put(wins[0], defender);
      const sub = solve(board, attacker, { rule: puzzle.rules, maxDepth: proof.depth - 1, timeMs: 8000 });
      if (sub.status !== 'win') return { status: 'budget', note: '应答分支尚未验完，请重试。' };
      node = { at, kind: 'four', depth: 1 + sub.depth, wins, replies: [{ at: wins[0], child: sub.proof }] };
      board.undo(wins[0]);
    }
    board.undo(at);
  }
  board.put(at, attacker);
  const placed = [{ at, player: attacker, note: node.kind }];
  if (node.kind === 'five') return { status: 'won', moves: placed, proof: null, note: '已连成五，解题成功。' };
  if (node.kind === 'unanswerable-four') {
    const block = node.wins.find(q => board.legal(q, defender, puzzle.rules));
    placed.push({ at: block ?? null, player: defender, note: block === undefined ? 'pass' : 'block' });
    if (block !== undefined) board.put(block, defender);
    const win = board.winningPoints(attacker, puzzle.rules)[0];
    return { status: 'accepted', moves: placed, proof: { at: win, kind: 'five', depth: 1 },
      note: block === undefined ? '黑棋唯一防点是禁手，白棋继续连五。' : '对方已应手，继续完成最后的连五。' };
  }
  const reply = node.replies[0];
  placed.push({ at: reply.at, player: defender, note: 'block' });
  return { status: 'accepted', moves: placed, proof: reply.child, note: '对方已应手，请继续。' };
}
