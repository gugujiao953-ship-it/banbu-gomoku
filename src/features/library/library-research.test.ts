import { describe, expect, it } from "vitest";
import { createDocument } from "../../game";
import type { LargeDocumentSummary } from "../../large-storage";
import { largeRecordMatchesFilter, recentResearchItems, recordMatchesFilter } from "./library-research";

describe("library research helpers", () => {
  it("filters drafts, recent records and large-only entries", () => {
    const record = createDocument("普通棋谱");
    record.updatedAt = "2026-08-29T00:00:00.000Z";
    const large: LargeDocumentSummary = { id: "large", metadata: record.metadata, updatedAt: record.updatedAt, mainLineLength: 20, nodeCount: 100000, fingerprint: "large" };
    const drafts = new Set([record.id, large.id]);
    const now = Date.parse("2026-08-30T00:00:00.000Z");
    expect(recordMatchesFilter(record, "drafts", drafts, now)).toBe(true);
    expect(recordMatchesFilter(record, "recent", drafts, now)).toBe(true);
    expect(recordMatchesFilter(record, "large", drafts, now)).toBe(false);
    expect(largeRecordMatchesFilter(large, "large", drafts, now)).toBe(true);
  });

  it("merges recent regular and large records while excluding the active one", () => {
    const active = createDocument("当前");
    active.updatedAt = "2026-08-30T00:00:00.000Z";
    const recent = createDocument("最近");
    recent.updatedAt = "2026-08-29T00:00:00.000Z";
    const large: LargeDocumentSummary = { id: "large", metadata: { ...active.metadata, title: "大型" }, updatedAt: "2026-08-30T01:00:00.000Z", mainLineLength: 10, nodeCount: 99999, fingerprint: "large" };
    const result = recentResearchItems([active, recent], [large], new Set([recent.id]), new Set(), active.id);
    expect(result.map((item) => item.title)).toEqual(["大型", "最近"]);
    expect(result[1].hasDraft).toBe(true);
  });
});
