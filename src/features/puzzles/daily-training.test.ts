import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideDailyPuzzle, emptyDailyTraining, loadDailyTraining, localDateKey, markDailyStarted, recordPuzzleCompletion,
  saveDailyTraining, DAILY_TRAINING_KEY,
  type DailyCandidate, type DailyTrainingState,
} from "./daily-training";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const candidate = (puzzleId: string, extra: Partial<DailyCandidate> = {}): DailyCandidate => ({
  collectionId: "col", puzzleId, solved: false, attempts: 0, updatedAt: "", ...extra,
});

const stateWith = (input: Partial<DailyTrainingState>): DailyTrainingState => ({ ...emptyDailyTraining(), ...input });

describe("daily puzzle date keys and storage", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("uses local calendar dates", () => {
    expect(localDateKey(new Date(2026, 8, 19, 23, 30))).toBe("2026-09-19");
  });

  it("round-trips and tolerates malformed storage", () => {
    const state = stateWith({ days: { "2026-09-19": { key: "col/p1", collectionId: "col", puzzleId: "p1", solved: true } } });
    saveDailyTraining(state);
    expect(loadDailyTraining().days["2026-09-19"]?.puzzleId).toBe("p1");
    localStorage.setItem(DAILY_TRAINING_KEY, "{not json");
    expect(loadDailyTraining()).toEqual(emptyDailyTraining());
    localStorage.setItem(DAILY_TRAINING_KEY, JSON.stringify({ version: 1, days: { bad: { collectionId: 1 } } }));
    expect(loadDailyTraining()).toEqual(emptyDailyTraining());
  });

  it("忽略旧存档里的错题排期（reviews）与打卡字段，不报错也不迁移", () => {
    localStorage.setItem(DAILY_TRAINING_KEY, JSON.stringify({
      version: 1,
      days: { "2026-09-19": { key: "col/p1", collectionId: "col", puzzleId: "p1", solved: true } },
      // 09-19 之前的形状：错题排期 + 打卡
      reviews: { "col/p1": { due: "2026-09-20", stage: 3, lastResult: "pass" } },
      streak: 7,
    }));
    const loaded = loadDailyTraining();
    expect(loaded.days["2026-09-19"]?.solved).toBe(true);
    expect(loaded).not.toHaveProperty("reviews");
    expect(loaded).not.toHaveProperty("streak");
  });
});

describe("decideDailyPuzzle", () => {
  it("prefers the stalest wrong answer, then a deterministic fresh pick", () => {
    const wrong = decideDailyPuzzle(emptyDailyTraining(), [candidate("p1", { attempts: 3, updatedAt: "2026-09-01T00:00:00Z" }), candidate("p2")], "2026-09-19");
    expect(wrong?.pick.puzzleId).toBe("p1");
    expect(wrong?.reason).toBe("wrong");

    const pool = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
    const first = decideDailyPuzzle(emptyDailyTraining(), pool, "2026-09-19");
    const again = decideDailyPuzzle(emptyDailyTraining(), pool, "2026-09-19");
    expect(first?.reason).toBe("fresh");
    expect(again?.pick.key).toBe(first?.pick.key);
    expect(["a", "b", "c", "d"]).toContain(first?.pick.puzzleId);
  });

  it("keeps the pick already fixed for today and returns null when nothing is left", () => {
    const state = stateWith({ days: { "2026-09-19": { key: "col/p9", collectionId: "col", puzzleId: "p9", solved: false } } });
    const carried = decideDailyPuzzle(state, [candidate("p1"), candidate("p9")], "2026-09-19");
    expect(carried?.carriedOver).toBe(true);
    expect(carried?.pick.puzzleId).toBe("p9");
    expect(decideDailyPuzzle(emptyDailyTraining(), [candidate("p1", { solved: true })], "2026-09-19")).toBeNull();
    expect(markDailyStarted(state, { key: "col/p1", collectionId: "col", puzzleId: "p1" }, "2026-09-19").days["2026-09-19"].puzzleId).toBe("p9");
  });
});

describe("recordPuzzleCompletion", () => {
  const started = () => markDailyStarted(emptyDailyTraining(), { key: "col/p1", collectionId: "col", puzzleId: "p1" }, "2026-09-19");

  it("只把「今天这道题解出来了」记下来（对弈页据此显示已完成）", () => {
    expect(recordPuzzleCompletion(started(), { collectionId: "col", puzzleId: "p1", solved: true, today: "2026-09-19" }).days["2026-09-19"].solved).toBe(true);
    expect(recordPuzzleCompletion(started(), { collectionId: "col", puzzleId: "p1", solved: false, today: "2026-09-19" }).days["2026-09-19"].solved).toBe(false);
  });

  it("不再产生任何错题排期数据（09-19 去掉 SRS）", () => {
    const state = recordPuzzleCompletion(started(), { collectionId: "col", puzzleId: "p1", solved: true, today: "2026-09-19" });
    expect(state).not.toHaveProperty("reviews");
    expect(Object.keys(state)).toEqual(["version", "days"]);
  });

  it("不是今天的题、或当天已记过，都不改动状态", () => {
    expect(recordPuzzleCompletion(started(), { collectionId: "col", puzzleId: "other", solved: true, today: "2026-09-19" }).days["2026-09-19"].solved).toBe(false);
    const done = recordPuzzleCompletion(started(), { collectionId: "col", puzzleId: "p1", solved: true, today: "2026-09-19" });
    expect(recordPuzzleCompletion(done, { collectionId: "col", puzzleId: "p1", solved: true, today: "2026-09-19" })).toBe(done);
  });
});
