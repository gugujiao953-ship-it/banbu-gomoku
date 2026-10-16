// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameDocument, RecordNode } from "../../types";
import { buildCompactRenLibIndex, createLazyDocument } from "../../compact-index";
import { RecordTreePanel, type RecordTreePanelProps } from "./RecordTreePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const documentFixture: GameDocument = {
  id: "tree-drag-test",
  version: 1,
  rootId: "root",
  nodes: {
    root: { id: "root", parentId: null, children: ["child"], move: null, comment: "", marks: [] },
    child: { id: "child", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
  },
  metadata: { title: "拖拽测试", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

/** 合成触摸指针事件（jsdom 没有 PointerEvent，用 Event + defineProperties 补齐字段）。 */
const touchPointer = (kind: "down" | "move" | "up", pointerId: number, clientX: number, clientY: number) => {
  const type = kind === "down" ? "pointerdown" : kind === "move" ? "pointermove" : "pointerup";
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    buttons: { value: kind === "up" ? 0 : 1 },
  });
  return event;
};

/** 画布（.tree-canvas / .tree-node）在「图谱」标签页里，默认页是「记谱流」。 */
const openGraphTab = (host: HTMLElement) => {
  const tab = [...host.querySelectorAll<HTMLButtonElement>(".record-tree-tabs button")].find((button) => button.textContent?.includes("图谱"));
  act(() => tab?.click());
};

const panelProps = (overrides: Partial<RecordTreePanelProps> & Pick<RecordTreePanelProps, "document" | "currentId" | "path">): RecordTreePanelProps => ({
  bookmarks: [],
  clipboard: null,
  onLocate: vi.fn(),
  onCreateBranch: vi.fn(),
  onSetMainBranch: vi.fn(),
  onRenameBranch: vi.fn(),
  onDeleteBranch: vi.fn(),
  onCopy: vi.fn(),
  onCut: vi.fn(),
  onPaste: vi.fn(),
  onCancelCopy: vi.fn(),
  onToggleBookmark: vi.fn(),
  onEditBookmark: vi.fn(),
  onDeleteBookmark: vi.fn(),
  ...overrides,
});

describe("RecordTreePanel mobile canvas gestures", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  const renderPanel = (props: RecordTreePanelProps) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<RecordTreePanel {...props}/>);
    });
    openGraphTab(container);
  };

  const nodeLabels = () => [...container!.querySelectorAll(".tree-node")].map((node) => (node.getAttribute("aria-label") || "").split("，")[0]);
  const gridButton = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>(".tree-node-action-grid button")].find((button) => button.textContent?.includes(label))!;
  const clickNode = (labelPrefix: string) => {
    const node = [...container!.querySelectorAll<SVGGElement>(".tree-node")].find((item) => (item.getAttribute("aria-label") || "").startsWith(labelPrefix))!;
    act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };

  it("pans with one touch and does not select a node when dragging from it", () => {
    renderPanel(panelProps({ document: documentFixture, currentId: "root", path: [documentFixture.nodes.root] }));
    const svg = container!.querySelector<SVGSVGElement>(".tree-canvas")!;
    const child = container!.querySelector<SVGGElement>('[aria-label^="H8"]')!;
    const content = svg.querySelector<SVGGElement>(":scope > g")!;
    const captures = new Set<number>();
    Object.defineProperties(svg, {
      viewBox: { value: { baseVal: { x: 0, y: 0, width: 430, height: 240 } } },
      setPointerCapture: { value: (id: number) => captures.add(id) },
      hasPointerCapture: { value: (id: number) => captures.has(id) },
      releasePointerCapture: { value: (id: number) => captures.delete(id) },
      getBoundingClientRect: { value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 340, width: 300, height: 340, toJSON: () => ({}) }) },
    });

    // 打开时默认对准当前手（用户 09-20）：root 的方框中心落在画布中心
    // pan = 画布中心 - 节点中心 = (430/2-84, 180/2-66)；66 = 内容顶端留白 44 + 半个节点高 22
    expect(content.getAttribute("transform")).toBe("translate(131 24) scale(1)");
    act(() => child.dispatchEvent(touchPointer("down", 1, 100, 120)));
    act(() => child.dispatchEvent(touchPointer("move", 1, 145, 145)));
    act(() => child.dispatchEvent(touchPointer("up", 1, 145, 145)));

    expect(content.getAttribute("transform")).not.toBe("translate(131 24) scale(1)");
    expect(container!.querySelector('[aria-label^="起始局面"]')?.classList.contains("selected")).toBe(true);
    expect(child.classList.contains("selected")).toBe(false);

    act(() => child.dispatchEvent(touchPointer("down", 2, 145, 145)));
    act(() => child.dispatchEvent(touchPointer("up", 2, 145, 145)));
    expect(child.classList.contains("selected")).toBe(true);
  });

  it("shows local branch name overrides in tree nodes, action head and rename input", () => {
    renderPanel(panelProps({
      document: documentFixture,
      currentId: "child",
      path: [documentFixture.nodes.root, documentFixture.nodes.child],
      branchNameOverrides: { child: "斜月变化" },
    }));
    expect(container!.querySelector<SVGGElement>('[aria-label^="斜月变化"]')).toBeTruthy();
    expect(container!.querySelector(".tree-node-action-head b")?.textContent).toBe("斜月变化");

    const renameButton = [...container!.querySelectorAll("button")].find((button) => button.textContent?.includes("重命名"))!;
    act(() => renameButton.click());
    expect(container!.querySelector<HTMLInputElement>(".tree-inline-rename input")?.value).toBe("斜月变化");
  });

  const lazyDocumentFrom = (nodes: Record<string, RecordNode>, rootId: string) => {
    const source: GameDocument = { ...documentFixture, id: "tree-lazy-test", rootId, nodes };
    const { id, version, metadata, createdAt, updatedAt } = source;
    return createLazyDocument({ id, version, rootId, metadata, createdAt, updatedAt }, buildCompactRenLibIndex(source));
  };

  // 60s：这条用例要在 jsdom 里重画大谱几十次，单跑约 10s；全量并行时
  // 抢不到 CPU 会到 28s，撞上 20s 的全局上限假失败（同 vitest.config.ts 里 VCF 那批的口径）。
  it("keeps a large lazy record inside the node budget when expanding level by level", () => {
    // 2000 个节点的懒加载棋谱：默认视野保持轻量，逐层展开不会虚构未读取数据。
    const nodes: Record<string, RecordNode> = { lazyRoot: { id: "lazyRoot", parentId: null, children: ["lazy-0"], move: null, comment: "", marks: [] } };
    for (let index = 0; index < 2000; index += 1) {
      const children = index + 1 < 2000 ? [`lazy-${index + 1}`] : [];
      if (index % 40 === 39) children.push(`lazy-branch-${index}`);
      nodes[`lazy-${index}`] = { id: `lazy-${index}`, parentId: index === 0 ? "lazyRoot" : `lazy-${index - 1}`, children, move: { row: index % 15, col: Math.floor(index / 15) % 15, player: index % 2 ? "white" : "black" }, comment: "", marks: [] };
    }
    const lazyDocument = lazyDocumentFrom(nodes, "lazyRoot");
    renderPanel(panelProps({ document: lazyDocument, currentId: lazyDocument.rootId, path: [lazyDocument.nodes[lazyDocument.rootId]] }));

    const count = () => container!.querySelectorAll(".tree-node").length;
    const rendered = count();
    expect(rendered).toBeGreaterThan(1);
    expect(rendered).toBeGreaterThan(1);
    clickNode("起始局面");
    // 逐层往下点：点一次只多摊一层。
    const expandButton = () => [...container!.querySelectorAll<HTMLButtonElement>(".tree-node-action-grid button")].find((button) => button.textContent?.startsWith("展开下一层"));
    for (let step = 0; step < 20; step += 1) {
      const button = expandButton();
      if (!button || button.disabled) break;
      act(() => button.click());
      expect(count()).toBeGreaterThan(1);
    }
    act(() => gridButton("展开全部").click());
    expect(Number(container!.querySelector(".tree-viewport")?.getAttribute("data-layout-nodes"))).toBeGreaterThan(240);
    // 「收起全部」：回到只剩当前路径那一条线，比默认视野还少
    act(() => gridButton("收起全部").click());
    expect(count()).toBeLessThan(rendered);
  }, 60000);

  it("keeps the main line horizontal and puts a sibling in its own lane", () => {
    // Default and explicit expansion use the same layout; continuations stay flat.
    const forkDocument: GameDocument = {
      ...documentFixture,
      id: "tree-straight-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["child", "sibling"], move: null, comment: "", marks: [] },
        child: { id: "child", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        sibling: { id: "sibling", parentId: "root", children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: forkDocument, currentId: "root", path: [forkDocument.nodes.root] }));
    const edgePaths = () => [...container!.querySelectorAll(".tree-edges path")].map((path) => path.getAttribute("d")!);
    const yOf = (labelPrefix: string) => {
      const node = [...container!.querySelectorAll<SVGGElement>(".tree-node")].find((item) => (item.getAttribute("aria-label") || "").startsWith(labelPrefix))!;
      return Number((node.getAttribute("transform") || "").match(/translate\(([-\d.]+) ([-\d.]+)\)/)![2]);
    };
    // 默认视野只有主分支这一条线（用户 09-22：默认没有展开，兄弟一个都不露）。
    // 没有真树要长，就不需要腾地方，主线仍在最上面一行（y=66）。
    expect(edgePaths()).toEqual(["M 150 66 H 165 V 66 H 180"]);
    // Each sibling gets its own lane, with its fork stem in the column gutter.
    clickNode("起始局面");
    act(() => gridButton("展开下一层").click());
    const paths = edgePaths();
    expect(paths[0]).toBe("M 150 66 H 165 V 66 H 180");
    expect(paths[1]).toBe("M 150 66 H 165 V 144.3 H 180");
    // The first continuation remains horizontal; the sibling starts below it.
    const rootY = yOf("起始局面");
    const branchY = yOf("I8");
    expect(rootY).toBeLessThan(branchY);
  });

  it("shows only the main line by default and unfolds one level per click", () => {
    // 用户 09-22：① 默认只有主分支，次分支一个都不自动露（以前每叉自动露一条，
    // 看起来像「默认就给展开了一个子分支」）；② 展开/收起是**按层**的，
    // 点一次只多摊一层，再点才继续往下。
    const branchDocument: GameDocument = {
      ...documentFixture,
      id: "tree-reveal-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["m2", "s1", "s2"], preferredChildId: "m2", move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        m2: { id: "m2", parentId: "m1", children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        s1: { id: "s1", parentId: "m1", children: ["s1a", "s1b"], move: { row: 6, col: 7, player: "white" }, comment: "", marks: [] },
        s1a: { id: "s1a", parentId: "s1", children: [], move: { row: 5, col: 7, player: "black" }, comment: "", marks: [] },
        s1b: { id: "s1b", parentId: "s1", children: [], move: { row: 5, col: 8, player: "black" }, comment: "", marks: [] },
        s2: { id: "s2", parentId: "m1", children: [], move: { row: 8, col: 7, player: "white" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: branchDocument, currentId: "m2", path: [branchDocument.nodes.root, branchDocument.nodes.m1, branchDocument.nodes.m2] }));

    // 默认：只有当前路径（也是主分支）这一条线，两个次分支 H9/H7 一个都不露，
    // 「这里分了 3 支」只体现在徽标数字里。
    expect(nodeLabels()).toEqual(["起始局面", "H8", "I8"]);
    expect(container!.querySelector(".tree-branch-mark text")?.textContent).toBe("3");

    // 选中分叉点 H8，展开下一层：只摊开它下面这一层（H9/H7 出来，H9 的两个孩子还在里面）
    clickNode("H8");
    const grid = () => [...container!.querySelectorAll<HTMLButtonElement>(".tree-node-action-grid button")].map((button) => `${button.textContent}${button.disabled ? "(禁用)" : ""}`);
    expect(grid().some((text) => text.startsWith("展开下一层"))).toBe(true);
    act(() => gridButton("展开下一层").click());
    expect(nodeLabels()).toEqual(["起始局面", "H8", "I8", "H9", "H7"]);
    // 摊开出来的这一层走金色（主分支 I8 不算：它本来就在默认框架里）
    expect([...container!.querySelectorAll(".tree-node.revealed")].map((node) => (node.getAttribute("aria-label") || "").split("，")[0])).toEqual(["H9", "H7"]);
    // 按钮上标出这一枝摊开了几层，用户知道自己在第几层
    expect(grid().some((text) => text.startsWith("收起这一层 (1)"))).toBe(true);

    // 再点一次「展开下一层」：往下**再**摊一层（H9 的两个孩子出来）
    act(() => gridButton("展开下一层").click());
    expect(nodeLabels()).toContain("H10");
    expect(nodeLabels()).toContain("I10");

    // 「收起这一层」一次只收一层：先收掉 H10/I10，H9/H7 留着
    act(() => gridButton("收起这一层").click());
    expect(nodeLabels()).toContain("H9");
    expect(nodeLabels()).not.toContain("H10");
    // 再收一次才轮到 H9/H7（这一枝彻底收回默认框架）
    act(() => gridButton("收起这一层").click());
    expect(nodeLabels()).toEqual(["起始局面", "H8", "I8"]);
  });

  it("只看这支：只留选中这一手的后续，其他分支全隐藏（用户 2026-10-10）", () => {
    // 形状：root ─ m1(H8) ─ m2(I8) ─ m3(H9)
    //              └ s1(I7) ─ s1a(J7) ─ s1b(J6)
    //              └ z1(H7)
    // 默认视野是「当前路径 + 主分支」；聚焦 s1（I7）之后**只剩 I7 及其后代**，
    // 主线上的 m2/m3、另一个兄弟 z1(H7) 都要消失。
    const branchDocument: GameDocument = {
      ...documentFixture,
      id: "tree-focus-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["m2", "s1", "z1"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        m2: { id: "m2", parentId: "m1", children: ["m3"], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        m3: { id: "m3", parentId: "m2", children: [], move: { row: 6, col: 7, player: "black" }, comment: "", marks: [] },
        s1: { id: "s1", parentId: "m1", children: ["s1a"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        s1a: { id: "s1a", parentId: "s1", children: ["s1b"], move: { row: 8, col: 9, player: "black" }, comment: "", marks: [] },
        s1b: { id: "s1b", parentId: "s1a", children: [], move: { row: 9, col: 9, player: "white" }, comment: "", marks: [] },
        z1: { id: "z1", parentId: "m1", children: [], move: { row: 5, col: 7, player: "white" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: branchDocument, currentId: "m3", path: [branchDocument.nodes.root, branchDocument.nodes.m1, branchDocument.nodes.m2, branchDocument.nodes.m3] }));

    // 默认：当前路径 + 主分支（还带一层分叉预览，见 expandBranch 的默认框架）
    expect(nodeLabels()).toContain("起始局面");
    expect(nodeLabels()).toContain("H8");
    expect(nodeLabels()).toContain("I8");

    // 选中分叉点 H8，按「只看这支」——但 H8 自己没有别的后续可聚焦，先看 s1(I7)：
    // 先展开一层把 I7 露出来
    clickNode("H8");
    act(() => gridButton("展开下一层").click());
    expect(nodeLabels()).toContain("I7");

    // 聚焦 I7：只剩 I7 的后续（I7 → J7 → J6），主线 H8/I8/H9 与兄弟 H7 全部隐藏
    clickNode("I7");
    act(() => gridButton("只看这支").click());
    const focused = nodeLabels();
    expect(focused).toContain("I7");
    expect(focused).toContain("J7");
    expect(focused).toContain("J6");
    expect(focused).not.toContain("H9");   // 主线后续被隐藏
    expect(focused).not.toContain("H7");   // 兄弟分支被隐藏
    // 祖先还画着（否则聚焦的那一支会浮空、看不出挂在哪）
    expect(focused).toContain("起始局面");
    expect(focused).toContain("H8");

    // 按钮进入按下态；再点一次取消，回到默认视野
    expect(gridButton("只看这支").getAttribute("aria-pressed")).toBe("true");
    act(() => gridButton("只看这支").click());
    expect(gridButton("只看这支").getAttribute("aria-pressed")).toBe("false");
    expect(nodeLabels()).toContain("H9");
  });

  /**
   * 换文档要清掉「只看这支」的聚焦点（2026-10-11 P3）。
   *
   * `focusId` 是个**节点 id**，换文档之后它在新的 `document.nodes` 里根本不存在，
   * 而可见集合是按它算的——不清的话白名单是空集，整棵树只剩「起始局面」一个节点
   * （画布看着全空，且没有任何恢复入口：按钮的按下态绑 `focusId === selected.id`，
   * 新谱下恒 false，用户点不着「取消」）。触发面很日常：在 DP/LIB 上做一次编辑，
   * App 会换出「可编辑副本」（新文档、新 id），面板一直开着。
   */
  it("换文档（如懒加载谱 → 可编辑副本）时清掉「只看这支」，画布不许变空", () => {
    const focused: GameDocument = {
      ...documentFixture,
      id: "tree-focus-reset-a",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["m2", "s1"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        m2: { id: "m2", parentId: "m1", children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        s1: { id: "s1", parentId: "m1", children: ["s1a"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        s1a: { id: "s1a", parentId: "s1", children: [], move: { row: 8, col: 9, player: "black" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: focused, currentId: "m2", path: [focused.nodes.root, focused.nodes.m1, focused.nodes.m2] }));
    // 展开 H8 一层露出 I7（s1：row 8, col 8 → 字母 I、行号 15-8=7），聚焦它进「只看这支」
    clickNode("H8");
    act(() => gridButton("展开下一层").click());
    clickNode("I7");
    act(() => gridButton("只看这支").click());
    expect(gridButton("只看这支").getAttribute("aria-pressed")).toBe("true");
    // 聚焦 I7 后主线 I8 被藏起来，只剩 I7 与它的后续 J7
    expect(nodeLabels()).toContain("I7");
    expect(nodeLabels()).toContain("J7");
    expect(nodeLabels()).not.toContain("I8");

    // 换文档：模拟「可编辑副本」——节点 id 全变（同结构、新前缀）
    const copy: GameDocument = {
      ...focused,
      id: "tree-focus-reset-a-study-x",
      nodes: {
        "root-c": { id: "root-c", parentId: null, children: ["m1-c"], move: null, comment: "", marks: [] },
        "m1-c": { id: "m1-c", parentId: "root-c", children: ["m2-c", "s1-c"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        "m2-c": { id: "m2-c", parentId: "m1-c", children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        "s1-c": { id: "s1-c", parentId: "m1-c", children: ["s1a-c"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        "s1a-c": { id: "s1a-c", parentId: "s1-c", children: [], move: { row: 8, col: 9, player: "black" }, comment: "", marks: [] },
      },
      rootId: "root-c",
    };
    act(() => root!.render(<RecordTreePanel {...panelProps({ document: copy, currentId: "m2-c", path: [copy.nodes["root-c"], copy.nodes["m1-c"], copy.nodes["m2-c"]] })}/>));
    // 画布不许只剩「起始局面」：默认视野要把主分支画回来（H8 → I8 一条线）
    const labels = nodeLabels();
    expect(labels).toContain("起始局面");
    expect(labels).toContain("H8");
    expect(labels).toContain("I8");   // 主线回来了——这正是「聚焦没清掉」时会消失的那个节点
    expect(gridButton("只看这支").getAttribute("aria-pressed")).toBe("false");
  });

  it("zooms with the mouse wheel anchored at the cursor and blocks page scroll", () => {
    renderPanel(panelProps({ document: documentFixture, currentId: "root", path: [documentFixture.nodes.root] }));
    const svg = container!.querySelector<SVGSVGElement>(".tree-canvas")!;
    Object.defineProperties(svg, {
      viewBox: { value: { baseVal: { x: 0, y: 0, width: 430, height: 240 } } },
      getBoundingClientRect: { value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 340, width: 300, height: 340, toJSON: () => ({}) }) },
    });
    const transform = () => container!.querySelector(".tree-canvas > g")!.getAttribute("transform")!;
    const wheel = (deltaY: number) => {
      const event = new Event("wheel", { bubbles: true, cancelable: true });
      Object.defineProperties(event, { deltaY: { value: deltaY }, clientX: { value: 150 }, clientY: { value: 170 } });
      act(() => svg.dispatchEvent(event));
      return event;
    };
    // 打开时默认对准当前手：root 中心 (84, 66) 落在 430×180 画布中心 → pan (131, 24)
    expect(transform()).toBe("translate(131 24) scale(1)");
    const zoomIn = wheel(-120);
    expect(zoomIn.defaultPrevented).toBe(true);
    const numbers = transform().match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/) ?? [];
    const panX = Number(numbers[1]), panY = Number(numbers[2]), scale = Number(numbers[3]);
    // 缩放保留三位小数：低倍区间（1%–10%）用两位会被 toFixed 压成同一个值而卡住
    expect(scale).toBeCloseTo(Math.exp(.18), 5);
    // 以光标为锚：光标下的内容点（viewBox 坐标 (215, 120) = 内容坐标 (84, 96)）缩放前后都不动。
    // 96 = 120 − pan.y(24)：内容顶端留白 44 之后，同一处 viewBox 点对应的内容点也随之上移 26。
    expect(Math.abs((215 - panX) / scale - 84)).toBeLessThan(0.01);
    expect(Math.abs((120 - panY) / scale - 96)).toBeLessThan(0.01);
    const zoomOut = wheel(240);
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(Number(/scale\(([^)]+)\)/.exec(transform())?.[1])).toBeCloseTo(Math.exp(-.18), 5);
  });

  it("lays out both long lines completely while rendering the current viewport", () => {
    // 一条 500 手的旁支比当前路径长得多：默认视野会先画那条最长分支，
    // 但它不允许把「当前局面」挤出预算——否则用户打开树会找不到自己。
    const nodes: Record<string, RecordNode> = { bigRoot: { id: "bigRoot", parentId: null, children: ["side-0", "path-0"], move: null, comment: "", marks: [] } };
    for (let index = 0; index < 500; index += 1) {
      const children = index + 1 < 500 ? [`side-${index + 1}`] : [];
      if (index % 5 === 4) children.push(`side-branch-${index}`);
      nodes[`side-${index}`] = { id: `side-${index}`, parentId: index === 0 ? "bigRoot" : `side-${index - 1}`, children, move: { row: index % 15, col: Math.floor(index / 15) % 15, player: "black" }, comment: "", marks: [] };
    }
    for (let index = 0; index < 100; index += 1) {
      nodes[`path-${index}`] = { id: `path-${index}`, parentId: index === 0 ? "bigRoot" : `path-${index - 1}`, children: index + 1 < 100 ? [`path-${index + 1}`] : [], move: { row: 14 - (index % 14), col: 14, player: "white" }, comment: "", marks: [] };
    }
    const lazyDocument = lazyDocumentFrom(nodes, "bigRoot");
    const path = [lazyDocument.nodes.bigRoot, ...Array.from({ length: 100 }, (_value, index) => lazyDocument.nodes[`path-${index}`])];
    renderPanel(panelProps({ document: lazyDocument, currentId: "path-99", path }));

    const labels = [...container!.querySelectorAll(".tree-node")].map((node) => node.getAttribute("aria-label") || "");
    expect(labels.some((label) => label.includes("当前局面"))).toBe(true);
    const layoutCount = Number(container!.querySelector(".tree-viewport")?.getAttribute("data-layout-nodes"));
    expect(layoutCount).toBeGreaterThanOrEqual(601);
    expect(labels.filter((label) => /^O\d/.test(label)).length).toBeGreaterThan(1);
    expect(container!.querySelectorAll(".tree-node").length).toBeLessThan(50);
    const overview = container!.querySelector<HTMLButtonElement>('[aria-label="总览全部已展开分支"]')!;
    act(() => overview.click());
    expect(container!.querySelector(".tree-viewport")?.getAttribute("data-display")).toBe("structure");
    expect(Number(container!.querySelector(".tree-viewport")?.getAttribute("data-layout-nodes"))).toBe(layoutCount);
    const zoomPreset = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>(".tree-zoom-presets button")].find((button) => button.textContent === label)!;
    // 三档（用户 2026-10-14 改的切换点）：50% 仍是完整标签，**20% 起**换成单行「坐标 · 手数」胶囊，
    // **5% 起**只剩结构圆点。紧凑档的画布字号是 6/比例 ⇒ 屏幕上恒定 6px，缩到 10% 也还读得清。
    for (const [preset, detail, factor] of [["50%", "full", 0.5], ["20%", "compact", 0.2], ["10%", "compact", 0.1]] as const) {
      act(() => zoomPreset(preset).click());
      const viewport = container!.querySelector(".tree-viewport")!;
      expect(viewport.getAttribute("data-display")).toBe("detail");
      expect(viewport.getAttribute("data-detail")).toBe(detail);
      expect(container!.querySelector(".tree-structure-node")).toBeNull();
      expect(container!.querySelectorAll(".tree-node-label, .tree-chain-label, .tree-compact-label").length).toBeGreaterThan(0);
      expect(Number(viewport.getAttribute("data-layout-nodes"))).toBe(layoutCount);
      const compact = container!.querySelector<SVGTextElement>(".tree-compact-label");
      if (detail === "compact") expect(parseFloat(compact!.style.fontSize) * factor).toBeCloseTo(6);
      else expect(compact).toBeNull();
    }
    act(() => zoomPreset("5%").click());
    expect(container!.querySelector(".tree-viewport")?.getAttribute("data-display")).toBe("structure");
  });

  it("右下角小地图折成一颗小按钮、再点回来（用户 2026-10-14：要折叠的是缩略图，不是棋盘预览）", () => {
    const nodes: Record<string, RecordNode> = { root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] } };
    for (let index = 1; index <= 30; index += 1) {
      nodes[`m${index}`] = { id: `m${index}`, parentId: index === 1 ? "root" : `m${index - 1}`, children: index < 30 ? [`m${index + 1}`] : [], move: { row: index % 15, col: (index * 3) % 15, player: index % 2 ? "black" : "white" }, comment: "", marks: [] };
    }
    const doc: GameDocument = { ...documentFixture, id: "minimap-fold", rootId: "root", nodes };
    const path = [nodes.root, ...Array.from({ length: 30 }, (_value, index) => nodes[`m${index + 1}`])];
    renderPanel(panelProps({ document: doc, currentId: "m30", path }));
    // 30 个节点 > 24 ⇒ 画布右下角出现缩略图（它必须在 `.tree-viewport` 里面：09-22 的口径是
    // "要和主画布同一块画布"，不许再做一个独立窗口）
    expect(container!.querySelector(".tree-viewport .tree-minimap")).not.toBeNull();
    act(() => container!.querySelector<HTMLButtonElement>('[aria-label="折叠小地图"]')!.click());
    expect(container!.querySelector(".tree-minimap")).toBeNull();
    const reopen = container!.querySelector<HTMLButtonElement>('[aria-label="展开小地图"]');
    expect(reopen).not.toBeNull();
    expect(reopen!.getAttribute("aria-controls")).toBe("tree-minimap");
    act(() => reopen!.click());
    expect(container!.querySelector(".tree-viewport .tree-minimap")).not.toBeNull();
    // 详情面板那把折叠（R196）已经撤掉：面板上没有「折叠节点详情」，也没有画布右下角的恢复按钮
    expect(container!.querySelector('[aria-label="折叠节点详情"]')).toBeNull();
    expect(container!.querySelector(".tree-inspector-reopen")).toBeNull();
  });

  it("棋盘预览和节点操作同行，按选项展开且可再次收起", () => {
    renderPanel(panelProps({ document: documentFixture, currentId: "child", path: [documentFixture.nodes.root, documentFixture.nodes.child] }));
    const content = container!.querySelector<HTMLElement>(".tree-inspector-content")!;
    const option = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>(".tree-inspector-options button")].find((button) => button.textContent === label)!;
    expect(content.hidden).toBe(true);
    expect(container!.querySelector(".tree-preview-board")).toBeNull();
    act(() => option("棋盘预览").click());
    expect(content.hidden).toBe(false);
    expect(container!.querySelectorAll(".tree-preview-board .stone").length).toBe(1);
    expect(option("棋盘预览").getAttribute("aria-pressed")).toBe("true");
    expect(container!.querySelector(".tree-preview-head")).toBeNull();
    act(() => option("节点操作").click());
    expect(container!.querySelector(".tree-preview-board")).toBeNull();
    expect(option("棋盘预览").getAttribute("aria-pressed")).toBe("false");
    expect(option("节点操作").getAttribute("aria-pressed")).toBe("true");
    expect(gridButton("定位").closest("[hidden]")).toBeNull();
    act(() => option("节点操作").click());
    expect(content.hidden).toBe(true);
  });

  it("不用展开详情就能逐层浏览所选分支，并直接定位到棋盘", () => {
    const doc: GameDocument = { ...documentFixture, nodes: {
      ...documentFixture.nodes,
      root: { ...documentFixture.nodes.root, children: ["child", "side"], preferredChildId: "child" },
      side: { id: "side", parentId: "root", children: ["end"], move: { row: 6, col: 7, player: "black" }, comment: "", marks: [] },
      end: { id: "end", parentId: "side", children: [], move: { row: 6, col: 8, player: "white" }, comment: "", marks: [] },
    } };
    const props = panelProps({ document: doc, currentId: "root", path: [doc.nodes.root] });
    renderPanel(props);
    const shortcut = (label: string) => container!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect(nodeLabels()).not.toContain("H9");
    expect(nodeLabels()).not.toContain("I9");
    expect(shortcut("展开所选节点的下一层").disabled).toBe(false);
    act(() => shortcut("展开所选节点的下一层").click());
    expect(nodeLabels()).toContain("H9");
    expect(nodeLabels()).not.toContain("I9");
    act(() => shortcut("展开所选节点的下一层").click());
    expect(nodeLabels()).toContain("I9");
    act(() => shortcut("收起所选节点的一层").click());
    expect(nodeLabels()).toContain("H9");
    expect(nodeLabels()).not.toContain("I9");
    act(() => shortcut("收起所选节点的一层").click());
    expect(nodeLabels()).not.toContain("H9");
    expect(container!.querySelector<HTMLElement>(".tree-inspector-content")!.hidden).toBe(true);
    act(() => shortcut("展开所选节点的下一层").click());
    clickNode("H8");
    act(() => shortcut("将所选节点定位到棋盘").click());
    expect(props.onLocate).toHaveBeenCalledWith("child", "root");
  });

  it("总览中可以一键看清所选节点，放大后保留选择且不改变主棋盘", () => {
    const props = panelProps({ document: documentFixture, currentId: "root", path: [documentFixture.nodes.root] });
    renderPanel(props);
    const preset = [...container!.querySelectorAll<HTMLButtonElement>(".tree-zoom-presets button")].find((button) => button.textContent === "20%")!;
    act(() => preset.click());
    clickNode("H8");
    const content = () => container!.querySelector(".tree-canvas > g")!.getAttribute("transform");
    expect(content()).toContain("scale(0.2)");
    act(() => container!.querySelector<HTMLButtonElement>('[aria-label="看清所选节点"]')!.click());
    expect(content()).toContain("scale(1)");
    expect(container!.querySelector(".tree-node.selected")?.getAttribute("aria-label")).toContain("H8");
    expect(container!.querySelector(".tree-mapbar-selected small")?.textContent).toContain("第 1 手");
    expect(props.onLocate).not.toHaveBeenCalled();
  });

  it("收缩的链条节点同时显示坐标与手数（用户 09-26：以前只有手数、连坐标都没有）", () => {
    const chain: GameDocument = {
      ...documentFixture,
      id: "tree-chain-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["m2"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        m2: { id: "m2", parentId: "m1", children: ["m3"], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        m3: { id: "m3", parentId: "m2", children: ["m4"], move: { row: 6, col: 7, player: "black" }, comment: "", marks: [] },
        m4: { id: "m4", parentId: "m3", children: [], move: { row: 6, col: 8, player: "white" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: chain, currentId: "m4", path: [chain.nodes.root, chain.nodes.m1, chain.nodes.m2, chain.nodes.m3, chain.nodes.m4] }));
    // 首尾（起始局面、当前手）是方框，中间三手是胶囊：坐标在左、手数在右，两样都在
    expect([...container!.querySelectorAll(".tree-chain-label")].map((text) => text.textContent)).toEqual(["H8", "I8", "H9"]);
    expect([...container!.querySelectorAll(".tree-chain-num")].map((text) => text.textContent)).toEqual(["1", "2", "3"]);
    // 链条胶囊比方框窄一半以上（还是紧凑的），但不再是「34px 只放得下一个数字」
    expect(container!.querySelectorAll(".tree-chain-label").length).toBeGreaterThan(0);
  });

  it("搜索：输入即跳到最近的命中，上一个/下一个按「从近到远」翻（用户 09-26 的 Word 式查找）", () => {
    const searchDocument: GameDocument = {
      ...documentFixture,
      id: "tree-search-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["m2"], move: { row: 7, col: 7, player: "black" }, comment: "双三开局", marks: [] },
        m2: { id: "m2", parentId: "m1", children: ["m3"], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [{ row: 7, col: 8, kind: "triangle" }] },
        m3: { id: "m3", parentId: "m2", children: [], move: { row: 6, col: 7, player: "black" }, comment: "白棋要下 H8 交换", marks: [] },
      },
    };
    const onLocate = vi.fn();
    renderPanel(panelProps({
      document: searchDocument, currentId: "m3",
      path: [searchDocument.nodes.root, searchDocument.nodes.m1, searchDocument.nodes.m2, searchDocument.nodes.m3],
      onLocate,
    }));
    act(() => container!.querySelector<HTMLButtonElement>(".tree-search-toggle")!.click());
    const input = container!.querySelector<HTMLInputElement>(".tree-search-field input")!;
    const type = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    const rows = () => [...container!.querySelectorAll(".tree-search-hit")].map((row) => row.querySelector("b")?.textContent || "");
    const nav = () => container!.querySelector(".tree-search-nav span")!.textContent;

    // 「H8」：m1 的坐标、m3 的注释各命中一次；当前在第 3 手 → 从近到远，第 3 手排前面
    type("H8");
    expect(rows()).toEqual(["第 3 手", "第 1 手"]);
    expect(nav()).toBe("第 1 / 2 个命中");
    expect(onLocate).toHaveBeenLastCalledWith("m3", "m2");
    // 「下一个」翻到第 2 条：跳的是 m1（点一下就能一个个看下去）
    act(() => [...container!.querySelectorAll<HTMLButtonElement>(".tree-search-nav button")].find((button) => button.textContent === "下一个")!.click());
    expect(nav()).toBe("第 2 / 2 个命中");
    expect(onLocate).toHaveBeenLastCalledWith("m1", "root");

    // 按标注搜：中文名「三角」直接找到带三角标的那一手
    type("三角");
    expect(rows()).toEqual(["第 2 手"]);
    expect(onLocate).toHaveBeenLastCalledWith("m2", "m1");

    // 没有命中时如实说，且不会乱跳
    const before = onLocate.mock.calls.length;
    type("不存在的词");
    expect(nav()).toBe("没有命中");
    expect(onLocate.mock.calls.length).toBe(before);
  });

  /**
   * 图谱里任何两个节点都不许在画面上叠在一起（用户 2026-10-09 报「图谱化变化分支时会有重合」）。
   *
   * 修复前这里会红：行分配把**用户展开那一枝的同一层放在同一行**，而 x 的推导只看父节点
   * （`父右缘 + 间距`）→ 同一个父亲的兄弟算出**同一个 x**、又落在同一行，
   * 整个节点完全重叠（量出来正好 132px = 一整个方框宽，界面上表现为坐标被盖住、
   * 只剩一枚徽标「15」）。随机 1500 棵树统计：1154 棵有重叠、2688 处完全重合。
   *
   * 另一类叠加来源是宽度有两档（胶囊 64 / 方框 132），不同枝即便 x 不同也可能横向相交，
   * 所以这里量的是**真实包围盒**（横区间相交），不是「x 是否相等」。
   */
  it("never overlaps two nodes on the same row, including inside an expanded branch", () => {
    const measureOverlap = () => {
      const boxes = [...container!.querySelectorAll<SVGGElement>(".tree-node")].map((element) => {
        const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(element.getAttribute("transform") || "");
        // 胶囊节点画的是 .tree-dot-face、方框节点画的是 rect：宽度按实际形态取
        const width = element.querySelector(".tree-dot-face") ? 64 : 132;
        return {
          label: (element.getAttribute("aria-label") || "").split("，")[0],
          x: Number(match?.[1] ?? 0),
          y: Number(match?.[2] ?? 0),
          width,
        };
      });
      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i], b = boxes[j];
          if (Math.abs(a.y - b.y) > 0.5) continue;
          const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          if (overlap > 0.5) hits.push(`${a.label} ∩ ${b.label} = ${Math.round(overlap)}px`);
        }
      }
      return hits;
    };
    // 形状：root─m1，m1 下面两个孩子（trunk 走主线、fork 是用户要展开的那一枝），
    // fork 自己再分两个 → 展开后 fa/fb 是「同一父亲的兄弟落在同一层」，修复前必然完全重合。
    const overlapDocument: GameDocument = {
      ...documentFixture,
      id: "tree-overlap-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] },
        m1: { id: "m1", parentId: "root", children: ["trunk", "fork"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        trunk: { id: "trunk", parentId: "m1", children: ["m2"], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
        m2: { id: "m2", parentId: "trunk", children: [], move: { row: 6, col: 8, player: "black" }, comment: "", marks: [] },
        fork: { id: "fork", parentId: "m1", children: ["fa", "fb"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        fa: { id: "fa", parentId: "fork", children: [], move: { row: 8, col: 9, player: "black" }, comment: "", marks: [] },
        fb: { id: "fb", parentId: "fork", children: [], move: { row: 9, col: 9, player: "white" }, comment: "", marks: [] },
      },
    };
    renderPanel(panelProps({ document: overlapDocument, currentId: "m2", path: [overlapDocument.nodes.root, overlapDocument.nodes.m1, overlapDocument.nodes.trunk, overlapDocument.nodes.m2] }));
    expect(measureOverlap()).toEqual([]);

    // 在 m1 上展开：fork 那一枝长成真树，fa/fb 同层——这正是修复前叠在一起的那一处。
    clickNode("H8");
    act(() => gridButton("展开下一层").click());
    expect(nodeLabels()).toContain("I9");
    expect(measureOverlap()).toEqual([]);

    // 再摊一层，并让控件形态混着出现（展开后 m2 仍是胶囊、fa/fb 是方框）——仍不许相交。
    clickNode("H8");
    act(() => gridButton("展开下一层").click());
    expect(measureOverlap()).toEqual([]);
  });

  /**
   * 同型局面（用户 2026-10-09，群友提的「殊途同归」）：两条不同落子顺序走到同一盘面。
   *
   * 这里断言的是**产品行为的三个关键点**：
   * ① 默认关——开关不开时一个标记都不画（既有门禁的节点数与画面不受影响）；
   * ② 打开后，同型的那两手各带一枚标记、图例跟着出现；
   * ③ 选中其中一手，能列出对面那个同型局面并**跳过去**（这是功能的意义所在）。
   */
  it("marks same-position nodes (殊途同归) only when the toggle is on, and can jump to them", () => {
    // root ─ A 路线（H8/I9/I8/J9）与 B 路线（I8/J9/H8/I9）：
    // 四个同样的点、两种落子顺序 → 第 4 手之后两边是同一个盘面、同样轮到黑。
    const detourDocument: GameDocument = {
      ...documentFixture,
      id: "tree-transposition-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["a1", "b1"], move: null, comment: "", marks: [] },
        a1: { id: "a1", parentId: "root", children: ["a2"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        a2: { id: "a2", parentId: "a1", children: ["a3"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        a3: { id: "a3", parentId: "a2", children: ["a4"], move: { row: 7, col: 8, player: "black" }, comment: "", marks: [] },
        a4: { id: "a4", parentId: "a3", children: [], move: { row: 8, col: 9, player: "white" }, comment: "", marks: [] },
        b1: { id: "b1", parentId: "root", children: ["b2"], move: { row: 7, col: 8, player: "black" }, comment: "", marks: [] },
        b2: { id: "b2", parentId: "b1", children: ["b3"], move: { row: 8, col: 9, player: "white" }, comment: "", marks: [] },
        b3: { id: "b3", parentId: "b2", children: ["b4"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        b4: { id: "b4", parentId: "b3", children: [], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
      },
    };
    const locate = vi.fn();
    renderPanel(panelProps({
      document: detourDocument,
      currentId: "b4",
      path: [detourDocument.nodes.root, detourDocument.nodes.b1, detourDocument.nodes.b2, detourDocument.nodes.b3, detourDocument.nodes.b4],
      onFlowJump: locate,
    }));
    const dots = () => container!.querySelectorAll(".tree-node .tree-transposition-dot").length;
    // 「同型局面」入口现在与其它编辑按钮同级（用户 2026-10-10 要求挪下来）
    const toggle = () => gridButton("同型局面");

    // ① 默认关：一个标记都没有，也不出现同型区块与图例项
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(dots()).toBe(0);
    expect(container!.querySelector(".tree-transposition")).toBeNull();
    expect([...container!.querySelectorAll(".tree-legend span")].map((span) => span.textContent)).not.toContain("同型局面");

    // ② 打开：a4 与 b4 这一对同型各带标记（默认视野里 b4 在路径上、a4 也画了出来）
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(dots()).toBe(2);
    expect([...container!.querySelectorAll(".tree-legend span")].map((span) => span.textContent)).toContain("同型局面");

    // ③ 选中其中一手 → 列出对面的同型局面，点一下就跳过去
    // 注意这份夹具里 a2 也落在 I7（它没有同型），所以要挑**当前这一手** b4——
    // 它与 a4 是同一个局面（都读作 I7），只是走法顺序不同。
    const i7Nodes = [...container!.querySelectorAll<SVGGElement>(".tree-node")].filter((node) => (node.getAttribute("aria-label") || "").startsWith("I7"));
    const currentTwin = i7Nodes.find((node) => (node.getAttribute("aria-label") || "").includes("当前局面"))!;
    act(() => currentTwin.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const list = container!.querySelector(".tree-transposition-list");
    expect(list).not.toBeNull();
    // 每条现在是「跳过去看」+「并入」两枚按钮；跳转走前者
    const row = list!.querySelector<HTMLButtonElement>(".tree-transposition-jump")!;
    expect(row.textContent).toContain("第 4 手");
    act(() => row.click());
    // 跳转走的是「一边读一边走」的那条通道（与搜索命中同一个），不关面板
    expect(locate).toHaveBeenCalled();
  });

  it("offers a real merge (并入) that hands the donor's continuation to the keeper", () => {
    // 用户 2026-10-10：「不是合并分支的意思吗」——除了跳过去看，还要能真的收成一条。
    const detourDocument: GameDocument = {
      ...documentFixture,
      id: "tree-transposition-merge-test",
      nodes: {
        root: { id: "root", parentId: null, children: ["a1", "b1"], move: null, comment: "", marks: [] },
        a1: { id: "a1", parentId: "root", children: ["a2"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        a2: { id: "a2", parentId: "a1", children: ["a3"], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
        a3: { id: "a3", parentId: "a2", children: ["a4"], move: { row: 7, col: 8, player: "black" }, comment: "", marks: [] },
        a4: { id: "a4", parentId: "a3", children: [], move: { row: 8, col: 9, player: "white" }, comment: "", marks: [] },
        b1: { id: "b1", parentId: "root", children: ["b2"], move: { row: 7, col: 8, player: "black" }, comment: "", marks: [] },
        b2: { id: "b2", parentId: "b1", children: ["b3"], move: { row: 8, col: 9, player: "white" }, comment: "", marks: [] },
        b3: { id: "b3", parentId: "b2", children: ["b4"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
        b4: { id: "b4", parentId: "b3", children: [], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [] },
      },
    };
    const merge = vi.fn();
    renderPanel(panelProps({
      document: detourDocument,
      currentId: "a4",
      path: [detourDocument.nodes.root, detourDocument.nodes.a1, detourDocument.nodes.a2, detourDocument.nodes.a3, detourDocument.nodes.a4],
      onMergeSamePositions: merge,
    }));
    act(() => gridButton("同型局面").click());
    // 选中当前这一手（a4），列表里应该出现 b4 那一处同型 + 一枚「并入」
    const i7 = [...container!.querySelectorAll<SVGGElement>(".tree-node")].find((node) => (node.getAttribute("aria-label") || "").includes("当前局面"))!;
    act(() => i7.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const mergeButton = container!.querySelector<HTMLButtonElement>(".tree-transposition-merge");
    expect(mergeButton).not.toBeNull();
    expect(mergeButton!.textContent).toContain("并入");
    act(() => mergeButton!.click());
    // 交给上层（App）去落草稿：keeper 是当前这一手，donor 是列出来那一处
    expect(merge).toHaveBeenCalledWith("a4", "b4");
  });

  it("shows an honest empty state when the record has no transposition", () => {
    renderPanel(panelProps({ document: documentFixture, currentId: "child", path: [documentFixture.nodes.root, documentFixture.nodes.child] }));
    act(() => gridButton("同型局面").click());
    // 只有一条两手的线，没有任何殊途同归——如实说，不留一个看起来像出错的空框
    expect(container!.querySelector(".tree-transposition")!.textContent).toContain("还没有");
    expect(container!.querySelectorAll(".tree-node .tree-transposition-dot").length).toBe(0);
  });

  /**
   * 懒加载源（DP/DB 局面库、RenLib 网页核心读的 .lib）上**不做同型查找**。
   *
   * 原因（2026-10-10 排查出的同类 bug）：这些棋谱的 `document.nodes` 只是投影
   * （九天指南全库 107242 个局面、实测只加载 905 个），拿它算「同型」既漏又可能错，
   * 而界面会写成「全谱 N 处」——那是个看不出问题的假结论。
   * 期望行为：**如实说明为什么不查**，而不是给一个像「没有同型」的空结果。
   *
   * 注意这里用 `partial` 标记来代表 DP/LIB（它们**不是** compact——`compactIndexOf`
   * 只认 `createLazyDocument` 的代理；这也正是这个 bug 当初漏掉的原因）。
   */
  it("懒加载棋谱上如实说明「暂不做同型查找」，而不是给假结论", () => {
    renderPanel(panelProps({
      document: documentFixture,
      currentId: "child",
      path: [documentFixture.nodes.root, documentFixture.nodes.child],
      partial: true,
    }));
    act(() => gridButton("同型局面").click());
    const text = container!.querySelector(".tree-transposition")!.textContent || "";
    expect(text).toContain("同型局面");
    expect(text).toContain("暂不做同型查找");   // 说清楚为什么不查
    expect(text).not.toContain("没有殊途同归"); // 不许把「没查」说成「没有」
  });

  /**
   * 孩子超过 12 支时，用户把这一手摊开后必须能看到**全部**候选（2026-10-11 P1）。
   *
   * 旧实现把每个节点的孩子硬截断到 `TREE_CHILD_WINDOW = 12`，而画布上没有任何
   * 「还有 N 支没画」的提示——实测内置九天指南有 34 个节点的孩子数超过 12（最多 29 支），
   * 那些节点的第 13 支之后永远不可见；同时「展开下一层」照旧可点、数字照旧涨
   * （子树高度是够的），用户看到的就是「点了没反应」。
   */
  it("祖先展开两层、只看这支和展开全部都能显示第 13 支之后的候选", () => {
    const nodes: Record<string, RecordNode> = {
      root: { ...documentFixture.nodes.root, children: ["fork"] },
      fork: { id: "fork", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, boardText: "分叉", comment: "", marks: [] },
    };
    for (let i = 0; i < 29; i += 1) {
      const id = `reply-${i}`;
      nodes.fork.children.push(id);
      nodes[id] = { id, parentId: "fork", children: [], move: { row: Math.floor(i / 15), col: i % 15, player: "white" }, boardText: `候选${i + 1}`, comment: "", marks: [] };
    }
    const document = { ...documentFixture, nodes };
    renderPanel(panelProps({ document, currentId: "root", path: [nodes.root] }));
    act(() => gridButton("展开下一层").click());
    act(() => gridButton("展开下一层").click());
    expect(nodeLabels()).toContain("候选29");
    expect(container!.querySelectorAll(".tree-node").length).toBe(31);
    act(() => gridButton("收起全部").click());
    act(() => gridButton("只看这支").click());
    expect(nodeLabels()).toContain("候选29");
    act(() => gridButton("展开全部").click());
    expect(nodeLabels()).toContain("候选29");
  });

  it("默认主分支位于第 13 支以后时仍显示整条主线", () => {
    const nodes: Record<string, RecordNode> = { root: { ...documentFixture.nodes.root, children: [], preferredChildId: "branch-19" } };
    for (let i = 0; i < 20; i += 1) {
      const id = `branch-${i}`;
      nodes.root.children.push(id);
      nodes[id] = { id, parentId: "root", children: [], move: { row: 7, col: i % 15, player: "black" }, boardText: `分支${i + 1}`, comment: "", marks: [] };
    }
    renderPanel(panelProps({ document: { ...documentFixture, nodes }, currentId: "root", path: [nodes.root] }));
    expect(nodeLabels()).toEqual(["起始局面", "分支20"]);
  });

  it("导航可找到最后一页、返回分叉保留页码，并把选中支带回图谱", () => {
    const ids = Array.from({ length: 33 }, (_, i) => `candidate${i}`);
    const doc: GameDocument = { ...documentFixture, id: "navigation-pages", nodes: {
      root: { ...documentFixture.nodes.root, children: ids },
      ...Object.fromEntries(ids.map((id, i) => [id, { id, parentId: "root", children: [], move: null, comment: `完整注释${i}`, boardText: `候选${i + 1}`, marks: [] }])),
    } };
    const props = panelProps({ document: doc, currentId: "root", path: [doc.nodes.root] });
    renderPanel(props);
    const button = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
    act(() => button("导航").click());
    expect(container!.querySelectorAll(".tree-navigator-row").length).toBe(16);
    act(() => button("下一页").click());
    act(() => button("下一页").click());
    expect(container!.querySelector(".tree-navigator-paging [role=status]")?.textContent).toBe("33–33 / 33 支");
    expect(button("下一页").disabled).toBe(true);
    act(() => container!.querySelector<HTMLButtonElement>(".tree-navigator-row")!.click());
    expect(container!.querySelector(".tree-node-action-head b")?.textContent).toBe("候选33");
    expect(container!.querySelector(".tree-preview.open")).not.toBeNull();
    expect(props.onLocate).not.toHaveBeenCalled();
    act(() => button("上一层").click());
    expect(container!.querySelector(".tree-navigator-paging [role=status]")?.textContent).toBe("33–33 / 33 支");
    act(() => container!.querySelector<HTMLButtonElement>(".tree-navigator-row")!.click());
    act(() => button("在图谱查看").click());
    expect(nodeLabels()).toContain("候选33");
    expect(container!.querySelector(".tree-node.selected")?.getAttribute("aria-label")).toContain("候选33");
    act(() => gridButton("定位").click());
    expect(props.onLocate).toHaveBeenCalledWith("candidate32", "root");
  });

  it("从祖先继续展开时读取最外层后续，而非反复只查询祖先", () => {
    const doc: GameDocument = { ...documentFixture, nodes: {
      root: { ...documentFixture.nodes.root }, child: { ...documentFixture.nodes.child, unloadedChildren: 29 },
    } };
    const onLoadBranch = vi.fn();
    renderPanel(panelProps({ document: doc, currentId: "root", path: [doc.nodes.root], partial: true, onLoadBranch }));
    act(() => gridButton("展开下一层").click());
    expect(onLoadBranch).not.toHaveBeenCalled();
    act(() => gridButton("展开下一层").click());
    expect(onLoadBranch).toHaveBeenCalledTimes(1);
    expect(onLoadBranch).toHaveBeenCalledWith("child");
    act(() => gridButton("展开下一层").click());
    expect(gridButton("收起这一层").textContent).toContain("(2)");
    expect(onLoadBranch).toHaveBeenLastCalledWith("child");
    const updated: GameDocument = { ...doc, nodes: {
      ...doc.nodes, child: { ...doc.nodes.child, children: ["next"], unloadedChildren: 0 },
      next: { id: "next", parentId: "child", children: [], move: { row: 6, col: 6, player: "white" }, boardText: "实际读取的后续", comment: "", marks: [] },
    } };
    act(() => root!.render(<RecordTreePanel {...panelProps({ document: updated, currentId: "root", path: [updated.nodes.root], partial: true, onLoadBranch })}/>));
    expect(nodeLabels()).toContain("实际读取的后续");
    expect(gridButton("展开下一层").disabled).toBe(true);
  });

  it("导航区分未读取和分支末端，读取按钮调用正确节点", () => {
    const doc = { ...documentFixture, nodes: { root: { ...documentFixture.nodes.root, children: [], unloadedChildren: 29 } } };
    const onLoadBranch = vi.fn();
    renderPanel(panelProps({ document: doc, currentId: "root", path: [doc.nodes.root], partial: true, onLoadBranch }));
    act(() => [...container!.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((item) => item.textContent === "导航")!.click());
    expect(container!.querySelector(".tree-navigator-empty")).toBeNull();
    expect(container!.querySelector(".tree-navigator-load")?.textContent).toContain("29 支待读取");
    act(() => container!.querySelector<HTMLButtonElement>(".tree-navigator-load button")!.click());
    expect(onLoadBranch).toHaveBeenCalledWith("root");
  });

  it("导航的棋盘落点、同层比较和最近分叉一致，定位前不改变主棋盘", () => {
    const doc: GameDocument = { ...documentFixture, nodes: {
      root: { ...documentFixture.nodes.root, children: ["a", "b"] },
      a: { ...documentFixture.nodes.child, id: "a", parentId: "root", children: ["a1"] },
      a1: { ...documentFixture.nodes.child, id: "a1", parentId: "a", children: [], move: { row: 6, col: 7, player: "white" } },
      b: { ...documentFixture.nodes.child, id: "b", parentId: "root", children: [], move: { row: 7, col: 8, player: "black" } },
    } };
    const props = panelProps({ document: doc, currentId: "root", path: [doc.nodes.root] });
    renderPanel(props);
    const button = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
    act(() => button("导航").click());
    expect(container!.querySelectorAll(".tree-preview-candidate").length).toBe(2);
    act(() => container!.querySelector<SVGGElement>('[aria-label="落点 H8，候选 1"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container!.querySelector(".tree-navigator-heading b")?.textContent).toBe("H8");
    act(() => button("下一支").click());
    expect(container!.querySelector(".tree-navigator-heading b")?.textContent).toBe("I8");
    expect(button("下一支").disabled).toBe(true);
    act(() => button("上一支").click());
    act(() => container!.querySelector<HTMLButtonElement>(".tree-navigator-row")!.click());
    expect(container!.querySelector(".tree-preview-board .stone")).not.toBeNull();
    act(() => button("返回分叉").click());
    expect(container!.querySelector(".tree-navigator-heading b")?.textContent).toBe("起始局面");
    expect(props.onLocate).not.toHaveBeenCalled();
    act(() => button("定位到主棋盘").click());
    expect(props.onLocate).toHaveBeenCalledWith("root", undefined);
  });

  it("9 路棋谱的图谱、导航和预览都使用实际坐标，星位不越界", () => {
    const doc: GameDocument = { ...documentFixture, metadata: { ...documentFixture.metadata, boardSize: 9 }, nodes: {
      root: { ...documentFixture.nodes.root }, child: { ...documentFixture.nodes.child, move: { row: 0, col: 7, player: "black" } },
    } };
    renderPanel(panelProps({ document: doc, currentId: "child", path: [doc.nodes.root, doc.nodes.child] }));
    expect(nodeLabels()).toContain("H9");
    act(() => [...container!.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((item) => item.textContent === "导航")!.click());
    expect(container!.querySelector(".tree-preview-head")?.textContent).toContain("H9");
    expect(container!.querySelector(".tree-navigator-heading")?.textContent).toContain("H9");
    const stars = [...container!.querySelectorAll(".tree-preview-stars circle")];
    expect(stars.length).toBe(1);
    expect(stars.every((star) => Number(star.getAttribute("cx")) <= 190 && Number(star.getAttribute("cy")) <= 190)).toBe(true);
  });

  it("孩子超过 12 支时，展开这一手能露出全部候选（不再硬截断）", () => {
    // 根挂 20 个孩子（每个一个坐标，方便数）
    const children: Record<string, RecordNode> = {};
    const childIds: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = `c${i}`;
      childIds.push(id);
      children[id] = { id, parentId: "root", children: [], move: { row: 7, col: i % 15, player: i % 2 ? "white" : "black" }, comment: "", marks: [] };
    }
    const manyChildren: GameDocument = {
      ...documentFixture,
      id: "tree-window-test",
      nodes: { root: { id: "root", parentId: null, children: childIds, move: null, comment: "", marks: [] }, ...children },
    };
    renderPanel(panelProps({ document: manyChildren, currentId: "root", path: [manyChildren.nodes.root] }));
    const countChildren = () => container!.querySelectorAll(".tree-node").length;
    // 默认视野 = 当前路径 + 主分支：root 自己 + 它的长子（c0）= 2 个节点。
    // 其余 19 个次分支**刻意不露**（用户 09-22：默认不自动摊开次分支）。
    expect(countChildren()).toBe(2);
    // 点「展开下一层」把这一手摊开 → 20 个候选**全部**出来（旧实现被截在 12）
    clickNode("起始局面");
    act(() => gridButton("展开下一层").click());
    expect(countChildren()).toBe(21);   // 根 + 20 个孩子
  });

  it("连续深入两级分支后逐级返回，并恢复整树展开状态和视野", () => {
    const node = (id: string, parentId: string | null, children: string[] = []): RecordNode => ({ id, parentId, children, move: null, boardText: id, comment: "", marks: [] });
    const doc: GameDocument = { ...documentFixture, id: "focus-history", nodes: {
      root: node("root", null, ["a", "b"]), a: node("a", "root", ["a1"]), a1: node("a1", "a", ["a2"]),
      a2: node("a2", "a1"), b: node("b", "root"),
    } };
    renderPanel(panelProps({ document: doc, currentId: "root", path: [doc.nodes.root] }));
    act(() => gridButton("展开全部").click());
    const original = container!.querySelector(".tree-canvas > g")!.getAttribute("transform");
    clickNode("a");
    act(() => gridButton("只看这支").click());
    clickNode("a1");
    act(() => gridButton("只看这支").click());
    expect(nodeLabels()).not.toContain("b");
    const back = () => [...container!.querySelectorAll<HTMLButtonElement>(".tree-scope-path button")].find((button) => button.textContent === "返回上一级")!;
    act(() => back().click());
    expect(container!.querySelector('[aria-current="location"]')?.textContent).toBe("a");
    act(() => back().click());
    expect(nodeLabels()).toContain("b");
    expect(gridButton("展开全部").getAttribute("aria-pressed")).toBe("true");
    expect(container!.querySelector(".tree-canvas > g")!.getAttribute("transform")).toBe(original);
  });
});
