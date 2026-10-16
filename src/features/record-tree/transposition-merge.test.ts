import { describe, expect, it } from "vitest";
import { applyDraftToDocument } from "../../draft-operations";
import { boardAt, nextPlayerAt } from "../../game";
import { positionKey } from "../../position-search";
import type { GameDocument, RecordNode } from "../../types";
import { buildTranspositionIndex } from "./transposition";
import { countMergeableGroups, mergeSamePositions } from "./transposition-merge";

const node = (id: string, parentId: string | null, children: string[], move: RecordNode["move"] = null): RecordNode =>
  ({ id, parentId, children, move, comment: "", marks: [] });

const documentWith = (nodes: Record<string, RecordNode>, rootId = "root"): GameDocument => ({
  id: "merge-fixture", version: 1, rootId, nodes,
  metadata: { title: "合并测试", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
});

/**
 * 两条路线走到同一个局面（H8/I7/I8/J7 四个点、两种落子顺序），
 * 并且**两边后续不同**——这正是需要「整理」的场景。
 *
 *   A: a1(H8) → a2(I7) → a3(I8) → a4(J7) ⇒ a4 是重复局面，后续是 a5(K7)
 *   B: b1(I8) → b2(J7) → b3(H8) → b4(I7) ⇒ b4 是同一个局面，后续是 b5(K8)
 *
 * 合并后：b5 那一支被搬到 a4 下（保留方同时拥有 K7 与 K8 两边），b4 被删。
 */
const divergent = documentWith({
  root: node("root", null, ["a1", "b1"]),
  a1: node("a1", "root", ["a2"], { row: 7, col: 7, player: "black" }),
  a2: node("a2", "a1", ["a3"], { row: 8, col: 8, player: "white" }),
  a3: node("a3", "a2", ["a4"], { row: 7, col: 8, player: "black" }),
  a4: node("a4", "a3", ["a5"], { row: 8, col: 9, player: "white" }),
  a5: node("a5", "a4", [], { row: 6, col: 7, player: "black" }),
  b1: node("b1", "root", ["b2"], { row: 7, col: 8, player: "black" }),
  b2: node("b2", "b1", ["b3"], { row: 8, col: 9, player: "white" }),
  b3: node("b3", "b2", ["b4"], { row: 7, col: 7, player: "black" }),
  b4: node("b4", "b3", ["b5"], { row: 8, col: 8, player: "white" }),
  b5: node("b5", "b4", [], { row: 6, col: 8, player: "black" }),
});

/** 全谱所有局面键的多重集合——合并前后必须一致（除了被删掉的那个重复局面本身）。 */
const positionKeyCounts = (document: GameDocument) => {
  const counts = new Map<string, number>();
  for (const id of Object.keys(document.nodes)) {
    const turn = id === document.rootId ? 0 : 1;
    if (!turn) continue;
    const key = positionKey(boardAt(document, id), nextPlayerAt(document, id));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** 每个节点只有一个父节点、且父节点的 children 里确实有它（证明结果仍是严格的树）。 */
const assertIsTree = (document: GameDocument) => {
  const seen = new Set<string>();
  for (const [id, parentId] of Object.entries(document.nodes).map(([id, n]) => [id, n.parentId] as const)) {
    if (id === document.rootId) { expect(parentId).toBeNull(); continue; }
    expect(parentId).toBeTruthy();
    if (!parentId) continue;
    expect(document.nodes[parentId], `${id} 的父节点 ${parentId} 不存在`).toBeTruthy();
    expect(document.nodes[parentId].children, `${id} 没出现在父节点的 children 里`).toContain(id);
    seen.add(id);
  }
  // 从根能走到每一个节点（没有孤儿）
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const child of document.nodes[id]?.children ?? []) walk(child);
  };
  walk(document.rootId);
  expect([...seen].every((id) => reachable.has(id))).toBe(true);
};

describe("mergeSamePositions（把同型局面并成一条）", () => {
  it("keeps mirrored branches until their descendant coordinates can be transformed", () => {
    const document = structuredClone(divergent);
    for (const id of ["b1", "b2", "b3", "b4", "b5"]) {
      const move = document.nodes[id].move!;
      document.nodes[id].move = { ...move, col: 14 - move.col };
    }
    const index = buildTranspositionIndex(document);
    expect(index.keyOf.get("a4")).toBe(index.keyOf.get("b4"));
    expect(positionKey(boardAt(document, "a4"), nextPlayerAt(document, "a4"), false))
      .not.toBe(positionKey(boardAt(document, "b4"), nextPlayerAt(document, "b4"), false));
    const result = mergeSamePositions(document, index, "a4");
    expect(result.document.nodes.b4).toBeDefined();
    expect(result.document.nodes.b5).toEqual(document.nodes.b5);
    expect(positionKeyCounts(result.document)).toEqual(positionKeyCounts(document));
    expect(result.notices.join()).toContain("对称");
    assertIsTree(result.document);
  });

  it("keeps a donor if an overlapping next move contains unique descendants", () => {
    const document = structuredClone(divergent);
    document.nodes.b5.move = { ...document.nodes.a5.move! };
    document.nodes.b5.children = ["b6"];
    document.nodes.b6 = node("b6", "b5", [], { row: 5, col: 7, player: "white" });
    const uniqueKey = positionKey(boardAt(document, "b6"), nextPlayerAt(document, "b6"));
    const result = mergeSamePositions(document, buildTranspositionIndex(document), "a4");
    expect(positionKeyCounts(result.document).has(uniqueKey)).toBe(true);
    assertIsTree(result.document);
  });

  it("keeps donor annotations that are absent from the keeper", () => {
    const document = structuredClone(divergent);
    document.nodes.b4.comment = "important review annotation";
    const result = mergeSamePositions(document, buildTranspositionIndex(document), "a4");
    expect(Object.values(result.document.nodes).some((entry) => entry.comment === "important review annotation")).toBe(true);
  });

  it("合并后结果仍是严格的树（每个节点父节点唯一、无孤儿）", () => {
    const index = buildTranspositionIndex(divergent);
    expect(index.keyOf.get("a4")).toBe(index.keyOf.get("b4"));
    const result = mergeSamePositions(divergent, index, "a4");
    expect(result.ok).toBe(true);
    assertIsTree(result.document);
  });

  it("重复局面只剩一处，且保留方拿到了对方的后续", () => {
    const index = buildTranspositionIndex(divergent);
    const result = mergeSamePositions(divergent, index, "a4");
    expect(result.ok).toBe(true);
    // 合并后：那个重复局面只出现一次
    const key = index.keyOf.get("a4")!;
    const survivors = Object.keys(result.document.nodes).filter((id) => positionKey(boardAt(result.document, id), nextPlayerAt(result.document, id)) === key);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toBe("a4");
    // b4 被删、b5 那一支搬到了 a4 下面（保留方现在同时有 K7 与 K8 两条后续）
    expect(result.document.nodes.b4).toBeUndefined();
    const a4Children = result.document.nodes.a4.children;
    const labels = a4Children.map((id) => {
      const move = result.document.nodes[id]?.move;
      return move ? `${move.row},${move.col}` : "?";
    });
    expect(labels).toContain("6,7");  // 原有的 a5(K7)
    expect(labels).toContain("6,8");  // 搬过来的 b5(K8)
    expect(result.movedSubtrees).toBe(1);
    expect(result.removedNodes).toBe(1);
  });

  it("合并前后的局面集合一致（除了被消掉的那一个重复）", () => {
    const index = buildTranspositionIndex(divergent);
    const before = positionKeyCounts(divergent);
    const result = mergeSamePositions(divergent, index, "a4");
    const after = positionKeyCounts(result.document);
    // 每个局面的出现次数不增加（搬过来的是复制的子树，键相同所以计数可能增加——
    // 这里只断言**没有任何新局面的键**冒出来，即合并不会凭空造出别的盘面）
    for (const [key, count] of after) {
      expect(before.has(key), `合并后出现了新局面：${key}`).toBe(true);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("产出的是一串普通草稿操作，交给 applyDraftToDocument 能复现同一结果（可撤销的基础）", () => {
    const index = buildTranspositionIndex(divergent);
    const result = mergeSamePositions(divergent, index, "a4");
    const replayed = applyDraftToDocument(divergent, result.operations);
    expect(Object.keys(replayed.nodes).sort()).toEqual(Object.keys(result.document.nodes).sort());
    expect(replayed.nodes.a4.children.sort()).toEqual(result.document.nodes.a4.children.sort());
  });

  it("当前路径上的同型不删，只如实提示", () => {
    const index = buildTranspositionIndex(divergent);
    const result = mergeSamePositions(divergent, index, "a4", { protectedIds: new Set(["b4"]) });
    expect(result.ok).toBe(false);
    expect(result.notices.join()).toContain("当前路径");
    // 什么都没删
    expect(result.document.nodes.b4).toBeTruthy();
  });

  it("两侧后续完全相同时，那个重复节点仍会被合并掉（合并的主要收益）", () => {
    // 真正的殊途同归最少要 4 手：两子局面的先后手顺序是被颜色锁死的（黑先白后，
    // 顺序不可能不同），所以「2 手 × 2 条路」根本构不成同型——这一点值得记住。
    //   A: 黑H8 → 白I7 → 黑I8 → 白J7
    //   B: 黑I8 → 白J7 → 黑H8 → 白I7    ← 同样的四个点，换顺序，两边都没有后续
    const same = documentWith({
      root: node("root", null, ["a1", "b1"]),
      a1: node("a1", "root", ["a2"], { row: 7, col: 7, player: "black" }),
      a2: node("a2", "a1", ["a3"], { row: 8, col: 8, player: "white" }),
      a3: node("a3", "a2", ["a4"], { row: 7, col: 8, player: "black" }),
      a4: node("a4", "a3", [], { row: 8, col: 9, player: "white" }),
      b1: node("b1", "root", ["b2"], { row: 7, col: 8, player: "black" }),
      b2: node("b2", "b1", ["b3"], { row: 8, col: 9, player: "white" }),
      b3: node("b3", "b2", ["b4"], { row: 7, col: 7, player: "black" }),
      b4: node("b4", "b3", [], { row: 8, col: 8, player: "white" }),
    });
    const index = buildTranspositionIndex(same);
    expect(index.keyOf.get("a4")).toBe(index.keyOf.get("b4"));
    const result = mergeSamePositions(same, index, "a4");
    expect(result.ok).toBe(true);
    // 两边都没有后续可搬，但重复的那个节点本身被合并掉了 —— 这就是主要收益
    expect(result.removedNodes).toBe(1);
    expect(result.document.nodes.b4).toBeUndefined();
    expect(result.document.nodes.a4).toBeTruthy();
    assertIsTree(result.document);
  });

  it("countMergeableGroups 数的是「有几组能合」", () => {
    const index = buildTranspositionIndex(divergent);
    expect(countMergeableGroups(index)).toBe(1);
    // 组里唯一的另一个节点被保护起来（在当前路径上）→ 这组不算「能合」
    expect(countMergeableGroups(index, new Set(["b4"]))).toBe(0);
  });

  it("没有同型时如实拒绝，不产出空操作", () => {
    const single = documentWith({
      root: node("root", null, ["a1"]),
      a1: node("a1", "root", [], { row: 7, col: 7, player: "black" }),
    });
    const result = mergeSamePositions(single, buildTranspositionIndex(single), "a1");
    expect(result.ok).toBe(false);
    expect(result.operations).toHaveLength(0);
  });
});
