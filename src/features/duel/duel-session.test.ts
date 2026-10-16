// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { GameDocument, RecordNode } from "../../types";
import type { OpeningSession } from "../../opening-rules";
import {
  DUEL_SESSION_KEY,
  clearDuelSession,
  duelSessionSummary,
  duelAwaitingSide,
  loadDuelSession,
  saveDuelSession,
  type DuelSessionGame,
  type DuelSessionSnapshot,
} from "./duel-session";

const node = (id: string, parentId: string | null, children: string[], move: RecordNode["move"]): RecordNode =>
  ({ id, parentId, children, move, comment: "", marks: [] });

const document: GameDocument = {
  id: "duel-1", version: 1, rootId: "root",
  nodes: {
    root: node("root", null, ["m1"], null),
    m1: node("m1", "root", ["m2"], { row: 7, col: 7, player: "black" }),
    m2: node("m2", "m1", [], { row: 8, col: 8, player: "white" }),
  },
  metadata: { title: "人机对战", black: "我", white: "半步 AI", event: "", date: "2026-09-28", result: "", rule: "renju", openingRule: "soosyrv-8", boardSize: 15, tags: [] },
  createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z",
};

const opening = (stage: OpeningSession["stage"]): OpeningSession =>
  ({ rule: "soosyrv-8", n: 8, humanPlayer: "black", opener: "human", stage, candidates: [] });

const game = (over: Partial<DuelSessionGame> = {}): DuelSessionGame => ({
  humanPlayer: "black", aiPlayer: "white", strength: "大师", forbiddenEnabled: true,
  timeLimitMs: 300000, readOffMs: 30000, thinkTimeMs: 10000, thinkDepth: 0,
  unlimitedThinking: false, outcome: null, opening: opening({ kind: "normal" }),
  engineChoice: "strong", rule: "soosyrv-8", ...over,
});

const snapshot = (over: Partial<DuelSessionSnapshot> = {}): DuelSessionSnapshot => ({
  version: 1, savedAt: "2026-09-28T01:00:00.000Z", document, currentId: "m2", game: game(),
  clock: { humanElapsedMs: 12345, moveElapsedMs: 678, expired: false, readOffExpired: false }, ...over,
});

describe("人机对弈可恢复会话", () => {
  beforeEach(() => localStorage.clear());

  it("存进去的能原样读回来（含开局会话与计时）", () => {
    expect(saveDuelSession(snapshot())).toBe(true);
    const loaded = loadDuelSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.currentId).toBe("m2");
    expect(loaded?.game.strength).toBe("大师");
    expect(loaded?.game.opening).toEqual(opening({ kind: "normal" }));
    expect(loaded?.clock).toEqual({ humanElapsedMs: 12345, moveElapsedMs: 678, expired: false, readOffExpired: false });
    expect(Object.keys(loaded?.document.nodes || {})).toEqual(["root", "m1", "m2"]);
  });

  it("清空后读不到；坏 JSON 读不到且顺手清掉", () => {
    saveDuelSession(snapshot());
    clearDuelSession();
    expect(loadDuelSession()).toBeNull();
    localStorage.setItem(DUEL_SESSION_KEY, "{不是 JSON");
    expect(loadDuelSession()).toBeNull();
    expect(localStorage.getItem(DUEL_SESSION_KEY)).toBeNull();
  });

  // ── 命门：恢复后局面在等谁（用户 09-28 的担心：「退出再进去，人机这一手不落子」）──────
  it("正常阶段：轮到 AI 就说 ai-move，轮到我就说 human", () => {
    // m2 之后该黑方（我）走
    expect(duelAwaitingSide(game(), document, "m2")).toBe("human");
    // m1 之后该白方（AI）走 —— 这正是「我在 AI 思考时退出」的情形，恢复方必须补一次调度
    expect(duelAwaitingSide(game(), document, "m1")).toBe("ai-move");
  });

  it("开局阶段：该 AI 交换 / 宣言打点 / 落子都算 ai-opening，该我的算 human", () => {
    expect(duelAwaitingSide(game({ opening: opening({ kind: "swap", afterMove: 1, chooser: "ai" }) }), document, "m2")).toBe("ai-opening");
    expect(duelAwaitingSide(game({ opening: opening({ kind: "choose-fifth-count", actor: "ai" }) }), document, "m2")).toBe("ai-opening");
    expect(duelAwaitingSide(game({ opening: opening({ kind: "place", moveNumber: 3, player: "black", actor: "ai", radius: 2 }) }), document, "m2")).toBe("ai-opening");
    expect(duelAwaitingSide(game({ opening: opening({ kind: "offer-fifths", actor: "human", count: 8 }) }), document, "m2")).toBe("human");
    expect(duelAwaitingSide(game({ opening: opening({ kind: "swap2-choice", chooser: "ai" }) }), document, "m2")).toBe("ai-opening");
  });

  it("已终局的会话不再等任何人（恢复后直接给终局面板，绝不补调度）", () => {
    expect(duelAwaitingSide(game({ outcome: "lost" }), document, "m1")).toBe("none");
  });

  // ── 自定义开局三件套（用户 2026-10-13）──────────────────────────────────────────
  it("摆子阶段在等的是我，不是 AI——按颜色算这时本来轮到白方", () => {
    // m1 之后该白方（＝AI）走。摆子阶段若判成 ai-move，恢复的瞬间 AI 就会把局面接着下完，
    // 用户摆到一半的阵被抢走（这条是这个模式最容易做漏的一处）。
    expect(duelAwaitingSide(game({ customOpening: true, customStarted: false }), document, "m1")).toBe("human");
    // 点了「开始对局」之后才恢复正常调度
    expect(duelAwaitingSide(game({ customOpening: true, customStarted: true }), document, "m1")).toBe("ai-move");
  });

  it("自定义开局：三个字段存进去、恢复出来一个都不丢（白名单重建不透传）", () => {
    expect(saveDuelSession(snapshot({ game: game({ customOpening: true, customStarted: false, customSetupCount: 7 }) }))).toBe(true);
    const loaded = loadDuelSession();
    expect(loaded?.game.customOpening).toBe(true);
    expect(loaded?.game.customStarted).toBe(false);
    expect(loaded?.game.customSetupCount).toBe(7);
  });

  it("自定义开局：老快照没这三个键 → false / 0，等于这模式不存在", () => {
    localStorage.setItem(DUEL_SESSION_KEY, JSON.stringify(snapshot()));
    const loaded = loadDuelSession();
    expect(loaded?.game.customOpening).toBe(false);
    expect(loaded?.game.customStarted).toBe(false);
    expect(loaded?.game.customSetupCount).toBe(0);
  });

  it("自定义开局：边界数被坏数据收敛成 0（乱写的负数不能把悔棋永久锁死）", () => {
    // `customSetupCount` 是悔棋能退到的下限（App 里 `duelSetupBoundary`），
    // 负数或 NaN 传下去会让 `duelPlayMoves` 虚高 → 锁定期形同失效，或反过来锁死。
    localStorage.setItem(DUEL_SESSION_KEY, JSON.stringify(snapshot({ game: game({ customOpening: true, customStarted: true, customSetupCount: -50 }) })));
    expect(loadDuelSession()?.game.customSetupCount).toBe(0);
    localStorage.setItem(DUEL_SESSION_KEY, JSON.stringify(snapshot({ game: game({ customOpening: true, customSetupCount: "九" as unknown as number }) })));
    expect(loadDuelSession()?.game.customSetupCount).toBe(0);
  });

  it("弹窗摘要说得出第几手与是否已结束", () => {
    expect(duelSessionSummary(snapshot())).toEqual({ turn: 2, awaiting: "human", finished: false });
    expect(duelSessionSummary(snapshot({ currentId: "m1", game: game({ outcome: "draw" }) }))).toEqual({ turn: 1, awaiting: "none", finished: true });
  });

  // ── 坏数据一律整条作废（宁可不给恢复，也不恢复出一个坏局面）──────────────────────
  it.each([
    ["版本号不对", snapshot({ version: 99 as number })],
    ["当前手不在棋谱里", snapshot({ currentId: "ghost" })],
    ["缺棋谱", snapshot({ document: undefined as unknown as GameDocument })],
    ["双方同色", snapshot({ game: game({ aiPlayer: "black" }) })],
    ["终局结果乱写", snapshot({ game: game({ outcome: "超时" as unknown as null }) })],
    ["开局阶段名不认识", snapshot({ game: game({ opening: opening({ kind: "teleport" } as unknown as OpeningSession["stage"]) }) })],
    ["开局规则不认识", snapshot({ game: game({ opening: { ...opening({ kind: "normal" }), rule: "alien" as unknown as OpeningSession["rule"] } }) })],
    ["开局会话缺candidates", snapshot({ game: game({ opening: { ...opening({ kind: "normal" }), candidates: undefined as unknown as [] } }) })],
  ])("%s → 读不出来", (_label, body) => {
    localStorage.setItem(DUEL_SESSION_KEY, JSON.stringify(body));
    expect(loadDuelSession()).toBeNull();
  });

  it("垃圾字段被收敛成安全默认（负数计时归零，不炸也不给个假数字）", () => {
    const dirty = snapshot({ clock: { humanElapsedMs: -5, moveElapsedMs: Number.NaN, expired: false, readOffExpired: false } });
    localStorage.setItem(DUEL_SESSION_KEY, JSON.stringify(dirty));
    const loaded = loadDuelSession();
    expect(loaded?.clock.humanElapsedMs).toBe(0);
    expect(loaded?.clock.moveElapsedMs).toBe(0);
  });
});
