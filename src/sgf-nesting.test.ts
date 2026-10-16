import { describe, expect, it } from "vitest";
import { exportSgf, importRecordFile } from "./formats";
import type { GameDocument } from "./types";

const importSgf = async (text: string): Promise<GameDocument> =>
  (await importRecordFile(new File([text], "nested.sgf"))).document;

const assertDeepTree = (document: GameDocument, depth: number) => {
  const root = document.nodes[document.rootId];
  expect(root.comment).toBe("root");
  let parent = root;
  for (let level = 0; level < depth; level += 1) {
    const branch = document.nodes[parent.children[0]];
    expect(branch.comment, `level ${level}`).toBe(`level ${level}`);
    expect(parent.preferredChildId).toBe(branch.id);
    expect(parent.children).toHaveLength(level % 1000 === 0 ? 2 : 1);
    if (level % 1000 === 0) {
      expect(document.nodes[parent.children[1]].comment).toBe(`sibling ${level}`);
    }
    parent = branch;
  }
  expect(parent.children).toHaveLength(2);
  expect(parent.children.map((id) => document.nodes[id].comment)).toEqual(["main", "alternate"]);
  expect(document.nodes[parent.children[0]].move).toEqual({ row: 7, col: 7, player: "black" });
  expect(document.nodes[parent.children[1]].move).toEqual({ row: 8, col: 8, player: "white" });
  expect(Object.keys(document.nodes)).toHaveLength(1 + depth + Math.ceil(depth / 1000) + 2);
};

describe("SGF 嵌套游戏树", () => {
  it("12000 层括号变体保留每层注释、同级分支顺序和主线，导出后全部读回", async () => {
    const depth = 12000;
    const parts = ["(;SZ[15]GN[deep]C[root]"];
    for (let level = 0; level < depth; level += 1) parts.push(`(;C[level ${level}]`);
    parts.push("(;B[hh]C[main])(;W[ii]C[alternate])");
    for (let level = depth - 1; level >= 0; level -= 1) {
      parts.push(")");
      if (level % 1000 === 0) parts.push(`(;C[sibling ${level}])`);
    }
    parts.push(")");
    const imported = await importSgf(parts.join(""));
    assertDeepTree(imported, depth);
    assertDeepTree(await importSgf(exportSgf(imported)), depth);
  });

  it("嵌套树缺结束括号仍指出实际出错字符，值内括号不参与配对", async () => {
    const text = "(;SZ[15]C[(root)](;B[hh]C[escaped \\] (value)])";
    await expect(importSgf(text)).rejects.toThrow(`第 ${text.length + 1} 个字符`);
  });

  it("变体后不能继续父树序列，报错位置与空树错误保持准确", async () => {
    const text = "(;SZ[15](;B[hh]);W[ii])";
    await expect(importSgf(text)).rejects.toThrow(`第 ${text.indexOf(";W") + 1} 个字符`);
    await expect(importSgf("((;B[hh]))")).rejects.toThrow("SGF 中没有节点");
    await expect(importSgf("(;SZ[15]())")).rejects.toThrow("SGF 中没有节点");
  });
});
