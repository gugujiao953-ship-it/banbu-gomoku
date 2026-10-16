import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "../../game";
import { DEFAULT_SNAPSHOT_POLICY, SNAPSHOT_STORAGE_KEY, SnapshotRepository } from "./snapshots";

describe("snapshot repository", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", new MemoryStorage()); vi.useRealTimers(); });
  it("deduplicates automatic snapshots and keeps pinned versions", () => {
    const repo = new SnapshotRepository({ ...DEFAULT_SNAPSHOT_POLICY, maxPerObject: 2 });
    const doc = createDocument("版本");
    const first = repo.create(doc, "background-save", undefined, { now: "2026-08-30T00:00:00.000Z" });
    expect(repo.create(doc, "background-save", undefined, { now: "2026-08-30T00:01:00.000Z" })?.id).toBe(first?.id);
    repo.create({ ...doc, updatedAt: "2026-08-30T00:02:00.000Z" }, "manual", undefined, { pinned: true, now: "2026-08-30T00:02:00.000Z" });
    expect(repo.list(doc.id).some((item) => item.pinned)).toBe(true);
    expect(localStorage.getItem(SNAPSHOT_STORAGE_KEY)).toBeTruthy();
  });
  it("creates protection before restore and rolls back on failure", async () => {
    const repo = new SnapshotRepository();
    const original = createDocument("原状态");
    const target = createDocument("目标状态");
    const snap = repo.create(target, "manual", undefined, { now: "2026-08-30T00:00:00.000Z" })!;
    let applied = "";
    await expect(repo.restore(snap.id, original, async (doc) => { applied = doc.metadata.title; if (doc.metadata.title === "目标状态") throw new Error("boom"); })).rejects.toThrow("boom");
    expect(applied).toBe("原状态");
    expect(repo.list(original.id).some((item) => item.trigger === "restore-protection")).toBe(true);
  });

  // 版本历史接线（audit 2026-09-17）：App 在每次保存**前**留档，所以列表里存的是
  // "上一版"。这里固定住这条契约：留档保存的是当时那份内容，恢复能整份拿回来。
  it("留档保存的是保存前的内容，且能整份恢复", async () => {
    const repo = new SnapshotRepository();
    const before = createDocument("改之前的名字");
    const snap = repo.create(before, "manual", "保存前自动留档", { now: "2026-09-17T00:00:00.000Z" })!;
    expect(snap.summary).toBe("保存前自动留档");
    expect(repo.list(before.id)).toHaveLength(1);

    const after = { ...before, metadata: { ...before.metadata, title: "改之后的名字" }, updatedAt: "2026-09-17T00:05:00.000Z" };
    let restored: string | null = null;
    await repo.restore(snap.id, after, async (doc) => { restored = doc.metadata.title; });
    expect(restored).toBe("改之前的名字");
    // 恢复前的那一版被自动保护，所以用户还能再走回去。
    expect(repo.list(before.id).some((item) => item.trigger === "restore-protection" && item.pinned)).toBe(true);
  });

  it("钉住的版本不会被条数上限清掉", () => {
    const repo = new SnapshotRepository({ ...DEFAULT_SNAPSHOT_POLICY, maxPerObject: 2 });
    const doc = createDocument("钉住");
    const pinned = repo.create(doc, "manual", "要保留的版本", { pinned: true, now: "2026-09-17T00:00:00.000Z" })!;
    for (let index = 1; index <= 4; index += 1) {
      repo.create({ ...doc, updatedAt: `2026-09-17T00:0${index}:00.000Z` }, "manual", `第 ${index} 版`, { now: `2026-09-17T00:1${index}:00.000Z` });
    }
    const kept = repo.list(doc.id);
    expect(kept.some((item) => item.id === pinned.id)).toBe(true);
  });
});

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
