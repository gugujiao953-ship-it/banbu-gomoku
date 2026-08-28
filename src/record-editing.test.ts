import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "./game";
import { createEditableViewCopy, findVisibleVariationTarget, visibleVariationPivot } from "./record-editing";

describe("record editing bridge", () => {
  it("treats a sibling shown at a leaf as navigation, not a new continuation", () => {
    let document = createDocument("分支语义");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const left = addMove(document, first.nodeId, { row: 7, col: 8 }); document = left.document;
    const right = addMove(document, first.nodeId, { row: 6, col: 7 }); document = right.document;

    expect(visibleVariationPivot(document, left.nodeId)?.id).toBe(first.nodeId);
    expect(findVisibleVariationTarget(document, left.nodeId, { row: 6, col: 7 })?.target.id).toBe(right.nodeId);
    expect(findVisibleVariationTarget(document, left.nodeId, { row: 5, col: 7 })).toBeUndefined();
  });

  it("finds direct children while standing on a branch point", () => {
    let document = createDocument("分支点");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const next = addMove(document, first.nodeId, { row: 7, col: 8 }); document = next.document;
    expect(findVisibleVariationTarget(document, first.nodeId, { row: 7, col: 8 })?.target.id).toBe(next.nodeId);
  });

  it("creates an independent editable copy and sanitizes unloaded references", () => {
    const source = createDocument("动态数据库");
    source.nodes[source.rootId].children = ["missing"];
    source.nodes[source.rootId].preferredChildId = "missing";
    const marker = Symbol("readonly-view");
    Object.defineProperty(source, marker, { value: true });

    const copy = createEditableViewCopy(source, source.rootId, { token: "test", now: "2026-08-28T00:00:00.000Z" });

    expect(copy.id).toBe(`${source.id}-study-test`);
    expect(copy.metadata.title).toBe("动态数据库 · 编辑副本");
    expect(copy.nodes[source.rootId].children).toEqual([]);
    expect(copy.nodes[source.rootId].preferredChildId).toBeUndefined();
    expect((copy as unknown as Record<PropertyKey, unknown>)[marker]).toBeUndefined();
  });
});
