// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMoveComment,
  buildReviewCurve,
  buildReviewEntries,
  buildReviewSummary,
  buildWinrateSeries,
  gradeForLoss,
  loadStoredGameReview,
  moverLossPercent,
  moverWinRate,
  openingProcedureLastMove,
  removeStoredGameReview,
  REVIEW_THRESHOLDS,
  saveStoredGameReview,
  type ReviewSample,
} from "./game-review";

const sample = (over: Partial<ReviewSample> & Pick<ReviewSample, "nodeId" | "mover">): ReviewSample => ({ ...over });
const fmt = ({ row, col }: { row: number; col: number }) => `${String.fromCharCode(65 + col)}${15 - row}`;

describe("review grading", () => {
  it("computes mover-perspective loss from black-perspective win rates", () => {
    expect(moverLossPercent(sample({ nodeId: "a", mover: "black", blackWinRate: 60 }), sample({ nodeId: "b", mover: "white", blackWinRate: 40 }))).toBeCloseTo(20);
    expect(moverLossPercent(sample({ nodeId: "a", mover: "white", blackWinRate: 40 }), sample({ nodeId: "b", mover: "black", blackWinRate: 70 }))).toBeCloseTo(30);
    expect(moverLossPercent(sample({ nodeId: "a", mover: "black", blackWinRate: 50 }), sample({ nodeId: "b", mover: "white" }))).toBeUndefined();
  });

  it("converts black-perspective rates to mover perspective", () => {
    expect(moverWinRate({ mover: "black", blackWinRate: 70 })).toBe(70);
    expect(moverWinRate({ mover: "white", blackWinRate: 70 })).toBe(30);
  });

  it("applies the documented thresholds", () => {
    expect(gradeForLoss(0, false)).toBe("best");
    expect(gradeForLoss(REVIEW_THRESHOLDS.inaccuracy, false)).toBe("best");
    expect(gradeForLoss(REVIEW_THRESHOLDS.inaccuracy + 0.1, false)).toBe("inaccuracy");
    expect(gradeForLoss(REVIEW_THRESHOLDS.mistake + 0.1, false)).toBe("mistake");
    expect(gradeForLoss(REVIEW_THRESHOLDS.blunder + 0.1, false)).toBe("blunder");
    expect(gradeForLoss(undefined, false)).toBeUndefined();
  });

  it("flags a proven win thrown away as missedWin", () => {
    expect(gradeForLoss(30, true)).toBe("missedWin");
    // 小损失仍按普通档位——只是微亏不算「错失必胜」。
    expect(gradeForLoss(1, true)).toBe("best");
  });
});

describe("buildReviewEntries", () => {
  it("grades every move along the mainline and terminates at the game result", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black", blackWinRate: 50, best: { row: 7, col: 7 } }),
      sample({ nodeId: "n1", mover: "white", blackWinRate: 55, best: { row: 7, col: 8 } }),
      sample({ nodeId: "n2", mover: "black", blackWinRate: 65, best: { row: 8, col: 8 } }),
      sample({ nodeId: "n3", mover: "white", blackWinRate: 5 }),
    ];
    const entries = buildReviewEntries(samples, [
      { nodeId: "n1", move: { row: 7, col: 7 } },
      { nodeId: "n2", move: { row: 3, col: 3 } },
      { nodeId: "n3", move: { row: 10, col: 10 } },
    ]);
    expect(entries).toHaveLength(3);
    // 黑落最佳点，胜率 50→55（黑涨=黑好）→ best。
    expect(entries[0].grade).toBe("best");
    expect(entries[0].lossForMover).toBe(0);
    // 白在黑方胜率 55 时走 K4（非推荐 J9），之后黑涨到 65：白损失 10 → 失误。
    expect(entries[1].grade).toBe("mistake");
    expect(entries[1].lossForMover).toBeCloseTo(10);
    // 黑 65→5：损失 60 → 败着。
    expect(entries[2].grade).toBe("blunder");
    expect(entries[2].lossForMover).toBeCloseTo(60);
  });

  it("marks the engine best move as best even when noise reports a small loss", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black", blackWinRate: 60, best: { row: 7, col: 7 } }),
      sample({ nodeId: "n1", mover: "white", blackWinRate: 57 }),
    ];
    const entries = buildReviewEntries(samples, [{ nodeId: "n1", move: { row: 7, col: 7 } }]);
    expect(entries[0].grade).toBe("best");
  });

  it("flags missing a proven win", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black", blackWinRate: 100, best: { row: 7, col: 7 }, provenWinForMover: true }),
      sample({ nodeId: "n1", mover: "white", blackWinRate: 40 }),
    ];
    const entries = buildReviewEntries(samples, [{ nodeId: "n1", move: { row: 3, col: 3 } }]);
    expect(entries[0].grade).toBe("missedWin");
  });

  it("skips pairs without evaluations and keeps grading the rest (真引擎空盘秒答会缺样本 0)", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black" }), // 空盘：引擎秒答，没有 winRate
      sample({ nodeId: "n1", mover: "white", blackWinRate: 55, best: { row: 7, col: 8 } }),
      sample({ nodeId: "n2", mover: "black", blackWinRate: 65, best: { row: 8, col: 8 } }),
    ];
    const entries = buildReviewEntries(samples, [
      { nodeId: "n1", move: { row: 7, col: 7 } },
      { nodeId: "n2", move: { row: 3, col: 3 } },
    ]);
    // 第 1 手缺前样本跳过；第 2 手照评：白在黑 55 时错着，黑涨到 65 → 失误。
    expect(entries).toHaveLength(1);
    expect(entries[0].moveNumber).toBe(2);
    expect(entries[0].grade).toBe("mistake");
  });

  it("skips a mid-line hole and resumes grading after it", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black", blackWinRate: 50, best: { row: 7, col: 7 } }),
      sample({ nodeId: "n1", mover: "white" }), // 中途缺样本
      sample({ nodeId: "n2", mover: "black", blackWinRate: 40, best: { row: 8, col: 8 } }),
      sample({ nodeId: "n3", mover: "white", blackWinRate: 10 }),
    ];
    const entries = buildReviewEntries(samples, [
      { nodeId: "n1", move: { row: 7, col: 7 } },
      { nodeId: "n2", move: { row: 3, col: 3 } },
      { nodeId: "n3", move: { row: 9, col: 9 } },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].moveNumber).toBe(3);
    expect(entries[0].grade).toBe("blunder");
  });
});

describe("buildWinrateSeries", () => {
  it("prefers review samples and fills the rest from the analysis cache", () => {
    const series = buildWinrateSeries(
      [{ nodeId: "n0" }, { nodeId: "n1" }, { nodeId: "n2" }],
      [
        sample({ nodeId: "n0", mover: "black", blackWinRate: 50 }),
        sample({ nodeId: "n1", mover: "white" }), // 复盘里这一手缺胜率
      ],
      { n1: 62 },
    );
    expect(series[0]).toEqual({ moveNumber: 0, blackWinRate: 50, source: "review" });
    expect(series[1]).toEqual({ moveNumber: 1, blackWinRate: 62, source: "cache" });
    expect(series[2]).toEqual({ moveNumber: 2, source: "none" });
  });

  it("works with no review data at all (常态积累)", () => {
    const series = buildWinrateSeries([{ nodeId: "a" }, { nodeId: "b" }], undefined, { a: 50 });
    expect(series[0].source).toBe("cache");
    expect(series[1].source).toBe("none");
  });
});

describe("curve and summary", () => {
  it("keeps only evaluated points on the curve, tolerating null holes", () => {
    const curve = buildReviewCurve([
      sample({ nodeId: "n0", mover: "black", blackWinRate: 50 }),
      null as unknown as ReviewSample, // 停止过的复盘落库后洞会变 null
      sample({ nodeId: "n2", mover: "black", blackWinRate: 30 }),
    ]);
    expect(curve).toEqual([{ moveNumber: 0, blackWinRate: 50 }, { moveNumber: 2, blackWinRate: 30 }]);
  });

  it("writes a Chinese comment naming move, grade and engine alternative", () => {
    const text = buildMoveComment({
      nodeId: "n2", moveNumber: 12, mover: "white", played: { row: 3, col: 3 }, best: { row: 7, col: 8 },
      blackWinRateBefore: 55, blackWinRateAfter: 40, lossForMover: 10, grade: "mistake",
    }, fmt);
    expect(text).toContain("第 12 手 白 D12");
    expect(text).toContain("失误");
    expect(text).toContain("45% → 60%"); // 白方视角：100-55 → 100-40
    expect(text).toContain("引擎推荐 I8");
  });

  it("summarizes counts and the worst three moves", () => {
    const samples: ReviewSample[] = [
      sample({ nodeId: "n0", mover: "black", blackWinRate: 50, best: { row: 7, col: 7 } }),
      sample({ nodeId: "n1", mover: "white", blackWinRate: 48, best: { row: 7, col: 8 } }),
      sample({ nodeId: "n2", mover: "black", blackWinRate: 58, best: { row: 8, col: 8 } }),
      sample({ nodeId: "n3", mover: "white", blackWinRate: 2 }),
    ];
    const entries = buildReviewEntries(samples, [
      { nodeId: "n1", move: { row: 7, col: 7 } },
      { nodeId: "n2", move: { row: 3, col: 3 } },
      { nodeId: "n3", move: { row: 9, col: 9 } },
    ]);
    const summary = buildReviewSummary(entries, { formatCoordinate: fmt, totalMoves: 3 });
    expect(summary.counts.best).toBe(1);
    expect(summary.counts.mistake).toBe(1);
    expect(summary.counts.blunder).toBe(1);
    expect(summary.worst[0].moveNumber).toBe(3);
    expect(summary.worst).toHaveLength(2);
    expect(summary.text).toContain("本局共 3 手");
  });
});

describe("开局流程不按普通失误判级（用户 09-19）", () => {
  const played = [{ nodeId: "n1", move: { row: 7, col: 7 } }, { nodeId: "n2", move: { row: 7, col: 8 } }, { nodeId: "n3", move: { row: 8, col: 8 } }];
  // 第 1 手黑方胜率 90 → 第 2 手前掉到 40：普通局面下这是「败着」，但在打点规则里
  // 这一手是「白方从黑方摆的候选里挑走了一个」，记成黑方失误就是偏颇。
  const samples: ReviewSample[] = [
    // 第 1 手实际落 H8，但引擎首选在别处（打点规则里那个首选可能压根不在候选集内）——
    // 这正是用户说的「从必胜被制约到平衡」：落子前后胜率大掉，但决策权不在落子方手里。
    { nodeId: "root", mover: "black", blackWinRate: 90, best: { row: 6, col: 6 } },
    { nodeId: "n1", mover: "white", blackWinRate: 40, best: { row: 7, col: 8 } },
    { nodeId: "n2", mover: "black", blackWinRate: 40, best: { row: 8, col: 8 } },
    { nodeId: "n3", mover: "white", blackWinRate: 40 },
  ];

  it("打点类规则的开局段标「开局流程」而不是失误/败着", () => {
    const graded = buildReviewEntries(samples, played, { openingLastMove: 5 });
    expect(graded[0].grade).toBe("opening");
    expect(graded[0].lossForMover).toBeGreaterThan(REVIEW_THRESHOLDS.blunder);
  });

  it("同一份样本，无开局流程时仍判「败着」——是区别对待，不是一律放过", () => {
    expect(buildReviewEntries(samples, played, { openingLastMove: 0 })[0].grade).toBe("blunder");
  });

  it("开局段里落了引擎首选仍算「最佳」（合法点就是首选，那是真信息）", () => {
    expect(buildReviewEntries(samples, played, { openingLastMove: 5 })[1].grade).toBe("best");
  });

  it("规则表：落点受约束的打点类=5 手，自由/交换类不受约束=0", () => {
    expect(openingProcedureLastMove("yamaguchi")).toBe(5);
    expect(openingProcedureLastMove("soosyrv-8")).toBe(5);
    expect(openingProcedureLastMove("taraguchi-10")).toBe(5);
    expect(openingProcedureLastMove("five-two")).toBe(5);
    expect(openingProcedureLastMove("tarannikov")).toBe(5);
    expect(openingProcedureLastMove("free")).toBe(0);
    expect(openingProcedureLastMove("swap3")).toBe(0);
    expect(openingProcedureLastMove(undefined)).toBe(0);
  });

  it("汇总：开局流程单独计数、不计入最差手，并说明为什么不判失误", () => {
    const entries = buildReviewEntries(samples, played, { openingLastMove: 5 });
    const summary = buildReviewSummary(entries, { formatCoordinate: fmt, totalMoves: 3, openingLastMove: 5, openingRuleLabel: "五手多打（山口）" });
    expect(summary.counts.opening).toBeGreaterThan(0);
    expect(summary.counts.blunder + summary.counts.mistake).toBe(0);
    expect(summary.worst).toEqual([]);
    expect(summary.text).toContain("开局流程");
    expect(summary.text).toContain("五手多打（山口）");
  });

  it("讲解词：开局流程不报「引擎推荐」（那个点可能不在规则允许的候选里）", () => {
    const comment = buildMoveComment(buildReviewEntries(samples, played, { openingLastMove: 5 })[0], fmt);
    expect(comment).toContain("开局流程");
    expect(comment).not.toContain("引擎推荐");
  });
});

describe("stored reviews", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips, evicts beyond 8 documents and removes cleanly", () => {
    for (let index = 0; index < 10; index += 1) {
      saveStoredGameReview(`doc-${index}`, { ts: index, totalMoves: index, samples: [], entries: [] });
    }
    expect(loadStoredGameReview("doc-0")).toBeNull();
    expect(loadStoredGameReview("doc-9")?.ts).toBe(9);
    removeStoredGameReview("doc-9");
    expect(loadStoredGameReview("doc-9")).toBeNull();
  });

  it("ignores corrupted storage", () => {
    localStorage.setItem("banbu-game-review-v2", "{{");
    expect(loadStoredGameReview("doc")).toBeNull();
  });
});
