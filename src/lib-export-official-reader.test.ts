import { describe, expect, it } from "vitest";
import { createDocument } from "./game";
import { exportLib } from "./lib-export";
import type { GameDocument, RecordNode } from "./types";

/**
 * LIB 导出必须能被**官方 RenLib 读取器**读懂。
 *
 * 生产环境的 .lib 导入不走 src/formats.ts（那里对 .lib 直接抛错，改由
 * RenLibWebViewSession 打开），而 lib-export.ts 是我们自己的 writer。于是
 * 「writer ↔ 官方读取器」这一对从来没有被验证过：既有的 lib-export.test.ts 用
 * importRenLibLegacy 对拍，那是我方 legacy 解析器，与 writer 共享同一套（错的）
 * 结构位约定，所以互相印证得很好，却与官方格式相反。
 *
 * 本文件的 decodeOfficialLib 忠实移植官方 src/renlib-web/RenLibDoc.js 的读取循环
 * （m_MoveList 路径表 + m_Stack + addMove 按坐标排序插入），位定义取自同目录
 * MoveNode.js：DOWN=0x80 表示有子节点，RIGHT=0x40 表示回退一层。
 */

interface LibNode { pos: number; down: LibNode | null; right: LibNode | null; children: LibNode[] }

const makeNode = (pos: number): LibNode => ({ pos, down: null, right: null, children: [] });

/** 官方 MoveNode.PointToPos：16*(y-1)+x，即 posByte 本身。 */
const lessThan = (a: LibNode, b: LibNode) => a.pos < b.pos;

/** 官方 RenLibDoc.addMove：作为子节点插入，并按坐标升序维护 down/right 链。 */
const addMove = (parent: LibNode, node: LibNode) => {
  parent.children.push(node);
  if (!parent.down) { parent.down = node; return; }
  if (lessThan(node, parent.down)) { node.right = parent.down; parent.down = node; return; }
  let cursor = parent.down;
  for (;;) {
    if (!cursor.right) { cursor.right = node; return; }
    if (lessThan(node, cursor.right)) { node.right = cursor.right; cursor.right = node; return; }
    cursor = cursor.right;
  }
};

const HEADER_SIZE = 20;

/**
 * 官方读取器（结构部分）。返回 root，children 已按坐标升序。
 * 逐字对应 RenLibDoc.js:524-647 的 while 循环。
 */
export const decodeOfficialLib = (bytes: Uint8Array) => {
  const root = makeNode(0);
  const path: LibNode[] = [root];
  let index = 0;
  let current = root;
  const stack: number[] = [];
  let cursor = HEADER_SIZE;
  const taken = new Set<LibNode>();

  const readPair = () => {
    const a = bytes[cursor]; const b = bytes[cursor + 1];
    cursor += 2;
    return [a ?? 0, b ?? 0] as const;
  };
  // readNewComment / readBoardText：按 2 字节成对消费，遇到 0 字节即停。
  const skipText = () => {
    for (;;) {
      const [a, b] = readPair();
      if (a === 0) break;
      if (b === 0) break;
    }
  };

  while (cursor < bytes.length) {
    const [posByte, info] = readPair();
    let extended = 0;
    if (info & 0x01) {
      const [info2, info1] = readPair();
      extended = (info2 << 16) | (info1 << 8);
    }
    // 位置为 0（NullPoint）的记录被官方读取器整条跳过：不建节点、不进路径表。
    if (posByte !== 0) {
      let existing: LibNode | null = null;
      for (const child of current.children) if (child.pos === posByte) { existing = child; break; }
      if (existing) {
        current = existing;
      } else {
        const node = makeNode(posByte);
        addMove(current, node);
        taken.add(node);
        current = node;
        index += 1;
        path[index] = node;
      }
    }
    if (info & 0x08) skipText();
    if (extended & 0x100) skipText();
    if (info & 0x80) { if (index > 0) stack.push(index); }
    if (info & 0x40) {
      if (stack.length) { const popped = stack.pop()!; index = popped - 1; current = path[index]; }
      else { index = 0; current = path[0]; }
    }
  }
  return { root, orphaned: bytes.length - cursor };
};

/** 结构签名：节点坐标 + 子树。子节点按官方 down/right 链顺序（即读取器的排序结果），
 *  不是插入顺序——数组里存的是插入序，链上才是官方读取器眼中真正的兄弟顺序。 */
const signature = (node: LibNode, depth = 0): string => {
  if (depth > 60) return "…";
  const chain: LibNode[] = [];
  for (let cursor: LibNode | null = node.down; cursor; cursor = cursor.right) chain.push(cursor);
  return `${node.pos}[${chain.map((child) => signature(child, depth + 1)).join(",")}]`;
};

/** 用坐标构造一棵任意形状的文档（不依赖 addMove 的轮流落子）。 */
const buildDocument = (tree: { row: number; col: number; children?: unknown[] }): GameDocument => {
  const document = createDocument("lib-official");
  const rootId = document.rootId;
  const nodes: Record<string, RecordNode> = { ...document.nodes };
  const walk = (parentId: string, spec: { row: number; col: number; children?: unknown[] }, depth: number, player: "black" | "white") => {
    const id = `n-${depth}-${spec.row}-${spec.col}`;
    nodes[id] = { id, parentId, children: [], move: { row: spec.row, col: spec.col, player }, comment: "", marks: [] };
    nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, id] };
    for (const child of (spec.children ?? []) as Array<{ row: number; col: number; children?: unknown[] }>) {
      walk(id, child, depth + 1, player === "black" ? "white" : "black");
    }
  };
  for (const child of tree.children as Array<{ row: number; col: number; children?: unknown[] }>) {
    walk(rootId, child, 1, "black");
  }
  return { ...document, nodes };
};

/** 文档树 → 与 signature 同口径的字符串（子节点按坐标升序，模拟读取器的排序）。 */
const documentSignature = (document: GameDocument, id: string, depth = 0): string => {
  if (depth > 60) return "…";
  const node = document.nodes[id];
  if (!node) return "missing";
  const pos = node.move ? 16 * node.move.row + node.move.col + 1 : 0;
  const children = node.children
    .map((child) => ({ child, node: document.nodes[child] }))
    .filter((entry) => entry.node?.move)
    .sort((a, b) => (16 * a.node!.move!.row + a.node!.move!.col) - (16 * b.node!.move!.row + b.node!.move!.col))
    .map((entry) => documentSignature(document, entry.child, depth + 1));
  return `${pos}[${children.join(",")}]`;
};

const shapes: Array<{ name: string; tree: { row: number; col: number; children?: unknown[] } }> = [
  { name: "主线", tree: { row: 7, col: 7, children: [{ row: 7, col: 8, children: [{ row: 6, col: 8 }] }] } },
  {
    name: "一级分枝",
    tree: { row: 7, col: 7, children: [{ row: 7, col: 8, children: [{ row: 8, col: 7 }] }, { row: 8, col: 8 }] },
  },
  {
    name: "老分支带续手 + 新分支（用户报告的场景）",
    tree: {
      row: 7, col: 7,
      children: [
        { row: 7, col: 8, children: [{ row: 6, col: 8, children: [{ row: 6, col: 7 }] }] },
        { row: 8, col: 8, children: [{ row: 8, col: 9 }] },
      ],
    },
  },
  {
    name: "两条深分支",
    tree: {
      row: 7, col: 7,
      children: [
        { row: 6, col: 6, children: [{ row: 5, col: 5, children: [{ row: 4, col: 4 }] }] },
        { row: 8, col: 8, children: [{ row: 9, col: 9, children: [{ row: 10, col: 10 }] }] },
      ],
    },
  },
  {
    name: "三层分枝",
    tree: {
      row: 7, col: 7,
      children: [
        { row: 7, col: 8, children: [{ row: 8, col: 8, children: [{ row: 9, col: 8 }, { row: 9, col: 9 }] }] },
        { row: 6, col: 6, children: [{ row: 5, col: 6 }] },
        { row: 8, col: 5 },
      ],
    },
  },
  {
    name: "首手后两条分支各带两子",
    tree: {
      row: 7, col: 7,
      children: [
        { row: 7, col: 8, children: [{ row: 6, col: 8 }, { row: 8, col: 8 }] },
        { row: 8, col: 7, children: [{ row: 9, col: 7 }, { row: 6, col: 6 }] },
      ],
    },
  },
  {
    name: "一层 10 个兄弟",
    tree: { row: 7, col: 7, children: Array.from({ length: 10 }, (_, index) => ({ row: 5, col: 3 + index })) },
  },
  {
    name: "摆局节点被提升",
    tree: {
      row: 7, col: 7,
      children: [{ row: 7, col: 8, children: [{ row: 6, col: 8 }] }, { row: 8, col: 7 }],
    },
  },
];

describe("LIB 导出 vs 官方 RenLib 读取器", () => {
  for (const shape of shapes) {
    it(`官方读取器能还原：${shape.name}`, () => {
      const document = buildDocument(shape.tree);
      const { bytes } = exportLib(document);
      const { root } = decodeOfficialLib(bytes);
      expect(signature(root)).toBe(documentSignature(document, document.rootId));
    });
  }

  it("随机树模糊测试：结构必须一致", () => {
    let seed = 20260916;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const failures: string[] = [];
    for (let round = 0; round < 400; round += 1) {
      // 生成一棵随机树：深度 ≤ 5，每个节点 0–3 个子节点，子节点位置随机（不排序）
      const used = new Set<number>();
      const makeTree = (depth: number): { row: number; col: number; children?: unknown[] } => {
        let row = 0, col = 0, attempts = 0;
        do {
          row = Math.floor(rnd() * 15); col = Math.floor(rnd() * 15); attempts += 1;
        } while (used.has(row * 15 + col) && attempts < 40);
        used.add(row * 15 + col);
        const count = depth >= 5 ? 0 : Math.floor(rnd() * 4);
        const children: Array<{ row: number; col: number; children?: unknown[] }> = [];
        for (let index = 0; index < count; index += 1) children.push(makeTree(depth + 1));
        return { row, col, ...(children.length ? { children } : {}) };
      };
      const roots = Math.max(1, Math.floor(rnd() * 3));
      const tree = { row: 7, col: 7, children: Array.from({ length: roots }, () => makeTree(1)) };
      const document = buildDocument(tree);
      let decoded: string;
      try {
        const { bytes } = exportLib(document);
        decoded = signature(decodeOfficialLib(bytes).root);
      } catch (error) {
        failures.push(`round ${round}: 导出抛错 ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const expected = documentSignature(document, document.rootId);
      if (decoded !== expected) failures.push(`round ${round}:\n  文档 ${expected}\n  读回 ${decoded}`);
      if (failures.length >= 3) break;
    }
    expect(failures.join("\n")).toBe("");
  });
});
