import { Board } from '../board.mjs';
import { invalidateCandidate, recordRejection } from '../contracts.mjs';
import { solveExactCandidate } from '../acceptance/exact-solve.mjs';
import { certifyForbiddenEnding } from '../acceptance/forbidden-necessity.mjs';
import { certifyTheme } from '../acceptance/theme-necessity.mjs';
import { assemblePuzzleDraft } from '../acceptance/puzzle-assembler.mjs';
import { verifyPuzzleDraft } from '../acceptance/reference-verify.mjs';
import { checkAlternativeLines, meetsPlausibleFloor } from '../acceptance/difficulty.mjs';

export function runAttempt(context, services) {
  const {
    construct, balance, constructCompact, balanceCompact,
    makeTheme, solve, principalVariation,
    decoyAudit, canonicalKey, compactness, compactScore, searchHardPosition,
    releaseDeepFallback, releaseShortlist, portfolio,
    SHORTLIST_MAX, SHORTLIST_WINDOW, SHORTLIST_GOAL, SHORTLIST_SCORE,
    SHORTLIST_COMPACT_BLOCKS, SHORTLIST_BLOCKS_DISCOUNT,
  } = services;
  const {
    options, size, depth, attacker, rules, layout, ending, forbiddenKind, text, shapeInfo,
    uniqueFirst, constructionNodes, signal, hardRng, rng, widerRng, deepWeave, compactSearch, seed,
    themeRows, glyphParticipation, themeOptions, basePhase, count, timeMs, solveMs, verifyMs,
    maxAttempts, attempts, onProgress, guard, remainingTime, shortlistScope, deepLottery,
    rejected, puzzles, seen, shortlist,
  } = context;
  const state = context.state;
  if (!state || typeof state !== 'object') throw new TypeError('runAttempt requires an explicit attempt state');
  // Change only the colors, never the outline or its empty background.
  // A few routings per coloring avoid spending every restart on the same
  // inaccessible supports. Standard mode keeps its original RNG/output.
  // Small shapes are the same trap: one colouring only offers a handful of
  // distinct diagrams, so a 5-puzzle batch converges on the same boards
  // (measured: 3 accepted + 60 duplicates per 100 attempts once the glyph
  // certificate stops rejecting them). Rotating colors for naturalStyle
  // shapes is what turns those restarts into different puzzles.
  if(options.shapeComplexity==='multi-step' || (text && [...text].length >= 3) || (shapeInfo && options.naturalStyle === true)){
    const phase=basePhase+Math.floor((attempts-1)/4);
    if(phase!==state.themePhase){
      const colorSeed=(Math.imul(seed>>>0,1664525)^Math.imul(phase,1013904223))>>>0;
      try{state.theme=makeTheme(size,{...themeOptions,phase,colorSeed});}
      catch(e){
        if(e.message!=='Could not safely colour the glyph; choose another mask or spacing')throw e;
        rejected.construction++;return { kind: 'reject' };
      }
      state.themePhase=phase;
    }
  }
  const routingNoise=options.routingNoise??(portfolio&&attempts%3===0?7:1);
  const attemptRng=portfolio&&routingNoise===7?widerRng:rng;
  if(layout==='compact'){
    const routingAttempts=compactSearch.routingAttempts??={};
    routingAttempts[routingNoise]=(routingAttempts[routingNoise]||0)+1;
  }
  // 第 52 轮：深档抽奖期间"奇数次尝试用浅上限 2000、偶数次沿用现网上限"。实测（90 秒墙、6 个 D40 种子、
  // 两库同窗交替）：现网每 90 秒只抽到 0-1 道合格候选（s62 抽 45 次撞满预算、交出死梯子），
  // 交替版 6/6 都抽到岔路比 ≥0.325 的题、墙钟中位 25.0s→15.2s、s55 那道 0.6 的题也保住。
  // 便宜的失败让"同一批盐"在预算内多翻几轮，这就是深档题质量从"看负载"变成"看预算"的那一步。
  let candidate = layout==='compact'
    ? constructCompact(size,depth,attacker,attemptRng,{constructionNodes: deepLottery && (attempts & 1) ? 2000 : constructionNodes,guard,rule:rules,ending,forbiddenKind,routingNoise,diagnostics:compactSearch,theme: state.theme,shapeInfo,
      regionBoxes: shapeInfo ? [] : (options.textRaster?.glyphBoxes || []), shapeComplexity:options.shapeComplexity, naturalStyle:options.naturalStyle === true, deepWeave})
    : construct(size, depth, attacker, rng, state.theme, { layout, constructionNodes, guard, ending, forbiddenKind,
      glyphParticipation, glyphBoxes: options.textRaster?.glyphBoxes,shapeInfo });
  if (!candidate) { rejected.construction++; return { kind: 'reject' }; }
  // 干扰手纹理对：实测 1 组与 2 组的 decoyMedian 同为 3，但 2 组每题 0.11s→0.27s 且 D16 白先从 5/5
  // 掉到 1/5；抓禁手题（真成五的冲四按定义比禁手点更快）容不下额外 shortcut 拒收，所以仍只给普通题。
  // 第 25 轮把上限从 20 手放到 30 手（用户原话："20 手以上主线路没什么阻碍、没有分支的死路冲四"）——
  // 21-40 手原来一颗干扰子都不给，实测 D30 岔路 1、可骗占比 0.03、弱岔 0.94；放开后 D30 岔路 3、
  // 可骗 0.97、块 13→6、自然度 0.638→0.702（2.0s/3 次尝试）。
  // **31-40 手不给**：每个被拒候选要走一次贵的 solve，实测 15 路 40 手（90 秒/100 次尝试的考卷）
  // 从 complete 掉成 budget、15 秒档"D40 扩盘"也会从 ok 变 budget——深档先保出题，这条留待
  // 更便宜的干扰子供给（构造期预留两冲四链）再说。旧注释里"D25+ 已在临界点"是第 6 轮口径。
  // 安全性由既有的第二解/证不死复核兜底（实测本批拒掉 1 例二解、0 例证不死）。
  // 5 秒档只在 30 手这一档会偶尔吃紧（实测 s11 出不来、s7 用 4.5s），不额外加闸——
  // 实测加"阶段预算 >=8s"的闸反而把 D20@5s 从 complete 打成 budget（有干扰子时反而更省），
  // 这类轨迹敏感别再拍常数（第 7 轮同一条墙）。
  // 简单模式（用户 2026-10-07 点名）：不做干扰子纹理对，出"单线冲四"的经典题面。
  // 只是少给复杂度设施：求解、验题、唯一首手、最短解与第二解复核全部照旧。
  const wantDecoys = options.simple !== true && options.naturalStyle === true && !themeRows && !shapeInfo && ending === 'five' && depth <= 30;
  // 第 37 轮：接线（branchWeave）与干扰对解耦、单独放开到 40 手。R25 当初把 31-40 手
  // 「留待更便宜的干扰子供给」——接线就是这个供给（复核 ≤500ms/条，带桥候选的整题复核
  // 结果复用给主求解）。干扰对（每个被拒候选一次贵 solve）与可骗下限（深档先保出题）
  // 仍保持 ≤30 手不动。
  // 第 54 轮：41-50 手也开，但只跟着 deepLottery 走（单道＋总预算≥60 秒），手机档与扩盘短档照旧。
  const branchScope = options.simple !== true && options.naturalStyle === true && !themeRows && !shapeInfo &&
    ending === 'five' && (depth <= 40 || deepLottery);
  // 第 30 轮：中段岔路接线与干扰对同作用域；options.branchWeave=false 可单独关掉做 A/B。
  // 每颗接线子 T 的复核求解上限 500ms（与 decoyAudit 同一口径），撞满即弃这个候选，不吞整题预算。
  const weaveOpts = branchScope && options.branchWeave !== false
    ? { maxBranches: options.branchWeaveMax ?? 2, depth,
        checkContinuation: (board, maxDepth) => solve(board, attacker, {
          rule: rules, maxDepth, timeMs: remainingTime(Math.min(solveMs, 500)),
        }),
        // 第 34 轮：桥的整题复核（balanceCompact 末尾调用；同主求解口径，结果可复用）。
        checkFull: board => { guard.check();
          return solve(board, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(Math.min(solveMs, 5000)), signal, prior: candidate.path, enumerateFirst: uniqueFirst }); } }
    : null;
  // 第 40 轮：末段牵制（counterThreat，仿 branchWeave 的纹理工序）。与接线同作用域；
  // checkFull 与主求解同口径（prior＝主解、enumerateFirst＝uniqueFirst），成功时整题解复用；
  // audit 与下游 decoyAudit＋可骗下限一字不差（同函数、同 500ms 口径）。预筛不过就撤子不落盘。
  // options.counterThreat=false 可单独关掉做 A/B。
  const counterThreat = branchScope && options.counterThreat !== false
    ? { depth, maxTries: options.counterThreatMax ?? 2, uniqueFirst: uniqueFirst === true,
        checkFull: board => { guard.check();
          return solve(board, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(Math.min(solveMs, 5000)), signal, prior: candidate.path, enumerateFirst: uniqueFirst }); },
        // capMs：预筛用的更短口径（默认与下游一致的 500ms）。预筛只是"要不要加"的决策，
        // 缩短只会让预筛更保守（撞预算＝unproven＝否决），不可能放松验收——下游照旧 500ms 全口径。
        audit: (board, proof, capMs = 500) => { guard.check();
          return decoyAudit(board, attacker, rules, principalVariation(board, attacker, proof, rules), () => remainingTime(Math.min(solveMs, capMs))); },
        // 去重门在 balance 之后才跑（canonicalKey 从最终盘算）：底本已经见过的候选一旦加上牵制子，
        // 盘的哈希就变了、会逃过 duplicate 拒收被收成近重复题（第 40 轮实测：D12 s22 第 9 次尝试
        // 是第 3 题的重复盘，OFF 拒 dup、ON 加了两颗子后收下、批内块数中位被顶到 4）。
        // 所以落子前先按同口径查一次底本 key；装饰后接受时把底盘 key 一并入 seen（否则同一底盘的
        // 对称双胞胎会再次绕过 isSeen 被装饰成新盘、逃过 duplicate——第 42 轮实测 D12 s22 #9）。
        isSeen: board => seen.has(canonicalKey(board)),
        keyOf: board => canonicalKey(board) }
    : null;
  // 干扰对复核：守方那颗纹理子可能占死防守资源、把整题带短（第 27 轮实测 D30 shortcut 拒收全由它引起），
  // 逐个应手先跑一次精确求解——只有"仍按原深度赢"的应手才留下；复核的解沿用给主求解（省一次全求解）。
  const pairVerify = wantDecoys && options.pairRescue === true ? board => {
    guard.check();
    const r = solve(board, attacker, { rule: rules, maxDepth: depth, timeMs: remainingTime(Math.min(solveMs, 5000)), signal, prior: candidate.path, enumerateFirst: uniqueFirst });
    if (r.status === 'win' && r.depth === depth) return { kind: 'ok', result: r };
    return { kind: r.status === 'win' ? 'short' : 'unknown' };
  } : undefined;
  let b = layout==='compact'?balanceCompact(candidate,size,attacker,rules,attemptRng,guard,compactSearch,options.naturalStyle === true,wantDecoys?1:0,pairVerify,weaveOpts,counterThreat,options.naturalStyle === true && options.simple !== true && depth > 30):balance(candidate, size, attacker, rules, rng, state.theme, guard);
  if (!b) { rejected.balance++; return { kind: 'reject' }; }
  guard.check();
  const exact = solveExactCandidate(b, candidate, { attacker, rules, depth, uniqueFirst, solveMs, signal }, { guard, remainingTime });
  if (!exact.ok) { recordRejection(rejected, exact.reason); return { kind: 'reject' }; }
  b = exact.board;
  let result = exact.result;
  let hard;
  if (hardRng) {
    // Leave time for the independent verifier and the existing per-turn alternative checks.
    const available = remainingTime(timeMs);
    if (available < 100) return { kind: 'budget' };
    hard = searchHardPosition(b, result, attacker, {
      rule: rules, depth, rng: hardRng, signal,
      timeMs: Math.min(10000, available * .7),
    });
    if (!hard) { rejected.hardDifficulty = (rejected.hardDifficulty || 0) + 1; return { kind: 'reject' }; }
    b = hard.board; result = hard.result;
    // Construction decorations describe the old board. Never reuse its certificates, duplicate key or cached solve after a mutation.
    candidate = invalidateCandidate(candidate, 'hard-search-board-mutation');
  }
  const endingEvidence = certifyForbiddenEnding(b, result, { size, attacker, rules, depth, ending, forbiddenKind, solveMs, signal }, { guard, remainingTime });
  if (!endingEvidence.ok) { rejected[endingEvidence.reason]++; return { kind: 'reject' }; }
  const { forbidden } = endingEvidence;
  const themeEvidence = certifyTheme(b, candidate, result, { options, size, attacker, rules, depth, theme: state.theme, shapeInfo, glyphParticipation, solveMs, signal }, { guard, remainingTime });
  if (!themeEvidence.ok) {
    rejected[themeEvidence.reason] = (rejected[themeEvidence.reason] || 0) + 1;
    return { kind: 'reject' };
  }
  const key = canonicalKey(b);
  if (seen.has(key)) { rejected.duplicate++; return { kind: 'reject' }; }
  const puzzle = assemblePuzzleDraft(b, candidate, result, { options, key, size, rules, attacker, depth, ending, uniqueFirst, shapeInfo, text, theme: state.theme, glyphParticipation, seed, attempts, layout }, { forbidden, ...themeEvidence });
  const checked = verifyPuzzleDraft(puzzle, { verifyMs }, { guard, remainingTime });
  if (!checked.ok) { rejected[checked.reason]++; return { kind: 'reject' }; }
  // 岔路复核：见 decoyAudit。等长第二解会静默把"只有一个正确最终手"变成"有两条解线"，
  // 而唯一首手＋最短解两道既有门都抓不到它，所以必须在 push 之前证明每条岔路是死的。
  // 可骗下限只对普通题加：实测抓禁手与图案题的候选 0/5 达标（题面上只有静态死四），
  // 硬推会把 15 路手机档的两类题型打挂。范围跟着跨度预算一起覆盖到 ≤20 手。
  // **必须再看 layout**：干扰子的唯一供给是 `balanceCompact`（第 6 轮），free 布局一颗都不加，
  // 于是"每手都要算两步"在 free 布局结构性无法满足。第 22 轮实测：挑战补题 worker 不传 layout，
  // `resolveLayout`（size-policy.mjs:14）只给 depth>10 的题选 compact ⇒ depth 3–10 的 200 次尝试
  // 全被这一条拒成 thinDecoys（改前 1 次尝试 0.0 秒出题）⇒ 短/中两档补题静默失效。
  if (options.naturalStyle === true) {
    // 单条岔路的证明上限 500ms（实测 15 路最深 1315 节点、30 路 1 节点，都在几毫秒内），
    // 撞满就记 unproven 弃这道候选——复核不许把整题的硬预算吃掉。
    const alternatives = checkAlternativeLines(b, puzzle.solution, { attacker, rules, solveMs }, { remainingTime });
    const { audit } = alternatives;
    if (!alternatives.ok) {
      rejected.secondLine = (rejected.secondLine || 0) + audit.secondLine;
      rejected.decoyUnproven = (rejected.decoyUnproven || 0) + audit.unproven;
      return { kind: 'reject' };
    }
    // 第 25 轮把下限从 ≤20 手扩到 ≤30 手：干扰子纹理对放开到 30 手之后（见上面 wantDecoys），
    // 21-30 手的岔路供给第一次真的存在（实测 D30 岔路 3、可骗 0.97），此前"供给为零不能推"的
    // 前提已经变了。仍是收紧验收（多拒候选），代价用同一批 seed 的尝试数/耗时量出来。
    // 简单模式不出干扰子，也就没有"每手都要有一条可骗岔路"的供给，这条下限随之关闭
    // （第二解/证不死复核在上面，仍然对所有模式生效）。
    // 第 51 轮：31-40 手的「可骗岔路下限＋带退路的择优」。R46 量到深档题其实是死梯子——
    // 15 路 D40 实测 可骗0.025／≥2 占0.025／一眼假0.975（真人 0.75／0.88／0.09），根因就是这条
    // 下限过去只覆盖 ≤30 手。下限本身是**收紧验收**（多拒候选，不放松任何硬门），但深档的合格候选
    // 本来稀（构造失败占 8-30 次尝试），只加下限会把两个种子打成空手（实测 s61 31 次尝试 111s、
    // s62 40 次 132s 都没抽到 ≥0.3）⇒ 加退路：抽奖窗口（本阶段预算 70%／尝试数 55%）关掉就当场
    // 交回此前抽到的岔路最多那道。退路题已过一个不少的全部硬门（精确求解／独立验题／唯一首手／
    // 最短解／第二解与证不死复核），与改动前交出的那道同性质，所以成功率与深度前沿只可能不变。
    // 档位取 0.3：0.35/0.5 会把 s56 那种"唯一那道 0.325"也拒掉（40 次尝试 125s 仍未出题）。
    // 只在"单道＋≥60 秒"的重生成请求上开：count 5/10 时每阶段的预算被摊薄，抽奖会把每道题都
    // 拖到窗口关掉，那是产品端的体验倒退；此时 31-40 手保持改动前行为（不加下限）。
    // 第 62 轮（用户 2026-10-08 点名批准放松这一条）：≤30 手下限从 `turns-1` 放松到 `ceil(turns*0.7)`。
    // 放松的理由与边界：`turns-1`（12 手要 11 手都有可骗岔路）严于真人——素材实测只有 61.3% 的步是唯一堵点。
    // 第 61 轮量到它是跨度硬门的成本来源（题面一紧静态死四就变少，紧候选整批被这条拒掉：单卷
    // thinDecoys 8→24、attempts 16→47）。放松的只是"每手都要算两步"这条**质量下限**，第 3 节保护的
    // 硬门一条没减：精确求解／最短解／唯一首手／独立验题／完整重放／等长第二解与证不死复核照旧，
    // 图案与文字参与约束照旧。回归钉在 `test/decoy-difficulty.node.mjs`（第二解与证不死仍必须挡）。
    if (!meetsPlausibleFloor(audit, { options, theme: state.theme, ending, layout, depth, deepLottery })) {
      rejected.thinDecoys = (rejected.thinDecoys || 0) + 1;
      if (deepLottery) {
        if (!state.deepFallback || audit.plausible > state.deepFallback.plausible) {
          state.deepFallback = { puzzle, key, plausible: audit.plausible, baseKey: candidate.compact?.counterBaseKey || null };
        }
        if (guard.elapsedMs < timeMs * 0.7 && attempts < Math.ceil(maxAttempts * 0.55)) return { kind: 'reject' };
        releaseDeepFallback();
        return { kind: 'reject' };
      }
      return { kind: 'reject' };
    }
  }
  seen.add(key);
  if (candidate.compact?.counterBaseKey) seen.add(candidate.compact.counterBaseKey);
  // 第 58 轮：窗口内先记账不交题（`seen` 已在上面收过 key，所以后续尝试不会重复抽同一张盘面）。
  // 第 72 轮两处改动：①"达标"要块数与跨度同时落带（第 72 轮取证，现由第 74 轮的综合分包含）；
  // ②批量档（count 5/10）多一道"尝试数还剩六成余量"的闸——每名额抽 2 留 1 会把尝试数翻倍
  //   （快档 D20 实测 36 次／上限 100），不给这道闸 unlucky seed 会打成 incomplete。
  if (shortlistScope && shortlist.length < SHORTLIST_MAX && guard.elapsedMs < timeMs * SHORTLIST_WINDOW &&
    (count === 1 || attempts < Math.ceil(maxAttempts * 0.6))) {
    // `order`＝同块数同跨度时"先到先交"的平手判据，用尝试序号（严格递增）。
    const cmp = compactness(puzzle.stones, size);
    const score = compactScore(cmp);
    shortlist.push({ puzzle, cmp, score, order: attempts,
      rank: score - (cmp.blocks > SHORTLIST_COMPACT_BLOCKS ? SHORTLIST_BLOCKS_DISCOUNT : 0) });
    onProgress({ attempts, accepted: puzzles.length, requested: count, depth, size, rejected: { ...rejected } });
    const reached = shortlist.at(-1);
    // 达标判据：≤12 手要"三项综合分＝满值"（块数、跨度、密度同时落进人类带；跨度 ≤10 那半条被它包含）；
    // 13–30 手沿用 R58"只看块数"，表达式与改前逐字相同。
    if (shortlist.length >= SHORTLIST_MAX ||
      (reached.cmp.blocks <= SHORTLIST_GOAL && (depth > 12 || reached.score >= SHORTLIST_SCORE))) releaseShortlist();
    return { kind: 'shortlist' };
  }
  puzzles.push(puzzle);
  onProgress({ attempts, accepted: puzzles.length, requested: count, depth, size, rejected: { ...rejected } });

  return { kind: 'accepted' };

}
