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

  it("导出范围不丢标注：当前变化只留那条线、当前局面把标注带到静态局面上（2026-09-19 补）", () => {
    const { document, first, main, branch } = sample();
    const withMarks = {
      ...document,
      nodes: {
        ...document.nodes,
        [first]: { ...document.nodes[first], marks: [{ row: 3, col: 3, kind: "circle" as const, style: "circle" as const, color: "#2872b8", label: "主线标注" }] },
        [branch]: { ...document.nodes[branch], marks: [{ row: 4, col: 4, kind: "triangle" as const, style: "triangle" as const }] },
      },
    };

    // 当前变化（从 main 起）：保留这条线上的标注，另一分支的节点不进文件
    const variation = createVariationExportDocument(withMarks, main, "2026-08-30T00:00:00.000Z");
    expect(Object.values(variation.nodes).some((node) => node.id === branch)).toBe(false);
    const firstInVariation = Object.values(variation.nodes).find((node) => node.move?.row === 7 && node.move.col === 7);
    expect(firstInVariation?.marks?.[0]?.label).toBe("主线标注");
    expect(firstInVariation?.marks?.[0]?.color).toBe("#2872b8");

    // 当前局面（停在分支那一手）：标注跟着走到静态局面的根节点上
    const position = createPositionExportDocument(withMarks, branch, "2026-08-30T00:00:00.000Z");
    const root = position.nodes[position.rootId];
    expect(root.marks?.map((mark) => `${mark.kind}@${mark.row},${mark.col}`)).toEqual(["triangle@4,4"]);
    expect(root.setup?.black.length).toBeGreaterThan(0);
  });
});
