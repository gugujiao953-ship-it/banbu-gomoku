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
