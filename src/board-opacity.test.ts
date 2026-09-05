import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_OPACITY_KEY, DEFAULT_BOARD_OPACITY, MIN_BOARD_OPACITY, loadBoardOpacity, normalizeBoardOpacity, saveBoardOpacity } from "./board-opacity";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

describe("board opacity settings", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("keeps the opaque default when no setting exists", () => {
    expect(loadBoardOpacity()).toBe(DEFAULT_BOARD_OPACITY);
  });

  it("persists percentages and clamps low contrast values", () => {
    saveBoardOpacity(0.68);
    expect(localStorage.getItem(BOARD_OPACITY_KEY)).toBe("0.68");
    expect(loadBoardOpacity()).toBe(0.68);
    expect(normalizeBoardOpacity(0)).toBe(MIN_BOARD_OPACITY);
    expect(normalizeBoardOpacity(72)).toBe(0.72);
  });
});
