import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "../../game";
import { compareDocuments, timelineFromSnapshots } from "./timeline";
import type { SnapshotRecord } from "./snapshots";

describe("modification timeline", () => {
  it("summarizes structural changes without recording UI noise", () => {
    const before = createDocument("时间线");
    const after = addMove(before, before.rootId, { row: 7, col: 7 }).document;
    const diff = compareDocuments(before, after);
    expect(diff.nodeCount.delta).toBe(1);
    expect(diff.impact).toContain("节点");
  });
  it("builds recoverable events from snapshots", () => {
    const doc = createDocument("时间线");
    const snapshot: SnapshotRecord = { id: "s1", objectId: doc.id, createdAt: "2026-08-30T00:00:00.000Z", trigger: "manual", summary: "手动版本", schemaVersion: 1, contentHash: "x", pinned: false, document: doc };
    expect(timelineFromSnapshots([snapshot])[0].recoverable).toBe(true);
  });
});
