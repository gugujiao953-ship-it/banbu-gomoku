import { describe, expect, it } from "vitest";
import { buildCompactRenLibIndex, compactRegisterAlias, createLazyDocument } from "../../compact-index";
import type { GameDocument, RecordNode } from "../../types";
import { treeAncestorPath, treeChildPage, treeSiblingChoices } from "./tree-navigation";
import { buildVisibleTree } from "./visible-tree";
import { remainingLayersOf } from "./tree-expansion";

const node = (id: string, parentId: string | null, children: string[] = []): RecordNode => ({ id, parentId, children, move: null, comment: "", marks: [] });
const documentWith = (nodes: Record<string, RecordNode>): GameDocument => ({
  id: "navigation-test", version: 1, rootId: "root", nodes,
  metadata: { title: "导航", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "", updatedAt: "",
});
const broadRecord = (count: number) => {
  const ids = Array.from({ length: count }, (_, i) => `b${i}`);
  return documentWith(Object.fromEntries([ ["root", node("root", null, ids)], ...ids.map((id) => [id, node(id, "root")]) ]));
};
const visible = (document: GameDocument, patch: Partial<Parameters<typeof buildVisibleTree>[0]> = {}) => buildVisibleTree({
  document, currentId: "root", selectedId: "root", path: [document.nodes.root], mainLineIds: new Set(["root"]),
  openLevels: new Map(), collapsedIds: new Set(), treeMode: "expanded", focusId: null, ...patch,
});

describe("完整候选导航与完整展开范围", () => {
  it("普通和懒加载谱可比较页外相邻支，首尾不循环到另一支", () => {
    const plain = broadRecord(513);
    const lazy = createLazyDocument(plain, buildCompactRenLibIndex(plain));
    const lazyId = treeChildPage(lazy, lazy.rootId, 511, 2).ids;
    for (const [doc, middle, last] of [[plain, "b511", "b512"], [lazy, lazyId[0], lazyId[1]]] as const) {
      expect(treeSiblingChoices(doc, middle)).toMatchObject({ position: 511, total: 513, next: last });
      expect(treeSiblingChoices(doc, last)).toMatchObject({ position: 512, next: undefined });
      expect(treeSiblingChoices(doc, treeChildPage(doc, doc.rootId, 0, 1).ids[0]).previous).toBeUndefined();
      expect(treeSiblingChoices(doc, doc.rootId).total).toBe(0);
    }
  });
  it("普通和紧凑索引都可分页读到第 513 支，且不会把未读取分支当成末端", () => {
    const plain = broadRecord(513);
    const index = buildCompactRenLibIndex(plain);
    const lazy = createLazyDocument(plain, index);
    for (const doc of [plain, lazy]) {
      expect(treeChildPage(doc, "root", 512, 16)).toMatchObject({ ids: ["b512"], loaded: 513, total: 513 });
      expect(treeChildPage(doc, "root", 0, 0).ids).toEqual([]);
      const ids = Array.from({ length: 33 }, (_, i) => treeChildPage(doc, "root", i * 16, 16).ids).flat();
      expect(ids).toEqual(plain.nodes.root.children);
    }
    plain.nodes.b512.unloadedChildren = 29;
    expect(treeChildPage(plain, "b512", 0, 16)).toMatchObject({ ids: [], loaded: 0, unloaded: 29, total: 29 });
  });

  it("展开宽树包含全部 513 个孩子及页外所选节点", () => {
    const doc = broadRecord(513);
    const result = visible(doc, { selectedId: "b512" });
    expect(result.entries.length).toBe(514);
    expect(result.entries.map((entry) => entry.id)).toContain("b512");
    expect(result.limited).toBe(false);
    expect(result.entries.find((entry) => entry.id === "root")?.folded).toBe(false);
  });

  it("深枝和后面的同层候选都完整进入布局", () => {
    const doc = broadRecord(29);
    let parent = "b0";
    for (let i = 0; i < 300; i += 1) {
      const id = `deep${i}`;
      doc.nodes[parent].children = [id];
      doc.nodes[id] = node(id, parent);
      parent = id;
    }
    const result = visible(doc);
    expect(result.entries.length).toBe(330);
    for (const id of doc.nodes.root.children) expect(result.entries.some((entry) => entry.id === id)).toBe(true);
    expect(result.limited).toBe(false);
  });

  it("紧凑库的全部 10000 支参与布局，屏幕外节点保持懒加载", () => {
    const plain = broadRecord(10000);
    const lazy = createLazyDocument(plain, buildCompactRenLibIndex(plain));
    let reads = 0;
    const nodes = new Proxy(lazy.nodes, { get(target, key) { reads += 1; return Reflect.get(target, key); } });
    compactRegisterAlias(lazy, nodes);
    const counted = { ...lazy, nodes };
    const result = visible(counted);
    expect(result.entries.length).toBe(10001);
    expect(result.entries[result.entries.length - 1]?.id).toBe("b9999");
    expect(reads).toBeLessThan(20);
    expect(result.entries[result.entries.length - 1]?.node.id).toBe("b9999");
  });

  it("12000 层注释链可浏览末端，并计算展开层数而不递归溢出", () => {
    const doc = documentWith({ root: node("root", null) });
    let parent = "root";
    for (let i = 0; i < 12000; i += 1) {
      const id = `deep${i}`;
      doc.nodes[parent].children = [id];
      doc.nodes[id] = node(id, parent);
      parent = id;
    }
    const path = treeAncestorPath(doc, parent);
    expect(path.length).toBe(12001);
    const result = visible(doc, { selectedId: parent, currentId: parent, path });
    expect(result.entries.length).toBe(12001);
    expect(result.entries[result.entries.length - 1]?.isCurrent).toBe(true);
    expect(result.limited).toBe(false);
    expect(remainingLayersOf(doc, "root")).toBe(12000);
    const lazy = createLazyDocument(doc, buildCompactRenLibIndex(doc));
    expect(remainingLayersOf(lazy, "root")).toBe(12000);
  });

  it("损坏的父链循环不会卡住导航", () => {
    const doc = documentWith({ root: node("root", "a", ["a"]), a: node("a", "root", ["root"]) });
    expect(treeAncestorPath(doc, "a").length).toBe(2);
    expect(visible(doc).entries.length).toBeLessThanOrEqual(2);
  });

  it("只看这支时不为范围外的当前路径浪费画布配额", () => {
    const doc = broadRecord(200);
    doc.nodes.fork = node("fork", "root", doc.nodes.root.children);
    for (const id of doc.nodes.fork.children) doc.nodes[id].parentId = "fork";
    doc.nodes.root.children = ["fork", "other"];
    let parent = "root";
    for (let i = 0; i < 99; i += 1) {
      const id = i ? `other${i}` : "other";
      if (i) doc.nodes[parent].children = [id];
      doc.nodes[id] = node(id, parent);
      parent = id;
    }
    const result = visible(doc, { currentId: parent, selectedId: "fork", path: treeAncestorPath(doc, parent), focusId: "fork", treeMode: "default" });
    expect(result.entries.length).toBe(202);
    expect(result.entries.some((entry) => entry.id === "b199")).toBe(true);
    expect(result.limited).toBe(false);
  });
});
