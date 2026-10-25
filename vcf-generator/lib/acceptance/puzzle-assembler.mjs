import { coordinates, playerName } from '../board.mjs';
import { principalVariation } from '../solve.mjs';
import { generatedPuzzleId } from '../puzzle-identity.mjs';

// This draft must still pass independent verification and alternative-line
// checks before batch selection or export can receive it.
export function assemblePuzzleDraft(board, candidate, result, { options, key, size, rules, attacker, depth, ending, uniqueFirst, shapeInfo, text, theme, glyphParticipation, seed, attempts, layout }, { forbidden, glyphCritical, characters, parts, complexity }) {
  const b = board;
  const stones = { black: [], white: [] };
  b.cells.forEach((p, at) => { if (p) stones[playerName(p)].push(coordinates(at, size)); });
  const puzzle = {
    schema: 'banbu-vcf-proof/1', id: generatedPuzzleId(key, rules), title: `${shapeInfo?shapeInfo.label+' · '+(complexity?'多步参与 · ':''):text ? text + ' · ' : ''}${playerName(attacker) === 'black' ? '黑' : '白'}先${forbidden ? '抓禁手（'+({'double-three':'三三','double-four':'四四','overline':'长连'}[forbidden.kind])+'）' : ''} VCF ${depth} 手`,
    size, rules, attacker: playerName(attacker), depth, stones, proof: result.proof,
    ...(forbidden ? { ending, forbidden } : {}),
    ...(uniqueFirst ? { uniqueFirst: true, winningFirst: result.winningFirst } : {}),
    solution: principalVariation(b, attacker, result.proof, rules),
    ...(theme ? { theme: { text: shapeInfo?shapeInfo.label:theme.text, mask: theme.mask, row: theme.row, col: theme.col, height: theme.height, width: theme.width, fixed: theme.fixed, critical:glyphCritical,
      ...(shapeInfo?{kind:'shape',shape:shapeInfo,participation:'each-part',parts,...(shapeInfo.source==='custom-mask'?{customCriticalMode:'parts'}:{}),...(complexity?{complexity}:{})}:{glyphParticipation}), ...(characters ? { characters } : {}), ...(options.textRaster?{textRaster:options.textRaster}:{}) } } : {}),
    provenance: { method: 'empty-board-dependency-synthesis', corpusUsed: false, seed, attempt: attempts, layout, ...(options.naturalStyle === true ? { naturalStyle: true } : {}), ...(options.simple === true ? { simple: true } : {}), canonicalHash: key },
    metrics: { solverNodes: result.nodes, solverMs: result.elapsedMs, constructionNodes: candidate.nodes,
      ...(candidate.compact?{compact:candidate.compact}:{}) },
  };
  return puzzle;
}
