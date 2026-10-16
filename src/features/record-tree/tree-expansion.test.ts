import { describe, expect, it } from "vitest";
import { buildCompactRenLibIndex, createLazyDocument } from "../../compact-index";
import type { GameDocument, RecordNode } from "../../types";
import { assignTreeRows, recordMainLineIds, remainingLayersOf, treeLongestChainIds } from "./tree-expansion";

const node = (id: string, parentId: string | null, children: string[], player: "black" | "white" = "black", index = 0): RecordNode => ({
  id, parentId, children,
  move: parentId ? { row: 7, col: 7, player } : null,
  comment: "", marks: [],
});

const documentWith = (nodes: Record<string, RecordNode>, rootId = "root"): GameDocument => ({
  id: "tree-expansion-fixture",
  version: 1,
  rootId,
  nodes,
  metadata: { title: "扩展测试", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
});

// root ─ a ─ a1                     (短支)
//      └ b ─ b1 ─ b2 ─ b3 ─ b4      (最长)
const branching = documentWith({
  root: node("root", null, ["a", "b"]),
  a: node("a", "root", ["a1"], "black"),
  a1: node("a1", "a", [], "white"),
  b: node("b", "root", ["b1"], "white"),
  b1: node("b1", "b", ["b2"], "black"),
  b2: node("b2", "b1", ["b3"], "white"),
  b3: node("b3", "b2", ["b4"], "black"),
  b4: node("b4", "b3", [], "white"),
});

describe("treeLongestChainIds", () => {
  it("follows the deepest line even when it is not the first child", () => {
    expect([...treeLongestChainIds(branching)]).toEqual(["root", "b", "b1", "b2", "b3", "b4"]);
  });

  it("keeps the first child when two lines are equally long", () => {
    const tied = documentWith({
      root: node("root", null, ["a", "b"]),
      a: node("a", "root", ["a1"], "black"),
      a1: node("a1", "a", [], "white"),
      b: node("b", "root", ["b1"], "white"),
      b1: node("b1", "b", [], "black"),
    });
    expect([...treeLongestChainIds(tied)]).toEqual(["root", "a", "a1"]);
  });

  it("stops on a single node record", () => {
    expect([...treeLongestChainIds(documentWith({ root: node("root", null, []) }))]).toEqual(["root"]);
  });

  it("ignores dangling child ids and survives cycles", () => {
    const broken = documentWith({
      root: node("root", null, ["a", "missing"]),
      a: node("a", "root", ["root"], "black"),
    });
    expect([...treeLongestChainIds(broken)]).toEqual(["root", "a"]);
  });

  it("returns the same line for a lazy compact record", () => {
    const index = buildCompactRenLibIndex(branching);
    const { id, version, rootId, metadata, createdAt, updatedAt } = branching;
    const lazy = createLazyDocument({ id, version, rootId, metadata, createdAt, updatedAt }, index);
    expect([...treeLongestChainIds(lazy)]).toEqual(["root", "b", "b1", "b2", "b3", "b4"]);
  });
});

describe("recordMainLineIds", () => {
  it("falls back to the tallest child when no preferred child is set", () => {
    expect([...recordMainLineIds(branching)]).toEqual(["root", "b", "b1", "b2", "b3", "b4"]);
  });

  it("follows the preferred branch even when a taller one exists（设为主分支的语义）", () => {
    // root 的两支：a 只有 2 手、b 有 5 手；设了 preferred 指向 a 后主线必须走 a
    const preferred: GameDocument = {
      ...branching,
      nodes: { ...branching.nodes, root: { ...branching.nodes.root, preferredChildId: "a" } },
    };
    expect([...recordMainLineIds(preferred)]).toEqual(["root", "a", "a1"]);
    expect([...treeLongestChainIds(preferred)]).toEqual(["root", "b", "b1", "b2", "b3", "b4"]);
  });

  it("walks the preferred chain for a lazy compact record", () => {
    const preferred: GameDocument = {
      ...branching,
      nodes: { ...branching.nodes, root: { ...branching.nodes.root, preferredChildId: "a" } },
    };
    const index = buildCompactRenLibIndex(preferred);
    const { id, version, rootId, metadata, createdAt, updatedAt } = preferred;
    const lazy = createLazyDocument({ id, version, rootId, metadata, createdAt, updatedAt }, index);
    expect([...recordMainLineIds(lazy)]).toEqual(["root", "a", "a1"]);
  });
});

describe("assignTreeRows（子树连续分区）", () => {
  it("keeps single-child continuations on one horizontal lane", () => {
    const entries = [{ id: "root", parentId: null }, { id: "a", parentId: "root" }, { id: "b", parentId: "a" }];
    expect([...assignTreeRows(entries).values()]).toEqual([0, 0, 0]);
  });
  it("reserves a sibling's entire subtree before placing the next sibling", () => {
    const entries = [
      { id: "root", parentId: null }, { id: "a", parentId: "root" },
      { id: "a1", parentId: "a" }, { id: "a2", parentId: "a" },
      { id: "a21", parentId: "a2" }, { id: "a22", parentId: "a2" },
      { id: "b", parentId: "root" }, { id: "b1", parentId: "b" }, { id: "b2", parentId: "b" },
    ];
    const rows = assignTreeRows(entries);
    const aRows = ["a", "a1", "a2", "a21", "a22"].map((id) => rows.get(id)!);
    const bRows = ["b", "b1", "b2"].map((id) => rows.get(id)!);
    expect(Math.max(...aRows)).toBeLessThan(Math.min(...bRows));
    expect(rows.get("a")).toBe(rows.get("a1"));
    expect(rows.get("a2")).toBe(rows.get("a21"));
    expect(rows.get("a22")!).toBeGreaterThan(rows.get("a21")!);
  });
  it("gives wide forks separate lanes and supports children before their parent", () => {
    const entries = [{ id: "root", parentId: null }, ...Array.from({ length: 100 }, (_, i) => ({ id: "b" + i, parentId: "root" }))];
    const rows = assignTreeRows(entries);
    expect(new Set(entries.slice(1).map((entry) => rows.get(entry.id))).size).toBe(100);
    expect(Math.min(...rows.values())).toBe(0);
    for (let i = 1; i < 100; i += 1) expect(rows.get("b" + i)! - rows.get("b" + (i - 1))!).toBeGreaterThanOrEqual(1);
    expect(assignTreeRows([...entries.slice(1), entries[0]])).toEqual(rows);
  });
  it("handles a deep chain iteratively", () => {
    const entries = Array.from({ length: 12000 }, (_, i) => ({ id: "n" + i, parentId: i ? "n" + (i - 1) : null }));
    const rows = assignTreeRows(entries);
    expect(rows.size).toBe(12000);
    expect(rows.get("n11999")).toBe(0);
  });
});

/**
 * 「展开下一层」最多还能点几次（群友 2026-10-11：「一个分支点不开，但可以一直点，
 * 收回分支那里加到 50」）。旧实现每点一次无条件 +1 —— 遇到「按钮亮着但点了不产出」
 * （库里那一支其实没有后续）就会一路涨。上界＝已加载子树的高度。
 */
describe("remainingLayersOf（展开次数的上界）", () => {
  const node = (id: string, parentId: string | null, children: string[], extra: Partial<RecordNode> = {}): RecordNode =>
    ({ id, parentId, children, move: null, comment: "", marks: [], ...extra });

  it("沿最长那一支数层数：3 层就是最多点 3 次", () => {
    // root ─ a ─ b ─ c     （3 层）
    //      └ d            （1 层）
    const document = documentWith({
      root: node("root", null, ["a", "d"]),
      a: node("a", "root", ["b"]),
      b: node("b", "a", ["c"]),
      c: node("c", "b", []),
      d: node("d", "root", []),
    });
    expect(remainingLayersOf(document, "root")).toBe(3);
    expect(remainingLayersOf(document, "a")).toBe(2);
    expect(remainingLayersOf(document, "b")).toBe(1);
    expect(remainingLayersOf(document, "c")).toBe(0);
  });

  it("叶子返回 0：按钮据此禁用，不会再「点了没反应却一直能点」", () => {
    const document = documentWith({
      root: node("root", null, ["only"]),
      only: node("only", "root", []),
    });
    expect(remainingLayersOf(document, "only")).toBe(0);
  });

  it("子树里还有未读回来的分支 → Infinity（高度未知，允许继续点）", () => {
    // 懒加载源：a 还没问过库里有没有后续，所以高度算不出来
    const document = documentWith({
      root: node("root", null, ["a"]),
      a: node("a", "root", []),
    });
    const withUnloaded: GameDocument = {
      ...document,
      nodes: { ...document.nodes, a: { ...document.nodes.a, unloadedChildren: 3 } },
    };
    expect(remainingLayersOf(withUnloaded, "a")).toBe(Number.POSITIVE_INFINITY);
    // 祖先也算「未知」——不然在 root 上点展开会在读到一半时被顶死
    expect(remainingLayersOf(withUnloaded, "root")).toBe(Number.POSITIVE_INFINITY);
  });

  it("读回来之后高度自己变准（不依赖任何额外同步）", () => {
    const base = documentWith({
      root: node("root", null, ["a"]),
      a: node("a", "root", ["b"]),
      b: node("b", "a", []),
    });
    const unknown: GameDocument = { ...base, nodes: { ...base.nodes, a: { ...base.nodes.a, children: [], unloadedChildren: 2 } } };
    expect(remainingLayersOf(unknown, "a")).toBe(Number.POSITIVE_INFINITY);
    // 模拟「读回来了」：标记清掉、孩子进树 → 高度立刻变准
    expect(remainingLayersOf(base, "a")).toBe(1);
  });

  it("坏数据（环 / 悬空 id）不炸，返回有限值", () => {
    const cyclic = documentWith({
      root: node("root", null, ["a"]),
      a: node("a", "root", ["root"]),   // 指回祖先
    });
    expect(remainingLayersOf(cyclic, "root")).toBe(2);
    const dangling = documentWith({ root: node("root", null, ["missing"]) });
    expect(remainingLayersOf(dangling, "root")).toBe(1);
    expect(remainingLayersOf(dangling, "nonexistent")).toBe(0);
  });
});
