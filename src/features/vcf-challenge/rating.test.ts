// rating.test.ts — 解答力评分体系单测（2026-10-06 第二轮定标；2026-10-12 段位制改版；2026-10-14 统一台阶与计时表）：
// 一把尺「题目等级 = 手数」/ 计时难度三档全表（13 级后每 2 级一档、最高级收在 PACE_CAP）/ 等级差加减分表（含 ±3 边界）/
// 加分式子夹 1–150 再乘倍数（默认档顶格 +300）、扣分不乘倍数且下限 0 / 0–9999 封顶（9900 = 34 级入门分，挑战可排到 35 手）/ 等级阶梯不跳级 / 起始档 / 记录与已出集合。
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ratingModule from "./rating";   // 只用它反向断言「旧曲线已经不存在」
import {
  applyResult, paceSecondsFor, migrateSettings, levelGapLabel,
  PACE_MODES, PACE_GAIN, PACE_LABELS, PACE_STEPS, PACE_STEP_GAIN, PACE_START, PACE_CAP, PACE_POST_STEP_EVERY, GAIN_MAX, LOSS_MAX,
  levelOf, levelFloor, levelProgress, levelSpanOf, handsOfLevel, levelOfHands,
  markSeen, withResult, resetToStartLevel, START_RATINGS, START_LEVELS, START_LEVEL_LV,
  startLevelLabel, startLevelHandRange, HISTORY_LIMIT,
  LEVEL_LOW_STEP, LEVEL_HIGH_STEP, LEVEL_LOW_MAX, LEVEL_STEP, LEVEL_MAX, LEVEL_BASE,
  MATCH_SAME_WEIGHT, MATCH_ADJACENT_WEIGHT,
  MAX_MATCH_RATING, MAX_RATING, STATIC_MAX_DEPTH, STATIC_CEILING_RATING, GEN_MAX_DEPTH, CHALLENGE_MAX_DEPTH,
  DEFAULT_SETTINGS, loadState, TIMER_WARN_MS, isTimerWarning,
  type PaceMode, type VcfChallengeState,
} from "./rating";

const baseState = (over: Partial<VcfChallengeState> = {}): VcfChallengeState => ({
  rating: LEVEL_BASE, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0,
  daily: {}, history: [], settings: { pace: "default", genDeep: true }, ...over,
});

/** 取 levelFloor(k) 做等级对齐的分值：题目分与玩家分都落在等级带的正底，
 *  这样 gap = levelOf(problemR) − levelOf(rating) 正好等于两个 k 的差（不会被带内取整干扰）。
 *  ⚠ 2026-10-14 起所有等级统一 300 分，levelFloor 仍是唯一入口。 */
const atLevel = (k: number) => levelFloor(k);

afterEach(() => vi.unstubAllGlobals());

describe("解答力评分体系", () => {
  /**
   * 题目难度**只有"手数"这一把尺**（2026-10-12 R188 修正 + 本轮删曲线）。
   *
   * 旧版另有一条 `problemRating = 1000 + 200×(手数−1)`（配 `handsOfRating` 逆运算、
   * `BASE_RATING`/`RATING_STEP` 两个常数）。段位改版后它与等级分**不同尺度**：状态行写
   * 「6 手 · ≈2000 分」，可 2000 分在等级分那把尺上是**7 级** —— 用户据此以为"这题比我高一级"，
   * 而结算曾经直接吃这条曲线，才出现"同级题加 +28~+44"。修正后它只剩一个显示用途，
   * 留着就是下一处漂移，所以整条删除。这条用例反向钉住"它不会悄悄长回来"。
   */
  it("题分曲线已删除；手数 ↔ 等级一一对应；状态行说「这题相对你是同级/高 N 级/低 N 级」", () => {
    for (const gone of ["problemRating", "handsOfRating", "BASE_RATING", "RATING_STEP"]) {
      expect((ratingModule as Record<string, unknown>)[gone]).toBeUndefined();
    }
    expect(levelOfHands(1)).toBe(1);
    expect(levelOfHands(13)).toBe(13);
    expect(levelOfHands(40)).toBe(40);
    expect(handsOfLevel(1)).toBe(1);
    expect(handsOfLevel(13)).toBe(13);
    expect(handsOfLevel(100)).toBe(GEN_MAX_DEPTH);   // 超过生成器上限就夹住
    // 1–34 级：做与自己同级的手数题，状态行必写"同级"（与结算 gap=0 同一算法）
    for (let level = 1; level <= LEVEL_MAX; level += 1) {
      expect(levelGapLabel(level, levelFloor(level))).toBe("同级");
    }
    expect(levelGapLabel(7, levelFloor(6))).toBe("高 1 级");
    expect(levelGapLabel(9, levelFloor(6))).toBe("高 3 级");
    expect(levelGapLabel(5, levelFloor(6))).toBe("低 1 级");
    expect(levelGapLabel(1, levelFloor(6))).toBe("低 5 级");
    // 封顶口径与结算一致：9999 分的人按最高可达 34 级计算；35 手是挑战允许的相邻深题。
    expect(levelGapLabel(34, MAX_RATING)).toBe("同级");
    expect(levelGapLabel(CHALLENGE_MAX_DEPTH, MAX_RATING)).toBe("高 1 级");
  });

  it("计时难度三档：默认 ×2 / 充裕 ×1 / 休闲 ×0.5（时限随等级伸缩，全表见下一条）", () => {
    expect(PACE_MODES).toEqual(["default", "ample", "casual"]);
    expect(PACE_GAIN).toEqual({ default: 2, ample: 1, casual: 0.5 });
    expect(PACE_LABELS).toEqual({ default: "默认", ample: "充裕", casual: "休闲" });
    expect(DEFAULT_SETTINGS.pace).toBe("default");
    // 未设置过的用户直接拿到默认档
    expect(loadState().settings.pace).toBe("default");
  });

  it("坏存档字段逐项兜底，保留正常分数、旧历史与兼容设置", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({
      rating: 1200, solved: "很多", failed: -4, streak: null, bestStreak: 3,
      solvedIds: "不是数组", seenIds: ["one", null, "one", "two"],
      daily: { "2026-10-11": { solved: 2, failed: -5 }, nope: "坏" },
      history: [{ ts: 1, tier: "short", depth: 3, win: true, moves: 2, delta: 5 }, null, { ts: 2, tier: "不存在" }],
      settings: { pace: "ample", genDeep: false },
    }) });
    const state = loadState();
    expect(state.rating).toBe(1200);
    expect(state.solved).toBe(0);
    expect(state.failed).toBe(0);
    expect(state.streak).toBe(0);
    expect(state.bestStreak).toBe(3);
    expect(state.solvedIds).toEqual([]);
    expect(state.seenIds).toEqual(["one", "two"]);
    expect(state.daily).toEqual({ "2026-10-11": { solved: 2, failed: 0 } });
    expect(state.history).toHaveLength(1);
    expect(state.history[0].seconds).toBe(0);
    expect(state.settings).toEqual({ pace: "ample", genDeep: false });
    expect(() => markSeen(state, "new")).not.toThrow();
    expect(() => withResult(state, { id: "new", tier: "short", depth: 3, attacker: "black", stones: "H8/H9", sol: "H7" }, true, 1)).not.toThrow();
  });

  it("非法分数回到起始档，而旧版高于上限的合法分数保留", () => {
    // ⚠ -1 现在仍是非法（下限 0）：负分是坏存档，回到起始档
    for (const rating of [null, "1200", -1]) {
      vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ rating }) });
      expect(loadState().rating).toBe(START_RATINGS.lv1);
    }
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ rating: MAX_RATING + 100 }) });
    expect(loadState().rating).toBe(MAX_RATING + 100);
  });

  /**
   * 时限全表（2026-10-12 重定，2026-10-14 再改「13 级后每 2 级加一次 + 三档上限」）：
   *   1–3 级 30/35/40 · 4–5 级 35/45/60 · 6–8 级 40/55/80 · 9–10 级 45/65/100
   *   · 11 级 50/75/120 · 12 级 55/85/140 · 13–14 级 60/95/160
   *   · 之后每 **2** 级加一次：15–16 级 65/105/180 … 25–26 级 90/155/280
   *   · 27–28 级 95/165/**300**（休闲档够到上限，之后不再涨）… 33–34 级 110/195/300
   *   · **35 级（最高级）120/210/300 ＝ 三档上限**：默认按式子只有 115、充裕 205 ⇒ **补到上限**；
   *     休闲按式子会是 380 ⇒ **不超过上限**。用户原话：「这些不够就在最高等级的时候补，多了也不超过」。
   *  加档点写在 `PACE_STEPS`（4/6/9/11/12/13），8 手留在 6 那一档 —— 用户点名区间时
   *  跳过了 8（「6-7级别再加一次，9-10级别再加一次」），这条断言就是把该落实方式钉住。
   */
  it("paceSecondsFor 三档全表：1–13 级沿用旧表，13 级后每 2 级加一次，最高级收在三档上限", () => {
    const TABLE: Array<[number, number, number, number]> = [
      //        默认 充裕 休闲
      [1, 30, 35, 40], [2, 30, 35, 40], [3, 30, 35, 40],
      [4, 35, 45, 60], [5, 35, 45, 60],
      [6, 40, 55, 80], [7, 40, 55, 80], [8, 40, 55, 80],
      [9, 45, 65, 100], [10, 45, 65, 100],
      [11, 50, 75, 120], [12, 55, 85, 140],
      [13, 60, 95, 160], [14, 60, 95, 160],
      [15, 65, 105, 180], [16, 65, 105, 180],
      [17, 70, 115, 200], [18, 70, 115, 200],
      [19, 75, 125, 220], [20, 75, 125, 220],
      [21, 80, 135, 240], [22, 80, 135, 240],
      [23, 85, 145, 260], [24, 85, 145, 260],
      [25, 90, 155, 280], [26, 90, 155, 280],
      [27, 95, 165, 300], [28, 95, 165, 300],
      [29, 100, 175, 300], [30, 100, 175, 300],
      [31, 105, 185, 300], [32, 105, 185, 300],
      [33, 110, 195, 300], [34, 110, 195, 300],
      [CHALLENGE_MAX_DEPTH, 120, 210, 300],
    ];
    for (const [hands, d, a, c] of TABLE) {
      expect([paceSecondsFor(hands, "default"), paceSecondsFor(hands, "ample"), paceSecondsFor(hands, "casual")])
        .toEqual([d, a, c]);
    }
    // 上限就是常数（改常数等于改整张表的天花板）
    expect(PACE_CAP).toEqual({ default: 120, ample: 210, casual: 300 });
    // 「每 2 级加一次」：同一个两手段内相等，跨一个两级点才 +1 档（取还没被上限拦住的低段验）
    for (const m of PACE_MODES) {
      expect(paceSecondsFor(14, m)).toBe(paceSecondsFor(13, m));
      expect(paceSecondsFor(15, m)).toBe(paceSecondsFor(13, m) + PACE_STEP_GAIN[m]);
      expect(paceSecondsFor(19, m)).toBe(paceSecondsFor(13, m) + 3 * PACE_STEP_GAIN[m]);
      expect(paceSecondsFor(25, m)).toBe(paceSecondsFor(13, m) + 6 * PACE_STEP_GAIN[m]);
      // 最高级＝上限：不足补满（默认式子只到 115、充裕 205），超了不越过（休闲式子会到 380）
      expect(paceSecondsFor(CHALLENGE_MAX_DEPTH, m)).toBe(PACE_CAP[m]);
      expect(paceSecondsFor(CHALLENGE_MAX_DEPTH + 9, m)).toBe(PACE_CAP[m]);
    }
    // 最高级那一跳比常规一档大 ⇒ 证明走的是「补到上限」而不是加档（默认 +10、充裕 +15，常规一档是 +5/+10）
    expect(PACE_CAP.default - paceSecondsFor(34, "default")).toBe(10);
    expect(PACE_CAP.ample - paceSecondsFor(34, "ample")).toBe(15);
    expect(PACE_START.casual + 17 * PACE_STEP_GAIN.casual).toBeGreaterThan(PACE_CAP.casual);     // 休闲式子本来会到 380 ⇒ 靠 min() 收在 300
    // 全表单调不减（越深给得越多，绝不给得更少），且三档始终默认 < 充裕 < 休闲
    for (let hands = 1; hands <= CHALLENGE_MAX_DEPTH; hands += 1) {
      const [d, a, c] = [paceSecondsFor(hands, "default"), paceSecondsFor(hands, "ample"), paceSecondsFor(hands, "casual")];
      expect(d < a && a < c).toBe(true);
      for (const m of PACE_MODES) {
        expect(paceSecondsFor(hands + 1, m) >= paceSecondsFor(hands, m)).toBe(true);
        expect(paceSecondsFor(hands, m) <= PACE_CAP[m]).toBe(true);
      }
    }
    // 异常手数夹进 [1, 35]：0 与负数按 1 手、深过头按最高级（＝上限）
    expect(paceSecondsFor(0, "default")).toBe(30);
    expect(paceSecondsFor(-3, "ample")).toBe(35);
    expect(paceSecondsFor(100, "default")).toBe(120);
    expect(paceSecondsFor(100, "casual")).toBe(300);
    // 加档点本身是这六个数（改它等于改整张表，UI 说明也按它写）
    expect(PACE_STEPS).toEqual([4, 6, 9, 11, 12, 13]);
    expect(PACE_POST_STEP_EVERY).toBe(2);
  });

  it("旧档迁移：老存档的固定 timeLimitSec（45/90/120/180）一律映射到 default", () => {
    // 旧乘数（45s ×3 … 180s ×0.5）与新三档（×2/×1/×0.5）对不上，不做精细映射，统一回默认档重新开打
    expect(migrateSettings({ timeLimitSec: 45 } as never)).toEqual({ pace: "default", genDeep: true });
    expect(migrateSettings({ timeLimitSec: 90, genDeep: false } as never)).toEqual({ pace: "default", genDeep: false });
    expect(migrateSettings({ timeLimitSec: 180 } as never).pace).toBe("default");
    // 新档位原样保留；乱值兜回 default
    expect(migrateSettings({ pace: "casual", genDeep: false })).toEqual({ pace: "casual", genDeep: false });
    expect(migrateSettings({ pace: "nope" as never }).pace).toBe("default");
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("等级差加分表（gap = 题目等级 − 解答力等级）：−3→2、−2→4、−1→7、0→10、+1→14、+2→18、+3→22，再往上按 10+4n 一路到 +150 封顶", () => {
    const gainOf = (gap: number, mode: PaceMode) => applyResult(atLevel(6), atLevel(6 + gap), true, PACE_GAIN[mode]).delta;
    expect(applyResult(atLevel(6), atLevel(3), true, 1).delta).toBe(2);      // gap ≤ −3
    expect(applyResult(atLevel(6), atLevel(2), true, 1).delta).toBe(2);      // 更低也一样 +2（不设下限以外的档）
    expect(gainOf(-2, "ample")).toBe(4);
    expect(gainOf(-1, "ample")).toBe(7);
    expect(gainOf(0, "ample")).toBe(10);
    expect(gainOf(1, "ample")).toBe(14);
    expect(gainOf(2, "ample")).toBe(18);
    expect(gainOf(3, "ample")).toBe(22);                                     // 高三级 +22：与旧表最后一档同值
    // 2026-10-14（用户「单次最高不用锁死在 44 了……上限提高到最高加 150 分」）：+3 之后不再顶死，按 10+4n 继续涨
    expect(gainOf(4, "ample")).toBe(26);
    expect(gainOf(10, "ample")).toBe(50);
    expect(gainOf(35, "ample")).toBe(150);                                   // 一路线性到 150
    expect(gainOf(60, "ample")).toBe(150);                                   // 再高也只 +150
    expect(gainOf(60, "default")).toBe(300);                                 // 150 是**基础层**的顶，默认档 ×2 ⇒ 300（用户 10-14 补明）
    expect(GAIN_MAX).toBe(150);
    expect(LOSS_MAX).toBe(100);
  });

  it("等级差扣分表（不乘难度倍数）：+2→−4、+1→−7、0→−10，低 n 级走 10+3n、最多 −100；输棋绝不加分", () => {
    const lossOf = (gap: number) => applyResult(atLevel(6), atLevel(6 + gap), false, 2).delta;
    expect(lossOf(2)).toBe(-4);
    expect(lossOf(3)).toBe(-4);                                              // gap ≥ +2 都是最轻的 −4
    expect(lossOf(1)).toBe(-7);
    expect(lossOf(0)).toBe(-10);
    expect(lossOf(-1)).toBe(-13);
    expect(lossOf(-2)).toBe(-16);
    expect(lossOf(-3)).toBe(-19);                                            // 10+3n：低三级 −19（旧表在这顶死 −18）
    expect(lossOf(-5)).toBe(-25);
    // 顶格要"题目比自己低 30 级以上"，所以这两条直接摆真实等级（34 级 vs 1 手题 = gap −33）
    expect(applyResult(atLevel(20), atLevel(1), false, 2).delta).toBe(-67);   // 低 19 级 → 10+3×19 = 67
    expect(applyResult(atLevel(34), atLevel(1), false, 2).delta).toBe(-100);  // 低 33 级本该 −109，夹在 −100
    // 扣分不乘倍数：输棋换任何难度倍数，扣的都是表上的数
    for (const mode of PACE_MODES) {
      expect(applyResult(atLevel(6), atLevel(5), false, PACE_GAIN[mode]).delta).toBe(-13);
    }
    // 扣分下限为 0：所有输局 delta ≤ 0（输棋绝不反向加分）
    for (let gap = -6; gap <= 6; gap += 1) {
      expect(applyResult(atLevel(8), atLevel(8 + gap), false, 2).delta).toBeLessThanOrEqual(0);
    }
    // 用户 10-12 点名的口径：「在 0 还扣的话，扣分无效」——0 分输最难的题也只停在 0
    for (const gap of [0, -3, -6]) {
      expect(applyResult(LEVEL_BASE, atLevel(LEVEL_LOW_MAX + gap), false, 2)).toEqual({ rating: LEVEL_BASE, delta: 0 });
    }
    // 1 分再输也被夹回 0（下限不是"减到 ≥0 就罢工"，是 0 分之后才无效）
    expect(applyResult(1, atLevel(1), false, 2).rating).toBe(LEVEL_BASE);
  });

  it("难度倍数只乘加分：同等级题默认档 +20 / 充裕 +10 / 休闲 +5；输都是 −10（用户 10-06 的例子）", () => {
    expect(applyResult(atLevel(7), atLevel(7), true, PACE_GAIN.default).delta).toBe(20);
    expect(applyResult(atLevel(7), atLevel(7), true, PACE_GAIN.ample).delta).toBe(10);
    expect(applyResult(atLevel(7), atLevel(7), true, PACE_GAIN.casual).delta).toBe(5);
    expect(applyResult(atLevel(7), atLevel(7), false, PACE_GAIN.default).delta).toBe(-10);
    // withResult 走的是**生产那条路**（用户 10-12 报"同级题也加三十多、四十多"就出在这里）：
    // 玩家 7 级（1800 分）做**7 手题**必须正好 +20。改版后题分曲线与等级分脱钩，
    // 结算若直接把 `problemRating(7)=2200` 丢给 `levelOf` 会读出 8 级 → gap +1 → +28。
    const st = withResult(baseState({ rating: atLevel(7) }),
      { id: "m-1", tier: "short", depth: 7, attacker: "black", stones: "H8/H9", sol: "H8" }, true, 7, 20, PACE_GAIN.default);
    expect(st.rating - atLevel(7)).toBe(20);
  });

  /**
   * **全等级回归（用户 2026-10-12 报的 bug）**：从 1 级到 40 级，每一级玩家做**与自己同手数**的题，
   * 结算都必须是「同级 +10 ×倍数」，做 ±1 / ±2 手的题必须正好落在 +14 / +18 那两格上。
   *
   * 这条以前钉不住：`withResult` 把题分曲线 `problemRating(depth)` 当成等级分喂给 `levelOf`，
   * 而两套尺度在改版后脱钩（题分 1000 起每手 +200；等级分 0 起每级 300/200），实测偏成
   * 1 手题=4 级（新手做 1 手直接顶格 +44）、6 手=7 级（+28）、13 手=12 级（只 +14）、40 手=38 级（+8）。
   * 低段偏高、高段偏低，所以只抽查几级也会漏 —— 必须整条扫。
   */
  it("每一级玩家做同级题都恰好 +10×倍数（1–34 级全扫，含 ±1/±2 手）", () => {
    for (let level = 1; level <= LEVEL_MAX; level += 1) {
      const rating = levelFloor(level);
      const win = (depth: number, mode: PaceMode) => withResult(baseState({ rating }),
        { id: `p-${depth}`, tier: "short", depth, attacker: "black", stones: "H8/H9", sol: "H8" },
        true, depth, 10, PACE_GAIN[mode]).rating - rating;
      const lose = (depth: number) => withResult(baseState({ rating }),
        { id: `l-${depth}`, tier: "short", depth, attacker: "black", stones: "H8/H9", sol: "H8" },
        false, depth, 10, PACE_GAIN.default).rating - rating;
      // 同级：+10 ×倍数（默认 ×2 = 20、充裕 ×1 = 10、休闲 ×0.5 = 5）
      expect([level, win(level, "default"), win(level, "ample"), win(level, "casual")])
        .toEqual([level, 20, 10, 5]);
      // 上下各一级：+14 / +7（默认档 ×2）；上下各两级：+18 / +4
      if (level + 1 <= LEVEL_MAX) expect(win(level + 1, "default")).toBe(28);
      if (level - 1 >= 1) expect(win(level - 1, "default")).toBe(14);
      if (level + 2 <= LEVEL_MAX) expect(win(level + 2, "default")).toBe(36);
      if (level - 2 >= 1) expect(win(level - 2, "default")).toBe(8);
      // 输：同级 −10、高一级 −7、低一级 −13（扣分不乘倍数）
      // ⚠ 1 级玩家入门分就是 0 分，任何扣分都无效（用户 10-12 点名的口径）⇒ 期望停在 0
      expect(lose(level)).toBe(level === 1 ? 0 : -10);
      if (level + 1 <= LEVEL_MAX) expect(lose(level + 1)).toBe(level === 1 ? 0 : -7);
      if (level - 1 >= 1) expect(lose(level - 1)).toBe(-13);
    }
    // 单次收益的上界：式子夹 150、默认档 ×2 ⇒ 任何一级任何手数都不超过 +300（一级宽）⇒ 一次赢不越过一级
    for (let level = 1; level <= LEVEL_MAX; level += 1) {
      for (let depth = 1; depth <= LEVEL_MAX; depth += 1) {
        const delta = withResult(baseState({ rating: levelFloor(level) }),
          { id: "cap", tier: "short", depth, attacker: "black", stones: "H8/H9", sol: "H8" },
          true, depth, 10, PACE_GAIN.default).rating - levelFloor(level);
        expect(delta).toBeLessThanOrEqual(GAIN_MAX * PACE_GAIN.default);
        expect(delta).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("加分式子夹 1–150 再乘倍数：默认档顶格 = 150×2 = 300（用户 2026-10-14 补明倍率仍在后面乘）", () => {
    // 等级 1（0 分）打满级题（34 级）→ gap = +33 → 式子 10+4×33 = 142（还没顶到 150）
    expect(applyResult(LEVEL_BASE, MAX_MATCH_RATING, true, PACE_GAIN.ample).delta).toBe(142);
    expect(applyResult(LEVEL_BASE, MAX_MATCH_RATING, true, PACE_GAIN.default).delta).toBe(284);
    expect(applyResult(LEVEL_BASE, MAX_MATCH_RATING, true, PACE_GAIN.casual).delta).toBe(71);
    // 真正顶格要 gap ≥ 36（10+4n ≥ 150）：式子先夹 150，再乘倍数
    expect(applyResult(LEVEL_BASE, levelFloor(37), true, PACE_GAIN.ample).delta).toBe(150);
    expect(applyResult(LEVEL_BASE, levelFloor(37), true, PACE_GAIN.default).delta).toBe(300);
    expect(applyResult(LEVEL_BASE, levelFloor(99), true, PACE_GAIN.default).delta).toBe(300);
  });

  it("输棋一定扣分、等级分不会低于 0（0 分再输扣分无效）", () => {
    expect(applyResult(1500, levelFloor(2), false).delta).toBeLessThan(0);
    expect(applyResult(1500, levelFloor(20), false).delta).toBeLessThanOrEqual(0);
    // 下限 0（2026-10-12 用户：「在 0 还扣的话，扣分无效」）
    const floored = applyResult(0, levelFloor(2), false, PACE_GAIN.default);
    expect(floored.delta).toBe(0);
    expect(floored.rating).toBe(0);
    expect(applyResult(0, 3400, false).rating).toBe(0);
    // 低位时输一局：扣的（−4～−10）比身上分还多 → 停在 0，不会变负
    expect(applyResult(3, levelFloor(2), false, PACE_GAIN.default).rating).toBe(0);
    expect(applyResult(2, MAX_MATCH_RATING, false, PACE_GAIN.default).rating).toBe(0);
  });

  it("倒计时只在最后 1 秒转红（对任意时限都成立：按剩余毫秒判，与秒数无关）", () => {
    expect(isTimerWarning(1001, "playing")).toBe(false);
    expect(isTimerWarning(1000, "playing")).toBe(true);
    expect(isTimerWarning(1, "playing")).toBe(true);
    expect(isTimerWarning(0, "playing")).toBe(true);
    expect(isTimerWarning(500, "solved")).toBe(false);
    expect(isTimerWarning(500, "setup")).toBe(false);
    expect(TIMER_WARN_MS).toBe(1000);
  });

  it("等级台阶统一：1 级从 0 起、每级 300 分；顶格一次 = 一级宽，不越过一级", () => {
    // 所有等级统一每级 300 分（用户 2026-10-14）
    expect(levelOf(0)).toBe(1);
    expect(levelOf(299)).toBe(1);
    expect(levelOf(300)).toBe(2);
    expect(levelOf(3599)).toBe(12);        // 12 级 = [3300, 3600)
    expect(levelOf(3600)).toBe(13);        // 13 级 = [3600, 3900)
    expect(levelOf(3899)).toBe(13);
    // 14 级以后仍是 300 分
    expect(levelOf(3900)).toBe(14);
    expect(levelOf(4199)).toBe(14);
    expect(levelOf(4200)).toBe(15);
    expect(levelOf(99999)).toBe(LEVEL_MAX);
    // levelFloor：全段 300
    expect(levelFloor(1)).toBe(0);
    expect(levelFloor(3)).toBe(600);
    expect(levelFloor(13)).toBe(3600);
    expect(levelFloor(14)).toBe(3900);
    expect(levelFloor(15)).toBe(4200);
    // levelSpanOf：每级固定 300 分（进度条与说明共用）
    expect(levelSpanOf(3)).toBe(LEVEL_LOW_STEP);
    expect(levelSpanOf(20)).toBe(LEVEL_HIGH_STEP);
    // levelProgress 按固定 300 分宽计算
    expect(levelProgress(600)).toBe(0);
    expect(levelProgress(750)).toBeCloseTo(0.5, 5);        // 3 级内走一半（300 分宽）
    expect(levelProgress(4050)).toBeCloseTo(0.5, 5);       // 14 级内走一半（300 分宽）
    // 满级题对 1 级玩家是 +284，仍 < 一级宽（300）⇒ 不会跳级；
    // 绝对顶格（式子 150 × 默认档 2）正好等于一级宽：可以**跨**一级，不会**越过**一级
    const maxGain = applyResult(0, MAX_MATCH_RATING, true, PACE_GAIN.default).delta;
    expect(maxGain).toBe(284);
    expect(maxGain).toBeLessThan(LEVEL_STEP);
    expect(GAIN_MAX * PACE_GAIN.default).toBe(LEVEL_STEP);
  });

  it("五个起始档 = 等级 1/3/6/9/12（用户 10-12 定稿），档位分数与等级一一对上", () => {
    expect(START_LEVELS).toEqual(["lv1", "lv3", "lv6", "lv9", "lv12"]);
    // 档位分数直接由 levelFloor 推（改台阶不会被漏改）
    expect(START_RATINGS).toEqual({ lv1: 0, lv3: 600, lv6: 1500, lv9: 2400, lv12: 3300 });
    expect(START_LEVEL_LV).toEqual({ lv1: 1, lv3: 3, lv6: 6, lv9: 9, lv12: 12 });
    // 每个档位的分数落在它自己那一级的门槛上（levelOf(START_RATINGS[lv]) === 档位等级）
    for (const lv of START_LEVELS) {
      expect(levelOf(START_RATINGS[lv])).toBe(START_LEVEL_LV[lv]);
      expect(levelFloor(START_LEVEL_LV[lv])).toBe(START_RATINGS[lv]);
      expect(START_RATINGS[lv]).toBeLessThanOrEqual(MAX_RATING);
      expect(startLevelLabel(lv)).toContain(`等级 ${START_LEVEL_LV[lv]}`);
      expect(startLevelLabel(lv)).toContain(String(START_RATINGS[lv]));
    }
    // 越深的档位分数越高
    const depths = START_LEVELS.map((lv) => START_RATINGS[lv]);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
    // 手数区间 = 三级匹配的覆盖（本级 ±1 手；1 级下限夹到 1 手）
    expect(startLevelHandRange("lv1")).toBe("1–2 手");
    expect(startLevelHandRange("lv3")).toBe("2–4 手");
    expect(startLevelHandRange("lv12")).toBe("11–13 手");
    // 两条天花板（实测值）：13 手是静态题池上限；生成器仍可到 40 手，挑战匹配上限为 35 手。
    // ⚠ 2026-10-12 起它们换算到**等级分**那把尺上（`levelFloor(手数)`），不再是题分曲线的 3400/8800
    expect(STATIC_CEILING_RATING).toBe(levelFloor(STATIC_MAX_DEPTH));
    expect(MAX_MATCH_RATING).toBe(levelFloor(LEVEL_MAX));
    expect(STATIC_CEILING_RATING).toBe(3600);
    expect(MAX_MATCH_RATING).toBe(9900);
    expect(GEN_MAX_DEPTH).toBe(40);
    expect(MAX_RATING).toBe(9999);
  });

  it("等级分封顶 9999：满分附近（最高 34 级）分数还能加但难度不再升，到顶后赢不再加分、封顶不往下拽", () => {
    // 同水平（分 = 题分同等级）：默认档赢 +20、输 −10；充裕/休闲档赢 +10/+5
    expect(applyResult(levelFloor(13), levelFloor(13), true, PACE_GAIN.default).delta).toBe(20);
    expect(applyResult(levelFloor(13), levelFloor(13), false, PACE_GAIN.default).delta).toBe(-10);
    // 高段也一样（等级 30）
    expect(applyResult(levelFloor(30), levelFloor(30), true, PACE_GAIN.default).delta).toBe(20);
    // 封顶之上：等级差按 eff = min(rating, MAX_MATCH_RATING) 算 → 分数可以继续爬
    // （34 级题在等级分尺上是 9900 分，所以 9990/9999 分的人做它算"同级"，赢 +20、输 −10）
    expect(applyResult(8900, MAX_MATCH_RATING, true, PACE_GAIN.default).delta).toBeGreaterThan(0);
    expect(applyResult(9990, MAX_MATCH_RATING, true, PACE_GAIN.default).rating).toBe(MAX_RATING);
    // 到顶（9999）：赢不再加分，输照常扣
    expect(applyResult(MAX_RATING, MAX_MATCH_RATING, true, PACE_GAIN.default).rating).toBe(MAX_RATING);
    expect(applyResult(MAX_RATING - 5, MAX_MATCH_RATING, true, PACE_GAIN.default).rating).toBe(MAX_RATING);
    expect(applyResult(MAX_RATING, MAX_MATCH_RATING, false, PACE_GAIN.default).rating).toBe(MAX_RATING - 10);
    // 上限不会因为封顶把人往下拽：老存档停在 4500 分时赢一局只会涨
    expect(applyResult(4500, STATIC_CEILING_RATING, true, PACE_GAIN.default).rating).toBeGreaterThan(4500);
    // 阶梯最高级就是能到的最高分对应的级别（统一 300 分后是 34）
    expect(LEVEL_MAX).toBe(levelOf(MAX_RATING));
    expect(LEVEL_MAX).toBe(34);
    expect(levelOf(99999)).toBe(LEVEL_MAX);
  });

  it("35 手相邻题保留为高 1 级参与结算，而不是被玩家满级夹成同级", () => {
    const level34 = levelFloor(34);
    const level35Question = levelFloor(CHALLENGE_MAX_DEPTH);
    expect(levelGapLabel(CHALLENGE_MAX_DEPTH, level34)).toBe("高 1 级");
    expect(applyResult(level34, level35Question, true, PACE_GAIN.default).delta).toBe(28);
    expect(applyResult(level34, level35Question, false, PACE_GAIN.default).delta).toBe(-7);
  });

  it("做题记录最多 200 条、记耗时，并把出过的题记进已出集合", () => {
    let state = baseState();
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
      state = withResult(state, { id: "m-" + i, tier: "short", depth: 5, attacker: "black", stones: "H8/H9", sol: "H8" }, true, 3, 12);
    }
    expect(state.history.length).toBe(HISTORY_LIMIT);
    expect(state.history[0].seconds).toBe(12);
    expect(state.history[0].depth).toBe(5);
    expect(state.seenIds.length).toBe(HISTORY_LIMIT + 25);
  });

  it("markSeen 幂等：同一道题只记一次", () => {
    const once = markSeen(baseState(), "m-7");
    const twice = markSeen(once, "m-7");
    expect(once.seenIds).toEqual(["m-7"]);
    expect(twice.seenIds).toEqual(["m-7"]);
  });

  it("重置起始档：可只改分数，也可连进度一起清空（设置保留）", () => {
    const dirty = baseState({
      rating: 1800, solvedIds: ["m-1"], seenIds: ["m-1"], solved: 9, failed: 2, streak: 3, bestStreak: 5,
      daily: { "2026-10-04": { solved: 9, failed: 2 } },
      history: [{ ts: 1, tier: "short", depth: 5, win: true, moves: 3, delta: 7, seconds: 10 }],
      settings: { pace: "ample", genDeep: false },
    });
    const keep = resetToStartLevel(dirty, "lv12", false);
    expect(keep.rating).toBe(START_RATINGS.lv12);
    expect(keep.solved).toBe(9);
    const cleared = resetToStartLevel(dirty, "lv1", true);
    expect(cleared.rating).toBe(START_RATINGS.lv1);
    expect(cleared.solved).toBe(0);
    expect(cleared.seenIds.length).toBe(0);
    expect(cleared.history.length).toBe(0);
    expect(cleared.settings.pace).toBe("ample");
  });
});
