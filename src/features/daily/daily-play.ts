/**
 * 每日一题的**对局逻辑**（用户 2026-10-11：「我们给每日一题做一个专门的界面吧，
 * 因为我发现这个每日一题可以用分析解决，不像是一个专门的挑战界面」）。
 *
 * ## 为什么要单独一个模块，而不是写在页面里
 *
 * 这一层是**纯函数**（给定局面 → 新状态），所以"谁赢了、轮到谁、这手合不合法"
 * 这些判据可以脱离 React 单测。页面（`DailyPuzzlePage.tsx`）只管画与调，
 * 不做任何规则判断 —— 这是本项目对"界面里散落规则"的一贯态度（对弈/VCF 都这样分）。
 *
 * ## 与 VCF 挑战**刻意不同**的几处（用户点名"不能全部照搬"）
 *
 * | | VCF 挑战 | 每日一题 |
 * |---|---|---|
 * | 等级分 | 有（涨落 + 等级阶梯 + 每级奖励） | **没有** —— 一天一题算不出有意义的分数 |
 * | 棋力档位 | 手数档 + 计时难度 | **没有** —— 题是题库里选定的，不由玩家挑难度 |
 * | 时间限制 | 有倒计时（超时判负） | **没有** —— 每日一题是"回来看一眼"，不该催 |
 * | 判负 | 走错即判负 | **不判负**（走错只算这一步不成立，盘面不动） |
 * | 提示/道具 | 三种付费卡 | **不给道具**（那会把"每天一道"变成资源管理） |
 * | 解法展示 | 有解答步进 | **没有内置解答**（题库里本就没有解法数据） |
 *
 * 保留下来的是"骨架"：一个独立全屏页、顶部返回 + 题目信息、中间棋盘、
 * 底部状态与操作。以及**同一条纪律：棋盘跟着打谱的显示设置走**。
 *
 * ## 一条最容易写错的事：胜负要相对**人**、不是相对棋子颜色
 *
 * "黑棋成了五"不等于"你赢了" —— 题目可能是白先、你执白。所以这里的 `phase`
 * 一律相对**人类那一方**算（`human` 参数），而不是看最后落子的颜色。
 * 我第一版就是按棋子颜色写的（`board[last] === "black" ? "won" : "lost"`），
 * 那样白先题赢了会被判成输 —— 单测第一条就把这个钉住了。
 */

import { addMoveAs, boardAt, emptyBoard, nextPlayerAt, winningLinesAt } from "../../game";
import type { Cell, GameDocument, Player, Position, RecordNode, RuleSet } from "../../types";

export type DailyPhase = "playing" | "won" | "lost";

export interface DailyMove {
  position: Position;
  player: Player;
}

export interface DailyState {
  document: GameDocument;
  currentId: string;
  /** **相对人类那一方**的结局（见文件头最后一段）。 */
  phase: DailyPhase;
  /** 已经落在盘上的手（含题目的预置子）。用于手数与"最后一步"标记。 */
  moves: DailyMove[];
  /** 最后一次提示（非法落子 / 陪练没找到落点），显示在状态行上。 */
  notice: string;
  /** 正在等陪练应手。 */
  thinking: boolean;
}

/** 最后一手的成五方是不是人类 ⇒ 相对人类的结局。 */
const phaseAfter = (board: Cell[][], last: Position, rule: RuleSet, human: Player): DailyPhase => {
  const winner = board[last.row]?.[last.col];
  if (!winner || !winningLinesAt(board, last, rule).length) return "playing";
  return winner === human ? "won" : "lost";
};

/**
 * 从题目文档初始化对局状态。
 *
 * `document` 由 `createPuzzleDocument()` 建好（它已把预置子摆成一个手序链、
 * 并把"该谁走"钉在终局节点上），所以这里只需要读到"盘上现有的子"与"轮到谁"。
 */
export const createDailyState = (document: GameDocument, currentId: string): DailyState => {
  const moves: DailyMove[] = [];
  // 从当前节点往回走到根，再反转 —— 顺序就是手序（预置子也是按顺序串起来的）。
  // ⚠ `cursor` 要显式标类型：TS 在 `let cursor = currentId` + 循环里读
  // `node.parentId` 时会绕进"自己引用自己"的推断，报 TS7022（隐式 any）。
  const chain: string[] = [];
  let cursor: string | null = currentId;
  while (cursor) {
    const node: RecordNode | undefined = document.nodes[cursor];
    if (!node) break;
    chain.push(cursor);
    cursor = node.parentId;
  }
  for (const id of chain.reverse()) {
    const move = document.nodes[id]?.move;
    if (move) moves.push({ position: { row: move.row, col: move.col }, player: move.player });
  }
  return { document, currentId, phase: "playing", moves, notice: "", thinking: false };
};

/** 棋盘上现在长什么样（给渲染与 AI 用）。 */
export const dailyBoard = (state: DailyState): Cell[][] => boardAt(state.document, state.currentId);

/** 轮到谁走。 */
export const dailyTurn = (state: DailyState): Player => nextPlayerAt(state.document, state.currentId);

/**
 * 玩家落一手。返回新状态；**落点不合法时原样返回**并在 `notice` 里说明原因
 * （不判负、不改盘面 —— 见文件头那张对照表）。
 *
 * 合法性检查由调用方注入（`check`）：它要用题库那套 `puzzleMoveLegality`
 * （含禁手判断），在这里再抄一份必然走散。返回 null = 合法。
 */
export const playDailyMove = (
  state: DailyState,
  position: Position,
  player: Player,
  rule: RuleSet,
  human: Player,
  check: (position: Position, player: Player) => string | null,
): DailyState => {
  if (state.phase !== "playing" || state.thinking) return state;
  const reason = check(position, player);
  if (reason) return { ...state, notice: reason };
  const result = addMoveAs(state.document, state.currentId, position, player);
  // 悔棋保留树上的变化。复用已有子节点也是合法前进，created 只表示有没有新建。
  if (result.nodeId === state.currentId) return { ...state, notice: "这一步已经下过了" };
  const board = boardAt(result.document, result.nodeId);
  const phase = phaseAfter(board, position, rule, human);
  return {
    ...state,
    document: result.document,
    currentId: result.nodeId,
    moves: [...state.moves, { position, player }],
    phase,
    notice: "",
    // ⚠ **不在这里置 `thinking`**：只有"这一手之后真的该陪练走"才算在思考。
    // 这一手要是把对方连成五（`phase !== "playing"`），还挂着"陪练思考中"
    // 会让结束的画面配一句错的状态文案。由页面看过 `dailyShouldReply` 再置。
    thinking: false,
  };
};

/** 陪练应一手（AI 的落点已经算好，这里只负责落子 + 判胜负）。 */
export const playDailyReply = (
  state: DailyState,
  position: Position,
  player: Player,
  rule: RuleSet,
  human: Player,
): DailyState => {
  if (state.phase !== "playing") return { ...state, thinking: false };
  const boardBefore = dailyBoard(state);
  if (!Number.isInteger(position.row) || !Number.isInteger(position.col)
    || boardBefore[position.row]?.[position.col] !== null) {
    return { ...state, thinking: false, notice: "陪练返回了一个无效落点" };
  }
  const result = addMoveAs(state.document, state.currentId, position, player);
  if (result.nodeId === state.currentId) return { ...state, thinking: false, notice: "陪练返回了一个无效落点" };
  const board = boardAt(result.document, result.nodeId);
  return {
    ...state,
    document: result.document,
    currentId: result.nodeId,
    moves: [...state.moves, { position, player }],
    phase: phaseAfter(board, position, rule, human),
    notice: "",
    thinking: false,
  };
};

export const setDailyThinking = (state: DailyState, thinking: boolean): DailyState =>
  ({ ...state, thinking });

export const setDailyNotice = (state: DailyState, notice: string): DailyState =>
  ({ ...state, notice });

/**
 * 悔棋：退回到玩家**上一个还没被回应的落点之前** —— 也就是一次退两手
 * （陪练那手 + 自己那手）。只退一手会让玩家立刻又走回同一个局面，
 * 那种"悔了个寂寞"的按钮不如不给。
 *
 * · **赢局不许悔**：否则可以反复触发结算（`recordPuzzleAttempt` / 棋魂发放那边
 *   靠 token 幂等挡得住，但界面上会来回弹结算框，那是骚扰）；
 * · **输局可以悔**：输了正是最想重来的时候（VCF 也允许重做）；
 * · 退不动时（盘上只剩预置子）原样返回，由页面提示"已经是开局局面"。
 *
 * 注意 `document` **不变**：退回去的是"当前停在哪"，树上的节点留着 ——
 * 玩家改下别处就会自然形成分支，与打谱里的悔棋同一套语义。
 */
export const undoDaily = (state: DailyState, setupCount: number): DailyState => {
  if (state.phase === "won") return state;
  let currentId = state.currentId;
  let moves = state.moves;
  for (let step = 0; step < 2 && moves.length > setupCount; step += 1) {
    const parentId = state.document.nodes[currentId]?.parentId;
    if (!parentId) break;
    currentId = parentId;
    moves = moves.slice(0, -1);
  }
  if (currentId === state.currentId) return state;
  return { ...state, currentId, moves, phase: "playing", notice: "", thinking: false };
};

/** 空盘（AI 兜底用：`emptyBoard` 只是转出去，免得页面再引一次 game）。 */
export const dailyEmptyBoard = (size: number): Cell[][] => emptyBoard(size);

/** 最后一步的落点（画红点用）；没有则 null。 */
export const dailyLastMove = (state: DailyState): Position | null =>
  state.moves.length ? state.moves[state.moves.length - 1].position : null;

/**
 * **该不该让陪练应手**：轮到对手、且没结束、且没在思考。
 *
 * 单独提出来是因为它是页面里最容易写错的一处：漏判 `phase` 会在结局后再算一手，
 * 漏判 `thinking` 会连开两个搜索（第一个的结果回来时局面已经变了）。
 */
export const dailyShouldReply = (state: DailyState, human: Player): boolean =>
  state.phase === "playing" && !state.thinking && dailyTurn(state) !== human;
