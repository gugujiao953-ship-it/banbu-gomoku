import { describe, expect, it } from "vitest";
import type { GameDocument, RecordNode } from "../../types";
import { buildNodeSearchIndex, searchNodes } from "./node-search";

const metadata = { title: "搜索测试", black: "黑方", white: "白方", event: "", date: "2026-09-26", result: "", rule: "renju" as const, openingRule: "free" as const, boardSize: 15, tags: [] };

/** 一手一节点的直线谱 + 一条分支：方便断言「从近到远」。 */
const node = (id: string, parentId: string | null, children: string[], move: RecordNode["move"], extra: Partial<RecordNode> = {}): RecordNode =>
  ({ id, parentId, children, move, comment: "", marks: [], ...extra });

const document: GameDocument = {
  id: "search-doc", version: 1, rootId: "root", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
  metadata,
  nodes: {
    root: node("root", null, ["m1"], null),
    // H8 这一手既命中坐标也命中注释：必须合成一条（「下一个」不能在同一个节点上停两次）。
    m1: node("m1", "root", ["m2"], { row: 7, col: 7, player: "black" }, { comment: "双三开局，白棋要小心 H8 这里的交换" }),
    m2: node("m2", "m1", ["m3", "b1"], { row: 8, col: 8, player: "white" }, { marks: [{ row: 7, col: 7, kind: "triangle" }] }),
    m3: node("m3", "m2", [], { row: 9, col: 8, player: "black" }, { boardText: "必胜", comment: "白棋需要防守 J9" }),
    b1: node("b1", "m2", [], { row: 8, col: 9, player: "white" }),
  },
};
const overrides = { b1: "研究线 · 白棋反打" };
const index = buildNodeSearchIndex(document, overrides);

const ids = (query: string, anchorTurn = 0) => searchNodes(document, index, query, anchorTurn).map((hit) => hit.id);

describe("分支树搜索", () => {
  it("按手数搜：「41」「第41手」都认，且命中就是那一手", () => {
    // 第 3 手上有一个分叉（m3 与分支 b1），两处都算命中，按文档顺序排
    expect(ids("3")).toEqual(["m3", "b1"]);
    expect(ids("第 3 手")).toEqual(["m3", "b1"]);
    expect(ids("2")).toEqual(["m2"]);
    expect(ids("77")).toEqual([]);
  });

  it("按坐标搜，大小写不敏感", () => {
    expect(ids("h8")).toContain("m1");
    expect(ids("H8")).toContain("m1");
    // 越界坐标（路数之外的列）不当坐标解，只当普通文字处理
    expect(ids("P1")).toEqual([]);
  });

  it("在 30 路棋谱里接受双字母列坐标", () => {
    const big = {
      ...document,
      metadata: { ...metadata, boardSize: 30 },
      nodes: {
        ...document.nodes,
        root: { ...document.nodes.root, children: ["aa"] },
        aa: node("aa", "root", [], { row: 29, col: 26, player: "black" }),
      },
    } as GameDocument;
    const bigIndex = buildNodeSearchIndex(big);
    expect(searchNodes(big, bigIndex, "AA1", 0).map((hit) => hit.id)).toEqual(["aa"]);
    expect(searchNodes(big, bigIndex, "AD30", 0)).toEqual([]);
  });

  it("同一个节点同时命中坐标和注释时合成一条，kinds 里都列出来", () => {
    const hit = searchNodes(document, index, "H8", 0).find((item) => item.id === "m1");
    expect(hit?.kinds).toEqual(["coordinate", "comment"]);
    expect(searchNodes(document, index, "H8", 0).filter((item) => item.id === "m1")).toHaveLength(1);
  });

  it("按注释、盘面文字与分支名搜", () => {
    expect(ids("双三")).toEqual(["m1"]);
    expect(ids("必胜")).toEqual(["m3"]);
    expect(ids("研究线")).toEqual(["b1"]);
  });

  it("按标注搜：中文名、标注坐标、泛搜「标注」", () => {
    expect(ids("三角")).toEqual(["m2"]);
    expect(ids("标注")).toEqual(["m2"]);
    // 标注所在坐标也算命中（H8 上的三角标）
    const hit = searchNodes(document, index, "H8", 0).find((item) => item.id === "m2");
    expect(hit?.kinds).toEqual(["mark"]);
  });

  it("多个命中按「从近到远」排：离当前手越近越靠前", () => {
    // 「白棋」在 m1（第 1 手）的注释、m3（第 3 手）的注释、b1（第 3 手）的分支名里都出现；
    // 同样近的两处按手数先后排（m3 在 b1 之前）。
    expect(ids("白棋", 1)).toEqual(["m1", "m3", "b1"]);
    expect(ids("白棋", 3)).toEqual(["m3", "b1", "m1"]);
  });

  it("空查询不返回任何命中（避免刚打开就跳走）", () => {
    expect(searchNodes(document, index, "   ", 0)).toEqual([]);
  });

  it("索引按先序走完整棵树，手数连续", () => {
    expect(index.entries.map((entry) => `${entry.id}:${entry.turn}`)).toEqual(["root:0", "m1:1", "m2:2", "m3:3", "b1:3"]);
    expect(index.truncated).toBe(false);
  });
});
