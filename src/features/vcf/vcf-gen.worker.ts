/// <reference lib="webworker" />
// VCF 挑战的补题 worker（用户 2026-10-06：「生成器生成的题怎么都是差不多的题，基本是一个题目形变…
// 我自己去对弈里面的题目生成器生成了几次，就没怎么重复过啊」）。
//
// 以前这里走的是**素材变形**（vcf-corpus 的 mode:"transform"）：把素材库里的局面换个方向摆出来，
// 所以连着出几道看着都像同一道。现在改成**和「对弈 → 棋题生成器」同一台引擎**
// （vcf-generator/lib/browser.mjs 的 generate，带 naturalStyle / uniqueFirst）：题型、子力形态、
// 冲四路线都重新构造，不是换壳。
// 如果它在预算内没出到题（深档比较吃算力），worker 返回空结果，由挑战题池明确兜底；
// 不再把旧的素材旋转换壳题冒充新生成题。
import { generate } from "../../../vcf-generator/lib/browser.mjs";
import type { GeneratedVcfPuzzle } from "./vcf-corpus";
import { toChallengePuzzles, type LibPuzzleLike } from "./on-demand-puzzles";
import { CHALLENGE_MAX_DEPTH } from "../vcf-challenge/rating";
import type { Player } from "../../types";

/** 挑战补题只传构造参数；独立生成器页使用自己的 Worker。 */

interface GenerateRequest {
  type: "generate";
  count: number;
  seed: number;
  depthRange?: [number, number];
  /** 想要的攻方（挑战按你执黑还是执白来要题） */
  attacker?: Player;
  /** 想出的具体手数（不给就从 depthRange 里按 seed 取一个） */
  depth?: number;
}
interface ProgressMessage { type: "progress"; done: number; attempts: number }
interface ResultMessage { type: "result"; puzzles: GeneratedVcfPuzzle[]; attempts: number; fallbackUsed: boolean; error: string | null }

/** 预算与调用参数（2026-10-06 深夜与主对话的生成器迭代对齐）：
 *  · **必须带 `layout: "compact"` 与 `routingNoise: 1`**——迭代日志里 bench 的 APP_BASE 就是这套
 *    （vcf-generator/qa/bench.mjs），独立生成器页也传 compact；不传的话新引擎连 5 手题都出不来
 *    （实测 200 次尝试 1 秒内全落空，status=incomplete），这是补题当时"静默退回重复出题"的根因。
 *  · 预算按深度给：浅题（≤12 手）20 秒足够；深题按迭代日志实测（D40@15 路 43 秒）给到 45–60 秒，
 *    外层 worker 上限同步放宽到 75 秒——反正有结算后的预取把等待藏进空窗，超时还有题池兜底。 */
const NEW_ENGINE = { solveMs: 5_000, verifyMs: 15_000, maxAttempts: 200, layout: "compact" as const, routingNoise: 1 };
/**
 * VCF 挑战的路线契约：挑战永远使用高质量复杂构造。
 * 生成器页面的 `qualityRoute` 开关只服务生成器页面，不能通过复用 worker
 * 或旧存档把挑战悄悄降级成快速单链题。
 */
const CHALLENGE_ROUTE = { uniqueFirst: true, naturalStyle: true, simple: false } as const;
const timeBudgetFor = (depth: number): number => (depth <= 12 ? 20_000 : depth <= 24 ? 35_000 : 60_000);
/** 外层硬上限：比最深的 timeMs 略宽，超了就回报空（出题方退到题池兜底）。 */
const depthFromRange = (range: [number, number] | undefined, seed: number): number => {
  if (!range) return 9;
  const lo = Math.max(3, range[0]);
  const hi = Math.min(CHALLENGE_MAX_DEPTH, range[1]);
  return Math.min(hi, lo + Math.abs(seed) % Math.max(1, hi - lo + 1));
};

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const req = event.data;
  if (!req || req.type !== "generate") return;
  const count = Math.max(1, req.count || 1);
  const attacker: Player = req.attacker ?? "black";
  // 题目生成器页仍可独立生成 40/100 手；挑战页的实时引擎只接入到 35 手。
  // 这里再次夹住，防止旧版页面或恶意消息把 36+ 题送进挑战题池。
  const depth = Math.min(CHALLENGE_MAX_DEPTH, Math.max(3, req.depth ?? depthFromRange(req.depthRange, req.seed)));

  let attempts = 0;
  const puzzles: GeneratedVcfPuzzle[] = [];
  // ① 新引擎（与棋题生成器同一台）：重新构造路线，不是素材换壳
  try {
    for (let i = 0; i < count; i += 1) {
      const result = generate({
        count: 1, depth, attacker, rules: "renju", size: 15, maxSize: 15,
        seed: (req.seed + Math.imul(i, 1013904223)) | 0,
        timeMs: timeBudgetFor(depth),
        ...NEW_ENGINE,
        // 挑战补题固定走高质量复杂路线：支撑/干扰编织 + 唯一首手。
        // 白先深题会在生成器内部轮换一条已验证的路由噪声，降低
        // Renju 平衡子把候选变成更短赢法的概率；这不是降级为快速路线。
        // 这里不要读取生成器页面的 qualityRoute 设置。
        ...CHALLENGE_ROUTE,
        onProgress: () => { attempts += 1; },
      }) as { puzzles?: LibPuzzleLike[] };
      // 转换（重新求解 + 规范解线 + 手数夹档）在 on-demand-puzzles.ts 里，单测用的是同一份
      const converted = toChallengePuzzles(result.puzzles ?? [], { count: count - puzzles.length, depthRange: req.depthRange });
      puzzles.push(...converted);
      self.postMessage({ type: "progress", done: puzzles.length, attempts } satisfies ProgressMessage);
      if (puzzles.length >= count) break;
    }
    if (puzzles.length) {
      self.postMessage({ type: "result", puzzles, attempts, fallbackUsed: false, error: null } satisfies ResultMessage);
      return;
    }
  } catch {
    // 新引擎抛错也按「没出到题」处理，交给出题方兜底（不再退回旧的素材驱动生成器）。
  }
  /* 新引擎没出到题（预算用完/种子不合适）→ 直接回报空：
     出题方（problems.ts）会退到「题池里最深那一档」并写明原因。
     这里**不再退回旧的素材驱动生成器**（用户 2026-10-06：「之前的那个旧的生成器没有删掉吗，
     就是只有形状变化的那个」）——那台把素材局面换个方向摆出来，正是"都是一道题的形变"的来源。 */
  self.postMessage({ type: "result", puzzles: [], attempts, fallbackUsed: false, error: null } satisfies ResultMessage);
};

export {};
