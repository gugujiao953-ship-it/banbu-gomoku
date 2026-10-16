import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";

/**
 * 2026-09-22 缺陷回归：备份漏掉「用户手工攒出来的学习数据」。
 *
 * 复盘标注、分支命名、每日一题记录、自定义布局预设这五个键以前不在 LOCAL_KEYS
 * 里，导出完整备份→换机恢复后全部消失。它们都是用户一个个点/打字攒出来的，
 * 无法重建；与当年「收藏漏出键表导致换机即丢」是同一类事故。
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

const KEYS = {
  reviewMarks: "banbu-review-marks-v1",
  reviewBranchNames: "banbu-review-branch-names-v1",
  dailyTraining: "banbu-daily-training-v1",
  actionLayout: "banbu-action-layout-v1",
  actionLayoutPresets: "banbu-action-layout-presets-v1",
} as const;

const SEEDED = {
  [KEYS.reviewMarks]: { "doc-1:node-1": [{ row: 1, col: 1, kind: "circle" }] },
  [KEYS.reviewBranchNames]: { "doc-1": { "node-2": "我的研究线" } },
  [KEYS.dailyTraining]: { days: { "2026-09-22": { puzzleId: "p-1", solved: true } } },
  [KEYS.actionLayout]: { workspace: ["a", "b"] },
  [KEYS.actionLayoutPresets]: [{ name: "打谱", slots: ["a"] }],
};

describe("备份覆盖用户学习数据（2026-09-22）", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("banbu-gomoku-large-library");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    for (const [key, value] of Object.entries(SEEDED)) localStorage.setItem(key, JSON.stringify(value));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("导出快照里带上这五个键", async () => {
    const snapshot = await createBackupSnapshot("test");
    expect(snapshot.localStorage.reviewMarks).toMatchObject(SEEDED[KEYS.reviewMarks]);
    expect(snapshot.localStorage.reviewBranchNames).toMatchObject(SEEDED[KEYS.reviewBranchNames]);
    expect(snapshot.localStorage.dailyTraining).toMatchObject(SEEDED[KEYS.dailyTraining]);
    expect(snapshot.localStorage.actionLayout).toMatchObject(SEEDED[KEYS.actionLayout]);
    expect(snapshot.localStorage.actionLayoutPresets).toMatchObject(SEEDED[KEYS.actionLayoutPresets]);
  });

  it("序列化→解析→恢复到空环境后仍然在（换机场景）", async () => {
    const serialized = serializeBackup(await createBackupSnapshot("test"));
    localStorage.clear();
    await restoreBackup(parseBackup(serialized));
    for (const [key, value] of Object.entries(SEEDED)) {
      expect(JSON.parse(localStorage.getItem(key)!) as unknown).toMatchObject(value);
    }
  });

  it("旧备份（没有这些键）仍然可以导入，不因缺字段被拒", async () => {
    const legacy = JSON.parse(serializeBackup(await createBackupSnapshot("test"))) as {
      localStorage: Record<string, unknown>;
    };
    for (const key of ["reviewMarks", "reviewBranchNames", "dailyTraining", "actionLayout", "actionLayoutPresets"]) delete legacy.localStorage[key];
    localStorage.clear();
    await expect(restoreBackup(legacy as never)).resolves.toBeUndefined();
  });
});
