import { describe, expect, it } from "vitest";
// @ts-expect-error Node is available to Vitest, not the browser application.
import { readFileSync } from "node:fs";
import { dpCanonicalKey, type DpStateIndex, openDpDatabaseIndex, queryDpPosition } from "./formats";

/**
 * DP 子节点查找快路径的逐位等价门禁（2026-09-19）。
 *
 * `queryDpPosition` 现在复用父局面的规范形来找子节点（每个候选点只在规范棋子表里插
 * 一颗子），而不再是「每个候选点重算一次全盘规范键」。这条优化有 9.6× 的实测收益
 * （11.37ms → 1.19ms/局面），但它动的是数据库键的构造，一旦等价性破掉，用户看到的
 * 会是「某些局面莫名少了几支分支」——所以这里用真实库把两条路径逐个局面比对。
 *
 * 参照实现就是改造前的那段循环，故意原样保留：它是「旧行为」的冻结副本。
 */
const boardOf = (path: Array<{ row: number; col: number }>) => {
  const board = new Uint8Array(225);
  path.forEach((point, index) => { board[point.row * 15 + point.col] = index % 2 + 1; });
  return board;
};
const keyString = (key: Uint8Array) => Array.from(key).join(",");

const referenceBranches = (states: DpStateIndex, position: Uint8Array, sideToMove: 0 | 1) => {
  const out: Array<{ index: number; record: number[] }> = [];
  for (let index = 0; index < 225; index += 1) {
    if (position[index]) continue;
    const next = position.slice(); next[index] = sideToMove + 1;
    const child = states.get(keyString(dpCanonicalKey(next, (sideToMove ^ 1) as 0 | 1).key));
    if (child) out.push({ index, record: Array.from(child.record) });
  }
  return out;
};
const currentBranches = (states: DpStateIndex, position: Uint8Array, sideToMove: 0 | 1) =>
  queryDpPosition(states, position, sideToMove).branches.map((branch) => ({
    index: branch.position.row * 15 + branch.position.col,
    record: Array.from(branch.state.record),
  }));

describe("DP 子节点查找快路径", () => {
  it("与朴素路径在真实库的 150 个局面上逐位等价", async () => {
    const bytes = readFileSync(new URL("../public/records/九天指南v5-1.db", import.meta.url));
    const states: DpStateIndex = await openDpDatabaseIndex(new Blob([bytes]));

    // 从根做广度优先，收集真实局面（含对称与转置，这些正是键构造最容易出错的地方）
    const samples: Array<Array<{ row: number; col: number }>> = [[]];
    const queue = [...samples];
    while (queue.length && samples.length < 150) {
      const path = queue.shift()!;
      const result = queryDpPosition(states, boardOf(path), (path.length % 2) as 0 | 1);
      for (const branch of result.branches) {
        if (samples.length >= 150) break;
        const next = [...path, branch.position];
        samples.push(next); queue.push(next);
      }
    }
    expect(samples.length).toBeGreaterThan(100);

    const mismatched: string[] = [];
    for (const path of samples) {
      const position = boardOf(path);
      const sideToMove = (path.length % 2) as 0 | 1;
      const reference = referenceBranches(states, position, sideToMove);
      const current = currentBranches(states, position, sideToMove);
      if (JSON.stringify(reference) !== JSON.stringify(current)) {
        mismatched.push(`深度 ${path.length}：朴素 ${reference.length} 支 / 快路径 ${current.length} 支`);
      }
    }
    expect(mismatched.slice(0, 5)).toEqual([]);
  }, 60000);
});
