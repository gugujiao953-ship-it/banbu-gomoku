import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **来源读取层**的守卫（2026-10-11）。
 *
 * ## 这一层为什么必须有测试
 *
 * `achievement-sources.ts` 把"各个账本"读成一份 `AchievementSources`。
 * 它此前**一条测试都没有** —— 于是里面藏了一个**死源**活了很久：
 *
 * ```
 * dailyDone: signals.dailyDoneCount || 0
 * ```
 *
 * `dailyDoneCount` 这个计数**全仓只有这一处读、零处写**。后果是那三条成就
 * （今日一题 / 七日七题 / 天天练）**永远不可能解锁** —— 用户一天做一道、
 * 连做三十天也不弹。而判定引擎本身完全正常（喂它 `dailyDone: 30` 它就解锁），
 * 所以只测引擎的那些用例**照不出这个错**：坏的是"读数的那一端"。
 *
 * 教训与那条 `daily` 棋魂来源一样（表里有、代码没接线）：**"读的地方"和"写的地方"
 * 必须一起验**，只验其中一半时，另一半坏掉是完全静默的。
 */

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
vi.stubGlobal("localStorage", new MemoryStorage());

const { collectAchievementSources } = await import("./achievement-sources");
const { DAILY_TRAINING_KEY } = await import("../puzzles/daily-training");
const { evaluateAchievements } = await import("./achievements");

/** 造一份每日一题存档：`days` 是「本地日期 → 那天做出来了没有」。 */
const seedDaily = (days: Record<string, boolean>) => {
  localStorage.setItem(DAILY_TRAINING_KEY, JSON.stringify({
    version: 1,
    days: Object.fromEntries(Object.entries(days).map(([date, solved]) => [date, {
      key: `col/p-${date}`, collectionId: "col", puzzleId: `p-${date}`, solved,
    }])),
  }));
};

describe("来源读取：每日一题完成次数", () => {
  beforeEach(() => localStorage.clear());

  it("**从每日一题存档里数**（不是从一个没人写的计数里读）", () => {
    seedDaily({ "2026-10-01": true, "2026-10-02": true, "2026-10-03": true });
    const sources = collectAchievementSources();
    expect(sources.puzzle?.dailyDone).toBe(3);
  });

  it("**做了但没做出来的那天不算**（与棋魂发放、写入条件同一口径）", () => {
    seedDaily({ "2026-10-01": true, "2026-10-02": false, "2026-10-03": true });
    expect(collectAchievementSources().puzzle?.dailyDone).toBe(2);
  });

  it("没有存档 ⇒ 0（不抛错、不连累其它来源）", () => {
    const sources = collectAchievementSources();
    expect(sources.puzzle?.dailyDone).toBe(0);
    // 同一次读取里别的来源照常返回（容错口径）
    expect(sources.puzzle?.solved).toBe(0);
    expect(sources.duel?.games).toBe(0);
  });

  it("存档坏掉时也只是 0，不影响别的来源", () => {
    localStorage.setItem(DAILY_TRAINING_KEY, "{ 这不是 JSON");
    expect(collectAchievementSources().puzzle?.dailyDone).toBe(0);
  });

  it("**端到端**：做满 30 天 ⇒ 那三条成就真的会解锁（修之前永远不解）", () => {
    // 这一条是真正的回归锁：它同时穿过"读来源"与"判定"两半。
    const days: Record<string, boolean> = {};
    for (let index = 1; index <= 30; index += 1) days[`2026-09-${String(index).padStart(2, "0")}`] = true;
    seedDaily(days);
    const sources = collectAchievementSources();
    expect(sources.puzzle?.dailyDone).toBe(30);
    const met = new Set(evaluateAchievements(sources).filter((item) => item.met).map((item) => item.id));
    expect(met.has("puzzle-daily-done")).toBe(true);
    expect(met.has("puzzle-daily-7")).toBe(true);
    expect(met.has("puzzle-daily-30")).toBe(true);
  });

  it("做满 6 天 ⇒ 只有第一档解锁（边界）", () => {
    const days: Record<string, boolean> = {};
    for (let index = 1; index <= 6; index += 1) days[`2026-09-${String(index).padStart(2, "0")}`] = true;
    seedDaily(days);
    const met = new Set(evaluateAchievements(collectAchievementSources()).filter((item) => item.met).map((item) => item.id));
    expect(met.has("puzzle-daily-done")).toBe(true);
    expect(met.has("puzzle-daily-7")).toBe(false);
  });
});

describe("来源读取：容错（坏账本不连累别的来源）", () => {
  beforeEach(() => localStorage.clear());

  it("棋魂/成就信号坏掉时，做题来源照常可读", () => {
    localStorage.setItem("banbu-achievement-signals-v1", "{坏}");
    localStorage.setItem("banbu-achievements-v1", "{坏}");
    seedDaily({ "2026-10-01": true });
    const sources = collectAchievementSources();
    expect(sources.puzzle?.dailyDone).toBe(1);
  });

  it("传入的 overrides 覆盖读到的值（结算点用它避开「写盘→读盘」的时序差）", () => {
    seedDaily({ "2026-10-01": true });
    const sources = collectAchievementSources({ puzzle: { solved: 42, attempts: 42, clearedCollection: false, wrongCount: 0, clearedWrong: false, dailyDone: 42 } });
    expect(sources.puzzle?.solved).toBe(42);
    expect(sources.puzzle?.dailyDone).toBe(42);
  });
});
