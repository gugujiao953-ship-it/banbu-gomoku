export const ENHANCEMENT_SETTINGS_KEY = "banbu-enhancement-settings-v1";

export type AnalysisCandidateMetric = "winRate" | "score" | "nodes" | "depth" | "drawRate";
/** UI labels for the candidate metric, shared by the panel header and the picker. */
export const ANALYSIS_METRIC_LABELS: Record<AnalysisCandidateMetric, string> = {
  winRate: "胜率", score: "评估分", depth: "深度", nodes: "计算量", drawRate: "和棋率",
};
export type ThinkingIndicatorPosition = "corner" | "below";
// 分析主按钮的三模式：持续分析=展开面板滚动加深；自对弈=引擎双方逐回合落子到终局；
// 提示=不展开面板，点一下为当前行棋方想一手直接落子（≤10s，杀棋即落）。
export type AnalysisMode = "continuous" | "selfplay" | "hint";

export interface EnhancementSettings {
  // 双指缩放棋盘（用户 10-04：改成默认开启）。原名 gestureZoom，**故意换新名**：增强设置是
  // 整份写回的，老存档里那条 gestureZoom:false 是当年「默认关」写下的机器值、不是用户的选择，
  // 不换名就没法让已经装过应用的人吃到新默认（同 importShelf / buttonOverflow）。
  pinchZoom: boolean;
  gestureSwipe: boolean;
  // 「最近导入」这一摞：导入过的文件留在应用里，下次在导入面板直接点开，不用重新选文件。
  // 字段原名 recentImports，2026-10-04 改名并换成默认开启——增强设置是**整份写回**的，
  // 老存档里那条 `recentImports: false` 是当年「默认关」留下的机器值、不是用户的选择，
  // 不换键名就没法让已经装过应用的人吃到新默认（同一个坑见上面 buttonOverflow 的注释）。
  importShelf: boolean;
  aiBoardHints: boolean;
  coachMarks: boolean;
  // 走棋栏文字显示：默认开启（沿用带标签的现状）；关闭则纯图标、绝不换行。
  movesTextDisplay: boolean;
  // 功能区按钮**放不下时怎么办**（用户 09-26；原名「功能栏边界栏」，现在按溢出行为命名，
  // 用户原话：「这个开关为：按钮宽度溢出后：换行、滑页…不叫做边界框了」）：
  //   "scroll" = 横向滚动（业界叫 Scroll，**默认**）：三行两端各一条贴屏幕边的滑动栏（**裸箭头**，
  //              不再有底色方框包裹），按钮不换行、在栏内横滑，点栏整行挪一格、长按连续挪；
  //   "wrap"   = 自动换行（业界叫 Wrap）：放不下就换行（首行本来就是自动换行的网格）。
  // 默认换回「横向滚动」（用户 10-03：「现在我们默认横向滚动吧，感觉这个比自动换行省空间」）——
  // 换行会把一行按钮挤成两行，正好吃掉刚省下来的棋盘高度。
  // ⚠ 字段名又换了（`actionRails` → `actionOverflow` → `buttonOverflow`），并且**故意不沿用旧键**：
  //   老存档里那两条 `actionOverflow` 是上一版的默认值、不是用户的选择，读上来一律按新默认走；
  //   用户在设置里真选过一次之后写的是新键，从此不会再被默认值带走。
  buttonOverflow: "wrap" | "scroll";
  // 触觉反馈（用户 09-17）：落子 / 导航 / 警告（含禁手）/ 胜负各配一段短震动，默认关闭。
  // 走 navigator.vibrate——安卓 WebView 原生支持，不新增插件、不增加包体；桌面浏览器与
  // iOS Safari 没有这个 API，静默降级成「什么都不发生」。接线点是 App 里唯一的 playSound。
  haptics: boolean;
  // 色觉友好配色（用户 09-23）：把标注里红绿/黄褐那几对最易混的颜色沿明度拉开，
  // 并把最后一手标记、胜负线从红改成蓝。默认关闭——它改变的是棋盘上的显示颜色，
  // 不该在用户没要求时悄悄生效。
  colorVisionFriendly: boolean;
  // ── 手感增强组（用户 09-17 第二批，六项全部默认开启）──────────────
  // 这六项都不改数据、不改默认手势语义，只在「手怎么摸」上加一层；关闭时对应
  // DOM 与该功能引入前逐字一致（沿用边界栏立的规矩）。解析统一用 !== false
  // 收窄，保证老存档升级后默认开启。
  // 双指旋转：双指在棋盘上转动手腕切换显示朝向，松手吸附 90°。仅在方盘
  // （15 路）启用——非方盘的 gap 是单一变量，90° 会破坏宽高语义。
  boardRotateGesture: boolean;
  // 棋盘手数滑轨：棋盘两侧贴边竖条，按住拖动=连续跳手，点击=单步。
  moveRail: boolean;
  // 棋谱库的「在线」页签（用户 10-04：群友希望像以前那样能关掉）。关掉只是入口不出现，
  // 已经导入过的棋谱不受影响；默认开（老存档升级后保持现状）。
  libraryOnlineEntry: boolean;
  // ── 奖励弹窗的两个开关（用户 2026-10-11：「加入两个开关，一个是成就弹窗的开关，
  //    一个是棋魂弹窗的开关，这个关闭了就不会显示弹窗了」）──────────────
  //
  // 两个分开而不是合成一个：它们**体量与频率差很多**（见 ProgressReward.tsx 的口径）——
  // 成就是稀有大卡（几小时一个），棋魂是高频紧凑条（每赢一局都有）。
  // 用户完全可能"成就想留着庆祝、棋魂条嫌烦"，所以必须能单独关。
  //
  // ⚠ **默认都开**（`!== false` 收窄）：这是两个**显示层开关**，不是新功能 ——
  // 关掉它们只是不弹提示，解锁/入账**照常发生**，账本与成就面板都不受影响。
  // 所以默认值必须与"加这个开关之前的行为"一致（否则老用户升级后会突然发现
  // 自己再也看不到成就弹窗，而他会以为成就坏了）。
  //
  // 关掉之后：解锁仍然记录、棋魂仍然入账，只是不弹 —— 想回看就打开成就面板/棋魂说明页。
  achievementPopup: boolean;
  soulPopup: boolean;
  // 长按环形菜单：长按已有棋子/右键呼出环形菜单（标注/去子/复制局面/跳到此手）。
  // 空位长按仍按老规矩=加标注，不抢。
  radialMenu: boolean;
  // 点已有棋子回退一步（用户 09-26）：点棋盘上任意一颗已下的子＝退一手，连续点连续退；
  // 电脑上右键同理（右键优先做回退，环形菜单改由长按呼出）。只在**没有对弈**的盘面上
  // 生效：打谱/读谱可用，人机与双人对局、做题、以及标注/去子这类"点棋盘另有含义"的
  // 编辑态都不生效。**默认关闭**（用户 09-26 体验后改的口径：这层手感有人喜欢有人嫌，
  // 走 opt-in，老存档读上来同样是关）。
  tapStonePrev: boolean;
  // 键盘流补全：数字键跳手、空格读谱播放/暂停、Delete 删当前节点。
  keyboardShortcuts: boolean;
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
  // 全屏模式（用户 2026-10-14）：内容顶到屏幕物理顶部并隐藏系统状态栏。
  // 默认关闭——开着时最上面那排按钮落在系统状态栏/摄像头挖孔那一行里，触摸会被系统吃掉；
  // 关闭时由系统自己给状态栏留位，就是「之前那样」。安全区高度由原生按 WindowInsets 汇报，不写死机型。
  fullScreenMode: boolean;
  // 提示模式：分析按钮不再展开面板，点击即让引擎为当前行棋方思考一手
  // （≤10s，杀棋即落）并直接落子。
  analysisHintMode: boolean;
  // 自对弈：双方都交给引擎，每步用调整好的时限，到点落子后立即续算，直到终局。
  analysisSelfPlay: boolean;
  analysisSelfPlayTimeMs: number;
  // 开发测试功能：图片识谱「复原手序」（按棋子序号重建落子顺序）。真实截图
  // 实测成功率仍低，默认隐藏；开启后导入流程才出现该开关与相关文案。
  devMoveOrderRestore: boolean;
  // 开发测试功能：图片识谱「不限 15 路」（自动识别棋盘路数）。默认关闭——
  // 应用历来只导入 15 路，因为选错路数的代价是整盘重排（比多一颗子严重得多）。
  // 开启后对齐屏右上角出现「不限 15 路」开关，打开它才走自动路数检测。
  devBoardSizeDetect: boolean;
  // 「在线」入口在 v1.2.0 起**常驻**（用户 09-26：「在线功能可以常驻了，不用开关打开了」）。
  // 这里原先有两个实验开关——`onlineLibrary`（棋谱库里的「在线」面）与
  // `onlinePuzzleSource`（在线面里的「题库」页签），现已删除：入口不再可关。
  // 旧存档里残留的这两个键由 normalize 直接丢弃（不报错、不动任何数据），
  // 用户已经下载/导入的棋谱与题集本来就不受这两个开关影响。
  // 多线程引擎（网页版）。默认关闭：pthread 构建必须跑在跨源隔离页面里
  // （COOP same-origin + COEP require-corp + SharedArrayBuffer），网页版靠
  // Service Worker 注入这两个头才具备条件，而安卓应用内的 WebView 拿不到
  // crossOriginIsolated（平台限制），开了也只会自动回落单线程。引擎侧另有
  // 一道已知风险：历史记录过 wasm SMP 在个别局面搜索死锁（本次 9 局面扫描未
  // 复现），故先做成显式开关，用户可自行权衡。实测同等预算约 4.5×（223K vs
  // 50K nps），深度 +1~2 层。
  engineMultiThread: boolean;
  // 多线程引擎的线程数：0 = 自动（一半核心，与同类网页引擎默认一致）；
  // -1 = 全核（最快也最热，手机上会明显发烫并可能被系统降频）；n>0 = 指定 n。
  // 引擎支持运行时 `INFO THREAD_NUM n`，所以这个值不需要重做数据包。
  engineThreads: number;
  // 开局库（索索夫打点簿，第一档）：人机对局优先查内置打点簿，命中即秒落、
  // 未命中回落引擎。默认关闭；关闭时零占用（book JSON 都不会加载）。
  openingBook: boolean;
  // 识谱多核加速（用户 09-14）：图片识谱用多个线程并行算网格探测与逐格分析，
  // 线程数按设备核心数与可用内存自动定档。默认开启——识别结果与单线程逐位相同
  // （qa/recognition-parallel-parity.mjs 逐张对照），只是更快、界面不卡；
  // 关闭后回落单线程直算，供极老设备或排查问题用。
  fastRecognition: boolean;
  // 分析深度范围（用户 09-16：像五子棋计算器那样给出「最小 / 最大」深度）。
  // 最小 = Rapfi 的 START_DEPTH（迭代加深从第几层起算），0/1 = 从第 1 层正常起算；
  // 最大 = MAX_DEPTH，0 = 自动（持续分析用 512、单次分析 96、落子型回合 64）。
  // 默认两端都是 0：行为与之前逐字一致，只有用户显式选了才改变。
  analysisDepthMin: number;
  analysisDepthMax: number;
  // 分析引擎内存档（T49 火力线，用户 09-13 自调节）：引擎转置表预算 MB。
  // 0=自动（按设备内存 128/64MB 分档——09-12 实测 TT 甜点区，256MB 反而慢 29%）；
  // 256-2048 间任意值（用户要求逐 MB 可调，不是离散档位）。2048 为上限：
  // wasm32 堆 4GB 需留 NNUE/代码余量，分配失败引擎退出，App 侧先降 256 重试
  // 再换轻量（worker 侧 error 兜底链）。
  analysisMaxMemoryMb: number;
  // 分析结果沉淀（用户 09-17 第一梯队②）：每轮分析完成后把评估/深度/节点/候选
  // 存进本机缓存，按局面（documentId+nodeId） keyed；同一局面再打开时面板给出
  // 「载入上次结果」。默认开启（!== false 收窄）；关闭时不写不读、零占用。
  analysisCache: boolean;
  // 整局复盘每手预算：复盘对主线逐手跑有界搜索，这个值决定每手给引擎多久。
  // 400ms=快（几十手约半分钟）、800ms=标准、1500ms=深。上限 5000：复盘是
  // 批量任务，单手给太深会让 60 手局跑不完。
  gameReviewBudgetMs: number;
  // 人机对局结束后自动存档（用户 09-17 第一梯队④）：终局（胜/负/和/超时）时把
  // 对局文档连同结果、时限元数据写进棋谱库，供复盘。
  // **默认关闭**（用户 09-28：「用户如果不主动保存就不会进棋谱库」）——关闭时终局只出结果面板，
  // 由用户点「保存本局」手动落盘；想回到旧行为就在这里打开。未保存的对局不会丢：
  // 它留在「上次对局」会话里（`duel-session.ts`），下次点「人机对战」会问要不要回去。
  aiGameAutoSave: boolean;
  // 顶栏折叠开关（用户 10-07 做成「可选增强功能」的开关项）：顶栏左组「快捷中心」旁的
  // 折叠按钮——点一下把顶栏与状态栏收成一条、高度让给棋盘，再点恢复。默认开启；
  // 关闭后按钮从顶栏消失、已折叠的界面自动展开（否则没有任何入口能把顶栏展开回来）。
  chromeCollapseToggle: boolean;
  // 开局名提示（用户 2026-10-09：「这个功能你搞一个开关，开启后就显示，不开启就没有」）：
  // 人机对局摆出 26 开局时，在棋盘中心下方飘一方宣纸题签（花月 / 雨月…）。
  // **默认开启**——它是纯展示、不挡点击、2.6 秒自散，对新用户是「这软件懂连珠」的第一印象；
  // 且用户要的是「能关掉」而不是「默认没有」。用 !== false 收窄（仅显式关闭才为 false）。
  openingNameHint: boolean;
}

export const DEFAULT_ENHANCEMENT_SETTINGS: EnhancementSettings = {
  pinchZoom: true,
  gestureSwipe: false,
  importShelf: true,
  aiBoardHints: false,
  coachMarks: false,
  movesTextDisplay: true,
  // 用户 10-03：默认「横向滚动」（比自动换行省一行高度），想按行换行去设置里选。
  buttonOverflow: "scroll",
  haptics: false,
  colorVisionFriendly: false,
  boardRotateGesture: true,
  moveRail: true,
  libraryOnlineEntry: true,
  // 奖励弹窗默认都开（与"加开关之前的行为"一致，见字段注释）。
  achievementPopup: true,
  soulPopup: true,
  radialMenu: true,
  // 点棋子回退默认**关闭**（用户 09-26 定稿：先按默认开做了，他体验后要求改成默认关）。
  tapStonePrev: false,
  keyboardShortcuts: true,
  dockMergeMoves: false,
  analysisAuto: false,
  // 持续分析每轮预算：WASM 同步搜索阻塞 worker 事件循环，换手/落子时新轮只能
  // 等旧轮跑完预算才开始（用户 09-11 实测"换手后几十秒才出候选"）——5s→2s
  // 把最坏等待压到 ~3s；滚动续算 + TT 继承，深度照样逐轮累积（T12 实测过
  // 4 轮 depth 13→17 是在 5s 轮下，2s 轮每轮浅 1-2 层，持续分析仍会加深）。
  analysisTimeMs: 2000,
  analysisShowCandidates: true,
  // 默认排序指标 = 访问量、默认显示 5 个（2026-10-01 对标「智子本地版」，用户定稿）：
  // 选点默认指标=**胜率**（2026-10-01 用户明确要求「默认还是胜率吧，不要默认是访问量
  // 了」——此前一版曾默认 nodes，本轮改回并做存档反向迁移）。数量 5 让选点像参考
  // 软件那样「围绕中心展开」。
  analysisCandidateMetric: "winRate",
  analysisCandidateCount: 5,
  analysisCandidateDecimals: 0,
  analysisDepthMin: 0,
  analysisDepthMax: 0,
  analysisPreviewGuide: false,
  analysisQuickToggle: false,
  thinkingIndicatorPosition: "corner",
  fullScreenMode: false,
  analysisHintMode: false,
  analysisSelfPlay: false,
  analysisSelfPlayTimeMs: 2000,
  devMoveOrderRestore: false,
  devBoardSizeDetect: false,
  engineMultiThread: false,
  engineThreads: 0,
  openingBook: false,
// 识谱多核加速默认开启（用户 09-14）：多核不可用时 createParallelAccelerator
// 自己返回 null 并回落单线程，所以默认开不会让老设备识别失败，只会慢一点。
  fastRecognition: true,
// 火力线默认 256MB = ≥4GB 设备的「自动」档（09-12 实测 256 非甜点但保留默认
// 兼容既有用户期望；自调档默认值即「标准」）；用户 09-13：默认最低即标准，
// 向上自调节，256-2048 逐段可设。
  analysisMaxMemoryMb: 128,
  analysisCache: true,
  gameReviewBudgetMs: 800,
  // 用户 09-28：默认不自动入库，改由终局面板的「保存本局」显式保存。
  aiGameAutoSave: false,
  // 顶栏折叠开关默认开启（用户 10-07：做成开关时它本来就是常驻功能）。
  chromeCollapseToggle: true,
  // 开局名提示默认开启（用户 10-09 要的是「能关掉」，不是「默认关掉」）。
  openingNameHint: true,
};

/** 深度档位的收窄：0 一律解释为「自动」（保持既有行为），正数才是有意义的显式档。 */
const clampDepth = (raw: unknown, min: number, max: number): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const value = Math.round(raw);
  if (value <= 0) return 0;
  return Math.min(max, Math.max(min, value));
};

// 分析内存显示：≥1024 显示 GB（整数倍不带小数），否则 MB（768→"768MB"、1536→"1.5GB"）。
export const fmtAnalysisMemory = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB` : `${mb}MB`;

export const normalizeEnhancementSettings = (value: unknown): EnhancementSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ENHANCEMENT_SETTINGS };
  const partial = value as Partial<EnhancementSettings>;
  return {
    pinchZoom: partial.pinchZoom !== false,
    gestureSwipe: partial.gestureSwipe === true,
    importShelf: partial.importShelf !== false,
    aiBoardHints: partial.aiBoardHints === true,
    coachMarks: partial.coachMarks === true,
    // 走棋文字默认开启，因此用 !== false 收窄（仅显式关闭才为 false），其余新功能用 === true。
    movesTextDisplay: partial.movesTextDisplay !== false,
    // 溢出后的行为只认显式的 "wrap"（自动换行）；其余（含旧键 actionOverflow / 布尔 actionRails
    // 那两代存档）一律按新默认「横向滚动」——旧值写的是上一版的默认值，不是用户的选择（见字段注释）。
    buttonOverflow: partial.buttonOverflow === "wrap" ? "wrap" : "scroll",
    haptics: partial.haptics === true,
    colorVisionFriendly: partial.colorVisionFriendly === true,
    // 手感增强组：默认开启，用 !== false 收窄（仅显式关闭才为 false）。
    boardRotateGesture: partial.boardRotateGesture !== false,
    moveRail: partial.moveRail !== false,
    libraryOnlineEntry: partial.libraryOnlineEntry !== false,
    // 奖励弹窗：默认开，用 !== false 收窄（只有显式关过才为 false）。
    achievementPopup: partial.achievementPopup !== false,
    soulPopup: partial.soulPopup !== false,
    radialMenu: partial.radialMenu !== false,
    tapStonePrev: partial.tapStonePrev === true,
    keyboardShortcuts: partial.keyboardShortcuts !== false,
    dockMergeMoves: partial.dockMergeMoves === true,
    // 提示模式与「持续分析 / 自对弈」互斥（旧存档可能三个都真）：提示优先——
    // 否则会出现「界面显示提示模式、后台却在滚动分析甚至逐手落子」的鬼畜状态。
    analysisAuto: partial.analysisHintMode === true ? false : partial.analysisAuto === true,
    analysisTimeMs: typeof partial.analysisTimeMs === "number" && Number.isFinite(partial.analysisTimeMs)
      ? Math.max(500, Math.min(30000, Math.round(partial.analysisTimeMs / 100) * 100))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisTimeMs,
    analysisShowCandidates: partial.analysisShowCandidates !== false,
    // 选点指标：**默认回归胜率**（2026-10-01 用户明确要求「默认还是胜率吧，不要默认是
    // 访问量了」）。前一轮曾把默认迁到 nodes（访问量）、并把存档里的 winRate 一并迁移
    // 过去；本轮反向迁移：存档里的 "nodes"（无论是上一版迁出来的还是显式选的）一律
    // 迁回 "winRate"，score/depth 原样保留。
    analysisCandidateMetric: partial.analysisCandidateMetric === "nodes"
      ? DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateMetric
      : partial.analysisCandidateMetric === "score" || partial.analysisCandidateMetric === "depth"
        ? partial.analysisCandidateMetric
        : DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateMetric,
    analysisCandidateCount: typeof partial.analysisCandidateCount === "number" && Number.isFinite(partial.analysisCandidateCount)
      ? (Math.round(partial.analysisCandidateCount) === 1
        ? DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateCount
        : Math.max(1, Math.min(10, Math.round(partial.analysisCandidateCount))))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateCount,
    analysisCandidateDecimals: typeof partial.analysisCandidateDecimals === "number" && Number.isFinite(partial.analysisCandidateDecimals)
      ? Math.max(0, Math.min(5, Math.round(partial.analysisCandidateDecimals)))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateDecimals,
    analysisPreviewGuide: partial.analysisPreviewGuide === true,
    analysisQuickToggle: partial.analysisQuickToggle === true,
    thinkingIndicatorPosition: partial.thinkingIndicatorPosition === "below" ? "below" : "corner",
    fullScreenMode: partial.fullScreenMode === true,
    analysisHintMode: partial.analysisHintMode === true,
    analysisSelfPlay: partial.analysisHintMode === true ? false : partial.analysisSelfPlay === true,
    analysisSelfPlayTimeMs: typeof partial.analysisSelfPlayTimeMs === "number" && Number.isFinite(partial.analysisSelfPlayTimeMs)
      ? Math.max(1000, Math.min(10000, Math.round(partial.analysisSelfPlayTimeMs / 500) * 500))
      : DEFAULT_ENHANCEMENT_SETTINGS.analysisSelfPlayTimeMs,
    devMoveOrderRestore: partial.devMoveOrderRestore === true,
    devBoardSizeDetect: partial.devBoardSizeDetect === true,
    // 在线入口的两个旧实验键（onlineLibrary / onlinePuzzleSource）不在此列出＝读档时自然丢弃。
    analysisDepthMin: clampDepth(partial.analysisDepthMin, 0, 32),
    analysisDepthMax: clampDepth(partial.analysisDepthMax, 0, 512),
    engineMultiThread: partial.engineMultiThread === true,
    engineThreads: typeof partial.engineThreads === "number" && Number.isFinite(partial.engineThreads)
      ? Math.max(-1, Math.min(256, Math.round(partial.engineThreads)))
      : 0,
    openingBook: partial.openingBook === true,
    // 识谱加速默认开启，用 !== false 收窄（仅显式关闭才为 false）：旧存档里
    // 没有这个键，取默认值 true 就对了——用户 09-14 明确要求默认开启。
    fastRecognition: partial.fastRecognition !== false,
    // 内存自调节：256-2048 间任意整数（逐 32MB 滑杆），非法/越界钳回边界。
    analysisMaxMemoryMb: (() => {
      const raw = partial.analysisMaxMemoryMb;
      if (raw === undefined || raw === null || !Number.isFinite(raw)) return 128;
      return Math.min(2048, Math.max(64, Math.round(raw)));
    })(),
    // 分析沉淀默认开启（!== false）：旧存档没有这个键时取默认 true。
    analysisCache: partial.analysisCache !== false,
    // 复盘每手预算 300-5000ms，逐 100ms 收窄。
    gameReviewBudgetMs: typeof partial.gameReviewBudgetMs === "number" && Number.isFinite(partial.gameReviewBudgetMs)
      ? Math.max(300, Math.min(5000, Math.round(partial.gameReviewBudgetMs / 100) * 100))
      : DEFAULT_ENHANCEMENT_SETTINGS.gameReviewBudgetMs,
    // 对局自动存档默认关闭（=== true 才开）：老存档里没有这个键时按新默认走，
    // 不沿用上一版的默认 true（那是默认值、不是用户的选择）。
    aiGameAutoSave: partial.aiGameAutoSave === true,
    // 顶栏折叠开关默认开启（!== false 收窄）：老存档没有这个键，按钮照常显示，
    // 与做成开关之前的行为逐字一致；只有用户显式关过才隐藏。
    chromeCollapseToggle: partial.chromeCollapseToggle !== false,
    // 开局名提示默认开启（!== false 收窄）：老存档里没有这个键 ⇒ 保留这个新功能，
    // 与"刚做出来时默认就显示"一致；只有用户显式关过才不显示。
    openingNameHint: partial.openingNameHint !== false,
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
