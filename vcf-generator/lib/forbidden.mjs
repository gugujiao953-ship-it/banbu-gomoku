import { AXES, BLACK, Board, coordinates } from './board.mjs';

// This is a producer-side label only. The verifier computes the RIF reason
// again using its separate geometry and recursive legality implementation.
export function classifyForbidden(board, at, guard) {
  if (board.cells[at] || board.legal(at, BLACK, 'renju', guard)) return null;
  return board.withMove(at, BLACK, () => {
    const runs = board.lengths(at, BLACK);
    if (runs.includes(5)) return null;
    const kind = runs.some(n => n > 5) ? 'overline' : board.fourGroups(at, BLACK, 'renju').length > 1 ? 'double-four' : 'double-three';
    return { at, coordinate: coordinates(at, board.size), kind, runs };
  });
}

// Add constraints around the LAST forced block, not a stored problem board.
// Enumerate axes and offsets; the complete solver decides whether the resulting
// diagram and every earlier black reply are actually valid.
export function addForbiddenConstraints(candidate, size, kind, rng, guard, theme) {
  const { cells, reserved, path, blocks } = candidate;
  const target = blocks.at(-1), { row, col } = coordinates(target, size);
  const index = (r, c) => r >= 0 && r < size && c >= 0 && c < size ? r * size + c : -1;
  const fixed = new Map((theme?.fixed || []).map(s => [s.at, s.player]));
  const inGlyph = q => theme && Math.floor(q/size)>=theme.row && Math.floor(q/size)<theme.row+theme.height && q%size>=theme.col && q%size<theme.col+theme.width;
  const kinds = kind === 'any' ? ['double-three', 'double-four', 'overline'] : [kind];
  const patterns = [];
  for (const wanted of kinds) {
    if (wanted === 'overline') {
      for (const [dr, dc] of AXES) for (let start = -5; start <= 0; start++) {
        const offsets = Array.from({length:6},(_,k)=>start+k).filter(k=>k!==0);
        if (offsets.length !== 5) continue;
        patterns.push({ kind:wanted, points:offsets.map(k=>index(row+k*dr,col+k*dc)) });
      }
    } else {
      const offsets = wanted === 'double-three' ? [[-2,-1],[-1,1],[1,2],[-3,-1],[-2,1],[-1,2],[1,3]] : [[-3,-2,-1],[-2,-1,1],[-1,1,2],[1,2,3]];
      for (let a=0;a<AXES.length;a++) for(let b=a+1;b<AXES.length;b++) for(const aa of offsets) for(const bb of offsets) {
        const points=[...aa.map(k=>index(row+k*AXES[a][0],col+k*AXES[a][1])),...bb.map(k=>index(row+k*AXES[b][0],col+k*AXES[b][1]))];
        patterns.push({kind:wanted,points});
      }
    }
  }
  for(let i=patterns.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[patterns[i],patterns[j]]=[patterns[j],patterns[i]];}
  for (const pattern of patterns) {
    guard.check();
    if(pattern.points.some(q=>q<0 || (cells[q] && cells[q]!==BLACK) || (!cells[q] && reserved.has(q)) || (inGlyph(q) && fixed.get(q)!==BLACK))) continue;
    const added=[...new Set(pattern.points)].filter(q=>!cells[q]);
    for(const q of added)cells[q]=BLACK;
    const terminal=new Board(size,cells);
    for(let k=0;k<path.length;k++) {
      terminal.put(path[k],2);
      if(k<path.length-1)terminal.put(blocks[k],BLACK);
    }
    const label=classifyForbidden(terminal,target,guard);
    if(label?.kind===pattern.kind && terminal.winningPoints(2,'renju',guard).length===1 && !terminal.winningPoints(BLACK,'renju',guard).length && !new Board(size,cells).hasFive()) {
      for(const q of added)reserved.add(q);
      return { ...candidate, forbiddenTarget:target, forbiddenKind:label.kind };
    }
    for(const q of added)cells[q]=0;
  }
  return null;
}

export function forbiddenCertificate(board, proof, guard) {
  const b=new Board(board.size,board.cells);
  let node=proof, attackingMove=0;
  while(node) {
    b.put(node.at,2); attackingMove++;
    if(node.kind==='unanswerable-four') {
      if(node.wins?.length!==1)return null;
      const label=classifyForbidden(b,node.wins[0],guard);
      return label ? { ...label, attackAt:node.at, attackingMove, essentialWithinDepth:true, relaxedRule:'freestyle' } : null;
    }
    if(node.kind!=='four' || node.replies?.length!==1)return null;
    b.put(node.replies[0].at,BLACK);
    node=node.replies[0].child;
  }
  return null;
}
