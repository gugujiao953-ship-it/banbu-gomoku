import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMove, createDocument } from "./game";
import { buildCompactRenLibIndex } from "./compact-index";
import { loadLargeDocument, loadLargeSummaries, saveCompactIndex } from "./large-storage";
import { loadDraftFromLocal, loadLibrary, saveDraftToLocal, saveToLibrary } from "./storage";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";
import { createZip, readZip, textFromZipEntry } from "./zip";

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
    localStorage.setItem("banbu-stone-opacity-v1", "0.68");
    localStorage.setItem("banbu-board-opacity-v1", "0.74");
    localStorage.setItem("banbu-board-theme-v1", "aurora");
    localStorage.setItem("banbu-stone-theme-v1", "diamond");
    localStorage.setItem("banbu-default-board-size-v1", "19");
    localStorage.setItem("banbu-font-scale-v1", "large");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ tabletSplit: true, gestureZoom: true }));
    localStorage.setItem("banbu-annotation-highlight-v1", "gold");
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
    expect(JSON.parse(localStorage.getItem("banbu-stone-opacity-v1") || "1")).toBe(0.68);
    expect(JSON.parse(localStorage.getItem("banbu-board-opacity-v1") || "1")).toBe(0.74);
    expect(localStorage.getItem("banbu-board-theme-v1")).toBe("aurora");
    expect(localStorage.getItem("banbu-stone-theme-v1")).toBe("diamond");
    expect(localStorage.getItem("banbu-default-board-size-v1")).toBe("19");
    expect(localStorage.getItem("banbu-font-scale-v1")).toBe("large");
    expect(JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").tabletSplit).toBe(true);
    expect(localStorage.getItem("banbu-annotation-highlight-v1")).toBe("gold");
    expect((await loadLargeDocument(document.id))?.nodes[document.rootId]).toBeDefined();
    expect((await loadLargeSummaries()).some((item) => item.id === document.id)).toBe(true);
  });

  it("rejects invalid schema and leaves existing data untouched", async () => {
    const document = createDocument("原有数据");
    saveToLibrary(document);
    await expect(Promise.resolve().then(() => parseBackup(JSON.stringify({ schema: "wrong", version: 99 })))).rejects.toThrow();
    expect(loadLibrary()[0]?.metadata.title).toBe("原有数据");
  });

  it("reads a native backup snapshot from the exported ZIP container", async () => {
    const document = createDocument("ZIP 备份");
    saveToLibrary(document);
    const snapshot = await createBackupSnapshot("test");
    const archive = await createZip([{ name: "banbu-backup.json", data: serializeBackup(snapshot) }, { name: "README.txt", data: "说明" }]);
    const entries = await readZip(archive);
    const backupEntry = entries.find((entry) => entry.name === "banbu-backup.json");
    expect(backupEntry).toBeDefined();
    expect((parseBackup(textFromZipEntry(backupEntry!)).localStorage.library as Array<{ id?: string }>).some((item) => item.id === document.id)).toBe(true);
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
