export const ENHANCEMENT_SETTINGS_KEY = "banbu-enhancement-settings-v1";

export type AnalysisCandidateMetric = "winRate" | "score" | "nodes" | "depth";
/** UI labels for the candidate metric, shared by the panel header and the picker. */
export const ANALYSIS_METRIC_LABELS: Record<AnalysisCandidateMetric, string> = {
  winRate: "胜率", score: "评估分", depth: "深度", nodes: "计算量",
};
export type ThinkingIndicatorPosition = "corner" | "below";
// 分析主按钮的三模式：持续分析=展开面板滚动加深；自对弈=引擎双方逐回合落子到终局；
// 提示=不展开面板，点一下为当前行棋方想一手直接落子（≤10s，杀棋即落）。
export type AnalysisMode = "continuous" | "selfplay" | "hint";

export interface EnhancementSettings {
  tabletSplit: boolean;
  gestureZoom: boolean;
  gestureSwipe: boolean;
  recentImports: boolean;
  aiBoardHints: boolean;
  coachMarks: boolean;
  // 走棋栏文字显示：默认开启（沿用带标签的现状）；关闭则纯图标、绝不换行。
  movesTextDisplay: boolean;
  // 走棋并入功能栏：把走棋导航从独立常驻行改回底部功能栏的一个标签页。默认关闭。
  dockMergeMoves: boolean;
  // 局面分析在每次局面变化后自动运行。默认关闭，避免悄悄占用算力。
  analysisAuto: boolean;
  // 持续分析每轮的内部搜索预算（不再提供用户设置；用户规格 09-10：持续分析
  // 是「一直分析当前局面」，不需要时长调度，只有自对弈才有每步时限）。
  analysisTimeMs: number;
  analysisShowCandidates: boolean;
  analysisCandidateMetric: AnalysisCandidateMetric;
  analysisCandidateCount: number;
  // 选点胜率/评估分的小数位数（0-2）。0=现状整数显示；2 为上限——小数位越多
  // 圆标越挤，且引擎胜率本身是估算值，两位以上没有意义（用户 09-11）。
  analysisCandidateDecimals: number;
  // 候选变化预览（点击候选点后棋盘上的连线预览）：是否画出各手之间的连线。
  // 默认关闭——变化图本身由带序号的预览棋子表达，连线容易与标注/其他标记混淆。
  // 仅出现在设置页（用户 09-11：分析面板头部位置让给小数位）。
  analysisPreviewGuide: boolean;
  // 首行功能区的分析快捷开关（用户 09-12）：开启后「分析开关」作为一个可布局
  // 的功能区按钮（默认插在「分析」左侧，可在功能区布局编辑器里移动/隐藏），
  // 点亮=分析运行中；关闭选项时自动从所有布局移除。
  analysisQuickToggle: boolean;
  thinkingIndicatorPosition: ThinkingIndicatorPosition;
  // 提示模式：分析按钮不再展开面板，点击即让引擎为当前行棋方思考一手
  // （≤10s，杀棋即落）并直接落子。
  analysisHintMode: boolean;
  // 自对弈：双方都交给引擎，每步用调整好的时限，到点落子后立即续算，直到终局。
  analysisSelfPlay: boolean;
  analysisSelfPlayTimeMs: number;
  // 开发测试功能：图片识谱「复原手序」（按棋子序号重建落子顺序）。真实截图
  // 实测成功率仍低，默认隐藏；开启后导入流程才出现该开关与相关文案。
  devMoveOrderRestore: boolean;
  // 开局库（索索夫打点簿，第一档）：人机对局优先查内置打点簿，命中即秒落、
  // 未命中回落引擎。默认关闭；关闭时零占用（book JSON 都不会加载）。
  openingBook: boolean;
  // 识谱多核加速（用户 09-14）：图片识谱用多个线程并行算网格探测与逐格分析，
  // 线程数按设备核心数与可用内存自动定档。默认开启——识别结果与单线程逐位相同
  // （qa/recognition-parallel-parity.mjs 逐张对照），只是更快、界面不卡；
  // 关闭后回落单线程直算，供极老设备或排查问题用。
  fastRecognition: boolean;
  // 分析引擎内存档（T49 火力线，用户 09-13 自调节）：引擎转置表预算 MB。
  // 0=自动（按设备内存 128/64MB 分档——09-12 实测 TT 甜点区，256MB 反而慢 29%）；
  // 256-2048 间任意值（用户要求逐 MB 可调，不是离散档位）。2048 为上限：
  // wasm32 堆 4GB 需留 NNUE/代码余量，分配失败引擎退出，App 侧先降 256 重试
  // 再换轻量（worker 侧 error 兜底链）。
  analysisMaxMemoryMb: number;
}

export const DEFAULT_ENHANCEMENT_SETTINGS: EnhancementSettings = {
  tabletSplit: false,
  gestureZoom: false,
  gestureSwipe: false,
  recentImports: false,
  aiBoardHints: false,
  coachMarks: false,
  movesTextDisplay: true,
  dockMergeMoves: false,
  analysisAuto: false,
  // 持续分析每轮预算：WASM 同步搜索阻塞 worker 事件循环，换手/落子时新轮只能
  // 等旧轮跑完预算才开始（用户 09-11 实测"换手后几十秒才出候选"）——5s→2s
  // 把最坏等待压到 ~3s；滚动续算 + TT 继承，深度照样逐轮累积（T12 实测过
  // 4 轮 depth 13→17 是在 5s 轮下，2s 轮每轮浅 1-2 层，持续分析仍会加深）。
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
// 识谱多核加速默认开启（用户 09-14）：多核不可用时 createParallelAccelerator
// 自己返回 null 并回落单线程，所以默认开不会让老设备识别失败，只会慢一点。
  fastRecognition: true,
// 火力线默认 256MB = ≥4GB 设备的「自动」档（09-12 实测 256 非甜点但保留默认
// 兼容既有用户期望；自调档默认值即「标准」）；用户 09-13：默认最低即标准，
// 向上自调节，256-2048 逐段可设。
  analysisMaxMemoryMb: 256,
};

// 分析内存显示：≥1024 显示 GB（整数倍不带小数），否则 MB（768→"768MB"、1536→"1.5GB"）。
export const fmtAnalysisMemory = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB` : `${mb}MB`;

export const normalizeEnhancementSettings = (value: unknown): EnhancementSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ENHANCEMENT_SETTINGS };
  const partial = value as Partial<EnhancementSettings>;
  return {
    tabletSplit: partial.tabletSplit === true,
    gestureZoom: partial.gestureZoom === true,
    gestureSwipe: partial.gestureSwipe === true,
    recentImports: partial.recentImports === true,
    aiBoardHints: partial.aiBoardHints === true,
    coachMarks: partial.coachMarks === true,
    // 走棋文字默认开启，因此用 !== false 收窄（仅显式关闭才为 false），其余新功能用 === true。
    movesTextDisplay: partial.movesTextDisplay !== false,
    dockMergeMoves: partial.dockMergeMoves === true,
    // 提示模式与「持续分析 / 自对弈」互斥（旧存档可能三个都真）：提示优先——
    // 否则会出现「界面显示提示模式、后台却在滚动分析甚至逐手落子」的鬼畜状态。
    analysisAuto: partial.analysisHintMode === true ? false : partial.analysisAuto === true,
    analysisTimeMs: typeof partial.analysisTimeMs === "number" && Number.isFinite(partial.analysisTimeMs)
      ? Math.max(500, Math.min(30000, Math.round(partial.analysisTimeMs / 100) * 100))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisTimeMs,
    analysisShowCandidates: partial.analysisShowCandidates !== false,
    analysisCandidateMetric: partial.analysisCandidateMetric === "score" || partial.analysisCandidateMetric === "nodes" || partial.analysisCandidateMetric === "depth"
      ? partial.analysisCandidateMetric
      : "winRate",
    analysisCandidateCount: typeof partial.analysisCandidateCount === "number" && Number.isFinite(partial.analysisCandidateCount)
      ? Math.max(1, Math.min(10, Math.round(partial.analysisCandidateCount)))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateCount,
    analysisCandidateDecimals: typeof partial.analysisCandidateDecimals === "number" && Number.isFinite(partial.analysisCandidateDecimals)
      ? Math.max(0, Math.min(2, Math.round(partial.analysisCandidateDecimals)))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateDecimals,
    analysisPreviewGuide: partial.analysisPreviewGuide === true,
    analysisQuickToggle: partial.analysisQuickToggle === true,
    thinkingIndicatorPosition: partial.thinkingIndicatorPosition === "below" ? "below" : "corner",
    analysisHintMode: partial.analysisHintMode === true,
    analysisSelfPlay: partial.analysisHintMode === true ? false : partial.analysisSelfPlay === true,
    analysisSelfPlayTimeMs: typeof partial.analysisSelfPlayTimeMs === "number" && Number.isFinite(partial.analysisSelfPlayTimeMs)
      ? Math.max(1000, Math.min(10000, Math.round(partial.analysisSelfPlayTimeMs / 500) * 500))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisSelfPlayTimeMs,
    devMoveOrderRestore: partial.devMoveOrderRestore === true,
    openingBook: partial.openingBook === true,
    // 识谱加速默认开启，用 !== false 收窄（仅显式关闭才为 false）：旧存档里
    // 没有这个键，取默认值 true 就对了——用户 09-14 明确要求默认开启。
    fastRecognition: partial.fastRecognition !== false,
    // 内存自调节：256-2048 间任意整数（逐 32MB 滑杆），非法/越界钳回边界。
    analysisMaxMemoryMb: (() => {
      const raw = partial.analysisMaxMemoryMb;
      if (raw === undefined || raw === null || !Number.isFinite(raw)) return 256;
      return Math.min(2048, Math.max(256, Math.round(raw)));
    })(),
  };
};

// 单一模式选择器与双布尔存储的互转：提示优先于自对弈（withAnalysisMode 保证
// 任何时刻至多一个模式开关为真，杜绝「两个都开」的非法态）。
export const getAnalysisMode = (settings: Pick<EnhancementSettings, "analysisHintMode" | "analysisSelfPlay">): AnalysisMode =>
  settings.analysisHintMode ? "hint" : settings.analysisSelfPlay ? "selfplay" : "continuous";
// 提示模式不跑后台滚动分析：切到提示时把「持续分析」开关一并关掉（用户 09-10 反馈：
// 提示落子后引擎还在滚，看起来像停不下来）；切回持续分析需重新按「开启」。
export const withAnalysisMode = <T extends EnhancementSettings>(settings: T, mode: AnalysisMode): T =>
  ({ ...settings, analysisHintMode: mode === "hint", analysisSelfPlay: mode === "selfplay", ...(mode === "hint" ? { analysisAuto: false } : {}) });

export const loadEnhancementSettings = (): EnhancementSettings => {  try {
    return normalizeEnhancementSettings(JSON.parse(localStorage.getItem(ENHANCEMENT_SETTINGS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_ENHANCEMENT_SETTINGS };
  }
};

export const saveEnhancementSettings = (settings: EnhancementSettings) => {
  try { localStorage.setItem(ENHANCEMENT_SETTINGS_KEY, JSON.stringify(normalizeEnhancementSettings(settings))); } catch { /* storage can be unavailable */ }
};
