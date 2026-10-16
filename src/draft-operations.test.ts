import { describe, expect, it } from "vitest";
import { applyDraftToDocument, buildBatchReplaceOperations, draftOperationLabel, emptyDraft, hasDraft, pushDraft, redoDraft, undoDraft } from "./draft-operations";
import { createDocument, addMove } from "./game";

/**
 * 批量替换改为走草稿之后的可撤销性（audit 2026-09-17）。
 *
 * 以前 `runBatchReplace` 直接 `saveToLibrary` 落库——替换错了没有任何回退路径。
 * 现在它产出 `update-node` 操作交给各份棋谱自己的草稿，所以这里要盯住两件事：
 * ① 替换只动命中文字的节点，其余节点不许出现空操作；
 * ② 这些操作进草稿后，撤销能把注释**逐字**还原。
 */

const docWithComments = () => {
  const base = createDocument("批量替换用例");
  const first = addMove(base, base.rootId, { row: 7, col: 7 });
  const second = addMove(first.document, first.nodeId, { row: 8, col: 8 });
  const document = {
    ...second.document,
    nodes: {
      ...second.document.nodes,
      [base.rootId]: { ...second.document.nodes[base.rootId], comment: "待复核：开局", boardText: "待复核" },
      [first.nodeId]: { ...second.document.nodes[first.nodeId], comment: "这手不错" },
      [second.nodeId]: { ...second.document.nodes[second.nodeId], comment: "待复核：收束" },
    },
  };
  return { document, rootId: base.rootId, firstId: first.nodeId, secondId: second.nodeId };
};

describe("批量替换注释走草稿", () => {
  it("只给命中文字的节点产出操作，命中注释与局面文字", () => {
    const { document, rootId, firstId, secondId } = docWithComments();
    const operations = buildBatchReplaceOperations(document.nodes, "待复核", "已确认");
    expect(operations).toHaveLength(2);
    const ids = operations.map((op) => op.type === "update-node" ? op.nodeId : "");
    expect(ids).toContain(rootId);
    expect(ids).toContain(secondId);
    // 没命中文字的节点不该出现在操作里（否则会产生一堆空操作，撤销要点很多下）。
    expect(ids).not.toContain(firstId);
    const rootPatch = operations.find((op) => op.type === "update-node" && op.nodeId === rootId);
    expect(rootPatch && rootPatch.type === "update-node" ? rootPatch.patch : null).toMatchObject({ comment: "已确认：开局", boardText: "已确认" });
  });

  it("清空替换目标等于删除文字", () => {
    const { document } = docWithComments();
    const operations = buildBatchReplaceOperations(document.nodes, "待复核", "");
    const patch = operations[0].type === "update-node" ? operations[0].patch : null;
    expect(patch).toMatchObject({ comment: "：开局" });
  });

  it("查找词为空时不产出任何操作（不误伤）", () => {
    const { document } = docWithComments();
    expect(buildBatchReplaceOperations(document.nodes, "", "X")).toEqual([]);
  });

  it("没有命中时产出空数组", () => {
    const { document } = docWithComments();
    expect(buildBatchReplaceOperations(document.nodes, "不存在的词", "X")).toEqual([]);
  });

  it("替换结果进草稿后，撤销能逐字还原原注释", () => {
    const { document, rootId } = docWithComments();
    const operations = buildBatchReplaceOperations(document.nodes, "待复核", "已确认");

    // 模拟 App：把操作推进草稿 → 应用 → 撤销。
    const draft = operations.reduce((state, operation) => pushDraft(state, operation), emptyDraft());
    expect(hasDraft(draft)).toBe(true);
    const applied = applyDraftToDocument(document, draft.operations);
    expect(applied.nodes[rootId].comment).toBe("已确认：开局");

    // 撤销是「一次一步」——两个节点被改过，所以要点两次才回到原样。
    const undone = undoDraft(undoDraft(draft));
    const restored = applyDraftToDocument(document, undone.operations);
    expect(restored.nodes[rootId].comment).toBe("待复核：开局");
    expect(restored.nodes[rootId].boardText).toBe("待复核");
    // 撤销到底之后草稿应为空——这时「保存」不会再写任何东西。
    expect(hasDraft(undone)).toBe(false);
  });

  it("撤销后可重做（redo 语义不被批量替换破坏）", () => {
    const { document, rootId } = docWithComments();
    const operations = buildBatchReplaceOperations(document.nodes, "待复核", "已确认");
    const draft = operations.reduce((state, operation) => pushDraft(state, operation), emptyDraft());
    const redone = redoDraft(undoDraft(draft));
    const applied = applyDraftToDocument(document, redone.operations);
    expect(applied.nodes[rootId].comment).toBe("已确认：开局");
  });
});

// 撤销历史面板要显示「第 N 步 · 改注释」这样的人话，靠的就是这个标签函数。
describe("草稿操作的人话名字", () => {
  it("落子带坐标", () => {
    const label = draftOperationLabel({ type: "add-move", parentId: "p", node: { id: "n", parentId: "p", children: [], move: { row: 7, col: 7, player: "black" } } as never }, 15);
    expect(label).toContain("落子");
    expect(label).toContain("H8");
  });

  it("区分改注释 / 清空注释 / 改标注 / 改局面文字", () => {
    expect(draftOperationLabel({ type: "update-node", nodeId: "n", patch: { comment: "有内容" } })).toBe("改注释");
    expect(draftOperationLabel({ type: "update-node", nodeId: "n", patch: { comment: "" } })).toBe("清空注释");
    expect(draftOperationLabel({ type: "update-node", nodeId: "n", patch: { boardText: "文字" } })).toBe("改局面文字");
    expect(draftOperationLabel({ type: "update-node", nodeId: "n", patch: { marks: [] } })).toBe("改棋盘标注");
    expect(draftOperationLabel({ type: "update-node", nodeId: "n", patch: { evaluation: "good" } })).toBe("改评价");
  });

  it("删除/粘贴分支与切换主线都有名字", () => {
    expect(draftOperationLabel({ type: "delete-subtree", parentId: "p", rootId: "r" })).toBe("删除分支");
    expect(draftOperationLabel({ type: "set-mainline", parentId: "p", childId: "c" })).toBe("切换主分支");
    expect(draftOperationLabel({ type: "add-subtree", parentId: "p", rootId: "r", nodes: { r: {} as never, x: {} as never } })).toContain("2 个局面");
  });

  it("连续撤销 N 步能精确回到某一点（历史面板跳步的依据）", () => {
    const { document, rootId } = docWithComments();
    const ops = buildBatchReplaceOperations(document.nodes, "待复核", "已确认");
    let draft = ops.reduce((state, op) => pushDraft(state, op), emptyDraft());
    expect(draft.operations).toHaveLength(2);
    // 回到「第 1 步之后」＝ 保留 1 个操作。
    let keep = 1;
    const total = draft.operations.length;
    while (draft.operations.length > keep) draft = undoDraft(draft);
    expect(draft.operations).toHaveLength(keep);
    expect(applyDraftToDocument(document, draft.operations).nodes[rootId].comment).toBe("已确认：开局");
    expect(total).toBe(2);
  });
});
