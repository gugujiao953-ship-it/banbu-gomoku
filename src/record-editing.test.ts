import { describe, expect, it } from "vitest";
import { addMove, boardAt, createDocument } from "./game";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, projectedDocument, pushDraft } from "./draft-operations";
import { createEditableViewCopy, findVisibleVariationTarget, renderableBoardVariationNodes, visibleBoardVariationNodes, visibleVariationPivot } from "./record-editing";
import type { RecordNode } from "./types";

describe("record editing bridge", () => {
  it("does not expose previous-ply siblings after reaching a leaf", () => {
    let document = createDocument("分支语义");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const left = addMove(document, first.nodeId, { row: 7, col: 8 }); document = left.document;
    const right = addMove(document, first.nodeId, { row: 6, col: 7 }); document = right.document;

    expect(visibleVariationPivot(document, left.nodeId)?.id).toBe(first.nodeId);
    expect(visibleBoardVariationNodes(document, left.nodeId).map((node) => node.id)).not.toContain(right.nodeId);
    expect(findVisibleVariationTarget(document, left.nodeId, { row: 6, col: 7 })).toBeUndefined();
    expect(findVisibleVariationTarget(document, left.nodeId, { row: 5, col: 7 })).toBeUndefined();
  });

  it("finds direct children while standing on a branch point", () => {
    let document = createDocument("分支点");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const next = addMove(document, first.nodeId, { row: 7, col: 8 }); document = next.document;
    expect(findVisibleVariationTarget(document, first.nodeId, { row: 7, col: 8 })?.target.id).toBe(next.nodeId);
  });

  it("shows only continuations from the current position", () => {
    let document = createDocument("分支点后续");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const left = addMove(document, first.nodeId, { row: 7, col: 8 }); document = left.document;
    const right = addMove(document, first.nodeId, { row: 6, col: 7 }); document = right.document;
    const leftNext = addMove(document, left.nodeId, { row: 8, col: 8 }); document = leftNext.document;

    expect(visibleBoardVariationNodes(document, left.nodeId).map((node) => node.id)).toEqual([leftNext.nodeId]);
    expect(visibleBoardVariationNodes(document, leftNext.nodeId).map((node) => node.id)).toEqual([]);
    expect(visibleBoardVariationNodes(document, left.nodeId).map((node) => node.id)).not.toContain(right.nodeId);
  });

  it("drops the previous position's alternatives after advancing another ply", () => {
    let document = createDocument("标注层级导航");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const left = addMove(document, first.nodeId, { row: 7, col: 8 }); document = left.document;
    const right = addMove(document, first.nodeId, { row: 6, col: 7 }); document = right.document;
    const leftNext = addMove(document, left.nodeId, { row: 8, col: 8 }); document = leftNext.document;
    const leftAlternative = addMove(document, left.nodeId, { row: 8, col: 7 }); document = leftAlternative.document;
    const continuation = addMove(document, leftNext.nodeId, { row: 9, col: 8 }); document = continuation.document;
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [right.nodeId]: { ...document.nodes[right.nodeId], boardText: "A", renLibNativeLabel: true },
        [leftAlternative.nodeId]: { ...document.nodes[leftAlternative.nodeId], boardText: "B", renLibNativeLabel: true },
        [continuation.nodeId]: { ...document.nodes[continuation.nodeId], boardText: "C", renLibNativeLabel: true },
      },
    };

    expect(visibleBoardVariationNodes(document, leftNext.nodeId).map((node) => node.id)).toEqual([continuation.nodeId]);
    expect(visibleBoardVariationNodes(document, leftNext.nodeId).map((node) => node.id)).not.toContain(leftAlternative.nodeId);
    expect(visibleBoardVariationNodes(document, leftNext.nodeId).map((node) => node.id)).not.toContain(right.nodeId);
  });

  it("applies the variation limit to current-position children", () => {
    let document = createDocument("变化数量上限");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const selected = addMove(document, first.nodeId, { row: 7, col: 8 }); document = selected.document;
    const child = addMove(document, selected.nodeId, { row: 8, col: 8 }); document = child.document;
    const secondChild = addMove(document, selected.nodeId, { row: 8, col: 7 }); document = secondChild.document;

    expect(visibleBoardVariationNodes(document, selected.nodeId, 1).map((node) => node.id)).toEqual([child.nodeId]);
    expect(visibleBoardVariationNodes(document, selected.nodeId, 1).map((node) => node.id)).not.toContain(secondChild.nodeId);
  });

  it("uses one coordinate target and ignores a sibling collision", () => {
    let document = createDocument("同点变化消歧");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const selected = addMove(document, first.nodeId, { row: 7, col: 8 }); document = selected.document;
    const sibling = addMove(document, first.nodeId, { row: 6, col: 7 }); document = sibling.document;
    const child = addMove(document, selected.nodeId, { row: 6, col: 7 }); document = child.document;

    expect(visibleBoardVariationNodes(document, selected.nodeId).map((node) => node.id)).toEqual([child.nodeId]);
    expect(visibleBoardVariationNodes(document, selected.nodeId).map((node) => node.id)).not.toContain(sibling.nodeId);
    expect(findVisibleVariationTarget(document, selected.nodeId, { row: 6, col: 7 })?.target.id).toBe(child.nodeId);
  });

  it("does not expose a board variation target on an occupied intersection", () => {
    let document = createDocument("占用点变化防护");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const selected = addMove(document, first.nodeId, { row: 7, col: 8 }); document = selected.document;
    const malformedId = "occupied-child";
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [selected.nodeId]: { ...document.nodes[selected.nodeId], children: [malformedId] },
        [malformedId]: { id: malformedId, parentId: selected.nodeId, children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
      },
    };
    const occupied = new Set<string>();
    boardAt(document, selected.nodeId).forEach((row, rowIndex) => row.forEach((player, colIndex) => {
      if (player) occupied.add(`${rowIndex},${colIndex}`);
    }));

    expect(visibleBoardVariationNodes(document, selected.nodeId).map((node) => node.id)).toEqual([malformedId]);
    expect(renderableBoardVariationNodes(document, selected.nodeId, occupied)).toEqual([]);
  });

  it("hides the previous position's branches after adding a local draft move", () => {
    let document = createDocument("导入谱分支编辑");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const left = addMove(document, first.nodeId, { row: 7, col: 8 }); document = left.document;
    const right = addMove(document, first.nodeId, { row: 6, col: 7 }); document = right.document;
    const previousPreferred = document.nodes[first.nodeId].preferredChildId;
    const draftNode: RecordNode = { id: "draft-local", parentId: first.nodeId, children: [], move: { row: 8, col: 7, player: "white" }, comment: "", marks: [] };
    const draft = pushDraft(emptyDraft(), { type: "add-move", parentId: first.nodeId, node: draftNode });
    const view = projectedDocument(document, buildDraftOverlay(draft, document));

    expect(visibleVariationPivot(view, draftNode.id)?.id).toBe(first.nodeId);
    expect(visibleBoardVariationNodes(view, draftNode.id)).toEqual([]);
    expect(findVisibleVariationTarget(view, draftNode.id, { row: 7, col: 8 })).toBeUndefined();
    expect(findVisibleVariationTarget(view, draftNode.id, { row: 6, col: 7 })).toBeUndefined();
    expect(visibleBoardVariationNodes(view, first.nodeId).map((node) => node.id)).toEqual([left.nodeId, right.nodeId, draftNode.id]);
    expect(findVisibleVariationTarget(view, first.nodeId, { row: 7, col: 8 })?.target.id).toBe(left.nodeId);
    expect(findVisibleVariationTarget(view, first.nodeId, { row: 6, col: 7 })?.target.id).toBe(right.nodeId);

    const committed = applyDraftToDocument(document, draft.operations);
    expect(committed.nodes[first.nodeId].children).toContain(draftNode.id);
    expect(committed.nodes[first.nodeId].preferredChildId).toBe(previousPreferred);
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
