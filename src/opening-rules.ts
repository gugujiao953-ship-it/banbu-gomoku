import { evaluateRenjuMove } from "./game";
import type { Cell, OpeningRule, Player, Position } from "./types";

export type OpeningActor = "human" | "ai";
export type OpeningStage =
  | { kind: "normal" }
  | { kind: "place"; moveNumber: number; player: Player; actor: OpeningActor; radius: number | null }
  | { kind: "swap"; afterMove: number; chooser: OpeningActor; taraguchiChoice?: boolean }
  // 塔十第4手后：交换权行使完，再由**此时的黑方**选黑5方式（官方 renju.net 的 choice 1 / choice 2）
  | { kind: "taraguchi-fifth"; actor: OpeningActor }
  | { kind: "choose-fifth-count"; actor: OpeningActor }
  | { kind: "offer-fifths"; actor: OpeningActor; count: number }
  | { kind: "choose-fifth"; chooser: OpeningActor }
  // Swap2（无禁手二次交换）：一方一次连下多子（颜色按 colors 顺序），placed 为已下数
  | { kind: "batch"; actor: OpeningActor; colors: Player[]; placed: number; radius: number | null }
  | { kind: "swap2-choice"; chooser: OpeningActor }
  | { kind: "swap2-pick"; chooser: OpeningActor };

export interface OpeningSession {
  rule: OpeningRule;
  n: number;
  humanPlayer: Player;
  opener: OpeningActor;
  stage: OpeningStage;
  candidates: Position[];
}

export const openingRuleName = (rule: OpeningRule, n = 2) => ({
  free: "自由开局",
  swap1: "一手交换",
  swap2: "Swap2 · 二次交换",
  swap3: "三手交换",
  "five-two": "五手两打",
  "five-n": n >= 3 ? `五手 ${n} 打` : "五手多打",
  yamaguchi: "山口",
  "soosyrv-8": "索索夫-8",
  "taraguchi-10": "塔拉山口-10",
  tarannikov: "塔拉 · 五次交换",
}[rule]);

export const actorForColor = (session: Pick<OpeningSession, "humanPlayer">, player: Player): OpeningActor => session.humanPlayer === player ? "human" : "ai";
/**
 * 开局阶段「该谁动」：place / offer-fifths / choose-fifth-count / batch / taraguchi-fifth 用 `actor`，
 * swap / choose-fifth / swap2-* 用 `chooser`；正常阶段（`normal`）返回 null（该按行棋方走）。
 *
 * ⚠ 这个口径只有**一处实现**：`scheduleAiOpening` 与「退出后恢复对局」都要问它，
 * 两边各写一份 switch 的话，恢复路径漏掉某个阶段就会出现「AI 永远不落子」的僵局。
 */
export const openingStageActor = (stage: OpeningStage): OpeningActor | null => {
  if (stage.kind === "normal") return null;
  return stage.kind === "place" || stage.kind === "offer-fifths" || stage.kind === "choose-fifth-count" || stage.kind === "batch" || stage.kind === "taraguchi-fifth"
    ? stage.actor
    : stage.chooser;
};
const otherActor = (actor: OpeningActor): OpeningActor => actor === "human" ? "ai" : "human";
const place = (session: OpeningSession, moveNumber: number, radius: number | null): OpeningStage => ({
  kind: "place", moveNumber, player: moveNumber % 2 ? "black" : "white", actor: actorForColor(session, moveNumber % 2 ? "black" : "white"), radius,
});

export const createOpeningSession = (rule: OpeningRule, n: number, humanPlayer: Player): OpeningSession => {
  const normalizedN = rule === "five-two" ? 2 : rule === "taraguchi-10" ? 10 : rule === "five-n" ? 0 : Math.max(3, Math.min(10, Math.round(n || 3)));
  const opener: OpeningActor = humanPlayer === "black" ? "human" : "ai";
  const base: OpeningSession = { rule, n: normalizedN, humanPlayer, opener, stage: { kind: "normal" }, candidates: [] };
  if (rule === "free") return base;
  if (rule === "swap2") return { ...base, stage: { kind: "batch", actor: opener, colors: ["black", "white", "black"], placed: 0, radius: null } };
  return { ...base, stage: { kind: "place", moveNumber: 1, player: "black", actor: opener, radius: rule === "swap1" || rule === "swap3" ? null : 0 } };
};

/** 把「某一方执某色」翻译成 humanPlayer（Swap2 的选边用）。 */
const humanPlayerFor = (session: Pick<OpeningSession, "humanPlayer">, actor: OpeningActor, side: Player): Player =>
  actor === "human" ? side : (side === "black" ? "white" : "black");

/**
 * 批量落子阶段（目前只有 Swap2 用）：放下 `colors[placed]` 这一子。
 * 批量下完后按 Swap2 流程决定下一阶段：
 *   先手 3 子（黑·白·黑）→ 后手三选一；后手补 1 白子 → 进入正常对局；
 *   后手补 2 子（白·黑）→ 由先手选执子颜色。
 */
export const placeBatchStone = (session: OpeningSession): OpeningSession => {
  if (session.stage.kind !== "batch") return session;
  const stage = session.stage;
  const placed = stage.placed + 1;
  if (placed < stage.colors.length) return { ...session, stage: { ...stage, placed } };
  if (stage.colors.length === 3) return { ...session, stage: { kind: "swap2-choice", chooser: otherActor(session.opener) } };
  if (stage.colors.length === 1) return { ...session, stage: { kind: "normal" } };
  if (stage.colors.length === 2) return { ...session, stage: { kind: "swap2-pick", chooser: session.opener } };
  return { ...session, stage: { kind: "normal" } };
};

/**
 * Swap2 后手的三选一，逐字对齐 renju.net《Gomoku - Swap 2》条目（应用规则表 RENJU_RULES id 11 的来源页）：
 *   「- The first player puts 2 black and 1 white stones anywhere on the board.
 *     - The second player has 3 options: - stay with white, - swap,
 *       - put 2 more stones and let the opponent choose the colour」
 * 即：① 执白（保持现状）② 交换（执黑）③ 再补白、黑两子（共 5 子）后由先手选色。
 * （五林的状态表同构：0 子时 `Put3Stones`、3 子后 `CanPut2Stones`「可以下一子或者连下两子」+ 该处可交换；
 *   英文维基的 Gomoku 世界赛版本把「执白」写成「执白并再补一颗白子」，本应用按 renju.net 原文实现。）
 */
export const swap2Choose = (session: OpeningSession, choice: "white" | "black" | "two-more"): OpeningSession => {
  if (session.stage.kind !== "swap2-choice") return session;
  const chooser = session.stage.chooser;
  if (choice === "white") return { ...session, humanPlayer: humanPlayerFor(session, chooser, "white"), stage: { kind: "normal" } };
  if (choice === "black") return { ...session, humanPlayer: humanPlayerFor(session, chooser, "black"), stage: { kind: "normal" } };
  // 第三条：后手补白、黑两子（共 5 子），颜色判给谁由先手稍后选 —— 此时不改 humanPlayer。
  return { ...session, stage: { kind: "batch", actor: chooser, colors: ["white", "black"], placed: 0, radius: null } };
};

/** Swap2 第三条路的收尾：先手选本局执子颜色。 */
export const swap2PickSide = (session: OpeningSession, side: Player): OpeningSession => {
  if (session.stage.kind !== "swap2-pick") return session;
  return { ...session, humanPlayer: humanPlayerFor(session, session.stage.chooser, side), stage: { kind: "normal" } };
};

export const completeOpeningPlacement = (session: OpeningSession): OpeningSession => {
  if (session.stage.kind !== "place") return session;
  const move = session.stage.moveNumber;
  if (session.rule === "swap1") {
    if (move === 1) return { ...session, stage: { kind: "swap", afterMove: 1, chooser: otherActor(session.stage.actor) } };
  }
  if (session.rule === "swap3") {
    if (move < 3) return { ...session, stage: place(session, move + 1, null) };
    if (move === 3) return { ...session, stage: { kind: "swap", afterMove: 3, chooser: otherActor(session.stage.actor) } };
  }
  if (session.rule === "five-two" || session.rule === "five-n") {
    if (move < 3) return { ...session, stage: { kind: "place", moveNumber: move + 1, player: move === 1 ? "white" : "black", actor: session.opener, radius: move } };
    if (move === 3) return { ...session, stage: { kind: "swap", afterMove: 3, chooser: otherActor(session.opener) } };
    if (move === 4) return session.rule === "five-n"
      ? { ...session, candidates: [], stage: { kind: "choose-fifth-count", actor: actorForColor(session, "white") } }
      : { ...session, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(session, "black"), count: session.n } };
    if (move === 6) return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "yamaguchi") {
    if (move < 3) return { ...session, stage: { kind: "place", moveNumber: move + 1, player: move === 1 ? "white" : "black", actor: session.opener, radius: move } };
    if (move === 3) return { ...session, candidates: [], stage: { kind: "choose-fifth-count", actor: actorForColor(session, "black") } };
    if (move === 4) return { ...session, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(session, "black"), count: session.n } };
    if (move === 6) return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "soosyrv-8") {
    if (move < 3) return { ...session, stage: { kind: "place", moveNumber: move + 1, player: move === 1 ? "white" : "black", actor: session.opener, radius: move } };
    if (move === 3) return { ...session, stage: { kind: "swap", afterMove: 3, chooser: otherActor(session.stage.actor) } };
    if (move === 4) return { ...session, candidates: [], stage: { kind: "choose-fifth-count", actor: actorForColor(session, "white") } };
    if (move === 6) return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "tarannikov") {
    if (move <= 5) return { ...session, stage: { kind: "swap", afterMove: move, chooser: otherActor(session.stage.actor) } };
    return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "taraguchi-10") {
    if (move <= 3) return { ...session, stage: { kind: "swap", afterMove: move, chooser: otherActor(session.stage.actor) } };
    if (move === 4) return { ...session, stage: { kind: "swap", afterMove: 4, chooser: otherActor(session.stage.actor), taraguchiChoice: true } };
    if (move === 5) return { ...session, stage: { kind: "swap", afterMove: 5, chooser: otherActor(session.stage.actor) } };
    return { ...session, stage: { kind: "normal" } };
  }
  return { ...session, stage: { kind: "normal" } };
};

/**
 * 把开局会话「倒回」到盘面还剩 `stonesOnBoard` 颗子的状态——悔棋必须走这里。
 *
 * ## 为什么必须做这件事（用户 2026-10-09 报的 bug）
 *
 * 用户原话：「我在五手两打规则，在摆出选点然后选择了一个后，我再去悔棋几步，竟然会回到
 * 前面的局面不说，还可以布置打点，这不是在第五手的时候打点，而是在第三手，第二手的时候打点」。
 *
 * 根因：`goPrev` 只回退了**树游标**（棋谱节点），`aiGame.opening.stage` 一动不动。
 * 于是棋盘退回第 2 手、而阶段仍停在 `offer-fifths`（"请提供 N 个第5手候选"）——
 * 盘面是第 2 手的、规则却在要求放第 5 手的打点；`humanCanUseOpeningBoard` 也照旧
 * 允许点击，用户就能在第二手、第三手的位置"打点"。整条开局状态机与盘面脱节。
 *
 * ## 为什么是「重建」而不是「逐步回退」
 *
 * 逐步 undo 需要为 9 条规则 × 11 种阶段各写一条逆向路径（还要正确处理交换改过 humanPlayer、
 * 五手多打改过 n 的情况），漏一条就是一个新 bug。这里用**前向重放**：从同一套前向函数
 * （`completeOpeningPlacement` / `decideOpeningSwap` / …）按盘面实际落子重新走一遍到目标手数，
 * 天然与 `createOpeningSession` 的语义一致，也不需要维护第二种真值。
 * 代价只是开局阶段那几步（最多 6 手）重算一次，可忽略。
 *
 * ## 口径
 *
 * - 只处理「前几手是**顺序落子**」的规则（自由/一手交换/三手交换/五手两打/五手多打/山口/
 *   索索夫-8/塔拉/塔拉山口-10）——它们的盘面就是手数，重放即可。
 * - **Swap2 走批量落子**（`batch` 阶段可以一次连下 2–3 子），盘面手数无法唯一确定"该回到哪个阶段"，
 *   所以这里**不改状态机**，只把 `candidates` 清空（避免拿旧候选去配新盘面）；
 *   对局中真正的安全网是界面上的「重开一局」。
 * - 回到 0 手 ⇒ 相当于重新开局，直接 `createOpeningSession`。
 * - 交换类的**选择**（是否交换、打点数、塔十方式）无法从盘面反推，重放时按"未发生"处理：
 *   于是悔棋回到第 3 手后，会重新要求做那次交换 —— 这正是"回到那个决策点"的正确语义。
 *
 * @param session        当前会话（提供 rule / n / humanPlayer / opener）
 * @param stonesOnBoard  目标盘面上的棋子总数（= 当前节点路径上的落子数）
 */
export const rewindOpeningToMove = (session: OpeningSession, stonesOnBoard: number): OpeningSession => {
  const target = Math.max(0, Math.floor(stonesOnBoard));
  // Swap2 的批量阶段无法从手数反推阶段（见上），只清候选、不动状态机。
  if (session.rule === "swap2") return { ...session, candidates: [] };
  // 回到起点：等于重新开局，交给前向构造。
  if (target === 0) return createOpeningSession(session.rule, session.n, session.humanPlayer);

  let current = createOpeningSession(session.rule, session.n, session.humanPlayer);
  /**
   * 前向重放，**按「已落子数」计数**（不是按转移次数）。
   *
   * ⚠ 这里有个容易写错的点：交换/选打点数这类**决策阶段不落子**，所以「转移几次」
   * 与「盘上有几颗子」不是一回事。早先按循环次数计数会错位一格——例如五手两打要到第 4 手，
   * 中间夹着一次 swap 决策，按次数重放会停在 place(4) 而盘上已有 4 颗子。
   * 现在口径改成：每完成一个 `place` 才 `placed += 1`，决策阶段只是"过路"、不消耗配额；
   * 并且一旦 `placed` 达标立刻停——**即使当前正停在某个决策阶段**，也要把它留给玩家重新决策
   * （悔棋回到第 3 手后重新问"是否交换"，正是"回到那个决策点"的正确语义）。
   */
  /**
   * 前向重放，**按「已落子数」计数**（不是按转移次数）。
   *
   * ⚠ 这里有两个容易写错的点，都踩过：
   *
   * ① **决策阶段不落子**，所以「转移几次」≠「盘上有几颗子」。早先按循环次数计数会错位一格。
   *    现在口径是：每完成一个 `place` 才 `placed += 1`，决策阶段只是"过路"、不消耗配额。
   *
   * ② **停在达标处，不越界**。循环一开始就判 `placed >= target` 并立刻返回当前阶段——
   *    这样「盘上 4 颗子」会正确停在 `offer-fifths`（第 4 手已下、该由黑方提供第 5 手候选），
   *    而不会替玩家把候选也填了。悔棋回到某个决策点，就该把那个决策重新交给玩家。
   *
   * ③ **目标手数超过开局阶段时要把重放走完**。对局下到十几手再悔棋几步（target=8）时，
   *    如果遇到 `offer-fifths` 就 break，会返回一个"第 4 手才该出现"的阶段，
   *    与盘面（8 颗子）严重不符。所以非落子阶段**要主动推进过去**：
   *    提供候选 → 选打点 → 补第 5 手 → 第 6 手 → 正常对局。
   *    占位候选只在重放内部使用，返回前一律清空（`candidates: []`），不污染真实盘面。
   */
  let placed = 0;
  for (let guard = 0; guard < 32; guard += 1) {
    if (placed >= target) break;
    const stage = current.stage;
    if (stage.kind === "place") {
      current = completeOpeningPlacement(current);
      placed += 1;
      continue;
    }
    if (stage.kind === "swap") {
      // 交换权按"不交换"推进：它不改变盘面，悔棋回到该点时玩家会重新做这次选择。
      // （若这里按"已交换"推进，会因为 humanPlayer 翻转而让后续 actor 全错，反而更糟。）
      current = decideOpeningSwap(current, false);
      continue;
    }
    if (stage.kind === "choose-fifth-count") {
      current = chooseFifthCount(current, current.n || (current.rule === "soosyrv-8" ? 1 : 3));
      continue;
    }
    if (stage.kind === "taraguchi-fifth") {
      // 塔十的"单点 / 摆10打点"无法从盘面反推，取 **single**：它是通向落子的那条路
      // （offers 会转到 offer-fifths 这种非落子阶段，重放会卡在第 4 颗子上）。
      current = chooseTaraguchiFifth(current, "single");
      continue;
    }
    if (stage.kind === "offer-fifths") {
      // 需要凑满声明数量的候选才能进入 choose-fifth。用互不相同的占位点填满——
      // addFifthCandidate 只校验"不重复"，所以这些点不会被拒；返回前会清空。
      let filled = current;
      for (let index = 0; index < stage.count; index += 1) filled = addFifthCandidate(filled, { row: 0, col: index });
      current = filled;
      continue;
    }
    if (stage.kind === "choose-fifth") {
      // ⚠ 这一步**落下了一颗子**（白方从打点里选出的第 5 手），只是它走的是
      // 「选」而不是 `place` 阶段——所以这里必须同样记账。漏记会差一手：
      // 盘上 5 颗子时会被算成"还在第 4 手之后"，于是错误地停在 offer-fifths。
      current = completeFifthChoice(current);
      placed += 1;
      continue;
    }
    // `normal`（开局结束）或 batch/swap2-*（批量落子，无法从手数反推）：
    // 走到这里就没有可推进的了，停在当前阶段。
    break;
  }
  return { ...current, candidates: [] };
};

export const decideOpeningSwap = (session: OpeningSession, swap: boolean): OpeningSession => {
  if (session.stage.kind !== "swap") return session;
  const stage = session.stage;
  const updated = swap ? { ...session, humanPlayer: session.humanPlayer === "black" ? "white" as const : "black" as const } : session;
  if (session.rule === "swap1" || session.rule === "swap3") return { ...updated, stage: { kind: "normal" } };
  if (stage.taraguchiChoice) {
    // 塔十第4手后是**两步**（renju.net《Taraguchi》原文，choice 1 / choice 2 的首条都是
    // 「The other player may swap」，随后才是「black player will put the 5th move」/
    // 「black player puts five 5th moves」）：
    //   第一步 交换权（本函数）→ 第二步 由**此时的黑方**选黑5方式（chooseTaraguchiFifth）。
    // 不要退回「交换/不交换各自决定单点还是打点」或「三个并列按钮」的写法：前者让
    // 「不交换 + 单点」不可达，后者让交换后的新黑方拿不到选择权（两者都跟官方原文不符）。
    return { ...updated, stage: { kind: "taraguchi-fifth", actor: actorForColor(updated, "black") } };
  }
  if (session.rule === "five-two" || session.rule === "five-n") return { ...updated, stage: place(updated, 4, null) };
  if (session.rule === "yamaguchi") return { ...updated, stage: place(updated, 4, null) };
  if (session.rule === "soosyrv-8") {
    if (stage.afterMove === 3) return { ...updated, stage: place(updated, 4, null) };
    return { ...updated, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(updated, "black"), count: updated.n } };
  }
  if (session.rule === "tarannikov") return { ...updated, stage: place(updated, stage.afterMove + 1, stage.afterMove < 5 ? stage.afterMove : null) };
  if (session.rule === "taraguchi-10") return { ...updated, stage: place(updated, stage.afterMove + 1, stage.afterMove < 4 ? stage.afterMove : null) };
  return updated;
};

export const chooseFifthCount = (session: OpeningSession, count: number): OpeningSession => {
  if (session.stage.kind !== "choose-fifth-count") return session;
  const declared = Math.round(Number.isFinite(count) ? count : 0);
  if (session.rule === "five-n") {
    const normalized = Math.max(3, Math.min(10, declared || 3));
    // 打点由黑方放置（openingInstruction 同文：「随后黑方依次放置 A1、A2…」）。
    // 旧实现继承 count 选择方的 actor（白方），白=AI 时会 AI 代放+代选、
    // 黑方全程被跳过（T30 修复，五手两打/索索夫/塔拉均显式 black）。
    return { ...session, n: normalized, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(session, "black"), count: normalized } };
  }
  if (session.rule === "soosyrv-8") {
    // RenjuNet Soosyrv-8: 白方落第4手时宣布 1–8 个第5手打点，随后对方仍有一次交换权。
    const normalized = Math.max(1, Math.min(8, declared));
    return { ...session, n: normalized, candidates: [], stage: { kind: "swap", afterMove: 4, chooser: otherActor(session.stage.actor) } };
  }
  if (session.rule === "yamaguchi") {
    // RenjuNet Yamaguchi: 先手方摆开局时宣布打点数。上限沿用五林客户端的 Const.MaxAlternations = 15
    // （旧实现限 1–10，比参考实现紧）。
    const normalized = Math.max(1, Math.min(15, declared));
    return { ...session, n: normalized, candidates: [], stage: { kind: "swap", afterMove: 3, chooser: otherActor(session.stage.actor) } };
  }
  return session;
};

/**
 * 塔十第4手后的第二步：此时的黑方选黑5方式（官方 renju.net《Taraguchi》的
 * choice 1 = 单点第5手（9×9 内），choice 2 = 摆 10 个第5手打点让白方选一个）。
 */
export const chooseTaraguchiFifth = (session: OpeningSession, mode: "single" | "offers"): OpeningSession => {
  if (session.stage.kind !== "taraguchi-fifth") return session;
  if (mode === "single") return { ...session, stage: place(session, 5, 4) };
  return { ...session, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(session, "black"), count: 10 } };
};

const samePoint = (left: Position, right: Position) => left.row === right.row && left.col === right.col;
export const addFifthCandidate = (session: OpeningSession, position: Position): OpeningSession => {
  if (session.stage.kind !== "offer-fifths" || session.candidates.some((point) => samePoint(point, position))) return session;
  const candidates = [...session.candidates, position];
  return candidates.length >= session.stage.count
    ? { ...session, candidates, stage: { kind: "choose-fifth", chooser: actorForColor(session, "white") } }
    : { ...session, candidates };
};

export const completeFifthChoice = (session: OpeningSession): OpeningSession => ({ ...session, candidates: [], stage: place(session, 6, null) });

export const openingPositionAllowed = (boardSize: number, position: Position, stage: OpeningStage): boolean => {
  if (stage.kind !== "place" || stage.radius === null) return true;
  const center = Math.floor(boardSize / 2);
  return Math.max(Math.abs(position.row - center), Math.abs(position.col - center)) <= stage.radius;
};

/**
 * 第5手多打「不得同形」的判据 —— **相对本局局面自身的对称**，不是相对天元。
 *
 * 依据（2026-09-16，逆向 五林五子棋 官方客户端得出）：
 *  包 `com.magicflute.renjuworld` 的 Cocos 脚本加密，但网页版 https://renjuworld.net/renju/
 *  的 `assets/main/index.0c96e.js` 是明文（仅字符串表混淆）。其中：
 *   · `posRelation(a, b, out)`：两点同色时给出它们所在的线型（`LR` 同行 / `TB` 同列 /
 *     `LB2RT` “/”对角 / `LT2RB` “\”对角），并把**对称中心 = a + b**（即中点的两倍）写进 `out`；
 *   · `canPutAlternativeStone(x, y)`：先挡重复点，然后取四手棋（黑1、白2、黑3、白4），
 *     分别求「黑1↔黑3」与「白2↔白4」的关系；**只有当这两对的对称轴/对称中心重合**（也就是
 *     *本局局面本身*关于某条线或某个点对称）时，才检查新打点与已打点是否关于**同一个**轴/中心
 *     互为镜像，是则拒绝（返回 0，提示 `game.symmetricAlternations`「打点重复或对称!」）。
 *
 * 语义：两个打点「同形」⇔ 存在一个平面等距变换把**当前局面连同这两个打点之一**映成另一个，
 * 即白方在这两点间做选择会得到**完全一样的局面**。因此 ——
 *  · 局面本身不对称（绝大多数实战局面）时，任何两个打点给出的局面都不同形，全部放行；
 *  · 局面有对称（如黑1/黑3 与白2/白4 各自关于同一点中心对称）时，被该对称互相映射的两个
 *    打点才是同形，只拦这一对关系。
 *
 * 实现上不再枚举「天元四条轴 + 180°」（那套口径会拦下大量与局面无关的远点，用户 09-16 实测
 * 报为误拦），而是直接求**该局面的对称群**：枚举以质心为不动点的等距变换（180°/90° 旋转 +
 * 任意镜轴），保留真正把带色棋子集合映到自身的那些；再检查新打点是否是某个已打点的像。
 * 允许的镜轴由棋子对唯一定出（中垂线 / 过两点直线），故枚举是完备的。
 */
type SymmetryMap = (position: Position) => Position;

const stoneSetOf = (board: Cell[][]): Array<{ position: Position; color: string }> => {
  const stones: Array<{ position: Position; color: string }> = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < (board[row]?.length || 0); col += 1) {
      const cell = board[row][col];
      if (cell) stones.push({ position: { row, col }, color: cell });
    }
  }
  return stones;
};

/** 关于「过 (r0,c0)、方向 (dr,dc)」的直线做镜面反射；结果要求落在格点上，否则返回 null。 */
const reflectAcross = (r0: number, c0: number, dr: number, dc: number): SymmetryMap => (position: Position): Position => {
  const wr = position.row - r0, wc = position.col - c0;
  const length2 = dr * dr + dc * dc;
  const t = (wr * dr + wc * dc) / length2;
  return { row: 2 * (r0 + t * dr) - position.row, col: 2 * (c0 + t * dc) - position.col };
};

const isLattice = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;

/** 局面（带色棋子的有限点集）的全部非平凡对称变换。 */
export const positionSymmetries = (board: Cell[][]): SymmetryMap[] => {
  const stones = stoneSetOf(board);
  if (stones.length === 0) return [];
  const rowSum = stones.reduce((sum, stone) => sum + stone.position.row, 0);
  const colSum = stones.reduce((sum, stone) => sum + stone.position.col, 0);
  const cr = rowSum / stones.length, cc = colSum / stones.length;
  const target = new Map<string, string>();
  for (const stone of stones) target.set(`${stone.position.row},${stone.position.col}`, stone.color);
  const preserves = (map: SymmetryMap): boolean => {
    const seen = new Set<string>();
    for (const stone of stones) {
      const mapped = map(stone.position);
      if (!isLattice(mapped.row) || !isLattice(mapped.col)) return false;
      const point = { row: Math.round(mapped.row), col: Math.round(mapped.col) };
      if (target.get(`${point.row},${point.col}`) !== stone.color) return false;
      seen.add(`${point.row},${point.col}`);
    }
    return seen.size === stones.length;
  };
  const rotate = (turns: number): SymmetryMap => (position: Position) => {
    let r = position.row - cr, c = position.col - cc;
    for (let turn = 0; turn < turns; turn += 1) [r, c] = [c, -r];
    return { row: cr + r, col: cc + c };
  };
  const candidates: SymmetryMap[] = [rotate(2), rotate(1), rotate(3)];
  for (let i = 0; i < stones.length; i += 1) {
    for (let j = i + 1; j < stones.length; j += 1) {
      const a = stones[i].position, b = stones[j].position;
      const dr = b.row - a.row, dc = b.col - a.col;
      if (dr === 0 && dc === 0) continue;
      candidates.push(reflectAcross((a.row + b.row) / 2, (a.col + b.col) / 2, -dc, dr)); // 中垂线（方向垂直于线段）
      candidates.push(reflectAcross(a.row, a.col, dr, dc));                             // 过这两点的直线
    }
  }
  const result: SymmetryMap[] = [];
  const fingerprints = new Set<string>();
  const probe: Position[] = [
    { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 5 },
  ];
  for (const map of candidates) {
    if (!preserves(map)) continue;
    const fingerprint = probe.map((point) => { const q = map(point); return `${q.row},${q.col}`; }).join("|");
    if (probe.every((point) => { const q = map(point); return q.row === point.row && q.col === point.col; })) continue; // 恒等不算「关系」
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    result.push(map);
  }
  return result;
};

/** 新打点若与某个已打点是「同一局面的对称像」则返回那个已打点，否则返回 null。 */
export const symmetricCounterpart = (board: Cell[][], candidates: Position[], position: Position): Position | null => {
  // 重复点与对称无关，必须先判（局面不对称时下面会直接返回 null，漏掉这里就会出现
  // 「点了同一个点、提示却说已加入候选」的静默不一致）。
  const duplicate = candidates.find((candidate) => candidate.row === position.row && candidate.col === position.col);
  if (duplicate) return duplicate;
  const symmetries = positionSymmetries(board);
  if (symmetries.length === 0) return null;
  for (const candidate of candidates) {
    for (const map of symmetries) {
      const mapped = map(candidate);
      if (Math.round(mapped.row) === position.row && Math.round(mapped.col) === position.col) return candidate;
    }
  }
  return null;
};

export const isDistinctFifthCandidate = (board: Cell[][], candidates: Position[], position: Position) =>
  !candidates.some((candidate) => candidate.row === position.row && candidate.col === position.col)
  && symmetricCounterpart(board, candidates, position) === null;

export const suggestOpeningPlacement = (board: Cell[][], stage: OpeningStage): Position | null => {
  if (stage.kind !== "place") return null;
  const center = Math.floor(board.length / 2);
  const preferred: Position[] = [
    { row: center, col: center }, { row: center, col: center + 1 }, { row: center + 1, col: center },
    { row: center - 1, col: center }, { row: center, col: center - 1 }, { row: center + 1, col: center + 1 },
  ];
  const rest: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < board.length; col += 1) rest.push({ row, col });
  rest.sort((a, b) => Math.abs(a.row - center) + Math.abs(a.col - center) - Math.abs(b.row - center) - Math.abs(b.col - center));
  return [...preferred, ...rest].find((position, index, points) => points.findIndex((point) => samePoint(point, position)) === index && board[position.row]?.[position.col] === null && openingPositionAllowed(board.length, position, stage) && (stage.player !== "black" || evaluateRenjuMove(board, position).legal)) || null;
};

/**
 * 从引擎给出的多路候选里挑出「要摆的打点」。
 *
 * 背景（对齐五林客户端）：五林是 `searchAlternations(10) → searchNBestMoves(黑, 10, advancedLevel)`，
 * 再按引擎给出的顺序取前「声明数」个、逐个过重复/对称过滤。
 * 我们实测我们的引擎返回顺序**基本按评估分降序、但偶尔倒挂**（同一局面 2200ms / 5000ms 的头三点
 * 都不一样），照单取前 N 个等于随机取，所以这里显式按评估分降序；**开局簿候选保持原顺序**
 * （簿内 rank 层本身有序，分数可能缺失）。
 *
 * @param moves 引擎/簿给出的候选（按来源顺序）
 * @param scores 与 moves 对齐的评估分（缺失用 NaN）
 * @param board 当前盘面（过滤已占位）
 * @param count 需要几个
 * @param preserveOrder 保持来源顺序（开局簿命中时）
 * @param distinct 过滤函数（默认走本模块的「同形」判据）
 */
export const selectFifthCandidates = (
  moves: Position[],
  scores: number[],
  board: Cell[][],
  count: number,
  options: { preserveOrder?: boolean; distinct?: (board: Cell[][], chosen: Position[], position: Position) => boolean } = {},
): Position[] => {
  const distinct = options.distinct || isDistinctFifthCandidate;
  const ranked = moves.map((move, index) => ({ move, score: scores[index] }));
  const ordered = options.preserveOrder || ranked.some((entry) => !Number.isFinite(entry.score))
    ? ranked
    : [...ranked].sort((left, right) => right.score - left.score);
  const chosen: Position[] = [];
  for (const entry of ordered) {
    const move = entry.move;
    if (board[move.row]?.[move.col] || !distinct(board, chosen, move)) continue;
    chosen.push(move);
    if (chosen.length >= count) break;
  }
  return chosen;
};

export const suggestFifthCandidates = (board: Cell[][], count: number): Position[] => {
  const center = (board.length - 1) / 2;
  const points: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < board.length; col += 1) {
    if (board[row][col] === null && evaluateRenjuMove(board, { row, col }).legal) points.push({ row, col });
  }
  points.sort((a, b) => Math.hypot(a.row - center, a.col - center) - Math.hypot(b.row - center, b.col - center) || a.row - b.row || a.col - b.col);
  // 与 isDistinctFifthCandidate 同一语义（相对本局局面的对称）：建议点之间也必须互不同形，
  // AI 才能凑满宣布的打点数（否则被守卫逐个拒绝后可能卡在 offer-fifths 阶段凑不齐）。
  const picked: Position[] = [];
  for (const point of points) {
    if (!isDistinctFifthCandidate(board, picked, point)) continue;
    picked.push(point);
    if (picked.length >= count) break;
  }
  return picked;
};

export const openingInstruction = (session: OpeningSession): string => {
  const stage = session.stage;
  if (stage.kind === "normal") return "开局阶段完成，进入正常对局";
  if (stage.kind === "batch") {
    const left = stage.colors.slice(stage.placed);
    const names = left.map((color) => color === "black" ? "黑" : "白").join("、");
    return `Swap2：${stage.actor === "human" ? "请连下" : "AI 将连下"} ${left.length} 子（${names}），位置任意（${stage.placed}/${stage.colors.length}）`;
  }
  if (stage.kind === "taraguchi-fifth") {
    return `${stage.actor === "human" ? "请选择" : "对方将选择"}黑5方式：单点第5手（中心 9×9 内），或摆 10 个第5手打点由白方选一个`;
  }
  if (stage.kind === "swap2-choice") return `${stage.chooser === "human" ? "请选择" : "对方将选择"}：执白／执黑（交换）／再下两颗（白、黑）后由先手选执子颜色`;
  if (stage.kind === "swap2-pick") return `${stage.chooser === "human" ? "请选择" : "对方将选择"}本局执子颜色（黑或白）`;
  if (stage.kind === "place") return `第 ${stage.moveNumber} 手 · ${stage.player === "black" ? "黑" : "白"}方${stage.radius === null ? "可在棋盘任意空位落子" : stage.radius === 0 ? "必须落在天元" : `须落在中心 ${stage.radius * 2 + 1}×${stage.radius * 2 + 1} 区域`}`;
  if (stage.kind === "swap" && (session.rule === "swap1" || session.rule === "swap3")) return `第 ${stage.afterMove} 手后可选择是否交换黑白方`;
  if (stage.kind === "swap") {
    if (stage.taraguchiChoice) return "第4手后：可选择是否交换黑白方";
    if (session.rule === "soosyrv-8" && stage.afterMove === 4) return `白方已宣布 ${session.n} 个第5手打点；执黑方可选择是否交换黑白方`;
    return `第 ${stage.afterMove} 手后可选择是否交换黑白方`;
  }
  if (stage.kind === "choose-fifth-count") {
    if (session.rule === "soosyrv-8") return `${stage.actor === "human" ? "请选择" : "AI 将选择"}第5手打点数量（1–8）；宣布后执黑方可选择是否交换`;
    if (session.rule === "yamaguchi") return `${stage.actor === "human" ? "请宣布" : "AI 将宣布"}本局第5手打点数量（1–15）；宣布后由对方决定是否交换`;
    return `${stage.actor === "human" ? "请选择" : "AI 将选择"}第5手打点数量（3–10）；随后黑方依次放置 A1、A2…`;
  }
  if (stage.kind === "offer-fifths") return `请提供 ${stage.count} 个不同棋形的黑方第5手候选（${session.candidates.length}/${stage.count}）`;
  // choose-fifth 的**选择权在白方**（addFifthCandidate 把 chooser 固定为白）。人类执黑时
  // 白方就是 AI，所以这句话必须按 chooser 分岔——旧写法无条件写「请从 N 个候选中选择…」，
  // 人类执黑时等于**同时**告诉用户「你来选」又让 AI 去选：棋盘这时按 humanCanUseOpeningBoard
  // 本该是禁用的，但文案在邀请点击，用户照做就会与 AI 的 choose-fifth 分支撞车——实测出现
  // 过用户点的第5手被记成第 7 手、AI 自己先占了第 5 手（开局收尾变成 8 子）的坏局面。
  return stage.chooser === "human"
    ? `请从 ${session.candidates.length} 个候选中选择黑方第5手`
    : `白方将在 ${session.candidates.length} 个候选中选择黑方第5手`;
};
