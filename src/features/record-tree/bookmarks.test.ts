import { describe, expect, it } from "vitest";
import { mergeRecordBookmarks, migrateBookmarkStore, removeRecordBookmarks, searchRecordBookmarks, updateRecordBookmark } from "./bookmarks";

describe("record bookmarks", () => {
  it("removes pasted bookmarks on undo and restores them without duplicates on redo", () => {
    const original = { id: "original", nodeId: "n1", title: "原书签", note: "", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" };
    const pasted = { id: "pasted", nodeId: "copy-1", title: "复制书签", note: "", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
    const afterPaste = mergeRecordBookmarks([original], [pasted]);
    expect(removeRecordBookmarks(afterPaste, [pasted.id])).toEqual([original]);
    expect(mergeRecordBookmarks(afterPaste, [pasted])).toEqual([original, pasted]);
  });
  it("migrates legacy name-only bookmarks without dropping data", () => {
    const migrated = migrateBookmarkStore({
      record: [{ id: "old", name: "关键变化", nodeId: "n2", createdAt: "2026-08-29T00:00:00.000Z", unknown: "kept-safe-in-source" }],
      malformed: [{ name: "missing node" }],
    }, "2026-08-30T00:00:00.000Z");
    expect(migrated.record).toEqual([expect.objectContaining({ id: "old", title: "关键变化", note: "", nodeId: "n2" })]);
    expect(migrated.malformed).toBeUndefined();
  });

  it("edits title and note and searches both fields", () => {
    const source = migrateBookmarkStore({ record: [{ id: "b1", name: "旧标题", nodeId: "n1", createdAt: "2026-08-29T00:00:00.000Z" }] }).record;
    const edited = updateRecordBookmark(source, "b1", { title: "冲四研究", note: "白棋需要防守 J9", accent: "gold" }, "2026-08-30T01:00:00.000Z");
    expect(searchRecordBookmarks(edited, "J9")).toHaveLength(1);
    expect(searchRecordBookmarks(edited, "冲四")[0]).toEqual(expect.objectContaining({ title: "冲四研究", note: "白棋需要防守 J9", accent: "gold" }));
  });
});
