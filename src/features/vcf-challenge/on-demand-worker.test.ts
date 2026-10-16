import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickMatchedProblem } from "./problems";
import { loadVcfMaterial } from "../vcf/vcf-corpus";
import type { GeneratedVcfPuzzle } from "../vcf/vcf-corpus";

vi.mock("../vcf/vcf-corpus", async (importOriginal) => ({
  ...await importOriginal<typeof import("../vcf/vcf-corpus")>(),
  loadVcfMaterial: vi.fn(async () => ({ v: 1, count: 1, items: [{
    i: 1, a: "black", d: 5, u: 1, f: null,
    b: [[7, 6], [7, 7], [7, 8]], w: [[7, 5]], l: [[7, 9, 1]],
  }] })),
}));

const workers: StubWorker[] = [];
class StubWorker {
  onmessage: ((event: MessageEvent<{ type: string; puzzles: GeneratedVcfPuzzle[] }>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { workers.push(this); }
}

describe("VCF 挑战即时补题的工作量与取消", () => {
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal("Worker", StubWorker);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("fetch", async () => ({ ok: false }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const match = (signal?: AbortSignal) => pickMatchedProblem({
    tier: "auto", attacker: "black", rating: 9999, solved: new Set(), signal,
  });

  it("只请求当前需要的一题，不等待另外两题的生成", async () => {
    const pending = match();
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(workers[0].postMessage.mock.calls[0][0]).toMatchObject({ type: "generate", count: 1 });
    expect(workers[0].postMessage.mock.calls[0][0]).not.toHaveProperty("material");
    workers[0].onmessage?.(new MessageEvent<{ type: string; puzzles: GeneratedVcfPuzzle[] }>("message", { data: { type: "result", puzzles: [{
      title: "generated", size: 15, rules: "renju", attacker: "black", depth: 34,
      black: [], white: [], solution: [], uniqueFirst: true, novel: true, fallback: null, sourceIndex: 0,
    }] } }));
    expect(await pending).toMatchObject({ depth: 34, generatedOnDemand: true, source: "novel" });
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("取消匹配时立即终止生成线程，不继续找兜底题", async () => {
    const controller = new AbortController();
    const pending = match(controller.signal);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    controller.abort();
    expect(await pending).toBeNull();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("已经取消的请求不会创建生成线程", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await match(controller.signal)).toBeNull();
    expect(workers).toHaveLength(0);
  });

  it("素材加载不可用时仍可启动空盘构造", async () => {
    vi.mocked(loadVcfMaterial).mockResolvedValue(null);
    const controller = new AbortController();
    const pending = match(controller.signal);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    controller.abort();
    expect(await pending).toBeNull();
  });
});
