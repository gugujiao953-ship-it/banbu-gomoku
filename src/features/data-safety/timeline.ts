import type { GameDocument } from "../../types";
import type { SnapshotRecord } from "./snapshots";
import { contentHash } from "./export-semantics";

export type TimelineEventKind = "import" | "rename" | "branch-change" | "annotation-edit" | "bookmark-edit" | "restore" | "sync-merge" | "snapshot";
export interface TimelineEvent {
  id: string;
  objectId: string;
  at: string;
  kind: TimelineEventKind;
  source: "local" | "import" | "sync" | "system";
  summary: string;
  snapshotId?: string;
  recoverable: boolean;
  diff?: DocumentDiff;
}
export interface DocumentDiff {
  nodeCount: { before: number; after: number; delta: number };
  branchCount: { before: number; after: number; delta: number };
  metadata: string[];
  annotations: { before: number; after: number; delta: number };
  bookmarks: { before: number; after: number; delta: number };
  impact: string;
}

const nodes = (document?: GameDocument) => document ? Object.values(document.nodes) : [];
const branchCount = (document?: GameDocument) => nodes(document).filter((node) => node.children.length > 1).length;
const annotationCount = (document?: GameDocument) => nodes(document).filter((node) => Boolean(node.comment || node.boardText || node.renLibAnnotations?.some((item) => item.text) || node.marks?.length)).length;
const metadataDiff = (before?: GameDocument, after?: GameDocument) => {
  if (!before || !after) return [];
  const labels: Array<[keyof GameDocument["metadata"], string]> = [["title", "标题"], ["black", "黑方"], ["white", "白方"], ["event", "赛事"], ["date", "日期"], ["result", "结果"], ["rule", "规则"], ["openingRule", "开局规则"]];
  return labels.filter(([key]) => before.metadata[key] !== after.metadata[key]).map(([, label]) => `${label}已变更`);
};
const bookmarkCount = (value: unknown): number => value && typeof value === "object" && !Array.isArray(value) ? Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0) : 0;

export const compareDocuments = (before: GameDocument | undefined, after: GameDocument, beforeBookmarks?: unknown, afterBookmarks?: unknown): DocumentDiff => {
  const beforeNodes = nodes(before).length, afterNodes = nodes(after).length;
  const beforeBranches = branchCount(before), afterBranches = branchCount(after);
  const beforeAnnotations = annotationCount(before), afterAnnotations = annotationCount(after);
  const beforeMarks = bookmarkCount(beforeBookmarks), afterMarks = bookmarkCount(afterBookmarks);
  const metadata = metadataDiff(before, after);
  const impact = before ? `${afterNodes - beforeNodes >= 0 ? "增加" : "减少"} ${Math.abs(afterNodes - beforeNodes)} 个节点；${afterBranches - beforeBranches >= 0 ? "增加" : "减少"} ${Math.abs(afterBranches - beforeBranches)} 个分支${metadata.length ? `；${metadata.join("、")}` : ""}` : "首次记录完整棋谱状态";
  return { nodeCount: { before: beforeNodes, after: afterNodes, delta: afterNodes - beforeNodes }, branchCount: { before: beforeBranches, after: afterBranches, delta: afterBranches - beforeBranches }, metadata, annotations: { before: beforeAnnotations, after: afterAnnotations, delta: afterAnnotations - beforeAnnotations }, bookmarks: { before: beforeMarks, after: afterMarks, delta: afterMarks - beforeMarks }, impact };
};

export const timelineEvent = (objectId: string, kind: TimelineEventKind, summary: string, options?: Partial<Pick<TimelineEvent, "at" | "source" | "snapshotId" | "recoverable" | "diff">>): TimelineEvent => ({ id: `${objectId}-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, objectId, at: options?.at || new Date().toISOString(), kind, source: options?.source || "local", summary, snapshotId: options?.snapshotId, recoverable: options?.recoverable ?? Boolean(options?.snapshotId), diff: options?.diff });

export const timelineFromSnapshots = (snapshots: SnapshotRecord[], current?: GameDocument): TimelineEvent[] => {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return ordered.map((snapshot, index) => {
    const previous = ordered[index - 1]?.document;
    const diff = compareDocuments(previous, snapshot.document);
    const kind: TimelineEventKind = snapshot.trigger === "restore-protection" ? "restore" : "snapshot";
    return timelineEvent(snapshot.objectId, kind, snapshot.summary || diff.impact, { at: snapshot.createdAt, source: "system", snapshotId: snapshot.id, recoverable: true, diff });
  }).concat(current && ordered.length === 0 ? [timelineEvent(current.id, "snapshot", "当前版本", { source: "system", recoverable: false, diff: compareDocuments(undefined, current) })] : []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
};

export const appendTimelineEvent = (events: TimelineEvent[], event: TimelineEvent, limit = 120) => [event, ...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
export const timelineStorageKey = (objectId: string) => `banbu-timeline-v1:${objectId}`;
export const loadTimeline = (objectId: string): TimelineEvent[] => { try { const value = JSON.parse(localStorage.getItem(timelineStorageKey(objectId)) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
export const saveTimeline = (objectId: string, events: TimelineEvent[]) => { try { localStorage.setItem(timelineStorageKey(objectId), JSON.stringify(events.slice(0, 120))); } catch { /* timeline is best effort and must not block editing */ } };
export const snapshotHasChanged = (before: GameDocument, after: GameDocument) => contentHash(before) !== contentHash(after);
