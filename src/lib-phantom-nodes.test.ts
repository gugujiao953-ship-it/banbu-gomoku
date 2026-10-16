import { describe, expect, it } from "vitest";
import { nonMoveKeysFromLibDocument, stripLibPhantomNodes } from "./lib-mark-annotations";
import { createDocument, addMove } from "./game";
import type { GameDocument } from "./types";

/** 造一份「一手真着法 + 一个空点标注节点」的文档（正是我们自己导出 LIB 的形态）。 */
const buildWithMarkNode = () => {
  let doc = createDocument("phantom");
  const first = addMove(doc, doc.rootId, { row: 7, col: 7 });
  doc = first.document;
  const markId = `${first.nodeId}-mark-3-3`;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [first.nodeId]: { ...doc.nodes[first.nodeId], children: [...doc.nodes[first.nodeId].children, markId] },
      [markId]: { id: markId, parentId: first.nodeId, children: [], move: null, anchor: { row: 3, col: 3 }, comment: "", marks: [], boardText: "○" },
    },
  } as GameDocument;
  return { doc, firstId: first.nodeId, markId };
};

describe("LIB 幻影着法剔除", () => {
  it("认出非着法节点（父着法序列|坐标）", () => {
    const { doc } = buildWithMarkNode();
    expect([...nonMoveKeysFromLibDocument(doc)]).toEqual(["7,7|3,3"]);
  });

  it("lib2sgf 把非着法节点写成着法时，按键把它剔掉", () => {
    const { doc, firstId } = buildWithMarkNode();
    const keys = nonMoveKeysFromLibDocument(doc);
    // 模拟核心转换结果：同一坐标变成一手棋（叶子）
    const converted: GameDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [firstId]: { ...doc.nodes[firstId], children: [...doc.nodes[firstId].children, "phantom"] },
        phantom: { id: "phantom", parentId: firstId, children: [], move: { row: 3, col: 3, player: "white" }, comment: "", marks: [] },
      },
    };
    const cleaned = stripLibPhantomNodes(converted, keys);
    expect(cleaned.removed).toBe(1);
    expect(cleaned.document.nodes.phantom).toBeUndefined();
    expect(cleaned.document.nodes[firstId].children).not.toContain("phantom");
    // 我们自己的标注节点（非着法）本来就不是着法，不在剔除范围内
    expect(nonMoveKeysFromLibDocument(cleaned.document).size).toBe(1);
  });

  it("坐标命中但**有子节点**的真着法不误删", () => {
    const { doc, firstId } = buildWithMarkNode();
    const keys = nonMoveKeysFromLibDocument(doc);
    const real: GameDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [firstId]: { ...doc.nodes[firstId], children: [...doc.nodes[firstId].children, "real"] },
        real: { id: "real", parentId: firstId, children: ["next"], move: { row: 3, col: 3, player: "white" }, comment: "", marks: [] },
        next: { id: "next", parentId: "real", children: [], move: { row: 4, col: 4, player: "black" }, comment: "", marks: [] },
      },
    };
    expect(stripLibPhantomNodes(real, keys).removed).toBe(0);
  });

  it("空键集合直接原样返回（不白跑一趟）", () => {
    const { doc } = buildWithMarkNode();
    expect(stripLibPhantomNodes(doc, new Set()).removed).toBe(0);
  });
});
