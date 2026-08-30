import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "./game";
import { addToRecycleBin, loadRecycleBin, removeFromRecycleBin } from "./recycle-bin";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("recycle bin metadata", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("persists deleted records in newest-first order and removes only the selected entry", () => {
    const older = createDocument("旧棋谱");
    const newer = createDocument("新棋谱");
    addToRecycleBin({ id: older.id, kind: "record", item: older, folder: "未分类", deletedAt: "2026-08-29T00:00:00.000Z" });
    addToRecycleBin({ id: newer.id, kind: "record", item: newer, folder: "研究", deletedAt: "2026-08-30T00:00:00.000Z" });

    expect(loadRecycleBin().map((item) => item.kind === "puzzle-collection" ? item.item.title : item.item.metadata.title)).toEqual(["新棋谱", "旧棋谱"]);
    removeFromRecycleBin("record", newer.id);
    expect(loadRecycleBin().map((item) => item.kind === "puzzle-collection" ? item.item.title : item.item.metadata.title)).toEqual(["旧棋谱"]);
  });
});
