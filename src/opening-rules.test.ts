import { describe, expect, it } from "vitest";
import { emptyBoard } from "./game";
import { addFifthCandidate, chooseFifthCount, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, chooseTaraguchiFifth, isDistinctFifthCandidate, placeBatchStone, rewindOpeningToMove, selectFifthCandidates, swap2Choose, swap2PickSide, openingInstruction, openingPositionAllowed, suggestFifthCandidates } from "./opening-rules";

describe("opening rule state machine", () => {
  it("runs one-hand exchange through a single swap point", () => {
    let session = createOpeningSession("swap1", 0, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 1, chooser: "ai" });
    expect(decideOpeningSwap(session, true)).toMatchObject({ humanPlayer: "white", stage: { kind: "normal" } });
  });

  it("runs three-hand exchange through three unrestricted placements", () => {
    let session = createOpeningSession("swap3", 0, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    expect(decideOpeningSwap(session, false)).toMatchObject({ humanPlayer: "black", stage: { kind: "normal" } });
  });

  it("runs five-move two-offer through swap, offer and choice", () => {
    let session = createOpeningSession("five-two", 2, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "human", radius: 1 });
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    session = decideOpeningSwap(session, false);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white" });
    session = completeOpeningPlacement(session);
    session = addFifthCandidate(session, { row: 6, col: 6 });
    session = addFifthCandidate(session, { row: 6, col: 7 });
    expect(session.stage).toMatchObject({ kind: "choose-fifth", chooser: "ai" });
    expect(completeFifthChoice(session).stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "ai" });
  });

  it("models Taraguchi-10's two steps after move four (swap, then single-vs-offers)", () => {
    // renju.net《Taraguchi》原文：choice 1 / choice 2 的第一条都是「The other player may swap」，
    // 之后才是「black player will put the 5th move」/「black player puts five 5th moves」。
    // 所以是**两步**：先行使交换权，再由此时的黑方选黑5方式。
    let session = createOpeningSession("taraguchi-10", 10, "black");
    for (let move = 1; move <= 3; move += 1) {
      session = completeOpeningPlacement(session);
      session = decideOpeningSwap(session, false);
    }
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 4, taraguchiChoice: true });
    // 第一步：不交换 → 仍由人类（黑）选黑5方式
    const kept = decideOpeningSwap(session, false);
    expect(kept).toMatchObject({ humanPlayer: "black", stage: { kind: "taraguchi-fifth", actor: "human" } });
    // 第一步：交换 → 人类变白，黑5方式归 AI 选（新黑方拿得到选择权，不丢）
    const swapped = decideOpeningSwap(session, true);
    expect(swapped).toMatchObject({ humanPlayer: "white", stage: { kind: "taraguchi-fifth", actor: "ai" } });
    // 第二步：单点 → 第 5 手落在中心 9×9（radius 4）
    expect(chooseTaraguchiFifth(kept, "single")).toMatchObject({ stage: { kind: "place", moveNumber: 5, radius: 4, actor: "human" } });
    // 第二步：打点 → 10 个候选，仍归黑方摆
    expect(chooseTaraguchiFifth(kept, "offers")).toMatchObject({ candidates: [], stage: { kind: "offer-fifths", count: 10, actor: "human" } });
    expect(chooseTaraguchiFifth(swapped, "offers")).toMatchObject({ stage: { kind: "offer-fifths", count: 10, actor: "ai" } });
    // 不在该阶段时这些动作不生效
    expect(chooseTaraguchiFifth(createOpeningSession("yamaguchi", 3, "black"), "offers")).toMatchObject({ stage: { kind: "place", moveNumber: 1 } });
  });

  it("picks fifth-move offers by engine score, not by the engine's raw order", () => {
    // 实测（probe）：我们的引擎多路候选基本按分数降序、但偶尔倒挂（同一局面两次运行头三点都不同），
    // 所以选点必须显式按分数排；开局簿候选（分数缺失或 bookHit）则保持簿内顺序。
    const board = emptyBoard(15);
    board[7][7] = "black"; board[6][7] = "white"; board[7][6] = "black"; board[8][6] = "white";
    const moves = [{ row: 6, col: 5 }, { row: 6, col: 8 }, { row: 9, col: 4 }];
    const scores = [171, 207, 148];
    const picked = selectFifthCandidates(moves, scores, board, 2);
    expect(picked).toEqual([{ row: 6, col: 8 }, { row: 6, col: 5 }]); // 按分数：207 > 171
    // 保持来源顺序（开局簿命中）
    expect(selectFifthCandidates(moves, scores, board, 2, { preserveOrder: true })).toEqual([{ row: 6, col: 5 }, { row: 6, col: 8 }]);
    // 分数缺失（簿路径）同样保持原顺序，不因 NaN 打乱
    expect(selectFifthCandidates(moves, [NaN, NaN, NaN], board, 2)).toEqual([{ row: 6, col: 5 }, { row: 6, col: 8 }]);
    // 已占位/同形的点被跳过（(6,6) 与 (6,8) 在本局面对称规则下不成对，这里用占用点验证过滤）
    const occupied = emptyBoard(15);
    occupied[6][8] = "white";
    expect(selectFifthCandidates(moves, scores, occupied, 2)).toEqual([{ row: 6, col: 5 }, { row: 9, col: 4 }]);
    // 要得比给得多时只返回可用的
    expect(selectFifthCandidates(moves, scores, board, 9)).toHaveLength(3);
  });

  it("enforces center regions", () => {
    const session = createOpeningSession("tarannikov", 0, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, session.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, session.stage)).toBe(false);
  });

  it("can prepare ten non-symmetric legal fifth choices", () => {
    const board = emptyBoard();
    board[7][7] = "black"; board[7][8] = "white"; board[8][7] = "black"; board[6][7] = "white";
    expect(suggestFifthCandidates(board, 10)).toHaveLength(10);
  });

  it("defers five-n count until after move four", () => {
    let session = createOpeningSession("five-n", 8, "white");
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    session = decideOpeningSwap(session, false);
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(session.n).toBe(0);
    session = chooseFifthCount(session, 7);
    // count 由白方（此处 human）宣布，但打点必须交还黑方（ai）——T30：
    // 旧实现把 count 选择方的 actor 继承给了 offer，白=AI 时 AI 代放代选。
    expect(session.stage).toMatchObject({ kind: "offer-fifths", count: 7, actor: "ai" });
    expect(session.n).toBe(7);
  });

  it("five-n: human black offers the dots; AI white counts and strikes (T30)", () => {
    let session = createOpeningSession("five-n", 5, "black");
    for (let step = 0; step < 3; step += 1) session = completeOpeningPlacement(session); // 人类先手摆 1-3
    session = decideOpeningSwap(session, false); // AI（对方）决定不交换
    session = completeOpeningPlacement(session); // 白4 落定
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "ai" }); // 白方宣布数量
    session = chooseFifthCount(session, 3);
    expect(session.stage).toMatchObject({ kind: "offer-fifths", actor: "human", count: 3 }); // 黑方放点（曾被 AI 代劳）
    session = addFifthCandidate(session, { row: 6, col: 6 });
    session = addFifthCandidate(session, { row: 8, col: 8 });
    session = addFifthCandidate(session, { row: 5, col: 9 });
    expect(session.stage).toMatchObject({ kind: "choose-fifth", chooser: "ai" }); // 白方打点
  });

  it("runs Yamaguchi: declare before swap, white 4, black offers, white chooses", () => {
    let session = createOpeningSession("yamaguchi", 2, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "human", radius: 1 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, actor: "human", radius: 2 });
    session = completeOpeningPlacement(session);
    // 宣布发生在交换决定之前（RenjuNet Yamaguchi：先手方摆开局时宣布）。
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(openingInstruction(session)).toContain("1–15");
    expect(chooseFifthCount(session, 0).n).toBe(1);
    expect(chooseFifthCount(session, 99).n).toBe(15); // 上限对齐五林 Const.MaxAlternations = 15
    session = chooseFifthCount(session, 4);
    expect(session.n).toBe(4);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    const swapped = decideOpeningSwap(session, true);
    expect(swapped.humanPlayer).toBe("white");
    expect(swapped.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "human", radius: null });
    let kept = decideOpeningSwap(session, false);
    expect(kept.humanPlayer).toBe("black");
    expect(kept.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "ai", radius: null });
    kept = completeOpeningPlacement(kept);
    expect(kept.stage).toMatchObject({ kind: "offer-fifths", actor: "human", count: 4 });
    for (const [row, col] of [[7, 5], [7, 9], [5, 7], [9, 7]] as const) kept = addFifthCandidate(kept, { row, col });
    expect(kept.stage).toMatchObject({ kind: "choose-fifth", chooser: "ai" });
    const placed6 = completeFifthChoice(kept);
    expect(placed6.stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "ai" });
    expect(completeOpeningPlacement(placed6).stage).toMatchObject({ kind: "normal" });
  });

  it("runs Soosyrv-8: swap after 26 openings, white declares 1-8, swap again, black offers", () => {
    let session = createOpeningSession("soosyrv-8", 8, "white");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "ai", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "ai", radius: 1 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, actor: "ai", radius: 2 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "human" });
    session = decideOpeningSwap(session, false);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(openingInstruction(session)).toContain("1–8");
    expect(chooseFifthCount(session, 0).n).toBe(1);
    expect(chooseFifthCount(session, 9).n).toBe(8);
    session = chooseFifthCount(session, 5);
    expect(session.n).toBe(5);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 4, chooser: "ai" });
    expect(openingInstruction(session)).toContain("5 个第5手打点");
    // 第二交换点被执行时，黑方角色易主，由新的黑方放置候选。
    const swapped = decideOpeningSwap(session, true);
    expect(swapped.humanPlayer).toBe("black");
    expect(swapped.stage).toMatchObject({ kind: "offer-fifths", actor: "human", count: 5 });
    // 不交换：AI（执黑）放置候选，白方（人类）选择。
    let kept = decideOpeningSwap(session, false);
    expect(kept.humanPlayer).toBe("white");
    expect(kept.stage).toMatchObject({ kind: "offer-fifths", actor: "ai", count: 5 });
    for (const [row, col] of [[7, 6], [7, 8], [6, 7], [8, 7], [6, 6]] as const) kept = addFifthCandidate(kept, { row, col });
    expect(kept.stage).toMatchObject({ kind: "choose-fifth", chooser: "human" });
    const placed6 = completeFifthChoice(kept);
    expect(placed6.stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "human" });
    expect(completeOpeningPlacement(placed6).stage).toMatchObject({ kind: "normal" });
  });

  it("keeps the fifth offer symmetric-dedup and center regions for the new rules", () => {
    const board = emptyBoard();
    board[7][7] = "black"; board[7][8] = "white"; board[8][7] = "black"; board[6][7] = "white";
    expect(suggestFifthCandidates(board, 5)).toHaveLength(5);
    const yamaguchi = createOpeningSession("yamaguchi", 2, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, yamaguchi.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, yamaguchi.stage)).toBe(false);
    const soosyrv = createOpeningSession("soosyrv-8", 8, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, soosyrv.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, soosyrv.stage)).toBe(false);
  });
});

describe("fifth-candidate symmetry dedup", () => {
  const boardOf = (black: [number, number][], white: [number, number][]) => {
    const board = emptyBoard(15);
    black.forEach(([row, col]) => { board[row][col] = "black"; });
    white.forEach(([row, col]) => { board[row][col] = "white"; });
    return board;
  };

  // 判定语义（2026-09-16 定案，对齐 五林五子棋 客户端实现，见 opening-rules.ts 顶部注释）：
  // 「同形」= 存在某个平面等距变换把**当前局面连同其中一个打点**映成另一个打点，也就是
  // 白方在这两点间选择会得到完全一样的局面。因此判据与**局面自身有没有对称**强绑定：
  //  · 局面不对称（绝大多数实战局面）→ 任何两个打点都不同形，只挡重复点；
  //  · 局面关于某条轴/某个点对称 → 被该对称互相映射的那一对打点才是同形。
  it("局面自身中心对称时，互为对称像的两个打点被拒（用户 09-16 手机实测那一局）", () => {
    // 截图逐像素量出的真实局面：黑1 天元(7,7)、白2(6,7)、黑3(7,6)、白4(8,6)。
    // 黑1↔黑3 的中点与白2↔白4 的中点重合于 (6.5,7) ⇒ 本局局面关于 (6.5,7) 中心对称。
    const userBoard = boardOf([[7, 7], [7, 6]], [[6, 7], [8, 6]]);
    // 用户报的那一对：都在行 7 上，(7,5) 与 (7,8) 关于 (6.5,7) 中心对称 → 第二个必须被拒。
    expect(isDistinctFifthCandidate(userBoard, [{ row: 7, col: 5 }], { row: 7, col: 8 })).toBe(false);
    expect(isDistinctFifthCandidate(userBoard, [{ row: 7, col: 8 }], { row: 7, col: 5 })).toBe(false);
    // 对称像 = (row, col) → (14-row, 13-col)
    expect(isDistinctFifthCandidate(userBoard, [{ row: 6, col: 4 }], { row: 8, col: 9 })).toBe(false);
    expect(isDistinctFifthCandidate(userBoard, [{ row: 9, col: 6 }], { row: 5, col: 7 })).toBe(false);
    // ★ 与局面无关的点必须放行 —— 这一档正是用户报的「右边一堆点都打不了」。
    //   这些点与任何打点都不成对称像，旧口径（关于天元）会误拦它们。
    for (const point of [{ row: 6, col: 8 }, { row: 6, col: 9 }, { row: 8, col: 4 }, { row: 8, col: 5 }, { row: 7, col: 9 }, { row: 10, col: 10 }]) {
      expect(isDistinctFifthCandidate(userBoard, [{ row: 6, col: 4 }, { row: 9, col: 6 }], point), `${point.row},${point.col}`).toBe(true);
    }
    // 同一个点（重复）仍然拒绝
    expect(isDistinctFifthCandidate(userBoard, [{ row: 7, col: 7 }], { row: 7, col: 7 })).toBe(false);
  });

  it("局面自身不对称时，只挡重复点（与天元无关）", () => {
    // 用户上一轮报的那一局（黑1(7,7) 白2(6,8) 黑3(5,6) 白4(6,7)）：四子两两不关于任何轴/中心
    // 对称 ⇒ 稳定子群平凡 ⇒ 任何两个打点给出的局面都真的不同形。五林客户端在此局面下同样
    // 全部放行（`posRelation` 对两对棋子都返回空关系，`canPutAlternativeBoard` 直接 return 1）。
    const board = boardOf([[7, 7], [5, 6]], [[6, 8], [6, 7]]);
    for (const point of [{ row: 8, col: 6 }, { row: 6, col: 8 }, { row: 8, col: 8 }]) {
      expect(isDistinctFifthCandidate(board, [{ row: 6, col: 6 }], point), `${point.row},${point.col}`).toBe(true);
    }
    expect(isDistinctFifthCandidate(board, [{ row: 6, col: 6 }], { row: 6, col: 6 })).toBe(false);
  });

  it("局面轴对称时，关于该轴互为镜像的打点被拒", () => {
    // 黑1(7,7)、黑3(7,8) 与 白2(6,7)、白4(6,8) 都关于**列 6.5↔7.5 的正中竖轴**镜像
    // （(row,col) → (row, 15-col)）⇒ 该竖轴是局面的对称轴。
    const board = boardOf([[7, 7], [7, 8]], [[6, 7], [6, 8]]);
    expect(isDistinctFifthCandidate(board, [{ row: 6, col: 5 }], { row: 6, col: 10 })).toBe(false);
    expect(isDistinctFifthCandidate(board, [{ row: 9, col: 4 }], { row: 9, col: 11 })).toBe(false);
    // 关于该轴的镜像必须是 (row, 15-col)；(6,8) 不是 (6,5) 的镜像 → 放行
    expect(isDistinctFifthCandidate(board, [{ row: 6, col: 5 }], { row: 6, col: 8 })).toBe(true);
  });

  it("对称像的判定只看局面棋子，不被打点自己改变", () => {
    // 打点不进盘面（另有草稿叠加通道），所以已摆打点不会改变局面的对称群；
    // 这里显式确认「同一个目标点、不同候选列表」得到同一结论。
    const board = boardOf([[7, 7], [7, 6]], [[6, 7], [8, 6]]);
    expect(isDistinctFifthCandidate(board, [{ row: 6, col: 4 }], { row: 7, col: 8 }))
      .toBe(isDistinctFifthCandidate(board, [{ row: 6, col: 4 }, { row: 9, col: 6 }], { row: 7, col: 8 }));
    expect(isDistinctFifthCandidate(board, [{ row: 6, col: 4 }], { row: 7, col: 5 })).toBe(true);
  });

  it("keeps every suggested offer pairwise non-symmetric so AI can fill the declared count", () => {
    const board = boardOf([[7, 7], [8, 7]], [[7, 8], [6, 7]]);
    const picks = suggestFifthCandidates(board, 10);
    expect(picks).toHaveLength(10);
    for (let i = 0; i < picks.length; i += 1) {
      for (let j = i + 1; j < picks.length; j += 1) {
        expect(isDistinctFifthCandidate(board, [picks[i]], picks[j])).toBe(true);
      }
    }
  });
});

/**
 * 悔棋必须把开局状态机一起倒回（用户 2026-10-09 报的 bug）。
 *
 * 用户原话：「我在五手两打规则，在摆出选点然后选择了一个后，我再去悔棋几步，竟然会回到
 * 前面的局面不说，还可以布置打点，这不是在第五手的时候打点，而是在第三手，第二手的时候打点」。
 *
 * 下面这组断言直接钉住「盘面手数 ↔ 状态机阶段」的一致性：不论退到几颗子，
 * 状态机给出的阶段都必须是**那一步该做的事**。
 */
describe("rewindOpeningToMove（悔棋回退开局状态机）", () => {
  /** 走到某个手数的**正常对局路径**（交换都选不交换、打点都用占位点填满再选），得到该手数下的阶段。 */
  const advance = (rule: Parameters<typeof createOpeningSession>[0], target: number, humanPlayer: "black" | "white" = "black") => {
    let session = createOpeningSession(rule, 2, humanPlayer);
    let placed = 0;
    for (let guard = 0; guard < 32 && placed < target; guard += 1) {
      const stage = session.stage;
      if (stage.kind === "place") { session = completeOpeningPlacement(session); placed += 1; continue; }
      if (stage.kind === "swap") { session = decideOpeningSwap(session, false); continue; }
      if (stage.kind === "choose-fifth-count") { session = chooseFifthCount(session, 2); continue; }
      if (stage.kind === "taraguchi-fifth") { session = chooseTaraguchiFifth(session, "single"); continue; }
      if (stage.kind === "offer-fifths") {
        let filled = session;
        for (let index = 0; index < stage.count; index += 1) filled = addFifthCandidate(filled, { row: 0, col: index });
        session = filled;
        continue;
      }
      if (stage.kind === "choose-fifth") { session = completeFifthChoice(session); continue; }
      break;
    }
    return session;
  };

  it("五手两打：退到第 2 手后不再是打点阶段（bug 的原场景）", () => {
    // 先推进到「已选完第5手打点、进入正常对局」的那一刻（用户当时所处的状态）
    let session = advance("five-two", 6);
    expect(session.stage.kind).toBe("normal");

    // 关键：退到盘上只剩 2 颗子 —— 必须是「该下第 3 手」，绝不能还是打点阶段
    const back2 = rewindOpeningToMove(session, 2);
    expect(back2.stage).toMatchObject({ kind: "place", moveNumber: 3, player: "black" });
    // 打点候选必须被清掉——否则界面上仍会显示旧打点
    expect(back2.candidates).toEqual([]);

    // 退到只有 1 颗子
    const back1 = rewindOpeningToMove(session, 1);
    expect(back1.stage).toMatchObject({ kind: "place", moveNumber: 2, player: "white" });

    // 退到 3 颗子：这时是"第3手已下、该决定是否交换"，而不是打点
    const back3 = rewindOpeningToMove(session, 3);
    expect(back3.stage).toMatchObject({ kind: "swap", afterMove: 3 });
    expect(back3.stage.kind).not.toBe("offer-fifths");
    expect(back3.stage.kind).not.toBe("choose-fifth");
  });

  it("五手两打：4 颗子该由黑方提供第5手打点、5 颗子该放第 6 手", () => {
    const at6 = advance("five-two", 6);
    // 五手两打的定义就是"黑方提供第5手候选、白方选一个"——所以盘上 4 颗子时
    // 停在 offer-fifths 是**正确**的（那正是该打点的时刻）。
    expect(rewindOpeningToMove(at6, 4).stage).toMatchObject({ kind: "offer-fifths" });
    // 第 5 手已落在盘上（5 颗子）→ 该轮到白方第 6 手
    expect(rewindOpeningToMove(at6, 5).stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white" });
  });

  it("任何手数下都不会停在「打点/选打点」阶段（除非真的到了那一步）", () => {
    const at6 = advance("five-two", 6);
    // 1–3 颗子必须是落子/决策阶段；4 颗子正确停在 offer-fifths（第4手已下，该黑方提供第5手候选），
    // 但那**不是**"在第二手/第三手打点"——候选必须已清空，且阶段与手数对得上。
    for (const stones of [0, 1, 2, 3]) {
      const rewound = rewindOpeningToMove(at6, stones);
      expect(["place", "swap"], `盘上 ${stones} 颗子时阶段是 ${rewound.stage.kind}`).toContain(rewound.stage.kind);
      expect(rewound.candidates).toEqual([]);
    }
    // 4 颗子：停在 offer-fifths 是对的（这正是该打点的时刻），且带子数与阶段自洽
    const at4 = rewindOpeningToMove(at6, 4);
    expect(at4.stage.kind).toBe("offer-fifths");
    expect(at4.candidates).toEqual([]);
    // 8 颗子（对局已进入正常阶段）：重放必须走完开局，不能返回一个"第4手才该出现"的阶段
    const at8 = rewindOpeningToMove(at6, 8);
    expect(at8.stage.kind).toBe("normal");
  });

  it("回到 0 颗子 = 重新开局（第 1 手必须落在天元）", () => {
    const at6 = advance("five-two", 6);
    const zero = rewindOpeningToMove(at6, 0);
    expect(zero.stage).toMatchObject({ kind: "place", moveNumber: 1, player: "black", radius: 0 });
  });

  it("交换过的对局：退回去后人类执子不变（不能莫名其妙换边）", () => {
    let session = createOpeningSession("swap3", 0, "black");
    session = completeOpeningPlacement(session); // 第1手
    session = completeOpeningPlacement(session); // 第2手
    session = completeOpeningPlacement(session); // 第3手
    session = decideOpeningSwap(session, true);  // 选择交换 → 人类执白
    expect(session.humanPlayer).toBe("white");
    const rewound = rewindOpeningToMove(session, 2);
    expect(rewound.humanPlayer).toBe("white");
    expect(rewound.stage).toMatchObject({ kind: "place" });
  });

  it("三手交换：退到第 3 手后重新给出交换决策点", () => {
    const at3 = advance("swap3", 3);
    const rewound = rewindOpeningToMove(at3, 3);
    expect(rewound.stage).toMatchObject({ kind: "swap", afterMove: 3 });
  });

  it("索索夫-8：退到第 3 手回到交换点，退到第 4 手回到选打点数", () => {
    const at6 = advance("soosyrv-8", 6);
    expect(rewindOpeningToMove(at6, 3).stage).toMatchObject({ kind: "swap", afterMove: 3 });
    expect(rewindOpeningToMove(at6, 4).stage).toMatchObject({ kind: "choose-fifth-count" });
  });

  it("塔拉山口-10：退到第 5 手仍能把落子补回（不能被摆打点卡住）", () => {
    const at6 = advance("taraguchi-10", 6);
    const back5 = rewindOpeningToMove(at6, 5);
    // 第 5 手已经落在盘上，所以状态机必须已经过了"黑5方式"这一决策
    expect(["swap", "place", "normal"]).toContain(back5.stage.kind);
    expect(back5.stage.kind).not.toBe("taraguchi-fifth");
    expect(back5.stage.kind).not.toBe("offer-fifths");
  });

  it("Swap2（批量落子）：退回时不保留旧候选，状态机不动（无法从手数反推）", () => {
    const session = createOpeningSession("swap2", 0, "black");
    const rewound = rewindOpeningToMove(session, 2);
    expect(rewound.candidates).toEqual([]);
    expect(rewound.stage).toEqual(session.stage);
  });

  it("自由开局：退回去仍是正常对局（不产生任何开局阶段）", () => {
    const free = createOpeningSession("free", 0, "black");
    expect(rewindOpeningToMove(free, 2).stage).toEqual({ kind: "normal" });
    expect(rewindOpeningToMove(free, 0).stage).toEqual({ kind: "normal" });
  });

  it("多余/异常入参不受影响（负数、超过总手数都不会崩）", () => {
    const at6 = advance("five-two", 6);
    expect(() => rewindOpeningToMove(at6, -3)).not.toThrow();
    expect(() => rewindOpeningToMove(at6, 99)).not.toThrow();
    expect(rewindOpeningToMove(at6, 99).stage.kind).toBe("normal");
  });
});

