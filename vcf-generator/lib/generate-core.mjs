import { Board, BLACK, budget, BudgetExceeded, coordinates, other, playerId } from './board.mjs';
import { solve, principalVariation } from './solve.mjs';
import { makeTheme, textMask } from './theme.mjs';
import { addForbiddenConstraints } from './forbidden.mjs';
import { constructCompact, balanceCompact } from './compact.mjs';
import { shapeBoxes } from './shapes.mjs';
import { causalWindows } from './temporal.mjs';
import { searchHardPosition } from './hard-search.mjs';
import { createRejectionLedger } from './contracts.mjs';
import { canonicalKey, decoyAudit, compactness, compactScore } from './quality.mjs';
import { runAttempt } from './orchestration/attempt.mjs';
import { normalizeRequest } from './orchestration/normalize.mjs';
import { createSearchPlan, allocateSearchStage } from './orchestration/search-plan.mjs';

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(xs, rng) { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; }
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];

// Constraint synthesis from EMPTY board. Each new four shares the preceding
// attack point. It is inactive until that attack is actually played. Both holes
// in each five-cell window remain empty; the solver rejects the wrong order,
// unexpected crossings, shortcuts, forbidden moves and opponent counter-wins.
function construct(size, depth, attacker, rng, theme, { layout, constructionNodes, guard, ending, forbiddenKind, glyphParticipation, glyphBoxes, shapeInfo }) {
  const cells = new Uint8Array(size * size), reserved = new Set(theme?.protectedCells || []), used = new Set(), path = [], blocks = [], backEnds = [];
  const geometry=new Board(size),attackTimes=new Int16Array(size*size).fill(-1),defenseTimes=new Int16Array(size*size).fill(-1);
  const defender = other(attacker);
  for (const s of theme?.fixed || []) cells[s.at] = s.player;
  const index = (r, c) => r >= 0 && r < size && c >= 0 && c < size ? r * size + c : -1;
  const fixed = new Map((theme?.fixed || []).map(s => [s.at, s.player]));
  const regions=shapeInfo?shapeBoxes(shapeInfo):glyphParticipation==='each-character'?(glyphBoxes||[]):[];
  const boxes = theme ? regions.map(box => ({ ...box, row: theme.row + box.row, col: theme.col + box.col,
    ...(box.points?{members:new Set(box.points.map(p=>(p.row+theme.row)*size+p.col+theme.col))}:{}) })) : [];
  const glyphOf = q => boxes.findIndex(box => box.members?box.members.has(q):Math.floor(q / size) >= box.row && Math.floor(q / size) < box.row + box.height && q % size >= box.col && q % size < box.col + box.width);
  // Membership is queried for every candidate support.  Precompute the
  // rectangular theme area once so large custom masks avoid repeated
  // floor/mod arithmetic during construction.
  const themeArea = theme ? new Uint8Array(cells.length) : null;
  if (themeArea) {
    const top = Math.max(0, theme.row), bottom = Math.min(size, theme.row + theme.height);
    const left = Math.max(0, theme.col), right = Math.min(size, theme.col + theme.width);
    for (let row = top; row < bottom; row++) themeArea.fill(1, row * size + left, row * size + right);
  }
  const inTheme = q => !!themeArea?.[q];
  // Find empty entry points whose terminal four borrows a stroke from a
  // character. These points order the search only; all ordinary causal,
  // legality, shortest-win and independent verification gates still apply.
  const targetModules = boxes.length ? (theme.entryTargets ??= boxes.map((box, glyph) => {
    const targets = [];
    for (let prev = 0; prev < size * size; prev++) {
      if (prev % 128 === 0) guard.check();
      if (cells[prev]) continue;
      const row = Math.floor(prev / size), col = prev % size;
      for (let direction = 0; direction < DIRECTIONS.length; direction++) for (let offset = 1; offset <= 3; offset++) {
        const [dr, dc] = DIRECTIONS[direction], line = Array.from({ length: 5 }, (_, k) => index(row + k * dr, col + k * dc));
        const behind = index(row - dr, col - dc), beyond = index(row + 5 * dr, col + 5 * dc);
        if (line.some(q => q < 0) || behind < 0 || beyond < 0) continue;
        const next = line[offset], support = line.slice(1, 4).filter(q => q !== next);
        if (!support.some(q => fixed.get(q) === attacker && glyphOf(q) === glyph)) continue;
        const assignments = [...line.slice(1), behind, beyond].map(q => [q, support.includes(q) ? attacker : 0]);
        if (assignments.some(([q, p]) => fixed.has(q) ? fixed.get(q) !== p : cells[q] || (inTheme(q) && p !== 0))) continue;
        targets.push({ prev, direction, offset });
      }
    }
    return targets;
  })) : [];
  const starts = theme ? shuffle(theme.fixed.filter(s => s.player === attacker).map(s => s.at), rng) : layout === 'staircase' ? [index(2, 2)] : layout === 'snake' ? [index(3, 3)] : shuffle(Array.from({ length: (size - 4) ** 2 }, (_, i) => index(2 + Math.floor(i / (size - 4)), 2 + i % (size - 4))), rng);
  // Reject premature static fours incrementally, before wasting a full solve.
  // A candidate's future moves are still EMPTY here, not silently pre-placed.
  const staticFour = changed => changed.some(at => {
    const p = cells[at];
    if (!p) return false;
    for(const id of geometry.incidence[at]){
      let own=0,blocked=false;
      for(const q of geometry.windows[id]){if(cells[q]===p)own++;else if(cells[q]){blocked=true;break;}}
      if(!blocked&&own>=4)return true;
    }
    return false;
  });
  const causal = (changed, stage) => {
    const affected=new Set();
    for(const at of changed)for(const id of geometry.incidence[at])affected.add(id);
    // The same chronological constraint is represented by its first activation
    // event. Reversed-hole refutations remain included, without replaying each
    // prior turn or rebuilding the window geometry at every candidate.
    return causalWindows(geometry.windows,affected,cells,attackTimes,defenseTimes,path,blocks,backEnds,stage,depth,attacker,ending);
  };
  let nodes = 0;
  const extend = (prev, stage, lastDirection) => {
    guard.check();
    if (++nodes > constructionNodes) return false;
    if (stage === depth - 1) {
      if(ending!=='forbidden')return true;
      const result=addForbiddenConstraints({cells,reserved,path,blocks},size,forbiddenKind,rng,guard,theme);
      return !!result;
    }
    const { row, col } = coordinates(prev, size), terminal = stage === depth - 2;
    let choices = [];
    if (layout === 'staircase') choices = shuffle([1, 2, 3], rng).map(offset => ({ direction: stage % 2 ? 2 : 0, offset }));
    else for (let direction = 0; direction < DIRECTIONS.length; direction++) for (const offset of [1, 2, 3]) {
      if (lastDirection !== null && direction % 4 === lastDirection % 4) continue;
      choices.push({ direction, offset });
    }
    if (layout !== 'staircase') shuffle(choices, rng);
    if (layout === 'snake') {
      // A raster route is only a search ORDER. No geometry or candidate is
      // accepted without all the ordinary causal constraints and final proofs.
      const band = Math.floor((row - 3) / 10), right = band % 2 === 0;
      const atTurn = right ? col > size - 10 : col < 9;
      const targetR = atTurn ? 3 + (band + 1) * 10 : 6 + band * 10;
      const targetC = atTurn ? col : right ? size - 6 : 5;
      const score = choice => {
        const [dr, dc] = DIRECTIONS[choice.direction];
        return Math.abs(row + dr * choice.offset - targetR) * 2 + Math.abs(col + dc * choice.offset - targetC);
      };
      choices.sort((a, b) => score(a) - score(b));
    }
    const missingGlyphs = boxes.map((box, glyph) => glyph).filter(glyph => !theme.fixed.some(s => s.player === attacker && used.has(s.at) && glyphOf(s.at) === glyph));
    // Near the end, a missing character can no longer be left to a soft
    // routing preference: reserve one remaining module for each character.
    // This rejects impossible branches during construction instead of after
    // several full solves and keeps every printed character tactically useful.
    if (missingGlyphs.length && depth - 1 - stage <= missingGlyphs.length) {
      choices = choices.filter(choice => {
        const [dr, dc] = DIRECTIONS[choice.direction];
        const line = Array.from({ length: 5 }, (_, k) => index(row + k * dr, col + k * dc));
        const support = line.slice(1, 4).filter(q => q >= 0 && q !== line[choice.offset]);
        return support.some(q => fixed.get(q) === attacker && missingGlyphs.includes(glyphOf(q)));
      });
    }
    if (boxes.length && stage >= Math.floor(depth / 2)) {
      const missing = missingGlyphs;
      if (missing.length) {
        const targets = targetModules[missing[0]].filter(target => !used.has(target.prev));
        if (targets.length) {
          const score = choice => {
            const [dr, dc] = DIRECTIONS[choice.direction], r = row + dr * choice.offset, c = col + dc * choice.offset;
            return Math.min(...targets.map(target => Math.max(Math.abs(r - Math.floor(target.prev / size)), Math.abs(c - target.prev % size))));
          };
          choices.sort((a, b) => score(a) - score(b));
        }
      }
    }
    for (const choice of choices) {
      const [dr, dc] = DIRECTIONS[choice.direction], { offset } = choice;
      const line = Array.from({ length: 5 }, (_, k) => index(row + k * dr, col + k * dc));
      const behind = index(row - dr, col - dc), beyond = index(row + 5 * dr, col + 5 * dc);
      // Both ends must exist, including terminal straight-four endpoints.
      if (line.some(q => q < 0) || behind < 0 || beyond < 0) continue;
      const next = line[offset], support = line.slice(1, 4).filter(q => q !== next);
      const assignments = [...line.slice(1), behind, beyond].map(q => [q, support.includes(q) ? attacker : q === behind && (!terminal || ending === 'forbidden') ? defender : 0]);
      const inGlyph = q => theme && Math.floor(q/size)>=theme.row && Math.floor(q/size)<theme.row+theme.height && q%size>=theme.col && q%size<theme.col+theme.width;
      // Inside the word, only actual stroke stones may act as supports;
      // background cells remain empty in the initial diagram. Empty response
      // points inside a glyph rectangle may be used later during the answer.
      if (assignments.some(([q, p]) => used.has(q) || (fixed.has(q) ? fixed.get(q) !== p : cells[q] || (inGlyph(q) && p !== 0)))) continue;
      const newlyReserved = assignments.map(([q]) => q).filter(q => !reserved.has(q));
      const newlyPlaced = assignments.filter(([q,p]) => p && !cells[q]);
      for (const [q] of assignments) { reserved.add(q); used.add(q); }
      for (const [q,p] of newlyPlaced) cells[q] = p;
      path.push(next);
      blocks.push(line[4]); backEnds.push(behind);
      attackTimes[next]=stage;defenseTimes[line[4]]=stage;
      if (!staticFour([...support, behind]) && causal([...support, behind, line[4]], stage) && extend(next, stage + 1, choice.direction)) return true;
      path.pop();
      blocks.pop(); backEnds.pop();
      attackTimes[next]=-1;defenseTimes[line[4]]=-1;
      for (const [q] of newlyPlaced) cells[q] = 0;
      for (const [q] of assignments) used.delete(q);
      for (const q of newlyReserved) reserved.delete(q);
    }
    return false;
  };
  for (const at of starts.slice(0, 100)) {
    if (!theme && (reserved.has(at) || cells[at])) continue;
    if (!theme) { cells[at] = attacker; reserved.add(at); }
    used.add(at);
    if (extend(at, 0, null)) return { cells, reserved, path, nodes, ...(theme ? { glyphAnchor: at } : {}) };
    used.delete(at);
    if (!theme) { cells[at] = 0; reserved.delete(at); }
    if (nodes > constructionNodes) break;
  }
  return null;
}

function balance(candidate, size, attacker, rule, rng, theme, guard) {
  const b = new Board(size, candidate.cells), defender = other(attacker);
  if (b.hasFive() || b.winningPoints(1, rule, guard).length || b.winningPoints(2, rule, guard).length) return null;
  let black = b.cells.filter(p => p === 1).length, white = b.cells.filter(p => p === 2).length;
  const need = attacker === BLACK ? black - white : black - white - 1;
  const fillPlayer = need >= 0 ? 2 : 1;
  const tactical = [...b.cells.keys()].filter(q => b.cells[q] || candidate.path.includes(q));
  const distance = q => { const r = Math.floor(q / size), c = q % size; return tactical.reduce((d, at) => Math.min(d, Math.max(Math.abs(r - Math.floor(at / size)), Math.abs(c - at % size))), size); };
  const free = shuffle([...b.cells.keys()].filter(q => !b.cells[q] && !candidate.reserved.has(q) && !theme?.protectedCells.has(q)), rng);
  const distances = new Map(free.map(q => [q, distance(q)]));
  // Prefer the tactical cluster's perimeter to remote edge padding. Safe
  // isolation of same-colour stones and the final solve remain mandatory.
  free.sort((a, b) => Math.abs(distances.get(a) - 2) - Math.abs(distances.get(b) - 2));
  let left = Math.abs(need);
  const baselineForces = new Set(b.forcingMoves(defender, rule, guard).map(m => m.at));
  for (const at of free) {
    if (!left) break;
    guard.check();
    const r = Math.floor(at / size), c = at % size;
    let crowded = false;
    for (let dr = -2; dr <= 2 && !crowded; dr++) for (let dc = -2; dc <= 2; dc++) {
      const q = b.index(r + dr, c + dc);
      if (q >= 0 && b.cells[q] === fillPlayer) { crowded = true; break; }
    }
    if (crowded) continue;
    // Balance is a legality condition, NOT unrestricted decorative noise.
    if (!b.legal(at, fillPlayer, rule, guard)) continue;
    const safe = b.withMove(at, fillPlayer, () => !b.hasFive() && !b.winningPoints(defender, rule, guard).length && b.forcingMoves(defender, rule, guard).every(m => baselineForces.has(m.at)));
    if (safe) { b.put(at, fillPlayer); left--; }
  }
  return left ? null : b;
}

export { canonicalKey } from './quality.mjs';

function generateAtSize(options = {}) {
  const { count = 1, depth = 5, size = 15, attacker: side = 'black', rules = 'renju', seed = 7, layout = 'free', text, mask, uniqueFirst = false, ending = 'five', forbiddenKind = 'any',
    timeMs = 30000, solveMs = 5000, verifyMs = 15000, maxAttempts = 100, constructionNodes = 10000, deepWeave = true, signal, onProgress = () => {} } = options;
  const attacker = playerId(side), glyphParticipation = options.glyphParticipation ?? (options.textRaster?.glyphBoxes ? 'each-character' : 'anchor');
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Invalid remaining count');
  if (!Number.isInteger(depth) || depth < 3 || depth > 500) throw new Error('Target depth must be in 3..500 attacker moves, including final five');
  if (!Number.isInteger(size) || size < 5 || size > 361 || !attacker || !['renju', 'freestyle'].includes(rules) || !['free', 'staircase', 'snake', 'compact'].includes(layout)) throw new Error('Invalid generation options');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isInteger(constructionNodes) || constructionNodes < 1 || !Number.isInteger(seed) || !Number.isFinite(solveMs) || solveMs <= 0 || !Number.isFinite(verifyMs) || verifyMs <= 0) throw new Error('Invalid attempt budget or seed');
  if (options.naturalStyle !== undefined && typeof options.naturalStyle !== 'boolean') throw new Error('naturalStyle must be a boolean');
  if (options.simple !== undefined && typeof options.simple !== 'boolean') throw new Error('simple must be a boolean');
  if (2 * depth - 1 > size * size) throw new Error('There are not enough intersections even on an empty board for this depth');
  const shapeInfo=options.shapeInfo;
  const rng = random(seed), guard = budget({ timeMs, signal }), basePhase=attacker===BLACK?0:2;
  const hardRng = options.hardSearch === true ? random(seed ^ 0x51CF29A3) : null;
  // Keep decorative themes in the central tactical area. The old default put
  // text at the lower edge, which made the printed strokes look unrelated to
  // the VCF route and wasted most of the available board.
  const themeRows = mask || (text ? textMask(text) : null);
  const themeOrigin = (shapeInfo || themeRows) ? {
    row: Math.max(0, Math.floor((size - themeRows.length) / 2)),
    col: Math.max(0, Math.floor((size - themeRows[0].length) / 2)),
  } : undefined;
  const themeOptions={text,mask,...(themeOrigin?{origin:themeOrigin}:{})};
  const attemptState = {
    theme: makeTheme(size,{...themeOptions,phase:basePhase,...(text && [...text].length >= 3 ? { colorSeed: seed } : {})}),
    themePhase: basePhase,
    deepFallback: null,
  };
  const remainingTime = cap => {
    guard.check();
    const ms = timeMs - guard.elapsedMs;
    if (ms <= 0) throw new BudgetExceeded('Search interrupted');
    return Math.min(cap, ms);
  };
  if (typeof uniqueFirst !== 'boolean') throw new Error('uniqueFirst must be a boolean');
  const puzzles = [], seen = new Set(), rejected = createRejectionLedger();
  let attempts = 0, timedOut = false;
  const compactSearch={deepest:0};
  // Deep selection uses the request budget, including on fixed 15-line boards.
  // Stage budgets already subtract initialization time: a 60-second request
  // receives slightly less than 60000ms and would otherwise skip selection.
  // Actual search and selection windows still use the remaining stage budget.
  const lotteryMs = options.totalTimeMs ?? timeMs;
  const deepLottery = options.simple !== true && options.naturalStyle === true && layout === 'compact' &&
    ending === 'five' && !attemptState.theme && !shapeInfo && depth > 30 && depth <= 100 && count === 1 && lotteryMs >= 60000;
  // 第 51 轮：深档岔路择优的退路（只给 31-40 手用）。抽奖窗口关掉、或尝试/预算用完时交回它。
  const releaseDeepFallback = () => {
    if (!attemptState.deepFallback || puzzles.length >= count) return false;
    const best = attemptState.deepFallback;
    attemptState.deepFallback = null;
    seen.add(best.key);
    if (best.baseKey) seen.add(best.baseKey);
    puzzles.push(best.puzzle);
    onProgress({ attempts, accepted: puzzles.length, requested: count, depth, size, rejected: { ...rejected } });
    return true;
  };
  // 第 58 轮：≤30 手的「多抽已验题＋按紧凑度择优」。R57 实测这段供给很便宜（15 路 22–30 手首道过门
  // 候选只要 1–2 次尝试／0.3–0.9s CPU，而这段考卷预算是 45–60 秒），于是把"第一道过门就交"换成
  // "窗口内抽满 4 道、交最紧凑那道"。排序键：块数少 → 跨度小 → 先到。验收一条没减（每条候选都已过
  // 精确求解／最短解／唯一首手／独立验题／完整重放／第二解与证不死复核），窗口关掉或抽不满也立刻把
  // 目前最好那道交出去，所以不可能空手而归。作用域与 deepLottery 天然不相交（这条 ≤30 手、那条 >30 手）。
  // 第 72 轮：作用域放开到"≤12 手不限名额数＋≥15 秒"，13–30 手保持 R58 落地态（单道＋≥45 秒）。
  // 放开的原因：应用一条链都没吃到 R58——generator.worker.ts:26/38 是"每个名额一次 count:1、
  // timeMs=seconds*1000"，页面默认 15 秒；vcf-gen.worker.ts:41/66 的挑战补题浅档是 20 秒；
  // 批量档（count 5/10：CLI/jobs 出题、bench 快档五卷）还被 `count === 1` 单独挡在门外。
  // 深度切在 12 手是实测定的（同轮配对 3 轮）：≤12 手每名额抽 2 留 1 赚 D8 +0.0473／D12 +0.0570，
  // 墙钟 ×1.33／×1.38；而 13–30 手同一条机制在 D20 上退 0.0513、密度 0.371→0.294、墙钟 ×3.83
  // （20 手的题面形状由构造期模块布局定死，"块数少"那一级会把题面挑成更长的细条）。与第 63 轮
  // "跨度硬门唯一付得起的作用域是普通题 ≤12 手"是同一道界。
  // 时间判据按**调用方总预算**判（`options.totalTimeMs ?? timeMs`，照第 54 轮 `lotteryMs` 的先例）。
  // 原因（第 75 轮实测）：`generate()` 发给每个阶段的是 `timeMs − guard.elapsedMs`，而 `elapsedMs` 用
  // `performance.now()`（亚毫秒也在走，`resolveSizePolicy`＋一次 `guard.check()` 就够它 >0），所以页面
  // 默认 15 秒档拿到的阶段预算恒为 1499x ms ⇒ 旧写法 `timeMs >= 15000` **恒假** ⇒ 应用主链（15 秒单道、
  // 以及扩盘时只分到 2/3 预算的首阶段）从来没进过这套择优。第 73 轮把"读数一字不变"解释成
  // "首道候选就落带"，实为作用域根本没打开；本轮才是真正把它打开。
  // 13–30 手那半条判据保持不动（`timeMs >= 45000`），它与第 73/74 轮的读数逐字可比。
  const shortlistMs = options.totalTimeMs ?? timeMs;
  // 第 77 轮：作用域放开到抓禁手，但只在 ≤12 手。抓禁手在应用里**也是** naturalStyle＋compact
  // （`generator.worker.ts:34/55` 对所有 kind 都传），三轮以来它一直是"首道过门就交"，所以 bench 的
  // 抓禁手卷最差题自然度恒为 0.4513（密度 0.216）。深度切在 12 手沿用第 73 轮那道实测界（13–30 手
  // 的"块数优先"会把题面挑成长条），也避开第 63 轮证死的"把跨度端改动推给抓禁手"。
  // 这条只扩"哪些调用形态参与择优"，不新增也不放松任何验收：短名单每条候选都已过全部硬门，
  // 且窗口关掉／尝试用不完都照样交目前最好那道（`releaseShortlist`），不可能空手而归。
  const shortlistEnding = ending === 'five' || (ending === 'forbidden' && depth <= 12);
  // 第 78 轮：作用域放开到**内置图案·标准复杂度**档，同样只在 ≤12 手。取证（`artifacts/iter/round78/census2.mjs`）
  // 先纠正一条贯穿第 58–77 轮的说法：图案候选**每次都走到短名单收集点**（D8 卷 5/5 个名额命中），
  // 挡住的只是作用域里那两条——`!theme`（文字与图案都有 theme）与 `!shapeInfo`。而 `prepareShapeOptions`
  // （`shapes.mjs:85-105`）把 `shape:'fish-small'` 这类内置轮廓也补成 `shapeInfo`，所以 bench 的图案卷、
  // 页面下拉框里的内置形状全都走 `shapeInfo` 这条路；真正区分内置／手绘的是 `shapeInfo.source`
  // （`'builtin-outline'`／`'custom-mask'`，`shapes.mjs:88-90` 写死并校验）。
  // 于是这条判据＝"有 theme、非文字、非手绘轮廓、非多步复杂度、≤12 手"。两条排除都有实测账：
  // 手绘轮廓不进（它的墙是 multi-step 构造，第 27 轮）；文字档不进（compact 文字题必须带
  // `textRaster.glyphBoxes`，本轮没有便宜的多 seed 池能量它）。**多步复杂度必须排除**——本轮第一版没排它，
  // `shape-pool.mjs` 量到"内置图案 multi-step D8 批量 5 道 60s × 3 seed"出题 **12/15 → 8/15**、每题
  // 4.41s → 6.62s：那条链本来就烧穿预算（pre 也有 3 个 incomplete、attempts 撞满 300），每名额多抽一道把
  // 它从"勉强交完"打成"交不出"。与第 73 轮"13–30 手付不起"是同一类账。
  // 仍是"两道都已过全部硬门的候选交哪一道"，不新增也不放松任何验收（短名单不可能拒绝一道本来会交出的题：
  // 窗口关掉／尝试用完／预算烧穿都补交手里最好那道，见 `:748-756`）。
  const shortlistTheme = !attemptState.theme || (depth <= 12 && !text && shapeInfo?.source !== 'custom-mask' && options.shapeComplexity !== 'multi-step');
  const shortlistScope = options.simple !== true && options.naturalStyle === true && layout === 'compact' &&
    shortlistEnding && shortlistTheme && depth <= 30 &&
    (depth <= 12 ? shortlistMs >= 15000 : count === 1 && timeMs >= 45000);
  // 档位是扫出来的（`probe58b`，15 路 D22/D26/D30 × seed 44–47 × pre/k2/k3/k4 四臂轮转）：
  // 逐题自然度均值 0.6263 → k2 0.6460 / k3 0.6443 / k4 0.6497，块中位 7 → 6（k2 就够），
  // 最差那道 0.4446 → **k2 0.5354**（k3/k4 反而 0.5220），而 CPU 合计 26.2s → k2 42.9s(+64%) /
  // k4 109.9s(+320%) ⇒ 增益在 k2 就饱和，多抽只是烧钱。
  // 首道候选就达标的那卷代价与改动前相同，钱只花在题面真有缺陷的卷上。
  // `SHORTLIST_GOAL`＝块数与跨度**同时**落到人类带（`components=[1,3]`、`spanMax=[6,10]`，也就是
  // compactPassRate 那两条）就当场交出去，不再多抽。第 72 轮补上跨度那半条：只看块数的旧判据在现网态
  // 几乎每次都直接命中（快档五卷块中位已经 2–3），于是"择优"从来没真正比过两道题，等于空转。
  // 第 74 轮把达标判据换成"三项综合分＝满值"（再加 density [0.39,0.54]，与 `qa/score.mjs` 同形）。
  // 实测的洞（`round74/probe-sl.mjs`，R73 落地态 D8/D12 各 5 个名额）：旧判据下 D8 有 3/5、D12 有 3/5
  // 个名额在第一道候选就"达标"直接交题，整卷只有 1–2 次真正比过两道题 ⇒ 只换排序键读不出任何东西
  // （两臂快档逐项逐字相同）。其中两道的密度是 0.314／0.389，都在人类带外。
  // 作用域仍然只到 12 手；13–30 手沿用 R58"只看块数"，逐字不变。
  const SHORTLIST_MAX = 2, SHORTLIST_WINDOW = 0.7, SHORTLIST_GOAL = 3, SHORTLIST_SCORE = 3;
  // 第 76 轮：排序主键给 >2 块的候选一个折价。原因是综合分看不见 compactPassRate 的单位——
  // `components` 的人类带是 [1,3]，2 块与 3 块拿到的 credit 都是 1，而对外读数的过线判据是
  // 「跨 ≤10 **且** 块 ≤2」（`qa/score.mjs:199`）。折价只改"两道都已合格的候选交哪一道"，
  // 达标判据（`score`）／抽样数／验收一条没动，所以尝试数与成功率按构造逐字不变。
  // 0.5 是取证扫出来的拐点（`artifacts/iter/round76/probe-sweep.mjs`，204 次 release／147 次真比两道）：
  // p=0.5 翻转 12 次＝过线转正 11／转负 0，放弃的综合分 0.282，Δ跨 −0.08（不顶跨度）；
  // p≥0.7 之后转正只从 11 涨到 13，但翻转数从 12 涨到 23，多付的全是"两边都过线或都不过线"的
  // 中性翻转，且 Δ跨由 −0.08 翻正成 +0.43（开始拿跨度换块数）。
  const SHORTLIST_COMPACT_BLOCKS = 2, SHORTLIST_BLOCKS_DISCOUNT = 0.5;
  const shortlist = [];
  const releaseShortlist = () => {
    if (!shortlist.length || puzzles.length >= count) return false;
    // 排序键：≤12 手用带内综合分（块数／跨度／密度三项同形相加）作主键，块数→跨度→密度退为平手次序。
    // 13–30 手比较器在 `depth > 12` 时与改前表达式逐项一致，连同平手次序都与 R58 落地态逐字相同。
    shortlist.sort((a, b) => (depth > 12 ? 0 : b.rank - a.rank)
      || a.cmp.blocks - b.cmp.blocks || a.cmp.span - b.cmp.span
      || (depth > 12 ? 0 : (b.cmp.stones / b.cmp.area) - (a.cmp.stones / a.cmp.area)) || a.order - b.order);
    const best = shortlist.shift();
    // 落选那道丢掉（不是结转给下一个名额）：结转只会把同一批题重新排队，
    // 而 naturalScore 取批内中位、compactPassRate 取批内份额——两者对"重新排队"完全 insensitive。
    // 真要涨分就必须在每个名额上少交一道差的、多交一道好的，即每名额抽 2 道只留 1 道。
    shortlist.length = 0;
    puzzles.push(best.puzzle);
    onProgress({ attempts, accepted: puzzles.length, requested: count, depth, size, rejected: { ...rejected } });
    return true;
  };
  // Two independent random streams preserve each strategy's progress. Giving
  // two attempts to support reuse and one to wider routing avoids spending the
  // entire budget on one ordering. An explicit routingNoise pins a strategy.
  const portfolio=layout==='compact'&&depth>=40&&options.routingNoise===undefined;
  const widerRng=portfolio?random(seed):null;
  // A single attempt is the unit of construction, proof and acceptance.
  // The retry loop owns only scheduling and aggregate state; this boundary keeps
  // future long-puzzle strategies from duplicating the acceptance pipeline.
  try {
    while (attempts < maxAttempts && puzzles.length < count) {
      guard.check();
      // 第 58 轮：抽奖窗口关掉就先交目前最紧凑那道，不等尝试数用完。
      if (shortlist.length && guard.elapsedMs >= timeMs * SHORTLIST_WINDOW) { releaseShortlist(); continue; }
      attempts++;
      const attemptContext = {
        options, size, depth, attacker, rules, layout, ending, forbiddenKind, text, shapeInfo,
        uniqueFirst, constructionNodes, signal, hardRng, rng, widerRng, deepWeave, compactSearch,
        themeRows, glyphParticipation, themeOptions, basePhase, count, seed,
        timeMs, solveMs, verifyMs, maxAttempts, attempts, onProgress, guard, remainingTime,
        shortlistScope, deepLottery, rejected, puzzles, seen, shortlist, state: attemptState,
      };
      const outcome = runAttempt(attemptContext, {
        construct, balance, constructCompact, balanceCompact,
        makeTheme, solve, principalVariation,
        decoyAudit, canonicalKey, compactness, compactScore, searchHardPosition,
        releaseDeepFallback, releaseShortlist, portfolio,
        SHORTLIST_MAX, SHORTLIST_WINDOW, SHORTLIST_GOAL, SHORTLIST_SCORE,
        SHORTLIST_COMPACT_BLOCKS, SHORTLIST_BLOCKS_DISCOUNT,
      });
      if (outcome?.kind === 'budget') { timedOut = true; break; }
    }
    // 尝试数用完仍没抽到达标题：有退路就交题，不空手而归（退路那道已过全部硬门）。
    releaseDeepFallback();
    releaseShortlist();
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    timedOut = true;
    // 预算烧穿同理补交；用户主动取消不补。
    if (!signal?.aborted) { releaseDeepFallback(); releaseShortlist(); }
  }
  return { schema: 'banbu-vcf-batch/1', status: puzzles.length === count ? 'complete' : signal?.aborted ? 'cancelled' : timedOut ? 'budget' : 'incomplete', requested: count, attempts, elapsedMs: guard.elapsedMs, rejected, puzzles,
    ...(layout==='compact'?{compactSearch}:{}) };
}

// Search small boards first. Every stage shares the caller's total time and
// attempt budgets, so a difficult 15-line board cannot consume all expansion
// time. Failure at a size is budgeted search evidence, not an impossibility
// proof. The target depth and the independent acceptance checks never change.
export function generate(options = {}) {
  return generateNormalized(normalizeRequest(options));
}

// Internal adapter boundary: callers that already selected their text
// preparation (for example the Node facade's native font renderer) enter here
// so the core never normalizes the same request twice.
export function generateNormalized(options = {}) {
  const plan = createSearchPlan(options);
  const { count, depth, timeMs, maxAttempts, signal, onProgress, sizePolicy } = plan;
  const guard = budget({ timeMs, signal }), puzzles = [], sizeSearch = [], rejected = {};
  let attempts = 0, timedOut = false;
  try {
    guard.check();
    for (let i = 0; i < sizePolicy.sizes.length && puzzles.length < count && attempts < maxAttempts; i++) {
      guard.check();
      const stage = allocateSearchStage(plan, i, { elapsedMs: guard.elapsedMs, attempts, accepted: puzzles.length });
      const { size } = stage;
      onProgress({ phase: 'searching-size', size, depth, accepted: puzzles.length, requested: count, maxSize: sizePolicy.maxSize });
      const acceptedBefore = puzzles.length, attemptsBefore = attempts;
      const result = generateAtSize({ ...stage,
        onProgress: progress => onProgress({ ...progress, attempts: attemptsBefore + progress.attempts, accepted: acceptedBefore + progress.accepted, requested: count }) });
      attempts += result.attempts;
      for (const [key, n] of Object.entries(result.rejected)) rejected[key] = (rejected[key] || 0) + n;
      sizeSearch.push({ size, status: result.status, generated: result.puzzles.length, attempts: result.attempts, elapsedMs: result.elapsedMs, rejected: result.rejected,
        ...(result.compactSearch?{compactSearch:result.compactSearch}:{}) });
      for (const puzzle of result.puzzles) {
        puzzle.provenance.sizePolicy = { requestedSize: sizePolicy.requestedSize, preferredSize: sizePolicy.preferredSize,
          maxSize: sizePolicy.maxSize, unrestrictedSize: sizePolicy.unrestrictedSize, selectedSize: size,
          triedSizes: sizeSearch.map(stage => stage.size) };
        puzzles.push(puzzle);
      }
      if (result.status === 'cancelled') break;
      if (result.status === 'budget') timedOut = true;
    }
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    timedOut = true;
  }
  const status = puzzles.length === count ? 'complete' : signal?.aborted ? 'cancelled' : timedOut ? 'budget' : 'incomplete';
  const reason = status === 'complete' ? undefined : status === 'cancelled' ? 'cancelled' : !sizePolicy.sizes.length ? 'size-limit' : 'search-budget';
  return { schema: 'banbu-vcf-batch/1', status, requested: count, targetDepth: depth, attempts, elapsedMs: guard.elapsedMs,
    sizePolicy, sizeSearch, ...(reason ? { reason } : {}), rejected, puzzles };
}
