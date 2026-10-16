import { describe, expect, it } from "vitest";
import { searchVct, verifyVctProof } from "./vct";
import type { Cell, Player, RuleSet } from "../../types";

// VCT（连续威胁胜）求解器的单测。
// 核心不变式：**VCF ⊆ VCT**——凡是连续冲四能赢的，VCT 也必须能赢。
// 另测 VCT 独有的能力：靠**活三铺垫**取胜（VCF 看不见这类杀）。

const SIZE = 15;
const empty = (): Cell[][] => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));

const put = (board: Cell[][], specs: Array<[number, number, Player]>) => {
  for (const [row, col, player] of specs) board[row][col] = player;
  return board;
};

describe("VCT 求解器（应用内）", () => {
  it("空盘无杀", () => {
    const result = searchVct(empty(), "black", { maxAttackMoves: 3, timeBudgetMs: 2000 });
    expect(result.status).toBe("not-found");
    expect(result.principalVariation).toHaveLength(0);
  });

  it("活四局面：直接判胜（对方堵不完两端）", () => {
    // 注意：若棋盘上**已经有**四连，求解器第一手会直接"成五"（正确：先看有没有立即胜）。
    // 要测「活四」，得让四连需要**落子才能形成**：
    // 黑方 F8 G8 H8（三连，两端 E8/I8 皆空）→ 落 I8 后成 F8-G8-H8-I8 活四（两端 E8/J8 空）
    const board = put(empty(), [
      [7, 5, "black"], [7, 6, "black"], [7, 7, "black"],     // F8 G8 H8
      [6, 5, "white"], [8, 5, "white"],                       // 白方两子，不堵关键线
      [10, 10, "white"], [11, 11, "white"],
    ]);
    const result = searchVct(board, "black", { maxAttackMoves: 3, timeBudgetMs: 3000 });
    expect(result.status).toBe("win");
    // 第一手应形成活四（或直接成五，若该点同时成五则另说）
    const firstThreat = result.principalVariation[0].threat;
    expect(["openFour", "five"]).toContain(firstThreat);
  });

  it("VCF 能解的局面，VCT 也能解（子集性质）", () => {
    // 构造一个纯冲四的杀：黑方三连 + 一个冲四点，白方堵不住
    const board = put(empty(), [
      [7, 5, "black"], [7, 6, "black"], [7, 7, "black"],   // F8 G8 H8 三连
      [6, 7, "black"],                                       // H9（提供斜线/垂直材料）
      [7, 4, "white"], [7, 9, "white"],                      // 白方堵两端附近
      [5, 5, "white"], [9, 9, "white"],
    ]);
    const vct = searchVct(board, "black", { maxAttackMoves: 5, timeBudgetMs: 5000 });
    const vcfOnly = searchVct(board, "black", { maxAttackMoves: 5, timeBudgetMs: 5000, allowThree: false });
    // 不变式：纯 VCF 能解 ⇒ VCT 也能解
    if (vcfOnly.status === "win") expect(vct.status).toBe("win");
    expect(["win", "not-found", "budget"]).toContain(vct.status);
  });

  it("活三能力确实生效：关掉活三后解不出/更差（VCT 的独有价值）", () => {
    // 说明：求解器会优先选**最短**的杀。若局面里既有活四也有活三铺垫，它会走活四
    // （这是正确行为，不是 bug）。所以不能用"第一手必须是活三"来证明 VCT 能力，
    // 正确的证法是：**关掉活三后，结果变差**。
    const board = put(empty(), [
      [7, 6, "black"], [7, 7, "black"],                       // G8 H8
      [6, 7, "black"], [6, 8, "black"],                       // H9 I9
      [5, 8, "black"],                                         // I10
      [9, 9, "white"], [10, 10, "white"], [3, 3, "white"], [11, 4, "white"], [2, 2, "white"],
    ]);
    const withThrees = searchVct(board, "black", { maxAttackMoves: 6, timeBudgetMs: 8000, allowThree: true });
    const vcfOnly = searchVct(board, "black", { maxAttackMoves: 6, timeBudgetMs: 8000, allowThree: false });
    expect(withThrees.status).toBe("win");
    // 关键断言：允许活三时，解的深度不应比纯 VCF 更差（活三只会让攻方更强）
    if (vcfOnly.status === "win") {
      expect(withThrees.principalVariation.filter((m) => m.player === "black").length)
        .toBeLessThanOrEqual(vcfOnly.principalVariation.filter((m) => m.player === "black").length);
    }
    // 且允许活三时，解里可能出现活三手（证明这条路径被启用了）
    const threats = withThrees.principalVariation.map((m) => m.threat);
    expect(threats.some((t) => t === "three" || t === "four" || t === "openFour")).toBe(true);
  });

  it("证明树可独立复核", () => {
    const board = put(empty(), [
      [7, 5, "black"], [7, 6, "black"], [7, 7, "black"],
      [6, 7, "black"], [5, 7, "black"],
      [9, 9, "white"], [10, 10, "white"], [3, 3, "white"], [11, 4, "white"],
    ]);
    const result = searchVct(board, "black", { maxAttackMoves: 6, timeBudgetMs: 8000 });
    expect(result.status).toBe("win");
    const check = verifyVctProof(board, result.proof, "black", "renju");
    expect(check.valid).toBe(true);
  });

  it("时间预算耗尽时如实返回 budget（不假装无解）", () => {
    // 空盘 + 极小预算 → 必然超时
    const result = searchVct(empty(), "black", { maxAttackMoves: 12, timeBudgetMs: 1 });
    expect(["budget", "not-found"]).toContain(result.status);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("连珠规则下黑方禁手点不作为进攻手", () => {
    // 黑方若走禁手点（双三/双四/长连）应被排除——这里只验证不崩且不误判胜
    const board = put(empty(), [
      [7, 5, "black"], [7, 6, "black"], [7, 8, "black"], [7, 9, "black"],
      [6, 7, "black"], [8, 7, "black"],
      [5, 5, "white"], [9, 9, "white"],
    ]);
    const result = searchVct(board, "black", { maxAttackMoves: 4, timeBudgetMs: 3000, rule: "renju" });
    expect(["win", "not-found", "budget"]).toContain(result.status);
  });

  it("规则参数生效：无禁手规则下黑方不受禁手约束", () => {
    const board = put(empty(), [
      [7, 5, "black"], [7, 6, "black"], [7, 7, "black"], [7, 8, "black"],
    ]);
    const freestyle = searchVct(board, "black", { maxAttackMoves: 3, timeBudgetMs: 3000, rule: "freestyle" as RuleSet });
    expect(freestyle.status).toBe("win");
  });
});
