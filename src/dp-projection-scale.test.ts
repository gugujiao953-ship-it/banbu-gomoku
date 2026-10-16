import { describe, expect, it } from "vitest";
// @ts-expect-error Node is available to Vitest, not the browser application.
import { readFileSync } from "node:fs";
import { dpRecordValue, type DpStateIndex, openDpDatabaseIndex, queryDpPosition } from "./formats";
import { buildDpProjection, dpPathKey, type DpQuery } from "./dp-projection";
import { createDocument } from "./game";

/**
 * DP 投影的规模门禁（2026-09-19）。
 *
 * 起因：第一版给「每个已加载局面的每一条分支」都造了一个占位节点，900 个局面
 * → **11023 个节点、单次投影 58.6ms**，而且每次走子/每批预取都重建一次 → 用户
 * 实测「打谱走一步会有点卡」。改成「只记未加载数量、不给每支造节点」后是
 * 900 个局面 → 约 900 个节点、个位数毫秒。
 *
 * 这里把两个数字都钉住：节点数不能随分支数膨胀，投影耗时不能回到几十毫秒。
 */
type Point = { row: number; col: number };

const boardOf = (path: Point[]) => {
  const board = new Uint8Array(225);
  path.forEach((point, index) => { board[point.row * 15 + point.col] = index % 2 + 1; });
  return board;
};

const readPosition = (states: DpStateIndex, path: Point[]): DpQuery => {
  const result = queryDpPosition(states, boardOf(path), (path.length % 2) as 0 | 1);
  return {
    comment: result.comment,
    marks: [],
    branches: result.branches.map((branch) => ({ position: branch.position, label: branch.label, value: dpRecordValue(branch.state.record) })),
  };
};

describe("DP 投影规模", () => {
  it("900 个已加载局面不会膨胀成上万个节点，单次投影也在毫秒级", async () => {
    const bytes = readFileSync(new URL("../public/records/九天指南v5-1.db", import.meta.url));
    const states: DpStateIndex = await openDpDatabaseIndex(new Blob([bytes]));
    const cache = new Map<string, DpQuery>();
    cache.set("", readPosition(states, []));
    const frontier: Point[][] = [[]];
    let pushed = 0;
    while (frontier.length && cache.size < 900) {
      const path = frontier.shift()!;
      const key = dpPathKey(path);
      const loaded = cache.get(key) || readPosition(states, path);
      cache.set(key, loaded);
      for (const branch of loaded.branches) {
        if (pushed >= 900) break;
        pushed += 1;
        frontier.push([...path, branch.position]);
      }
    }
    expect(cache.size).toBeGreaterThanOrEqual(400);

    const base = createDocument("九天指南v5-1", 15);
    const started = performance.now();
    const { document } = buildDpProjection({ base, path: [], cache });
    const elapsed = performance.now() - started;
    const nodes = Object.keys(document.nodes).length;
    const withUnloaded = Object.values(document.nodes).filter((node) => node.unloadedChildren).length;

    // 一个已加载局面最多贡献一个节点（旧版是「每条分支一个占位节点」，会到 1.1 万）
    expect(nodes).toBeLessThanOrEqual(cache.size + 4);
    // 耗时只做数量级兜底：全量并行时 CPU 争抢会让 40ms 这种紧阈值假失败（项目里有先例），
    // 真正的护栏是上面的节点数——膨胀十倍的话这里也会跟着爆。
    expect(elapsed).toBeLessThan(300);
    // 未加载的分支要如实记数（树上画「还有 N 支未加载」），不能悄悄当叶子
    expect(withUnloaded).toBeGreaterThan(50);
  }, 120000);
});
