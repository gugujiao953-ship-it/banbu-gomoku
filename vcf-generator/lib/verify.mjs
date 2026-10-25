import { BudgetExceeded, AXES, BLACK, WHITE, budget, boardFromPuzzle, coordinates, other, playerId } from './board.mjs';
import { validateShape, shapeDefinition } from './shapes.mjs';
import { certificateEqual, bytesBase64 } from './portable.mjs';
import { summarizeShapeUse, meetsMultiStepUse } from './shape-use.mjs';

// The verifier owns flat cells only. Hypothetical reference moves do not update
// the producer's window counts or active sets, and are always undone in finally.
class ReferenceBoard {
  constructor(size,cells){this.size=size;this.cells=Uint8Array.from(cells);}
  key(){return bytesBase64(this.cells);}
  put(at,player){
    if(!Number.isInteger(at)||at<0||at>=this.cells.length||this.cells[at]||![BLACK,WHITE].includes(player))throw new Error('Invalid reference placement');
    this.cells[at]=player;
  }
  undo(at){if(!this.cells[at])throw new Error('Cannot undo an empty reference cell');this.cells[at]=0;}
  withMove(at,player,fn){this.put(at,player);try{return fn();}finally{this.undo(at);}}
}
const referenceAxes=new Map();
function axisLines(size){
  if(referenceAxes.has(size))return referenceAxes.get(size);
  const lines=[];
  for(const [dr,dc]of [[1,-1],[1,1],[1,0],[0,1]])for(let r=0;r<size;r++)for(let c=0;c<size;c++){
    const pr=r-dr,pc=c-dc;
    if(pr>=0&&pr<size&&pc>=0&&pc<size)continue;
    const line=[];
    for(let k=0;;k++){const row=r+k*dr,col=c+k*dc;if(row<0||row>=size||col<0||col>=size)break;line.push(row*size+col);}
    if(line.length>=5)lines.push(line);
  }
  // Cache only phone/common boards; sparse large boards keep the old sparse
  // scan below, and never retain an unbounded collection of axis geometry.
  if(size<=75){if(referenceAxes.size>=4)referenceAxes.delete(referenceAxes.keys().next().value);referenceAxes.set(size,lines);}
  return lines;
}

// Reference geometry deliberately does NOT use Board.windows, active sets,
// incidence counts, forcingMoves, winningPoints OR the producer's RIF legality
// predicate. Forbidden-move recursion is independently implemented below.
function rawRun(b, at, p, dr, dc) {
  const { row, col } = coordinates(at, b.size);
  let n = 1;
  for (const sign of [-1, 1]) for (let k = 1; ; k++) {
    const r = row + k * dr * sign, c = col + k * dc * sign;
    if (r < 0 || r >= b.size || c < 0 || c >= b.size || b.cells[r * b.size + c] !== p) break;
    n++;
  }
  return n;
}
const rawWon = (b, at, p, rule) => AXES.some(([dr, dc]) => rule === 'renju' && p === BLACK ? rawRun(b, at, p, dr, dc) === 5 : rawRun(b, at, p, dr, dc) >= 5);

function rawBlackFours(b, origin) {
  const { row, col } = coordinates(origin, b.size), groups = new Map();
  for (const [dr, dc] of [[1, -1], [1, 1], [0, 1], [1, 0]]) for (let off = -4; off <= 4; off++) {
    const r = row + off * dr, c = col + off * dc;
    if (r < 0 || r >= b.size || c < 0 || c >= b.size) continue;
    const hole = r * b.size + c;
    if (b.cells[hole]) continue;
    b.withMove(hole, BLACK, () => {
      if (rawRun(b, hole, BLACK, dr, dc) !== 5) return;
      const stones = [hole];
      for (const sign of [-1, 1]) for (let k = 1; ; k++) {
        const rr = r + k * dr * sign, cc = c + k * dc * sign;
        if (rr < 0 || rr >= b.size || cc < 0 || cc >= b.size || b.cells[rr * b.size + cc] !== BLACK) break;
        stones.push(rr * b.size + cc);
      }
      if (!stones.includes(origin)) return;
      const four = stones.filter(q => q !== hole).sort((a, b) => a - b), key = four.join(',');
      if (!groups.has(key)) groups.set(key, { stones: four, wins: new Set() });
      groups.get(key).wins.add(hole);
    });
  }
  return [...groups.values()];
}

const referenceLegalCaches = new WeakMap();
export function referenceLegal(b, at, player, rule, guard) {
  guard?.check();
  if (!Number.isInteger(at) || at < 0 || at >= b.cells.length || b.cells[at]) return false;
  if (rule === 'freestyle' || player === WHITE) return true;
  const ar = Math.floor(at / b.size), ac = at % b.size;
  let possible = false;
  for (const [dr, dc] of [[1, -1], [1, 1], [0, 1], [1, 0]]) for (let start = -4; start <= 0; start++) {
    let black = 0, blocked = false;
    for (let k = 0; k < 5; k++) {
      const r = ar + (start + k) * dr, c = ac + (start + k) * dc;
      if (r < 0 || r >= b.size || c < 0 || c >= b.size || b.cells[r * b.size + c] === WHITE) { blocked = true; break; }
      if (b.cells[r * b.size + c] === BLACK) black++;
    }
    if (!blocked && black >= 2) possible = true;
  }
  if (!possible) return true;
  let cache = referenceLegalCaches.get(b);
  if (!cache) { cache = new Map(); referenceLegalCaches.set(b, cache); }
  const key = Array.from(b.cells).join('') + '/' + at;
  if (cache.has(key)) return cache.get(key);
  const valid = b.withMove(at, BLACK, () => {
    if (rawWon(b, at, BLACK, rule)) return true;
    if (AXES.some(([dr, dc]) => rawRun(b, at, BLACK, dr, dc) > 5)) return false;
    if (rawBlackFours(b, at).length > 1) return false;
    const triples = new Set(), { row, col } = coordinates(at, b.size);
    for (const [dr, dc] of [[1, -1], [1, 1], [0, 1], [1, 0]]) for (let off = -4; off <= 4; off++) {
      const r = row + off * dr, c = col + off * dc;
      if (r < 0 || r >= b.size || c < 0 || c >= b.size) continue;
      const extension = r * b.size + c;
      if (b.cells[extension]) continue;
      // Cheap geometric screen first; it cannot determine legality on its own.
      const fours = b.withMove(extension, BLACK, () => rawWon(b, extension, BLACK, rule) ? [] : rawBlackFours(b, extension).filter(g => g.wins.size === 2 && g.stones.includes(at)));
      if (!fours.length || !referenceLegal(b, extension, BLACK, rule, guard)) continue;
      for (const g of fours) triples.add(g.stones.filter(q => q !== extension).join(','));
      if (triples.size >= 2) return false;
    }
    return true;
  });
  if (cache.size >= 20000) cache.clear();
  cache.set(key, valid);
  return valid;
}

// Compute the reason independently. Producer labels are not proof: in
// particular an exact five overrides an apparent overline or double threat.
export function referenceForbidden(b, at, guard) {
  if(!Number.isInteger(at) || at<0 || at>=b.cells.length || b.cells[at] || referenceLegal(b,at,BLACK,'renju',guard))return null;
  return b.withMove(at,BLACK,()=>{
    const runs=AXES.map(([dr,dc])=>rawRun(b,at,BLACK,dr,dc));
    if(runs.includes(5))return null;
    if(runs.some(n=>n>5))return {at,coordinate:coordinates(at,b.size),kind:'overline',runs};
    const fours=rawBlackFours(b,at);
    if(fours.length>1)return {at,coordinate:coordinates(at,b.size),kind:'double-four',runs};
    const triples=new Set(),{row,col}=coordinates(at,b.size);
    for(const [dr,dc] of [[1,-1],[1,1],[0,1],[1,0]])for(let offset=-4;offset<=4;offset++) {
      guard?.check();
      const r=row+offset*dr,c=col+offset*dc;
      if(r<0 || r>=b.size || c<0 || c>=b.size)continue;
      const extension=r*b.size+c;
      if(b.cells[extension])continue;
      const groups=b.withMove(extension,BLACK,()=>rawWon(b,extension,BLACK,'renju')?[]:rawBlackFours(b,extension).filter(g=>g.wins.size===2 && g.stones.includes(at)));
      if(!groups.length || !referenceLegal(b,extension,BLACK,'renju',guard))continue;
      for(const g of groups)triples.add(g.stones.filter(q=>q!==extension).join(','));
    }
    return triples.size>=2 ? {at,coordinate:coordinates(at,b.size),kind:'double-three',runs}:null;
  });
}

function scan(b, player, minimum, guard) {
  const points = new Set(), visited = new Set(), axes = [[1, -1], [1, 1], [1, 0], [0, 1]];
  if(b.size<=75){
    for(const line of axisLines(b.size)){
      guard?.check();let own=0,opponent=0;
      for(let k=0;k<line.length;k++){
        const value=b.cells[line[k]];if(value===player)own++;else if(value)opponent++;
        if(k>=5){const previous=b.cells[line[k-5]];if(previous===player)own--;else if(previous)opponent--;}
        if(k>=4&&own>=minimum&&!opponent)for(let j=k-4;j<=k;j++)if(!b.cells[line[j]])points.add(line[j]);
      }
    }
    return [...points].sort((a,c)=>a-c);
  }
  // Independently reconstruct ALL windows containing at least one own stone.
  // Every winning/forcing window contains >=3, so this is a complete sparse
  // scan, not a proximity heuristic. Particularly useful on huge empty boards.
  for (let anchor = 0; anchor < b.cells.length; anchor++) {
    if (anchor % 512 === 0) guard?.check();
    if (b.cells[anchor] !== player) continue;
    const ar = Math.floor(anchor / b.size), ac = anchor % b.size;
    for (let axis = 0; axis < 4; axis++) for (let offset = -4; offset <= 0; offset++) {
      const [dr, dc] = axes[axis], r = ar + offset * dr, c = ac + offset * dc;
      const er = r + 4 * dr, ec = c + 4 * dc;
      if (r < 0 || r >= b.size || c < 0 || c >= b.size || er < 0 || er >= b.size || ec < 0 || ec >= b.size) continue;
      const key = (r * b.size + c) * 4 + axis;
      if (visited.has(key)) continue;
      visited.add(key);
      let own = 0, blocked = false;
      const holes = [];
      for (let k = 0; k < 5; k++) {
        const at = (r + k * dr) * b.size + c + k * dc, p = b.cells[at];
        if (p === player) own++; else if (p) { blocked = true; break; } else holes.push(at);
      }
      if (!blocked && own >= minimum) for (const at of holes) points.add(at);
    }
  }
  return [...points].sort((a, b) => a - b);
}

export function referenceWins(b, p, rule, guard) {
  const points=new Set();
  if(b.size>75)for(const at of scan(b,p,4,guard))points.add(at);
  else for(const line of axisLines(b.size)){
    guard?.check();
    let own=0,opponent=0,hole=0;
    for(let k=0;k<line.length;k++){
      const at=line[k],cell=b.cells[at];
      if(!cell)hole^=at;else if(cell===p)own++;else opponent++;
      if(k>=5){const gone=line[k-5],previous=b.cells[gone];if(!previous)hole^=gone;else if(previous===p)own--;else opponent--;}
      if(k>=4&&own===4&&!opponent)points.add(hole);
    }
  }
  return [...points].sort((a,c)=>a-c).filter(at=>{
    guard?.check();
    // RIF black exact five overrides all forbidden patterns. A move that
    // actually completes that five is legal; white/freestyle wins are legal
    // too. No recursive three computation is needed for a real winning move.
    b.cells[at]=p;try{return rawWon(b,at,p,rule);}finally{b.cells[at]=0;}
  });
}

// Exhaustive independently ordered bounded decision search. Used at D-1 to
// reject all shorter wins; budget exhaustion is a rejection, never a proof.
export function referenceSearch(b, attacker, remaining, rule, guard, firstAt) {
  const defender = other(attacker), failed = new Set();
  const visit = (left, isRoot = false) => {
    guard.tick();
    if (left < 1) return false;
    const key = b.key() + ':' + left;
    if (failed.has(key)) return false;
    const wins = referenceWins(b, attacker, rule, guard);
    if (wins.length && (!isRoot || firstAt === undefined || wins.includes(firstAt))) return true;
    if (left < 2) return false;
    // Opposite ordering to the producer, and every candidate comes from a new
    // full geometry scan rather than the producer's incremental bookkeeping.
    for (const at of scan(b, attacker, 3, guard).reverse().filter(at => !isRoot || firstAt === undefined || at === firstAt)) {
      if (!referenceLegal(b, at, attacker, rule, guard)) continue;
      const good = b.withMove(at, attacker, () => {
        const wins = referenceWins(b, attacker, rule, guard);
        if (!wins.length || referenceWins(b, defender, rule, guard).length) return false;
        if (wins.length >= 2 || !referenceLegal(b, wins[0], defender, rule, guard)) return true;
        return b.withMove(wins[0], defender, () => visit(left - 1));
      });
      if (good) return true;
    }
    failed.add(key);
    return false;
  };
  return visit(remaining, true);
}

function same(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((x, y) => x - y)[i]); }

export function verify(puzzle, { timeMs = 30000, nodeLimit = 2000000, checkShortest = true } = {}) {
  const guard = budget({ timeMs, nodeLimit });
  try {
    const validated=boardFromPuzzle(puzzle),b=new ReferenceBoard(validated.size,validated.cells),attacker = playerId(puzzle.attacker), defender = other(attacker), rule = puzzle.rules;
    const fail = message => { throw new Error(message); };
    const initialCells=Uint8Array.from(b.cells),proofSupports=new Set(),shapeSteps=[];
    const shapeFixed=new Set((Array.isArray(puzzle.theme?.fixed)?puzzle.theme.fixed:[]).filter(s=>s?.player===attacker).map(s=>s.at));
    const recordShapeRuns=(origin,axes)=>{
      const ar=Math.floor(origin/b.size),ac=origin%b.size;
      for(let axis=0;axis<AXES.length;axis++){
        const [dr,dc]=AXES[axis],length=rawRun(b,origin,attacker,dr,dc);
        if(rule==='renju'&&attacker===BLACK?length!==5:length<5)continue;
        const strokes=[];
        if(shapeFixed.has(origin)&&initialCells[origin]===attacker)strokes.push(origin);
        for(const sign of [-1,1])for(let k=1;;k++){
          const r=ar+k*dr*sign,c=ac+k*dc*sign;
          if(r<0||r>=b.size||c<0||c>=b.size||b.cells[r*b.size+c]!==attacker)break;
          const q=r*b.size+c;if(shapeFixed.has(q)&&initialCells[q]===attacker)strokes.push(q);
        }
        if(strokes.length){
          if(!axes.has(axis))axes.set(axis,new Set());
          for(const q of strokes)axes.get(axis).add(q);
        }
      }
    };
    if(puzzle.theme?.complexity!==undefined&&puzzle.theme.kind!=='shape')fail('Shape complexity requires a shape');
    const recordSupports=origin=>{
      const ar=Math.floor(origin/b.size),ac=origin%b.size;
      for(const [dr,dc]of AXES){
        const length=rawRun(b,origin,attacker,dr,dc);
        if(rule==='renju'&&attacker===BLACK?length!==5:length<5)continue;
        if(initialCells[origin]===attacker)proofSupports.add(origin);
        for(const sign of [-1,1])for(let k=1;;k++){
          const r=ar+k*dr*sign,c=ac+k*dc*sign;
          if(r<0||r>=b.size||c<0||c>=b.size||b.cells[r*b.size+c]!==attacker)break;
          const q=r*b.size+c;if(initialCells[q]===attacker)proofSupports.add(q);
        }
      }
    };
    if (!Number.isInteger(puzzle.depth) || puzzle.depth < 1) fail('Invalid declared depth');
    if (referenceWins(b, attacker, rule, guard).length && puzzle.depth > 1) fail('Immediate five in starting position');
    const forbiddenTerminals=[];
    const replay = (node, attackingMove=1) => {
      guard.tick();
      if (!node || !Number.isInteger(node.at) || !referenceLegal(b, node.at, attacker, rule, guard)) fail('Missing proof or illegal attack');
      return b.withMove(node.at, attacker, () => {
        if (node.kind === 'five') {
          if (!rawWon(b, node.at, attacker, rule) || node.depth !== 1 || node.replies?.length) fail('False five terminal');
          recordSupports(node.at);
          return 1;
        }
        if (rawWon(b, node.at, attacker, rule)) fail('An already winning attack is mislabeled');
        const wins = referenceWins(b, attacker, rule, guard);
        if (!wins.length || !same(wins, node.wins)) fail('Missing or false winning points');
        for(const win of wins)b.withMove(win,attacker,()=>recordSupports(node.at));
        if(puzzle.theme?.complexity!==undefined){
          const axes=new Map();
          for(const win of wins)b.withMove(win,attacker,()=>recordShapeRuns(win,axes));
          shapeSteps.push({move:attackingMove,at:node.at,runs:[...axes].sort(([a],[b])=>a-b)
            .map(([axis,strokes])=>({axis,strokes:[...strokes].sort((a,b)=>a-b)}))});
        }
        if (referenceWins(b, defender, rule, guard).length) fail('Defender can immediately win');
        if (node.kind === 'unanswerable-four') {
          if (node.depth !== 2 || (wins.length < 2 && referenceLegal(b, wins[0], defender, rule, guard)) || node.replies?.length) fail('False unanswerable-four terminal');
          if(wins.length===1 && attacker===WHITE && rule==='renju') {
            const label=referenceForbidden(b,wins[0],guard);
            if(!label)fail('Forbidden block has no valid RIF reason');
            forbiddenTerminals.push({...label,attackAt:node.at,attackingMove});
          }
          return 2;
        }
        if (node.kind !== 'four' || wins.length !== 1 || !referenceLegal(b, wins[0], defender, rule, guard)) fail('Invalid simple four');
        // Exactly the complete set of replies which avoid immediate loss.
        // All other replies are covered by the two-ply five certificate.
        if (node.replies?.length !== 1 || node.replies[0].at !== wins[0]) fail('Defense coverage is incomplete');
        const depth = 1 + b.withMove(wins[0], defender, () => replay(node.replies[0].child,attackingMove+1));
        if (node.depth !== depth) fail('Inconsistent proof depth');
        return depth;
      });
    };
    const provedDepth = replay(puzzle.proof);
    if (provedDepth !== puzzle.depth) fail('Declared depth differs from proof');
    if(puzzle.ending!==undefined && !['five','forbidden'].includes(puzzle.ending))fail('Invalid ending declaration');
    if(puzzle.ending==='forbidden' || puzzle.forbidden!==undefined) {
      if(puzzle.ending!=='forbidden' || attacker!==WHITE || rule!=='renju' || forbiddenTerminals.length!==1)fail('Missing sole forbidden-block ending');
      const label=forbiddenTerminals[0],claimed=puzzle.forbidden;
      if(!claimed || claimed.at!==label.at || claimed.attackAt!==label.attackAt || claimed.attackingMove!==label.attackingMove || claimed.kind!==label.kind || claimed.coordinate?.row!==label.coordinate.row || claimed.coordinate?.col!==label.coordinate.col || !Array.isArray(claimed.runs) || claimed.runs.length!==label.runs.length || claimed.runs.some((n,i)=>n!==label.runs[i]))fail('Forbidden-block certificate differs from independent geometry');
      if(claimed.essentialWithinDepth!==true || claimed.relaxedRule!=='freestyle')fail('Missing forbidden-block essentiality certificate');
      if(referenceSearch(b,attacker,puzzle.depth,'freestyle',guard))fail('A VCF at the claimed depth survives without black forbidden rules');
    }
    if (checkShortest && puzzle.depth > 1 && referenceSearch(b, attacker, puzzle.depth - 1, rule, guard)) fail('A shorter VCF exists');
    if (puzzle.winningFirst !== undefined) {
      const candidates = scan(b, attacker, 3, guard);
      const roots = candidates.filter(at => referenceSearch(b, attacker, puzzle.depth, rule, guard, at)).sort((a, b) => a - b);
      if (!same(roots, puzzle.winningFirst)) fail('Winning first-move enumeration differs');
      if (puzzle.uniqueFirst && roots.length !== 1) fail('First move is not unique');
    } else if (puzzle.uniqueFirst) fail('Missing uniqueness certificate');
    if (!Array.isArray(puzzle.solution) || !puzzle.solution.length) fail('Missing complete replay');
    let expected = attacker, attacks = 0, ended = false;
    for (let i = 0; i < puzzle.solution.length; i++) {
      guard.check();
      const move = puzzle.solution[i], p = playerId(move.player);
      if (ended || p !== expected) fail('Invalid alternation or moves after five');
      if (move.at === null) {
        if (p !== defender || move.note !== 'pass') fail('Invalid pass');
        if(puzzle.ending==='forbidden') {
          const wins=referenceWins(b,attacker,rule,guard);
          if(wins.length!==1 || wins[0]!==puzzle.forbidden.at || !referenceForbidden(b,wins[0],guard))fail('Forbidden-ending replay does not reach the certified block');
        }
      } else {
        if (!referenceLegal(b, move.at, p, rule, guard)) fail('Illegal replay move');
        b.put(move.at, p);
        if (p === attacker) {
          attacks++;
          if (rawWon(b, move.at, p, rule)) ended = true;
          else if (!referenceWins(b, p, rule, guard).length) fail('Replay attack is not a four');
        } else if (rawWon(b, move.at, p, rule)) fail('Defender wins in replay');
      }
      expected = other(expected);
    }
    if (!ended || attacks !== puzzle.depth) fail('Replay must end with actual five at declared depth');
    // Optional immutable glyph rectangle: exact occupied cells, not a caption.
    if (puzzle.theme) {
      const initial = new ReferenceBoard(b.size,initialCells);
      const {mask,row,col,width,height,fixed}=puzzle.theme;
      if(!Array.isArray(mask)||!mask.length||mask.some(line=>typeof line!=='string'||!/^[01]+$/.test(line)||line.length!==mask[0].length)||height!==mask.length||width!==mask[0].length)fail('Invalid holiday glyph mask');
      if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||col<0||row+height>initial.size||col+width>initial.size||!Array.isArray(fixed))fail('Invalid holiday glyph rectangle');
      const glyphStones=new Map();
      for(const stone of fixed){
        if(!stone||!Number.isInteger(stone.at)||![BLACK,WHITE].includes(stone.player)||glyphStones.has(stone.at))fail('Invalid or duplicate holiday glyph stone');
        glyphStones.set(stone.at,stone.player);
      }
      let strokeCount=0;
      for(let r=0;r<height;r++)for(let c=0;c<width;c++){
        const at=(row+r)*initial.size+col+c,stroke=mask[r][c]==='1';
        if(stroke){strokeCount++;if(!glyphStones.has(at)||initial.cells[at]!==glyphStones.get(at))fail('Holiday glyph was changed');}
        else if(glyphStones.has(at)||initial.cells[at])fail('Holiday glyph background was changed');
      }
      if(strokeCount!==fixed.length)fail('Holiday glyph includes stones outside its mask');
      if (!Array.isArray(puzzle.theme.critical) || !puzzle.theme.critical.length) fail('No tactically critical glyph stone');
      const isShapeTheme = puzzle.theme.kind==='shape'||puzzle.theme.shape!==undefined||puzzle.theme.parts!==undefined;
      const isCustomShapeTheme = isShapeTheme && puzzle.theme.shape?.source==='custom-mask'
        && puzzle.theme.customCriticalMode==='parts';
      for (const stone of puzzle.theme.critical) {
        guard.check();
        if (!puzzle.theme.fixed.some(s=>s.at===stone.at && s.player===stone.player)) fail('Critical stone is not part of the glyph');
        const without = new ReferenceBoard(initial.size,initial.cells);
        // Custom-shape necessity is proved by deleting the complete
        // user-defined part below; no individual stroke is required to stand
        // alone. Built-in shapes retain their established anchor certificate.
        if (isCustomShapeTheme) {
          if (stone.player !== attacker || !proofSupports.has(stone.at)) fail('Shape critical stone is not used by the winning proof');
          continue;
        }
        without.undo(stone.at);
        if (referenceSearch(without,attacker,puzzle.depth,rule,guard)) fail('Removing the glyph stone still leaves a VCF within declared depth');
      }
      const participation=puzzle.theme.glyphParticipation;
      if(isShapeTheme){
        const theme=puzzle.theme,info=theme.shape;
        if(theme.kind!=='shape'||theme.participation!=='each-part'||participation!==undefined||theme.characters!==undefined||theme.textRaster!==undefined||initial.size>30)fail('Invalid shape participation declaration');
        const normalized=validateShape(info);
        if(!['builtin-outline','custom-mask'].includes(info.source)||theme.text!==normalized.label||JSON.stringify(normalized.mask)!==JSON.stringify(mask))fail('Shape definition differs from its mask');
        if(theme.customCriticalMode!==undefined&&!(info.source==='custom-mask'&&theme.customCriticalMode==='parts'))fail('Invalid custom shape critical mode');
        if(info.source==='custom-mask'&&theme.customCriticalMode===undefined&&theme.critical.length!==1)fail('Legacy custom shape critical evidence must contain one anchor');
        if(info.source==='builtin-outline'&&JSON.stringify({...normalized,source:info.source})!==JSON.stringify(shapeDefinition(normalized.id)))fail('Builtin shape definition was changed');
        if(!Array.isArray(theme.parts)||theme.parts.length!==normalized.parts.length)fail('Missing per-part shape evidence');
        if(theme.complexity!==undefined){
          const summary=summarizeShapeUse(shapeSteps,normalized,theme,initial.size);
          const expected={mode:'multi-step',...summary,steps:shapeSteps};
          if(!certificateEqual(theme.complexity,expected)||!meetsMultiStepUse(summary,puzzle.depth))fail('Shape complexity differs from independent winning-run evidence or misses its targets');
        }
        for(let i=0;i<normalized.parts.length;i++){
          const part=normalized.parts[i],claim=theme.parts[i];
          if(!claim||claim.index!==i||claim.id!==part.id||claim.label!==part.label||claim.deletionStatus!=='not-found'||!Array.isArray(claim.critical)||!claim.critical.length)fail('Invalid shape part evidence');
          const points=part.points.map(p=>(row+p.row)*initial.size+col+p.col);
          for(const stone of claim.critical)if(!points.includes(stone.at)||stone.player!==attacker||initialCells[stone.at]!==attacker||!proofSupports.has(stone.at))fail('Shape part support is not used by the winning proof');
          const without=new ReferenceBoard(initial.size,initial.cells);
          for(const at of points)without.undo(at);
          if(referenceSearch(without,attacker,puzzle.depth,rule,guard))fail('Removing a shape part still leaves a VCF within declared depth');
        }
      }
      if(participation!==undefined&&!['anchor','each-character'].includes(participation))fail('Invalid glyph participation mode');
      if(participation==='each-character'){
        const characters=[...puzzle.theme.text],boxes=puzzle.theme.textRaster?.glyphBoxes,claims=puzzle.theme.characters;
        if(!Array.isArray(boxes)||boxes.length!==characters.length||!Array.isArray(claims)||claims.length!==characters.length)fail('Missing per-character glyph evidence');
        const covered=new Set();
        for(let i=0;i<characters.length;i++){
          const box=boxes[i],claim=claims[i];
          if(!box||box.index!==i||(box.char??box.character)!==characters[i]||![box.row,box.col,box.width,box.height].every(Number.isInteger)||box.row<0||box.col<0||box.width<1||box.height<1||box.row+box.height>height||box.col+box.width>width)fail('Invalid character rectangle');
          if(!claim||claim.index!==i||claim.char!==characters[i]||claim.deletionStatus!=='not-found'||!claim.box||['row','col','width','height'].some(key=>claim.box[key]!==box[key]))fail('Character evidence differs from its glyph');
          const points=[];
          for(let r=box.row;r<box.row+box.height;r++)for(let c=box.col;c<box.col+box.width;c++){
            const at=(row+r)*initial.size+col+c;
            if(covered.has(at))fail('Character rectangles overlap');covered.add(at);
            if(glyphStones.has(at))points.push(at);
          }
          if(!points.length||!Array.isArray(claim.critical)||!claim.critical.length)fail('A character has no proof support');
          for(const stone of claim.critical)if(!points.includes(stone.at)||stone.player!==attacker||initialCells[stone.at]!==attacker||!proofSupports.has(stone.at))fail('Character support is not used by the winning proof');
          const without=new ReferenceBoard(initial.size,initial.cells);
          for(const at of points)without.undo(at);
          if(referenceSearch(without,attacker,puzzle.depth,rule,guard))fail('Removing a whole character still leaves a VCF within declared depth');
        }
        if([...glyphStones.keys()].some(at=>!covered.has(at)))fail('Character evidence does not cover the printed text');
      }
    }
    return { status: 'verified', valid: true, shortest: checkShortest, depth: puzzle.depth, nodes: guard.nodes, elapsedMs: guard.elapsedMs };
  } catch (e) {
    return { status: e instanceof BudgetExceeded ? 'budget' : 'invalid', valid: false, error: e.message, nodes: guard.nodes, elapsedMs: guard.elapsedMs };
  }
}
