import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "./game";
import { loadActive, loadDraftFromLocal, loadLibrary, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveToLibrary } from "./storage";
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
});
