import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STONE_OPACITY, MIN_STONE_OPACITY, STONE_OPACITY_KEY, loadStoneOpacity, normalizeStoneOpacity, saveStoneOpacity } from "./stone-opacity";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  get length() { return this.data.size; }
}

describe("stone opacity settings", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("keeps the pre-upgrade appearance when no setting exists", () => {
    expect(loadStoneOpacity()).toBe(DEFAULT_STONE_OPACITY);
  });

  it("persists percentages and clamps invisible values", () => {
    saveStoneOpacity(0.72);
    expect(localStorage.getItem(STONE_OPACITY_KEY)).toBe("0.72");
    expect(loadStoneOpacity()).toBe(0.72);
    expect(normalizeStoneOpacity(0)).toBe(MIN_STONE_OPACITY);
    expect(normalizeStoneOpacity(85)).toBe(0.85);
  });

  it("migrates a legacy value embedded in display settings", () => {
    localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({ showNumbers: true, stoneOpacityPercent: 64 }));
    expect(loadStoneOpacity()).toBe(0.64);
  });
});
