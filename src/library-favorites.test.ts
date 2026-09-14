import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFavorites, isCollectionFavorite, isPuzzleFavorite, isRecordFavorite, loadFavorites, pruneFavorites, saveFavorites, toggleCollectionFavorite, togglePuzzleFavorite, toggleRecordFavorite } from "./library-favorites";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

describe("library favorites", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
  it("starts empty and toggles records", () => {
    const favs = emptyFavorites();
    expect(isRecordFavorite(favs, "r1")).toBe(false);
    const on = toggleRecordFavorite(favs, "r1");
    expect(isRecordFavorite(on, "r1")).toBe(true);
    expect(on.records).toEqual(["r1"]);
    const off = toggleRecordFavorite(on, "r1");
    expect(isRecordFavorite(off, "r1")).toBe(false);
    expect(off.records).toEqual([]);
  });

  it("toggles collections and puzzles independently", () => {
    let favs = emptyFavorites();
    favs = toggleCollectionFavorite(favs, "c1");
    expect(isCollectionFavorite(favs, "c1")).toBe(true);
    favs = togglePuzzleFavorite(favs, "c1", "p1");
    favs = togglePuzzleFavorite(favs, "c1", "p2");
    expect(isPuzzleFavorite(favs, "c1", "p1")).toBe(true);
    expect(isPuzzleFavorite(favs, "c1", "p2")).toBe(true);
    // 移除最后一个 puzzle 时清理该 collection 的空桶
    favs = togglePuzzleFavorite(favs, "c1", "p1");
    favs = togglePuzzleFavorite(favs, "c1", "p2");
    expect(favs.puzzles.c1).toBeUndefined();
  });

  it("persists to localStorage and loads back", () => {
    localStorage.clear();
    let favs = emptyFavorites();
    favs = toggleRecordFavorite(favs, "r9");
    favs = toggleCollectionFavorite(favs, "c9");
    saveFavorites(favs);
    const loaded = loadFavorites();
    expect(isRecordFavorite(loaded, "r9")).toBe(true);
    expect(isCollectionFavorite(loaded, "c9")).toBe(true);
    // 坏数据容错
    localStorage.setItem("banbu-library-favorites-v1", "{not-json");
    expect(loadFavorites().records).toEqual([]);
    localStorage.clear();
  });

  it("prunes dangling favorites on delete", () => {
    let favs = emptyFavorites();
    favs = toggleRecordFavorite(favs, "gone-record");
    favs = toggleRecordFavorite(favs, "keep-record");
    favs = toggleCollectionFavorite(favs, "gone-col");
    favs = toggleCollectionFavorite(favs, "keep-col");
    favs = togglePuzzleFavorite(favs, "gone-col", "p1");
    favs = togglePuzzleFavorite(favs, "keep-col", "p2");
    const pruned = pruneFavorites(favs, ["gone-record"], ["gone-col"], [["gone-col", "p1"]]);
    expect(isRecordFavorite(pruned, "gone-record")).toBe(false);
    expect(isRecordFavorite(pruned, "keep-record")).toBe(true);
    expect(isCollectionFavorite(pruned, "gone-col")).toBe(false);
    expect(isCollectionFavorite(pruned, "keep-col")).toBe(true);
    expect(isPuzzleFavorite(pruned, "keep-col", "p2")).toBe(true);
  });
});
