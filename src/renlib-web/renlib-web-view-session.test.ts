// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameDocument } from "../types";
import { RenLibWebViewSession } from "./renlib-web-view-session";

/**
 * 「分支的后续在树里没有」修复（群友 2026-10-10 报：
 * 九天指南 / 丘月败10.db / 花月黑必胜地毯.lib 打谱看得见、分支树里没有）。
 *
 * 根因：LIB 的投影只为**当前路径**逐层向核心查询，路径之外的分支一律建成
 * `children: []` 的死端——它们的后续在树里根本不存在（原始 LIB 里其实还有整棵子树）。
 * 修法：给未查过的分支挂 `unloadedChildren` 标记，并新增 `loadBranch(nodeId)`
 * 按需把那一支查回来、回推新投影。
 *
 * 这里把核心（`RenLibWebSession`）换成假对象，只验证最容易错的**接线与 id 解析**：
 *  · 未查过的分支要有「还有后续」标记；
 *  · `loadBranch` 能从节点 id 反解出正确 idx 路径去问核心
 *    （`base.id` 自带连字符，直接 split('-') 会把 `renlib` 当 hex 解析成 NaN——
 *     这是实测抓到过的坑：调用返回 true 却一个子节点都没长出来）；
 *  · 查过的分支在投影里长出子节点。
 */

type FakeBranch = { idx: number; txt?: string; color?: string };
type FakeResult = { nodes: FakeBranch[]; innerHTML?: string };

const idx = (row: number, col: number) => row * 15 + col;

const makeCore = (table: Record<string, FakeResult>) => ({
  calls: [] as number[][],
  open: vi.fn(async () => ({ parameter: { autoMove: [] } })),
  branches: vi.fn(async (path: number[]) => {
    (makeCore as unknown as { last?: number[][] });
    return table[path.join("-")] ?? { nodes: [] };
  }),
  autoMove: vi.fn(async () => [] as number[]),
  convertToSgf: vi.fn(async () => new ArrayBuffer(0)),
  close: vi.fn(),
});

/** 用假核心建一个视图会话（核心是 private，但实现上就是直接 new 出来赋值的）。
 *  构造时会真去 new 一个 Worker，所以先把 Worker 打桩掉。 */
const sessionWith = (core: ReturnType<typeof makeCore>) => {
  vi.stubGlobal("Worker", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  });
  const session = new RenLibWebViewSession();
  (session as unknown as { core: unknown }).core = core;
  return session;
};

/** 从会话里取最新投影（private，测试内直接读；生产路径走 onUpdate 回推）。 */
const projectionOf = (session: RenLibWebViewSession): GameDocument =>
  (session as unknown as { projection(): { document: GameDocument } }).projection().document;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("RenLibWebViewSession 分支按需加载", () => {
  it("未查过的分支带「还有后续」标记，loadBranch 之后长出子节点", async () => {
    // H8(7,7) 之下的两个候选 I8(7,8) 与 H9(6,7)；I8 之下再有 J8(7,9)
    const core = makeCore({
      "": { nodes: [{ idx: idx(7, 7), txt: "H8" }], innerHTML: "根" },
      [String(idx(7, 7))]: { nodes: [{ idx: idx(7, 8), txt: "I8" }, { idx: idx(6, 7), txt: "H9" }] },
      [String(idx(7, 8))]: { nodes: [{ idx: idx(7, 9), txt: "J8" }] },
    });
    const session = sessionWith(core);
    const opened = await session.open(new File([new Uint8Array([1])], "t.lib"));

    const rootId = opened.document.rootId;
    const root = opened.document.nodes[rootId];
    const h8 = root.children.map((id) => opened.document.nodes[id]).find((node) => node?.boardText === "H8");
    expect(h8, "根下应有 H8 分支节点").toBeTruthy();
    // 还没问过核心 → 带未加载标记、没有子节点（这就是群友看到的「树里没有后续」）
    expect(h8!.unloadedChildren).toBe(1);
    expect(h8!.children).toEqual([]);

    // 按需加载（面板点「展开下一层」走的就是这条）
    expect(await session.loadBranch(h8!.id)).toBe(true);

    // 投影里 H8 下长出 I8 与 H9
    const after = projectionOf(session);
    const h8After = after.nodes[h8!.id];
    expect(h8After.children.length).toBe(2);
    expect(h8After.children.map((id) => after.nodes[id]?.boardText)).toEqual(["I8", "H9"]);
    // 查过了 → 不再带未加载标记
    expect(h8After.unloadedChildren).toBeUndefined();
  });

  it("id 反解要扛住 base.id/rootId 自带连字符（坑：把 renlib 当 hex 解析成 NaN）", async () => {
    const core = makeCore({
      "": { nodes: [{ idx: idx(7, 7), txt: "H8" }] },
      [String(idx(7, 7))]: { nodes: [{ idx: idx(7, 8), txt: "I8" }] },
    });
    const session = sessionWith(core);
    const opened = await session.open(new File([new Uint8Array([1])], "t.lib"));
    // base.id / rootId 都自带连字符（record-xxxx-yyyy / root-xxxx-yyyy）
    expect(opened.document.id).toMatch(/-/);
    expect(opened.document.rootId).toMatch(/-/);
    const root = opened.document.nodes[opened.document.rootId];
    const h8 = root.children.map((id) => opened.document.nodes[id]).find((node) => node?.boardText === "H8")!;
    // 根那一层的分支节点 id 形如 `<rootId>-branch-<hex>`——**没有 -renlib-**，
    // 这正是第一版 loadBranch 用 `-renlib-` 当锚点时解不出来的那种（单测当场抓到）。
    expect(h8.id).toContain("-branch-");
    expect(h8.id).not.toContain("-renlib-");

    expect(await session.loadBranch(h8.id)).toBe(true);
    // 真的问对了路径（就是 H8 那一格），而不是被 base.id/rootId 的碎片污染出的非法路径
    const asked = core.branches.mock.calls.map((call) => (call[0] as number[]).join("-"));
    expect(asked).toContain(String(idx(7, 7)));
    expect(asked.some((path) => path.includes("NaN"))).toBe(false);
  });

  /**
   * 按节点 id 导航（2026-10-11 P2）。修复前实测：lektion2/3 的旁支导航 6 个里 4 个抛
   * 「这个位置不在当前 RenLib 分支中」——因为 App 用**投影深度**去截 idx 路径，
   * 而旁支在投影里的层数 ≠ idx 序列长度。
   */
  it("moveToNodeId 能走到「旁支的旁支」——不靠投影深度换算", async () => {
    // H8(7,7) 之下两个候选 I8(7,8) 与 H9(6,7)；I8 之下再有 J8(7,9)
    // 键是**完整 idx 路径**（不是单个 idx）：H8 的路径是 `[112]`，I8 是 `[112,113]`
    const core = makeCore({
      "": { nodes: [{ idx: idx(7, 7), txt: "H8" }] },
      [String(idx(7, 7))]: { nodes: [{ idx: idx(7, 8), txt: "I8" }, { idx: idx(6, 7), txt: "H9" }] },
      [String(idx(7, 7)) + "-" + String(idx(7, 8))]: { nodes: [{ idx: idx(7, 9), txt: "J8" }] },
      [String(idx(7, 7)) + "-" + String(idx(7, 8)) + "-" + String(idx(7, 9))]: { nodes: [] },
    });
    const session = sessionWith(core);
    const opened = await session.open(new File([new Uint8Array([1])], "t.lib"));
    const root = opened.document.nodes[opened.document.rootId];
    const h8 = root.children.map((id) => opened.document.nodes[id]).find((node) => node?.boardText === "H8")!;

    // 展开 H8 → 长出 I8/H9；再展开 I8 → 长出 J8（这就是「旁支的旁支」）
    expect(await session.loadBranch(h8.id)).toBe(true);
    let doc = projectionOf(session);
    // 注意：每次 expand 都回推**新的** projection，节点对象要重新取（不能复用旧的引用）
    const h8Node = doc.nodes[h8.id];
    const i8 = h8Node.children.map((id) => doc.nodes[id]).find((node) => node?.boardText === "I8")!;
    expect(i8, "H8 展开后应有 I8").toBeTruthy();
    expect(await session.loadBranch(i8.id)).toBe(true);
    doc = projectionOf(session);
    const i8Node = doc.nodes[i8.id];
    const j8 = i8Node.children.map((id) => doc.nodes[id]).find((node) => node?.boardText === "J8");
    expect(j8, "I8 展开后应有 J8").toBeTruthy();

    // 按 id 走到 J8（不再需要任何深度参数）
    const moved = await session.moveToNodeId(j8!.id, j8!.move!);
    /**
     * 到达后这一手变成**主链节点**：id 形如 `<base.id>-renlib-70-71-72`
     * （idx 路径 `0x70,0x71,0x72`），而不再是导航前那个「旁支形态」的 id
     * （`<rootId>-branch-70-branch-71-branch-72`）。同一格、两种命名：
     * 落在当前路径上就是主链形，落在路径之外才是 branch 形——这正是两套 id 的分工。
     */
    expect(moved.currentId).toContain("-renlib-");
    expect(moved.currentId.endsWith([idx(7, 7), idx(7, 8), idx(7, 9)].map((v) => v.toString(16)).join("-"))).toBe(true);
    // 核心被问到的路径里必须有 I8 那一层的完整前缀（7,7 → 7,8）
    const asked = core.branches.mock.calls.map((call) => (call[0] as number[]).join("-"));
    expect(asked).toContain([idx(7, 7), idx(7, 8)].join("-"));
    // 走到的这一手确实是个真着法（坐标对得上 J8）
    const landed = moved.document.nodes[moved.currentId];
    expect(landed?.move).toMatchObject({ row: 7, col: 9 });
  });

  it("moveToNodeId 对认不出的 id 明确报错，不静默返回", async () => {
    const core = makeCore({ "": { nodes: [] } });
    const session = sessionWith(core);
    await session.open(new File([new Uint8Array([1])], "t.lib"));
    await expect(session.moveToNodeId("完全不相干的-id", { row: 1, col: 2 })).rejects.toThrow(/找不到/);
  });
});
