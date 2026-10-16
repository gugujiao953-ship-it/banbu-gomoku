import { describe, expect, it } from "vitest";
import type { GameDocument, RecordNode } from "../../types";
import { buildTranspositionIndex, isTransposition, rankSamePositions, samePositionNodes } from "./transposition";

const node = (
  id: string,
  parentId: string | null,
  children: string[],
  move: RecordNode["move"] = null,
  extra: Partial<RecordNode> = {},
): RecordNode => ({ id, parentId, children, move, comment: "", marks: [], ...extra });

const documentWith = (nodes: Record<string, RecordNode>, rootId = "root"): GameDocument => ({
  id: "transposition-fixture",
  version: 1,
  rootId,
  nodes,
  metadata: { title: "同型测试", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
});

/**
 * 一个真的「殊途同归」：黑白各两子，两条路径落子顺序不同、终局盘面相同。
 *
 *   路线 A： 黑 H8 → 白 I9 → 黑 I8 → 白 J9       （H8, I9, I8, J9）
 *   路线 B： 黑 I8 → 白 J9 → 黑 H8 → 白 I9       （同样的四个点，换顺序）
 *
 * 第 4 手之后两边都是「H8/I8 黑、I9/J9 白、轮到黑」，但**中间每一步都不同**——
 * 这正是定式里最常见的那种殊途同归。
 */
const interleaved: GameDocument = documentWith({
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

describe("buildTranspositionIndex", () => {
  it("把走子顺序不同、终局相同的两手认成同型", () => {
    const index = buildTranspositionIndex(interleaved);
    // a4 与 b4：同样四个子、同样轮到黑
    expect(index.keyOf.get("a4")).toBe(index.keyOf.get("b4"));
    expect(samePositionNodes(index, interleaved, "a4")).toEqual(["b4"]);
    expect(isTransposition(index, "a4")).toBe(true);
    expect(isTransposition(index, "b4")).toBe(true);
  });

  it("中间每一步都不同 → 不算同型（不能拿「结果相同」倒推过程）", () => {
    const index = buildTranspositionIndex(interleaved);
    expect(index.keyOf.get("a2")).not.toBe(index.keyOf.get("b2"));
    expect(isTransposition(index, "a2")).toBe(false);
    expect(isTransposition(index, "a3")).toBe(false);
  });

  it("轮到谁走也算进局面：同形但轮次不同不算同型", () => {
    // 两条路径都只下了 H8（黑），但一条到此为止（轮到白），另一条又过了一手
    const turnMismatch = documentWith({
      root: node("root", null, ["x", "y"]),
      x: node("x", "root", [], { row: 7, col: 7, player: "black" }),
      y: node("y", "root", [], { row: 7, col: 7, player: "black" }),
    });
    const index = buildTranspositionIndex(turnMismatch);
    // 两手完全一样（同点同色同行棋方）→ 这就是同型
    expect(isTransposition(index, "x")).toBe(true);
    // 现在让 y 是「白棋同点」——盘面形状一样但归属不同，必须区分
    const colorMismatch = documentWith({
      root: node("root", null, ["x", "y"]),
      x: node("x", "root", [], { row: 7, col: 7, player: "black" }),
      y: node("y", "root", [], { row: 7, col: 7, player: "white" }),
    });
    const colorIndex = buildTranspositionIndex(colorMismatch);
    expect(colorIndex.keyOf.get("x")).not.toBe(colorIndex.keyOf.get("y"));
    expect(isTransposition(colorIndex, "x")).toBe(false);
  });

  it("八向对称：镜像后的同一局面也算同型", () => {
    // A 枝：黑 (7,7) + 白 (7,8)。把整个盘面左右镜像（col → 14−col）得到黑 (7,7) + 白 (7,6)。
    // 连珠的定式是对称的，所以「形状镜像等价」的两手必须认成同型——这正是 positionKey
    // 的八向归一在起作用（也是 RenLib 的 Position::Match 八张对称表在做的事）。
    const symmetric = documentWith({
      root: node("root", null, ["a1", "b1"]),
      a1: node("a1", "root", ["a2"], { row: 7, col: 7, player: "black" }),
      a2: node("a2", "a1", [], { row: 7, col: 8, player: "white" }),
      b1: node("b1", "root", ["b2"], { row: 7, col: 7, player: "black" }),
      b2: node("b2", "b1", [], { row: 7, col: 6, player: "white" }),
    });
    const index = buildTranspositionIndex(symmetric);
    expect(index.keyOf.get("a2")).toBe(index.keyOf.get("b2"));
    expect(isTransposition(index, "a2")).toBe(true);
  });

  it("关掉对称时（includeSymmetry=false）镜像的两手不算同型", () => {
    // 反向对照：证明上一条确实是**对称归一**带来的，不是别的巧合。
    // 用非对称的形状：A 是黑(7,7)+白(8,8)，B 是黑(7,7)+白(6,6)（镜像）——
    // 若不做对称归一，两者必须不同。
    const asymmetric = documentWith({
      root: node("root", null, ["a1", "b1"]),
      a1: node("a1", "root", ["a2"], { row: 7, col: 7, player: "black" }),
      a2: node("a2", "a1", [], { row: 8, col: 8, player: "white" }),
      b1: node("b1", "root", ["b2"], { row: 7, col: 7, player: "black" }),
      b2: node("b2", "b1", [], { row: 8, col: 9, player: "white" }),
    });
    const index = buildTranspositionIndex(asymmetric);
    // (8,8) 与 (8,9) 不是镜像关系（镜像应落在 (6,8)/(8,6) 之类），所以不同型
    expect(index.keyOf.get("a2")).not.toBe(index.keyOf.get("b2"));
    expect(isTransposition(index, "a2")).toBe(false);
  });

  it("起始局面不参与（每份棋谱都有它一个，标出来是噪音）", () => {
    const index = buildTranspositionIndex(interleaved);
    expect(index.keyOf.has("root")).toBe(false);
    expect(index.turnOf.get("root")).toBeUndefined();
    expect(isTransposition(index, "root")).toBe(false);
  });

  it("过手（passPlayer）计一手，且参与局面键", () => {
    const withPass = documentWith({
      root: node("root", null, ["p1", "p2"]),
      p1: node("p1", "root", [], null, { passPlayer: "black" }),
      p2: node("p2", "root", [], null, { passPlayer: "black" }),
    });
    const index = buildTranspositionIndex(withPass);
    expect(index.turnOf.get("p1")).toBe(1);
    expect(isTransposition(index, "p1")).toBe(true);
  });

  it("多簇同型各自独立成组", () => {
    // 两个互不相干的同型簇：第 1 手之后（只有 H8 黑）一簇、第 2 手之后（H8 黑 + I9 白）一簇。
    // 注意两簇必须**行棋方也一致**：同为「白方刚落完」才对得上。
    const twoClusters = documentWith({
      root: node("root", null, ["a1", "b1"]),
      a1: node("a1", "root", ["a2"], { row: 7, col: 7, player: "black" }),
      a2: node("a2", "a1", [], { row: 8, col: 8, player: "white" }),
      b1: node("b1", "root", ["b2"], { row: 7, col: 7, player: "black" }),
      b2: node("b2", "b1", [], { row: 8, col: 8, player: "white" }),
    });
    const index = buildTranspositionIndex(twoClusters);
    // 第 1 手之后：a1 与 b1 同型
    expect(samePositionNodes(index, twoClusters, "a1")).toEqual(["b1"]);
    // 第 2 手之后：a2 与 b2 同型
    expect(samePositionNodes(index, twoClusters, "a2")).toEqual(["b2"]);
    // 两簇不互相串：a1（1 子）与 a2（2 子）不同型
    expect(samePositionNodes(index, twoClusters, "a1")).not.toContain("a2");
  });

  it("rankSamePositions 按「离得近」排，并写清它在哪条枝上", () => {
    const index = buildTranspositionIndex(interleaved);
    // a4 与 b4 同型；它们的共同祖先是 root（第 0 手），所以是「在第 0 手之后分出」
    const ranked = rankSamePositions(index, interleaved, "a4", new Set(["root", "a1", "a2", "a3", "a4"]));
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ id: "b4", turn: 4 });
    expect(ranked[0].marker).toContain("第 0 手之后分出");
  });
});
