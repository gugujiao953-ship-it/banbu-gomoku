import type { GameDocument } from "../../types";
import { contentHash } from "./export-semantics";

export type SyncStatus = "disabled" | "idle" | "pending" | "syncing" | "synced" | "conflict" | "failed";
export type ConflictResolution = "keep-local" | "keep-remote" | "save-copy" | "later";
export interface SyncRecord { objectId: string; version: number; baseVersion: number; contentHash: string; updatedAt: string; payload: GameDocument }
export interface SyncProvider { readonly id: string; put(record: SyncRecord): Promise<void>; get(objectId: string): Promise<SyncRecord | null>; remove?(objectId: string): Promise<void> }
export interface SyncConflict { objectId: string; local: SyncRecord; remote: SyncRecord; base: SyncRecord | null; merged?: SyncRecord; reason: string }
export interface SyncOptions { enabled?: boolean; provider?: SyncProvider; persistLocal: (document: GameDocument) => Promise<void> | void; saveCopy?: (document: GameDocument) => Promise<void> | void }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isDocument = (value: unknown): value is GameDocument => Boolean(value && typeof value === "object" && (value as GameDocument).id && (value as GameDocument).rootId && (value as GameDocument).nodes);

export class MemorySyncProvider implements SyncProvider {
  readonly id = "memory";
  private records = new Map<string, SyncRecord>();
  async put(record: SyncRecord) { this.records.set(record.objectId, clone(record)); }
  async get(objectId: string) { return clone(this.records.get(objectId) || null); }
  async remove(objectId: string) { this.records.delete(objectId); }
}

export const createSyncRecord = (document: GameDocument, version: number, baseVersion = Math.max(0, version - 1)): SyncRecord => ({ objectId: document.id, version, baseVersion, contentHash: contentHash(document), updatedAt: document.updatedAt, payload: clone(document) });
export const mergeDocuments = (base: GameDocument | null, local: GameDocument, remote: GameDocument): { document: GameDocument; conflicts: string[] } => {
  const conflicts: string[] = [];
  const merged = clone(local);
  const baseMetadata = base?.metadata;
  (Object.keys(remote.metadata) as Array<keyof GameDocument["metadata"]>).forEach((key) => {
    const localChanged = !baseMetadata || local.metadata[key] !== baseMetadata[key];
    const remoteChanged = !baseMetadata || remote.metadata[key] !== baseMetadata[key];
    if (remoteChanged && !localChanged) merged.metadata[key] = remote.metadata[key] as never;
    else if (remoteChanged && localChanged && local.metadata[key] !== remote.metadata[key]) conflicts.push(`元数据.${String(key)}`);
  });
  const baseNodes = base?.nodes || {};
  Object.entries(remote.nodes).forEach(([id, remoteNode]) => {
    const localNode = merged.nodes[id];
    const baseNode = baseNodes[id];
    const localChanged = JSON.stringify(localNode) !== JSON.stringify(baseNode);
    const remoteChanged = JSON.stringify(remoteNode) !== JSON.stringify(baseNode);
    if (!localNode || (remoteChanged && !localChanged)) merged.nodes[id] = clone(remoteNode);
    else if (remoteChanged && localChanged && JSON.stringify(localNode) !== JSON.stringify(remoteNode)) conflicts.push(`节点.${id}`);
  });
  Object.entries(baseNodes).forEach(([id]) => {
    if (local.nodes[id] && !remote.nodes[id] && JSON.stringify(local.nodes[id]) === JSON.stringify(baseNodes[id])) delete merged.nodes[id];
  });
  merged.updatedAt = new Date().toISOString();
  return { document: merged, conflicts };
};

export class SyncEngine {
  status: SyncStatus;
  lastError: string | null = null;
  conflict: SyncConflict | null = null;
  private versions = new Map<string, SyncRecord>();
  private baselines = new Map<string, SyncRecord>();
  constructor(private readonly options: SyncOptions) { this.status = options.enabled && options.provider ? "idle" : "disabled"; }
  get enabled() { return this.status !== "disabled"; }
  setEnabled(enabled: boolean) { this.status = enabled && this.options.provider ? "idle" : "disabled"; this.conflict = null; }
  markPending(document: GameDocument) { if (!this.enabled) return; const previous = this.versions.get(document.id); if (!this.baselines.has(document.id) && previous) this.baselines.set(document.id, clone(previous)); this.versions.set(document.id, createSyncRecord(document, (previous?.version || 0) + 1, previous?.version || 0)); this.status = "pending"; }
  async syncNow(document: GameDocument): Promise<SyncStatus> {
    if (!this.enabled || !this.options.provider) { this.status = "disabled"; return this.status; }
    this.status = "syncing"; this.lastError = null;
    try {
      await this.options.persistLocal(document); // local-first: durable before network
      const local = this.versions.get(document.id) || createSyncRecord(document, 1, 0);
      const remote = await this.options.provider.get(document.id);
      if (!remote || remote.contentHash === local.contentHash) { await this.options.provider.put(local); this.versions.set(document.id, local); this.baselines.set(document.id, clone(local)); this.status = "synced"; return this.status; }
      if (remote.version === local.baseVersion || remote.contentHash === local.contentHash) { await this.options.provider.put(local); this.versions.set(document.id, local); this.baselines.set(document.id, clone(local)); this.status = "synced"; return this.status; }
      const base = this.baselines.get(document.id) || null;
      const merged = mergeDocuments(base?.payload || null, local.payload, remote.payload);
      if (!merged.conflicts.length) {
        const mergedRecord = createSyncRecord(merged.document, Math.max(local.version, remote.version) + 1, Math.max(local.version, remote.version));
        await this.options.persistLocal(merged.document); await this.options.provider.put(mergedRecord); this.versions.set(document.id, mergedRecord); this.baselines.set(document.id, clone(mergedRecord)); this.status = "synced"; return this.status;
      }
      this.conflict = { objectId: document.id, local, remote, base, reason: `检测到 ${merged.conflicts.length} 处并发修改：${merged.conflicts.slice(0, 3).join("、")}`, merged: createSyncRecord(merged.document, Math.max(local.version, remote.version) + 1, Math.max(local.version, remote.version)) };
      this.status = "conflict"; return this.status;
    } catch (error) { this.lastError = error instanceof Error ? error.message : "同步失败"; this.status = "failed"; return this.status; }
  }
  async resolveConflict(choice: ConflictResolution) {
    const conflict = this.conflict; if (!conflict || !this.options.provider) throw new Error("当前没有待处理的同步冲突");
    if (choice === "later") return;
    if (choice === "keep-local") { await this.options.provider.put(conflict.local); this.versions.set(conflict.objectId, conflict.local); }
    else if (choice === "keep-remote") { await this.options.persistLocal(conflict.remote.payload); this.versions.set(conflict.objectId, conflict.remote); }
    else if (choice === "save-copy") { if (!this.options.saveCopy) throw new Error("当前未配置冲突副本保存入口"); await this.options.saveCopy(conflict.remote.payload); await this.options.provider.put(conflict.local); this.versions.set(conflict.objectId, conflict.local); }
    this.conflict = null; this.status = "synced";
  }
}

export const syncSettingsKey = "banbu-sync-settings-v1";
export const loadSyncEnabled = () => { try { return localStorage.getItem(syncSettingsKey) === "enabled"; } catch { return false; } };
export const saveSyncEnabled = (enabled: boolean) => { try { if (enabled) localStorage.setItem(syncSettingsKey, "enabled"); else localStorage.removeItem(syncSettingsKey); } catch { /* sync is optional */ } };
export const assertOfflineWhenDisabled = async <T>(enabled: boolean, operation: () => Promise<T>) => { if (!enabled) return undefined; return operation(); };
