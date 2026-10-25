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

  it("keeps the colour-vision palette opt-in only (default off, old saves stay off)", () => {
    // 它改的是棋盘上的显示颜色，不能在用户没要求时悄悄生效；老存档读上来必须是关。
    expect(loadEnhancementSettings().colorVisionFriendly).toBe(false);
    expect(normalizeEnhancementSettings({}).colorVisionFriendly).toBe(false);
    expect(normalizeEnhancementSettings({ colorVisionFriendly: true }).colorVisionFriendly).toBe(true);
    // 非布尔值一律当关（与其它 opt-in 项同一口径）
    expect(normalizeEnhancementSettings({ colorVisionFriendly: 1 }).colorVisionFriendly).toBe(false);
  });

  it("only accepts explicit true values for opt-in features, but defaults moves labels on", () => {
    expect(normalizeEnhancementSettings({ gestureSwipe: "yes", importShelf: true, aiBoardHints: false, coachMarks: null })).toEqual({
      pinchZoom: true,
      gestureSwipe: false,
      importShelf: true,
      aiBoardHints: false,
      coachMarks: false,
      movesTextDisplay: true,
      buttonOverflow: "scroll",
      haptics: false,
      colorVisionFriendly: false,
      dockMergeMoves: false,
      analysisAuto: false,
      analysisTimeMs: 2000,
      analysisShowCandidates: true,
      analysisCandidateMetric: "winRate",
      analysisCandidateCount: 5,
      analysisCandidateDecimals: 0,
      analysisDepthMin: 0,
      analysisDepthMax: 0,
      analysisPreviewGuide: false,
      analysisQuickToggle: false,
      thinkingIndicatorPosition: "corner",
      analysisHintMode: false,
      analysisSelfPlay: false,
      analysisSelfPlayTimeMs: 2000,
      devMoveOrderRestore: false,
      devBoardSizeDetect: false,
      engineMultiThread: false,
      engineThreads: 0,
      openingBook: false,
      fastRecognition: true,
      fullScreenMode: false,
      analysisMaxMemoryMb: 128,
      analysisCache: true,
      gameReviewBudgetMs: 800,
      aiGameAutoSave: false,
      // 这批是「出厂即开、显式 false 才关」的增强项（normalize 里走 !== false）。
      // 老存档没有这些键时必须取 true，否则升级后老用户会静默少一项功能。
      boardRotateGesture: true,
      moveRail: true,
      libraryOnlineEntry: true,
      radialMenu: true,
      chromeCollapseToggle: true,
      // 用户 10-09 新增的「开局名提示」：同样是出厂即开、显式 false 才关。
      openingNameHint: true,
      // 用户 10-11 新增的两枚奖励弹窗开关：也走「出厂即开、显式 false 才关」——
      // 老存档没有这两个键时必须取 true，否则升级后老用户会突然看不到
      // 成就/棋魂弹窗，而他会以为功能坏了（关掉只是不弹，解锁与入账照常）。
      achievementPopup: true,
      soulPopup: true,
      tapStonePrev: false,
      keyboardShortcuts: true,
      // 画中画例外：用户 09-23 明确要求默认关闭（「小窗」的叫法容易误解成
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

  it("defaults the toolbar overflow behaviour to horizontal scrolling, and only an explicit wrap switches it", () => {
    // 用户 10-03：「现在我们默认横向滚动吧，感觉这个比自动换行省空间」——换行会把一行按钮
    // 挤成两行，正好吃掉刚砍出来的棋盘高度。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({}).buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({ tabletSplit: true }).buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({ buttonOverflow: "scroll" }).buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({ buttonOverflow: "wrap" }).buttonOverflow).toBe("wrap");
    expect(normalizeEnhancementSettings({ buttonOverflow: 1 }).buttonOverflow).toBe("scroll");
    // 键名换代（actionRails → actionOverflow → buttonOverflow）一律不沿用：老存档里那两个
    // 键存的是**当时**的默认值，不是用户的选择，升上来必须落到新默认，否则「改默认」这件事
    // 对已经动过任何一项增强设置的人（=几乎所有人，存档是整份写回的）永远不会生效。
    expect(normalizeEnhancementSettings({ actionRails: true }).buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({ actionOverflow: "wrap" }).buttonOverflow).toBe("scroll");
    expect(normalizeEnhancementSettings({ actionOverflow: "scroll" }).buttonOverflow).toBe("scroll");
    // 真选过「自动换行」之后写的是新键，往返一次不能被默认值带走。
    saveEnhancementSettings({ ...DEFAULT_ENHANCEMENT_SETTINGS, buttonOverflow: "wrap" });
    expect(loadEnhancementSettings().buttonOverflow).toBe("wrap");
  });

  it("drops the retired online switches (user 2026-09-26: 在线入口常驻)", () => {
    // 这两个键随「在线功能不再需要开关」一起删除：设置类型里没有它们，
    // 旧存档里带着这两个键读上来也不能报错——只是被丢掉。
    expect("onlinePuzzleSource" in DEFAULT_ENHANCEMENT_SETTINGS).toBe(false);
    expect("onlineLibrary" in DEFAULT_ENHANCEMENT_SETTINGS).toBe(false);
    const migrated = normalizeEnhancementSettings({ onlinePuzzleSource: true, onlineLibrary: true, haptics: true });
    expect("onlinePuzzleSource" in migrated).toBe(false);
    expect("onlineLibrary" in migrated).toBe(false);
    // 同一次读档里其它键照常生效（丢旧键不影响别的设置）。
    expect(migrated.haptics).toBe(true);
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
    // 多线程引擎同样只认显式 true：它依赖浏览器跨源隔离，安卓端拿不到，
    // 默认必须是关（用户自行权衡后开启）。
    expect(normalizeEnhancementSettings({ engineMultiThread: 1 }).engineMultiThread).toBe(false);
    expect(normalizeEnhancementSettings({ engineMultiThread: true }).engineMultiThread).toBe(true);
    // 线程数：0 自动、-1 全核，其余按整数钳制（-1..256），非数字回落自动。
    expect(normalizeEnhancementSettings({ engineThreads: -1 }).engineThreads).toBe(-1);
    expect(normalizeEnhancementSettings({ engineThreads: 8.6 }).engineThreads).toBe(9);
    expect(normalizeEnhancementSettings({ engineThreads: -99 }).engineThreads).toBe(-1);
    expect(normalizeEnhancementSettings({ engineThreads: 9999 }).engineThreads).toBe(256);
    expect(normalizeEnhancementSettings({ engineThreads: "8" }).engineThreads).toBe(0);
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
    // 旧默认 1 迁到新默认 5（用户没动过这个键）；显式选过 2-10 的原样保留
    expect(normalizeEnhancementSettings({ analysisCandidateCount: 1 }).analysisCandidateCount).toBe(5);
    expect(normalizeEnhancementSettings({ analysisCandidateCount: 3 }).analysisCandidateCount).toBe(3);
  });

  it("migrates the nodes candidate ordering back to win-rate (2026-10-01 用户要求默认回归胜率)", () => {
    // 前一轮曾默认 nodes 并把存档 winRate 迁过去；本轮按用户要求反向：默认 winRate，
    // 存档里的 "nodes"（含上一版迁出来的）一律迁回 winRate。
    expect(normalizeEnhancementSettings({ analysisCandidateMetric: "nodes" }).analysisCandidateMetric).toBe("winRate");
    expect(normalizeEnhancementSettings({}).analysisCandidateMetric).toBe("winRate");
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateMetric).toBe("winRate");
    // 其它显式选择原样保留
    expect(normalizeEnhancementSettings({ analysisCandidateMetric: "depth" }).analysisCandidateMetric).toBe("depth");
    expect(normalizeEnhancementSettings({ analysisCandidateMetric: "score" }).analysisCandidateMetric).toBe("score");
  });

  it("clamps the candidate decimals to zero through five (win-rate / score precision)", () => {
    // 用户 09-11：选点胜率与评估分的显示精度最多两位；两位以上无意义且圆标放不下。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings({}).analysisCandidateDecimals).toBe(0);

    // 深度范围（用户 09-16）：默认两端都是「自动」（0），非法值一律收窄成自动，
    // 而不是把 NaN/负数塞给引擎。
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisDepthMin).toBe(0);
    expect(DEFAULT_ENHANCEMENT_SETTINGS.analysisDepthMax).toBe(0);
    expect(normalizeEnhancementSettings({ analysisDepthMin: Number.NaN, analysisDepthMax: -5 }).analysisDepthMin).toBe(0);
    expect(normalizeEnhancementSettings({ analysisDepthMin: Number.NaN, analysisDepthMax: -5 }).analysisDepthMax).toBe(0);
    expect(normalizeEnhancementSettings({ analysisDepthMin: 12, analysisDepthMax: 32 }).analysisDepthMin).toBe(12);
    expect(normalizeEnhancementSettings({ analysisDepthMin: 12, analysisDepthMax: 32 }).analysisDepthMax).toBe(32);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: -1 }).analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: 2.6 }).analysisCandidateDecimals).toBe(3);
    // 上限从 2 放宽到 5（用户 09-26 报「选了 5 位还是只有 1 位」：原上限根本选不到高精度）。
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: 5 }).analysisCandidateDecimals).toBe(5);
    expect(normalizeEnhancementSettings({ analysisCandidateDecimals: 9 }).analysisCandidateDecimals).toBe(5);
  });

  it("「最近导入」默认开着，老存档里那条 recentImports:false 关不掉它", () => {
    expect(normalizeEnhancementSettings({}).importShelf).toBe(true);
    expect(normalizeEnhancementSettings({ importShelf: false }).importShelf).toBe(false);
    // 旧键是当年「默认关」写下的机器值，不是用户的选择：读上来必须忽略，
    // 否则改了默认值对已经装过应用的人永远不生效（整份写回的存档就是这个坑）。
    expect(normalizeEnhancementSettings({ recentImports: false }).importShelf).toBe(true);
    // 双指缩放同理：老存档里那条 gestureZoom:false 是当年的机器值，不该继续压着新默认。
    expect(normalizeEnhancementSettings({}).pinchZoom).toBe(true);
    expect(normalizeEnhancementSettings({ gestureZoom: false }).pinchZoom).toBe(true);
    expect(normalizeEnhancementSettings({ pinchZoom: false }).pinchZoom).toBe(false);
  });

  it("honours explicit opt-out of moves labels and opt-in of dock-merged moves", () => {
    expect(normalizeEnhancementSettings({ movesTextDisplay: false, dockMergeMoves: true })).toMatchObject({ movesTextDisplay: false, dockMergeMoves: true });
  });

  it("persists the user's choices", () => {
    const value = { ...DEFAULT_ENHANCEMENT_SETTINGS, pinchZoom: false, importShelf: false };
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
  it("默认 128MB（一体化后），钳制到 64-2048", async () => {
    const mod = await import("./enhancement-settings");
    expect(mod.normalizeEnhancementSettings({}).analysisMaxMemoryMb).toBe(128);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 2048 }).analysisMaxMemoryMb).toBe(2048);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 768 }).analysisMaxMemoryMb).toBe(768);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 32 }).analysisMaxMemoryMb).toBe(64);
    expect(mod.normalizeEnhancementSettings({ analysisMaxMemoryMb: 4096 }).analysisMaxMemoryMb).toBe(2048);
    expect(mod.DEFAULT_ENHANCEMENT_SETTINGS.analysisMaxMemoryMb).toBe(128);
  });

  it("formats memory as GB at 1024 multiples and MB otherwise", async () => {
    const mod = await import("./enhancement-settings");
    expect(mod.fmtAnalysisMemory(256)).toBe("256MB");
    expect(mod.fmtAnalysisMemory(1024)).toBe("1GB");
    expect(mod.fmtAnalysisMemory(1536)).toBe("1.5GB");
  });
});
