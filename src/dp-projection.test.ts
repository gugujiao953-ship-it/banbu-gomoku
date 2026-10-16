import { describe, expect, it } from "vitest";
import { buildDpProjection, dpKeyToPath, dpPathKey, isDpDatabaseView, type DpQuery } from "./dp-projection";
import type { GameDocument } from "./types";

const base: GameDocument = {
  id: "db-test",
  version: 1,
  rootId: "dp-root",
  nodes: {},
  metadata: { title: "局面库", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
};

const branch = (row: number, col: number, label: string, value: number) => ({ position: { row, col }, label, value });
const query = (comment: string, branches: DpQuery["branches"]): DpQuery => ({ comment, marks: [], branches });

// 根（空盘）分出 H8 与 G9；H8 下面又有 I8。G9 与 I8 都还没查过。
const cacheWith = (extra: Array<[string, DpQuery]> = []) => new Map<string, DpQuery>([
  ["", query("根注释", [branch(7, 7, "H8", -100), branch(6, 6, "G9", 50)])],
  ["77", query("H8 注释", [branch(7, 8, "I8", -200)])],
  ...extra,
]);

describe("dpPathKey / dpKeyToPath", () => {
  it("位置路径与键可以互相还原（节点 id 反解要用它）", () => {
    const path = [{ row: 7, col: 7 }, { row: 14, col: 0 }];
    expect(dpPathKey(path)).toBe("77-e0");
    expect(dpKeyToPath(dpPathKey(path))).toEqual(path);
    expect(dpKeyToPath("")).toEqual([]);
  });
});

describe("buildDpProjection", () => {
  it("把已加载的局面连成真树：子节点是已加载分支，未查过的只记数量", () => {
    const { document, currentId } = buildDpProjection({ base, path: [{ row: 7, col: 7 }], cache: cacheWith() });
    const root = document.nodes["dp-root"];
    const onPath = document.nodes["db-test-dp-77"];
    const sibling = document.nodes["db-test-dp-66"];

    expect(currentId).toBe("db-test-dp-77");
    expect(document.savedCurrentId).toBe("db-test-dp-77");
    expect(isDpDatabaseView(document)).toBe(true);
    // 只有已加载的局面才是节点：G9 与 I8 没查过 → 不建节点，只在父节点上记数量
    expect(Object.keys(document.nodes).sort()).toEqual(["db-test-dp-77", "dp-root"]);
    expect(root.children).toEqual(["db-test-dp-77"]);
    expect(root.unloadedChildren).toBe(1);
    expect(root.comment).toBe("根注释");
    // 已查过的能往下长一层，并且自己也有 1 支未加载
    expect(onPath.children).toEqual([]);
    expect(onPath.unloadedChildren).toBe(1);
    expect(onPath.comment).toBe("H8 注释");
    expect(sibling).toBeUndefined();
  });

  it("标签与手数落在正确的节点上，当前路径那一手是首选子", () => {
    const { document } = buildDpProjection({ base, path: [{ row: 7, col: 7 }], cache: cacheWith() });
    const root = document.nodes["dp-root"];
    const onPath = document.nodes["db-test-dp-77"];

    // 标签属于「父局面里的那一步」
    expect(onPath.boardText).toBe("H8");
    expect(root.boardText).toBeUndefined();
    // 手数 / 行棋方交替
    expect(onPath.move).toMatchObject({ row: 7, col: 7, player: "black" });
    expect(root.move).toBeNull();
    // 导航靠 preferredChildId：当前路径上的下一手优先（没加载子节点时为空）
    expect(root.preferredChildId).toBe("db-test-dp-77");
    expect(onPath.preferredChildId).toBeUndefined();
  });

  it("预取回推（缓存长大）后，未加载的枝变成已加载节点", () => {
    const grown = cacheWith([["66", query("G9 注释", [branch(5, 6, "F9", 20)])]]);
    const { document } = buildDpProjection({ base, path: [{ row: 7, col: 7 }], cache: grown });
    const root = document.nodes["dp-root"];
    const sibling = document.nodes["db-test-dp-66"];
    expect(sibling).toBeDefined();
    expect(sibling.comment).toBe("G9 注释");
    expect(root.children).toEqual(["db-test-dp-77", "db-test-dp-66"]);
    expect(root.unloadedChildren).toBeUndefined();
    // 它自己的子节点（F9）还没查过 → 只记数量
    expect(sibling.children).toEqual([]);
    expect(sibling.unloadedChildren).toBe(1);
    // 节点 id 不变，所以「我在哪」不受回推影响
    expect(document.savedCurrentId).toBe("db-test-dp-77");
  });

  it("路径为空时当前局面就是根，根的分支仍然画出来", () => {
    const { document, currentId } = buildDpProjection({ base, path: [], cache: cacheWith() });
    const root = document.nodes["dp-root"];
    expect(currentId).toBe("dp-root");
    expect(root.children).toEqual(["db-test-dp-77"]);
    expect(root.unloadedChildren).toBe(1);
    expect(root.preferredChildId).toBe("db-test-dp-77");
  });
});
