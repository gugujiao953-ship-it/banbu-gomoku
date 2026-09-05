import { describe, expect, it } from "vitest";
import { applyOrder, isLibraryOrderMaps, moveRelative, remapFolderOrder, removeFromOrder, sortIdsByTitles } from "./library-order";

describe("library order", () => {
  it("applies a stored order and tolerates stale or missing ids", () => {
    expect(applyOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a", "b"]);
    expect(applyOrder(["a", "b", "c"], ["x", "b"])).toEqual(["b", "a", "c"]);
    expect(applyOrder(["a", "b"], undefined)).toEqual(["a", "b"]);
    expect(applyOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("moves a dragged id before or after the target", () => {
    expect(moveRelative(["a", "b", "c", "d"], "a", "c", true)).toEqual(["b", "a", "c", "d"]);
    expect(moveRelative(["a", "b", "c", "d"], "a", "c", false)).toEqual(["b", "c", "a", "d"]);
    expect(moveRelative(["a", "b"], "b", "b", true)).toEqual(["a", "b"]);
    expect(moveRelative(["a", "b"], "x", "a", true)).toEqual(["a", "b"]);
  });

  it("sorts by titles with zh collation in both directions", () => {
    const titles = { a: "开局", b: "中盘", c: "Africa", d: "第10题", e: "第2题" };
    // zh collation: CJK by pinyin first, Latin after; numeric keeps 第2题 before 第10题
    expect(sortIdsByTitles(["a", "b", "c", "d", "e"], titles, "az")).toEqual(["e", "d", "a", "b", "c"]);
    expect(sortIdsByTitles(["a", "b", "c", "d", "e"], titles, "za")[0]).toBe("c");
  });

  it("remaps folder paths on rename for both buckets", () => {
    const maps = {
      recordFolders: { "": ["tournaments", "misc"] },
      records: { tournaments: ["r1", "r2"], "tournaments/final": ["r3"] },
    };
    const next = remapFolderOrder(maps, "recordFolders", "records", "tournaments", "比赛")!;
    expect(next.recordFolders?.[""]).toContain("比赛");
    expect(Object.keys(next.records!)).toContain("比赛");
    expect(Object.keys(next.records!)).toContain("比赛/final");
    expect(next.records!["比赛/final"]).toEqual(["r3"]);
  });

  it("removes deleted ids and drops trivial buckets", () => {
    const maps = { records: { folder: ["a", "b", "c"], tiny: ["x"] } };
    const next = removeFromOrder(maps, "records", "folder", "b")!;
    expect(next.records?.folder).toEqual(["a", "c"]);
    expect(next.records?.tiny).toEqual(["x"]);
    const emptied = removeFromOrder(maps, "records", "tiny", "x")!;
    expect(emptied.records?.tiny).toBeUndefined();
    expect(removeFromOrder(maps, "puzzleCollections", "missing", "x")).toBe(maps);
  });

  it("validates order maps from storage or backups", () => {
    expect(isLibraryOrderMaps({ records: { folder: ["a", "b"] } })).toBe(true);
    expect(isLibraryOrderMaps({ records: { folder: ["a", 3] } })).toBe(false);
    expect(isLibraryOrderMaps({ records: "nope" })).toBe(false);
    expect(isLibraryOrderMaps(null)).toBe(false);
  });
});
