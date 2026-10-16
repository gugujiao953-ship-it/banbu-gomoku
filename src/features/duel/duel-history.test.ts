// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DUEL_HISTORY_KEY,
  ENGINE_LABELS,
  PROVISIONAL_GAMES,
  RATING_START,
  STRENGTH_ANCHORS,
  TIER_EXPECTED_WIN,
  TIER_GAP,
  ratingGapFromWinRate,
  appendDuelHistory,
  clearDuelHistory,
  computeRatingTrack,
  expectedScore,
  formatWinRate,
  kFactor,
  loadDuelHistory,
  opponentRating,
  ratingBandLabel,
  ratingUncertainty,
  summarizeDuelHistory,
  shouldRecordDuel,
  type DuelHistoryEntry,
  type DuelOutcome,
} from "./duel-history";

const entry = (over: Partial<DuelHistoryEntry> & { id: string }): DuelHistoryEntry => ({
  at: 1_700_000_000_000,
  outcome: "won",
  reason: "你连成五子",
  humanPlayer: "black",
  strength: "高级",
  engine: "strong",
  timeLimitMs: 0,
  thinkTimeMs: 5000,
  thinkDepth: 64,
  moves: 31,
  humanElapsedMs: 90_000,
  forbidden: true,
  ...over,
});

beforeEach(() => { localStorage.clear(); });

describe("战绩存档", () => {
  it("空档与坏数据都读成空数组，不炸", () => {
    expect(loadDuelHistory()).toEqual([]);
    localStorage.setItem(DUEL_HISTORY_KEY, "不是 JSON");
    expect(loadDuelHistory()).toEqual([]);
    localStorage.setItem(DUEL_HISTORY_KEY, JSON.stringify({ version: 1, entries: "乱" }));
    expect(loadDuelHistory()).toEqual([]);
  });

  it("逐条校验：认不出的条目丢掉，合法的留下（不因一条坏数据清掉整本账）", () => {
    localStorage.setItem(DUEL_HISTORY_KEY, JSON.stringify({
      version: 1,
      entries: [entry({ id: "a" }), { id: "b", outcome: "逃跑" }, { outcome: "won" }, { ...entry({ id: "c" }), strength: "天王" }],
    }));
    expect(loadDuelHistory().map((item) => item.id)).toEqual(["a"]);
  });

  it("同 id 只留最后一条：终局→刷新→恢复 这条链不能把一局算两次", () => {
    localStorage.setItem(DUEL_HISTORY_KEY, JSON.stringify({ version: 1, entries: [entry({ id: "x", outcome: "won" }), entry({ id: "x", outcome: "lost" })] }));
    const list = loadDuelHistory();
    expect(list).toHaveLength(1);
    expect(list[0].outcome).toBe("lost");
  });

  it("追加写：按时间留在尾部，超上限丢最旧的", () => {
    for (let i = 0; i < 3; i += 1) expect(appendDuelHistory(entry({ id: `g${i}`, at: 1_700_000_000_000 + i }))).toBe(true);
    const list = loadDuelHistory();
    expect(list.map((item) => item.id)).toEqual(["g0", "g1", "g2"]);
  });

  it("引擎档不认识时回落 strong，不写乱码进表", () => {
    localStorage.setItem(DUEL_HISTORY_KEY, JSON.stringify({ version: 1, entries: [{ ...entry({ id: "e" }), engine: "量子引擎" }] }));
    expect(loadDuelHistory()[0].engine).toBe("strong");
  });

  // ── 自定义开局整段不进账（用户 2026-10-13：「这个模式是没有棋魂奖励的」）────────────
  it("自定义开局那一局不记账：跳过的是整段结算，不是只跳过发棋魂", () => {
    expect(shouldRecordDuel({ customOpening: true })).toBe(false);
    expect(shouldRecordDuel({ customOpening: false })).toBe(true);
    // 按规则开局没有这个键 → 照旧记账
    expect(shouldRecordDuel({})).toBe(true);
  });
});

describe("等级分", () => {
  it("锚点单调递增，且**原点就是初级 AI = 新档案起始分**（不再假定新手能打中级）", () => {
    expect(STRENGTH_ANCHORS.初级).toBeLessThan(STRENGTH_ANCHORS.中级);
    expect(STRENGTH_ANCHORS.中级).toBeLessThan(STRENGTH_ANCHORS.高级);
    expect(STRENGTH_ANCHORS.高级).toBeLessThan(STRENGTH_ANCHORS.大师);
    expect(RATING_START).toBe(STRENGTH_ANCHORS.初级);
  });

  it("档间距是从「高一档 ≈80% 期望胜率」推出来的，不是拍的整数", () => {
    // 400·log10(0.8/0.2) = 241 → 取整 240；锚点必须正好是它的整数倍。
    expect(ratingGapFromWinRate(0.5)).toBe(0);
    expect(ratingGapFromWinRate(TIER_EXPECTED_WIN)).toBe(241);
    expect(TIER_GAP).toBe(240);
    expect(STRENGTH_ANCHORS.大师 - STRENGTH_ANCHORS.初级).toBe(TIER_GAP * 3);
    // 反查：+240 分对应的期望胜率确实约 80%
    expect(expectedScore(1240, 1000)).toBeGreaterThan(0.79);
    expect(expectedScore(1240, 1000)).toBeLessThan(0.81);
  });

  it("「自由」档按思考时间对数插值，两端夹住", () => {
    expect(opponentRating({ strength: "自由", thinkTimeMs: 600 })).toBe(STRENGTH_ANCHORS.初级);
    expect(opponentRating({ strength: "自由", thinkTimeMs: 10000 })).toBe(STRENGTH_ANCHORS.大师);
    expect(opponentRating({ strength: "自由", thinkTimeMs: 1_000_000 })).toBe(STRENGTH_ANCHORS.大师);
    expect(opponentRating({ strength: "自由", thinkTimeMs: 0 })).toBe(STRENGTH_ANCHORS.初级);
    const mid = opponentRating({ strength: "自由", thinkTimeMs: 2000 });
    expect(mid).toBe(STRENGTH_ANCHORS.中级);
    // 对数插值：2.5s 落在 2s~5s 之间、且更靠近 2s 一侧
    expect(opponentRating({ strength: "自由", thinkTimeMs: 2500 })).toBeGreaterThan(mid);
    expect(opponentRating({ strength: "自由", thinkTimeMs: 2500 })).toBeLessThan(STRENGTH_ANCHORS.高级);
  });

  it("同分期望胜率 0.5，高档对手则低于 0.5", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1500, 2000)).toBeLessThan(0.12);
    expect(expectedScore(2000, 1500)).toBeGreaterThan(0.88);
  });

  it("K 值在前 20 局是 40、之后 24", () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(19)).toBe(40);
    expect(kFactor(20)).toBe(24);
  });

  it("全赢必涨、全输必跌，且涨的幅度随分差收窄（打赢同级比打赢低档涨得多）", () => {
    const wins = computeRatingTrack(Array.from({ length: 8 }, (_, i) => entry({ id: `w${i}`, outcome: "won", strength: "高级" })));
    expect(wins[wins.length - 1].rating).toBeGreaterThan(RATING_START);
    expect(wins.every((point) => point.delta > 0)).toBe(true);
    const losses = computeRatingTrack(Array.from({ length: 8 }, (_, i) => entry({ id: `l${i}`, outcome: "lost", strength: "高级" })));
    expect(losses[losses.length - 1].rating).toBeLessThan(RATING_START);
    const easy = computeRatingTrack([entry({ id: "e1", outcome: "won", strength: "初级" })])[0].delta;
    const hard = computeRatingTrack([entry({ id: "h1", outcome: "won", strength: "大师" })])[0].delta;
    expect(hard).toBeGreaterThan(easy);
  });

  it("和局按 0.5 算：与同档 AI 和棋，分数不动", () => {
    const draw = computeRatingTrack([entry({ id: "d", outcome: "draw", strength: "初级" })])[0];
    expect(draw.rating).toBe(RATING_START);
    expect(draw.delta).toBe(0);
  });

  it("样本不足时给区间而不是假精确：不确定度随场次收窄", () => {
    expect(ratingUncertainty(0)).toBe(RATING_START);
    expect(ratingUncertainty(1)).toBeGreaterThan(ratingUncertainty(9));
    expect(ratingUncertainty(100)).toBeLessThan(50);
    expect(PROVISIONAL_GAMES).toBe(10);
  });

  it("分档说法按锚点走，分界是相邻锚点的中点", () => {
    expect(ratingBandLabel(RATING_START)).toBe("初级 AI 以下");   // 新手起始 = 初级线，不吹
    expect(ratingBandLabel(1100)).toBe("初级 AI 以下");
    expect(ratingBandLabel(STRENGTH_ANCHORS.中级)).toBe("初级～中级 AI 之间");
    expect(ratingBandLabel(STRENGTH_ANCHORS.大师)).toBe("高级～大师 AI 之间");
    expect(ratingBandLabel(2300)).toBe("大师 AI 一线或以上");
  });
});

describe("聚合", () => {
  const mixed: DuelHistoryEntry[] = [
    entry({ id: "1", at: 100, outcome: "won", strength: "高级", engine: "strong", moves: 20, humanElapsedMs: 60_000 }),
    entry({ id: "2", at: 200, outcome: "lost", strength: "高级", engine: "strong", moves: 40, humanElapsedMs: 120_000 }),
    entry({ id: "3", at: 300, outcome: "draw", strength: "初级", engine: "light", moves: 30, humanElapsedMs: 30_000 }),
    entry({ id: "4", at: 400, outcome: "won", strength: "初级", engine: "light", moves: 10, humanElapsedMs: 10_000 }),
    entry({ id: "5", at: 500, outcome: "won", strength: "初级", engine: "light", moves: 12, humanElapsedMs: 12_000 }),
  ];

  it("胜负和计数、胜率口径（和算半分）、总手数与总用时", () => {
    const s = summarizeDuelHistory(mixed);
    expect([s.games, s.won, s.lost, s.draw]).toEqual([5, 3, 1, 1]);
    expect(s.winRate).toBeCloseTo((3 + 0.5) / 5, 6);
    expect(s.totalMoves).toBe(112);
    expect(s.totalHumanMs).toBe(232_000);
    expect(s.avgMoves).toBe(22);
  });

  it("当前连串看最近一段，最长连赢/最长连输分开算", () => {
    const s = summarizeDuelHistory(mixed);
    expect(s.streak).toEqual({ type: "won", count: 2 });
    expect(s.bestWinStreak).toBe(2);
    expect(s.worstLossStreak).toBe(1);
    expect(summarizeDuelHistory([]).streak).toEqual({ type: "none", count: 0 });
  });

  it("分档表按 档位×引擎 分组，场次降序，平均手数按组算", () => {
    const s = summarizeDuelHistory(mixed);
    expect(s.tiers.map((row) => `${row.strength}/${ENGINE_LABELS[row.engine]}`)).toEqual(["初级/轻量", "高级/标准"]);
    const light = s.tiers[0];
    expect([light.games, light.won, light.lost, light.draw, light.avgMoves]).toEqual([3, 2, 0, 1, Math.round((30 + 10 + 12) / 3)]);
    expect(light.winRate).toBeCloseTo((2 + 0.5) / 3, 6);
  });

  it("引擎表另给一张（同档位换引擎棋力不同，不能混在一张里）", () => {
    const s = summarizeDuelHistory(mixed);
    expect(s.engines.map((row) => row.engine)).toEqual(["light", "strong"]);
    expect(s.engines[0].games).toBe(3);
  });

  it("等级分轨迹与摘要一致：末点就是当前分，最近 10 局净变化取得到", () => {
    const s = summarizeDuelHistory(mixed);
    const track = computeRatingTrack(mixed);
    expect(s.rating.current).toBe(track[track.length - 1].rating);
    expect(s.rating.games).toBe(5);
    expect(s.rating.provisional).toBe(true);
    expect(s.rating.recentDelta).toBe(track[4].rating - RATING_START);
    expect(s.rating.high).toBeGreaterThanOrEqual(s.rating.low);
  });

  it("空账不崩：0 场时胜率是「没打过」而不是 0%", () => {
    const s = summarizeDuelHistory([]);
    expect(s.games).toBe(0);
    expect(s.winRate).toBeUndefined();
    expect(formatWinRate(undefined)).toBe("—");
    expect(formatWinRate(0.62)).toBe("62%");
    expect(s.rating.current).toBe(RATING_START);
    expect(s.tiers).toEqual([]);
    expect(s.firstAt).toBeUndefined();
  });

  it("时间乱序进来也要按时间正序推分（列表写入顺序不等于对局顺序）", () => {
    const shuffled = [...mixed].reverse();
    expect(summarizeDuelHistory(shuffled).rating.current).toBe(summarizeDuelHistory(mixed).rating.current);
    expect(summarizeDuelHistory(shuffled).streak).toEqual({ type: "won", count: 2 });
  });

  it("outcome 三种都覆盖到 scoreValue，不会漏算", () => {
    const outcomes: DuelOutcome[] = ["won", "draw", "lost"];
    const s = summarizeDuelHistory(outcomes.map((outcome, i) => entry({ id: `o${i}`, outcome })));
    expect([s.won, s.draw, s.lost]).toEqual([1, 1, 1]);
  });
});

describe("清空战绩", () => {
  it("清完读回空数组（面板的「没有战绩」要真能回到这个状态）", () => {
    appendDuelHistory(entry({ id: "z" }));
    expect(loadDuelHistory()).toHaveLength(1);
    clearDuelHistory();
    expect(loadDuelHistory()).toEqual([]);
  });
});
