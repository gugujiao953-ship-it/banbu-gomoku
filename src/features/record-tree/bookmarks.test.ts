import { describe, expect, it } from "vitest";
import { BOOKMARK_ACCENTS, findOrphanBookmarks, mergeRecordBookmarks, migrateBookmarkStore, pruneOrphanBookmarks, removeRecordBookmarks, searchRecordBookmarks, updateRecordBookmark } from "./bookmarks";

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

  // 孤儿书签（audit 2026-09-17）：删分支不会带走挂在其上的书签，以前没有检测也没有清理入口。
  describe("orphan bookmarks", () => {
    const bookmarks = {
      docA: [
        { id: "a1", nodeId: "n1", title: "还在", note: "", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
        { id: "a2", nodeId: "gone", title: "节点没了", note: "", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
      docB: [
        { id: "b1", nodeId: "x1", title: "棋谱没了", note: "", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
    };

    it("扫出节点已不存在的书签，并且整份棋谱不在库里时全算孤儿", () => {
      const report = findOrphanBookmarks(bookmarks, (id) => id === "docA" ? new Set(["n1"]) : null);
      expect(report.count).toBe(2);
      expect(report.documents).toBe(2);
      expect(report.orphans.docA.map((b) => b.id)).toEqual(["a2"]);
      expect(report.orphans.docB.map((b) => b.id)).toEqual(["b1"]);
    });

    it("没有孤儿时报告为空", () => {
      const report = findOrphanBookmarks(bookmarks, () => new Set(["n1", "gone", "x1"]));
      expect(report).toEqual({ orphans: {}, count: 0, documents: 0 });
    });

    it("清理只摘掉孤儿，空分组一并移除，正常书签原样保留", () => {
      const report = findOrphanBookmarks(bookmarks, (id) => id === "docA" ? new Set(["n1"]) : null);
      const pruned = pruneOrphanBookmarks(bookmarks, report);
      expect(Object.keys(pruned)).toEqual(["docA"]);
      expect(pruned.docA.map((b) => b.id)).toEqual(["a1"]);
    });
  });

  it("书签标识色扩到八色且保持稳定顺序（旧四色仍有效）", () => {
    expect(BOOKMARK_ACCENTS).toHaveLength(8);
    expect(BOOKMARK_ACCENTS.slice(0, 4)).toEqual(["jade", "gold", "blue", "rose"]);
    expect(migrateBookmarkStore({ r: [{ id: "x", nodeId: "n", title: "t", accent: "violet", createdAt: "2026-09-01T00:00:00.000Z" }] }).r[0].accent).toBe("violet");
  });
});
