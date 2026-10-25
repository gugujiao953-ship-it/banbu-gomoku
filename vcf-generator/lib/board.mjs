// Each instance owns its size and mutable state. No process-wide SIZE switch.
export const BLACK = 1, WHITE = 2;
export const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
export const other = p => 3 - p;
export const playerName = p => p === BLACK ? 'black' : 'white';
export const playerId = p => p === 'black' || p === 1 ? 1 : p === 'white' || p === 2 ? 2 : null;

// Only immutable geometry is shared. Counts, cells, active windows and rule
// caches remain instance-owned. Limit retained geometry to four phone/common
// sizes; a large board is built once for its instance and never retained here.
const geometryCache=new Map();
function geometryFor(size){
  if(geometryCache.has(size)){
    const value=geometryCache.get(size);geometryCache.delete(size);geometryCache.set(size,value);return value;
  }
  const windows=[],incidence=Array.from({length:size*size},()=>[]);
  for(const [dr,dc]of AXES)for(let r=0;r<size;r++)for(let c=0;c<size;c++){
    const er=r+4*dr,ec=c+4*dc;if(er<0||er>=size||ec<0||ec>=size)continue;
    const points=Object.freeze(Array.from({length:5},(_,k)=>(r+k*dr)*size+c+k*dc)),id=windows.length;
    windows.push(points);for(const q of points)incidence[q].push(id);
  }
  for(const ids of incidence)Object.freeze(ids);
  const value=Object.freeze({windows:Object.freeze(windows),incidence:Object.freeze(incidence)});
  if(size<=30){if(geometryCache.size>=4)geometryCache.delete(geometryCache.keys().next().value);geometryCache.set(size,value);}
  return value;
}

export class BudgetExceeded extends Error {}
export function budget({ timeMs = 10000, nodeLimit = 2000000, signal } = {}) {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isInteger(nodeLimit) || nodeLimit < 1) throw new Error('Invalid search budget');
  const started = performance.now();
  let nodes = 0;
  return {
    check() { if (signal?.aborted || performance.now() - started >= timeMs) throw new BudgetExceeded('Search interrupted'); },
    tick() { nodes++; if (nodes > nodeLimit) throw new BudgetExceeded('Node budget exhausted'); this.check(); },
    get nodes() { return nodes; }, get elapsedMs() { return performance.now() - started; },
  };
}

export function coordinates(index, size) { return { row: Math.floor(index / size), col: index % size }; }
export function coordName(index, size) {
  let c = index % size + 1, label = '';
  while (c) { c--; label = String.fromCharCode(65 + c % 26) + label; c = Math.floor(c / 26); }
  return label + (size - Math.floor(index / size));
}

// Incremental counts on ALL five-cell windows; candidate pruning is a necessary
// geometric condition, never a neighbourhood/beam approximation.
export class Board {
  constructor(size = 15, cells) {
    if (!Number.isInteger(size) || size < 5 || size > 361) throw new Error('Board size must be an integer in 5..361');
    this.size = size;
    if (cells && (cells.length !== size * size || Array.from(cells).some(p => !Number.isInteger(p) || p < 0 || p > 2))) throw new Error('Invalid board cells');
    this.cells = cells ? Uint8Array.from(cells) : new Uint8Array(size * size);
    if (this.cells.length !== size * size || this.cells.some(p => p > 2)) throw new Error('Invalid board cells');
    const geometry=geometryFor(size);this.windows=geometry.windows;this.incidence=geometry.incidence;
    this.counts = [null, new Uint8Array(this.windows.length), new Uint8Array(this.windows.length)];
    this.active = [null, new Set(), new Set()];
    for(let q=0;q<this.cells.length;q++)if(this.cells[q])for(const w of this.incidence[q])this.counts[this.cells[q]][w]++;
    for(let w=0;w<this.windows.length;w++)if(this.counts[1][w]>=3||this.counts[2][w]>=3)this.refresh(w);
    this.legalityCache = new Map();
    // 第 45 轮：整盘键字符串脏标记缓存。cells 只在构造器/put/undo 里变（全仓检索无旁路直写），
    // 所以这两处就是全部失效点；key() 返回同一个字符串对象，值与逐次 bytesBase64 逐字相同。
    this._keyCache = null;
  }
  inside(r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; }
  index(r, c) { return Number.isInteger(r) && Number.isInteger(c) && this.inside(r, c) ? r * this.size + c : -1; }
  key() {
    if (this._keyCache === null) this._keyCache = bytesBase64(this.cells);
    return this._keyCache;
  }
  refresh(w) {
    const black=this.counts[1][w],white=this.counts[2][w];
    if(black>=3&&!white)this.active[1].add(w);else this.active[1].delete(w);
    if(white>=3&&!black)this.active[2].add(w);else this.active[2].delete(w);
  }
  put(at, player) {
    if (!Number.isInteger(at) || at < 0 || at >= this.cells.length || this.cells[at] || ![1, 2].includes(player)) throw new Error('Invalid placement');
    this.cells[at] = player;
    this._keyCache = null;
    // active 只可能在两种瞬间换状态：自己这一路刚数到 3（且对方在该窗为 0）才进；对手原本在
    // active（其条件要求自己为 0）被这一子挤出去。计数从 4→5 之类本来就都在集合里，Set.add 不
    // 改变迭代顺序，所以跳过重算逐字等价——差分核过 4 种盘×2 规则×23444 步的 active 序列。
    const own = this.counts[player], rival = this.counts[3 - player];
    const ownSet = this.active[player], rivalSet = this.active[3 - player];
    for (const w of this.incidence[at]) {
      if (++own[w] === 3 && !rival[w]) ownSet.add(w);
      else if (rival[w] >= 3) rivalSet.delete(w);
    }
  }
  undo(at) {
    const p = this.cells[at];
    if (!p) throw new Error('Cannot undo an empty cell');
    this.cells[at] = 0;
    this._keyCache = null;
    // 取回这一子：自己掉到 2 才离开 active；掉到 0 且对手已 ≥3 时对手才重新进（中间值不可能变，
    // 因为对手的条件要求自己为 0）。
    const own = this.counts[p], rival = this.counts[3 - p];
    const ownSet = this.active[p], rivalSet = this.active[3 - p];
    for (const w of this.incidence[at]) {
      const n = --own[w];
      if (n === 2) ownSet.delete(w);
      else if (n === 0 && rival[w] >= 3) rivalSet.add(w);
    }
  }
  withMove(at, player, fn) { this.put(at, player); try { return fn(); } finally { this.undo(at); } }
  run(at, player, dr, dc) {
    const { row, col } = coordinates(at, this.size);
    const out = [at];
    for (const sign of [-1, 1]) for (let k = 1; ; k++) {
      const q = this.index(row + k * dr * sign, col + k * dc * sign);
      if (q < 0 || this.cells[q] !== player) break;
      out.push(q);
    }
    return out;
  }
  lengths(at, player) { return AXES.map(([dr, dc]) => this.run(at, player, dr, dc).length); }
  wonAt(at, player, rule) {
    const row=Math.floor(at/this.size),col=at%this.size,exact=rule!=='freestyle'&&player===BLACK;
    for(const [dr,dc]of AXES){
      let n=1;
      for(const sign of [-1,1])for(let k=1;;k++){const r=row+k*dr*sign,c=col+k*dc*sign;if(!this.inside(r,c)||this.cells[r*this.size+c]!==player)break;n++;}
      if(exact?n===5:n>=5)return true;
    }
    return false;
  }
  hasFive() { return this.counts[1].some(n=>n===5)||this.counts[2].some(n=>n===5); }
  fourGroups(at, player, rule) {
    const counts = this.counts[player], rival = this.counts[3 - player], NN = this.cells.length + 1;
    const out = [], keys = [];
    for (const w of this.incidence[at]) {
      if (counts[w] !== 4 || rival[w]) continue;
      const points = this.windows[w];
      let hole = -1;
      for (let k = 0; k < 5; k++) if (hole < 0 && !this.cells[points[k]]) hole = points[k];
      if (hole < 0) continue;
      if (!this.withMove(hole, player, () => this.wonAt(hole, player, rule))) continue;
      // 四个方向的 points 下标都严格递增（[1,-1] 的步长是 size-1，size≥5 时仍为正），
      // 所以去掉 hole 之后天然升序——旧写法的 .sort 是空转，这里直接按窗口顺序填。
      const stones = new Array(4);
      for (let k = 0, i = 0; k < 5; k++) if (points[k] !== hole) stones[i++] = points[k];
      const key = ((stones[0] * NN + stones[1]) * NN + stones[2]) * NN + stones[3];
      let g = -1;
      for (let i = 0; i < keys.length; i++) if (keys[i] === key) { g = i; break; }
      if (g < 0) { keys.push(key); out.push({ stones, wins: [hole] }); }
      // 旧写法是 accumulate 完再用 new Set 去重（保留首见顺序）；组内 wins 只有两端，内联判等逐字等价。
      else if (!out[g].wins.includes(hole)) out[g].wins.push(hole);
    }
    return out;
  }
  // Full recursive RIF 9.3: a supposed three counts only when an extension to
  // a straight four is legal, including recursively checking its double threes.
  legal(at, player, rule = 'renju', guard) {
    guard?.check();
    if (!Number.isInteger(at) || at < 0 || at >= this.cells.length || this.cells[at]) return false;
    if (rule === 'freestyle' || player === WHITE) return true;
    // With fewer than two existing stones in every unblocked five-window
    // through at, this move cannot make a three, four, five or overline.
    if (!this.incidence[at].some(w => this.counts[BLACK][w] >= 2 && this.counts[WHITE][w] === 0)) return true;
    const key = this.key() + ':' + at;
    if (this.legalityCache.has(key)) return this.legalityCache.get(key);
    const row = Math.floor(at / this.size), col = at % this.size, NN = this.cells.length + 1;
    const result = this.withMove(at, BLACK, () => {
      // 第 45 轮：四方向长度内联（原来 AXES.map＋每向 run() 建一个数组＝每次 5 个分配）。
      // 判据顺序与原文一致：先「恰好 5」优先，再「≥6」判禁手。
      let hasFive = false, hasOverline = false;
      for (const [dr, dc] of AXES) {
        let n = 1;
        for (const sign of [-1, 1]) for (let k = 1; ; k++) {
          const q = this.index(row + k * dr * sign, col + k * dc * sign);
          if (q < 0 || this.cells[q] !== BLACK) break;
          n++;
        }
        if (n === 5) hasFive = true; else if (n >= 6) hasOverline = true;
      }
      if (hasFive) return true; // RIF exact five takes priority.
      if (hasOverline) return false;
      if (this.fourGroups(at, BLACK, rule).length >= 2) return false;
      const triples = new Set();
      // 第 45 轮：六格线内联判定，替掉 line/middle 的每窗口数组分配；三重组身份由
      // 「升序三子 join 逗号串」换成同基数（NN＝格数＋1，逐位 < NN）的数值键——分组关系一一对应。
      for (const [dr, dc] of AXES) for (let start = -4; start <= -1; start++) {
        const e0 = this.index(row + start * dr, col + start * dc);
        const m0 = this.index(row + (start + 1) * dr, col + (start + 1) * dc);
        const m1 = this.index(row + (start + 2) * dr, col + (start + 2) * dc);
        const m2 = this.index(row + (start + 3) * dr, col + (start + 3) * dc);
        const m3 = this.index(row + (start + 4) * dr, col + (start + 4) * dc);
        const e5 = this.index(row + (start + 5) * dr, col + (start + 5) * dc);
        if (e0 < 0 || m0 < 0 || m1 < 0 || m2 < 0 || m3 < 0 || e5 < 0) continue;
        if (this.cells[e0] || this.cells[e5]) continue;
        if (at !== m0 && at !== m1 && at !== m2 && at !== m3) continue;
        let blacks = 0, whites = 0, extension = -1;
        const v0 = this.cells[m0], v1 = this.cells[m1], v2 = this.cells[m2], v3 = this.cells[m3];
        if (v0 === BLACK) blacks++; else if (v0 === WHITE) whites++; else extension = m0;
        if (v1 === BLACK) blacks++; else if (v1 === WHITE) whites++; else extension = m1;
        if (v2 === BLACK) blacks++; else if (v2 === WHITE) whites++; else extension = m2;
        if (v3 === BLACK) blacks++; else if (v3 === WHITE) whites++; else extension = m3;
        if (blacks !== 3 || whites) continue;
        if (!this.legal(extension, BLACK, rule, guard)) continue;
        const valid = this.withMove(extension, BLACK, () => !this.wonAt(extension, BLACK, rule) && this.fourGroups(extension, BLACK, rule).some(g => g.wins.length === 2 && g.stones.includes(at)));
        if (valid) {
          const s = [m0, m1, m2, m3].filter(q => q !== extension).sort((a, b) => a - b);
          triples.add((s[0] * NN + s[1]) * NN + s[2]);
        }
        if (triples.size >= 2) return false;
      }
      return true;
    });
    if (this.legalityCache.size >= 20000) this.legalityCache.clear();
    this.legalityCache.set(key, result);
    return result;
  }
  winningPoints(player, rule, guard) {
    const candidates = new Set();
    for (const w of this.active[player]) if (this.counts[player][w] === 4) for (const q of this.windows[w]) if (!this.cells[q]) candidates.add(q);
    // Actual exact five has RIF priority, so its legality is settled by the
    // completed run itself; white/freestyle winning moves are unrestricted.
    return [...candidates].filter(q => {guard?.check();return this.withMove(q,player,()=>this.wonAt(q,player,rule));}).sort((a, b) => a - b);
  }
  forcingMoves(player, rule, guard) {
    const candidates = new Set();
    for (const w of this.active[player]) for (const q of this.windows[w]) if (!this.cells[q]) candidates.add(q);
    const moves = [];
    for (const at of [...candidates].sort((a, b) => a - b)) {
      guard?.check();
      if (!this.legal(at, player, rule, guard)) continue;
      const info = this.withMove(at, player, () => ({ five: this.wonAt(at, player, rule), wins: this.fourGroups(at, player, rule).flatMap(g => g.wins) }));
      if (info.five || info.wins.length) moves.push({ at, five: info.five, wins: [...new Set(info.wins)].sort((a, b) => a - b) });
    }
    return moves;
  }
}

export function boardFromPuzzle(puzzle) {
  if (!puzzle || !Number.isInteger(puzzle.size)) throw new Error('Missing board size');
  if (!['renju', 'freestyle'].includes(puzzle.rules)) throw new Error('Unsupported rules');
  if (!playerId(puzzle.attacker)) throw new Error('Invalid attacker');
  const b = new Board(puzzle.size);
  for (const p of [1, 2]) {
    const stones = puzzle.stones?.[playerName(p)];
    if (!Array.isArray(stones)) throw new Error('Missing stones');
    for (const s of stones) b.put(b.index(s.row, s.col), p);
  }
  if (b.hasFive()) throw new Error('Starting board already contains five');
  const black = puzzle.stones.black.length, white = puzzle.stones.white.length;
  if (playerId(puzzle.attacker) === BLACK ? black !== white : black !== white + 1) throw new Error('Stone count does not match side to move');
  return b;
}
import { bytesBase64 } from './portable.mjs';
