import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { RotateCcw, Eye, EyeOff, ChevronRight, ChevronLeft, ArrowLeft, Settings2, X, Hand, ImageDown, Undo2, Redo2, Eraser } from "lucide-react";
import { VCF_TIER_LABEL, type VcfTier } from "../vcf/vcf-corpus";
import type { Player } from "../../types";
import type { BoardTheme, StoneTheme } from "../../app-shell-types";
import { SvgHtml } from "../../appearance/svg-html";
import { boardLayers, boardLineProps, findBoardMaterial, findStoneMaterial, stoneMarkup } from "../../appearance/render";
import { classifyAttack, VCF_SIZE, vidx, type VcfBoard } from "./engine";
import { DEFAULT_VCF_GEOMETRY, vcfGeometry, VCF_VIEWBOX, type VcfGeometry } from "./board-geometry";
import { columnName } from "../../game";
import { DEFAULT_BOARD_MARGIN } from "../settings/board-margin";
import { DEFAULT_COORDINATE_FONT_SIZE } from "../settings/display-defaults";
import { DEFAULT_STONE_SCALE } from "../settings/stone-size";
import { vcfFivePoints } from "../vcf/vcf-generator";
import { pickMatchedProblem, poolSummary, type ChallengeProblem, type PoolSummary } from "./problems";
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import { sharePngFile } from "../../share-file";
import { parseRuns, problemFromEntry, problemToRuns, runOf, coordName } from "./serialize";
import {
  loadState, saveState, withResult, withSettings, levelGapLabel, resetToStartLevel, markSeen,
  PACE_MODES, PACE_GAIN, PACE_LABELS, paceSecondsFor, handsOfLevel, CHALLENGE_MAX_DEPTH,
  PACE_STEP_GAIN, PACE_CAP, PACE_POST_STEP_EVERY,
  GAIN_MAX, LOSS_MAX, gainPreview, lossPreview,
  HISTORY_PAGE_SIZE, START_LEVELS, START_RATINGS, START_LEVEL_LV, startLevelLabel, startLevelHandRange,
  MATCH_SAME_WEIGHT, MATCH_ADJACENT_WEIGHT, MAX_RATING,
  isTimerWarning,
  levelOf, levelProgress, levelSpanOf, LEVEL_MAX, levelFloor,
  type PaceMode, type StartLevel, type VcfChallengeState, type VcfHistoryEntry,
} from "./rating";
import { VcfItemBar } from "./VcfItemBar";
import { VCF_ITEMS, type VcfItemId } from "./items";
// 等级奖励的**水位线**（2026-10-11 补）：重置等级分时必须跟着抬，
// 否则这条重置就是一条"白拿等级奖励"的旁路（见重置按钮那里的长注释）。
import { saveVcfLevelPaid } from "../progress/soul";
// 本地日期键：共享一处（2026-10-11 收敛，见 local-date.ts 的说明）。
import { localDateKey } from "../../local-date";
// **棋魂商店**（2026-10-11）：重置等级分要收费，走的正是设置页那两件动作商品
// （`action-start-level` / `action-reset-vcf-rating`）。共用同一份定价与扣费实现 ——
// 见重置按钮那里的长注释（用户报的"这里却全部免费"）。
import { soulUnlockById, vcfStartTierUnlock, VCF_START_TIERS } from "../progress/soul-unlocks";
import { useSoulShop } from "../progress/use-soul-shop";
import "./vcf-challenge.css";

type Phase = "picking" | "playing" | "solved" | "failed" | "setup";

/* 挑战棋盘与主盘用**同一套几何**，并且**跟着打谱的显示设置走**（边距 / 坐标字号 / 棋子大小 /
   坐标开关）：几何本身由 `vcfGeometry()` 按这四个值现算（见 board-geometry.ts），
   所以这里只留一个与设置无关的视野常量（PNG 导出用的画布尺寸）。 */
const BOARD_PX = VCF_VIEWBOX;
const STARS: Array<[number, number]> = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
/** 没选材质时的兜底盘/子（挑战页原本的琥珀盘 + 纯黑白子，现已作为 app-amberboard / app-flatstone 上架）。 */
const FALLBACK = { board: "#e8c987", line: "#7a5a28", lineW: 1, star: "#7a5a28" };

interface MoveLog { idx: number; player: Player; num: number }

const rebuildBoard = (p: ChallengeProblem): VcfBoard => {
  const b = new Int8Array(VCF_SIZE * VCF_SIZE);
  for (const st of p.black) b[vidx(st.row, st.col)] = 1;
  for (const st of p.white) b[vidx(st.row, st.col)] = 2;
  return b;
};

/** 稳定的空解答数组：`?? []` 每次渲染都换身份，会让 memo 化的棋盘白白重画。 */
const EMPTY_SOLUTION: ChallengeProblem["solution"] = [];

const fmtClock = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 设置面板用**草稿**：改动先落在草稿上，点「确定」才真正生效（用户 10-06：
 *  「只有点击了确定，才可以真正确定那些设置」）。取消＝丢弃草稿、什么都不动。 */
interface SettingsDraft { attacker: Player | "random"; tier: VcfTier | "auto"; pace: PaceMode; genDeep: boolean }

const matchingKey = (tier: VcfTier | "auto", attacker: Player | "random", state: VcfChallengeState) =>
  JSON.stringify([state.rating, tier, attacker, state.settings.genDeep, state.settings.pace, state.solvedIds, state.seenIds]);

/** `boardTheme` / `stoneTheme` 由 App 传入 = 用户在设置里选的棋盘/棋子材质：
 *  挑战棋盘跟主盘用同一套外观（用户 2026-10-05：「这个棋盘棋子能不能也用我们已经选中的」）。
 *  10-08 起 `boardMargin` / `coordinateFontSize` / `stoneScale` / `showCoordinates` 也由 App 传入
 *  —— 即打谱页那几个显示设置（棋盘侧边 / 坐标字号 / 棋子大小 / 坐标开关），
 *  用户要的是「VCF 挑战的棋盘跟正常打谱那个界面一样大，并跟着设置走」。 */
export function VcfChallengePage({
  onExit, exitRequest = 0, boardTheme = "wood", stoneTheme = "classic",
  boardMargin = DEFAULT_BOARD_MARGIN, coordinateFontSize = DEFAULT_COORDINATE_FONT_SIZE,
  stoneScale = DEFAULT_STONE_SCALE, showCoordinates = true, onSolved,
  placementConfirm = false,
}: {
  onExit?: () => void;
  /** 系统返回（安卓返回键/手势、网页版浏览器返回）由 App 只递增这个计数；
   *  「要不要拦、拦下来弹什么」由本页自己判——局在不在、确认框开没开只有它知道。 */
  exitRequest?: number;
  boardTheme?: BoardTheme;
  stoneTheme?: StoneTheme;
  boardMargin?: number;
  coordinateFontSize?: number;
  stoneScale?: number;
  showCoordinates?: boolean;
  /** 两段式落子（设置「点击确认落子」）：点空位先出圈，再点同一格才落。 */
  placementConfirm?: boolean;
  /**
   * 解出一道题时回调（用户 2026-10-09：「接入 vcf 挑战试试，成功会加入棋魂……
   * 只有赢了会加，输了不加不扣」）。
   *
   * **只在该题「首次计分」时调用一次**——本页的 `scoredRef` 已经是"这题结过账"的真相
   * （重做、从做题记录进来的摆棋都不计分），所以这里复用它，不会重复发。
   * 输的那一支**根本不调**：不加也不扣（不做惩罚，用户明确要求）。
   *
   * 棋魂数额由 App 定（见 `SOUL_EARN_RULES`）并**作为返回值**回给本页显示——
   * 这样"给多少"的口径只有一个地方说了算，本页不自己定价。
   */
  /**
   * 解出一题时回调。
   *
   * `level` / `rating` 是**结算之后的**值（2026-10-10 加）：等级奖励要按"现在几级"
   * 发，而页面自己就是那个算出等级的地方 —— 让 App 再读一次存储会有时序差
   * （写盘 → 读盘之间若被并发插队，可能读到旧值、漏发一级）。
   */
  onSolved?: (info: { problemId: string; depth: number; seconds: number; level: number; rating: number }) => void;
}) {
  /** 棋盘几何按打谱那几个显示设置现算：网格/子/手数/坐标/点击命中全从这一份取（见 board-geometry.ts）。 */
  const geometry = useMemo(
    () => vcfGeometry({ margin: boardMargin, coordinateFontSize, stoneScale }),
    [boardMargin, coordinateFontSize, stoneScale],
  );
  const [state, setState] = useState<VcfChallengeState>(() => loadState());
  /**
   * 棋魂商店（2026-10-11）：重置等级分要花钱，所以本页也要能读余额、扣费。
   *
   * 重置扣费与道具扣库存都由此接线；道具验证通过且保存成功后才执行效果。
   * `useSoulShop` 是 `useSyncExternalStore` 的只读投影 + 写命令，
   * 多一个实例不会多一份状态（快照是模块级共享的）。
   */
  const shop = useSoulShop();
  const [tier, setTier] = useState<VcfTier | "auto">("auto");
  const [attacker, setAttacker] = useState<Player | "random">("random");
  const [phase, setPhase] = useState<Phase>("picking");
  const [problem, setProblem] = useState<ChallengeProblem | null>(null);
  const [board, setBoard] = useState<VcfBoard>(() => new Int8Array(VCF_SIZE * VCF_SIZE));
  const [log, setLog] = useState<MoveLog[]>([]);
  const [lastMove, setLastMove] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean }>({ text: "每一手都必须形成四（冲四）；点下面按等级分匹配题目", bad: false });
  const [showSolution, setShowSolution] = useState(false);
  /** 解答步进：当前显示到第几手（0 基）。-1 = 未显示解答。 */
  const [solutionStep, setSolutionStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [pools, setPools] = useState<PoolSummary | null>(null);
  const [remainMs, setRemainMs] = useState(30_000);   // 下一题手数未知，先摆 1 手档占位（开题后按题归满）
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  /** 结算弹窗的数据与开关（用户 10-06：输赢都弹结算弹窗——动画 + 胜负/等级分说明 +
   *  原本在底部排版里的按钮；动画借人机对战的终局「印×流×光」，去掉题诗）。
   *  how 在 finish() 那一刻锁死，不会被结算后的临时提示顶掉。 */
  const [settle, setSettle] = useState<{ how: string; moves: number; seconds: number } | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 面板里的改动先落在这份草稿上，点「确定」才生效（用户 10-06） */
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  /** 面板头部那枚小按钮展开的「重置等级分」小面板 */
  const [resetOpen, setResetOpen] = useState(false);
  /** 面板头部那枚「?」展开的**设置说明**（用户 10-06：「专门详细在这个说明里面写好」）：
   *  设置面板里原来的零散小字都收进这里，面板本身只留 chip/按钮与实时题池数字。 */
  const [helpOpen, setHelpOpen] = useState(false);
  const openSettingsSheet = useCallback((tab: "settings" | "records") => {
    setSheetTab(tab);
    setResetOpen(false);
    setHelpOpen(false);
    setDraft({ attacker, tier, pace: state.settings.pace, genDeep: state.settings.genDeep });
    setSettingsOpen(true);
  }, [attacker, tier, state.settings.pace, state.settings.genDeep]);
  const [sheetTab, setSheetTab] = useState<"settings" | "records">("settings");
  const [recordPage, setRecordPage] = useState(0);
  const [debugLevel, setDebugLevel] = useState<StartLevel>("lv1");
  const [debugClear, setDebugClear] = useState(false);   // 默认不勾：一键清空太危险
  /** 五档起始等级（1/3/6/9/12，2026-10-12 用户定稿）：**一件商品一档**，
   *  价格在 `VCF_START_TIERS`（soul-unlocks.ts）里，越高越贵。
   *  这里按当前选中的档位取那件商品 —— 不另写价格，否则商店改价那天就分叉了。
   *  取不到时是 `undefined`，`shop.spend` 会拒绝执行（不会出现"免费通过"）。
   *
   *  ⚠ 必须声明在 `debugLevel` **之后**：它读那个 state，写在前面会 TDZ 崩
   *  （本页已有同款先例，见 `applySettings` 上面的注释）。 */
  const settingLevelItem = vcfStartTierUnlock(START_LEVEL_LV[debugLevel]);
  const settingLevelCost = settingLevelItem?.cost ?? 0;
  const [timerKey, setTimerKey] = useState(0);
  /** 摆棋的落子历史（复盘式）：只记空点落子，撤销/重做都在它上面走。
   *  **下一手颜色不另存状态，从这个数组推导**（用户 10-06：撤销后颜色要跟着回退）。 */
  const [setupHistory, setSetupHistory] = useState<Array<{ idx: number; prev: number; next: number }>>([]);
  const [setupRedo, setSetupRedo] = useState<Array<{ idx: number; prev: number; next: number }>>([]);
  /**
   * 提示卡标出的**建议落点**（`idx`；-1 = 没有）。
   *
   * 只在"用了一张提示卡"之后存在；**用户一落子就清掉**（见 onCellClick）——
   * 留着会让那个标记像是"这一手一直建议走这儿"，而它只是当时那一步的答案。
   */
  const [hintCell, setHintCell] = useState(-1);
  /** 两段式落子的待确认格（-1 = 没有）。与 hintCell（提示卡的建议点）是两回事，
   *  两者可以同时在盘上，所以各画一个圈、各一个 data-* 钩子。 */
  const [pendingCell, setPendingCell] = useState(-1);

  useEffect(() => { setPendingCell(-1); }, [board, problem]);
  /** 退出确认弹窗：一局未结算时，任何「离开挑战页」的动作先问一句再走。 */
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  /** 切后台暂停计时：这两个状态只服务「显示」（暂停瞬间页面不可见，回前台靠状态行告知）。 */
  const [hiddenPaused, setHiddenPaused] = useState(false);
  const [clockRunning, setClockRunning] = useState(true);
  const remainRef = useRef(remainMs);
  const scoredRef = useRef(false);
  const boardRef = useRef<SVGSVGElement | null>(null);
  /** 结算后的**后台预取**（用户 2026-10-06：「结算后到点下一题之间是空窗……20/35 手题的
   *  2–6 秒等待能完全消掉」）：一结算就用当时的参数把下一题算好；点「下一题」时参数没变
   *  就直接用，零等待。key 记录预取参数，改设置/等级分变了自然失效。 */
  const prefetchRef = useRef<{ key: string; promise: Promise<ChallengeProblem | null>; controller: AbortController } | null>(null);
  const matchStartRef = useRef(0);
  const requestProblem = useCallback((t: VcfTier | "auto", a: Player | "random", s: VcfChallengeState) => {
    const key = matchingKey(t, a, s);
    if (prefetchRef.current?.key === key) return prefetchRef.current;
    prefetchRef.current?.controller.abort();
    const controller = new AbortController();
    const request = { key, controller, promise: pickMatchedProblem({
      tier: t, attacker: a, rating: s.rating,
      solved: new Set(s.solvedIds), seen: new Set(s.seenIds), recent: new Set(s.seenIds.slice(-200)), genDeep: s.settings.genDeep,
      signal: controller.signal,
    }) };
    prefetchRef.current = request;
    return request;
  }, []);
  const currentMatchKey = useMemo(() => matchingKey(tier, attacker, state),
    [tier, attacker, state.rating, state.settings.genDeep, state.settings.pace, state.solvedIds, state.seenIds]);
  useEffect(() => {
    if (prefetchRef.current && prefetchRef.current.key !== currentMatchKey) {
      prefetchRef.current.controller.abort();
      prefetchRef.current = null;
      matchStartRef.current += 1;
      setLoading(false);
    }
  }, [currentMatchKey]);
  useEffect(() => () => {
    matchStartRef.current += 1;
    prefetchRef.current?.controller.abort();
    prefetchRef.current = null;
  }, []);

  /** 本题的时限（毫秒）：**随手数伸缩**（用户 10-06 定稿的三档计时难度），不再是全局常数——
     每题开局时按 problem.depth 归满（1–3 级 30/35/40s 起、在 4/6/9/11/12/13 级各加一次，13 级后每 2 级加一次，
     最高级收在三档上限 120/210/300s，见 paceSecondsFor）。
     待开始（problem 为空）没有题，用 1 手档的 30s 占位；真正开题后以题目为准重新归满。 */
  const sessionMs = problem ? paceSecondsFor(problem.depth, state.settings.pace) * 1000 : 30_000;

  useEffect(() => { remainRef.current = remainMs; }, [remainMs]);

  useEffect(() => {
    let alive = true;
    void poolSummary(tier, attacker, state.rating, new Set(state.solvedIds)).then((s) => { if (alive) setPools(s); });
    return () => { alive = false; };
  }, [tier, attacker, state.rating, state.solvedIds]);

  const today = useMemo(() => {
    // 日期键走共享的 `localDateKey`（2026-10-11 收敛，原来是就地手写的）。
    const key = localDateKey();
    return state.daily[key] ?? { solved: 0, failed: 0 };
  }, [state]);

  const finish = useCallback((win: boolean, reason?: string) => {
    if (!problem) return;
    const seconds = Math.max(0, Math.round((sessionMs - remainRef.current) / 1000));
    const moves = log.filter((m) => m.player === problem.attacker).length;
    if (scoredRef.current) {
      setPhase(win ? "solved" : "failed");
      setSettle({ how: reason ?? (win ? "挑战成功（本题已结算过，本次不计分）" : "本题失败（本题已结算过，本次不计分）"), moves, seconds });
      setSettleOpen(true);
      return;
    }
    scoredRef.current = true;
    const next = withResult(
      state,
      { id: problem.id, tier: problem.tier, depth: problem.depth, attacker: problem.attacker, ...problemToRuns(problem) },
      win, moves, seconds, PACE_GAIN[state.settings.pace],
    );
    saveState(next);
    setState(next);
    setLastDelta(next.rating - state.rating);
    setPhase(win ? "solved" : "failed");
    setSettle({ how: reason ?? (win ? "VCF 完成" : "本题判负"), moves, seconds });
    setSettleOpen(true);
    // 棋魂：**只在赢、且是本题首次计分时**报一声（上面刚把 scoredRef 置真，
    // 所以重做/从记录进来的摆棋都走不到这里）。输的一支不调——不加也不扣。
    //
    // 现在**不再接收返回值显示**（用户 10-09 第六轮删掉了结算弹窗里那一行）：
    // 右上角的应用级提示条已经把它说清楚了，页面不需要知道数额。
    // 等级取**结算之后**的（上面的 next 就是刚写盘的那份）。
    // 算等级用页面自己的 levelOf —— 与页面上显示的等级是同一个函数，不会两处不一致。
    if (win) onSolved?.({
      problemId: problem.id, depth: problem.depth, seconds,
      level: levelOf(next.rating), rating: next.rating,
    });
  }, [problem, state, log, sessionMs, onSolved]);

  /**
   * 一局未结算 ＝ 该拦一下。`scoredRef` 是「本题已经结过账」的真相：已出胜负、从记录
   * 载入的摆棋（本来就不计分）都不拦；待开始（problem 为空）也不拦。
   */
  const roundUnsettled = problem !== null && !scoredRef.current;
  const roundUnsettledRef = useRef(roundUnsettled);
  roundUnsettledRef.current = roundUnsettled;
  const exitConfirmOpenRef = useRef(false);
  exitConfirmOpenRef.current = exitConfirmOpen;

  /**
   * 所有「要离开 VCF 挑战页」的动作都走这里：左上角返回、系统返回（App 递增 exitRequest）、
   * 以及以后的任何离开入口。一局未结算 → 先弹应用内确认（切底部 tab 不算离开，走不到这里）；
   * 确认框已经开着时再按返回 = 继续挑战（关掉框）；已结算/待开始 → 直接退。
   */
  const requestExit = useCallback(() => {
    if (exitConfirmOpenRef.current) { setExitConfirmOpen(false); return; }
    if (roundUnsettledRef.current) { setExitConfirmOpen(true); return; }
    onExit?.();
  }, [onExit]);
  const requestExitRef = useRef(requestExit);
  requestExitRef.current = requestExit;

  const lastExitRequest = useRef(exitRequest);
  useEffect(() => {
    if (exitRequest === lastExitRequest.current) return;
    lastExitRequest.current = exitRequest;
    requestExitRef.current();
  }, [exitRequest]);

  const startProblem = useCallback(async (t: VcfTier | "auto", a: Player | "random", s: VcfChallengeState) => {
    const start = ++matchStartRef.current;
    setLoading(true);
    setShowSolution(false);
    setSolutionStep(-1);
    setPhase("picking");
    setLastDelta(null);
    setMessage({ text: "正在按你的等级分匹配题目…", bad: false });
    /* 让出一帧再干活：题池命中时整条匹配几乎全在微任务里跑完，浏览器**没有机会**把这句
       「匹配中…」画出来，用户点了 400ms 什么反应都没有（2026-10-06 报的"卡一下，以为没切成功"）。
       一次宏任务让出 → 按钮立刻变成"匹配中…"，随后才做匹配与渲染。 */
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });
    if (start !== matchStartRef.current) return;
    try {
      // Reuse the same promise even while prefetch is still searching. Starting
      // another worker here doubled deep-generation work and delayed both.
      const request = requestProblem(t, a, s);
      const p = await request.promise;
      if (start !== matchStartRef.current || request.controller.signal.aborted) return;
      if (prefetchRef.current === request) prefetchRef.current = null;
      if (!p) {
        setMessage({ text: s.settings.genDeep ? "这一段暂时没有新题了，换个档位或攻方试试" : "这一段没有新题了（题目生成器已在设置里关掉）", bad: true });
        setPhase("failed");
        return;
      }
      setProblem(p);
      // 出题这一刻就记进"已出过"：中途弃局也不会紧接着再撞同一题（rating.ts 的 markSeen）
      const marked = markSeen(s, p.id);
      if (marked !== s) { saveState(marked); setState(marked); }
      setBoard(rebuildBoard(p));
      setLog([]);
      setLastMove(null);
      setRemainMs(paceSecondsFor(p.depth, s.settings.pace) * 1000);
      setTimerKey((k) => k + 1);
      scoredRef.current = false;
      setPhase("playing");
      const genNote = p.generatedOnDemand ? " · 生成器出题" : "";
      setMessage({ text: `你执${p.attacker === "black" ? "黑" : "白"} · ${VCF_TIER_LABEL[p.tier]}${genNote}`, bad: false });
    } catch {
      if (start === matchStartRef.current) {
        prefetchRef.current = null;
        setMessage({ text: "匹配暂时失败，请再试一次", bad: true });
        setPhase("picking");
      }
    } finally {
      if (start === matchStartRef.current) setLoading(false);
    }
    /* 时限不再来自全局设置常数：开题后按 p.depth（与 s.settings.pace）现算，见 paceSecondsFor。 */
  }, [requestProblem]);

  /** 结算后预取下一题（配合 prefetchRef）：只在「已结算」状态跑一次（key 幂等），
   *  生成题要 2–6 秒，正好用结算后的空窗算；改设置/作废当前局会换 key，自然失效。
   *  预取失败不打扰——点「下一题」时照旧走正常匹配。 */
  useEffect(() => {
    if ((phase !== "solved" && phase !== "failed") || !problem) return;
    const request = requestProblem(tier, attacker, state);
    void request.promise.then((p) => {
      if (!p && prefetchRef.current === request) prefetchRef.current = null;
    }).catch(() => {
      if (prefetchRef.current === request) prefetchRef.current = null;
    });
    // Changing phase to picking consumes this request; do not cancel it in
    // effect cleanup. Settings/state changes and unmount cancel it separately.
  }, [phase, problem, state, tier, attacker, requestProblem]);

  /** 作废当前对局回到"待开始"（用户 10-05：在设置里换档位/执子/计时难度，不该让旧局继续跑）。
   *  下一题手数未知，时限先归到 1 手档的 30s 占位；真正开题后按题目深度重新归满
   *  （计时 effect 已按 timerKey/problem 重置，顺着它走）。 */
  const resetRound = useCallback((note: string) => {
    matchStartRef.current += 1;
    prefetchRef.current?.controller.abort();
    prefetchRef.current = null;
    setLoading(false);
    scoredRef.current = false;
    setProblem(null);
    setBoard(new Int8Array(VCF_SIZE * VCF_SIZE));
    setLog([]);
    setLastMove(null);
    setShowSolution(false);
    setSolutionStep(-1);
    setLastDelta(null);
    setSettle(null);
    setSettleOpen(false);
    setSetupHistory([]);
    setSetupRedo([]);
    setRemainMs(30_000);
    setTimerKey((k) => k + 1);
    setPhase("picking");
    setMessage({ text: note, bad: false });
  }, []);

  /**
   * 面板底部的「确定」：草稿落到真实设置上。
   * 只有真的改了东西才 resetRound（作废当前局）——用户 10-06：
   * 「只有点击了确定了，才可以真正确定那些设置」。
   * 注意：必须在 resetRound 之后定义（useCallback 的依赖数组在渲染期就要读它，写在前面会 TDZ 崩）。
   */
  const confirmSettings = useCallback(() => {
    if (!draft) { setSettingsOpen(false); return; }
    const changed: string[] = [];
    if (draft.attacker !== attacker) changed.push(draft.attacker === "random" ? "随机执子" : draft.attacker === "black" ? "你执黑" : "你执白");
    if (draft.tier !== tier) changed.push(`档位「${draft.tier === "auto" ? "自动" : VCF_TIER_LABEL[draft.tier]}」`);
    const paceChanged = draft.pace !== state.settings.pace;
    const genChanged = draft.genDeep !== state.settings.genDeep;
    if (paceChanged) changed.push(`计时难度「${PACE_LABELS[draft.pace]}」（得分 ×${PACE_GAIN[draft.pace]}）`);
    if (genChanged) changed.push(draft.genDeep ? "题目生成器已开启" : "题目生成器已关闭");
    if (paceChanged || genChanged) {
      const next = withSettings(state, { pace: draft.pace, genDeep: draft.genDeep });
      saveState(next); setState(next);
    }
    if (draft.attacker !== attacker) setAttacker(draft.attacker);
    if (draft.tier !== tier) setTier(draft.tier);
    setDraft(null);
    setSettingsOpen(false);
    if (changed.length) resetRound(`已应用：${changed.join("、")}；当前对局已作废，点下面重新开始`);
  }, [draft, attacker, tier, state, resetRound]);

  const restore = useCallback(() => {
    if (!problem) return;
    setBoard(rebuildBoard(problem));
    setLog([]);
    setLastMove(null);
    setShowSolution(false);
    setSolutionStep(-1);
    setRemainMs(paceSecondsFor(problem.depth, state.settings.pace) * 1000);
    setTimerKey((k) => k + 1);
    setSetupHistory([]); setSetupRedo([]);
    setPhase("playing");
    setMessage({ text: "重新开始这一局，计时重来", bad: false });
  }, [problem, state.settings.pace]);

  /** 进摆棋前处于哪个阶段：**退出摆棋要回到它**（用户 10-06：「退出就是退出了，不用重新挑战」）。 */
  const phaseBeforeSetup = useRef<Phase>("playing");

  const enterSetup = useCallback((note: string) => {
    setSetupHistory([]); setSetupRedo([]);
    setPhase((current) => { phaseBeforeSetup.current = current === "setup" ? phaseBeforeSetup.current : current; return "setup"; });
    setMessage({ text: note, bad: false });
  }, []);

  const toggleSetup = useCallback(() => {
    if (!problem) return;
    if (phase === "setup") {
      /* 只退出摆棋模式，**不作废这一局、也不重新计时**：
         棋盘上摆着的子留着（想看就继续看），回到进摆棋前的阶段（失败/胜利/在进行）。 */
      const back = phaseBeforeSetup.current === "setup" ? "playing" : phaseBeforeSetup.current;
      setPhase(back);
      setMessage({ text: back === "playing" ? "已退出摆棋（这一局继续）" : "已退出摆棋", bad: false });
      return;
    }
    enterSetup("摆棋模式（复盘式）：只在空点按手序落子，黑/白自动交替；点已有子不改变局面。可用上一步/下一步/清空，退出摆棋回到本来的局面。");
  }, [problem, phase, enterSetup]);

  /** 清空摆的子，回到原局面——**留在摆棋模式**（和"退出摆棋"区分开）。
   *  用户 10-07：「清空」「复原」两个键功能撞了（两个都是 `rebuildBoard(problem)`，
   *  差别只在复原多清了 log/lastMove），所以删掉「复原」，把清 log/lastMove 并到这里：
   *  回到原局面时不该再留着上一手的红圈和手数标记。 */
  const clearPlacements = useCallback(() => {
    if (!problem) return;
    setBoard(rebuildBoard(problem));
    setLog([]);
    setLastMove(null);
    setSetupHistory([]); setSetupRedo([]);
    setMessage({ text: "已清空摆的子，回到原局面（仍在摆棋模式）。", bad: false });
  }, [problem]);

  const undoSetup = useCallback(() => {
    setSetupHistory((h) => {
      const last = h[h.length - 1];
      if (!last) return h;
      const nb = board.slice() as VcfBoard;
      nb[last.idx] = last.prev;
      setBoard(nb);
      setSetupRedo((r) => [...r, last]);
      return h.slice(0, -1);
    });
  }, [board]);

  const redoSetup = useCallback(() => {
    setSetupRedo((r) => {
      const last = r[r.length - 1];
      if (!last) return r;
      const nb = board.slice() as VcfBoard;
      nb[last.idx] = last.next;
      setBoard(nb);
      setSetupHistory((h) => [...h, last]);
      return r.slice(0, -1);
    });
  }, [board]);

  /** 从做题记录点进来：载入该题局面（已结算过，重做不计分）。 */
  const openRecord = useCallback((h: VcfHistoryEntry) => {
    const p = problemFromEntry(h);
    if (!p) { setMessage({ text: "这条老记录没存局面，载入不了", bad: true }); setSettingsOpen(false); return; }
    // Loading a record supersedes an in-flight next question, even though the
    // matching settings have not changed. Its late result must not turn this
    // scored replay back into a new, scoring round.
    matchStartRef.current += 1;
    prefetchRef.current?.controller.abort();
    prefetchRef.current = null;
    setLoading(false);
    setProblem(p);
    setBoard(rebuildBoard(p));
    setLog([]);
    setLastMove(null);
    setShowSolution(false);
    setSolutionStep(-1);
    setRemainMs(paceSecondsFor(p.depth, state.settings.pace) * 1000);
    setTimerKey((k) => k + 1);
    scoredRef.current = true;
    setLastDelta(null);
    setSettingsOpen(false);
    setSetupHistory([]); setSetupRedo([]);
    /* 进摆棋要**自己**记下「退出后回哪一阶段」：不写这条就沿用上一局遗留的阶段（认输→failed），
       退出摆棋会落回结算条，而这句话自己承诺的是「退出摆棋可重做（不计分）」（2026-10-08 实测）。 */
    phaseBeforeSetup.current = "playing";
    setPhase("setup");   // 记录点进来默认进摆棋（用户 10-04：先看/摆，不直接开挑战）
    setMessage({ text: `已载入这条记录（${p.depth} 手）· 摆棋模式，退出摆棋可重做（不计分）`, bad: false });
  }, [state.settings.pace]);

  const exportPng = useCallback(async () => {
    const svg = boardRef.current;
    if (!svg || !problem) return;
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      const svgUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg 渲染失败"));
        img.src = svgUrl;
      });
      URL.revokeObjectURL(svgUrl);
      const scale = 2;
      const footer = 44;
      const canvas = document.createElement("canvas");
      canvas.width = BOARD_PX * scale;
      canvas.height = (BOARD_PX + footer) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#f7f3e9";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, BOARD_PX * scale, BOARD_PX * scale);
      ctx.fillStyle = "#57514a";
      ctx.font = `${12 * scale}px system-ui, "Noto Sans SC", sans-serif`;
      const note = `${problem.attacker === "black" ? "黑" : "白"}先 · ${problem.depth} 手 · ${levelGapLabel(problem.depth, state.rating)} · 半步五子棋 VCF 挑战`;
      ctx.fillText(note, 8 * scale, (BOARD_PX + 27) * scale);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("toBlob 失败");
      const file = new File([blob], `VCF-${problem.depth}手-${problem.id}.png`, { type: "image/png" });
      const outcome = await sharePngFile(file, "半步五子棋 · VCF 挑战", note);
      if (outcome === "unavailable") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = file.name; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        setMessage({ text: `图片已开始下载：${file.name}`, bad: false });
      } else if (outcome === "shared") {
        setMessage({ text: "图片已生成，已唤起分享", bad: false });
      } else if (outcome === "cancelled") {
        setMessage({ text: "已取消分享", bad: false });
      } else {
        setMessage({ text: "图片已生成", bad: false });
      }
    } catch {
      setMessage({ text: "生成图片失败，稍后或换设备再试", bad: true });
    }
  }, [problem]);

  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; }, [finish]);

  /**
   * 切后台（visibilitychange）暂停计时（用户 2026-10-06）。
   *
   * 为什么是暂停而不是照走：VCF 挑战是本机练习，切后台最常见的原因就是「来了消息/接了电话」，
   * 后台那几十秒照扣、甚至直接判负，等于让人掏一次手机白丢一局；这里宁可暂停，回来从
   * 暂停处接着算，**不判负**。但必须如实告诉用户「暂停了」：进入后台那一刻页面本来就
   * 看不见，所以回前台时状态行会补一句「已回到前台，计时从暂停处继续」——不允许偷偷
   * 把后台时间补回来，也不允许静默少扣让人以为没暂停。
   *
   * 安卓侧 WebView 在 Activity 暂停/恢复时会发标准 visibilitychange（与 App 里
   * `appHidden()` 同一套机制），没有引入 Capacitor appStateChange 插件。
   */
  useEffect(() => {
    if (phase !== "playing" || !problem) { setClockRunning(true); setHiddenPaused(false); return; }
    setClockRunning(!document.hidden);
    setHiddenPaused(document.hidden);
    const onVisibility = () => {
      const hidden = document.hidden;
      setClockRunning(!hidden);
      setHiddenPaused(hidden);
      setMessage({ text: hidden ? "已切到后台，计时暂停；回来接着算。" : "已回到前台，计时从暂停处继续（不判负）。", bad: false });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, problem]);

  /* 每局/每次重开把剩余时间归满。**必须和计时器分开写**：这条只在「局标识」变化时跑
     （phase/problem/timerKey/sessionMs），切后台暂停回来时不能再归满——否则暂停一次
     反而白赚回整局时间。 */
  useEffect(() => {
    if (phase !== "playing" || !problem) return;
    setRemainMs(sessionMs);
    remainRef.current = sessionMs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, problem, timerKey, sessionMs]);

  /* 计时器：clockRunning 为 false（切后台）时整条 interval 拆掉，剩余时间冻结在
     remainRef 里；回前台以「现在」为新基准接着扣，后台那段一秒都不算。 */
  useEffect(() => {
    if (phase !== "playing" || !problem || !clockRunning) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const left = remainRef.current - (now - last);
      last = now;
      if (left <= 0) {
        window.clearInterval(id);
        remainRef.current = 0;
        setRemainMs(0);
        finishRef.current(false, "时间到，本题判负");
        return;
      }
      remainRef.current = left;
      /* 只有**显示的秒数**变了才 setState（原来 100ms 一次 = 每秒 10 次整页重渲染，
         手机上就是持续掉帧；进度条用 CSS 过渡补平滑）。超时判定仍按 100ms 精度。 */
      setRemainMs((prev) => (Math.ceil(prev / 1000) === Math.ceil(left / 1000) ? prev : left));
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, problem, timerKey, sessionMs, clockRunning]);

  /** 摆棋的下一手颜色：**从落子历史推导**，不另存状态——
   *  没摆过子时轮到本题攻方（problem.attacker）先手；倒数第二手之后轮到下一色。
   *  这样「上一步」撤掉一手、颜色就正好回到被撤销那一手，「下一步」重做又推进回去。 */
  const setupTurn: Player = useMemo(() => {
    const last = setupHistory[setupHistory.length - 1];
    if (!last) return problem?.attacker ?? "black";
    return last.next === 1 ? "white" : "black";
  }, [problem, setupHistory]);
  const setupTurnCode = setupTurn === "black" ? 1 : 2;
  const setupTurnChar = setupTurn === "black" ? "黑" : "白";

  /**
   * 用道具（用户 2026-10-10：「加时卡，提示卡，悔棋卡」）。
   *
   * 先验证这一手能用，再成功保存扣库存，最后执行效果；写盘失败时不能白送效果。
   *
   * 只有在对局中才能用：结算后（solved/failed）用加时毫无意义、
   * 用悔棋会改动已经算过分的局面（等级分已经结算了，改盘面会让记录与分数对不上）。
   */
  const useItem = useCallback((id: VcfItemId): boolean => {
    if (!problem || phase !== "playing") {
      setMessage({ text: "这一手已经结算了，道具只能在对局中用。", bad: true });
      return false;
    }
    const item = VCF_ITEMS.find((entry) => entry.id === id);
    if (!item) return false;
    const consume = () => {
      if (shop.useItem(id)) return true;
      setMessage({ text: "道具未能保存，尚未使用。请稍后重试。", bad: true });
      return false;
    };

    if (id === "extra-time") {
      if (!consume()) return false;
      // 加时：**ref 与 state 一起加**（计时器读的是 ref，显示读的是 state；
      // 只加一个会出现"数字涨了但计时仍按旧值走"）。
      const next = remainRef.current + item.amount * 1000;
      remainRef.current = next;
      setRemainMs(next);
      setMessage({ text: `已用加时卡：本题时间 +${item.amount} 秒`, bad: false });
      return true;
    }

    if (id === "undo") {
      /**
       * 悔棋：撤掉**最后一手**。
       *
       * 需要考虑"最后一手是守方的挡子"这种情况 —— 落子记录里守方那一手 `num` 是 0
       * （见 onCellClick：守方的挡子是自动补的，不占手序）。所以：
       *  · 若最后一手是守方挡子 ⇒ 连它和攻方那一手一起撤（否则会留下一个
       *    "攻方冲四、守方没挡"的非法局面，`classifyAttack` 下次会判非法）；
       *  · 若最后一手就是攻方的 ⇒ 只撤它。
       */
      if (log.length === 0) {
        // ⚠ 这里必须返回 false：调用方据此**不扣道具**（实测过"点了悔棋、提示说没得悔、
        // 但道具已经少了一个"—— 白损失）。
        setMessage({ text: "还没有落子，没有可悔的一手。", bad: true });
        return false;
      }
      if (!consume()) return false;
      const lastEntry = log[log.length - 1];
      const cut = lastEntry.num === 0 ? 2 : 1;
      const trimmed = log.slice(0, Math.max(0, log.length - cut));
      const removed = log.slice(trimmed.length);
      const next = board.slice() as VcfBoard;
      for (const move of removed) next[move.idx] = 0;
      setBoard(next);
      setLog(trimmed);
      setLastMove(trimmed.length ? trimmed[trimmed.length - 1].idx : -1);
      setMessage({ text: `已用悔棋卡：撤掉 ${removed.length} 手，重新算这一步`, bad: false });
      return true;
    }

    // 提示：亮出**这一手该走哪儿**（按参考解答推：已落子数与解答进度对齐）。
    // ⚠ 用"攻方已下几手"去索引解答，而不是"总手数" —— 解答序列里攻守交替，
    // 而守方的挡子是自动补的，两者的下标不是一回事。
    const myMoves = log.filter((move) => move.player === problem.attacker).length;
    const answer = problem.solution[myMoves];
    if (!answer) {
      setMessage({ text: "参考解答到这一步就没了，只能自己接着算。", bad: true });
      return false;
    }
    if (!consume()) return false;
    // 标注在棋盘上（复用既有 lastMove 的视觉太重，这里单独给一个提示标记）
    setHintCell(answer.row * VCF_SIZE + answer.col);
    setMessage({ text: `已用提示卡：下一手走 ${coordName(answer.row, answer.col)}（剩下的仍要自己算）`, bad: false });
    return true;
  }, [problem, phase, log, board, shop.useItem]);

  const onCellClick = useCallback((r: number, c: number) => {
    if (!problem) return;
    const cell = vidx(r, c);
    /* 两段式落子（设置「点击确认落子」）：空位第一下只把圈放这儿，第二下点同一格才继续往下走
       （对局中的判四/摆棋的按手序落子都保持各自原逻辑）。点已有子的格子不拦——那些分支本来
       就是"提示怎么用撤销/清空"，拦了反而说不清。 */
    if (placementConfirm && board[cell] === 0 && (phase === "playing" || phase === "setup")) {
      if (pendingCell === cell) setPendingCell(-1);
      else { setPendingCell(cell); return; }
    }
    if (phase === "setup") {
      /* 复盘式摆棋（用户 10-06）：**只在空点按手序落子**。
         点已有子什么都不做——不消子、不改局面，只提示怎么撤销/清空。 */
      if (board[cell] !== 0) {
        setMessage({ text: "摆棋按手序落子：点空点落下一手；撤销用「上一步」，清空用「清空」。", bad: false });
        return;
      }
      const next = board.slice() as VcfBoard;
      next[cell] = setupTurnCode;
      setBoard(next);
      setSetupHistory((h) => [...h, { idx: cell, prev: 0, next: setupTurnCode }]);
      setSetupRedo([]);
      setMessage({ text: `已摆${setupTurnChar}子 · 下一手 ${setupTurnChar === "黑" ? "白" : "黑"}方`, bad: false });
      return;
    }
    if (phase !== "playing" || board[cell] !== 0) return;
    const verdict = classifyAttack(board, r, c, problem.attacker);
    if (!verdict.ok) {
      setMessage({ text: verdict.message, bad: true });
      return;
    }
    const attackerCode = problem.attacker === "black" ? 1 : 2;
    const defender: Player = problem.attacker === "black" ? "white" : "black";
    const defenderCode = attackerCode === 1 ? 2 : 1;
    const next = board.slice() as VcfBoard;
    next[cell] = attackerCode;
    const myNum = log.filter((m) => m.player === problem.attacker).length + 1;
    const newLog: MoveLog[] = [...log, { idx: cell, player: problem.attacker, num: myNum }];
    let newLast = cell;
    let counterWarning = "";
    if (verdict.outcome === "continue") {
      const block = verdict.block as number;
      next[block] = defenderCode;
      newLog.push({ idx: block, player: defender, num: 0 });
      newLast = block;
      counterWarning = defenderHasFour(next, defender) ? "（守方有反击四！下一手必须带四并挡住它）" : "";
    }
    setBoard(next);
    setLog(newLog);
    setLastMove(newLast);
    // 落了子就把提示标记撤掉：它只是"当时那一步"的答案，留着会像是持续建议。
    setHintCell(-1);
    setMessage({ text: verdict.message + counterWarning, bad: counterWarning !== "" });
    if (verdict.outcome === "win") {
      // 结算行要说清「怎么赢的」：引擎赢棋文案都带「……挑战成功」尾巴，掐掉（「胜利」俩字已在行首）。
      const how = verdict.message.includes("五连") ? "五连"
        : verdict.message.includes("活四") ? "活四/双四，守方无解"
        : "无法防守的冲四";
      finish(true, how);
    }
  }, [phase, problem, board, log, finish, setupTurnCode, placementConfirm, pendingCell]);

  const sideChar = problem ? (problem.attacker === "black" ? "黑" : "白") : "—";
  /** 参考解答序列（攻守交替，下标即手序）。 */
  const solution = problem?.solution ?? EMPTY_SOLUTION;
  const secondsShown = Math.ceil(remainMs / 1000);
  // 只到最后 1 秒才转红（用户 2026-10-05：不要提前一大截就变红）
  const timerWarn = isTimerWarning(remainMs, phase);
  const progressPct = phase === "playing" ? (remainMs / sessionMs) * 100 : phase === "setup" ? 100 : 0;

  /**
   * 棋盘视图一次算清（用户 2026-10-06：「显示答案时……一个个往前覆盖，而不是回退到上一步」）。
   *
   * 根因：解答以前是**叠加**在「你这一局的盘面」上画的——盘上同时有你答题落的子与解答覆盖层，
   * 「上一手」只是把覆盖层里第 k 手之后的解答子收掉，你自己落的子与编号还留在盘上，看起来就是
   * 「子没退」；「下一手」又往同一盘面上叠。现在：showSolution 时棋盘 = 题目初始局面 +
   * 解答第 1..k 手（你答题落的子一律不进盘面），showSolution 关掉时恢复你自己那一局。
   * 这是**纯渲染视图**，不写回 board/log——答题、计分、结算照旧用真状态。
   */
  const view: BoardView = useMemo(() => {
    if (showSolution && problem) {
      const b = rebuildBoard(problem);
      const nums: MoveLog[] = [];
      const rings: Array<{ idx: number; current: boolean }> = [];
      const k = Math.min(solutionStep, problem.solution.length - 1);
      for (let i = 0; i <= k; i += 1) {
        const m = problem.solution[i];
        const idx = vidx(m.row, m.col);
        b[idx] = m.player === "black" ? 1 : 2;
        nums.push({ idx, player: m.player, num: i + 1 });
        rings.push({ idx, current: i === solutionStep });
      }
      // 解答视图不给提示标记（解答自己就画了每一步，再叠一个圈只会更乱）
      return { board: b, nums, lastMove: null, rings, hintCell: -1, pendingCell };
    }
    return { board, nums: log, lastMove, rings: [], hintCell, pendingCell };
  }, [showSolution, problem, solutionStep, board, log, lastMove, hintCell, pendingCell]);

  const primary = (() => {
    if (phase === "setup") return { label: "退出摆棋", onClick: toggleSetup, kind: "secondary" as const };
    if (phase === "playing") return { label: "认输（判负）", onClick: () => finish(false, "已认输，本题判负"), kind: "secondary" as const };
    if (phase === "picking") return { label: loading ? "匹配中…" : "开始挑战", onClick: () => void startProblem(tier, attacker, state), kind: "primary" as const, disabled: loading };
    return { label: "下一题", onClick: () => void startProblem(tier, attacker, state), kind: "primary" as const };
  })();

  /* 结算后胜负说明并进底部结算条（用户 10-06），所以顶部提示条在 solved/failed 不画。
     但**一道题都没开出来**的 failed 根本没有结算条可并——那时唯一能给用户的理由就是这句
     「这一段暂时没有新题了」（2026-10-08 实测：等级分 3400 关掉生成器，6 局里 4 局空手，界面只剩空盘）。 */
  const settledBar = (phase === "solved" || phase === "failed") && Boolean(problem);

  const totalPages = Math.max(1, Math.ceil(state.history.length / HISTORY_PAGE_SIZE));
  const page = Math.min(recordPage, totalPages - 1);
  const pageItems = state.history.slice(page * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);

  return (
    <div className="vcfch-page" data-vcf-paused={hiddenPaused ? "1" : "0"}>
      {/* 除棋盘之外的全部行都装进这一层。竖屏它是 `display:contents`（完全不参与布局），
          靠 vcf-challenge.css 里那组 `order` 把视觉顺序复原成改造前逐字相同（棋盘排第 2）；
          横屏变成铺满左右两条空隙的三列网格，中间那一列永远空着给居中的棋盘。 */}
      <div className="vcfch-rail">
      <header className="vcfch-top">
        <div className="vcfch-top-row">
          {/* 左上角返回不直接 onExit：局未结算时先走确认弹窗（与系统返回同一条路）。 */}
          {onExit && <button type="button" onClick={requestExit} aria-label="返回对弈" data-vcf-back><ArrowLeft size={15}/></button>}
          <div className="vcfch-rating-inline">
            <span>等级分</span><b>{state.rating}</b>
            <em className="vcfch-level-chip" title={levelOf(state.rating) >= LEVEL_MAX ? "已到最高等级" : `距等级 ${levelOf(state.rating) + 1} 还差 ${levelFloor(levelOf(state.rating) + 1) - state.rating} 分（本级共 ${levelSpanOf(levelOf(state.rating))} 分）`}>
              等级 {levelOf(state.rating)}<i aria-hidden="true"><u style={{ width: `${Math.round(levelProgress(state.rating) * 100)}%` }} /></i>
            </em>
          </div>
          <div className="vcfch-top-actions">
            <button type="button" onClick={() => openSettingsSheet("settings")} aria-label="VCF 挑战设置"><Settings2 size={15}/></button>
          </div>
        </div>
        {/* 统计单独一行：手机上够放，不再和等级分挤一行把字截断 */}
        <small className="vcfch-top-info">今日 {today.solved} 对 / {today.failed} 错 · 连胜 {state.streak} · 计时 {PACE_LABELS[state.settings.pace]}</small>
      </header>

      {problem && showSolution && (
        <div className="vcfch-solution-bar" role="status" aria-label="解答步进">
          <span>解答第 <b>{solutionStep + 1}</b> / {problem.solution.length} 手</span>
          {problem.solution[solutionStep] && (() => {
            const m = problem.solution[solutionStep];
            return <em>{m.player === "black" ? "黑" : "白"}方 · {coordName(m.row, m.col)}</em>;
          })()}
          {/* 题源只写了攻方冲四、推不出对方的挡子时如实说明 —— 否则一条全同色的线看着像"答案画错了" */}
          {problem.singleSide && <em className="vcfch-solution-side">只列攻方冲四，未收录对方挡子</em>}
        </div>
      )}

      <div className="vcfch-status">
        <div className="vcfch-status-left">
          <span className={`vcfch-side-chip${problem?.attacker === "white" ? " white-side" : ""}`}>
            <i className="stone" aria-hidden="true" />
            <em>你执</em>
            <b>{sideChar}</b>
          </span>
          {problem && <span className="vcfch-meta">{problem.depth} 手 · {levelGapLabel(problem.depth, state.rating)}</span>}
          {/* 摆棋时把「下一手是谁」写出来：复盘式自动交替，用户要看得见（10-06） */}
          {problem && phase === "setup" && (
            <span className="vcfch-setup-turn" data-vcf-setup-turn="">
              摆棋中 · 下一手 <b>{setupTurnChar}方</b>
            </span>
          )}
        </div>
        {/* 道具栏（用户 2026-10-10 第二轮：「放到计时的左边，和计时在同一行」；
            2026-10-12 第三轮：「三个道具再大一点，+号放下面，不超过左边两个加起来的高度」）。
            所以它仍是状态行的**右块**、与计时同排，只是每颗改成"上=图标+数量、下=+号"
            的竖排小卡（46×52，见 VcfItemBar 与 vcf-challenge.css 的 .vcfch-item）。
            ⚠ **不挂在 `problem &&` 下面**：VCF 页打开时是「待开始」阶段（还没选题），
            如果这时不渲染，用户进去会看不到道具栏、以为功能没做。
            所以它**常在**，只是待开始/结算后禁用。 */}
        <div className="vcfch-status-right">
          <VcfItemBar onUse={useItem} enabled={phase === "playing"}/>
          <div className={`vcfch-clock${timerWarn ? " warn" : ""}`}>
            <b>{phase === "playing" ? secondsShown : "--"}</b><span>秒</span>
          </div>
        </div>
      </div>
      <div className={`vcfch-progress${timerWarn ? " warn" : ""}`}><i style={{ width: `${progressPct}%` }} /></div>

      {/* 结算后胜负说明并进下面的结算行（用户 10-06），这一行只负责对局中/摆棋中的临时提示 */}
      {message && !settledBar && (
        <div className={`vcfch-message ${message.bad ? "bad" : "ok"}`} role="status">{message.text}</div>
      )}

      {problem && phase === "setup" && (
        <div className="vcfch-setup-bar" role="toolbar" aria-label="摆棋工具">
          <span className="vcfch-setup-nav">
            <button type="button" onClick={undoSetup} disabled={setupHistory.length === 0} aria-label="上一步">
              <Undo2 size={15} /><em>上一步</em>
            </button>
            <button type="button" onClick={redoSetup} disabled={setupRedo.length === 0} aria-label="下一步">
              <Redo2 size={15} /><em>下一步</em>
            </button>
            <button type="button" onClick={clearPlacements} aria-label="清空摆的子，回到原局面">
              <Eraser size={15} /><em>清空</em>
            </button>
            <button type="button" onClick={toggleSetup} aria-label="退出摆棋">
              <X size={15} /><em>退出摆棋</em>
            </button>
          </span>
        </div>
      )}
      {problem && (phase === "solved" || phase === "failed") && (
        <div className={`vcfch-outcome ${phase === "solved" ? "win" : "lose"}`} role="status">
          <b>{phase === "solved" ? "胜利" : "失败"}</b>
          <small>{settle?.how}</small>
          {lastDelta !== null && <span className="vcfch-delta">等级分 {lastDelta === 0 ? "不变" : `${lastDelta > 0 ? "+" : ""}${lastDelta}`}</span>}
        </div>
      )}
      {problem && (phase === "solved" || phase === "failed") && (
        <div className="vcfch-actions">
          {showSolution ? <>
            <button type="button" onClick={() => setSolutionStep((s) => Math.max(0, s - 1))} disabled={solutionStep <= 0} aria-label="解答上一手"><ChevronLeft size={14} /> 上一手</button>
            <button type="button" onClick={() => setSolutionStep((s) => Math.min(solution.length - 1, s + 1))} disabled={solutionStep >= solution.length - 1} aria-label="解答下一手">下一手 <ChevronRight size={14} /></button>
            <button type="button" className="active" onClick={() => { setShowSolution(false); setSolutionStep(-1); }}><EyeOff size={14} /> 隐藏解答</button>
            <button type="button" onClick={() => void exportPng()}><ImageDown size={14} /> 存为图片</button>
          </> : <>
            <button type="button" onClick={restore}><RotateCcw size={14} /> 重试</button>
            <button type="button" onClick={toggleSetup}><Hand size={14} /> 摆棋</button>
            <button type="button" onClick={() => { setShowSolution(true); setSolutionStep(Math.max(0, solution.length - 1)); }}><Eye size={14} /> 查看解答</button>
            <button type="button" onClick={() => void exportPng()}><ImageDown size={14} /> 存为图片</button>
          </>}
        </div>
      )}

      <div className="vcfch-bottom">
        <button type="button" className={`vcfch-primary ${primary.kind}`} onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
          {phase === "solved" || phase === "failed" ? <ChevronRight size={18} /> : null}
        </button>
      </div>
      </div>

      <BoardSvg
        view={view}
        geo={geometry}
        showCoordinates={showCoordinates}
        boardTheme={boardTheme} stoneTheme={stoneTheme}
        onCell={onCellClick} interactive={phase === "playing" || phase === "setup"}
        svgRef={boardRef}
      />


      {/* 结算弹窗（用户 10-06：输赢都弹——动画 + 胜负/等级分说明 + 原本底部排版里的按钮）。
          动画借人机对战的终局「印×流×光」但**去掉题诗**（用户点名不要「绝艺如君天下少」这类）。
          点蒙皮关掉回到底部结算条；「下一题/重试/摆棋/查看解答」各自接管并关弹窗。 */}
      {problem && settleOpen && settle && (phase === "solved" || phase === "failed") && (
        <div className="vcfch-endbackdrop" onClick={() => setSettleOpen(false)}>
          <div className={`vcfch-end vcfch-end--${phase === "solved" ? "won" : "lost"}`} role="dialog" aria-modal="true"
            aria-label="本题结算" onClick={(e) => e.stopPropagation()}>
            <div className="vcfch-end-halo" aria-hidden="true"><i /><i /><i /></div>
            <div className="vcfch-end-card">
              <div className="vcfch-end-flowclip" aria-hidden="true"><div className="vcfch-end-flow" /></div>
              {phase === "solved" && <div className="vcfch-end-dust" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>}
              <div className="vcfch-end-stampwrap" aria-hidden="true">
                <span className="vcfch-end-stamp">{phase === "solved" ? "胜" : "负"}<i /></span>
              </div>
              <span className="vcfch-end-stroke" aria-hidden="true" />
              <small className="vcfch-end-sub">{settle.how}</small>
              <div className="vcfch-end-stats">
                <div><small>等级分</small><b className={lastDelta == null ? "" : lastDelta > 0 ? "up" : lastDelta < 0 ? "down" : "flat"}>
                  {lastDelta == null ? "—" : lastDelta === 0 ? "不变" : `${lastDelta > 0 ? "+" : ""}${lastDelta}`}
                </b></div>
                <div><small>本题</small><b>{problem.depth} 手</b></div>
                <div><small>用时</small><b>{settle.seconds} 秒</b></div>
              </div>
              {/* 棋魂那一行**已删**（用户 10-09 第六轮：「我发现获得棋魂时右上角会有弹窗，
                  那这样的话，我们原本在 vcf 挑战里面或者什么其他弹窗里面加入的这种文本
                  就可以去掉了」）。
                  右上角那个紧凑条已经说清「获得 N 棋魂 + 来源」，同一件事在结算弹窗里
                  再说一遍是重复；而且那个条是**应用级统一出口**，所有获得路径都走它，
                  各页面再各写一份是用不上的副本。 */}
              <div className="vcfch-end-actions">
                <button type="button" onClick={() => { setSettleOpen(false); restore(); }}><RotateCcw size={14} /> 重试</button>
                <button type="button" onClick={() => { setSettleOpen(false); toggleSetup(); }}><Hand size={14} /> 摆棋</button>
                <button type="button" onClick={() => { setShowSolution(true); setSolutionStep(Math.max(0, solution.length - 1)); setSettleOpen(false); }}>
                  <Eye size={14} /> 查看解答
                </button>
              </div>
              {/* 返回与下一题同一行（用户 10-06）：没有明确关闭钮的话用户只能点蒙皮退出 */}
              <div className="vcfch-end-actions vcfch-end-actions--last">
                <button type="button" onClick={() => setSettleOpen(false)}><X size={14} /> 返回</button>
                <button type="button" className="primary" onClick={() => void startProblem(tier, attacker, state)}>
                  <ChevronRight size={14} /> 下一题
                </button>
              </div>
              <small className="vcfch-end-hint">「返回」关掉弹窗，可回看棋盘与解答步进；「下一题」按当前档位与执子重新匹配。</small>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="vcfch-sheet-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className={`vcfch-sheet${helpOpen ? " vcfch-sheet--help" : ""}`} onClick={(e) => e.stopPropagation()}>
            <header>
              <b>VCF 挑战设置</b>
              {/* 用户 10-06：「加入一个说明的问号，里面是这个 vcf 挑战设置的说明」。
                  和「重置等级分」同款胶囊小按钮：点开进说明，再点一次回设置。 */}
              <button type="button" className="vcfch-sheet-mini vcfch-sheet-help-btn" data-vcf-help
                aria-label="VCF 挑战设置说明" aria-pressed={helpOpen}
                onClick={() => { setResetOpen(false); setHelpOpen((v) => !v); }}>?</button>
              {!helpOpen && <button type="button" data-vcf-reset onClick={() => setResetOpen((v) => !v)} aria-label="重置等级分" className="vcfch-sheet-mini">重置等级分</button>}
              <button type="button" onClick={() => { setDraft(null); setResetOpen(false); setHelpOpen(false); setSettingsOpen(false); }} aria-label="关闭"><X size={16}/></button>
            </header>
            {/* 说明展开时收起分区 tab（说明里两块内容都有；底部「取消/确定」原地不动） */}
            {!helpOpen && <div className="vcfch-sheet-tabs" role="tablist" aria-label="设置分区">
              <button type="button" role="tab" aria-selected={sheetTab === "settings"} className={sheetTab === "settings" ? "active" : ""} onClick={() => setSheetTab("settings")}>设置</button>
              <button type="button" role="tab" aria-selected={sheetTab === "records"} className={sheetTab === "records" ? "active" : ""} onClick={() => { setSheetTab("records"); setRecordPage(0); }}>
                做题记录 <small>{state.history.length}</small>
              </button>
            </div>}

            {helpOpen ? <VcfHelp pools={pools} onBack={() => setHelpOpen(false)} />
              : sheetTab === "settings" ? <>
              {draft && <>
                <label className="vcfch-sheet-row"><span>你执子</span>
                  <div className="vcfch-picker-row">
                    {(["random", "black", "white"] as Array<Player | "random">).map((a) => (
                      <button key={a} type="button" className={draft.attacker === a ? "chip selected" : "chip"}
                        onClick={() => setDraft({ ...draft, attacker: a })}>
                        {a === "random" ? "随机" : a === "black" ? "黑先" : "白先"}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="vcfch-sheet-row"><span>出题档</span>
                  <div className="vcfch-picker-row">
                    {(["auto", "short", "middle", "deep"] as Array<VcfTier | "auto">).map((t) => (
                      <button key={t} type="button" className={draft.tier === t ? "chip selected" : "chip"}
                        onClick={() => setDraft({ ...draft, tier: t })}>{t === "auto" ? "自动" : VCF_TIER_LABEL[t]}</button>
                    ))}
                  </div>
                  {/* 档位预警（用户 2026-10-06）：选的档明显高于当前水平时说一句，别让人拿到远超水平的题还一头雾水 */}
                  {draft.tier !== "auto" && (() => {
                    const playerHands = handsOfLevel(levelOf(state.rating));
                    const tierLabel = draft.tier === "short" ? "1–6" : draft.tier === "middle" ? "7–12" : "13+";
                    const tierMin = draft.tier === "short" ? 1 : draft.tier === "middle" ? 7 : 13;
                    return tierMin > playerHands + 3
                      ? <small className="vcfch-sheet-note" data-vcf-tier-warn>该档约 {tierLabel} 手，比你现在（约 {playerHands} 手）高</small>
                      : null;
                  })()}
                </label>
                <label className="vcfch-sheet-row"><span>计时难度</span>
                  <div className="vcfch-picker-row">
                    {PACE_MODES.map((m) => (
                      <button key={m} type="button" className={draft.pace === m ? "chip selected" : "chip"}
                        onClick={() => setDraft({ ...draft, pace: m })}>{PACE_LABELS[m]} ×{PACE_GAIN[m]}</button>
                    ))}
                  </div>
                  <small className="vcfch-sheet-note">时限随手数伸缩，各档全表见右上角「?」</small>
                </label>
                <label className="vcfch-sheet-check">
                  <input type="checkbox" checked={draft.genDeep} onChange={(e) => setDraft({ ...draft, genDeep: e.target.checked })} />
                  <span>题池不够时允许生成器补题</span>
                </label>
                {/* 这里只留**实时**数字（动态信息不进说明）；口径与更多说明在「?」里 */}
                <small className="vcfch-sheet-note" data-vcf-pool-live>
                  题池 {pools ? pools.total : "-"} 道 · 本级可出 {pools ? pools.matched : "-"} 道
                </small>
              </>}

              {resetOpen && <div className="vcfch-sheet-reset">
                <div className="vcfch-picker-row">
                  {START_LEVELS.map((lv) => (
                    <button key={lv} type="button"
                      title={`匹配 ${startLevelHandRange(lv)} 的题目 · ${vcfStartTierUnlock(START_LEVEL_LV[lv])?.cost ?? "?"} 棋魂`}
                      className={debugLevel === lv ? "chip selected" : "chip"} onClick={() => setDebugLevel(lv)}>{startLevelLabel(lv)}</button>
                  ))}
                </div>
                <label className="vcfch-sheet-check">
                  <input type="checkbox" checked={debugClear} onChange={(e) => setDebugClear(e.target.checked)} />
                  <span>同时清空进度与记录</span>
                </label>
                {/* 价格提示：让用户按之前就看得见这次要花多少（点确认才扣） */}
                <small className="vcfch-sheet-note" data-vcf-reset-price>
                  这次会花 {settingLevelCost} 棋魂 · 现有 {shop.balance}
                </small>
                <button type="button" className="vcfch-primary" data-vcf-reset-confirm onClick={() => {
                  /**
                   * ⚠ **这里必须收费**（2026-10-11 修的一条大旁路）。
                   *
                   * 上一版这段是**免费**的：选好档位点一下，等级分就变了。而
                   * 「设置 → 棋魂解锁」里同一件事是**明码标价**的 ——
                   * 于是所有人都会走免费这条，贵的那条路形同不存在，
                   * 棋魂经济里"花棋魂换后悔药"的设计等于没有。
                   *
                   * 现在的口径：**同一件事只有一条路，且要付钱**
                   * （钱走 `useSoulShop().spend`，与设置页那处共用同一批动作项，
                   *  所以价格、扣费、幂等 token 全部只有一份实现）。
                   * 用户 2026-10-11：「我搞了很多用棋魂买的地方，但是有些地方却有
                   * 其他通道可以免费……这里却全部免费」——就是这一条。
                   *
                   * 2026-10-12 改版：五档（1/3/6/9/12 级）**各是一件独立商品**
                   * （`action-vcf-start-<level>`，价格在 `VCF_START_TIERS`），
                   * 所以"选哪档就付哪档的钱"是天然的，不需要再按档位切换商品。
                   *
                   * 注意"同时清空进度"勾选与否走的是**同一个价**：清空进度是附加操作，
                   * 不是第二件商品（再拆一档价格只会让人算不清）。
                   *
                   * `settingLevelItem` 理论上取不到（五件商品都在 `SOUL_UNLOCKS` 里），
                   * 但**取不到时必须什么都不做**（fail closed）——绝不能"找不到商品就免费放行"，
                   * 那正是这一轮要修的毛病。
                   */
                  if (!settingLevelItem) {
                    setMessage({ text: "这一档需要在商店里解锁（设置 → 棋魂解锁）。", bad: true });
                    return;
                  }
                  const failure = shop.spend(settingLevelItem, () => {
                    const next = resetToStartLevel(state, debugLevel, debugClear);
                    saveState(next); setState(next); setLastDelta(null);
                    /**
                     * 把等级奖励的水位线抬到这一档（2026-10-11 起，见下面的历史注释）。
                     * 语义：等级奖励是"**自己爬上去**"的证明，靠重置跳上去的等级不是爬的。
                     * `saveVcfLevelPaid` 只升不降，所以「重置到最低档」不会把它降回来
                     * （降回来就会又变成可领的）。
                     */
                    saveVcfLevelPaid(levelOf(next.rating));
                    // 顺手把出题档回到「自动」：否则留在「深」档时，改完等级分还是只会出生成器题
                    setTier("auto");
                    setDraft((d) => (d ? { ...d, tier: "auto" } : d));
                    resetRound(`等级分已重置为 ${START_RATINGS[debugLevel]}（等级 ${START_LEVEL_LV[debugLevel]}），档位回到自动${debugClear ? "，进度已清空" : ""}；点下面重新开始`);
                    setResetOpen(false);
                  });
                  // 钱不够时不执行、不关面板，把原因说清楚（与设置页那一处同一句文案）。
                  if (failure) setMessage({ text: failure, bad: true });
                }}>确认重置等级分（{settingLevelCost} 棋魂）</button>
              </div>}

            </> : <>
              <div className="vcfch-records-head">
                <span>第 {page + 1} / {totalPages} 页 · 共 {state.history.length} 题</span>
                <span className="vcfch-pager">
                  <button type="button" disabled={page <= 0} onClick={() => setRecordPage(page - 1)} aria-label="上一页"><ChevronLeft size={15}/></button>
                  <button type="button" disabled={page >= totalPages - 1} onClick={() => setRecordPage(page + 1)} aria-label="下一页"><ChevronRight size={15}/></button>
                </span>
              </div>
              {state.history.length === 0 ? <p className="vcfch-sheet-note">还没有记录，先打一局。</p> : (
                <ul className="vcfch-records">
                  {pageItems.map((h, i) => {
                    const clickable = Boolean(h.id && h.stones);
                    return (
                      <li key={i} className={`${h.win ? "win" : "lose"}${clickable ? " clickable" : ""}`}>
                        <button type="button" disabled={!clickable} onClick={() => openRecord(h)} aria-label={clickable ? "载入这道题" : "该记录没存局面，无法载入"}>
                          {clickable ? <MiniBoard stones={h.stones} /> : <span className="vcfch-mini vcfch-mini--none" aria-hidden="true">无局面</span>}
                          <span className="vcfch-rec-info">
                            <b>{h.depth} 手 · {h.win ? "胜" : "负"}</b>
                            <small>{fmtClock(h.ts)} · {h.seconds}s · {h.attacker === "white" ? "白先" : h.attacker === "black" ? "黑先" : "早期记录"}</small>
                          </span>
                          <span className={`vcfch-rec-delta ${h.delta >= 0 ? "up" : "down"}`}>{h.delta >= 0 ? "+" : ""}{h.delta}</span>
                          {clickable ? <ChevronRight size={15}/> : <span className="vcfch-rec-nopos">—</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <small className="vcfch-sheet-note">每页 {HISTORY_PAGE_SIZE} 题、最多 {totalPages} 页；点任意一条可载入那道题重做（不计分）。</small>
            </>}

            {/* 底部「取消 / 确定」放在**分支之外**：设置面板与「?」说明面板都在原位，
                说明滚到底也不会把这两颗按钮滚走（用户 10-06：说明要在手机上单屏可读可滚）。 */}
            {(helpOpen || sheetTab === "settings") && <div className="vcfch-sheet-actions">
              <button type="button" className="vcfch-sheet-cancel" onClick={() => { setDraft(null); setResetOpen(false); setHelpOpen(false); setSettingsOpen(false); }}>取消</button>
              <button type="button" className="vcfch-primary" onClick={confirmSettings}>确定</button>
            </div>}
          </div>
        </div>
      )}

      {/* 退出确认（用户 2026-10-06：「挑战时如果真的要退出，搞个确定退出 vcf 挑战的弹窗」）。
          应用内弹窗、不用 window.confirm；只在一局未结算时由 requestExit 打开。
          这一层**不占 history 条目**：它是在「返回」已经消费掉根哨兵之后才弹出的，再压一条
          会在关闭时把条目弹回、又触发一次返回处理（挑战页会被重新问一遍）。弹窗开着时
          再按返回由 App 递回请求、这里把它当「继续挑战」关掉。 */}
      {exitConfirmOpen && (
        <BottomSheet appearance="decision" title="退出 VCF 挑战？" onClose={() => setExitConfirmOpen(false)}>
          <div className="sheet-body">
            <p className="section-note" data-vcf-exit-copy>当前这一局会作废（不计分）。</p>
            <button type="button" className="primary-button" onClick={() => setExitConfirmOpen(false)} data-vcf-exit-keep>继续挑战</button>
            <button type="button" className="secondary-button" onClick={() => { setExitConfirmOpen(false); onExit?.(); }} data-vcf-exit-leave>退出</button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function defenderHasFour(board: VcfBoard, defender: Player): boolean {
  return vcfFivePoints(board, defender === "black" ? 1 : 2, "renju").length > 0;
}

/**
 * 五档价格的**说明串**（从 `VCF_START_TIERS` 现推，不手抄价格 —— 商店改价这里跟着走）。
 * 形如「1 级 500 / 3 级 700 / 6 级 1000 / 9 级 1300 / 12 级 1600 棋魂」。
 */
const startLevelCostHint = () =>
  VCF_START_TIERS.map((t) => `${t.level} 级 ${t.cost}`).join(" / ") + " 棋魂";

/** 计时全表的**分段标签**（加档点来自 `PACE_STEPS`，13 级之后每 `PACE_POST_STEP_EVERY` 级一次，
 *  最高级收在 `PACE_CAP`；秒数一律由 `paceSecondsFor` 现算，这里只给分段名）。 */
const PACE_BAND_LABELS: ReadonlyArray<[string, number]> = [
  ["1–3 级", 1], ["4–5 级", 4], ["6–8 级", 6], ["9–10 级", 9], ["11 级", 11], ["12 级", 12],
  ["13–14 级", 14], ["15–16 级", 16], ["25–26 级", 26], ["33–34 级", 34], [`${CHALLENGE_MAX_DEPTH} 级顶格`, CHALLENGE_MAX_DEPTH],
];
/**
 * 一档计时难度的**全表说明串**：秒数一律用 `paceSecondsFor` 现算，
 * 不把数字抄第二份（10-12 重定这张表时，手写说明与代码漂移过一次）。
 */
const paceRow = (mode: PaceMode) =>
  PACE_BAND_LABELS.map(([label, hands]) => `${label} ${paceSecondsFor(hands, mode)}s`).join(" / ");

/**
 * 设置面板右上角「?」展开的**设置说明**（用户 2026-10-06：「加入一个说明的问号，里面是这个
 * vcf 挑战设置的说明……专门详细在这个说明里面写好」）。
 *
 * 口径逐条对着实现写，数字都由常数推出来：
 *  · 计时全表 = `rating.ts` 的 `paceSecondsFor`（在 4/6/9/11/12/13 级各加一次 +5/+10/+20 秒，
 *    13 级后每 `PACE_POST_STEP_EVERY` 级加一次，最高级收在 `PACE_CAP` 三档上限）；
 *  · 加扣分表 = `gainForGap` / `lossForGap`（倍数只乘加分、扣分不乘；加分乘完再夹 1–`GAIN_MAX`，
 *    扣分夹 1–`LOSS_MAX`）——面板上那两行数字走 `gainPreview` / `lossPreview` 现推，不抄常数；
 *  · 匹配 = 三级加权 `MATCH_SAME_WEIGHT` / `MATCH_ADJACENT_WEIGHT`（2026-10-12 换掉旧的分数窗）；
 *  · 等级台阶 = `LEVEL_STEP`（所有等级每级 300 分）；
 *  · 起始档位 = `VCF_START_TIERS`；题池实时数字由 `poolSummary` 传进来。
 *  设置面板上原来的零散小字都收进这里（面板只留 chip、按钮与实时题池数字）。
 */
/** 说明面板那两行要列的档位（名字给人看，数字一律现推）。
 *  加分端 `低 3+` 与 `高 3` 之后各是一段平/一条式子；扣分端 `高 2+` 是平的一段。 */
const DELTA_GAIN_ROWS: Array<{ gap: number; name: string }> = [
  { gap: -3, name: "低 3+ 级" }, { gap: -2, name: "低 2 级" }, { gap: -1, name: "低 1 级" },
  { gap: 0, name: "同级" }, { gap: 1, name: "高 1 级" }, { gap: 2, name: "高 2 级" }, { gap: 3, name: "高 3 级" },
];
const DELTA_LOSS_ROWS: Array<{ gap: number; name: string }> = [
  { gap: 2, name: "高 2+ 级" }, { gap: 1, name: "高 1 级" }, { gap: 0, name: "同级" },
  { gap: -1, name: "低 1 级" }, { gap: -2, name: "低 2 级" }, { gap: -3, name: "低 3 级" },
];

const VcfHelp = ({ pools, onBack }: { pools: PoolSummary | null; onBack: () => void }) => (
  <div className="vcfch-help" data-vcf-help-panel role="region" aria-label="VCF 挑战设置说明">
    <section>
      <h4>怎么算赢</h4>
      <p>每一手都必须<b>形成四</b>（冲四），或者直接连五，才算合法；别的位置点了不算。黑方另按连珠禁手判：四四、长连（六连以上）、双三都判黑负。</p>
      <p>你冲四后，对方由引擎按唯一挡点应手；挡不了（黑方那个防点本身是禁手时也算挡不了）就判你胜。收尾就三种：<b>连五</b> / <b>活四·双四</b>（守方一手防不完）/ <b>抓禁手</b>。</p>
    </section>
    <section>
      <h4>你执子</h4>
      <p>随机（默认）/ 黑先 / 白先三选一。改完要点面板底部「确定」才生效，并作废当前这一局。</p>
    </section>
    <section>
      <h4>出题档</h4>
      <p>自动（默认）：按你的等级分定档，等级越高题越深。也可以手选：短 1–6 手 / 中 7–12 手 / 深 13+ 手。</p>
    </section>
    <section>
      <h4>出题匹配</h4>
      <p>你的等级分决定等级，等级决定出多少手的题（1 级 1 手、3 级 3 手…13 级 13 手；最高等级 34 级，满级可排到 {CHALLENGE_MAX_DEPTH} 手的相邻题）。</p>
      <p>出题从<b>上/本/下三个等级</b>里取：本级占 <b>{MATCH_SAME_WEIGHT}%</b>、上一级与下一级各 <b>{MATCH_ADJACENT_WEIGHT}%</b>。边界（1 级没有下一级、满级没有上一级）时那份概率并回本级。</p>
    </section>
    <section>
      <h4>计时难度（三档）</h4>
      <p>时限按<b>等级（＝手数）</b>伸缩：1–3 级给起点，之后在 <b>4 / 6 / 9 / 11 / 12 / 13 级</b>各加一次（默认 +{PACE_STEP_GAIN.default} 秒、充裕 +{PACE_STEP_GAIN.ample} 秒、休闲 +{PACE_STEP_GAIN.casual} 秒），<b>13 级后每 {PACE_POST_STEP_EVERY} 级再加一次</b>。最高级（{CHALLENGE_MAX_DEPTH} 手）收在三档上限 <b>{PACE_CAP.default} / {PACE_CAP.ample} / {PACE_CAP.casual} 秒</b>：按式子不够就在这一档补满，超了也不会越过（先够到上限的那一档之后就再也不涨）。</p>
      <div className="vcfch-help-table">
        <p><b>默认 ×2</b>：{paceRow("default")}</p>
        <p><b>充裕 ×1</b>：{paceRow("ample")}</p>
        <p><b>休闲 ×0.5</b>：{paceRow("casual")}</p>
      </div>
      <p>得分倍数<b>只乘加分，扣分不乘</b>。只剩最后 1 秒时计时器转红闪烁；时间到判本局负。</p>
    </section>
    <section>
      <h4>加扣分（等级差表）</h4>
      <p>按「题目的等级 − 你的等级」查表。等级台阶：<b>每一级 300 分</b>（1 级从 0 分起，最高等级 {LEVEL_MAX} 级）。</p>
      <div className="vcfch-help-table">
        {/* 这两行的数字**一律从结算那两张表现推**（`gainPreview` / `lossPreview`），
            不再手抄一份 —— 上一版抄的是「高 3+ 级 +22 / 低 3+ 级 −18」，
            2026-10-14 两端放开后就立刻过期了。 */}
        <p><b>加分</b>（查完再乘计时难度倍数）：{DELTA_GAIN_ROWS.map((row) => `${row.name} +${gainPreview(row.gap)}`).join(" / ")}；再往上每高一级多 +4、式子最高 <b>+{GAIN_MAX}</b>，<b>乘完计时难度倍数才是到手的分</b>（默认档 ×2 ⇒ 单次最高 <b>+{GAIN_MAX * PACE_GAIN.default}</b>）。默认档同级赢 = <b>+{gainPreview(0, PACE_GAIN.default)}</b>。</p>
        <p><b>扣分</b>（不乘倍数）：{DELTA_LOSS_ROWS.map((row) => `${row.name} −${-lossPreview(row.gap)}`).join(" / ")}；再往下每低一级多扣 3，单次最多 <b>−{LOSS_MAX}</b>。</p>
      </div>
      <p>等级分下限 <b>0</b>、上限 <b>{MAX_RATING}</b>。0 分时再输不扣分（扣分无效，不会变成负数）。分数到 9999 后赢不再加分、输照常扣；挑战匹配最多到 <b>{CHALLENGE_MAX_DEPTH} 手</b>，生成器本体仍可单独生成更深题。等级最高 {LEVEL_MAX} 级；单次加分最多 +{GAIN_MAX * PACE_GAIN.default}（式子 {GAIN_MAX} × 默认档 2）、扣分最多 −{LOSS_MAX}＝不到 1/3 级，赢一局不会越过一级。</p>
    </section>
    <section>
      <h4>起始档位（重置等级分用）</h4>
      <p>面板右上角「重置等级分」展开五档：<b>1 级 / 3 级 / 6 级 / 9 级 / 12 级</b>（等级分数分别是 {START_RATINGS.lv1} / {START_RATINGS.lv3} / {START_RATINGS.lv6} / {START_RATINGS.lv9} / {START_RATINGS.lv12}）。越高档省下的爬坡越多、要的棋魂也越多（{startLevelCostHint()}）。</p>
      <p>是否连进度与记录一起清空，由旁边的勾选框决定（默认<b>不</b>清）。</p>
    </section>
    <section>
      <h4>生成器补题</h4>
      <p>允许时，题池不够就用生成器即时出题（与「对弈 → 棋题生成器」是同一台引擎）。出场概率看这一段题池：段内总量 ≥700 道、或者这一段还有没出过的题，就完全自循环、一道都不生成（0%）；这一段出完之后按段内总量给概率——<b>不足 10 道 99%、不足 50 道 90%、不足 100 道 80%、100–699 道 50%</b>；段内一道都没有（14 手以上）就是 <b>100%</b>。</p>
      <p>重复出题按「最久没出」的顺序回归，最近 200 次出过的不重复。生成器出的题会在题目说明里标「生成器出题」。</p>
    </section>
    <section>
      <h4>做题记录</h4>
      <p>每页 10 条、最多留 200 条。点任意一条会把那道题载入<b>摆棋</b>（重做不计分）。</p>
    </section>
    <section>
      <h4>摆棋（复盘式）</h4>
      <p>只在空点上按手序落子（点已有子不会把子拿掉）。下一手颜色自动交替；盘上无子时用本题攻方先手。</p>
      <p>「上一步 / 下一步」是真正的回退 / 前进（颜色跟着回退），「清空」把你摆的子全撤掉、回到本题最初局面（仍在摆棋模式里）。</p>
    </section>
    <section>
      <h4>看解答</h4>
      <p>棋盘会切成「题目初始局面 + 解答到第 k 手」的视图，不混入你答题落的子。「上一手 / 下一手」逐步走，当前那一手用实线红环标出，其余解答子虚线红环。</p>
      <p>题源只写了攻方冲四时会注明「只列攻方冲四，未收录对方挡子」。</p>
    </section>
    <section>
      <h4>退出与后台</h4>
      <p>一局还没结算时返回，会先问「退出？（当前这一局作废、不计分）」。切到后台计时<b>暂停</b>（状态行会写明），回到前台接着算、不判负。</p>
    </section>
    <section>
      <h4>当前题池</h4>
      <p data-vcf-help-pool>题池 {pools ? pools.total : "-"} 道 · 本级可出 {pools ? pools.matched : "-"} 道（上/本/下三级内、没做过的）。</p>
    </section>
    <button type="button" className="vcfch-help-back" data-vcf-help-back onClick={onBack}>返回设置</button>
  </div>
);

/** 记录里的小预览图：15 路缩略棋盘（viewBox 15×15，一格一单位）。 */
const MiniBoard = ({ stones }: { stones?: string }) => {
  const [b, w] = (stones ?? "").split("/");
  const black = parseRuns(b ?? "");
  const white = parseRuns(w ?? "");
  return <svg className="vcfch-mini" viewBox="0 0 15 15" aria-hidden="true">
    <rect x="0" y="0" width="15" height="15" rx="1.6" fill="#e8c987" />
    {Array.from({ length: VCF_SIZE }, (_, i) => (
      <g key={i} stroke="#7a5a28" strokeWidth="0.1">
        <line x1="0.5" y1={i + 0.5} x2="14.5" y2={i + 0.5} />
        <line x1={i + 0.5} y1="0.5" x2={i + 0.5} y2="14.5" />
      </g>
    ))}
    {black.map((p, i) => <circle key={`b${i}`} cx={p.col + 0.5} cy={p.row + 0.5} r="0.44" fill="#16161a" />)}
    {white.map((p, i) => <circle key={`w${i}`} cx={p.col + 0.5} cy={p.row + 0.5} r="0.44" fill="#fdfdf8" stroke="#8a8a84" strokeWidth="0.08" />)}
  </svg>;
};

/** 棋盘一次算清的「视图」：盘面 + 手序编号 + 红点与解答环，BoardSvg 只管画、不再自己拼两层。
 *  用户对局视图 = 你这一局的 board/log/lastMove；解答视图 = 题目初始局面 + 解答第 1..k 手
 *  （用户 2026-10-06：看解答时棋盘只显示这些，你答题落的子不出现，上一手/下一手是真的回退/前进）。 */
interface BoardView {
  board: VcfBoard;
  nums: MoveLog[];
  lastMove: number | null;
  /** 解答环（仅解答视图有）：虚线环标出解答子，current=true 的那手画实线红环。 */
  rings: Array<{ idx: number; current: boolean }>;
  /**
   * 提示卡标出的建议落点（-1 = 没有）。
   *
   * 单独一个字段而不是复用 `lastMove`：`lastMove` 画的是"上一手在哪儿"（实心红点，
   * 那是既成事实），而这是"建议你走这儿"（空心圈）。两者语义不同，
   * 而且**可能同时存在**（刚用提示卡时，上一手与建议点是两个不同的位置）。
   */
  hintCell: number;
  /** 两段式落子待确认的格子（-1 = 没有）。 */
  pendingCell: number;
}

const BoardSvg = memo(function BoardSvg({ view, geo, showCoordinates, boardTheme, stoneTheme, onCell, interactive, svgRef }: {
  view: BoardView;
  /** 本帧的棋盘几何（由打谱的显示设置算出，见 board-geometry.ts 的 vcfGeometry）。 */
  geo: VcfGeometry;
  showCoordinates: boolean;
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  onCell: (r: number, c: number) => void;
  interactive: boolean;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}) {
  const px = geo.line;
  const click = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = geo.viewBox / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const c = Math.round((x - geo.margin) / geo.cell);
    const r = Math.round((y - geo.margin) / geo.cell);
    if (r < 0 || r >= VCF_SIZE || c < 0 || c >= VCF_SIZE) return;
    const dx = x - px(c), dy = y - px(r);
    /* 热区与主盘同一个公式（格距×0.43×1.14，且不越相切线）—— 用户 10-08：
       「棋盘大了，棋子也就大了，就更好点击了」。旧版写死 `CELL × 0.48`。 */
    if (dx * dx + dy * dy > geo.hitR ** 2) return;
    onCell(r, c);
  };
  /* 用户在设置里选的棋盘/棋子材质；取不到就落回挑战页自带的兜底外观。
     老存档里可能还留着旧名字（gold-diamond ↔ app-golddiamond 这种差一个连字符），
     跟设置页 sameTheme() 一样去掉连字符再试一次。 */
  const matBoard = findBoardMaterial(boardTheme) ?? findBoardMaterial(String(boardTheme).replace(/-/g, ""));
  const matStone = findStoneMaterial(stoneTheme) ?? findStoneMaterial(String(stoneTheme).replace(/-/g, ""));
  const line = matBoard ? boardLineProps(matBoard) : null;
  const lineStroke = line ? line.stroke : FALLBACK.line;
  const lineW = line ? line.width : FALLBACK.lineW;
  const lineOpacity = line ? line.opacity : 1;
  const starFill = line ? line.star : FALLBACK.star;
  /** 一颗子：材质走数据、兜底走圆，两者都在**同一套网格坐标**上（px），半径跟着打谱的棋子大小。
   *  手数用主盘同一公式（fontSize = max(8, r×0.64)、y = cy + r×0.28）+ CSS 里的等宽字体。 */
  const stone = (row: number, col: number, player: 1 | 2, isLast: boolean, key: string) => (
    <g key={key}>
      {matStone
        ? <SvgHtml tag="g" className="material-stone" html={stoneMarkup(matStone, px(col), px(row), geo.stoneR, player, isLast, false)} />
        : <circle cx={px(col)} cy={px(row)} r={geo.stoneR} fill={player === 1 ? "#16161a" : "#fdfdf8"} stroke={player === 1 ? "#000" : "#8a8a84"} strokeWidth={1} />}
    </g>
  );
  return (
    <svg ref={svgRef} className={`vcfch-board board-${boardTheme}`} viewBox={`0 0 ${geo.viewBox} ${geo.viewBox}`} onClick={click} role="grid" aria-label="VCF 挑战棋盘">
      {matBoard
        ? <SvgHtml tag="g" className="board-material" html={boardLayers(matBoard, VCF_SIZE, geo.margin, geo.cell)} />
        : <rect x={0} y={0} width={geo.viewBox} height={geo.viewBox} rx={10} fill={FALLBACK.board} />}
      {matStone?.defs ? <SvgHtml tag="defs" html={matStone.defs} /> : null}
      {Array.from({ length: VCF_SIZE }, (_, i) => (
        <g key={i} stroke={lineStroke} strokeWidth={lineW} opacity={lineOpacity}>
          <line x1={px(0)} y1={px(i)} x2={px(VCF_SIZE - 1)} y2={px(i)} />
          <line x1={px(i)} y1={px(0)} x2={px(i)} y2={px(VCF_SIZE - 1)} />
        </g>
      ))}
      {STARS.map(([r, c]) => <circle key={`${r}-${c}`} cx={px(c)} cy={px(r)} r={geo.starR} fill={starFill} />)}
      {/* 四边坐标（用户 10-08：「VCF 挑战里面的棋盘，坐标没有…能不能搞得像我们正常打谱那个界面一样」）。
          与主盘同一套 markup 与 layout：上/下列字母 A–O、左/右行号 15–1，落点取「坐标字号 + 侧边」
          算出的 `coordinateLayout()`，字号与开关直接跟随打谱的显示设置；
          样式走全局 `.coordinates text`（颜色按主题换色在那里，所以上面 className 要带
          `board-${boardTheme}` —— 不加就只有默认木色，深色主题上会看不清）。 */}
      {showCoordinates && Array.from({ length: VCF_SIZE }, (_, i) => (
        <g key={`coord-${i}`} className="coordinates">
          <text style={{ fontSize: geo.coordinateFontSize }} x={px(i)} y={geo.coord.topY}>{columnName(i)}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={px(i)} y={geo.coord.bottomY}>{columnName(i)}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={geo.coord.leftX} y={px(i) + 3}>{VCF_SIZE - i}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={geo.coord.rightX} y={px(i) + 3}>{VCF_SIZE - i}</text>
        </g>
      ))}
      {/* 提示卡的建议落点（空心金圈 + 呼吸动效）：画在棋子层**之前**，
          因为建议点必然是一个空点（没有棋子会遮它）。 */}
      {view.hintCell >= 0 && <g data-vcf-hint={view.hintCell}>
        <circle
          cx={px(view.hintCell % VCF_SIZE)}
          cy={px(Math.floor(view.hintCell / VCF_SIZE))}
          r={geo.stoneR * 0.86}
          className="vcfch-hint-ring"
        />
      </g>}
      {view.pendingCell >= 0 && <circle data-vcf-pending={view.pendingCell} cx={px(view.pendingCell % VCF_SIZE)} cy={px(Math.floor(view.pendingCell / VCF_SIZE))} r={geo.stoneR * 0.94} className="board-pending-ring" pointerEvents="none"/>}
      {Array.from(view.board).map((v, i) => {
        if (!v) return null;
        const r = Math.floor(i / VCF_SIZE), c = i % VCF_SIZE;
        return (
          /* data-vcf-stone / data-vcf-player 是黑盒脚本用的局面探针（摆棋/解答断言读它）：
             盘上每一颗子都在，颜色就是 v；没有这两条属性脚本只能靠像素猜。
             解答视图下这里画的就是「初始局面 + 解答前 k 手」，没有别的层。 */
          <g key={i} data-vcf-stone={i} data-vcf-player={v === 1 ? "1" : "2"}>
            {stone(r, c, v === 1 ? 1 : 2, i === view.lastMove, `p${i}`)}
            {i === view.lastMove && <circle cx={px(c)} cy={px(r)} r={4} fill="#e8543f" />}
          </g>
        );
      })}
      {view.nums.filter((m) => m.player === "black" || m.player === "white").map((m) => {
        const v = view.board[m.idx];
        if (!v) return null;
        const dark = v === 1;
        return (
          <text key={`n${m.idx}`} x={px(m.idx % VCF_SIZE)} y={px(Math.floor(m.idx / VCF_SIZE)) + geo.numDy}
            className={`vcfch-num ${dark ? "dark" : "light"}`} fontSize={geo.numFont}>{m.num}</text>
        );
      })}
      {/* 解答环（仅解答视图）：虚线环标出这是解答，实线红环标出当前步进到的那一手。 */}
      {view.rings.map(({ idx, current }) => (
        <circle key={`ring${idx}`} cx={px(idx % VCF_SIZE)} cy={px(Math.floor(idx / VCF_SIZE))} r={geo.stoneR * (current ? 1.12 : 1.06)} fill="none"
          stroke="#e8543f" strokeOpacity={current ? 0.95 : 0.45} strokeWidth={current ? 2.2 : 1.2}
          strokeDasharray={current ? undefined : "3 2.4"} />
      ))}
    </svg>
  );
});
