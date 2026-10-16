import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPuzzlesToCollection,
  dequeuePuzzleReview,
  derivePuzzleStats,
  emptyPuzzleReviewQueue,
  enqueuePuzzleReview,
  isPuzzleQueued,
  loadHiddenPuzzleCollections,
  loadPuzzleOverlays,
  loadPuzzleReviewQueue,
  mergeCollections,
  movePuzzleBetweenCollections,
  nextPuzzleId,
  prunePuzzleRecords,
  PUZZLE_HIDDEN_COLLECTIONS_KEY,
  PUZZLE_OVERLAYS_KEY,
  PUZZLE_REVIEW_KEY,
  puzzlePositionKey,
  removePuzzleFromCollection,
  resetPuzzleProgressState,
  saveHiddenPuzzleCollections,
  savePuzzleOverlays,
  splitCollection,
  summarizeCollection,
  updatePuzzleInCollection,
  updatePuzzleOverlay,
} from "./puzzle-collection-edit";
import type { Puzzle, PuzzleCollection, PuzzleProgress } from "../../puzzles";

const stone = (row: number, col: number, player: "black" | "white") => ({ row, col, player });

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const makePuzzle = (id: string, overrides: Partial<Puzzle> = {}): Puzzle => ({
  id,
  title: `题 ${id}`,
  prompt: "黑先，击败陪练",
  difficulty: 3,
  stones: [stone(7, 7, "black"), stone(7, 8, "white")],
  player: "black",
  boardSize: 15,
  ...overrides,
});

const makeCollection = (id: string, puzzles: Puzzle[], overrides: Partial<PuzzleCollection> = {}): PuzzleCollection => ({
  id,
  title: `题集 ${id}`,
  source: "用户导入",
  license: "由用户确认使用权",
  puzzles,
  ...overrides,
});

beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("覆盖层存档", () => {
  it("只保留认识的字段，坏数据不会污染类型", () => {
    localStorage.setItem(PUZZLE_OVERLAYS_KEY, JSON.stringify({
      "c1/p1": { mastered: true, attemptCount: 3, lastResult: "won", extra: "x", nested: { a: 1 } },
      "c1/p2": { lastResult: "bogus", attemptCount: -5 },
      "c1/p3": "not an object",
      "c1/p4": {},
    }));
    const overlays = loadPuzzleOverlays();
    expect(overlays["c1/p1"]).toEqual({ mastered: true, attemptCount: 3, lastResult: "won" });
    // 认不出的取值全部丢弃；丢空的条目不留空对象。
    expect(overlays["c1/p2"]).toBeUndefined();
    expect(overlays["c1/p3"]).toBeUndefined();
    expect(overlays["c1/p4"]).toBeUndefined();
  });

  it("坏 JSON 回落到空对象而不是抛错", () => {
    localStorage.setItem(PUZZLE_OVERLAYS_KEY, "{不是 JSON");
    expect(loadPuzzleOverlays()).toEqual({});
  });

  it("mastered 三态：不传保持原样、true 置标记、false 显式清除", () => {
    let overlays = updatePuzzleOverlay({}, "c1", "p1", { mastered: true });
    expect(overlays["c1/p1"]?.mastered).toBe(true);
    // 不传 mastered 的补丁不该顺手抹掉标记（合并写 lastResult 时的常见场景）。
    overlays = updatePuzzleOverlay(overlays, "c1", "p1", { lastResult: "lost" });
    expect(overlays["c1/p1"]).toEqual({ mastered: true, lastResult: "lost" });
    // 显式 false = 撤销「已掌握」（用户又去做了一遍题）。
    overlays = updatePuzzleOverlay(overlays, "c1", "p1", { mastered: false });
    expect(overlays["c1/p1"]).toEqual({ lastResult: "lost" });
    overlays = updatePuzzleOverlay(overlays, "c1", "p1", { mastered: true });
    expect(overlays["c1/p1"]?.mastered).toBe(true);
    // 传 null 清除整条；清除后不留空对象。
    overlays = updatePuzzleOverlay(overlays, "c1", "p1", null);
    expect(overlays["c1/p1"]).toBeUndefined();
  });

  it("往返保存后能原样读回", () => {
    const overlays = updatePuzzleOverlay({}, "c1", "p1", { attemptCount: 2, lastDurationMs: 12345 });
    savePuzzleOverlays(overlays);
    expect(loadPuzzleOverlays()).toEqual(overlays);
  });
});

describe("隐藏题集", () => {
  it("只接受非空字符串，坏值丢弃", () => {
    localStorage.setItem(PUZZLE_HIDDEN_COLLECTIONS_KEY, JSON.stringify(["native-kaibao-1", "", 42, null, "c2"]));
    expect(loadHiddenPuzzleCollections()).toEqual(["native-kaibao-1", "c2"]);
  });

  it("往返保存后能原样读回", () => {
    saveHiddenPuzzleCollections(["a", "b"]);
    expect(loadHiddenPuzzleCollections()).toEqual(["a", "b"]);
  });
});

describe("重做队列", () => {
  it("入队去重并更新时间，出队移除", () => {
    let queue = emptyPuzzleReviewQueue();
    queue = enqueuePuzzleReview(queue, "c1", "p1", "2026-09-21T00:00:00.000Z");
    queue = enqueuePuzzleReview(queue, "c1", "p2", "2026-09-21T00:00:01.000Z");
    queue = enqueuePuzzleReview(queue, "c1", "p1", "2026-09-21T00:00:02.000Z");
    expect(queue.items).toHaveLength(2);
    expect(queue.items[queue.items.length - 1]).toEqual({ key: "c1/p1", queuedAt: "2026-09-21T00:00:02.000Z" });
    expect(isPuzzleQueued(queue, "c1", "p1")).toBe(true);
    queue = dequeuePuzzleReview(queue, "c1", "p1");
    expect(isPuzzleQueued(queue, "c1", "p1")).toBe(false);
    expect(queue.items).toHaveLength(1);
  });

  it("读档时丢掉坏条目与重复键", () => {
    localStorage.setItem(PUZZLE_REVIEW_KEY, JSON.stringify({
      items: [{ key: "c1/p1", queuedAt: "t" }, { key: "c1/p1", queuedAt: "t2" }, { key: "" }, { key: 5 }, "x"],
    }));
    const queue = loadPuzzleReviewQueue();
    expect(queue.items).toEqual([{ key: "c1/p1", queuedAt: "t" }]);
  });
});

describe("每题的统计与掌握状态", () => {
  const progress: PuzzleProgress = {
    "c1/p1": { solved: true, attempts: 2, updatedAt: "2026-09-20T00:00:00.000Z" },
    "c1/p2": { solved: false, attempts: 3, updatedAt: "2026-09-20T00:00:00.000Z" },
  };

  it("四态：solved / mastered / wrong / untried", () => {
    const overlays = { "c1/p3": { mastered: true as const }, "c1/p9": { mastered: true as const } };
    expect(derivePuzzleStats("c1", "p1", progress, overlays).mastery).toBe("solved");
    // 有完局但没解出 = wrong；同一个错题标上「已掌握」后升级为 mastered。
    expect(derivePuzzleStats("c1", "p2", progress, {}).mastery).toBe("wrong");
    expect(derivePuzzleStats("c1", "p2", progress, { "c1/p2": { mastered: true } }).mastery).toBe("mastered");
    // 没做过任何题、只标了已掌握，也算 mastered（用户主动说不用再练）。
    expect(derivePuzzleStats("c1", "p9", progress, overlays).mastery).toBe("mastered");
    expect(derivePuzzleStats("c1", "p3", progress, overlays).mastery).toBe("mastered");
    expect(derivePuzzleStats("c1", "p4", progress, {})).toMatchObject({ mastery: "untried", solved: false, completions: 0, attempts: 0 });
  });

  it("solved 优先于 mastered：真做出来了就是 solved，标不标已掌握都一样", () => {
    expect(derivePuzzleStats("c1", "p1", progress, { "c1/p1": { mastered: true } }).mastery).toBe("solved");
  });

  it("已掌握但未解出的题 mastery 为 mastered，且不影响 solved", () => {
    const stats = derivePuzzleStats("c1", "p5", progress, { "c1/p5": { mastered: true } });
    expect(stats).toMatchObject({ mastery: "mastered", solved: false, completions: 0 });
  });

  it("attempts 取「真实尝试次数」与「完局次数」中较大者，兼容没写过覆盖层的旧存档", () => {
    expect(derivePuzzleStats("c1", "p2", progress, {}).attempts).toBe(3);
    expect(derivePuzzleStats("c1", "p2", progress, { "c1/p2": { attemptCount: 7 } }).attempts).toBe(7);
    // 中途放弃（只有覆盖层计数、没有完局）也要算进去。
    expect(derivePuzzleStats("c1", "p9", progress, { "c1/p9": { attemptCount: 1 } }).attempts).toBe(1);
  });

  it("最近结果与用时透出", () => {
    const stats = derivePuzzleStats("c1", "p1", progress, { "c1/p1": { lastResult: "won", lastDurationMs: 41234, lastPlayedAt: "2026-09-21T01:00:00.000Z" } });
    expect(stats).toMatchObject({ lastResult: "won", lastDurationMs: 41234, lastPlayedAt: "2026-09-21T01:00:00.000Z" });
  });
});

describe("题集汇总", () => {
  it("正确率分母只算做过的题，平均用时只算有记录的题", () => {
    const collection = makeCollection("c1", [makePuzzle("p1"), makePuzzle("p2"), makePuzzle("p3"), makePuzzle("p4")]);
    const progress: PuzzleProgress = {
      "c1/p1": { solved: true, attempts: 1, updatedAt: "t" },
      "c1/p2": { solved: false, attempts: 2, updatedAt: "t" },
    };
    const overlays = { "c1/p1": { lastDurationMs: 10000 }, "c1/p2": { lastDurationMs: 20000 } };
    expect(summarizeCollection(collection, progress, overlays)).toEqual({
      total: 4, solved: 1, attempted: 2, averageDurationMs: 15000,
    });
  });

  it("没有完局记录时平均用时为 0（界面据此不显示，避免 0 噪声）", () => {
    const collection = makeCollection("c1", [makePuzzle("p1")]);
    expect(summarizeCollection(collection, {}, {})).toEqual({ total: 1, solved: 0, attempted: 0, averageDurationMs: 0 });
  });
});

describe("题集内单题编辑", () => {
  const collection = makeCollection("c1", [makePuzzle("p1"), makePuzzle("p2")]);

  it("nextPuzzleId 单调递增，删除后不复用已删题的 id", () => {
    expect(nextPuzzleId(collection)).toBe("custom-1");
    const withCustom = addPuzzlesToCollection(collection, [makePuzzle("custom-3")]);
    expect(nextPuzzleId(withCustom)).toBe("custom-4");
    // 删掉 custom-3 后不能回到 custom-3（否则新题会继承被删题的进度）。
    const afterRemove = removePuzzleFromCollection(withCustom, "p2");
    expect(nextPuzzleId(afterRemove)).toBe("custom-4");
  });

  it("删除与新增都不改动原对象（不可变）", () => {
    const removed = removePuzzleFromCollection(collection, "p1");
    expect(removed.puzzles.map((puzzle) => puzzle.id)).toEqual(["p2"]);
    expect(collection.puzzles).toHaveLength(2);
    const added = addPuzzlesToCollection(collection, [makePuzzle("p3")]);
    expect(added.puzzles).toHaveLength(3);
    expect(collection.puzzles).toHaveLength(2);
  });

  it("改题只动目标题，未涉及的字段保持原样", () => {
    const updated = updatePuzzleInCollection(collection, "p2", { title: "新标题", difficulty: 5, prompt: "白先" });
    expect(updated.puzzles[1]).toMatchObject({ id: "p2", title: "新标题", difficulty: 5, prompt: "白先" });
    expect(updated.puzzles[1].stones).toEqual(collection.puzzles[1].stones);
    expect(updated.puzzles[0]).toEqual(collection.puzzles[0]);
  });

  it("跨题集移动时题 id 不变（进度自动跟随）", () => {
    const target = makeCollection("c2", []);
    const { from, to } = movePuzzleBetweenCollections(collection, target, "p1");
    expect(from.puzzles.map((puzzle) => puzzle.id)).toEqual(["p2"]);
    expect(to.puzzles.map((puzzle) => puzzle.id)).toEqual(["p1"]);
  });

  it("移不存在的题时原样返回", () => {
    const target = makeCollection("c2", []);
    const result = movePuzzleBetweenCollections(collection, target, "nope");
    expect(result.from).toBe(collection);
    expect(result.to).toBe(target);
  });
});

describe("合并", () => {
  const a = makeCollection("a", [makePuzzle("p1"), makePuzzle("p2")]);
  const b = makeCollection("b", [makePuzzle("p3")]);
  const result = { id: "merged-1", title: "合并题集", source: "用户导入", license: "由用户确认使用权" };

  it("按传入顺序拼接，题 id 原样保留", () => {
    const merged = mergeCollections({ collections: [a, b], ids: ["a", "b"], result, dedupe: true });
    expect(merged.merged.puzzles.map((puzzle) => puzzle.id)).toEqual(["p1", "p2", "p3"]);
    expect(merged.collections.map((collection) => collection.id)).toEqual(["merged-1"]);
    expect(merged.removed.map((collection) => collection.id)).toEqual(["a", "b"]);
    expect(merged.duplicateCount).toBe(0);
  });

  it("去重时按「标题 + 局面」判等，保留排序在前的那一份", () => {
    const duplicate = makeCollection("b", [makePuzzle("p1", { title: "题 p1" })]);
    const merged = mergeCollections({ collections: [a, duplicate], ids: ["a", "b"], result, dedupe: true });
    expect(merged.merged.puzzles.map((puzzle) => puzzle.id)).toEqual(["p1", "p2"]);
    expect(merged.duplicateCount).toBe(1);
  });

  it("标题相同但局面不同不算重复（同名变型不能强删）", () => {
    const variant = makeCollection("b", [makePuzzle("p9", { title: "题 p1", stones: [stone(0, 0, "black")] })]);
    const merged = mergeCollections({ collections: [a, variant], ids: ["a", "b"], result, dedupe: true });
    expect(merged.merged.puzzles).toHaveLength(3);
    expect(merged.duplicateCount).toBe(0);
  });

  it("取消去重后原样保留重复题", () => {
    const duplicate = makeCollection("b", [makePuzzle("p1", { title: "题 p1" })]);
    const merged = mergeCollections({ collections: [a, duplicate], ids: ["a", "b"], result, dedupe: false });
    expect(merged.merged.puzzles).toHaveLength(3);
    expect(merged.duplicateCount).toBe(0);
  });

  it("规则只在所有来源一致时继承", () => {
    const withRule = makeCollection("a", [makePuzzle("p1")], { rule: "renju" });
    const sameRule = makeCollection("b", [makePuzzle("p2")], { rule: "renju" });
    const otherRule = makeCollection("c", [makePuzzle("p3")], { rule: "freestyle" });
    expect(mergeCollections({ collections: [withRule, sameRule], ids: ["a", "b"], result, dedupe: true }).merged.rule).toBe("renju");
    expect(mergeCollections({ collections: [withRule, otherRule], ids: ["a", "c"], result, dedupe: true }).merged.rule).toBeUndefined();
  });

  it("忽略不存在的 id，且不动其他题集", () => {
    const merged = mergeCollections({ collections: [a, b], ids: ["a", "zzz"], result, dedupe: true });
    expect(merged.merged.puzzles.map((puzzle) => puzzle.id)).toEqual(["p1", "p2"]);
    expect(merged.collections.map((collection) => collection.id)).toEqual(["b", "merged-1"]);
  });

  it("局面指纹与坐标顺序无关", () => {
    const forward = makePuzzle("x", { stones: [stone(1, 2, "black"), stone(3, 4, "white")] });
    const reversed = makePuzzle("y", { stones: [stone(3, 4, "white"), stone(1, 2, "black")] });
    expect(puzzlePositionKey(forward)).toBe(puzzlePositionKey(reversed));
  });
});

describe("拆分", () => {
  const collection = makeCollection("c1", ["p1", "p2", "p3", "p4", "p5"].map((id) => makePuzzle(id)));
  const result = { id: "split-1", title: "拆出的题集", source: "用户导入", license: "由用户确认使用权" };

  it("按 1 起的题号区间抽出新题集，原题集保留其余题目且 id 不变", () => {
    const split = splitCollection({ collections: [collection], collectionId: "c1", from: 2, to: 4, result });
    expect(split.created?.puzzles.map((puzzle) => puzzle.id)).toEqual(["p2", "p3", "p4"]);
    expect(split.collections[0].puzzles.map((puzzle) => puzzle.id)).toEqual(["p1", "p5"]);
    expect(split.collections[1].id).toBe("split-1");
  });

  it("起止写反时自动归一（谁大谁小都认）", () => {
    const split = splitCollection({ collections: [collection], collectionId: "c1", from: 4, to: 2, result });
    expect(split.created?.puzzles.map((puzzle) => puzzle.id)).toEqual(["p2", "p3", "p4"]);
  });

  it("越界自动夹到有效范围", () => {
    const split = splitCollection({ collections: [collection], collectionId: "c1", from: -3, to: 99, result });
    expect(split.created?.puzzles).toHaveLength(5);
    expect(split.collections[0].puzzles).toHaveLength(0);
  });

  it("区间内没有题时返回 created = null（调用方不落盘）", () => {
    const empty = makeCollection("c9", []);
    const split = splitCollection({ collections: [empty], collectionId: "c9", from: 1, to: 3, result });
    expect(split.created).toBeNull();
    expect(split.collections).toHaveLength(1);
  });

  it("题集不存在时原样返回", () => {
    const split = splitCollection({ collections: [collection], collectionId: "nope", from: 1, to: 2, result });
    expect(split.created).toBeNull();
    expect(split.collections).toBe(split.collections);
    expect(split.collections[0]).toBe(collection);
  });

  it("原题集的题集级规则被新题集继承", () => {
    const withRule = makeCollection("c1", [makePuzzle("p1"), makePuzzle("p2")], { rule: "renju" });
    const split = splitCollection({ collections: [withRule], collectionId: "c1", from: 1, to: 1, result });
    expect(split.created?.rule).toBe("renju");
  });
});

describe("删除题的存档清理与进度重置", () => {
  it("删题时同步清掉 progress、overlay 与重做队列里的该题", () => {
    const progress: PuzzleProgress = { "c1/p1": { solved: false, attempts: 1, updatedAt: "t" }, "c1/p2": { solved: true, attempts: 1, updatedAt: "t" } };
    const overlays = { "c1/p1": { mastered: true as const }, "c1/p2": { attemptCount: 2 } };
    const queue = enqueuePuzzleReview(emptyPuzzleReviewQueue(), "c1", "p1", "t");
    const pruned = prunePuzzleRecords(progress, overlays, queue, "c1", "p1");
    expect(pruned.progress["c1/p1"]).toBeUndefined();
    expect(pruned.progress["c1/p2"]).toBeDefined();
    expect(pruned.overlays["c1/p1"]).toBeUndefined();
    expect(pruned.overlays["c1/p2"]).toBeDefined();
    expect(pruned.queue.items).toHaveLength(0);
  });

  it("重置只清进度与队列，保留掌握标记", () => {
    const overlays = { "c1/p1": { mastered: true as const, attemptCount: 4 }, "c1/p2": { attemptCount: 1 } };
    const reset = resetPuzzleProgressState(overlays);
    expect(reset.progress).toEqual({});
    expect(reset.queue.items).toEqual([]);
    expect(reset.overlays).toBe(overlays);
    expect(reset.overlays["c1/p1"]?.mastered).toBe(true);
  });
});
