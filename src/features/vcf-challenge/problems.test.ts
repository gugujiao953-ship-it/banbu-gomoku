// problems.test.ts — 出题顺序的回归门（2026-10-05 用户报过两个真问题，钉住它们）：
//  ① 高等级以前会去够不存在的手数，结果空手而归/一直重复同一道；
//     现在挑战等级封顶 34 级（9900 分），匹配可排到相邻的 35 手题。
//  ② 题池里"这一段有题"必须优先出题池的题，不能动不动就上生成器。
// 每个用例都把 fetch 换成本地读 public/puzzles/*（浏览器里是 BASE_URL + 相对路径）。
// @ts-expect-error Node 只在 Vitest 下可用
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cullStaticPool, GENERATOR_PROBABILITY, generationDepthFor, pickMatchedProblem, poolSummary, segmentStaticIds, toProblemVerified } from "./problems";
import { MAX_RATING } from "./rating";
import { buildSolutionLine } from "./solution-line";
import { classifyAttack, vidx, VCF_SIZE, type VcfBoard } from "./engine";

const readPublic = (url: string) => {
  const name = url.replace(/^\/+/, "").replace(/^puzzles\//, "");
  try {
    return readFileSync(new URL(`../../../public/puzzles/${name}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
};

const stubFetch = () => {
  vi.stubGlobal("fetch", async (input: string) => {
    const text = readPublic(String(input));
    if (text === null) return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text } as unknown as Response;
  });
};

const NONE: ReadonlySet<string> = new Set<string>();

describe("VCF 出题顺序", () => {
  beforeEach(() => stubFetch());
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("低等级（1000）出题池里的短题，且标注 source 来自题池", async () => {
    const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 1000, solved: NONE });
    expect(p).not.toBeNull();
    // 1–2 手题 2026-10-06 入库后，低段那几级里就有它们了（用户要的"搞点 1-2 手的"）。
    // ⚠ 1000 分 = 4 级，三级匹配覆盖 3–5 手；这里断到 1–6 手是留出题档的余量。
    expect(p!.depth).toBeGreaterThanOrEqual(1);
    expect(p!.depth).toBeLessThanOrEqual(6);
    expect(["material", "batch"]).toContain(p!.source);
    expect(p!.generatedOnDemand).toBeFalsy();
  });

  it("三级匹配：0 分（1 级）出 1–2 手，1000 分（4 级）出 3–5 手（用户 10-12 改版）", async () => {
    /* 旧版是「±300 分窗」，一档覆盖的手数与等级无关；新版本级 = 手数，
       从上/本/下三级取 → 0 分（1 级）只能碰到 1–2 手（1 级没有上一级，权重并回本级）。 */
    const seenLow = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 0, solved: NONE });
      if (p) seenLow.add(p.depth);
    }
    expect([...seenLow].every((d) => d <= 2)).toBe(true);
    expect([...seenLow].some((d) => d === 1)).toBe(true);

    // 1000 分 = 4 级 → 3/4/5 手（上下一级各 10%）
    const seenMid = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 1000, solved: NONE });
      if (p) seenMid.add(p.depth);
    }
    expect([...seenMid].every((d) => d >= 3 && d <= 5)).toBe(true);
    expect(seenMid.has(4)).toBe(true);          // 本级一定有
  });

  it("三级匹配的上下级概率不高：本级占绝大多数，上一级/下一级各约 10%", async () => {
    /* 用户 10-12：「排到上下等级的概率不能太大」→ 本级 80%、上下各 10%。
       这里用 4 级（1000 分）采样 400 次，统计各级占比（随机采样，给宽区间）。 */
    let same = 0, adjacent = 0;
    const N = 400;
    for (let i = 0; i < N; i += 1) {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 1000, solved: NONE });
      if (!p) continue;
      if (p.depth === 4) same += 1;
      else adjacent += 1;
    }
    expect(same / N).toBeGreaterThan(0.62);     // 理论 0.80，给随机波动留量
    expect(adjacent / N).toBeLessThan(0.38);
  });

  it("该出多少手 = **等级**（等级即手数，用户 10-12 改版），再夹进档位范围", () => {
    /* 旧版是"题分曲线反推手数"，改版后直接：等级 = 手数（挑战最多匹配到 35 手）。 */
    expect(generationDepthFor(0)).toBe(1);                    // 1 级 → 1 手
    expect(generationDepthFor(1000)).toBe(4);                 // 4 级 → 4 手
    expect(generationDepthFor(1500)).toBe(6);                 // 6 级 → 6 手
    expect(generationDepthFor(3600)).toBe(13);                // 13 级 → 13 手（静态池天花板）
    expect(generationDepthFor(3900)).toBe(14);                // 14 级 → 14 手（这一档起靠生成器）
    expect(generationDepthFor(4800)).toBe(17);
    expect(generationDepthFor(8800)).toBe(30);
    // 挑战等级封顶 34 级；35 手只作为满级的相邻匹配题
    expect(generationDepthFor(9999)).toBe(34);
    expect(generationDepthFor(Number.MAX_SAFE_INTEGER)).toBe(34);
    // 手数被夹进所选档位：指定「短」档不会给 20 手、指定「深」档不会给 1 手
    expect(generationDepthFor(4800, "short")).toBe(6);
    expect(generationDepthFor(0, "deep")).toBe(13);
  });

  it("高等级（封顶 9999）也不空手而归：出题落到最深一档（≤35 手），不报错不空手", async () => {
    for (const rating of [8800, MAX_RATING]) {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating, solved: NONE });
      expect(p).not.toBeNull();
      expect(p!.depth).toBeGreaterThanOrEqual(1);
      expect(p!.depth).toBeLessThanOrEqual(35);              // 挑战上限：36+ 不进入挑战
    }
  });

  it("高等级（3000，≈11 手）不会空手而归：窗口里就有 10–12 手的题", async () => {
    const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 3000, solved: NONE });
    expect(p).not.toBeNull();
    // 3000 分 = 11 级（每级 300 分），三级匹配覆盖 10–12 手 ⇒ 静态池里就有，不需要生成器也不空手
    expect(p!.depth).toBeGreaterThanOrEqual(10);
  });

  it("题池里这一段还有没出过的题时，出的就是题池的题（不走生成器）", async () => {
    const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 1500, solved: NONE });
    expect(p).not.toBeNull();
    expect(p!.generatedOnDemand).toBeFalsy();
    expect(["material", "batch"]).toContain(p!.source);
  });

  it("手选中档不受当前等级窗口拦截：1 级也能从 7–12 手题池出题", async () => {
    const p = await pickMatchedProblem({ tier: "middle", attacker: "black", rating: 0, solved: NONE, genDeep: false });
    expect(p).not.toBeNull();
    expect(p!.depth).toBeGreaterThanOrEqual(7);
    expect(p!.depth).toBeLessThanOrEqual(12);
    expect(p!.generatedOnDemand).toBeFalsy();
  });

  it("手选深档不受当前等级窗口拦截：1 级也能从 13+ 题池出题", async () => {
    const p = await pickMatchedProblem({ tier: "deep", attacker: "black", rating: 0, solved: NONE, genDeep: false });
    expect(p).not.toBeNull();
    expect(p!.depth).toBeGreaterThanOrEqual(13);
    expect(p!.depth).toBeLessThanOrEqual(35);
    expect(p!.generatedOnDemand).toBeFalsy();
  });

  it("手选档位的题池盘点与实际出题一致", async () => {
    const middle = await poolSummary("middle", "black", 0, NONE);
    const deep = await poolSummary("deep", "black", 0, NONE);
    expect(middle.matched).toBeGreaterThan(0);
    expect(deep.matched).toBeGreaterThan(0);
  });

  it("手选档位的题池盘点与实际出题一致：1 级选中/深档不会报 0", async () => {
    const middle = await segmentStaticIds("middle", "black", 0, NONE);
    const deep = await segmentStaticIds("deep", "black", 0, NONE);
    expect(middle.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
  });

  it("题池这一段全出过（seen 塞满）→ 要么生成新题，要么明确告诉你是重复题", async () => {
    // 深档（13 手 = 静态池天花板 3400 分）这一段静态题最少，最容易摸干净：反复抽到不再出现新 id 为止
    const ids = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      const before = ids.size;
      const p = await pickMatchedProblem({ tier: "deep", attacker: "black", rating: 3400, solved: NONE });
      if (p && !p.generatedOnDemand) ids.add(p.id);
      if (ids.size === before && round >= 3) break;
    }
    expect(ids.size).toBeGreaterThan(0);
    // 多试几轮：`seen` 一旦塞满，返回的必须要么是生成题、要么是带说明的重复题、要么真的没题
    for (let round = 0; round < 4; round += 1) {
      const again = await pickMatchedProblem({ tier: "deep", attacker: "black", rating: 3400, solved: NONE, seen: ids });
      if (!again) continue;
      if (again.generatedOnDemand) continue;
      if (again.note === "本段题目都轮转过了，这题是重复出题") {
        expect(ids.has(again.id), "标了「重复出题」就应该是 seen 里的题").toBe(true);
        continue;
      }
      // 没标记也不是生成题 ⇒ 只能是还没见过的题（我们把 id 收进来，下一轮必定走重复/生成）
      ids.add(again.id);
    }
  });

  it("关掉生成器（genDeep:false）时，任何时候都不会返回生成器题", async () => {
    const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 3000, solved: NONE, genDeep: false });
    if (p) expect(p.generatedOnDemand).toBeFalsy();
  });

  it("题池盘点与设置面板口径一致（题池已按手数裁剪、窗口内有题）", async () => {
    const s = await poolSummary("auto", "black", 1200, NONE);
    // 静态题池（素材 + 批次）已按「每个手数最多 1000 道」裁剪，所以总数比裁剪前小了；
    // 加上开宝池（未验题，不参与裁剪）仍是五千道量级。
    expect(s.total).toBeGreaterThan(5000);
    expect(s.matched).toBeGreaterThan(0);
  });

  it("题池裁剪：每个手数最多 1000 道、黑白各半；白棋优先留抓禁手题（用户 10-06 的口径）", () => {
    const mk = (depth: number, attacker: "black" | "white", i: number, ending?: "five" | "openFour" | "forbidden") =>
      ({ id: `${attacker}-${depth}-${String(i).padStart(4, "0")}`, attacker, depth, tier: "short" as const, black: [], white: [], solution: [], ending });
    const list = [
      ...Array.from({ length: 700 }, (_, i) => mk(5, "black", i)),
      ...Array.from({ length: 700 }, (_, i) => mk(5, "white", i, i < 300 ? "forbidden" : "five")),
      mk(9, "black", 1),                                  // 不足 1000 的手数原样保留
    ];
    const out = cullStaticPool(list);
    expect(out.length).toBe(1001);                         // 手数 5 裁到 1000，手数 9 保留
    expect(out.filter((c) => c.depth === 5).length).toBe(1000);
    expect(out.filter((c) => c.depth === 5 && c.attacker === "black").length).toBe(500);
    expect(out.filter((c) => c.depth === 5 && c.attacker === "white").length).toBe(500);
    // 白棋 500 道里，抓禁手的 300 道全都留下了（优先保留）
    expect(out.filter((c) => c.attacker === "white" && c.ending === "forbidden").length).toBe(300);
    expect(out.filter((c) => c.depth === 9).length).toBe(1);
  });

  it("生成器出场概率按段内总量/余量查表（用户 10-06 定稿，设置面板「?」里的表）", () => {
    const cases: Array<[number, number, number]> = [
      [800, 500, 0],   // 题多的段 + 还没出完 → 0
      [626, 100, 0],   // 这一段没出完 → 0（不生成）
      [196, 50, 0],    // 同上
      [800, 0, 0],     // 全出过但总量 ≥700：完全自循环、靠重复，0（与 700 边界同）
      [200, 0, 0.5],   // 全出过、100–699 道 → 0.5
      [99, 0, 0.8],    // 不足 100 道 → 0.8
      [49, 0, 0.9],    // 不足 50 道 → 0.9
      [9, 0, 0.99],    // 不足 10 道 → 0.99
      [700, 0, 0],     // 边界：700 起为 0
      [699, 0, 0.5],   // 边界内侧：699 仍是 0.5
      [0, 0, 1],       // 段内一道都没有（14 手以上）→ 1
    ];
    for (const [total, fresh, want] of cases) {
      expect(GENERATOR_PROBABILITY(total, fresh), `total=${total}/fresh=${fresh}`).toBe(want);
    }
  });

  it("段内全出过时按 LRU 重复：优先没进最近 200 次的题（recent 传了才生效）", async () => {
    // 9 级（2600 分）的三级窗口 = 8/9/10 手，黑方段内题数在数百道量级：足够 >200 来验「窗口外回归」
    const ids = await segmentStaticIds("auto", "black", 2600, NONE);
    expect(ids.length).toBeGreaterThan(200);
    const seen = new Set(ids);
    const recent = new Set(ids.slice(-200));            // 只把最近 200 条算「刚出过」
    // 概率 0.5（全出过、总量 <700）也不让它命中生成器：钉死走题池的 LRU 重复
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 2600, solved: NONE, seen, recent });
      expect(p).not.toBeNull();
      expect(p!.generatedOnDemand).toBeFalsy();
      expect(seen.has(p!.id)).toBe(true);               // 全出过了，返回的必定是 seen 里的题
      expect(recent.has(p!.id)).toBe(false);            // LRU：优先挑「最近 200 次窗口」之外的旧题
    } finally { rand.mockRestore(); }
  });

  it("recent 未传时行为不变：段内全出过仍返回题池里的重复题（不死循环在最近窗口）", async () => {
    const ids = await segmentStaticIds("auto", "black", 2600, NONE);
    const seen = new Set(ids);
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      const p = await pickMatchedProblem({ tier: "auto", attacker: "black", rating: 2600, solved: NONE, seen });
      expect(p).not.toBeNull();
      expect(p!.generatedOnDemand).toBeFalsy();
      expect(seen.has(p!.id)).toBe(true);
    } finally { rand.mockRestore(); }
  });
});

// ── 坏题闸（用户 10-06 报：4 手题答案全是攻方一色，照答案下也赢不了）────────────────
// 题源正解在引擎规则下走不通（守方强制挡子顺带成反四，题源致胜手没带四挡）→ 实测这类题
// **真的无解**（挑战规则确定性 DFS 搜到 6 手、66 秒仍无胜线）。所以 toProblemVerified 只做
// 一件事：推得成完整线就出，推不成返回 null，调用方换一道。不做慢修复（那道题也不值得修：
// 全池 470 道里只有 41 道可修，单道中位 268ms、最长 1.4s，放进出题路径会卡 UI）。
describe("坏题闸 toProblemVerified", () => {
  const coord = (t: string) => ({ row: 15 - Number(t.slice(1)), col: t.charCodeAt(0) - 65 });
  const run = (s: string) => (s.match(/[A-O]\d{1,2}/g) ?? []).map(coord);
  const m18 = () => ({
    id: "m-18", attacker: "black" as const, depth: 4, tier: "short" as const,
    black: run("I13H12J12K12G11H11K11G10I9K9G8H8J8H7I6"),
    white: run("H14J14K13G12L12I11I10J10F9H9I8G7I7K7J5"),
    solution: null,
    coords: run("M9L10L9J9K8K10J7"),
  });

  it("m-18（题源致胜手没带四挡反四）不再出题：返回 null，调用方换一道", () => {
    expect(toProblemVerified(m18())).toBeNull();
  });

  it("好题原样出，解线攻守交替、攻方手数与 depth 一致", () => {
    // 从素材池挑一道 buildSolutionLine 能推成的题，直接喂给坏题闸
    const items = (JSON.parse(readPublic("vcf-material.json") ?? "{}").items ?? []) as Array<{ i: number; a: string; b: number[][]; w: number[][]; l: number[][]; d?: number }>;
    const good = items.map((it) => ({
      id: `m-${it.i}`, attacker: (it.a === "white" ? "white" : "black") as "black" | "white",
      depth: typeof it.d === "number" && it.d > 0 ? it.d : it.l.length, tier: "short" as const,
      black: it.b.map(([r, c]) => ({ row: r, col: c })), white: it.w.map(([r, c]) => ({ row: r, col: c })),
      solution: null, coords: it.l.map(([r, c]) => ({ row: r, col: c })),
    })).find((c) => c.depth >= 1 && c.depth <= 6 && buildSolutionLine(c.black, c.white, c.attacker, c.coords) !== null);
    expect(good).toBeDefined();
    const p = toProblemVerified(good!);
    expect(p).not.toBeNull();
    expect(p!.singleSide).toBeFalsy();
    const line = p!.solution;
    expect(line.length).toBeGreaterThan(0);
    expect(line.filter((m) => m.player === p!.attacker).length).toBe(p!.depth);
  });

  it("正解串被截断（推不成完整线）的题同样被拦下：返回 null", () => {
    // 构造：拿一道真实浅题（1–3 手），把正解串截掉最后的致胜手
    const items = (JSON.parse(readPublic("vcf-material.json") ?? "{}").items ?? []) as Array<{ i: number; a: string; b: number[][]; w: number[][]; l: number[][]; d?: number }>;
    const found = items.map((it) => {
      const c = { id: `m-${it.i}`, attacker: (it.a === "white" ? "white" : "black") as "black" | "white", depth: 0, tier: "short" as const, black: it.b.map(([r, c]) => ({ row: r, col: c })), white: it.w.map(([r, c]) => ({ row: r, col: c })), solution: null as null, coords: it.l.map(([r, c]) => ({ row: r, col: c })) };
      const built = buildSolutionLine(c.black, c.white, c.attacker, c.coords);
      return built && built.depth >= 1 && built.depth <= 3 ? { c, built } : null;
    }).find((x) => x !== null);
    expect(found).not.toBeNull();
    const { c, built } = found!;
    const broken = { ...c, depth: built.depth + 1, coords: built.line.slice(0, built.line.length - 1).map((m) => ({ row: m.row, col: m.col })) };
    expect(toProblemVerified(broken)).toBeNull();
  });

  it("候选带超算修复表线（precomputed）时直接出题、绕过坏题闸，singleSide 为 false", () => {
    // 线本身由 pool-report 的表结构测试保证合法；这里只钉「接线」：有 precomputed 就用它
    const precomputed = [
      { row: 6, col: 12, player: "black" as const },
      { row: 6, col: 13, player: "white" as const },
      { row: 7, col: 12, player: "black" as const },
    ];
    const cand = { ...m18(), precomputed };
    const p = toProblemVerified(cand);
    expect(p).not.toBeNull();
    expect(p!.solution).toEqual(precomputed);
    expect(p!.singleSide).toBeFalsy();
  });

  it("超算判定的坏题不再进题池：m-18 不在 1600 分段的候选里", async () => {
    const ids = await segmentStaticIds("auto", "black", 1600, NONE);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain("m-18");
  });

  it("修复表里的每条线都按运行时语义重放得通（攻手过 classifyAttack、守手=强制挡点）", () => {
    const table = JSON.parse(readPublic("vcf-repair.json") ?? "{}") as Record<string, { bad?: true; d?: number; line?: number[][] }>;
    const material = (fn: string) => (JSON.parse(readPublic(fn) ?? "{}").items ?? []) as Array<{ i: number; a: string; b: number[][]; w: number[][]; l: number[][] }>;
    const mate = material("vcf-material.json"), mate3 = material("vcf-material-3.json"), mate12 = material("vcf-material-12.json");
    let replayed = 0;
    for (const [id, v] of Object.entries(table)) {
      if (v.bad || !v.line?.length) continue;
      // 找源局面：m-<i>（按偏移归位）或 b-<fileIdx>-<ei>（解析正解注释同批次池）
      let black: Array<{ row: number; col: number }> = [], white: Array<{ row: number; col: number }> = [], attacker: "black" | "white" = "black";
      const mMatch = id.match(/^m-(\d+)$/);
      if (mMatch) {
        const n = Number(mMatch[1]);
        const items = n >= 2_000_000 ? mate12 : n >= 1_000_000 ? mate3 : mate;
        const it = items.find((x) => x.i + (n >= 2_000_000 ? 2_000_000 : n >= 1_000_000 ? 1_000_000 : 0) === n);
        if (!it) continue;
        black = it.b.map(([r, c]) => ({ row: r, col: c }));
        white = it.w.map(([r, c]) => ({ row: r, col: c }));
        attacker = it.a === "white" ? "white" : "black";
      } else {
        const bMatch = id.match(/^b-(\d+)-(\d+)$/);
        if (!bMatch) continue;
        const batchFile = ["vcf-batch-1001.json", "vcf-batch-2002.json", "vcf-batch-3003.json"][Number(bMatch[1])];
        const data = JSON.parse(readPublic(batchFile) ?? "{}") as { puzzles?: Array<{ side?: string; blackStones?: string; whiteStones?: string }> };
        const p = (data.puzzles ?? [])[Number(bMatch[2])];
        if (!p) continue;
        const parse = (s: string) => (s.match(/[A-Oa-o]\d{1,2}/g) ?? []).map((t) => ({ row: 15 - Number(t.slice(1)), col: t.toUpperCase().charCodeAt(0) - 65 }));
        black = parse(p.blackStones ?? "");
        white = parse(p.whiteStones ?? "");
        attacker = p.side === "white" ? "white" : "black";
      }
      // 逐步重放：攻手必须过 classifyAttack；紧接着的守手必须**恰为**该攻手算出的唯一挡点
      const board = new Int8Array(VCF_SIZE * VCF_SIZE) as VcfBoard;
      for (const s of black) board[vidx(s.row, s.col)] = 1;
      for (const s of white) board[vidx(s.row, s.col)] = 2;
      const defender: "black" | "white" = attacker === "black" ? "white" : "black";
      let pendingBlock: number | undefined;
      let won = false;
      for (const [r, c, p] of v.line!) {
        const expected: "black" | "white" = p === 1 ? "black" : "white";
        if (expected === attacker) {
          const verdict = classifyAttack(board, r, c, attacker);
          expect(verdict.ok, `${id} 攻手 (${r},${c}) 应合法：${verdict.message}`).toBe(true);
          expect(board[vidx(r, c)], `${id} 攻手落点应为空`).toBe(0);
          board[vidx(r, c)] = p;
          if (verdict.outcome === "win") { won = true; break; }
          expect(verdict.block, `${id} 冲四应有挡点`).toBeDefined();
          pendingBlock = verdict.block;
        } else {
          expect(p, `${id} 守手应为对方色`).toBe(defender === "black" ? 1 : 2);
          expect(r * 15 + c, `${id} 守手应为上一攻手的强制挡点`).toBe(pendingBlock);
          board[vidx(r, c)] = p;
          pendingBlock = undefined;
        }
      }
      expect(won, `${id} 重放应走到终局`).toBe(true);
      replayed += 1;
    }
    console.log(`ANSWER repair replay ok=${replayed}`);
    expect(replayed).toBeGreaterThan(0);
  });
});
