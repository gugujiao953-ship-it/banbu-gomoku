import type { LargeDocumentSummary } from "../../large-storage";
import type { GameDocument } from "../../types";

export type RecordLibraryFilter = "all" | "drafts" | "recent" | "large";
export type RecentResearchItem =
  | { kind: "record"; id: string; title: string; updatedAt: string; document: GameDocument; hasDraft: boolean }
  | { kind: "large"; id: string; title: string; updatedAt: string; summary: LargeDocumentSummary; hasDraft: boolean };

export const isRecentlyUpdated = (updatedAt: string, now = Date.now(), days = 7) => {
  const timestamp = Date.parse(updatedAt || "");
  return Number.isFinite(timestamp) && timestamp >= now - days * 24 * 60 * 60 * 1000;
};

export const recordMatchesFilter = (item: GameDocument, filter: RecordLibraryFilter, draftIds: Set<string>, now = Date.now()) => {
  if (filter === "drafts") return draftIds.has(item.id);
  if (filter === "recent") return isRecentlyUpdated(item.updatedAt, now);
  if (filter === "large") return false;
  return true;
};

export const largeRecordMatchesFilter = (item: LargeDocumentSummary, filter: RecordLibraryFilter, draftIds: Set<string>, now = Date.now()) => {
  if (filter === "drafts") return draftIds.has(item.id);
  if (filter === "recent") return isRecentlyUpdated(item.updatedAt, now);
  return true;
};

export const recentResearchItems = (
  records: GameDocument[],
  largeRecords: LargeDocumentSummary[],
  regularDraftIds: Set<string>,
  largeDraftIds: Set<string>,
  activeId: string,
  limit = 4,
): RecentResearchItem[] => [
  ...records.map((document): RecentResearchItem => ({ kind: "record", id: document.id, title: document.metadata.title, updatedAt: document.updatedAt, document, hasDraft: regularDraftIds.has(document.id) })),
  ...largeRecords.map((summary): RecentResearchItem => ({ kind: "large", id: summary.id, title: summary.metadata.title, updatedAt: summary.updatedAt, summary, hasDraft: largeDraftIds.has(summary.id) })),
].filter((item) => item.id !== activeId)
  .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.title.localeCompare(b.title))
  .slice(0, limit);
