import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "./game";
import { duplicateSummary, findDuplicateRecords, loadActive, loadDraftFromLocal, loadLibrary, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveToLibrary } from "./storage";
import { loadPuzzleCollections, savePuzzleCollections, savePuzzleTitleOverride } from "./puzzles";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("local record storage", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("字段缺了的棋谱照样读得回来（旧代码会在读取时静默丢掉，再写回就永久没了）", () => {
    const document = createDocument("新谱");
    // 手工写一条"缺标题、缺 updatedAt"的存档（模拟早期版本或异常中断留下的记录）
    const damaged = { ...document, metadata: { ...document.metadata, title: "" }, updatedAt: undefined };
    localStorage.setItem("renju-note-library-v1", JSON.stringify([damaged]));
    const loaded = loadLibrary();
    expect(loaded.map((item) => item.id)).toContain(document.id);
    expect(loaded[0]?.metadata.title).toBe("未命名棋谱");
    expect(typeof loaded[0]?.updatedAt).toBe("string");
    // 关键：再保存别的东西时，这条不能因为"字段不全"被整体写回时挤掉
    saveToLibrary(createDocument("另一份"));
    expect(loadLibrary().map((item) => item.id)).toContain(document.id);
  });

  it("saveToLibrary 会给没有 updatedAt 的文档补时间戳（否则排序与筛选都会把它当坏数据）", () => {
    const document = { ...createDocument("无时间戳"), updatedAt: undefined } as unknown as Parameters<typeof saveToLibrary>[0];
    saveToLibrary(document);
    expect(typeof loadLibrary()[0]?.updatedAt).toBe("string");
    expect(loadActive()?.id).toBe(document.id);
  });

  it("removes the deleted record's active snapshot and draft", () => {
    const document = createDocument("待删除棋谱");
    saveToLibrary(document);
    saveDraftToLocal(document.id, { operations: [{ type: "update-node", nodeId: document.rootId, patch: { comment: "草稿注释" } }], redo: [] });

    expect(removeFromLibrary(document.id)).toEqual([]);
    expect(loadLibrary()).toEqual([]);
    expect(loadActive()).toBeNull();
    expect(loadDraftFromLocal(document.id)).toEqual({ operations: [], redo: [] });
  });

  it("removes a stale persisted draft when undo leaves no active operations", () => {
    const document = createDocument("撤销清理");
    const operation = { type: "update-node" as const, nodeId: document.rootId, patch: { comment: "旧草稿" } };
    saveDraftToLocal(document.id, { operations: [operation], redo: [] });
    expect(loadDraftFromLocal(document.id).operations).toHaveLength(1);

    saveDraftToLocal(document.id, { operations: [], redo: [operation] });

    expect(loadDraftFromLocal(document.id)).toEqual({ operations: [], redo: [] });
  });

  it("keeps another record active when deleting a non-active record", () => {
    const deleted = createDocument("删除对象");
    const active = createDocument("当前棋谱");
    saveToLibrary(deleted);
    saveToLibrary(active);

    removeFromLibrary(deleted.id);

    expect(loadActive()?.id).toBe(active.id);
    expect(loadLibrary().map((item) => item.id)).toEqual([active.id]);
  });

  it("renames a library record without switching the active record", () => {
    const renamed = createDocument("旧名称");
    const active = createDocument("当前棋谱");
    saveToLibrary(renamed); saveToLibrary(active);

    const result = renameInLibrary(renamed.id, "新名称");

    expect(result.document.metadata.title).toBe("新名称");
    expect(loadLibrary().find((item) => item.id === renamed.id)?.metadata.title).toBe("新名称");
    expect(loadActive()?.id).toBe(active.id);
  });

  it("persists collection and individual puzzle title overrides", () => {
    const collection = { id: "test-collection", title: "测试题集", source: "测试", license: "测试", puzzles: [{ id: "test-puzzle", title: "测试题", prompt: "黑先", difficulty: 1 as const, player: "black" as const, stones: [] }] };
    savePuzzleCollections([collection]);
    const loaded = loadPuzzleCollections()[0];
    expect(loaded?.id).toBe(collection.id);
    const puzzle = loaded.puzzles[0];

    savePuzzleTitleOverride(collection.id, "新题集名");
    savePuzzleTitleOverride(collection.id, "新题目名", puzzle.id);

    const reloaded = loadPuzzleCollections()[0];
    expect(reloaded.title).toBe("新题集名");
    expect(reloaded.puzzles[0].title).toBe("新题目名");
  });

  it("does not restore the retired original puzzle collection from old local data", () => {
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{ id: "original-tactics", title: "原创攻防体验", source: "旧版本", license: "项目自有", puzzles: [] }]));

    expect(loadPuzzleCollections()).toEqual([]);
  });

  // 库内重复检测（audit 2026-09-17）：导入时的签名比对只看新来的，
  // 库里早就攒下的重复没有任何地方能发现。
  describe("duplicate scan", () => {
    it("把内容相同的棋谱写进同一组，最近更新的排前面", () => {
      const original = createDocument("同一盘棋");
      const olderCopy = { ...original, id: "copy-old", updatedAt: "2026-09-01T00:00:00.000Z" };
      const newerCopy = { ...original, id: "copy-new", updatedAt: "2026-09-15T00:00:00.000Z" };
      const groups = findDuplicateRecords([olderCopy, original, newerCopy]);
      expect(groups).toHaveLength(1);
      expect(groups[0].members).toHaveLength(3);
      expect(Date.parse(groups[0].members[0].updatedAt!)).toBeGreaterThan(Date.parse(groups[0].members[2].updatedAt!));
    });

    it("内容不同就不算重复（改名/加注释都是合法区别）", () => {
      const base = createDocument("棋谱 A");
      const renamed = { ...base, metadata: { ...base.metadata, title: "棋谱 B" } };
      expect(findDuplicateRecords([base, renamed])).toHaveLength(0);
      expect(duplicateSummary([])).toEqual({ groups: 0, redundant: 0 });
    });

    it("汇总报出可清理的多余份数", () => {
      const base = createDocument("重复三份");
      const copies = [base, { ...base, id: "c1" }, { ...base, id: "c2" }];
      const groups = findDuplicateRecords(copies);
      expect(duplicateSummary(groups)).toEqual({ groups: 1, redundant: 2 });
    });
  });
});
