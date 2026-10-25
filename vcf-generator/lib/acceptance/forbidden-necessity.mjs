import { Board } from '../board.mjs';
import { solve } from '../solve.mjs';
import { forbiddenCertificate } from '../forbidden.mjs';

export function certifyForbiddenEnding(board, result, { size, attacker, rules, depth, ending, forbiddenKind, solveMs, signal }, { guard, remainingTime }) {
  const b = board;
  let forbidden;
  if(ending==='forbidden') {
    forbidden=forbiddenCertificate(b,result.proof,guard);
    if(!forbidden || (forbiddenKind!=='any' && forbidden.kind!==forbiddenKind)) { return { ok: false, reason: 'forbiddenNonessential' }; }
    const relaxed=solve(new Board(size,b.cells),attacker,{rule:'freestyle',maxDepth:depth,timeMs:remainingTime(solveMs),signal});
    if(relaxed.status!=='not-found') { return { ok: false, reason: 'forbiddenNonessential' }; }
  }
  return { ok: true, forbidden };
}
