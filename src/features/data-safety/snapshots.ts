import type { GameDocument } from "../../types";
import { contentHash } from "./export-semantics";

export type SnapshotTrigger = "manual" | "import-overwrite" | "delete-replace" | "major-edit" | "background-save" | "restore-protection";
export interface SnapshotRecord {
  id: string;
  objectId: string;
  createdAt: string;
  trigger: SnapshotTrigger;
  summary: string;
  schemaVersion: 1;
  contentHash: string;
  pinned: boolean;
  document: GameDocument;
}
export interface SnapshotPolicy { maxPerObject: number; maxTotalBytes: number; debounceMs: number }
export const SNAPSHOT_STORAGE_KEY = "banbu-data-snapshots-v1";
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = { maxPerObject: 12, maxTotalBytes: 6 * 1024 * 1024, debounceMs: 1200 };

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const load = (): SnapshotRecord[] => {
  const storage = safeStorage(); if (!storage) return [];
  try { const value = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY) || "[]"); return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.objectId === "string" && item.document) as SnapshotRecord[] : []; } catch { return []; }
};
const persist = (records: SnapshotRecord[]) => {
  const storage = safeStorage(); if (!storage) return false;
  try { storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(records)); return true; } catch { return false; }
};
const sizeOf = (records: SnapshotRecord[]) => new TextEncoder().encode(JSON.stringify(records)).byteLength;
const snapshotId = (objectId: string, now: string) => `${objectId}-snapshot-${Date.parse(now).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class SnapshotRepository {
  constructor(private readonly policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY) {}
  list(objectId?: string) { return load().filter((item) => !objectId || item.objectId === objectId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); }
  get(id: string) { return load().find((item) => item.id === id) || null; }
  create(document: GameDocument, trigger: SnapshotTrigger, summary?: string, options?: { pinned?: boolean; now?: string }): SnapshotRecord | null {
    const now = options?.now || new Date().toISOString();
    const records = load();
    const latest = records.find((item) => item.objectId === document.id && item.contentHash === contentHash(document));
    if (latest && trigger !== "manual" && !options?.pinned) return latest;
    const record: SnapshotRecord = { id: snapshotId(document.id, now), objectId: document.id, createdAt: now, trigger, summary: summary || defaultSummary(trigger), schemaVersion: 1, contentHash: contentHash(document), pinned: Boolean(options?.pinned), document: clone(document) };
    const next = [record, ...records.filter((item) => item.id !== record.id)];
    const objectRecords = next.filter((item) => item.objectId === document.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const keepIds = new Set(objectRecords.slice(0, this.policy.maxPerObject).map((item) => item.id));
    objectRecords.forEach((item) => { if (item.pinned) keepIds.add(item.id); });
    let trimmed = next.filter((item) => item.objectId !== document.id || keepIds.has(item.id));
    while (sizeOf(trimmed) > this.policy.maxTotalBytes) {
      const candidate = [...trimmed].reverse().find((item) => !item.pinned && item.objectId !== document.id ? true : !item.pinned && trimmed.filter((entry) => entry.objectId === item.objectId).length > 1);
      if (!candidate) break;
      trimmed = trimmed.filter((item) => item.id !== candidate.id);
    }
    return persist(trimmed) ? record : null;
  }
  pin(id: string, pinned = true) { const records = load(); const target = records.find((item) => item.id === id); if (!target) return null; target.pinned = pinned; return persist(records) ? target : null; }
  remove(id: string) { const records = load(); const target = records.find((item) => item.id === id); if (!target) return false; const sameObject = records.filter((item) => item.objectId === target.objectId); if (sameObject.length <= 1) return false; return persist(records.filter((item) => item.id !== id)); }
  preview(id: string) { const target = this.get(id); return target ? { id: target.id, objectId: target.objectId, createdAt: target.createdAt, trigger: target.trigger, summary: target.summary, nodeCount: Object.keys(target.document.nodes).length, contentHash: target.contentHash, pinned: target.pinned } : null; }
  async restore(id: string, current: GameDocument, apply: (document: GameDocument) => Promise<void> | void) {
    const target = this.get(id); if (!target) throw new Error("找不到要恢复的版本");
    const protection = this.create(current, "restore-protection", "恢复前自动保护当前版本", { pinned: true });
    if (!protection) throw new Error("无法创建恢复保护快照，当前数据未改变");
    try { await apply(clone(target.document)); return target.document; } catch (error) {
      try { await apply(clone(current)); } catch { throw new Error("恢复失败且原状态回退失败，请保留当前页面并不要清理本地数据"); }
      throw error instanceof Error ? error : new Error("恢复版本失败");
    }
  }
  scheduleDebounced(document: GameDocument, trigger: SnapshotTrigger = "background-save", summary?: string) {
    const key = `${SNAPSHOT_STORAGE_KEY}:timer:${document.id}`;
    const previous = (globalThis as typeof globalThis & { __banbuSnapshotTimers?: Record<string, number> }).__banbuSnapshotTimers || {};
    if (previous[document.id]) clearTimeout(previous[document.id]);
    previous[document.id] = globalThis.setTimeout(() => { delete previous[document.id]; this.create(document, trigger, summary); }, this.policy.debounceMs) as unknown as number;
    (globalThis as typeof globalThis & { __banbuSnapshotTimers?: Record<string, number> }).__banbuSnapshotTimers = previous;
    return () => { if (previous[document.id]) clearTimeout(previous[document.id]); delete previous[document.id]; };
  }
}

const defaultSummary = (trigger: SnapshotTrigger) => ({ manual: "手动创建版本", "import-overwrite": "导入覆盖前自动保护", "delete-replace": "删除或替换前自动保护", "major-edit": "重大结构编辑前自动保护", "background-save": "后台退出前自动保存", "restore-protection": "恢复前自动保护当前版本" } as Record<SnapshotTrigger, string>)[trigger];
export const snapshotRepository = new SnapshotRepository();
