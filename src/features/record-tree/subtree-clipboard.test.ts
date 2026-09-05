import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "../../game";
import type { GameDocument } from "../../types";
import { copyRecordSubtree, pasteRecordSubtree } from "./subtree-clipboard";

const branchedDocument = () => {
  let document = createDocument("复制测试");
  const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
  const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
  const third = addMove(document, second.nodeId, { row: 8, col: 7 }); document = third.document;
  const sibling = addMove(document, first.nodeId, { row: 8, col: 8 }); document = sibling.document;
  document = {
    ...document,
    nodes: {
      ...document.nodes,
      [second.nodeId]: { ...document.nodes[second.nodeId], comment: "主变化", boardText: "研究 A", evaluation: "good" },
      [third.nodeId]: { ...document.nodes[third.nodeId], comment: "多层后续" },
    },
  };
  return { document, firstId: first.nodeId, secondId: second.nodeId, thirdId: third.nodeId, siblingId: sibling.nodeId };
};

describe("record subtree clipboard", () => {
  it("copies one branch and a multi-level subtree with fresh independent ids", () => {
    const { document: original, secondId, thirdId } = branchedDocument();
    const targetBranch = addMove(original, original.rootId, { row: 6, col: 6 });
    const document = targetBranch.document;
    const clipboard = copyRecordSubtree(document, secondId, [{ id: "b", nodeId: thirdId, title: "深层", note: "备注", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" }]);
    expect(clipboard).not.toBeNull();
    const result = pasteRecordSubtree(document, targetBranch.nodeId, clipboard!, { makeId: (_id, index) => `copy-${index}`, now: "2026-08-30T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.nodes)).toHaveLength(2);
    expect(result.document.nodes["copy-0"].comment).toBe("主变化");
    expect(result.document.nodes["copy-1"].comment).toBe("多层后续");
    expect(result.document.nodes["copy-0"].children).toEqual(["copy-1"]);
    expect(result.bookmarks[0].nodeId).toBe("copy-1");
    expect(document.nodes[secondId].id).toBe(secondId);
    expect(document.nodes[secondId].parentId).not.toBe(targetBranch.nodeId);
  });

  it("rejects duplicate direct moves and occupied descendants", () => {
    const { document, firstId, secondId, thirdId } = branchedDocument();
    const duplicate = pasteRecordSubtree(document, firstId, copyRecordSubtree(document, secondId)!);
    expect(duplicate).toEqual(expect.objectContaining({ ok: false, code: "duplicate" }));

    const clipboard = copyRecordSubtree(document, secondId)!;
    const conflicting: GameDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        [clipboard.rootId]: { ...clipboard.nodes[clipboard.rootId], children: [thirdId] },
      },
    };
    const target = addMove(document, document.rootId, { row: 8, col: 7 }).document;
    const targetChildren = target.nodes[target.rootId].children;
    const occupied = pasteRecordSubtree(target, targetChildren[targetChildren.length - 1], copyRecordSubtree(conflicting, secondId)!);
    expect(occupied.ok).toBe(false);
  });

  it("rejects out-of-bounds, wrong-turn and renju forbidden moves", () => {
    const { document, secondId, siblingId } = branchedDocument();
    const clipboard = copyRecordSubtree(document, secondId)!;
    clipboard.nodes[secondId].move = { row: 99, col: 0, player: "black" };
    expect(pasteRecordSubtree(document, siblingId, clipboard)).toEqual(expect.objectContaining({ ok: false, code: "out-of-bounds" }));

    const wrongTurn = copyRecordSubtree(document, secondId)!;
    wrongTurn.nodes[secondId].move = { ...wrongTurn.nodes[secondId].move!, player: "black" };
    expect(pasteRecordSubtree(document, siblingId, wrongTurn)).toEqual(expect.objectContaining({ ok: false, code: "wrong-player" }));

    const forbiddenDoc = createDocument("禁手");
    forbiddenDoc.metadata.rule = "renju";
    // A synthetic target position where H8 is an overline for black.
    const root = forbiddenDoc.nodes[forbiddenDoc.rootId];
    root.setup = { black: [2, 3, 4, 5, 6].map((col) => ({ row: 7, col })), white: [], empty: [], nextPlayer: "black" };
    const source = createDocument("来源");
    const move = addMove(source, source.rootId, { row: 7, col: 7 });
    const forbiddenClipboard = copyRecordSubtree(move.document, move.nodeId)!;
    expect(pasteRecordSubtree(forbiddenDoc, forbiddenDoc.rootId, forbiddenClipboard)).toEqual(expect.objectContaining({ ok: false, code: "forbidden" }));
  });
});
