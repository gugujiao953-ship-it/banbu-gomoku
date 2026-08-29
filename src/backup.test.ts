import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMove, createDocument } from "./game";
import { buildCompactRenLibIndex } from "./compact-index";
import { loadLargeDocument, loadLargeSummaries, saveCompactIndex } from "./large-storage";
import { loadDraftFromLocal, loadLibrary, saveDraftToLocal, saveToLibrary } from "./storage";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("versioned application backup", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("banbu-gomoku-large-library");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips local data, drafts, and compact large indexes", async () => {
    let document = createDocument("备份棋谱");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    saveToLibrary(document);
    saveDraftToLocal(document.id, { operations: [{ type: "update-node", nodeId: document.rootId, patch: { comment: "未保存注释" } }], redo: [] });
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{ id: "c1", title: "题库", source: "用户", license: "自有", puzzles: [{ id: "p1", title: "题目", prompt: "黑先", difficulty: 2, player: "black", stones: [{ row: 7, col: 7, player: "black" }] }] }]));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({ "c1/p1": { solved: true, attempts: 2, updatedAt: new Date().toISOString() } }));
    localStorage.setItem("renju-note-library-folders-v1", JSON.stringify({ recordFolders: ["研究"], puzzleFolders: ["题库"], recordAssignments: { [document.id]: "研究" }, puzzleAssignments: {} }));
    await saveCompactIndex(document, buildCompactRenLibIndex(document));

    const serialized = serializeBackup(await createBackupSnapshot("test"));
    const parsed = parseBackup(serialized);

    saveToLibrary(createDocument("覆盖数据"));
    localStorage.setItem("renju-note-draft-v2:other", JSON.stringify({ operations: [], redo: [] }));
    await restoreBackup(parsed);

    expect(loadLibrary().some((item) => item.id === document.id && item.metadata.title === "备份棋谱")).toBe(true);
    expect(loadDraftFromLocal(document.id).operations).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("renju-note-puzzle-progress-v1") || "{}")["c1/p1"].solved).toBe(true);
    expect(JSON.parse(localStorage.getItem("renju-note-library-folders-v1") || "{}").recordFolders).toEqual(["研究"]);
    expect((await loadLargeDocument(document.id))?.nodes[document.rootId]).toBeDefined();
    expect((await loadLargeSummaries()).some((item) => item.id === document.id)).toBe(true);
  });

  it("rejects invalid schema and leaves existing data untouched", async () => {
    const document = createDocument("原有数据");
    saveToLibrary(document);
    await expect(Promise.resolve().then(() => parseBackup(JSON.stringify({ schema: "wrong", version: 99 })))).rejects.toThrow();
    expect(loadLibrary()[0]?.metadata.title).toBe("原有数据");
  });

  it("uses replacement semantics on repeated restore", async () => {
    const first = createDocument("第一份");
    saveToLibrary(first);
    const snapshot = await createBackupSnapshot("test");
    const second = createDocument("第二份");
    saveToLibrary(second);
    await restoreBackup(snapshot);
    await restoreBackup(snapshot);
    expect(loadLibrary().map((item) => item.id)).toEqual([first.id]);
  });
});
