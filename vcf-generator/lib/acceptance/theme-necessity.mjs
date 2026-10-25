import { Board, BLACK, AXES, other } from '../board.mjs';
import { solve } from '../solve.mjs';
import { collectShapeUse, meetsMultiStepUse } from '../shape-use.mjs';
import { shapeBoxes } from '../shapes.mjs';

// Record initial character stones used by the actual winning proof. A stone
// near the solution is not enough: it must occur in an actual winning run
// after an immediate-five continuation promised by the verified four.
function characterEvidence(initial, attacker, rule, proof, theme, glyphBoxes, isShape=false) {
  const board = new Board(initial.size, initial.cells), borrowed = new Set(), fixed = new Map(theme.fixed.map(s => [s.at, s.player]));
  const record = origin => {
    for (const [dr, dc] of AXES) {
      const run = board.run(origin, attacker, dr, dc);
      if (rule === 'renju' && attacker === BLACK ? run.length !== 5 : run.length < 5) continue;
      for (const at of run) if (fixed.get(at) === attacker) borrowed.add(at);
    }
  };
  const visit = node => board.withMove(node.at, attacker, () => {
    if (node.kind === 'five') record(node.at);
    else {
      for (const win of node.wins) board.withMove(win, attacker, () => record(win));
      for (const reply of node.replies || []) board.withMove(reply.at, other(attacker), () => visit(reply.child));
    }
  });
  visit(proof);
  return glyphBoxes.map((box, index) => {
    const points=box.points?new Set(box.points.map(p=>(p.row+theme.row)*initial.size+p.col+theme.col)):null;
    const contains = at => {
      if(points)return points.has(at);
      const row = Math.floor(at / initial.size) - theme.row, col = at % initial.size - theme.col;
      return row >= box.row && row < box.row + box.height && col >= box.col && col < box.col + box.width;
    };
    const members = theme.fixed.filter(s => contains(s.at));
    return { ...(isShape?{id:box.id,label:box.label}:{char: box.char ?? box.character}), index,
      ...(!isShape?{box: { row: box.row, col: box.col, width: box.width, height: box.height }}:{}),
      critical: members.filter(s => borrowed.has(s.at)).map(s => ({ at: s.at, player: s.player })), members };
  });
}

export function certifyTheme(board, candidate, result, { options, size, attacker, rules, depth, theme, shapeInfo, glyphParticipation, solveMs, signal }, { guard, remainingTime }) {
  const b = board;
  let glyphCritical, characters,parts,complexity, textCritical;
  if (theme) {
    if(options.shapeComplexity==='multi-step'){
      complexity=collectShapeUse(b,attacker,rules,result.proof,theme,shapeInfo);
      if(!meetsMultiStepUse(complexity,depth)){return { ok: false, reason: 'shapeComplexity' };}
    }
    if (shapeInfo||glyphParticipation === 'each-character') {
      const evidence = characterEvidence(b, attacker, rules, result.proof, theme, shapeInfo?shapeBoxes(shapeInfo):options.textRaster.glyphBoxes,!!shapeInfo);
      if (evidence.some(character => !character.critical.length)) { return { ok: false, reason: 'glyphNonparticipating' }; }
      let essential = true;
      for (const character of evidence) {
        const without = new Board(size, b.cells);
        for (const stone of character.members) without.undo(stone.at);
        const check = solve(without, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(solveMs), signal });
        if (check.status !== 'not-found') { essential = false; break; }
      }
      if (!essential) { return { ok: false, reason: 'glyphNonessential' }; }
      const claims=evidence.map(({ members, ...character }) => ({ ...character, deletionStatus: 'not-found' }));
      if(shapeInfo)parts=claims;else characters=claims;
      if(!shapeInfo) textCritical=[...new Map(evidence.flatMap(character=>character.critical).map(stone=>[stone.at,stone])).values()];
    }
    // Custom shapes prove necessity at the user-defined part boundary: every
    // part has a proof-used attacker stroke, and deleting the whole part must
    // destroy the declared VCF. The constructor's glyphAnchor is only a route
    // start; text and built-in shapes keep their established anchor check.
    const customShape = shapeInfo?.source === 'custom-mask';
    if ((shapeInfo && !customShape) || (!shapeInfo && glyphParticipation !== 'each-character')) {
      const without = new Board(size, b.cells);
      without.undo(candidate.glyphAnchor);
      guard.check();
      const check = solve(without, attacker, { rule:rules, maxDepth:depth, timeMs:remainingTime(solveMs),signal });
      if (check.status !== 'not-found') { return { ok: false, reason: 'glyphNonessential' }; }
    }
    // Expose every stroke used by the proof, not only the starting anchor.
    // The verifier still checks each entry against an actual winning run.
    glyphCritical = customShape
      ? [...new Map((parts || []).flatMap(part => part.critical).map(stone => [stone.at, stone])).values()]
      : textCritical?.length ? textCritical : [{ at:candidate.glyphAnchor,player:attacker }];
  }
  return { ok: true, glyphCritical, characters, parts, complexity };
}
