import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS, ANALYSIS_FRAME_INTERVAL_MS, createEngineProgressPump, createProgressFrameGate } from "./progress-frame-gate";

type Frame = { depth?: number; nodes?: number; winRate?: number; drawRate?: number; candidates?: number[] };

/** 与 App 里 setAiAnalysis 的合并规则同构：depth/nodes 取大者、候选取非空者、其余带了就覆盖。 */
const merge = (previous: Frame, next: Frame): Frame => ({
  ...previous,
  ...next,
  depth: Math.max(next.depth || 0, previous.depth || 0),
  nodes: Math.max(next.nodes || 0, previous.nodes || 0),
  winRate: next.winRate !== undefined ? next.winRate : previous.winRate,
  drawRate: next.drawRate !== undefined ? next.drawRate : previous.drawRate,
  candidates: next.candidates?.length ? next.candidates : previous.candidates,
});

afterEach(() => vi.useRealTimers());

describe("引擎进度帧合流闸", () => {
  it("首帧立即落地，不等待窗口", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 3 });
    expect(applied).toEqual([{ depth: 3 }]);
  });

  it("窗口内的多帧合成一帧落地（10 帧进、1 帧出）", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 1 });
    for (let i = 2; i <= 10; i += 1) gate.push({ depth: i, nodes: i * 100 });
    vi.advanceTimersByTime(ANALYSIS_FRAME_INTERVAL_MS);
    expect(applied).toHaveLength(2);
    expect(applied[1]).toMatchObject({ depth: 10, nodes: 1000 });
  });

  it("窗口内某帧独带的字段不会被后来的帧抹掉", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 1 });
    gate.push({ drawRate: 0.42 });        // 只有这一帧上报和棋率
    gate.push({ depth: 9 });              // 后续帧没带
    vi.advanceTimersByTime(ANALYSIS_FRAME_INTERVAL_MS);
    expect(applied[1]).toMatchObject({ depth: 9, drawRate: 0.42 });
  });

  it("空候选不覆盖已显示的非空候选", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 1 });
    gate.push({ candidates: [7, 8] });
    gate.push({ candidates: [] });
    vi.advanceTimersByTime(ANALYSIS_FRAME_INTERVAL_MS);
    expect(applied[1].candidates).toEqual([7, 8]);
  });

  it("flush 补齐窗口里的终值（结果落地前不能丢）", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 1 });
    gate.push({ depth: 27, nodes: 99_999 });
    gate.flush();
    expect(applied).toHaveLength(2);
    expect(applied[1]).toMatchObject({ depth: 27, nodes: 99_999 });
    vi.advanceTimersByTime(1000);
    expect(applied).toHaveLength(2); // flush 后定时器不得再补一帧
  });

  it("reset 丢弃上一轮的待发帧（换手不在新局面上闪旧读数）", () => {
    vi.useFakeTimers();
    const applied: Frame[] = [];
    const gate = createProgressFrameGate<Frame>((f) => applied.push(f), merge);
    gate.push({ depth: 1 });
    gate.push({ depth: 40 });
    gate.reset();
    vi.advanceTimersByTime(1000);
    expect(applied).toHaveLength(1);
    gate.push({ depth: 2 });
    expect(applied[1]).toEqual({ depth: 2 }); // 新一轮首帧仍立即落地
  });

  it("持续满速出帧时落点稳定在窗口率上（真机 10 帧/秒 → ≤4 帧/秒）", () => {
    vi.useFakeTimers();
    let applied = 0;
    const gate = createProgressFrameGate<Frame>(() => { applied += 1; }, merge);
    for (let t = 0; t < 1000; t += 100) { gate.push({ depth: t / 100 }); vi.advanceTimersByTime(100); }
    expect(applied).toBeLessThanOrEqual(4);
    expect(applied).toBeGreaterThanOrEqual(3);
  });
});

describe("读数/候选点两档合流（闪动的正面修复）", () => {
  it("同样是 10 帧/秒：读数落地 ~3 次/秒，候选点只落地 ~1.7 次/秒", () => {
    vi.useFakeTimers();
    let scalars = 0, candidates: string[] = [];
    const pump = createEngineProgressPump<Frame, string[]>(
      () => { scalars += 1; },
      merge,
      (list) => { candidates = candidates.concat(list); },
    );
    // 2 秒、每秒 10 帧，每帧的「榜单」都换一种（搜索初期就是这样）
    for (let i = 0; i < 20; i += 1) {
      pump.push({ scalars: { depth: i }, candidates: [`set${i}`] });
      vi.advanceTimersByTime(100);
    }
    pump.flush();
    expect(scalars).toBeGreaterThanOrEqual(6);    // 320ms 窗口 → 约 3.1 次/秒
    expect(candidates.length).toBeLessThanOrEqual(5); // 600ms 窗口 → 约 1.7 次/秒
    expect(candidates.length).toBeLessThan(scalars);
    expect(candidates[candidates.length - 1]).toBe("set19"); // 终值不丢：flush 落在最新一帧
  });

  it("候选点在窗口内只保留最新一帧（排行榜不该被窗口里的旧帧往后拽）", () => {
    vi.useFakeTimers();
    let latest: string[] = [];
    const pump = createEngineProgressPump<Frame, string[]>(() => {}, merge, (list) => { latest = list; });
    pump.push({ candidates: ["old"] });
    pump.push({ candidates: ["new"] });
    vi.advanceTimersByTime(ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS);
    expect(latest).toEqual(["new"]);
  });

  it("候选为空的一帧不投递（空榜不得把棋盘上的候选抹掉）", () => {
    vi.useFakeTimers();
    let applied = 0;
    const pump = createEngineProgressPump<Frame, string>(() => {}, merge, () => { applied += 1; });
    pump.push({ scalars: { depth: 1 }, candidates: "Points" });
    vi.advanceTimersByTime(ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS);
    expect(applied).toBe(1);
    pump.push({ scalars: { depth: 2 } });   // 这一帧没带候选
    vi.advanceTimersByTime(1000);
    expect(applied).toBe(1);
  });

  it("reset 让两档一起作废（停止/换手不再有残留帧落地）", () => {
    vi.useFakeTimers();
    let scalarApplies = 0, candidateApplies = 0;
    const pump = createEngineProgressPump<Frame, string>(() => { scalarApplies += 1; }, merge, () => { candidateApplies += 1; });
    pump.push({ scalars: { depth: 1 }, candidates: "a" });   // 首帧立即落地
    pump.push({ scalars: { depth: 2 }, candidates: "b" });
    pump.reset();
    vi.advanceTimersByTime(ANALYSIS_FRAME_INTERVAL_MS + ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS + 10);
    expect(scalarApplies).toBe(1);
    expect(candidateApplies).toBe(1);
  });
});
