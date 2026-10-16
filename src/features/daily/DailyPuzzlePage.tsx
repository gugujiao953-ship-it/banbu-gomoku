import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowLeft, Check, Loader2, RotateCcw, Undo2, X, Trophy } from "lucide-react";
import type { Player } from "../../types";
import type { BoardTheme, StoneTheme } from "../../app-shell-types";
import { SvgHtml } from "../../appearance/svg-html";
import { boardLayers, boardLineProps, findBoardMaterial, findStoneMaterial, stoneMarkup } from "../../appearance/render";
import { columnName } from "../../game";
import { DEFAULT_BOARD_MARGIN } from "../settings/board-margin";
import { DEFAULT_COORDINATE_FONT_SIZE } from "../settings/display-defaults";
import { DEFAULT_STONE_SCALE } from "../settings/stone-size";
import { starPointsFor, vcfGeometry, type VcfGeometry } from "../vcf-challenge/board-geometry";
import {
  createDailyState, dailyBoard, dailyLastMove, dailyShouldReply, dailyTurn,
  playDailyMove, playDailyReply, setDailyNotice, setDailyThinking, undoDaily,
  type DailyState,
} from "./daily-play";
import "./daily-puzzle.css";

/**
 * 每日一题的**专门界面**（用户 2026-10-11：「我们给每日一题做一个专门的界面吧，
 * 因为我发现这个每日一题可以用分析解决，不像是一个专门的挑战界面，你这个界面
 * 可以沿 vcf 挑战的一些设计，但是不能全部照搬，比如等级分什么的」）。
 *
 * ## 为什么原来那个方式不行
 *
 * 每日一题原来是"打开做题模式"——落到**打谱工作区**里。那个工作区带着整套
 * 常驻工具：分析引擎、看解答、摆棋、变化树……而用户的原话点出了要害：
 * **"可以用分析解决"**。也就是说它不是一个挑战（有规则、有代价、有分数），
 * 而是一个"回来看一眼"的日常。用挑战的壳去装它，两头都不对：
 * 日常被塞进了 300 个按钮，而"挑战"该有的仪式感一点也没有。
 *
 * ## 沿了 VCF 的什么、没沿什么
 *
 * 沿的是**骨架**（一个独立全屏页、顶部返回、中间棋盘、底部状态与操作、
 * 棋盘跟着打谱的显示设置走、系统返回先问再退）。这些是"体面"的部分。
 *
 * 没沿的是**挑战的那部分**（用户点名"不能全部照搬"）：
 *  · **没有等级分**：一天一题算不出有意义的分数（VCF 一局十几手、能立刻反映棋力；
 *    每日一题一天就一道，涨落没信息量）；
 *  · **没有棋力档位 / 计时难度**：题是题库里选定的（`decideDailyPuzzle` 决定），
 *    不由玩家挑 —— 给一个"选难度"的下拉反而是假的（选了也不会照着出）；
 *  · **没有倒计时**：每日一题是"回来看一眼"，掐着表就变味了；
 *  · **不给道具**：那三种卡是 VCF 的机制（题深、容易卡），每日一题卡住就明天再来；
 *  · **走错不判负**：VCF 里"必须冲四"是规则本身；一般题目没这个概念，
 *    所以点错只提示、盘面不动（见 `daily-play.ts` 的对照表）。
 *
 * ## 这一页**故意没有**分析 / 看解答
 *
 * 用户说"可以用分析解决"时是**在解释旧方式的问题**（它落在一个到处是分析工具的
 * 地方，于是"做题"变成了"等引擎算"）。所以这一页刻意只留棋盘、陪练、
 * 悔棋与重来 —— 没有分析面板，没有看解答。这是这一页存在的理由本身。
 */

/** 陪练思考预算：与打谱里做题同一档（`PUZZLE_FAST_THINK_TIME_MS` = 600ms 是搜索预算，
 *  这里给一个稍长的值是因为挑战页/做题页背后是同一个"陪练"语义 —— 它不该太强，
 *  也不该慢到让人等）。 */
const THINK_MS = 900;
const THINK_DEPTH = 4;

/** 没选材质时的兜底盘/子（与挑战页同一套，取自 app-amberboard / app-flatstone 的观感）。 */
const FALLBACK = { board: "#e8c987", line: "#7a5a28", lineW: 1, star: "#7a5a28" };

export interface DailyPuzzlePageProps {
  /** 两段式落子（设置「点击确认落子」）：点空位先出圈，再点同一格才落。默认 false＝一步式。 */
  placementConfirm?: boolean;
  /** 题目名（已经是"展示用"的标题）。 */
  title: string;
  /** 题集名（`· 题集` 那一段）。 */
  collectionTitle: string;
  /** 题面文字（"黑先胜"这类）。 */
  prompt: string;
  /** 难度 1–5（画星星）。 */
  difficulty: number;
  /** 棋盘路数（题库里的题可以是 5–30 路）。 */
  boardSize: number;
  /** 玩家执哪一方（= `Puzzle.player`）。 */
  human: Player;
  /**
   * 题目的文档（由 `createPuzzleDocument(puzzle, rule)` 建好）。
   *
   * 传文档而不是传题目 + 在这里建，是因为**建立文档要用题库那套规则解析**
   * （`resolvePuzzleRule`：题目级 → 题集级 → 用户偏好，还带 `locked`），
   * 那属于 App 已经算好的东西。这一页不该知道"偏好存哪儿"。
   */
  document: DailyState["document"];
  initialNodeId: string;
  /** 规则（判定成五用；renju 下黑棋长连不算胜）。 */
  rule: "renju" | "freestyle" | "standard";
  /**
   * 这一手合不合法（注入：含禁手判断，页面不自己抄一份）。返回 null = 合法。
   *
   * ⚠ **必须把"当前盘面"传进来**（第一版我漏了这一条，App 那边闭包到了**开局盘面**）——
   * 禁手判定是"落这一子之后会不会形成禁手"，跟盘上已有的子直接相关；
   * 拿开局盘面去判，中盘之后所有禁手判断都会错（判出不存在禁手、或漏掉真的禁手）。
   */
  checkMove: (board: ReturnType<typeof dailyBoard>, position: { row: number; col: number }, player: Player) => string | null;
  /** 已经完成过今天的题（显示"今天已完成"并允许再做一遍）。 */
  alreadyDone: boolean;
  /** 陪练算一手（由 App 提供引擎：这一页不碰 Worker/引擎选型）。 */
  requestReply: (board: ReturnType<typeof dailyBoard>, player: Player) => Promise<{ row: number; col: number } | null>;
  /** 终局上报（赢/输各一次；App 用它落盘进度/棋魂/成就）。 */
  onFinished: (outcome: "won" | "lost", info: { moves: number; seconds: number }) => void;
  /** 退出这一页（返回对弈页）。 */
  onExit: () => void;
  /** 系统返回：App 只递增这个计数，"要不要拦"由本页自己判（和挑战页同一套）。 */
  exitRequest?: number;
  boardTheme?: BoardTheme;
  stoneTheme?: StoneTheme;
  boardMargin?: number;
  coordinateFontSize?: number;
  stoneScale?: number;
  showCoordinates?: boolean;
}

/** 棋盘（与挑战页同一套几何与材质渲染 —— 只传路数即可，见 `vcfGeometry` 的 `size`）。 */
const DailyBoard = memo(function DailyBoard({ view, geo, showCoordinates, boardTheme, stoneTheme, onCell, interactive, lastMove, pending }: {
  view: { board: Array<1 | 2 | 0>; size: number };
  geo: VcfGeometry;
  showCoordinates: boolean;
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  onCell: (row: number, col: number) => void;
  interactive: boolean;
  lastMove: { row: number; col: number } | null;
  /** 两段式落子的待确认格（null＝没有）。只在空位上画圈。 */
  pending: { row: number; col: number } | null;
}) {
  const px = geo.line;
  const size = view.size;
  const click = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = geo.viewBox / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    const col = Math.round((x - geo.margin) / geo.cell);
    const row = Math.round((y - geo.margin) / geo.cell);
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    const dx = x - px(col), dy = y - px(row);
    if (dx * dx + dy * dy > geo.hitR ** 2) return;
    onCell(row, col);
  };
  const matBoard = findBoardMaterial(boardTheme) ?? findBoardMaterial(String(boardTheme).replace(/-/g, ""));
  const matStone = findStoneMaterial(stoneTheme) ?? findStoneMaterial(String(stoneTheme).replace(/-/g, ""));
  const line = matBoard ? boardLineProps(matBoard) : null;
  const lineStroke = line ? line.stroke : FALLBACK.line;
  const lineW = line ? line.width : FALLBACK.lineW;
  const lineOpacity = line ? line.opacity : 1;
  const starFill = line ? line.star : FALLBACK.star;
  const stars = starPointsFor(size);
  const stone = (row: number, col: number, player: 1 | 2, key: string) => (
    <g key={key}>
      {matStone
        ? <SvgHtml tag="g" className="material-stone" html={stoneMarkup(matStone, px(col), px(row), geo.stoneR, player, false, false)} />
        : <circle cx={px(col)} cy={px(row)} r={geo.stoneR} fill={player === 1 ? "#16161a" : "#fdfdf8"} stroke={player === 1 ? "#000" : "#8a8a84"} strokeWidth={1} />}
    </g>
  );
  return (
    <svg className={`dailyp-board board-${boardTheme}`} viewBox={`0 0 ${geo.viewBox} ${geo.viewBox}`} onClick={click} role="grid" aria-label="每日一题棋盘">
      {matBoard
        ? <SvgHtml tag="g" className="board-material" html={boardLayers(matBoard, size, geo.margin, geo.cell)} />
        : <rect x={0} y={0} width={geo.viewBox} height={geo.viewBox} rx={10} fill={FALLBACK.board} />}
      {matStone?.defs ? <SvgHtml tag="defs" html={matStone.defs} /> : null}
      {Array.from({ length: size }, (_, i) => (
        <g key={i} stroke={lineStroke} strokeWidth={lineW} opacity={lineOpacity}>
          <line x1={px(0)} y1={px(i)} x2={px(size - 1)} y2={px(i)} />
          <line x1={px(i)} y1={px(0)} x2={px(i)} y2={px(size - 1)} />
        </g>
      ))}
      {stars.map(([row, col]) => <circle key={`${row}-${col}`} cx={px(col)} cy={px(row)} r={geo.starR} fill={starFill} />)}
      {/* 四边坐标：与主盘/挑战盘同一套 markup 与 layout（跟着打谱的显示设置）。 */}
      {showCoordinates && Array.from({ length: size }, (_, i) => (
        <g key={`coord-${i}`} className="coordinates">
          <text style={{ fontSize: geo.coordinateFontSize }} x={px(i)} y={geo.coord.topY}>{columnName(i)}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={px(i)} y={geo.coord.bottomY}>{columnName(i)}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={geo.coord.leftX} y={px(i) + 3}>{size - i}</text>
          <text style={{ fontSize: geo.coordinateFontSize }} x={geo.coord.rightX} y={px(i) + 3}>{size - i}</text>
        </g>
      ))}
      {pending && !view.board[pending.row * size + pending.col] && <circle data-dailyp-pending="" className="board-pending-ring" cx={px(pending.col)} cy={px(pending.row)} r={geo.stoneR * 0.94} pointerEvents="none"/>}
      {view.board.map((value, index) => {
        if (!value) return null;
        const row = Math.floor(index / size), col = index % size;
        return <g key={index} data-dailyp-stone={index} data-dailyp-player={value}>
          {stone(row, col, value, `p${index}`)}
        </g>;
      })}
      {lastMove && <circle data-dailyp-last="" cx={px(lastMove.col)} cy={px(lastMove.row)} r={4} fill="#e8543f"/>}
    </svg>
  );
});

export function DailyPuzzlePage({
  title, collectionTitle, prompt, difficulty, boardSize, human, document, initialNodeId, rule,
  checkMove, alreadyDone, requestReply, onFinished, onExit, exitRequest = 0,
  boardTheme = "wood", stoneTheme = "classic", boardMargin = DEFAULT_BOARD_MARGIN,
  coordinateFontSize = DEFAULT_COORDINATE_FONT_SIZE, stoneScale = DEFAULT_STONE_SCALE, showCoordinates = true,
  placementConfirm = false,
}: DailyPuzzlePageProps) {
  const geometry = useMemo(
    () => vcfGeometry({ margin: boardMargin, coordinateFontSize, stoneScale, size: boardSize }),
    [boardMargin, coordinateFontSize, stoneScale, boardSize],
  );
  const [state, setState] = useState<DailyState>(() => createDailyState(document, initialNodeId));
  /** 两段式落子的待确认格。换节点（落子／悔棋）就清掉，免得圈留在已经变了的盘面上。 */
  const [pendingDaily, setPendingDaily] = useState<{ row: number; col: number } | null>(null);
  useEffect(() => { setPendingDaily(null); }, [state.currentId, state.phase]);
  /** 题目的预置子数：悔棋的下界，也是"手数从 0 数起"的基准。 */
  const setupCount = useMemo(() => createDailyState(document, initialNodeId).moves.length, [document, initialNodeId]);
  /** 结算弹窗（胜负各弹一次；关掉仍能回看棋盘）。 */
  const [settle, setSettle] = useState<{ outcome: "won" | "lost"; moves: number; seconds: number } | null>(null);
  const startedAt = useRef(Date.now());
  const reportedRef = useRef(false);
  /** 陪练的应手请求序号：只有"最新一次"的结果才允许落子
   *  （悔棋/重来之后旧结果回来会落在新局面上 —— 那是最隐蔽的一类串局）。 */
  const replySeq = useRef(0);
  /** 已经为哪个局面请求过应手（去重用；见下面 effect 的第 ① 条坑）。 */
  const replyForRef = useRef<string | null>(null);
  /** 组件还挂着吗（卸载后不再 setState）。 */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      replySeq.current += 1;   // 作废在飞的应手
    };
  }, []);

  // 重做一遍时重置计时与上报标记（题目换了也要重置，见下面的 effect）。
  useEffect(() => {
    startedAt.current = Date.now();
    reportedRef.current = false;
    replySeq.current += 1;
    replyForRef.current = null;
    setState(createDailyState(document, initialNodeId));
    setSettle(null);
  }, [document, initialNodeId]);

  /** 终局上报（只报一次；App 那边靠 token 幂等兜第二道）。 */
  useEffect(() => {
    if (state.phase === "playing" || reportedRef.current) return;
    reportedRef.current = true;
    const outcome = state.phase === "won" ? "won" : "lost";
    const moves = Math.max(0, state.moves.length - setupCount);
    const seconds = Math.max(0, Math.round((Date.now() - startedAt.current) / 1000));
    setSettle({ outcome, moves, seconds });
    onFinished(outcome, { moves, seconds });
  }, [state.phase, state.moves.length, setupCount, onFinished]);

  /**
   * 请陪练应手。
   *
   * ## ⚠ 两个坑（第一版两个都踩了，浏览器门禁当场抓到）
   *
   * ① **触发判据不能依赖 `thinking`**：这个 effect 自己会把 `thinking` 置真，
   *    而当初把 `thinking` 写进了依赖数组 ⇒ 置真那一刻 effect 重跑、cleanup 把
   *    **正在飞的那次请求标记成 cancelled** ⇒ 结果回来被丢掉、`thinking` 永远留在真。
   *    表现就是"陪练一直思考中，永远不应手"。所以依赖只留**局面**（`currentId`）
   *    与 `phase`，去重改用一个 ref 记"已经为哪个局面请求过"。
   * ② **结果回来时不能用闭包里的旧 `state`**：中间可能发生了悔棋/重来。
   *    所以走 `setState(current => …)` 拿最新局面，并用 `replySeq` 作废过期结果。
   */
  useEffect(() => {
    // 三条判据（`dailyShouldReply` 是它们的权威定义，单测钉着）：
    // ① 没结束 —— 结束了不再请；② 轮到对手；③ 没在思考。
    // ⚠ ③ 在这里**不能读 `state.thinking`**：这个 effect 自己会把它置真，
    //    而置真会触发重跑、cleanup 把正在飞的请求作废（见上面第 ① 条坑）。
    //    所以 ③ 用"这个局面是否已经请求过"（`replyForRef`）等价表达 ——
    //    两者含义相同：已经请过就等着，不重复请。
    if (state.phase !== "playing") return;
    if (dailyTurn(state) === human) return;
    if (replyForRef.current === state.currentId) return;
    // 判据的第三条仍走共用函数核对一遍（写完 `replyForRef` 之前的状态 = 还没请过，
    // 所以那时它为真；这里用它保证"页面这套判据"与单测钉的那套不会走散）。
    if (!dailyShouldReply({ ...state, thinking: false }, human)) return;
    replyForRef.current = state.currentId;
    const seq = (replySeq.current += 1);
    setState((current) => setDailyThinking(current, true));
    void requestReply(dailyBoard(state), dailyTurn(state)).then((move) => {
      // 卸载之后不再改 state（`mountedRef` 由下面那个 effect 维护）。
      if (!mountedRef.current || seq !== replySeq.current) return;
      setState((current) => {
        if (current.phase !== "playing") return setDailyThinking(current, false);
        if (!move) return setDailyNotice(setDailyThinking(current, false), "陪练没有找到可落子点，这一步跳过");
        return playDailyReply(current, move, dailyTurn(current), rule, human);
      });
    }).catch(() => {
      if (!mountedRef.current || seq !== replySeq.current) return;
      setState((current) => setDailyNotice(setDailyThinking(current, false), "陪练没能算出应手"));
    });
  }, [state.currentId, state.phase, human, rule, requestReply]);

  const onCell = useCallback((row: number, col: number) => {
    /* 两段式落子（设置「点击确认落子」）：第一下只把圈放这儿，第二下点同一格才继续走原来的
       落子逻辑（含"这里已有子"那类提示）。 */
    if (placementConfirm) {
      if (pendingDaily?.row === row && pendingDaily?.col === col) setPendingDaily(null);
      else { setPendingDaily({ row, col }); return; }
    }
    setState((current) => {
      if (current.phase !== "playing" || current.thinking) return current;
      // 传**当前盘面**进 `checkMove`（不是开局盘面，见 props 注释）。
      return playDailyMove(current, { row, col }, human, rule, human, (position, player) =>
        checkMove(dailyBoard(current), position, player));
    });
  }, [human, rule, checkMove, placementConfirm, pendingDaily]);

  const undo = useCallback(() => {
    replySeq.current += 1;        // 作废在飞的应手
    replyForRef.current = null;   // 退回之后要允许为新局面（哪怕同一个 id）重新请求
    setState((current) => {
      const next = undoDaily(current, setupCount);
      if (next === current) { setSettle(null); return setDailyNotice(current, "已经是开局局面了"); }
      // 输局可以悔棋。新局面后续若获胜，必须重新上报，不能被上次的输局标记吞掉。
      reportedRef.current = false;
      setSettle(null);
      return next;
    });
  }, [setupCount]);

  const restart = useCallback(() => {
    replySeq.current += 1;
    replyForRef.current = null;
    startedAt.current = Date.now();
    reportedRef.current = false;
    setSettle(null);
    setState(createDailyState(document, initialNodeId));
  }, [document, initialNodeId]);

  /** 退出：赢了/输了的局面不拦（结算已经入账），
   *  只在下到一半且已落子时问一句 —— 与挑战页同一套礼貌。 */
  const requestExit = useCallback(() => {
    const played = state.moves.length > setupCount && state.phase === "playing";
    if (played && !window.confirm("这一题还没做完，确定离开吗？（下次进来会从这题重新开始）")) return;
    onExit();
  }, [state.moves.length, state.phase, setupCount, onExit]);

  const lastExitRequest = useRef(exitRequest);
  useEffect(() => {
    if (exitRequest === lastExitRequest.current) return;
    lastExitRequest.current = exitRequest;
    requestExit();
  }, [exitRequest, requestExit]);

  const board = dailyBoard(state);
  /** 渲染用的紧凑视图（数字 1/2，0 = 空）：与挑战页同一形状，省得棋盘组件里做字符串比较。 */
  const view = useMemo(() => ({
    size: boardSize,
    board: board.flat().map((cell) => (cell === "black" ? 1 : cell === "white" ? 2 : 0)) as Array<1 | 2 | 0>,
  }), [board, boardSize]);
  const lastMove = dailyLastMove(state);
  const humanMoves = Math.max(0, state.moves.length - setupCount);
  const turn = dailyTurn(state);

  const statusText = state.phase === "won" ? "你赢了"
    : state.phase === "lost" ? "本题结束"
    : state.thinking || turn !== human ? "陪练思考中"
    : "轮到你落子";
  const statusHint = state.notice || (state.phase === "playing" ? prompt : "可以悔棋或重来");

  return <div className="dailyp-page" data-dailyp-outcome={state.phase}>
    <header className="dailyp-top">
      <button type="button" onClick={requestExit} aria-label="返回对弈" data-dailyp-back><ArrowLeft size={15}/></button>
      <div className="dailyp-title">
        <b>{title}</b>
        <small>{collectionTitle}</small>
      </div>
      <span className="dailyp-difficulty" aria-label={`难度 ${difficulty} 星`} title={`难度 ${difficulty} 星`}>
        <Trophy size={12} aria-hidden="true"/><em>{"★".repeat(Math.max(1, Math.min(5, difficulty)))}</em>
      </span>
    </header>

    <div className="dailyp-status">
      <span className="dailyp-side-chip" data-dailyp-side={human}>
        <i aria-hidden="true" className={`dailyp-dot ${human}`}/>{human === "black" ? "你执黑" : "你执白"}
      </span>
      <span className="dailyp-state" data-dailyp-state={state.phase}>
        {state.thinking && state.phase === "playing" && <Loader2 size={13} className="dailyp-spin" aria-hidden="true"/>}
        <b>{statusText}</b>
        <small>{`第 ${humanMoves} 手`}</small>
      </span>
    </div>

    <p className="dailyp-hint" data-dailyp-hint="" role="status" aria-live="polite">{statusHint}</p>

    {alreadyDone && state.phase === "playing" && humanMoves === 0 && <p className="dailyp-done-note" data-dailyp-done-note="">
      今天的每日一题已经做过了 —— 这是在重做一遍（不计入「今天完成」，棋魂也只发过一次）。
    </p>}

    <DailyBoard
      view={view} geo={geometry} showCoordinates={showCoordinates} boardTheme={boardTheme} stoneTheme={stoneTheme}
      onCell={onCell} interactive={state.phase === "playing" && !state.thinking} lastMove={lastMove} pending={placementConfirm ? pendingDaily : null}
    />

    <div className="dailyp-actions">
      <button type="button" onClick={undo} disabled={state.phase === "won" || state.moves.length <= setupCount} data-dailyp-undo>
        <Undo2 size={14}/><span>悔棋</span>
      </button>
      <button type="button" onClick={restart} data-dailyp-restart>
        <RotateCcw size={14}/><span>重来</span>
      </button>
    </div>

    {settle && <div className="dailyp-endbackdrop" onClick={() => setSettle(null)} data-dailyp-settle={settle.outcome}>
      <div className={`dailyp-end ${settle.outcome === "won" ? "dailyp-end--won" : "dailyp-end--lost"}`} role="dialog" aria-modal="true" aria-label={settle.outcome === "won" ? "挑战成功" : "本题结束"} onClick={(event) => event.stopPropagation()}>
        <div className="dailyp-end-card">
          <span className="dailyp-end-stamp" aria-hidden="true">{settle.outcome === "won" ? "胜" : "负"}<i/></span>
          <b className="dailyp-end-title">{settle.outcome === "won" ? "拿下今日一题" : "这题还没做出来"}</b>
          <small className="dailyp-end-sub">
            {settle.outcome === "won" ? "今天的一题已经记下了（棋魂只发一次，做第二遍不再重复发）。" : "不甘心就悔一步再来 —— 或者明天换一道。"}
          </small>
          <div className="dailyp-end-stats">
            <span><small>你下了</small><b>{settle.moves} 手</b></span>
            <span><small>用时</small><b>{settle.seconds < 60 ? `${settle.seconds} 秒` : `${Math.floor(settle.seconds / 60)} 分 ${settle.seconds % 60} 秒`}</b></span>
            <span><small>难度</small><b>{"★".repeat(Math.max(1, Math.min(5, difficulty)))}</b></span>
          </div>
          <div className="dailyp-end-actions">
            <button type="button" onClick={() => { setSettle(null); restart(); }}><RotateCcw size={14}/>再来一遍</button>
            <button type="button" className="primary" onClick={() => setSettle(null)} data-dailyp-settle-close><Check size={14}/>看棋盘</button>
          </div>
          <div className="dailyp-end-actions dailyp-end-actions--last">
            <button type="button" onClick={requestExit}><X size={14}/>返回对弈</button>
          </div>
        </div>
      </div>
    </div>}

    {/* 结束之后还能回看，所以再来一个"重新开始"的出口在底部提示里（见 statusHint）。 */}
    <small className="dailyp-foot">点棋盘落子 · 悔棋一次退两手 · 这一页不接分析引擎，想深研究请去「打谱 → 做题」</small>
  </div>;
}
