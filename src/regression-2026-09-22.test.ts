import { describe, expect, it } from "vitest";
import { addMove, createDocument, nextPlayerAt, parseCoordinate, emptyBoard } from "./game";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, overlayNode, overlayPreferredChild, projectedDocument, pushDraft } from "./draft-operations";
import { exportSgf, importRecordFile } from "./formats";
import { findPositionMatches } from "./position-search";
import type { GameDocument, RecordNode } from "./types";

/**
 * 2026-09-22 缺陷回归。这里每一条都对应一个真实可复现的 bug，注释里写明
 * 「原来错在哪、用户看到什么」，防止以后重构把它改回去。
 */

const play = (document: GameDocument, from: string, row: number, col: number) => {
  const result = addMove(document, from, { row, col });
  return { document: result.document, id: result.nodeId };
};

/** 造一个「历史遗留」的兄弟分支：新枝排在 children 末尾，但父节点的
 * preferredChildId 仍指向旧枝。这正是真实编辑器里会出现的状态——用户先落了
 * H8（当时它是主线），后来又在同一节点下加了变化，children 顺序是「H8 在前、
 * 新枝在后」。用 withoutPreferred 控制是否连 preferredChildId 一起指向新枝，
 * 以便分别测「用户设过主线」和「用户没设过主线」两种情形。 */
const attachSibling = (
  document: GameDocument,
  parentId: string,
  row: number,
  col: number,
  player: "black" | "white",
  withoutPreferred = false,
) => {
  const id = `sib-${row}-${col}-${Math.random().toString(36).slice(2, 7)}`;
  const node: RecordNode = { id, parentId, children: [], move: { row, col, player }, comment: "", marks: [] };
  const parent = document.nodes[parentId];
  // withoutPreferred：把父节点已有的 preferredChildId 一并清掉，模拟「这条旧支
  // 不是谁指定的主线」。否则 addMove 留下的主线指针会一直在，掩盖要测的行为。
  const nextParent = withoutPreferred
    ? { ...parent, children: [...parent.children, id], preferredChildId: undefined }
    : { ...parent, children: [...parent.children, id], preferredChildId: id };
  return {
    document: { ...document, nodes: { ...document.nodes, [parentId]: nextParent, [id]: node } },
    id,
  };
};
describe("草稿落子必须成为主线（原来下一手会跳过自己刚落的子）", () => {
  it("overlayPreferredChild 认草稿里新落的那一手", () => {
    // 场景：根节点下已有 H8 这条支（它当时是主线）。用户在编辑副本里又落了一手
    // A1，这一手以草稿 add-move 的形式进来。因为 H8 的 preferredChildId 在
    // withSibling 里被清掉（等价于「这条旧支不是谁指定的主线」），新建的 A1
    // 必须成为主线——否则「下一手」会走回 H8，用户刚落的子被跳过。
    const base = createDocument("草稿主线");
    const first = play(base, base.rootId, 7, 7);
    const withSibling = attachSibling(first.document, first.document.rootId, 0, 0, "white", true);
    const draft = pushDraft(emptyDraft(), {
      type: "add-move",
      parentId: withSibling.document.rootId,
      node: { id: "draft-a1", parentId: withSibling.document.rootId, children: [], move: { row: 0, col: 0, player: "white" }, comment: "", marks: [] },
    });
    const overlay = buildDraftOverlay(draft, withSibling.document);
    const projected = projectedDocument(withSibling.document, overlay);
    expect(overlayPreferredChild(withSibling.document, overlay, withSibling.document.rootId)).toBe("draft-a1");
    expect(overlayNode(withSibling.document, overlay, withSibling.document.rootId)?.preferredChildId).toBe("draft-a1");
    expect(projected.nodes[withSibling.document.rootId]?.preferredChildId).toBe("draft-a1");
  });

  it("用户显式「设为主线」过的那一支仍然优先于新落子", () => {
    const base = createDocument("显式主线");
    const first = play(base, base.rootId, 7, 7);
    const withSibling = attachSibling(first.document, first.document.rootId, 0, 0, "white", true);
    let draft = pushDraft(emptyDraft(), { type: "set-mainline", parentId: withSibling.document.rootId, childId: first.id });
    draft = pushDraft(draft, {
      type: "add-move",
      parentId: withSibling.document.rootId,
      node: { id: "draft-a1", parentId: withSibling.document.rootId, children: [], move: { row: 0, col: 0, player: "white" }, comment: "", marks: [] },
    });
    const overlay = buildDraftOverlay(draft, withSibling.document);
    expect(overlayPreferredChild(withSibling.document, overlay, withSibling.document.rootId)).toBe(first.id);
  });

  it("保存草稿后主线落在新落的那一手（父节点此前没有主线时）", () => {
    // 场景：在编辑副本里从 H8 继续落一手 A1，A1 由草稿 add-move 带入。
    // H8 这个节点自己还没有 preferredChildId（它此前是叶子），保存后 A1 必须
    // 成为 H8 的主线，否则「下一手」会走不到刚落的子。
    const base = createDocument("保存主线");
    const first = play(base, base.rootId, 7, 7);
    expect(first.document.nodes[first.id].preferredChildId).toBeUndefined();
    const draft = pushDraft(emptyDraft(), {
      type: "add-move",
      parentId: first.id,
      node: { id: "draft-a1", parentId: first.id, children: [], move: { row: 0, col: 0, player: "white" }, comment: "", marks: [] },
    });
    const saved = applyDraftToDocument(first.document, draft.operations);
    expect(saved.nodes[first.id].children).toEqual(["draft-a1"]);
    expect(saved.nodes[first.id].preferredChildId).toBe("draft-a1");
  });

  it("保存草稿时，用户已固定的主线不被新落子顶掉", () => {
    const base = createDocument("保留固定主线");
    const first = play(base, base.rootId, 7, 7);
    const withSibling = attachSibling(first.document, first.document.rootId, 0, 0, "white");
    // 根节点已有两条分支，且 preferredChildId 指向 A1（白）。
    const draft = pushDraft(emptyDraft(), {
      type: "add-move",
      parentId: withSibling.document.rootId,
      node: { id: "draft-third", parentId: withSibling.document.rootId, children: [], move: { row: 0, col: 5, player: "black" }, comment: "", marks: [] },
    });
    const saved = applyDraftToDocument(withSibling.document, draft.operations);
    expect(saved.nodes[withSibling.document.rootId].preferredChildId).toBe(withSibling.id);
  });
});

describe("SGF 导出必须保住主线（原来导出再导入主变互换）", () => {
  it("设为主线过的第二支导出后排在文件里第一支", async () => {
    const base = createDocument("主线导出");
    const first = play(base, base.rootId, 7, 7);
    // 真实状态：「设为主线」只改 preferredChildId，不动 children 顺序。
    // 所以 children = [H8, A1]，而 preferredChildId 指向 A1（白棋）。
    const withSibling = attachSibling(first.document, first.document.rootId, 0, 0, "white");
    const sgf = exportSgf(withSibling.document);
    // 同级分支的先后以文件里出现的顺序为准：主线 aa 必须在旧支 hh 之前。
    expect(sgf.indexOf("[aa]")).toBeLessThan(sgf.indexOf("[hh]"));
    // 导出再导入后主线不能换：这正是原来丢的地方。
    const back = await importRecordFile(new File([sgf], "主线.sgf", { type: "application/x-go-sgf" }));
    const imported = back.document;
    const root = imported.nodes[imported.rootId];
    expect(root.preferredChildId).toBe(root.children[0]);
    expect(imported.nodes[root.children[0]].move).toMatchObject({ row: 0, col: 0 });
  });

  it("没有显式主线时保持原有 children 顺序（不改变既有行为）", () => {
    const base = createDocument("默认顺序");
    const first = play(base, base.rootId, 7, 7);
    const withSibling = attachSibling(first.document, first.document.rootId, 0, 0, "white", true);
    const sgf = exportSgf(withSibling.document);
    // H8 是 children[0]，没有 preferredChildId 指向 A1，所以顺序不变。
    expect(sgf.indexOf("[hh]")).toBeLessThan(sgf.indexOf("[aa]"));
  });
});

describe("坐标解析必须挡掉越界（原来 A0 会让棋盘渲染崩）", () => {
  it("A0 在 15 路上无效", () => {
    // 原实现只判 row >= 0，A0 算出 row = 15 = size，越界写进棋盘后渲染抛异常。
    expect(parseCoordinate("A0", 15)).toBeNull();
    expect(parseCoordinate("O0", 15)).toBeNull();
  });

  it("合法坐标仍然正常", () => {
    expect(parseCoordinate("A15", 15)).toEqual({ col: 0, row: 0 });
    expect(parseCoordinate("O1", 15)).toEqual({ col: 14, row: 14 });
    expect(parseCoordinate("H8", 15)).toEqual({ col: 7, row: 7 });
  });

  it("小棋盘上的边界同样挡住", () => {
    expect(parseCoordinate("A0", 9)).toBeNull();
    expect(parseCoordinate("A9", 9)).toEqual({ col: 0, row: 0 });
    expect(parseCoordinate("J1", 9)).toBeNull();
  });
});

describe("跨谱检索的行棋方要与 nextPlayerAt 一致", () => {
  it("setup.nextPlayer 优先于最后一手颜色（与 nextPlayerAt 同序）", () => {
    // 造一个「落子 + 显式声明轮谁走」的节点：题目预置局面与 SGF 的 PL[W] 都是这个形状。
    const base = createDocument("预置局面");
    const played = play(base, base.rootId, 7, 7);
    const document: GameDocument = {
      ...played.document,
      nodes: {
        ...played.document.nodes,
        [played.id]: { ...played.document.nodes[played.id], setup: { black: [], white: [], empty: [], nextPlayer: "black" } },
      },
    };
    // 棋盘上最后一手是黑，但节点声明该黑走（PL[B] 类局面，不合手序）。
    expect(nextPlayerAt(document, played.id)).toBe("black");
    const board = emptyBoard(15);
    board[7][7] = "black";
    // 原来 position-search 会推成 white，导致检索用错 nextPlayer、匹配不到。
    const matches = findPositionMatches([document], board, "black", false);
    expect(matches.some((match) => match.nodeId === played.id)).toBe(true);
    expect(findPositionMatches([document], board, "white", false).some((match) => match.nodeId === played.id)).toBe(false);
  });

  it("没有显式声明时，仍按最后一手颜色轮转", () => {
    const base = createDocument("普通落子");
    const played = play(base, base.rootId, 7, 7);
    expect(nextPlayerAt(played.document, played.id)).toBe("white");
    const board = emptyBoard(15);
    board[7][7] = "black";
    expect(findPositionMatches([played.document], board, "white", false).some((m) => m.nodeId === played.id)).toBe(true);
  });
});
