// problems.ts — VCF 挑战题源：四个池按优先级聚合，合计上万道；出题带"匹配机制"。
//  ① material 763（已验真题，带完整解线）
//  ② 生成批次 5248（app-1001/2002/3003，求解器验证 + comment 里带正解线）
//  ③ 开宝题库 VCF 集 5622（RenjuPortalVCF / 实战VCF / 白先VCF，无解线 → 选题时现场求解验题）
//  ④ 高质量空盘构造——题池不足时补题，不依赖素材变形
//
// 匹配机制（2026-10-12 段位改版后，用户口径「匹配上一级/本级/下一级」）：
//   **题目等级 = 它的手数**（1 级 1 手 … 13 级 13 手；挑战最高接入 35 手，见 `levelOfHands`）；
//   从**上一级 / 本级 / 下一级**三级里抽：本级 80%、上下各 10%（`MATCH_SAME_WEIGHT` / `MATCH_ADJACENT_WEIGHT`），
//   边界（1 级没有下一级、满级没有上一级）把缺的那一份概率并回本级，不会空手。
//   ⚠ 旧的"题分参考线 1000 + 200×(手数−1) + 解答力 ±300 分窗 + 15% 越级挑战"**整套已废**：
//     那条曲线已于 R188/R190 整条删除（它只剩一个显示用途，留着就是下一处漂移），
//     **既不参与匹配、也不参与结算**（结算混用它曾把题目算高 1~3 级，见改造表 R188）。
//   等级分封顶由 rating.ts 管理；挑战只接入到 35 手，生成器本身仍可独立生成更深题。
import { loadVcfMaterial, type VcfTier, type GeneratedVcfPuzzle } from "../vcf/vcf-corpus";
import { importKaibaoPuzzleJson } from "../../puzzles";
import { solveVcf } from "../vcf/vcf-generator";
import { levelOf, levelOfHands, handsOfLevel, levelFloor, MATCH_SAME_WEIGHT, MATCH_ADJACENT_WEIGHT, STATIC_MAX_DEPTH, CHALLENGE_MAX_DEPTH } from "./rating";
import { attackerOnlyLine, buildSolutionLine, type SolutionEnding } from "./solution-line";
import type { Player, Position } from "../../types";

export interface ChallengeProblem {
  id: string;
  attacker: Player;
  depth: number;
  tier: VcfTier;
  black: Position[];
  white: Position[];
  /** 参考解答：**攻守交替的完整线**（第 1 手攻方冲四、第 2 手对方挡……）。
   *  由 solution-line.ts 逐步现推，不再信题源里那条形状不一的坐标串。 */
  solution: Array<Position & { player: Player }>;
  /** 结局类型（抓禁手 / 活四 / 连五）——白棋优先留抓禁手题时用 */
  ending?: SolutionEnding;
  /** true = 这条解线**只列了攻方的冲四**（题源没写对方的挡子、也推不成完整线）——
   *  界面要如实说明，否则一条全同色的线看起来像"答案画错了"（用户 10-06 报过）。 */
  singleSide?: boolean;
  source: "material" | "batch" | "kaibao" | "transform" | "novel";
  /** true = 题池不足，由生成器即时生成（9 手以上常态） */
  generatedOnDemand?: boolean;
  /** 给用户的额外说明（例如"本段题目都出过了，这题是重复出题"） */
  note?: string;
}

const BASE = import.meta.env.BASE_URL;
const BATCH_FILES = ["puzzles/vcf-batch-1001.json", "puzzles/vcf-batch-2002.json", "puzzles/vcf-batch-3003.json"];
const KAIBAO_FILES = ["puzzles/kaibao/RenjuPortalVCF.json", "puzzles/kaibao/实战VCF_1052题.json", "puzzles/kaibao/白先VCF_puzzle.json"];
// 生成器兜底的深度区间（只在题池轮转穷尽后才生成）
const GEN_RANGES: Record<VcfTier, [number, number]> = { short: [1, 6], middle: [7, 12], deep: [13, CHALLENGE_MAX_DEPTH] };
/* ⚠ 原来的 `STRETCH_MAX = 480`（15% 概率越级挑战）**已删**（2026-10-12）：
   用户改成"匹配上/本/下三级、上下各 10%"，那本身就是克制的越级，
   再叠一条"额外 15% 往更高一级跳"会让上下概率翻倍到 25%，与用户口径冲突。
   越级的实现现在只有一处：`matchCandidate` 的三级加权。 */


/** 生成器出场概率（用户 2026-10-06 多轮定稿，与设置面板「?」里的说明逐字一致）。
 *  「段」= **本级 ±1 级**（三级匹配那三格）、按出题档与执子过滤后的**静态题**集合：
 *    total = 段内静态题总数；fresh = 其中没出过的（不在 seen 里）的数量。
 *  - total >= 700：题多的段完全自循环、靠重复，一道都不生成（0）；
 *  - fresh > 0：这一段还没出完，不出生成题（0）；
 *  - fresh === 0（这一段全出过了）：按段内总量给概率——
 *      < 10 → 0.99、< 50 → 0.90、< 100 → 0.80、100–699 → 0.50；
 *  - total === 0（14 手以上，段内一道都没有）：1。 */
export function GENERATOR_PROBABILITY(total: number, fresh: number): number {
  if (total === 0) return 1;
  if (total >= 700) return 0;
  if (fresh > 0) return 0;
  if (total < 10) return 0.99;
  if (total < 50) return 0.90;
  if (total < 100) return 0.80;
  return 0.50;
}

interface Candidate {
  id: string;
  attacker: Player;
  depth: number;              // kaibao 池在求解前为 -1
  tier: VcfTier;
  black: Position[];
  white: Position[];
  solution: Array<Position & { player: Player }> | null;
  /** 原始解线坐标串（题源里那条，形状不统一）——**解答线在出到这道题时才现推**（见 toProblem）。
   *  不能在池子加载时推：几千道全走一遍引擎，手机上首次出题要卡好几秒（2026-10-06 修）。 */
  coords?: Position[];
  /** 结局类型：离线预算好写在 vcf-meta.json 里（白棋优先留抓禁手题要用它） */
  ending?: SolutionEnding;
  /** 解线只有攻方冲四（推不成完整线）——界面会写明，避免被当成"答案画错了" */
  singleSide?: boolean;
  /** 离线修复表（超算预算，见 vcf-repair.json）给的完整攻守交替胜线——有它就别再现推 */
  precomputed?: Array<Position & { player: Player }>;
}

/** 逐手参考分已删（2026-10-12 R188/R190）：题目难度只有"手数"这一把尺，
 *  匹配与结算都直接用 `levelOfHands(depth)`，不再经过一条分数曲线。 */

const tierOf = (depth: number): VcfTier | null => {
  if (depth < 1) return null;          // 一手胜也收（用户 10-06：「搞点 1-2 手胜的题目」）
  if (depth <= 6) return "short";
  if (depth <= 12) return "middle";
  if (depth <= CHALLENGE_MAX_DEPTH) return "deep";      // 深档 13+，挑战上限 35
  return null;
};

const parseCoordName = (token: string): Position | null => {
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(token.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = 15 - Number(m[2]);
  return row >= 0 && row < 15 && col >= 0 && col < 15 ? { row, col } : null;
};
const parseStoneRun = (s: string): Position[] =>
  (s.match(/[A-Oa-o]\d{1,2}/g) ?? []).map(parseCoordName).filter((p): p is Position => p !== null);

// ---------- 池 ①：素材（带解线） ----------
const materialPool = async (): Promise<Candidate[]> => {
  const [material, metaMap, repair] = await Promise.all([loadVcfMaterial(), loadSolutionMeta(), loadRepairTable()]);
  if (!material || !material.items.length) return [];
  return material.items.flatMap((it) => {
    const black = it.b.map(([r, c]) => ({ row: r, col: c }));
    const white = it.w.map(([r, c]) => ({ row: r, col: c }));
    /* 加载期只做便宜解析：手数取题源标注（没有才退回坐标串长度）、结局取离线 meta。
       完整解线留到**出到这道题时**才现推（见 toProblem）——几千道在加载期全推一遍会把首屏卡住。 */
    const coords = it.l.map(([r, c]) => ({ row: r, col: c }));
    const id = "m-" + it.i;
    const rep = repair[id];
    if (rep?.bad) return [];                              // 超算判定的坏题：题池不收
    const meta = metaMap[id];
    const precomputed = rep ? repairLine(rep) : undefined;
    const depth = rep?.d ?? meta?.d ?? (typeof it.d === "number" && it.d > 0 ? it.d : coords.length);
    const tier = tierOf(depth);
    if (!tier) return [];
    return [{
      id,
      attacker: it.a,
      depth,
      tier,
      black,
      white,
      solution: null,
      coords,
      ending: rep?.e ?? meta?.e,
      precomputed,
    }];
  });
};

// ---------- 池 ②：生成批次（带正解注释） ----------
const commentCoords = (comment: string): Position[] | null => {
  const m = /正解：(.+)$/m.exec(comment || "");
  if (!m) return null;
  const moves = m[1].split("→").map(parseCoordName);
  if (!moves.length || moves.some((p) => p === null)) return null;
  return moves as Position[];
};

const batchPool = async (): Promise<Candidate[]> => {
  const out: Candidate[] = [];
  const metaMap = await loadSolutionMeta();
  const repair = await loadRepairTable();
  for (let fi = 0; fi < BATCH_FILES.length; fi += 1) {
    try {
      const res = await fetch(`${BASE}${BATCH_FILES[fi]}`);
      if (!res.ok) continue;
      const data = await res.json() as { puzzles?: Array<Record<string, unknown>> };
      (data.puzzles ?? []).forEach((p, ei) => {
        const attacker = p.side === "white" ? "white" as const : "black" as const;
        const black = parseStoneRun(String(p.blackStones ?? ""));
        const white = parseStoneRun(String(p.whiteStones ?? ""));
        const coords = commentCoords(String(p.comment ?? ""));
        if (!coords) return;
        const id = "b-" + fi + "-" + ei;
        const rep = repair[id];
        if (rep?.bad) return;                            // 超算判定的坏题：题池不收
        const meta = metaMap[id];
        const promptHands = Number(String(p.prompt ?? "").match(/(\d+)\s*手/)?.[1] ?? 0);
        const depth = rep?.d ?? meta?.d ?? (promptHands > 0 ? promptHands : coords.length);
        const tier = tierOf(depth);
        if (!black.length || !tier) return;
        out.push({ id, attacker, depth, tier, black, white, solution: null, coords, ending: rep?.e ?? meta?.e, precomputed: rep ? repairLine(rep) : undefined });
      });
    } catch { /* 单个批次缺失不影响其它池 */ }
  }
  return out;
};

// ---------- 池 ③：开宝题库 VCF 集（无解线，选题时现场求解） ----------
const kaibaoPool = async (): Promise<Candidate[]> => {
  const out: Candidate[] = [];
  for (let fi = 0; fi < KAIBAO_FILES.length; fi += 1) {
    try {
      const res = await fetch(`${BASE}${KAIBAO_FILES[fi]}`);
      if (!res.ok) continue;
      const text = await res.text();
      const title = /([^/]+)\.json$/.exec(KAIBAO_FILES[fi])?.[1] ?? "题集";
      const report = importKaibaoPuzzleJson(text, title);
      report.collection.puzzles.forEach((p, pi) => {
        const black = p.stones.filter((s) => s.player === "black").map((s) => ({ row: s.row, col: s.col }));
        const white = p.stones.filter((s) => s.player === "white").map((s) => ({ row: s.row, col: s.col }));
        if (!black.length && !white.length) return;
        out.push({ id: `k-${fi}-${pi}`, attacker: p.player, depth: -1, tier: "short", black, white, solution: null });
      });
    } catch { /* 单个题集缺失不影响其它池 */ }
  }
  return out;
};

// ---------- 池缓存 ----------
/** 离线预算好的解线元信息（手数 + 结局类型）：`public/puzzles/vcf-meta.json`，由预计算脚本生成。
 *  为什么要离线：完整解线要跑引擎，几千道在池子加载时全推一遍会把首屏卡住（2026-10-06 修）。
 *  拿不到这个文件也不影响出题——退回题源标注，只是"白棋优先留抓禁手"这一条会失效。 */
let metaCache: Promise<Record<string, { d: number; e?: SolutionEnding }>> | null = null;
const loadSolutionMeta = () => (metaCache ??= (async () => {
  try {
    const res = await fetch(`${BASE}puzzles/vcf-meta.json`);
    if (!res.ok) return {};
    return await res.json() as Record<string, { d: number; e?: SolutionEnding }>;
  } catch {
    return {};
  }
})());

/** 离线修复表（`public/puzzles/vcf-repair.json`）：超算分片跑出来的坏题普查结果
 *  （用户 10-06：「如果你是在本地算的，你现在放超算上面去算」）。
 *  两种表项：`{bad:true}` = 挑战规则下无解的坏题，题池直接不收；`{d,e,line}` = 预计算的
 *  完整攻守交替胜线，出题时直接用（运行时零开销）。拿不到文件不影响出题——退回
 *  toProblemVerified 的运行时快闸（推不成换一道）。 */
export interface RepairEntry { bad?: true; d?: number; e?: SolutionEnding; line?: Array<[number, number, number]> }
let repairCache: Promise<Record<string, RepairEntry>> | null = null;
export const loadRepairTable = (): Promise<Record<string, RepairEntry>> => (repairCache ??= (async () => {
  try {
    const res = await fetch(`${BASE}puzzles/vcf-repair.json`);
    if (!res.ok) return {};
    return await res.json() as Record<string, RepairEntry>;
  } catch {
    return {};
  }
})());

/** 修复表里的手写坐标 → 完整攻守交替解线（1=黑 2=白）。 */
const repairLine = (entry: RepairEntry): Array<Position & { player: Player }> | undefined =>
  entry.line?.length ? entry.line.map(([row, col, p]) => ({ row, col, player: p === 1 ? "black" as const : "white" as const })) : undefined;

let materialCache: Promise<Candidate[]> | null = null;
let batchCache: Promise<Candidate[]> | null = null;
let kaibaoCache: Promise<Candidate[]> | null = null;
let staticCache: Promise<Candidate[]> | null = null;
const materialP = () => (materialCache ??= materialPool());
const batchP = () => (batchCache ??= batchPool());
const kaibaoP = () => (kaibaoCache ??= kaibaoPool());

/** 每个手数最多留多少道（用户 10-06：「所有的手数题目都只保留 1 千道，尽量黑白均衡，
 *  白棋杀的话多保留那些抓禁手的题目」）。不足 1000 道的手数原样全留。 */
export const CULL_PER_DEPTH = 1000;

/** 逐手数裁剪 + 黑白均衡：每个手数最多 1000 道，黑白各占一半（某方不够时由另一方补足）；
 *  白棋攻方优先保留**抓禁手**结局的题（`ending === "forbidden"`）。按 id 稳定排序，
 *  所以每次启动留下的是同一批题（不会今天一套明天一套）。 */
export const cullStaticPool = (list: Candidate[]): Candidate[] => {
  const byDepth = new Map<number, Candidate[]>();
  for (const c of list) {
    const bucket = byDepth.get(c.depth);
    if (bucket) bucket.push(c); else byDepth.set(c.depth, [c]);
  }
  const out: Candidate[] = [];
  for (const bucket of byDepth.values()) {
    if (bucket.length <= CULL_PER_DEPTH) { out.push(...bucket); continue; }
    const half = CULL_PER_DEPTH / 2;
    const black = bucket.filter((c) => c.attacker === "black").sort((a, b) => a.id.localeCompare(b.id));
    const white = bucket.filter((c) => c.attacker === "white").sort((a, b) => a.id.localeCompare(b.id));
    const whiteFirst = [...white.filter((c) => c.ending === "forbidden"), ...white.filter((c) => c.ending !== "forbidden")];
    const takeWhite = Math.min(whiteFirst.length, Math.max(half, CULL_PER_DEPTH - black.length));
    const takeBlack = Math.min(black.length, CULL_PER_DEPTH - takeWhite);
    out.push(...whiteFirst.slice(0, takeWhite), ...black.slice(0, takeBlack));
  }
  return out;
};

/** 静态题池（素材 + 批次），已按手数裁剪到每档 1000 道。出题与题池盘点都读它，
 *  这样设置面板上写的题数与实际能出到的题一致。 */
const staticP = () => (staticCache ??= (async () => cullStaticPool([...(await materialP()), ...(await batchP())]))());

export interface PoolSummary { material: number; batch: number; kaibao: number; total: number; matched: number }

/** 当前过滤条件下的题池规模（matched = 落在匹配窗口内的题数）。 */
export async function poolSummary(tier: VcfTier | "auto", attacker: Player | "random", rating: number, solved: ReadonlySet<string>): Promise<PoolSummary> {
  const staticAll = await staticP();
  const k = await kaibaoP();
  const inTier = (c: Candidate) => tier === "auto" || c.tier === tier;
  const ok = (c: Candidate) => (attacker === "random" || c.attacker === attacker) && inTier(c) && c.depth >= 1 && !solved.has(c.id);
  const m = staticAll.filter((c) => c.id.startsWith("m-"));
  const b = staticAll.filter((c) => c.id.startsWith("b-"));
  const material = m.filter(ok).length;
  const batch = b.filter(ok).length;
  const kaibao = k.filter((c) => (attacker === "random" || c.attacker === attacker) && !solved.has(c.id)).length;
  /* 「窗口内」= **上/本/下三级**（与 matchCandidate 同一口径，2026-10-12 改版）。
     以前是"分数 ±300"，那个数在低段是整整一级、在高段是一级半，界面上说不清；
     现在直接按等级差数，说明也好写（"本级 + 上下各一级"）。 */
  const myLevel = levelOf(rating);
  /* 手选档位是明确的用户约束：选「中 7–12」或「深 13+」时，
     即使玩家当前仍是 1 级，也应该能从所选档位的题池里出题。
     只有「自动」档才按玩家等级取上/本/下三级；否则设置面板会显示
     有大量题但“本级可出 0 道”，实际点击又因为窗口为空而报没有题。 */
  const matched = [...m, ...b].filter(ok)
    .filter((c) => tier !== "auto" || Math.abs(levelOfHands(c.depth) - myLevel) <= 1).length;
  return { material, batch, kaibao, total: material + batch + kaibao, matched };
}

const buildBoard = (c: Candidate): Int8Array => {
  const b = new Int8Array(225);
  for (const s of c.black) b[s.row * 15 + s.col] = 1;
  for (const s of c.white) b[s.row * 15 + s.col] = 2;
  return b;
};

const toProblem = (c: Candidate): ChallengeProblem => {
  /* 解答线在这里现推（**只推这一道**，约 1ms）：题源那条坐标串有的只写攻方冲四、有的攻守交替，
     按奇偶配色会把一半的题涂错颜色（用户 10-05 报的就是这个）。推不成完整线时**不编造**：
     整串如实标成攻方手 + singleSide，由界面写明"只列攻方冲四"。
     超算修复表给了预计算线的题（precomputed）直接用它，不走现推。 */
  const built = c.precomputed?.length ? null : c.coords?.length ? buildSolutionLine(c.black, c.white, c.attacker, c.coords) : null;
  const problemOf = (solution: ChallengeProblem["solution"], ending?: SolutionEnding, singleSide = false): ChallengeProblem => ({
    id: c.id, attacker: c.attacker, depth: c.depth, tier: c.tier,
    black: c.black, white: c.white,
    solution,
    ending: c.ending ?? ending,
    singleSide,
    source: c.id.startsWith("m-") ? "material" : c.id.startsWith("b-") ? "batch" : "kaibao",
  });
  if (c.precomputed?.length) return problemOf(c.precomputed);
  if (built) return problemOf(built.line, built.ending);
  return problemOf(c.coords?.length ? attackerOnlyLine(c.coords, c.attacker) : c.solution ?? [], c.ending, Boolean(c.coords?.length));
};

/* ── 坏题闸（用户 10-06 报：4 手题答案全是攻方一色，而且照着答案下根本赢不了）──────────
   全池扫描（8025 道）找到 470 道这种题：题源正解在挑战规则下走不通——守方的**强制挡子
   顺带成了守方的四**，题源的致胜手只顾自己冲四、没带四挡住守方的五点，classifyAttack
   直接拒绝这手棋（「守方有反四——这一手必须带四并挡住它」）。
   实测这类题**真的无解**（抽 m-18 用挑战规则确定性 DFS 搜到 6 手、66 秒仍无胜线），
   所以不能"把答案画全"了事——只能整道不进对局。
   做法：题源正解推得成 → 原样出（94% 快路径，约 1ms）；推不成 → 返回 null，调用方换一道。
   不做慢修复（离线预计算另说）：求解器修复单道中位 268ms、最长 1.4 秒，放进出题路径会卡 UI。 */
export const toProblemVerified = (c: Candidate): ChallengeProblem | null => {
  if (!c.coords?.length || c.precomputed?.length) return toProblem(c);  // 没串可推的（开宝池/修好的）直接出
  if (!buildSolutionLine(c.black, c.white, c.attacker, c.coords)) return null;
  return toProblem(c);
};

/** 生成器兜底出题（worker 后台线程，不卡 UI）：只在题池轮转穷尽时调用。
 *  2026-10-06 起 worker 走的是**和棋题生成器同一台引擎**（重新构造路线），不是素材变形；
 *  手数按玩家水平给（depth），攻方按本局要的来，保证返回的题正好能出。 */
const generateOnDemand = async (attacker: Player, solved: ReadonlySet<string>, tier: VcfTier, depthRange?: [number, number], depth?: number, signal?: AbortSignal): Promise<ChallengeProblem | null> => {
  if (signal?.aborted) return null;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  // Matching consumes one question. Asking for three made the player wait for
  // two more full constructions whose results were immediately discarded.
  const puzzles = await runGeneratorWorker(1, seed, depthRange, attacker, depth, signal);
  if (signal?.aborted) return null;
  const pz = puzzles.find((p) => p.attacker === attacker) ?? puzzles[0];
  if (!pz || solved.has("g-" + seed + "-" + pz.sourceIndex)) return null;
  return {
    id: "g-" + seed + "-" + pz.sourceIndex,
    attacker: pz.attacker,
    depth: pz.depth,
    tier: tierOf(pz.depth) ?? tier,
    black: pz.black,
    white: pz.white,
    solution: pz.solution.map((m) => ({ row: m.row, col: m.col, player: m.player })),
    source: pz.fallback ? "transform" : "novel",
    generatedOnDemand: true,
  };
};

const runGeneratorWorker = (count: number, seed: number, depthRange?: [number, number], attacker?: Player, depth?: number, signal?: AbortSignal): Promise<GeneratedVcfPuzzle[]> =>
  new Promise((resolve) => {
    if (signal?.aborted) { resolve([]); return; }
    /* 三条失败路径都要留一句话（2026-10-08）：以前一律静默 resolve([])，「生成器压根没起来」和
       「这个预算内没出到题」在界面上长得一模一样，高等级空手时完全无法定位。
       实测 dev 服务器上这条必挂（classic 构造 vs worker 源码里的 ESM import），生产包正常。 */
    const note = (reason: string) => { console.warn(`[vcf-gen] ${reason}：本局退回题池`); };
    let worker: Worker;
    try {
      /* Vite 的开发服务器直接把这个 URL 作为 ESM 源码返回（里面有 import），
         因而不能用默认的 classic worker 加载：浏览器会在解析 import 时让线程
         立刻死掉，补题方只能收到空数组。生产构建由 vite.config.ts 把 worker
         打成 iife，继续走 classic 以兼容 Chrome 79；按构建环境选择类型，两个
         环境都使用同一条生成链。 */
      worker = import.meta.env.DEV
        ? new Worker(new URL("../vcf/vcf-gen.worker.ts", import.meta.url), { type: "module" })
        : new Worker(new URL("../vcf/vcf-gen.worker.ts", import.meta.url));
    } catch (error) {
      note(`worker 起不来（${String(error).slice(0, 120)}）`);
      resolve([]);
      return;
    }
    let settled = false;
    const done = (puzzles: GeneratedVcfPuzzle[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(puzzles);
    };
    const cancel = () => done([]);
    /* 外层上限 75 秒：深题（生成器实测 D35@15 路约数秒至几十秒）在结算后的预取里慢慢算，
       浅题几秒就回；超时回报空 → 出题方退到题池最深一档，不会白等后空手。 */
    const timer = window.setTimeout(() => { note("75 秒没回题"); done([]); }, 75000);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; puzzles?: GeneratedVcfPuzzle[] }>) => {
      if (event.data?.type === "result") done(event.data.puzzles ?? []);
    };
    worker.onerror = (event) => { note(`worker 报错（${String(event?.message ?? "").slice(0, 120)}）`); done([]); };
    // The from-empty engine uses no material. Sending the old corpus here
    // wasted a structured clone and made fresh generation depend on its load.
    try {
      worker.postMessage({ type: "generate", count, seed, depthRange, attacker, depth });
    } catch (error) {
      note(`worker 请求失败（${String(error).slice(0, 120)}）`);
      done([]);
    }
  });

const randomOf = <T,>(pool: T[]): T => pool[Math.floor(Math.random() * pool.length)];

/** 匹配出题（2026-10-12 用户改版）：**取上/本/下三级**，本级 80%、上下各 10%。
 *
 *  用户原话：「搞得可以匹配到上一个等级，这一个等级，以及下一个等级的题目，
 *            不过排到上下等级的概率不能太大」。
 *
 *  与旧版的区别：旧版是"分数窗 ±300 + 15% 越级"，**跨级幅度不定**（±300 分在低段
 *  是整整一级、在高段是一级半），而且越级只朝上加。现在改成**按等级取三级**
 *  （题目等级 = 该题手数，见 `levelOfHands`），上下对称、幅度确定；
 *  上下各 10% 也比旧版"15% 只往上越"更克制。
 *
 *  边界：1 级没有下一级、满级没有上一级 —— 缺失那侧的权重**并回本级**
 *  （用户要的是"排到上下等级的概率不大"，不是"边界上必然空手"）。 */
const matchCandidate = (pool: Candidate[], rating: number): Candidate | null => {
  if (!pool.length) return null;
  const myLevel = levelOf(rating);
  const levelOfPool = (c: Candidate) => levelOfHands(c.depth);
  /* 三级分桶：本级 / 上一级 / 下一级。题目手数与等级一一对应，所以"等级差"就是"手数差"。 */
  const same = pool.filter((c) => levelOfPool(c) === myLevel);
  const upper = pool.filter((c) => levelOfPool(c) === myLevel + 1);
  const lower = pool.filter((c) => levelOfPool(c) === myLevel - 1);
  /* 边界把缺失侧的权重并回本级（1 级没有 0 级、满级没有上一级） */
  const missing = (upper.length ? 0 : MATCH_ADJACENT_WEIGHT) + (lower.length ? 0 : MATCH_ADJACENT_WEIGHT);
  const buckets: Array<{ pool: Candidate[]; weight: number }> = [
    { pool: same, weight: MATCH_SAME_WEIGHT + missing },
    { pool: upper, weight: upper.length ? MATCH_ADJACENT_WEIGHT : 0 },
    { pool: lower, weight: lower.length ? MATCH_ADJACENT_WEIGHT : 0 },
  ].filter((b) => b.pool.length > 0 && b.weight > 0);

  if (buckets.length) {
    const total = buckets.reduce((s, b) => s + b.weight, 0);
    let roll = Math.random() * total;
    for (const b of buckets) {
      roll -= b.weight;
      if (roll <= 0) return randomOf(b.pool);
    }
    return randomOf(buckets[buckets.length - 1].pool);
  }
  /* 三级全空（例如等级远高于题池最深一档）：退回"最接近的一道"，不空手。 */
  return pool.reduce((best, c) =>
    Math.abs(levelOfPool(c) - myLevel) < Math.abs(levelOfPool(best) - myLevel) ? c : best, pool[0]);
};

/** 从「全出过」的重复池里挑题（用户 10-06 定稿）：优先没进最近 200 次（recent）的，
 *  其次按「最久没出」——seen 由 seenIds 构造，Set 的迭代顺序就是出题先后，越靠前越久没出。 */
const pickLeastRecent = (pool: Candidate[], seen: ReadonlySet<string>, recent: ReadonlySet<string>): Candidate | null => {
  if (!pool.length) return null;
  const notRecent = pool.filter((c) => !recent.has(c.id));
  const candidates = notRecent.length ? notRecent : pool;
  const rank = new Map<string, number>();
  let i = 0;
  for (const id of seen) rank.set(id, i++);
  return candidates.reduce((best, c) => ((rank.get(c.id) ?? -1) < (rank.get(best.id) ?? -1) ? c : best), candidates[0]);
};

export interface MatchOptions { tier: VcfTier | "auto"; attacker: Player | "random"; rating: number; solved: ReadonlySet<string>; seen?: ReadonlySet<string>; /** 最近出过的 200 道（seenIds 末尾 200 条）——重复出题时先避开它们（LRU）。 */ recent?: ReadonlySet<string>; genDeep?: boolean; /** Cancels stale matching and terminates its generation worker. */ signal?: AbortSignal }

/** 盘点/测试用：**上/本/下三级**内、按出题档与执子过滤后的静态题 id（与出题的「段」同一集合，
 *  已排除做过的）。出题逻辑改了这里要跟着改，否则调用方会拿到错的一段。 */
export async function segmentStaticIds(tier: VcfTier | "auto", attacker: Player, rating: number, solved: ReadonlySet<string>): Promise<string[]> {
  const myLevel = levelOf(rating);
  const inTier = (c: Candidate) => (tier === "auto" || c.tier === tier) && c.depth >= 1 && c.depth <= CHALLENGE_MAX_DEPTH;
  return (await staticP())
    .filter((c) => c.attacker === attacker && inTier(c) && !solved.has(c.id))
    // 手选档位是练习范围约束，不能再叠加当前等级窗口；否则低等级选中/深档
    // 时这里会错误地报告空段，与实际出题和设置面板不一致。
    .filter((c) => tier !== "auto" || Math.abs(levelOfHands(c.depth) - myLevel) <= 1)
    .map((c) => c.id);
}

/** 这个**等级分**下该出多少手的题（生成器补题用；界面与测试都读它，避免两处各算一套）。
 *  ⚠ 2026-10-12 起**等级 = 手数**（用户口径「1 级 1 手、3 级 3 手…13 级 13 手」）：
 *     等级分先换成等级（`levelOf`），等级就是目标手数，再夹进所在一档的范围。
 *     旧版是"题分曲线反推手数"，那条线已经与等级分脱钩（见 rating.ts 的 handsOfLevel）。 */
export const generationDepthFor = (rating: number, tier: VcfTier | "auto" = "auto"): number => {
  // rating.ts may retain a larger standalone generator ceiling for old saves;
  // challenge matching is deliberately capped at 35 hands.
  const hands = Math.min(CHALLENGE_MAX_DEPTH, handsOfLevel(levelOf(rating)));
  const t = tier === "auto" ? (tierOf(hands) ?? "short") : tier;
  const [lo, hi] = GEN_RANGES[t];
  return Math.min(hi, Math.max(lo, hands));
};

/** 出题顺序（2026-10-06 定稿，生成器出场按 GENERATOR_PROBABILITY）：
 *  ① **匹配窗口内**还有没出过、没做过的静态题（素材+批次）→ 直接出题池的题（此时概率必为 0）；
 *  ② 段内出完了（fresh = 0）或段内一道都没有（total = 0）→ 按概率掷生成器；命中就出生成的新题，
 *     手数用 generationDepthFor 按玩家水平定；
 *  ③ 生成没中 / 生成失败（worker 起不来/超时/没出到）→ 从题池重复出题：按 LRU，
 *     优先没进最近 200 次的，其次「最久没出」；
 *  ④ 段内一道静态题都没有、且要的手数不高于静态池天花板 → 开宝池现场验题（最多试 4 道）；
 *  ⑤ 仍然没有 → 要的手数高过静态池天花板时退回题池里最深的一档（生成器关掉/起不来时兜底）。
 *  attacker = "random" 时每局随机定黑白；genDeep = false（用户关掉生成器）时不掷概率，直接走题池。 */
export async function pickMatchedProblem(opts: MatchOptions): Promise<ChallengeProblem | null> {
  const { tier, rating, solved } = opts;
  if (opts.signal?.aborted) return null;
  const attacker: Player = opts.attacker === "random" ? (Math.random() < 0.5 ? "black" : "white") : opts.attacker;
  const genDeep = opts.genDeep !== false;                 // 关掉 = 不用题目生成器，只出题池里的题
  const seen = opts.seen ?? new Set<string>();
  const recent = opts.recent ?? new Set<string>();
  const inTier = (c: Candidate) => (tier === "auto" || c.tier === tier) && c.depth >= 1 && c.depth <= CHALLENGE_MAX_DEPTH;
  const base = (c: Candidate) => c.attacker === attacker && inTier(c) && !solved.has(c.id);
  const staticAll = (await staticP()).filter(base);
  if (opts.signal?.aborted) return null;
  /* 匹配基准（2026-10-12 改版）：**等级**，不是分数。
     等级 → 手数是一一对应的（1 级 1 手…13 级 13 手，14 级以上由生成器出到挑战允许的 35 手），
     所以「上/本/下三级」= 「手数 −1 / 不变 / +1」，不再有"分数窗在不同等级宽窄不一"的问题。 */
  const myLevel = levelOf(rating);
  /** 生成器能补的这一档（手数很低时退回短档——以前 `?? "deep"` 会把低等级的补题要成 13 手）。 */
  const genTierOf = (): VcfTier => tier === "auto"
    ? (tierOf(Math.min(CHALLENGE_MAX_DEPTH, handsOfLevel(myLevel))) ?? "deep")
    : tier;
  /** 让生成器出**正好这个手数**的题：等级就是目标手数，再夹进这一档的范围里。 */
  const wantDepth = (): number => generationDepthFor(rating, tier);
  /**
   * Generated questions use the same 80/10/10 adjacent-level policy as the
   * static pool. This matters at level 34: the player's own level is 34, but
   * the upper adjacent challenge is 35 hands and must remain reachable.
   */
  let generatedDepth: number | null = null;
  const generatedTargetDepth = (): number => {
    if (generatedDepth !== null) return generatedDepth;
    const baseLevel = levelOf(rating);
    const candidates: Array<{ level: number; weight: number }> = [{ level: baseLevel, weight: MATCH_SAME_WEIGHT }];
    if (baseLevel > 1) candidates.push({ level: baseLevel - 1, weight: MATCH_ADJACENT_WEIGHT });
    else candidates[0].weight += MATCH_ADJACENT_WEIGHT;
    if (baseLevel < CHALLENGE_MAX_DEPTH) candidates.push({ level: baseLevel + 1, weight: MATCH_ADJACENT_WEIGHT });
    else candidates[0].weight += MATCH_ADJACENT_WEIGHT;
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = Math.random() * total;
    let selected = baseLevel;
    for (const candidate of candidates) {
      roll -= candidate.weight;
      if (roll <= 0) { selected = candidate.level; break; }
    }
    const selectedTier = tier === "auto" ? (tierOf(selected) ?? "short") : tier;
    const [lo, hi] = GEN_RANGES[selectedTier];
    generatedDepth = Math.min(hi, Math.max(lo, selected));
    return generatedDepth;
  };
  /** 这一局要的手数已经高过静态题池的天花板（13 手）→ 题池里根本没有这个难度的题，
   *  直接交给生成器；这时别再走「开宝池现场验题」——那一步是主线程同步求解（最多 4×2.5s），
   *  而开宝题集全是短题、这一档必然验不过，白等十来秒（2026-10-06 修）。 */
  const beyondStatic = wantDepth() > STATIC_MAX_DEPTH;
  const tryGenerate = async (): Promise<ChallengeProblem | null> => {
    if (!genDeep) return null;
    /* 生成题不受 seen 约束：生成器每次随机种子出新题，只用 solved 挡「同一道解过又重出」。 */
    const target = generatedTargetDepth();
    return generateOnDemand(attacker, solved, genTierOf(), GEN_RANGES[genTierOf()], target, opts.signal);
  };

  // ① 段 = **上/本/下三级**内的静态题（与 matchCandidate 同一口径）：三级之外的题不算"这一段有题"
  //    抽中的题先过坏题闸（toProblemVerified）：题源正解不成立又救不回的坏题换一道再试（最多 3 试）
  /* 自动档按等级取上/本/下三级；手选档位则按用户选中的档位取题。
     手选档位不是“仍按当前等级过滤后再换一个标签”，否则低等级选择中/深档
     会把整个所选档位过滤空，生成器一旦超时就落到 null。 */
  const windowed = tier === "auto"
    ? staticAll.filter((c) => Math.abs(levelOfHands(c.depth) - myLevel) <= 1)
    : staticAll;
  const freshPool = windowed.filter((c) => !seen.has(c.id));
  if (freshPool.length) {
    let pool = freshPool;
    for (let tries = 0; tries < 3 && pool.length; tries += 1) {
      const fresh = matchCandidate(pool, rating);
      if (!fresh) break;
      const p = toProblemVerified(fresh);
      if (p) return p;
      pool = pool.filter((x) => x.id !== fresh.id);
    }
  }

  /* ② 段内出完了（fresh = 0，概率按总量给）或段内一道都没有（total = 0，概率 1）→ 掷生成器。
        genDeep 关掉时完全不掷；生成失败就落回下面的题池，不破坏既有兜底。 */
  if (genDeep && Math.random() < GENERATOR_PROBABILITY(windowed.length, freshPool.length)) {
    const generated = await tryGenerate();
    if (opts.signal?.aborted) return null;
    if (generated) return generated;
  }

  // ③ 段内全出过 → 重复出题：LRU，优先没进最近 200 次的，其次「最久没出」
  const repeated = pickLeastRecent(windowed, seen, recent);
  if (repeated) {
    const rp = toProblemVerified(repeated);
    if (rp) return { ...rp, note: "本段题目都轮转过了，这题是重复出题" };
  }

  // ④ 段内一道静态题都没有、且要的手数不高于静态池天花板 → 开宝池现场验题（最多试 4 道）
  if (!beyondStatic) {
    const candidates = (await kaibaoP()).filter((c) => c.attacker === attacker && !solved.has(c.id) && !seen.has(c.id));
    if (opts.signal?.aborted) return null;
    for (let attempt = 0; attempt < 4 && candidates.length; attempt += 1) {
      const c = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      const sol = solveVcf(buildBoard(c), {
        attacker: attacker === "black" ? 1 : 2, rules: "renju",
        maxDepth: 40, timeBudget: 2500,
      });
      if (!sol.win) continue;
      /* 解算器给的是完整攻守线，仍走一遍规范化：既拿到结局类型（抓禁手），也顺手再验一次。 */
      const built = buildSolutionLine(c.black, c.white, attacker, sol.line.map((m) => ({ row: m.row, col: m.col })));
      if (!built) continue;
      const t = tierOf(built.depth);
      if (!t || (tier !== "auto" && t !== tier)) continue;
      return {
        id: c.id, attacker, depth: built.depth, tier: t,
        black: c.black, white: c.white,
        solution: built.line,
        ending: built.ending,
        source: "kaibao",
      };
    }
  }

  /* ⑤ 兜底（段内一道都没有、生成器关掉/起不来/没出到题）：退回**静态题池里最深的一档**，
     别让人对着"没有新题了"发呆。高等级时这题会明显低于自己水平，所以 note 里说清楚。 */
  if (beyondStatic) {
    /* 题池最深一档 = 等级 13（13 手，静态池天花板）：按等级取三级，不再按分数窗。 */
    const deepestPool = staticAll.filter((c) => Math.abs(levelOfHands(c.depth) - STATIC_MAX_DEPTH) <= 1);
    const deepest = matchCandidate(deepestPool.filter((c) => !seen.has(c.id)), levelFloor(STATIC_MAX_DEPTH))
      ?? matchCandidate(deepestPool, levelFloor(STATIC_MAX_DEPTH));
    if (deepest) {
      const dp = toProblemVerified(deepest);
      if (dp) return { ...dp, note: "这一段要的手数（" + (generatedDepth ?? wantDepth()) + " 手）只有生成器能出；先用题池里最深的 " + dp.depth + " 手题" };
    }
  }
  return null;
}
