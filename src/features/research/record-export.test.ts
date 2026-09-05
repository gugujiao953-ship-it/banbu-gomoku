import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "../../game";
import { createPositionExportDocument, createVariationExportDocument } from "./record-export";

const sample = () => {
  let document = createDocument("导出范围测试");
  const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
  const main = addMove(document, first.nodeId, { row: 7, col: 8 }); document = main.document;
  const branch = addMove(document, first.nodeId, { row: 8, col: 8 }); document = branch.document;
  const tail = addMove(document, main.nodeId, { row: 8, col: 7 }); document = tail.document;
  return { document, first: first.nodeId, main: main.nodeId, branch: branch.nodeId, tail: tail.nodeId };
};

describe("record export scopes", () => {
  it("exports only the selected variation and keeps one child per node", () => {
    const { document, main, branch, tail } = sample();
    const exported = createVariationExportDocument(document, main, "2026-08-30T00:00:00.000Z");
    expect(exported.nodes[main].children).toEqual([tail]);
    expect(exported.nodes[document.rootId].children).toHaveLength(1);
    expect(exported.nodes[branch]).toBeUndefined();
    expect(exported.savedCurrentId).toBe(tail);
    expect(exported.metadata.title).toContain("当前变化");
  });

  it("exports the current board as a setup position without move history", () => {
    const { document, main } = sample();
    const exported = createPositionExportDocument(document, main, "2026-08-30T00:00:00.000Z");
    const root = exported.nodes[exported.rootId];
    expect(Object.keys(exported.nodes)).toHaveLength(1);
    expect(root.move).toBeNull();
    expect(root.setup?.black).toEqual([{ row: 7, col: 7 }]);
    expect(root.setup?.white).toEqual([{ row: 7, col: 8 }]);
    expect(root.setup?.nextPlayer).toBe("black");
    expect(exported.metadata.sourceFormat).toBeUndefined();
  });
});
