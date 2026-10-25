import { BudgetExceeded, playerId } from '../board.mjs';
import { resolveLayout, resolveSizePolicy } from '../size-policy.mjs';
import { textMask } from '../theme.mjs';

// Request validation and scheduling are independent of construction and proof.
// Creating a plan never draws randomness, searches a board or starts a clock.
export function createSearchPlan(options = {}) {
  options = {...options,layout:resolveLayout(options)};
  // 15 路深档的节点上限单独抬高。前提是 constructCompact 的随机流已经和解耦
  // （每次构造只从共享流抽 1 个盐），所以抬高上限不会重排已有尝试——同一盐在 6000  nodes
  // 下的搜索就是 1000 那次的前向延续，只是撞线的那次尝试被允许继续往下找。
  // 实测：15 路 40 手在 1000 下 100 次尝试全部死在构造（22 秒烧光），6000 下十几次尝试即出题。
  // 口径收得很窄：只抬应用真正走的那条链（naturalStyle、普通题、15/16 路、≥40 手），
  // 标准模式和已经量好的短/中档、扩盘深档一字不改。
  const defaultNodeCap = options.constructionNodes === undefined;
  if(options.constructionNodes===undefined&&options.layout==='compact')options.constructionNodes=1000;
  const { count = 1, depth = 5, timeMs = 30000, maxAttempts = 100, signal, onProgress = () => {} } = options;
  // 第 25 轮：深档的重搜索（连片路由＋6000 节点上限）按**总预算**分档。
  // 35–40 手是当前产品目标：30 秒已经足够让一次接线复核完成，继续关闭
  // 会把题面退化成单锚直链；15 秒档仍保留轻量路径，避免手机快速出题被拖慢。
  // 41 手以上仍要求 60 秒，扩盘深题的失败成本明显更高。
  const deepWeave = timeMs >= 60000 || (depth >= 35 && depth <= 40 && timeMs >= 30000);
  // 干扰对复核只在短预算档启用（第 27 轮追加：15 秒档 D30 从 4/8 烧穿变 8/8、attempts 减半；
  // 30 秒以上旧路径本来就 8/8（D30@30s 实测）且池子质量更高——compactPassRate 0.356 vs 0.222——
  // 所以 ≥30 秒保留旧路径，池子/考卷读数不被波及）。
  const pairRescue = typeof timeMs === 'number' && timeMs < 30000;
  if (![1, 5, 10].includes(count)) throw new Error('Count must be 1, 5 or 10');
  if (!Number.isInteger(depth) || depth < 3 || depth > 500) throw new Error('Target depth must be in 3..500 attacker moves, including final five');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid attempt budget');
  const { attacker = 'black', rules = 'renju', layout = 'free', seed = 7, constructionNodes = 10000, solveMs = 5000, verifyMs = 15000, uniqueFirst = false, ending = 'five', forbiddenKind = 'any' } = options;
  if (!playerId(attacker) || !['renju', 'freestyle'].includes(rules) || !['free', 'staircase', 'snake', 'compact'].includes(layout)) throw new Error('Invalid generation options');
  if(layout==='compact'&&(options.text||options.mask)&&!options.shapeInfo&&!(options.textRaster?.glyphBoxes))throw new Error('Compact text layout requires per-character glyph boxes');
  if(options.shapeComplexity==='multi-step'&&layout!=='compact')throw new Error('Multi-step shape participation requires compact layout');
  if (!Number.isInteger(constructionNodes) || constructionNodes < 1 || !Number.isInteger(seed) || !Number.isFinite(solveMs) || solveMs <= 0 || !Number.isFinite(verifyMs) || verifyMs <= 0) throw new Error('Invalid attempt budget or seed');
  if(options.routingNoise!==undefined&&(!Number.isFinite(options.routingNoise)||options.routingNoise<0||options.routingNoise>20))throw new Error('routingNoise must be in 0..20');
  if (typeof uniqueFirst !== 'boolean') throw new Error('uniqueFirst must be a boolean');
  if (options.hardSearch !== undefined && typeof options.hardSearch !== 'boolean') throw new Error('hardSearch must be a boolean');
  if (options.hardSearch === true && (depth < 6 || depth > 12 ||
    (options.size !== undefined && options.size !== 15) || layout !== 'compact' ||
    options.naturalStyle !== true || options.simple === true || !uniqueFirst ||
    ending !== 'five' || options.text || options.mask || options.shapeInfo)) {
    throw new Error('Hard position search requires an ordinary 15-line compact puzzle, depth 6..12 and a unique first move');
  }
  if(!['five','forbidden'].includes(ending) || !['any','double-three','double-four','overline'].includes(forbiddenKind))throw new Error('Invalid ending or forbidden kind');
  if(ending==='forbidden' && (playerId(attacker)!==2 || rules!=='renju'))throw new Error('Forbidden-block ending requires white under Renju rules');
  const glyphParticipation = options.glyphParticipation ?? (options.textRaster?.glyphBoxes ? 'each-character' : 'anchor');
  if (!['anchor', 'each-character'].includes(glyphParticipation)) throw new Error('glyphParticipation must be anchor or each-character');
  if (glyphParticipation === 'each-character') {
    const boxes = options.textRaster?.glyphBoxes, chars = [...(options.text || '')];
    if (!Array.isArray(boxes) || !chars.length || boxes.length !== chars.length) throw new Error('Per-character glyph participation requires textRaster.glyphBoxes');
    const rows = options.mask || textMask(options.text);
    const covered = new Set();
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!box || box.index !== i || (box.char ?? box.character) !== chars[i] || ![box.row, box.col, box.width, box.height].every(Number.isInteger) || box.row < 0 || box.col < 0 || box.width < 1 || box.height < 1 || box.row + box.height > rows.length || box.col + box.width > rows[0].length) throw new Error('Invalid per-character glyph box');
      for (let r = box.row; r < box.row + box.height; r++) for (let c = box.col; c < box.col + box.width; c++) {
        const at = r * rows[0].length + c;
        if (covered.has(at)) throw new Error('Per-character glyph boxes overlap');
        covered.add(at);
      }
    }
    if (rows.some((row, r) => [...row].some((cell, c) => cell === '1' && !covered.has(r * row.length + c)))) throw new Error('Glyph boxes do not cover every printed stroke');
  }
  const sizePolicy = resolveSizePolicy({ ...options, depth });
  return { options, count, depth, timeMs, maxAttempts, signal, onProgress,
    layout, constructionNodes, defaultNodeCap, deepWeave, pairRescue, sizePolicy };
}

// Reallocate only the caller's remaining budget. Unused stage time and attempts
// return to the batch; target depth, rules and acceptance never change.
export function allocateSearchStage(plan, index, { elapsedMs, attempts, accepted }) {
  const { options, count, depth, timeMs, maxAttempts, layout, constructionNodes,
    defaultNodeCap, deepWeave, pairRescue, sizePolicy } = plan;
  if (!Number.isInteger(index) || index < 0 || index >= sizePolicy.sizes.length) {
    throw new RangeError('Search stage index is outside the size plan');
  }
  const size = sizePolicy.sizes[index], remainingStages = sizePolicy.sizes.length - index;
  // Give the preferred size twice the time share of later stages; unused
  // time is handed back. Explicit fixed-size jobs keep their whole budget.
  const weight = index === 0 && remainingStages > 1 ? 2 : 1;
  const remainingMs = timeMs - elapsedMs;
  if (remainingMs <= 0) throw new BudgetExceeded('Search interrupted');
  let stageMs = remainingMs * weight / (remainingStages - 1 + weight);
  if(layout==='compact'&&size===15&&remainingStages>1)stageMs=Math.max(stageMs,remainingMs*.6);
  const remainingAttempts=maxAttempts-attempts;
  let stageAttempts=Math.min(remainingAttempts,Math.ceil(remainingAttempts/remainingStages));
  // A generous time share alone is ineffective if the equal attempt
  // split stops the preferred board first. Long standard-board routing
  // needs enough restarts to exercise both independent strategies.
  if(layout==='compact'&&size===15&&remainingStages>1){
    stageAttempts=Math.max(stageAttempts,Math.ceil(remainingAttempts*(depth>=40?.9:.6)));
  }
  // 第 25 轮把「构造上限」与「连片路由」拆开：上限只是把天花板抬起来（便宜），真正贵的是
  // 连片路由的每节点打分（那个仍按 deepWeave 分档）。实测 15 秒档 15 路 D35：cap1000 要
  // 21-31 次尝试 / 6.7-8.5s，cap6000 只要 1-3 次 / 0.3-2.5s ⇒ 上限自 depth>=35 起就抬，
  // 不再看预算；D40 在 15-30 秒档四种上限（1000/2000/3000/6000）都出不来（24 组 0 成功），
  // 所以抬上限对它无损：该档本来就只能靠扩展棋盘或 ≥60 秒预算。
  const deepStandard = defaultNodeCap && layout === 'compact' && options.naturalStyle === true
    && size <= 16 && depth >= 35 && !options.text && !options.mask && !options.shapeInfo;
  return { ...options, size, count: count - accepted, timeMs: stageMs, maxAttempts: stageAttempts,
    totalTimeMs: timeMs, deepWeave, pairRescue,
    constructionNodes: deepStandard ? 6000 : constructionNodes };
}
