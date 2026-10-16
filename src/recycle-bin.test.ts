import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "./game";
import { addToRecycleBin, emptyRecycleBinConfirmation, loadRecycleBin, loadRecycleBinPruned, permanentDeleteConfirmation, pruneRecycleBin, RECYCLE_BIN_MAX_ENTRIES, RECYCLE_BIN_RETENTION_DAYS, removeFromRecycleBin, type RecycleBinEntry } from "./recycle-bin";

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

  it("uses explicit irreversible confirmation copy for permanent deletion", () => {
    const document = createDocument("重要棋谱");
    const entry = { id: document.id, kind: "record" as const, item: document, folder: "研究", deletedAt: "2026-09-01T00:00:00.000Z" };
    expect(permanentDeleteConfirmation(entry)).toContain("重要棋谱");
    expect(permanentDeleteConfirmation(entry)).toContain("无法撤销");
    expect(emptyRecycleBinConfirmation(3)).toContain("3 项");
    expect(emptyRecycleBinConfirmation(3)).toContain("无法恢复");
  });

  // 保留策略（audit 2026-09-17）：只在「超量 且 够旧」时从最旧的开始丢，
  // 新删的东西永远来得及反悔。
  describe("retention policy", () => {
    const entryAt = (index: number, deletedAt: string): RecycleBinEntry => {
      const document = createDocument(`棋谱 ${index}`);
      return { id: `id-${index}`, kind: "record", item: document, folder: "未分类", deletedAt };
    };
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.parse("2026-09-17T00:00:00.000Z");
    const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

    it("不超量时一个都不动（哪怕很旧）", () => {
      const ancient = [entryAt(1, iso(4000)), entryAt(2, iso(3000))];
      expect(pruneRecycleBin(ancient, now)).toEqual({ entries: ancient, removed: 0 });
    });

    it("超量但都还在保留期内时也不动", () => {
      const recent = Array.from({ length: RECYCLE_BIN_MAX_ENTRIES + 10 }, (_, index) => entryAt(index, iso(1)));
      expect(pruneRecycleBin(recent, now).removed).toBe(0);
    });

    it("超量且有够旧的项时，丢掉最旧的、数量刚好回到上限", () => {
      const fresh = Array.from({ length: RECYCLE_BIN_MAX_ENTRIES }, (_, index) => entryAt(index, iso(2)));
      const stale = [entryAt(900, iso(RECYCLE_BIN_RETENTION_DAYS + 1)), entryAt(901, iso(RECYCLE_BIN_RETENTION_DAYS + 10))];
      // 列表按 deletedAt 倒序：新的在前，老的在后。
      const result = pruneRecycleBin([...fresh, ...stale], now);
      expect(result.removed).toBe(2);
      expect(result.entries.every((entry) => entry.id !== "id-900" && entry.id !== "id-901")).toBe(true);
      expect(result.entries.length).toBe(RECYCLE_BIN_MAX_ENTRIES);
    });

    it("旧项比溢出量少时只丢旧的，不碰还年轻的那些", () => {
      // 205 项：5 项够旧、200 项是昨天的。溢出量＝5，正好只丢那 5 项旧的。
      const fresh = Array.from({ length: RECYCLE_BIN_MAX_ENTRIES }, (_, index) => entryAt(index, iso(1)));
      const stale = Array.from({ length: 5 }, (_, index) => entryAt(900 + index, iso(RECYCLE_BIN_RETENTION_DAYS + 5)));
      const result = pruneRecycleBin([...fresh, ...stale], now);
      expect(result.removed).toBe(5);
      expect(result.entries.length).toBe(RECYCLE_BIN_MAX_ENTRIES);
      expect(result.entries.every((entry) => Number(entry.id.replace("id-", "")) < 900)).toBe(true);
    });

    it("时间解析不出来的条目一律留下", () => {
      const fresh = Array.from({ length: RECYCLE_BIN_MAX_ENTRIES }, (_, index) => entryAt(index, iso(1)));
      const broken = entryAt(999, "不是时间");
      const result = pruneRecycleBin([broken, ...fresh], now);
      expect(result.entries.some((entry) => entry.id === "id-999")).toBe(true);
      expect(result.removed).toBe(0);
    });

    it("loadRecycleBinPruned 会把裁剪结果写回存储", () => {
      const fresh = Array.from({ length: RECYCLE_BIN_MAX_ENTRIES }, (_, index) => entryAt(index, iso(2)));
      const stale = [entryAt(900, iso(RECYCLE_BIN_RETENTION_DAYS + 1))];
      for (const entry of [...fresh, ...stale]) addToRecycleBin(entry);
      expect(loadRecycleBinPruned(now).length).toBe(RECYCLE_BIN_MAX_ENTRIES);
      expect(loadRecycleBin().length).toBe(RECYCLE_BIN_MAX_ENTRIES);
    });
  });
});
