// 把「棋题生成器」那台引擎（vcf-generator/lib/browser.mjs 的 generate）出的题，转成 VCF 挑战能直接用的题。
//
// 为什么要转（2026-10-06 补题换成同一台引擎时踩到的）：
//  · 生成器返回的 solution 是**自主验题用的证明树顺序**，会出现「无法防守的冲四 → 对方挡 → 连五」这类收尾，
//    和挑战「逐步走、每手都过 classifyAttack」的走法对不上（实测整条被打回）；
//  · 所以答案线由挑战自己的 solveVcf 重新解一遍（毫秒级），再过 buildSolutionLine 规范成攻守交替线；
//  · 手数按 depthRange 夹住（生成器按"目标手数"造，可能浅一手，别把深档喂成短题）。
// 这段逻辑单独放这里，worker 与单测共用同一份，避免"测试里是对的、跑起来是另一样"。
import { solveVcf } from "./vcf-generator";
import { buildSolutionLine } from "../vcf-challenge/solution-line";
import { CHALLENGE_MAX_DEPTH } from "../vcf-challenge/rating";
import type { GeneratedVcfPuzzle } from "./vcf-corpus";
import type { Player } from "../../types";

export interface LibPuzzleLike {
  id: string;
  /** 生成器题面的实际路数；不能把 30 路题按 15 路索引送入挑战引擎。 */
  size: number;
  attacker: Player;
  depth: number;
  stones: { black: Array<{ row: number; col: number }>; white: Array<{ row: number; col: number }> };
  /** 生成器自己的证明线（攻守交替）：`at` 是 15×15 的格号，null = 守方无处可挡（过手） */
  solution: Array<{ at: number | null; player: 1 | 2; note: string }>;
  /** 最新生成器的独立验题证书。挑战补题不接受缺证书或未验完的候选。 */
  verification?: { valid: boolean; shortest: boolean; status?: string; depth?: number };
  /** 生成器页和挑战补题都要求唯一首手；这是质量门槛的一部分。 */
  uniqueFirst?: boolean;
  provenance?: { method?: string; [key: string]: unknown };
}

export interface OnDemandShape {
  /** 这一档允许的手数区间（不给就不夹） */
  depthRange?: [number, number];
  /** 最多收几道 */
  count: number;
  /** 每道重新求解的时间预算（毫秒） */
  solveBudgetMs?: number;
}

/** 生成器的题 → 挑战的题；验不过/解不出/手数不合的**直接丢**（宁可少一道，不给错题）。 */
export const toChallengePuzzles = (libPuzzles: LibPuzzleLike[], shape: OnDemandShape): GeneratedVcfPuzzle[] => {
  const out: GeneratedVcfPuzzle[] = [];
  /* 手数按**挑战自己的口径**夹档（见下面 built.depth）：挑战把"无法防守的冲四"直接判胜，
     所以同一道题在挑战里可能比生成器少数一手（生成器的 5 手题，挑战第 4 手就赢了）。
     下沿松一手正是为这个，不然深档的题会被系统性丢光。 */
  const lo = shape.depthRange ? Math.max(1, shape.depthRange[0] - 1) : 1;
  const hi = shape.depthRange ? Math.min(CHALLENGE_MAX_DEPTH, shape.depthRange[1]) : CHALLENGE_MAX_DEPTH;
  for (const p of libPuzzles) {
    if (out.length >= shape.count) break;
    // VCF 挑战的实时棋盘与 classifyAttack 当前仍是 15 路语义。
    // 生成器已经支持 30 路；在挑战引擎参数化完成前必须明确丢弃扩展题，
    // 不能让下面的 row * 15 + col 把坐标静默折叠到错误的格子。
    if (p.size !== 15) continue;
    // 与生成器页同一个硬门槛：必须有独立验题证书、最短解和唯一首手。
    // 过去这里用 `if (p.verification && ...)`，缺证书的候选会静默混入挑战，
    // 使旧 worker/伪造数据绕过质量门槛。挑战补题宁可少一道，也不送未验题。
    if (p.uniqueFirst !== true || p.verification?.valid !== true || p.verification.shortest !== true || p.verification.depth !== p.depth) continue;
    // 证书本身还不够：挑战补题必须明确来自最新的 compact/naturalStyle
    // 空盘构造链，避免旧素材变形器或其它调用方伪装成 novel 题。
    // The challenge contract is the woven, complex route. `naturalStyle` is
    // necessary but not sufficient: the generator can technically emit both
    // `naturalStyle:true` and `simple:true` when callers mix route options.
    // Reject that combination here so a future worker/caller regression cannot
    // silently downgrade challenge questions to the fast single-chain route.
    if (p.provenance?.naturalStyle !== true || p.provenance.simple === true || p.provenance.layout !== "compact" || p.provenance.corpusUsed !== false) continue;
    if (!Number.isInteger(p.depth) || p.depth < 3 || p.depth > CHALLENGE_MAX_DEPTH) continue;
    if (p.depth < lo || p.depth > hi + 1) continue;
    const occupied = new Set<string>();
    const validStones = (stones: Array<{ row: number; col: number }>) => stones.every((s) => {
      if (!Number.isInteger(s.row) || !Number.isInteger(s.col) || s.row < 0 || s.row >= 15 || s.col < 0 || s.col >= 15) return false;
      const key = `${s.row},${s.col}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      return true;
    });
    if (!validStones(p.stones.black) || !validStones(p.stones.white)) continue;
    const sourceAttackerMoves = p.solution.filter((m) => m.player === (p.attacker === "black" ? 1 : 2) && m.at !== null);
    if (sourceAttackerMoves.length < p.depth) continue;
    const board = new Int8Array(225);
    for (const s of p.stones.black) board[s.row * 15 + s.col] = 1;
    for (const s of p.stones.white) board[s.row * 15 + s.col] = 2;
    const attacker = p.attacker;
    /* 答案线优先用**生成器自己的证明线**（它是真下出来的一条攻守交替线：我冲四、你挡……）。
       挑战的求解器另解一遍只在规范不了时兜底——实测有些局面（攻方已经是双四/无解局面）
       求解器会给一条"只有攻方、没有对方挡子"的线，照那条走会因为补出来的挡子改变局面而推不下去。 */
    const libCoords = p.solution.filter((m) => m.at !== null)
      .map((m) => ({ row: Math.floor((m.at as number) / 15), col: (m.at as number) % 15 }));
    let built = buildSolutionLine(p.stones.black, p.stones.white, attacker, libCoords);
    if (!built) {
      const sol = solveVcf(board, {
        attacker: attacker === "black" ? 1 : 2, rules: "renju",
        maxDepth: p.depth + 1, timeBudget: shape.solveBudgetMs ?? 2000,
      });
      if (sol.win) built = buildSolutionLine(p.stones.black, p.stones.white, attacker, sol.line.map((m) => ({ row: m.row, col: m.col })));
    }
    if (!built) continue;
    // 生成器证书与挑战规范线最多因“不可防冲四”少一手；更大的缩水说明
    // 转换链找到的是另一道浅题，不能借 depthRange 的宽下沿混入深档。
    if (built.depth < Math.max(lo, p.depth - 1) || built.depth > Math.min(hi, p.depth)) continue;
    out.push({
      title: p.id,
      size: p.size,
      rules: "renju",
      attacker: p.attacker,
      depth: built.depth,
      black: p.stones.black,
      white: p.stones.white,
      solution: built.line.map((m) => ({ row: m.row, col: m.col, player: m.player, note: "" })),
      uniqueFirst: true,
      novel: true,        // 这台引擎是"重新构造"，不是素材换壳
      fallback: null,
      sourceIndex: out.length,
    });
  }
  return out;
};
