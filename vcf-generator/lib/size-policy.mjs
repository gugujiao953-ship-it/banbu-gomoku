import { textMask } from './theme.mjs';
import { BLACK, playerId } from './board.mjs';
import { prepareShapeOptions } from './shapes.mjs';

const PREFERRED_SIZE = 15;
const PHONE_MAX_SIZE = 30;
const ENGINE_MAX_SIZE = 361;
const COMPACT_MAX_OCCUPANCY = 0.38;
// Board lines of slack above the compact occupancy floor. See the startSize comment.
const COMPACT_SIZE_SLACK = 2;
// Slack for requests whose landing size sits further above the floor (see startSize).
const COMPACT_LONG_SIZE_SLACK = 5;

export function resolveLayout(options={}) {
  return options.layout===undefined
    ? (options.shape!==undefined||options.shapeInfo!==undefined||options.textRaster?.glyphBoxes||!options.text&&!options.mask&&(options.depth??5)>10?'compact':'free')
    : options.layout;
}

function themeDimensions({ text, mask }) {
  if (!text && !mask) return null;
  const rows = mask || textMask(text);
  if (!Array.isArray(rows) || !rows.length || rows.some(row => typeof row !== 'string' || !/^[01]+$/.test(row) || row.length !== rows[0].length)) {
    throw new Error('Mask must be rectangular strings of 0/1');
  }
  return { width: rows[0].length, height: rows.length };
}

// Size selection affects the search schedule only. It never changes the target
// depth, rules, attacker, theme or verification requirements.
export function resolveSizePolicy(options = {}) {
  options=prepareShapeOptions(options);
  const requestedSize = options.size === undefined ? 'auto' : options.size;
  const unrestrictedSize = options.unrestrictedSize === undefined ? false : options.unrestrictedSize;
  if (typeof unrestrictedSize !== 'boolean') throw new Error('unrestrictedSize must be a boolean');
  const limit = unrestrictedSize ? ENGINE_MAX_SIZE : PHONE_MAX_SIZE;
  const maxSize = options.maxSize === undefined ? limit : options.maxSize;
  if (!Number.isInteger(maxSize) || maxSize < 5 || maxSize > limit) {
    throw new Error(`maxSize must be an integer in 5..${limit}${unrestrictedSize ? '' : '; enable unrestrictedSize to exceed 30 lines'}`);
  }
  if (requestedSize !== 'auto' && (!Number.isInteger(requestedSize) || requestedSize < 5 || requestedSize > ENGINE_MAX_SIZE)) {
    throw new Error('size must be auto or an integer in 5..361');
  }
  if (requestedSize !== 'auto' && requestedSize > limit) {
    throw new Error('A board above 30 lines requires unrestrictedSize: true');
  }
  if (requestedSize !== 'auto' && requestedSize > maxSize) {
    throw new Error('Requested size exceeds maxSize; an explicit board size is never resized');
  }
  const depth = options.depth === undefined ? 5 : options.depth;
  if (!Number.isInteger(depth) || depth < 3 || depth > 500) {
    throw new Error('Target depth must be in 3..500 attacker moves, including final five');
  }
  const attacker = playerId(options.attacker === undefined ? 'black' : options.attacker);
  if (!attacker) throw new Error('attacker must be black, white, 1 or 2');
  const base = { requestedSize, unrestrictedSize, maxSize, preferredSize: PREFERRED_SIZE };
  // An explicit size is exact, including undersized requests. The constructor
  // remains responsible for reporting an infeasible candidate at that size.
  if (requestedSize !== 'auto') return { ...base, sizes: [requestedSize], skippedSizes: [] };

  const theme = themeDimensions(options);
  // The following disjoint bounds apply to free/staircase/snake only,
  // not arbitrary VCF positions. Those modules reserve 6D-5 distinct cells.
  // Without a theme, their 2D-1 attacking and D-2 defending stones additionally
  // need D+1 (black first) or D+2 (white first) balancing stones. balance()
  // cannot place those stones in reserved cells, so their cells are extra.
  // A theme may contribute stones of either color, so retain only the proven
  // 6D-5 module bound there, without guessing its final balancing requirement.
  const compact=resolveLayout(options)==='compact';
  // Shared supports invalidate the disjoint family's 7D bound. The compact
  // schedule uses only a weak physical bound: D attacks, D-2 prior replies,
  // and at least three setup attack stones plus the matching color count.
  const reservedIntersections = compact ? 2*depth-2 : 6 * depth - 5;
  const balanceIntersections = compact ? (attacker===BLACK?6:7) : theme ? 0 : depth + (attacker === BLACK ? 1 : 2);
  const requiredIntersections = reservedIntersections + balanceIntersections;
  // A compact board needs more than one cell per stone: every extension window must still
  // hold two holes and no opposing stone. Measured on 2026-10-06: D40 on 15 lines occupies
  // 84/225 = 0.37 and is solvable, D50 on 15 lines is 104/225 = 0.46 and exhausts 100
  // attempts at 42/50 while the same depth succeeds on 18 lines (0.32).
  const capacitySize = Math.ceil(Math.sqrt(compact ? requiredIntersections / COMPACT_MAX_OCCUPANCY : requiredIntersections));
  // The occupancy bound is a feasibility floor, not a quality one: on its tightest fitting board the
  // plan still solves but the diagram squeezes apart. Measured 2026-10-06 with seed 77 — D60 solved on
  // 19 lines as 25 components (naturalScore 0.370) and on 21 lines as 19 components (0.489). So a
  // compact request that must leave 15 lines starts 2 lines above the floor; a request that still fits
  // 15 keeps starting there, because 15 is the product board and depth there is not a capacity problem.
  // Slack only applies where the floor itself is reachable: a cap below the floor must still report no
  // eligible board rather than scheduling a puzzle that cannot fit.
  // The gap between the floor and the size a puzzle actually appears on grows with depth. Measured on
  // the 2026-10-06 baseline run (90.3%, 28/31): D50 starts 19 and lands 19, D60 starts 21 lands 21,
  // but D80 starts 23 and only lands on 26 (43 attempts, 16.7s) and D100 starts 26 lands 29 (71
  // attempts, 26.0s). Those skipped boards are the whole cost of the two longest jobs, so a long
  // request starts on its measured landing size instead of burning attempt shares below it.
  const slack = depth > 70 ? COMPACT_LONG_SIZE_SLACK : COMPACT_SIZE_SLACK;
  const startSize = compact && capacitySize > PREFERRED_SIZE && capacitySize <= maxSize
    ? Math.min(capacitySize + slack, maxSize)
    : capacitySize;
  const themeSize = theme ? Math.max(theme.width + 2, theme.height + 2) : 5;
  // 第 27 轮实测（应用形态，轻/重档一致）：40 手在 15 路上 15/30 秒档几乎出不来（3 seed 只 1 个出、
  // 其余烧满预算；60 秒档也要 37-40s 才落），而同一请求扩盘后 17-18 路 1-4 秒就出——自动尺寸请求
  // 每次都要先在这个瓶颈阶段烧掉约 64% 的预算。所以「自动尺寸 + 可扩盘 + 自然式普通题 + depth>=40」
  // 直接从 16 路起步。作用域只覆盖应用那条链：标准模式（冻结快照考题）、显式 size:15 的考卷
  // （bench D40）与文字/图案题一字不动。
  const skipStandardStart = compact && requestedSize === 'auto' && options.naturalStyle === true
    && !options.text && !options.mask && !options.shapeInfo && depth >= 40 && maxSize > PREFERRED_SIZE;
  // 白先 D35 暴露了同一类、但更窄的调度坑：15 路会把预算耗在 30 次以上的
  // 失败构造上，而 20 路在相同种子上 3/3 通过且每题约 1--2 秒。白先的平衡子
  // 比黑先多一颗，15 路的紧凑路由更容易触发 shortcut；只对自动尺寸的普通自然题
  // 提前到 20 路，保留显式 15 路考卷以及抓禁/图案/文字的原排期。
  const skipWhiteLongStart = compact && requestedSize === 'auto' && options.naturalStyle === true
    && attacker === 2 && depth >= 35 && depth <= 40 && maxSize > PREFERRED_SIZE
    && !options.text && !options.mask && !options.shape && !options.shapeInfo
    && (options.ending === undefined || options.ending === 'five');
  const preferredStart = skipWhiteLongStart ? 20 : skipStandardStart ? PREFERRED_SIZE + 1 : PREFERRED_SIZE;
  const firstPreferred = Math.min(preferredStart, maxSize);
  const firstSize = Math.max(firstPreferred, startSize, themeSize);
  const skippedSizes = [];
  // Record every omitted phone-sized stage, including a routing hint that
  // intentionally skips the preferred 15-line start.
  for (let size = PREFERRED_SIZE; size < firstSize && size <= maxSize; size++) {
    const reasons = [];
    // A routing hint can move the first stage above the physical capacity floor.
    // Keep that decision explicit in the manifest instead of emitting a record
    // with an undefined reason (which makes skipped stages look like a bug).
    if (size < firstPreferred) reasons.push(skipWhiteLongStart ? 'white-long-routing' : 'long-routing');
    if (size < startSize) reasons.push('capacity');
    if (size < themeSize) reasons.push('theme');
    skippedSizes.push({ size, reason: reasons[0], reasons,
      ...(size < startSize ? { constructionFamily: compact?'compact-temporal-synthesis':'empty-board-dependency-synthesis', requiredIntersections, reservedIntersections, balanceIntersections, minimumSize: startSize } : {}),
      ...(size < themeSize ? { minimumThemeSize: themeSize } : {}),
    });
  }
  const sizes = [];
  if (firstSize <= maxSize) {
    if (firstSize > 75) sizes.push(firstSize);
    for (let size = firstSize; size <= Math.min(75, maxSize); size++) sizes.push(size);
    if (maxSize > 75) {
      for (let size = Math.max(80, Math.ceil(firstSize / 5) * 5); size <= maxSize; size += 5) {
        if (sizes.at(-1) !== size) sizes.push(size);
      }
    }
    if (sizes.at(-1) !== maxSize) sizes.push(maxSize);
  }
  return { ...base, sizes, skippedSizes };
}
