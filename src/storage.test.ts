import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "./game";
import { loadActive, loadDraftFromLocal, loadLibrary, removeFromLibrary, saveDraftToLocal, saveToLibrary } from "./storage";

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

  it("keeps another record active when deleting a non-active record", () => {
    const deleted = createDocument("删除对象");
    const active = createDocument("当前棋谱");
    saveToLibrary(deleted);
    saveToLibrary(active);

    removeFromLibrary(deleted.id);

    expect(loadActive()?.id).toBe(active.id);
    expect(loadLibrary().map((item) => item.id)).toEqual([active.id]);
  });
});
