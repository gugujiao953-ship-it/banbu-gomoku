// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameDocument, Position } from "./types";
import { DpViewSession } from "./dp-view-session";

/**
 * `loadBranchByNodeId` 的 id 反解（2026-10-11 P7）。
 *
 * 节点 id 由 `dpNodeIdFor` 决定：根局面 id **就是** `base.rootId`、不带 `-dp-` 前缀，
 * 其余是 `<base.id>-dp-<hex 路径>`。解析里漏掉「根」这一条时，函数会**静默早退**，
 * 而树上那个节点的 `unloadedChildren > 0` 仍会让「展开下一层」照常可点
 * （`remainingLayersOf` 见未加载分支返回 Infinity）——用户看到的又是
 * 「点了没反应、数字在涨」（与 R177 修的同一个形状，只是触发点换成了根）。
 *
 * 这里把 worker 换成假对象，只验证**接线与 id 反解**：问没问、问的是哪条路径。
 * 真库上的行为由 `qa/dp-battery.mjs` 与 `qa/probe-p1-wide-fork.mjs` 守着。
 */

type FakeQuery = { comment: string; marks: never[]; branches: { position: Position; label: string; value: number }[] };

/** 假 worker：postMessage 里记下路径，并异步回一条空查询（open/query/queryMany 都答）。 */
const sessionWithFakeWorker = (): { session: DpViewSession; asked: string[] } => {
  const asked: string[] = [];
  vi.stubGlobal("Worker", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = (message: { requestId: number; cmd: string; path?: Position[]; paths?: Position[][] }) => {
      if (message.cmd === "open") {
        queueMicrotask(() => this.onmessage?.({ data: { requestId: message.requestId, ok: true, count: 1, query: empty() } } as MessageEvent));
        return;
      }
      if (message.path) asked.push(key(message.path));
      (message.paths || []).forEach((path) => asked.push(key(path)));
      queueMicrotask(() => this.onmessage?.({ data: {
        requestId: message.requestId,
        ok: true,
        query: empty(),
        queries: (message.paths || []).map(() => empty()),
      } } as MessageEvent));
    };
    terminate = vi.fn();
  });
  return { session: new DpViewSession(), asked };
};

const key = (path: Position[]) => path.map((p) => `${p.row},${p.col}`).join("|");
const empty = (): FakeQuery => ({ comment: "", marks: [], branches: [] });

/** 冲干净微任务队列：会话内部的 `queryPath` 是 async 链，断言前要多让几轮。 */
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DpViewSession 按节点读取的 id 反解", () => {
  it("从根直接跳到旁支第3手，再换到另一条分支，使用完整源路径", async () => {
    const { session, asked } = sessionWithFakeWorker();
    await session.open(new File([new Uint8Array([1])], "t.db"));
    await flush();
    const base = (session as unknown as { base: GameDocument }).base;
    const first = `${base.id}-dp-77-66-55`;
    const result = await session.moveToNodeId(first, { row: 5, col: 5 });
    expect(result.currentId).toBe(first);
    expect(asked).toContain("7,7|6,6|5,5");
    expect(result.document.nodes[first].parentId).toBe(`${base.id}-dp-77-66`);
    const second = `${base.id}-dp-77-78-89`;
    const switched = await session.moveToNodeId(second);
    expect(switched.currentId).toBe(second);
    expect(asked).toContain("7,7|7,8|8,9");
    expect((await session.moveToNodeId(base.rootId)).currentId).toBe(base.rootId);
    session.close();
  });

  it("异文档和损坏的节点 id 拒绝跳转，保持当前路径", async () => {
    const { session } = sessionWithFakeWorker();
    await session.open(new File([new Uint8Array([1])], "t.db"));
    await flush();
    const base = (session as unknown as { base: GameDocument }).base;
    await expect(session.moveToNodeId("unknown-dp-77")).rejects.toThrow("路径");
    await expect(session.moveToNodeId(`${base.id}-dp-ff`)).rejects.toThrow("路径");
    expect((await session.root()).currentId).toBe(base.rootId);
    session.close();
    await expect(session.moveToNodeId(base.rootId)).rejects.toThrow("已关闭");
  });

  it("根节点 id（就是 base.rootId、不带 -dp-）也能触发一次读取，而不是静默早退", async () => {
    const { session, asked } = sessionWithFakeWorker();
    await session.open(new File([new Uint8Array([1])], "t.db"));
    await flush();
    asked.length = 0;   // open 之后的预取是异步的，这里只关心显式调用那一下
    const base = (session as unknown as { base: GameDocument }).base;
    const updates: GameDocument[] = [];
    session.onUpdate = (document) => updates.push(document);

    session.loadBranchByNodeId(base.rootId);   // 根：id 不带前缀
    await flush();

    // 先把「修复前为什么会静默早退」钉死在案：根 id 不满足 `<base.id>-dp-` 前缀，
    // 旧实现走到 `if (!nodeId.startsWith(prefix)) return;` 就直接返回了。
    expect(base.rootId.startsWith(`${base.id}-dp-`)).toBe(false);
    // 修复后必须问过根路径（路径为空 → key 为 ""）。
    expect(asked).toContain("");
    expect(updates.length).toBeGreaterThan(0);
  });

  it("`<base.id>-dp-<hex>` 的 id 反解出正确位置路径；认不出的 id 不打扰 worker", async () => {
    const { session, asked } = sessionWithFakeWorker();
    await session.open(new File([new Uint8Array([1])], "t.db"));
    await flush();
    asked.length = 0;
    const base = (session as unknown as { base: GameDocument }).base;

    // 路径 H8(7,7) → I8(7,8)：hex 就是 "77"、"78"（dpPathKey 的写法）
    session.loadBranchByNodeId(`${base.id}-dp-77-78`);
    await flush();
    expect(asked).toContain("7,7|7,8");

    const before = asked.length;
    session.loadBranchByNodeId("some-other-document-dp-77");
    await flush();
    expect(asked.length).toBe(before);   // 不认识的 id：什么都不问，也不报错
  });
});
