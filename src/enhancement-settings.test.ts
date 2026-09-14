// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENHANCEMENT_SETTINGS, ENHANCEMENT_SETTINGS_KEY, getAnalysisMode, loadEnhancementSettings, normalizeEnhancementSettings, saveEnhancementSettings, withAnalysisMode } from "./enhancement-settings";

describe("enhancement settings", () => {
  beforeEach(() => localStorage.clear());

  it("maps the three-state mode selector onto the boolean storage without overlap", () => {
    expect(getAnalysisMode({ analysisHintMode: false, analysisSelfPlay: false })).toBe("continuous");
    expect(getAnalysisMode({ analysisHintMode: false, analysisSelfPlay: true })).toBe("selfplay");
    expect(getAnalysisMode({ analysisHintMode: true, analysisSelfPlay: false })).toBe("hint");
    expect(getAnalysisMode({ analysisHintMode: true, analysisSelfPlay: true })).toBe("hint");
    const next = withAnalysisMode({ ...DEFAULT_ENHANCEMENT_SETTINGS }, "selfplay");
    expect(next.analysisSelfPlay).toBe(true);
    expect(next.analysisHintMode).toBe(false);
    expect(withAnalysisMode(next, "hint").analysisSelfPlay).toBe(false);
  });

  it("defaults every optional enhancement to off", () => {
    expect(loadEnhancementSettings()).toEqual(DEFAULT_ENHANCEMENT_SETTINGS);
  });

  it("only accepts explicit true values for opt-in features, but defaults moves labels on", () => {
    expect(normalizeEnhancementSettings({ tabletSplit: 1, gestureZoom: 1, gestureSwipe: "yes", recentImports: true, aiBoardHints: false, coachMarks: null })).toEqual({
      tabletSplit: false,
      gestureZoom: false,
      gestureSwipe: false,
      recentImports: true,
      aiBoardHints: false,
      coachMarks: false,
      movesTextDisplay: true,
      dockMergeMoves: false,
      analysisAuto: false,
      analysisTimeMs: 2000,
      analysisShowCandidates: true,
      analysisCandidateMetric: "winRate",
      analysisCandidateCount: 1,
      analysisCandidateDecimals: 0,
      analysisPreviewGuide: false,
      analysisQuickToggle: false,
      thinkingIndicatorPosition: "corner",
      analysisHintMode: false,
      analysisSelfPlay: false,
      analysisSelfPlayTimeMs: 2000,
      devMoveOrderRestore: false,
      openingBook: false,
      fastRecognition: true,
      analysisMaxMemoryMb: 256,
    });
  });

  it("defaults the parallel recognition accelerator on, and only an explicit false turns it off", () => {
    // 用户 09-14：识谱多核加速随「可选增强功能」出厂即开（关闭才回落单线程）。
    // 旧存档没有这个键 → 必须取到 true，否则老用户升上来会静默少一项加速。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.fastRecognition).toBe(true);
    expect(normalizeEnhancementSettings({}).fastRecognition).toBe(true);
    expect(normalizeEnhancementSettings({ tabletSplit: true }).fastRecognition).toBe(true);
    expect(normalizeEnhancementSettings({ fastRecognition: false }).fastRecognition).toBe(false);
    expect(normalizeEnhancementSettings({ fastRecognition: 0 }).fastRecognition).toBe(true);
  });

  it("keeps the opening book switch opt-in only", () => {
    expect(normalizeEnhancementSettings({ openingBook: 1 }).openingBook).toBe(false);
    expect(normalizeEnhancementSettings({ openingBook: true }).openingBook).toBe(true);
  });

  it("keeps the quick analysis toggle opt-in only (default off)", () => {
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisQuickToggle).toBe(false);
    expect(normalizeEnhancementSettings({}).analysisQuickToggle).toBe(false);
    expect(normalizeEnhancementSettings({ analysisQuickToggle: true }).analysisQuickToggle).toBe(true);
  });

  it("keeps the preview guide lines opt-in only (default off)", () => {
    // 用户 09-11：变化预览默认不画连线（带序号的预览棋子已足够表达），显式开启才画。
    expect(normalizeEnhancementSettings({}).analysisPreviewGuide).toBe(false);
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisPreviewGuide).toBe(false);
    expect(normalizeEnhancementSettings({ analysisPreviewGuide: 1 }).analysisPreviewGuide).toBe(false);
    expect(normalizeEnhancementSettings({ analysisPreviewGuide: true }).analysisPreviewGuide).toBe(true);
  });

  it("keeps the continuous-analysis budget internal (no user duration scheduling)", () => {
    // 用户规格 09-10：持续分析=一直分析当前局面，时长选项已全部移除，档位常量
    // 与钳制函数不再导出；analysisTimeMs 仅作内部每轮预算，默认 2000（2026-09-11
    // 5s→2s：WASM 同步搜索阻塞 worker 事件循环，换手/落子时新轮要等旧轮跑完
    // 预算才开始，2s 把最坏等待压到 ~3s），旧存档的
    // 自定义值原样保留但不再有 UI 呈现。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisTimeMs).toBe(2000);
    expect(normalizeEnhancementSettings({}).analysisTimeMs).toBe(2000);
    expect(normalizeEnhancementSettings({ analysisTimeMs: 2500 }).analysisTimeMs).toBe(2500);
    expect(normalizeEnhancementSettings({ analysisTimeMs: 10000 }).analysisTimeMs).toBe(10000);
  });

  it("keeps the dev move-order restore switch opt-in only", () => {
    expect(normalizeEnhancementSettings({ devMoveOrderRestore: 1 }).devMoveOrderRestore).toBe(false);
    expect(normalizeEnhancementSettings({ devMoveOrderRestore: true }).devMoveOrderRestore).toBe(true);
  });

  it("treats hint/self-play as opt-in and clamps the self-play per-move budget", () => {
    expect(normalizeEnhancementSettings({ analysisHintMode: 1, analysisSelfPlay: "yes" })).toMatchObject({ analysisHintMode: false, analysisSelfPlay: false });
    // 提示模式与自对弈/持续分析互斥（旧存档可能三个都真）：提示优先、其余清零，
    // 否则界面显示提示模式、后台却在滚动分析甚至逐手自对弈（2026-09-10 用户反馈）。
    expect(normalizeEnhancementSettings({ analysisHintMode: true, analysisSelfPlay: true, analysisSelfPlayTimeMs: 999999 })).toMatchObject({ analysisHintMode: true, analysisSelfPlay: false, analysisAuto: false, analysisSelfPlayTimeMs: 10000 });
    expect(normalizeEnhancementSettings({ analysisHintMode: true, analysisAuto: true })).toMatchObject({ analysisHintMode: true, analysisAuto: false });
    expect(normalizeEnhancementSettings({ analysisHintMode: false, analysisSelfPlay: true, analysisAuto: true })).toMatchObject({ analysisHintMode: false, analysisSelfPlay: true, analysisAuto: true });
    expect(normalizeEnhancementSettings({ analysisSelfPlayTimeMs: 1 }).analysisSelfPlayTimeMs).toBe(1000);
    expect(normalizeEnhancementSettings({ analysisSelfPlayTimeMs: 4300 }).analysisSelfPlayTimeMs).toBe(4500);
  });

  it("normalizes the analysis candidate count to one through ten", () => {
    expect(normalizeEnhancementSettings({ analysisCandidateCount: -4 }).analysisCandidateCount).toBe(1);
    expect(normalizeEnhancementSettings({ analysisCandidateCount: 5.6 }).analysisCandidateCount).toBe(6);
    expect(normalizeEnhancementSettings({ analysisCandidateCount: 99 }).analysisCandidateCount).toBe(10);
  });

  it("clamps the candidate decimals to zero through two (win-rate / score precision)", () => {
    // 用户 09-11：选点胜率与评估分的显示精度最多两位；两位以上无意义且圆标放不下。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings({}).analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: -1 }).analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: 2.6 }).analysisCandidateDecimals).toBe(2);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: 5 }).analysisCandidateDecimals).toBe(2);
  });

  it("honours explicit opt-out of moves labels and opt-in of dock-merged moves", () => {
    expect(normalizeEnhancementSettings({ movesTextDisplay: false, dockMergeMoves: true })).toMatchObject({ movesTextDisplay: false, dockMergeMoves: true });
  });

  it("persists the user's choices", () => {
    const value = { ...DEFAULT_ENHANCEMENT_SETTINGS, tabletSplit: true, gestureZoom: true, recentImports: true };
    saveEnhancementSettings(value);
    expect(JSON.parse(localStorage.getItem(ENHANCEMENT_SETTINGS_KEY) || "null")).toEqual(value);
    expect(loadEnhancementSettings()).toEqual(value);
  });

  it("recovers safely from malformed storage", () => {
    localStorage.setItem(ENHANCEMENT_SETTINGS_KEY, "not-json");
    expect(loadEnhancementSettings()).toEqual(DEFAULT_ENHANCEMENT_SETTINGS);
  });
});

describe("enhancement settings: analysis memory tier (T49 火力线)", () => {
  it("defaults to 256 (standard strength) and clamps to 256-2048", async () => {
    const mod = await import("./enhancement-settings");
    expect(mod.normalizeEnhancementSettings({}).analysisMaxMemoryMb).toBe(256);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 2048 }).analysisMaxMemoryMb).toBe(2048);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 768 }).analysisMaxMemoryMb).toBe(768);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 99 }).analysisMaxMemoryMb).toBe(256);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 4096 }).analysisMaxMemoryMb).toBe(2048);
    expect(mod.DEFAULT_ENHANCEMENT_SETTINGS.analysisMaxMemoryMb).toBe(256);
  });

  it("formats memory as GB at 1024 multiples and MB otherwise", async () => {
    const mod = await import("./enhancement-settings");
    expect(mod.fmtAnalysisMemory(256)).toBe("256MB");
    expect(mod.fmtAnalysisMemory(1024)).toBe("1GB");
    expect(mod.fmtAnalysisMemory(1536)).toBe("1.5GB");
  });
});
