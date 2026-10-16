/**
 * 每日一题的对局逻辑单测（2026-10-11）。
 *
 * 这一组守的是"界面之外的那部分正确性"：胜负相对谁算、悔棋退几步、
 * 什么时候该请陪练应手、非法落子判不判负。这些判据要是错了，
 * 页面看起来完全正常（棋盘会动、字会变），只有真玩下去才发现 —— 所以必须单测。
 */

import { describe, expect, it } from "vitest";
import { addMoveAs, createDocument } from "../../game";
import type { Player } from "../../types";
import {
  createDailyState, dailyBoard, dailyLastMove, dailyShouldReply, dailyTurn,
  playDailyMove, playDailyReply, setDailyThinking, setDailyNotice, undoDaily,
  type DailyState,
} from "./daily-play";

/** 造一个"预置两个子"的局面（白先题：黑一子、白一子，轮白走 —— 和真实题库一致）。 */
const makeSetup = (first: Player) => {
  const base = createDocument("测试题", 15);
  let document = base;
  let currentId = base.rootId;
  let step = addMoveAs(document, currentId, { row: 7, col: 6 }, "black");
  document = step.document; currentId = step.nodeId;
  step = addMoveAs(document, currentId, { row: 7, col: 7 }, "white");
  document = step.document; currentId = step.nodeId;
  // 把"该谁走"钉在终局节点上（与 createPuzzleDocument 的做法一致）
  document = {
    ...document,
    nodes: { ...document.nodes, [currentId]: { ...document.nodes[currentId], setup: { black: [], white: [], empty: [], nextPlayer: first } } },
  };
  return createDailyState(document, currentId);
};

const legal = () => null;
const occupied = (state: DailyState) => (position: { row: number; col: number }) =>
  (dailyBoard(state)[position.row]?.[position.col] ? "该位置已有棋子" : null);

describe("每日一题：对局逻辑", () => {
  it("开局：盘上是题目的预置子，轮到题目指定的先手", () => {
    const white = makeSetup("white");
    expect(dailyTurn(white)).toBe("white");
    expect(white.moves).toHaveLength(2);
    expect(dailyBoard(white)[7][6]).toBe("black");
    // 黑先题
    expect(dailyTurn(makeSetup("black"))).toBe("black");
  });

  it("**胜负相对人、不是相对棋子颜色**（白先题赢了也算赢）", () => {
    // 这一条是我第一版写错的地方：按 `board[last] === "black"` 判，白先题赢了会算成输。
    const state = makeSetup("white");
    // 白棋第 8 行连成五（第 8 行只放白子，避开预置子）
    let current = state;
    for (let col = 8; col <= 11; col += 1) {
      current = playDailyMove(current, { row: 8, col }, "white", "freestyle", "white", legal);
    }
    expect(current.phase).toBe("playing");          // 四子还不算连五
    current = playDailyMove(current, { row: 8, col: 12 }, "white", "freestyle", "white", legal);
    expect(current.phase).toBe("won");               // 白方成五 ⇒ **人类赢**
  });

  it("陪练成五 ⇒ 人类输（同样是相对人算）", () => {
    const state = makeSetup("white");
    // 人为让黑棋连五：直接让"陪练"落五子
    let current = state;
    for (let col = 8; col <= 12; col += 1) {
      current = playDailyReply(current, { row: 9, col }, "black", "freestyle", "white");
    }
    expect(current.phase).toBe("lost");
  });

  it("非法落子**不判负**、盘面不动，只给一句提示", () => {
    const state = makeSetup("black");
    const blocked = playDailyMove(state, { row: 7, col: 6 }, "black", "freestyle", "black", occupied(state));
    expect(blocked.phase).toBe("playing");
    expect(blocked.moves).toHaveLength(state.moves.length);   // 没多一手
    expect(blocked.currentId).toBe(state.currentId);          // 没前进
    expect(blocked.notice).toBeTruthy();                      // 但说了原因
  });

  it("落子合法时清掉上一次的提示（提示不该粘着）", () => {
    const state = makeSetup("black");
    const blocked = playDailyMove(state, { row: 7, col: 6 }, "black", "freestyle", "black", occupied(state));
    expect(blocked.notice).not.toBe("");
    const ok = playDailyMove(blocked, { row: 8, col: 8 }, "black", "freestyle", "black", occupied(state));
    expect(ok.notice).toBe("");
  });

  it("结局之后不再接受落子（避免在结算画面上继续改盘）", () => {
    let current = makeSetup("white");
    for (let col = 8; col <= 12; col += 1) current = playDailyMove(current, { row: 8, col }, "white", "freestyle", "white", legal);
    expect(current.phase).toBe("won");
    const after = playDailyMove(current, { row: 10, col: 10 }, "white", "freestyle", "white", legal);
    expect(after).toBe(current);                     // 原样返回（引用都没换）
    const reply = playDailyReply(current, { row: 10, col: 10 }, "black", "freestyle", "white");
    expect(reply.phase).toBe("won");
    expect(reply.moves).toHaveLength(current.moves.length);
  });

  it("思考期间不接受落子（否则会和陪练的应手撞车）", () => {
    const state = setDailyThinking(makeSetup("black"), true);
    const after = playDailyMove(state, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    expect(after).toBe(state);
  });

  it("悔棋一次退**两手**（自己那手 + 陪练那手）", () => {
    const setup = makeSetup("black");
    const setupCount = setup.moves.length;
    let current = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    current = playDailyReply(current, { row: 9, col: 9 }, "white", "freestyle", "black");
    expect(current.moves).toHaveLength(setupCount + 2);
    const undone = undoDaily(current, setupCount);
    expect(undone.moves).toHaveLength(setupCount);       // 退回开局
    expect(dailyTurn(undone)).toBe("black");
  });

  it("悔棋退不过预置子（已经是开局局面就原样返回）", () => {
    const setup = makeSetup("black");
    const undone = undoDaily(setup, setup.moves.length);
    expect(undone).toBe(setup);
    // 只走了一手（还没等到陪练）时退一手就回到开局
    const one = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    const back = undoDaily(one, setup.moves.length);
    expect(back.moves).toHaveLength(setup.moves.length);
  });

  it("**赢局不许悔**（否则会来回弹结算），输局可以悔", () => {
    let won = makeSetup("white");
    for (let col = 8; col <= 12; col += 1) won = playDailyMove(won, { row: 8, col }, "white", "freestyle", "white", legal);
    expect(won.phase).toBe("won");
    expect(undoDaily(won, 2)).toBe(won);

    let lost = makeSetup("white");
    for (let col = 8; col <= 12; col += 1) lost = playDailyReply(lost, { row: 9, col }, "black", "freestyle", "white");
    expect(lost.phase).toBe("lost");
    expect(undoDaily(lost, 2).phase).toBe("playing");     // 输了能重来
  });

  it("悔棋之后能改下别处（树上留分支，与打谱同一套语义）", () => {
    const setup = makeSetup("black");
    let current = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    current = playDailyReply(current, { row: 9, col: 9 }, "white", "freestyle", "black");
    const undone = undoDaily(current, setup.moves.length);
    const other = playDailyMove(undone, { row: 8, col: 9 }, "black", "freestyle", "black", legal);
    expect(other.moves).toHaveLength(setup.moves.length + 1);
    // 原来那两手仍在树里（没有被删掉）
    expect(Object.keys(other.document.nodes).length).toBeGreaterThan(Object.keys(setup.document.nodes).length);
  });

  it("悔棋后能够重走原来的自己与陪练两手，不重复创建棋谱节点", () => {
    const setup = makeSetup("black");
    const first = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    const replied = playDailyReply(first, { row: 9, col: 9 }, "white", "freestyle", "black");
    const undone = undoDaily(replied, setup.moves.length);
    const replayed = playDailyMove(undone, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    expect(replayed.currentId).toBe(first.currentId);
    expect(replayed.notice).toBe("");
    const rereplied = playDailyReply(replayed, { row: 9, col: 9 }, "white", "freestyle", "black");
    expect(rereplied.currentId).toBe(replied.currentId);
    expect(rereplied.moves).toEqual(replied.moves);
    expect(rereplied.document).toBe(replied.document);
  });

  it("陪练返回盘外坐标时不向棋谱写入坏节点", () => {
    const state = makeSetup("black");
    const after = playDailyReply(state, { row: 15, col: 0 }, "white", "freestyle", "black");
    expect(after.document).toBe(state.document);
    expect(after.currentId).toBe(state.currentId);
    expect(after.notice).toBe("陪练返回了一个无效落点");
  });

  it("该不该请陪练应手：轮到对手才请，且没结束、没在思考", () => {
    const setup = makeSetup("black");
    expect(dailyShouldReply(setup, "black")).toBe(false);      // 轮到自己
    const moved = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    expect(dailyShouldReply(moved, "black")).toBe(true);       // 轮到白（对手）
    expect(dailyShouldReply(setDailyThinking(moved, true), "black")).toBe(false);  // 已经在思考
    let won = moved;
    for (let col = 9; col <= 12; col += 1) won = playDailyMove(won, { row: 8, col }, "black", "freestyle", "black", legal);
    expect(won.phase).toBe("won");
    expect(dailyShouldReply(won, "black")).toBe(false);        // 结束了不再请
  });

  it("最后一步的落点跟着手序走（画红点用）", () => {
    const setup = makeSetup("black");
    expect(dailyLastMove(setup)).toEqual({ row: 7, col: 7 });
    const moved = playDailyMove(setup, { row: 8, col: 8 }, "black", "freestyle", "black", legal);
    expect(dailyLastMove(moved)).toEqual({ row: 8, col: 8 });
  });

  it("提示可以单独设（陪练没找到落点时页面要用）", () => {
    const state = setDailyNotice(makeSetup("black"), "陪练没有找到可落子点");
    expect(state.notice).toBe("陪练没有找到可落子点");
    expect(state.phase).toBe("playing");
  });
});
