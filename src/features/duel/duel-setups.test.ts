// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { GameDocument, RecordNode } from "../../types";
import { emptyBoard } from "../../game";
import {
  DUEL_SETUPS_KEY,
  DUEL_SETUP_LIMIT,
  addDuelSetup,
  defaultSetupName,
  lineOnlyDocument,
  lineStoneCount,
  loadDuelSetups,
  positionAlreadyDecided,
  removeDuelSetup,
  renameDuelSetup,
} from "./duel-setups";

const node = (id: string, parentId: string | null, children: string[], move: RecordNode["move"]): RecordNode =>
  ({ id, parentId, children, move, comment: "", marks: [] });

const black = (id: string, row: number, col: number) => node(id, null, [], { row, col, player: "black" });

/**
 * 一棵有分支的谱：
 *   root → b1 → w1 → b2 → w2   （主线，游标可停在 w2）
 *              └→ wB            （白棋的另一手，b1 的第二个孩子）
 */
const tree = (over: Partial<GameDocument> = {}): GameDocument => ({
  id: "doc-1", version: 1, rootId: "root",
  nodes: {
    root: node("root", null, ["b1", "wB"], null),
    b1: { ...black("b1", 7, 7), parentId: "root", children: ["w1"] },
    w1: node("w1", "b1", ["b2"], { row: 7, col: 8, player: "white" }),
    b2: node("b2", "w1", ["w2"], { row: 8, col: 7, player: "black" }),
    w2: node("w2", "b2", [], { row: 8, col: 8, player: "white" }),
    wB: node("wB", "b1", [], { row: 6, col: 6, player: "white" }),
  },
  metadata: { title: "测试局", black: "", white: "", event: "", date: "", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] },
  createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", ...over,
});

describe("局面剪成单线", () => {
  it("剪到主线末端：分支与根上那条旁支整个删掉，链保持完整", () => {
    const cut = lineOnlyDocument(tree(), "w2");
    expect(Object.keys(cut.nodes).sort()).toEqual(["b1", "b2", "root", "w1", "w2"]);
    expect(cut.nodes.root.children).toEqual(["b1"]);
    expect(cut.nodes.b1.children).toEqual(["w1"]);
    expect(cut.nodes.w2.children).toEqual([]);
    expect(cut.nodes.b1.preferredChildId).toBe("w1");
    expect(cut.savedCurrentId).toBe("w2");
  });

  it("剪到旁支：主线那几手同样不保留（保留的是**游标所在那一条**）", () => {
    const cut = lineOnlyDocument(tree(), "wB");
    expect(Object.keys(cut.nodes).sort()).toEqual(["b1", "root", "wB"]);
    expect(cut.nodes.root.children).toEqual(["b1"]);
    expect(cut.nodes.b1.children).toEqual(["wB"]);
  });

  it("不碰原谱（返回新对象、原 nodes 还在）", () => {
    const source = tree();
    lineOnlyDocument(source, "w2");
    expect(source.nodes.wB).toBeTruthy();
    expect(source.nodes.root.children).toEqual(["b1", "wB"]);
  });

  it("链上手数按节点重算（导入后报「几手」用的就是它）", () => {
    expect(lineStoneCount(tree(), "w2")).toBe(4);
    expect(lineStoneCount(tree(), "wB")).toBe(2);
    expect(lineStoneCount(tree(), "root")).toBe(0);
  });

  it("坏游标（不在根下 / 成环）与只到根：一律原样返回，不剪出半截谱", () => {
    const source = tree();
    expect(lineOnlyDocument(source, "ghost")).toBe(source);
    const loopA = node("a", "b", [], { row: 1, col: 1, player: "black" });
    const loopB = node("b", "a", [], { row: 1, col: 2, player: "white" });
    const cyclic = tree({ nodes: { root: node("root", null, ["a"], null), a: loopA, b: loopB } });
    expect(lineOnlyDocument(cyclic, "a").nodes).toBe(cyclic.nodes);
    expect(Object.keys(lineOnlyDocument(source, "root").nodes)).toContain("wB");
  });
});

describe("局面库存储", () => {
  beforeEach(() => localStorage.clear());

  /** 落盘形态的条目（带 id/savedAt）——`addDuelSetup` 会补这两个，直接写 localStorage 时要自己给。 */
  const entry = (name: string, currentId = "w2") => {
    const document = lineOnlyDocument(tree(), currentId);
    return { id: `setup-${name}`, savedAt: 1_700_000_000_000, name, document, currentId, stones: 4, boardSize: 15 };
  };

  it("存进去的能读回来，新条目排在最前", () => {
    expect(addDuelSetup(entry("第一份"))).toHaveLength(1);
    addDuelSetup(entry("第二份"));
    const list = loadDuelSetups();
    expect(list.map((item) => item.name)).toEqual(["第二份", "第一份"]);
    expect(list[1].document.nodes.w2).toBeTruthy();
  });

  it("坏数据逐条丢，不牵连其余（缺文档 / 游标不在谱里 / 懒加载投影 / 名字空）", () => {
    const good = entry("好的一份");
    localStorage.setItem(DUEL_SETUPS_KEY, JSON.stringify([
      good,
      { id: "x1", name: "没棋谱", document: null, currentId: "w2", stones: 4, boardSize: 15 },
      { ...entry("游标不存在"), currentId: "ghost" },
      { ...entry("懒加载投影"), document: { ...good.document, partial: true } },
      { ...entry("   "), name: "   " },
    ]));
    expect(loadDuelSetups().map((item) => item.name)).toEqual(["好的一份"]);
  });

  it("手数按链重算，不信任存进去的数字（列表不许显示假手数）", () => {
    addDuelSetup({ ...entry("谎报 99 手"), stones: 99 });
    expect(loadDuelSetups()[0].stones).toBe(4);
  });

  it("超过上限丢最旧的，最新的一定留得住", () => {
    for (let i = 0; i < DUEL_SETUP_LIMIT + 5; i += 1) addDuelSetup(entry(`局面 ${i}`));
    const list = loadDuelSetups();
    expect(list).toHaveLength(DUEL_SETUP_LIMIT);
    expect(list[0].name).toBe(`局面 ${DUEL_SETUP_LIMIT + 4}`);
  });

  it("改名与删除；空名字不改", () => {
    addDuelSetup(entry("原名"));
    const id = loadDuelSetups()[0].id;
    expect(renameDuelSetup(id, "  ")).toBeNull();
    expect(renameDuelSetup(id, "  塔拉山口黑5  ")?.[0].name).toBe("塔拉山口黑5");
    expect(removeDuelSetup(id)).toHaveLength(0);
  });

  it("默认名：有标题就沿用并补手数，没标题按第几手叫", () => {
    const document = lineOnlyDocument(tree(), "w2");
    expect(defaultSetupName(document, "w2", 4)).toBe("测试局 · 4 手");
    expect(defaultSetupName({ ...document, metadata: { ...document.metadata, title: "  " } }, "w2", 7)).toBe("局面 · 第 7 手");
  });
});

describe("已分生死的局面不能当开局", () => {
  const boardOf = (marks: [number, number, "black" | "white"][]) => {
    const board = emptyBoard(15);
    marks.forEach(([row, col, player]) => { board[row][col] = player; });
    return board;
  };

  it("空盘与四连都不算；横/竖/斜任一方向连成五子就判「已下完」", () => {
    expect(positionAlreadyDecided(emptyBoard(15), "freestyle")).toBe(false);
    expect(positionAlreadyDecided(boardOf([[7, 3, "black"], [7, 4, "black"], [7, 5, "black"], [7, 6, "black"]]), "freestyle")).toBe(false);
    expect(positionAlreadyDecided(boardOf([[7, 3, "black"], [7, 4, "black"], [7, 5, "black"], [7, 6, "black"], [7, 7, "black"]]), "freestyle")).toBe(true);
    expect(positionAlreadyDecided(boardOf([[2, 2, "white"], [3, 3, "white"], [4, 4, "white"], [5, 5, "white"], [6, 6, "white"]]), "renju")).toBe(true);
  });

  it("有禁手下黑长连（六连）不算赢，所以不当作已分生死", () => {
    const six = [[7, 2], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7]].map(([row, col]) => [row, col, "black"] as [number, number, "black"]);
    expect(positionAlreadyDecided(boardOf(six), "renju")).toBe(false);
    expect(positionAlreadyDecided(boardOf(six), "freestyle")).toBe(true);
  });
});
