// serialize.test.ts — 做题记录的序列化往返（预览图与"点进去重做"都靠它）。
import { describe, expect, it } from "vitest";
import { coordName, parseRuns, problemFromEntry, problemToRuns, runOf } from "./serialize";
import { buildSolutionLine, solveAppLine } from "./solution-line";
import { emptyVcfBoard, solveVcf, vcfPlace, VCF_BLACK, VCF_WHITE } from "../vcf/vcf-generator";
import type { ChallengeProblem } from "./problems";
import type { VcfHistoryEntry } from "./rating";
import type { Position } from "../../types";

const board = emptyVcfBoard();

const sampleProblem: ChallengeProblem = {
  id: "m-42",
  attacker: "black",
  depth: 5,
  tier: "short",
  black: [{ row: 7, col: 7 }, { row: 7, col: 8 }, { row: 7, col: 9 }],
  white: [{ row: 8, col: 6 }, { row: 8, col: 7 }],
  solution: [
    { row: 7, col: 10, player: "black" },
    { row: 8, col: 8, player: "white" },
    { row: 7, col: 11, player: "black" },
  ],
  source: "material",
};

describe("做题记录序列化", () => {
  it("坐标名往返一致（含两位数行号 O15 / A1）", () => {
    expect(coordName(0, 0)).toBe("A15");
    expect(coordName(14, 14)).toBe("O1");
    const pos = [{ row: 0, col: 0 }, { row: 14, col: 14 }, { row: 7, col: 7 }];
    expect(parseRuns(runOf(pos))).toEqual(pos);
  });

  it("题目 → 记录串：黑/白分列，解答只留攻方手", () => {
    const { stones, sol } = problemToRuns(sampleProblem);
    expect(stones).toBe("H8I8J8/G7H7");   // (8,6)=G7、(8,7)=H7
    expect(sol).toBe("K8L8");   // 白方那手 (8,8) 不进解答
  });

  it("记录 → 题目：局面、攻方都能还原，解答会补回对方的挡子并攻守交替", () => {
    const { stones, sol } = problemToRuns(sampleProblem);
    const entry: VcfHistoryEntry = { ts: 1, tier: "short", depth: 5, win: true, moves: 3, delta: 9, seconds: 20, id: "m-42", attacker: "black", stones, sol };
    const back = problemFromEntry(entry);
    expect(back).not.toBeNull();
    expect(back!.black).toEqual(sampleProblem.black);
    expect(back!.white).toEqual(sampleProblem.white);
    expect(back!.attacker).toBe("black");
    expect(back!.depth).toBe(5);
    /* 记录里只存**攻方**的冲四（sol="K8L8"）。以前这里把两枚都标成攻方 —— 答案看起来就是
       「除了第一个子其他都是同色的」（用户 10-06 报的）。现在按局面现推：
       这道 fixture 的 H8/I8/J8 + K8 形成**活四**（两端都空），一手就结束了，所以线只剩 1 手、
       且必须是攻方——不会再凭空多出一枚同色子。 */
    expect(back!.solution).toHaveLength(1);
    expect(back!.solution[0]).toMatchObject({ row: 7, col: 10, player: "black" });
  });

  it("从记录还原的解答始终攻守交替（可复现的串：攻方手序一手不差）", () => {
    // 局面取自 vcf-generator 的已知两步 VCF：黑 G9/H9/I9/J10/J11，白 F9/C3/D3/E3/H3
    const place = (list: Position[], player: 1 | 2) => { for (const p of list) vcfPlace(board, p, player); };
    const P = (t: string): Position => ({ col: t.toUpperCase().charCodeAt(0) - 65, row: 15 - Number(t.slice(1)) });
    const black = ["G9", "H9", "I9", "J10", "J11"].map(P);
    const white = ["F9", "C3", "D3", "E3", "H3"].map(P);
    place(black, VCF_BLACK); place(white, VCF_WHITE);
    /* 记录里的串必须**在应用守方语义下可复现**：守方永远是「自动堵唯一挡点」。
       用 solveAppLine 造这样一条线（求解器原始线可能带反击四防守，挑战里复现不出来）。 */
    const appLine = solveAppLine(black, white, "black", 5);
    expect(appLine).not.toBeNull();
    const attackerMoves = appLine!.line.filter((m) => m.player === "black").map((m) => ({ row: m.row, col: m.col }));
    // 记录里只存攻方那几手（problemToRuns 就是这么存的）
    const entry: VcfHistoryEntry = {
      ts: 1, tier: "short", depth: attackerMoves.length, win: true, moves: attackerMoves.length, delta: 9, seconds: 20,
      id: "m-99", attacker: "black", stones: runOf(black) + "/" + runOf(white), sol: runOf(attackerMoves),
    };
    const back = problemFromEntry(entry);
    expect(back).not.toBeNull();
    expect(back!.singleSide).toBeFalsy();
    const players = back!.solution.map((m) => m.player);
    expect(players[0]).toBe("black");
    for (let i = 1; i < players.length; i += 1) expect(players[i], `第 ${i + 1} 手应当换边`).not.toBe(players[i - 1]);
    // 攻方那几手一手不少、顺序不变
    expect(back!.solution.filter((m) => m.player === "black").map((m) => `${m.row},${m.col}`))
      .toEqual(attackerMoves.map((m) => `${m.row},${m.col}`));
  });

  it("记录里的串复现不出（求解器线带反击四防守）→ 用应用语义现解修复，答案仍是攻守交替的合法线", () => {
    const place = (list: Position[], player: 1 | 2) => { for (const p of list) vcfPlace(board, p, player); };
    const P = (t: string): Position => ({ col: t.toUpperCase().charCodeAt(0) - 65, row: 15 - Number(t.slice(1)) });
    const black = ["G9", "H9", "I9", "J10", "J11"].map(P);
    const white = ["F9", "C3", "D3", "E3", "H3"].map(P);
    place(black, VCF_BLACK); place(white, VCF_WHITE);
    const solved = solveVcf(board, { attacker: VCF_BLACK, rules: "renju", maxDepth: 5 });
    expect(solved.win).toBe(true);
    const attackerMoves = solved.line.filter((m) => m.player === VCF_BLACK).map((m) => ({ row: m.row, col: m.col }));
    const entry: VcfHistoryEntry = {
      ts: 1, tier: "short", depth: attackerMoves.length, win: true, moves: attackerMoves.length, delta: 9, seconds: 20,
      id: "m-99", attacker: "black", stones: runOf(black) + "/" + runOf(white), sol: runOf(attackerMoves),
    };
    const back = problemFromEntry(entry);
    expect(back).not.toBeNull();
    if (back!.singleSide) {
      /* 修不成（极少数）→ **如实标成攻方手**并由界面写明「只列攻方冲四」；绝不允许出现
         「第一手黑、后面另一种色」那种混合配色（那正是用户 10-06 说的"答案看起来出错"）。 */
      expect(back!.solution.every((m) => m.player === "black")).toBe(true);
    } else {
      const players = back!.solution.map((m) => m.player);
      for (let i = 1; i < players.length; i += 1) expect(players[i], `第 ${i + 1} 手应当换边`).not.toBe(players[i - 1]);
      // 修复线等于「应用守方语义」下现解的线（不是求解器那条带反击四的原始线）
      const appLine = solveAppLine(black, white, "black", 5);
      expect(appLine).not.toBeNull();
      expect(back!.solution.map((m) => `${m.row},${m.col},${m.player}`))
        .toEqual(appLine!.line.map((m) => `${m.row},${m.col},${m.player}`));
    }
  });

  it("老记录（没有局面/解答字段）返回 null，界面据此显示占位而不是空盘", () => {
    const legacy: VcfHistoryEntry = { ts: 1, tier: "short", depth: 5, win: false, moves: 2, delta: -6, seconds: 40 };
    expect(problemFromEntry(legacy)).toBeNull();
  });

  it("白先题目也能还原（攻方为白）", () => {
    const p: ChallengeProblem = { ...sampleProblem, attacker: "white", black: [{ row: 8, col: 8 }], white: [{ row: 7, col: 7 }, { row: 7, col: 8 }], solution: [{ row: 7, col: 9, player: "white" }] };
    const { stones, sol } = problemToRuns(p);
    const back = problemFromEntry({ ts: 1, tier: "short", depth: 3, win: true, moves: 1, delta: 5, seconds: 8, id: "m-7", attacker: "white", stones, sol });
    expect(back!.attacker).toBe("white");
    expect(back!.white.length).toBe(2);
    expect(back!.solution[0].player).toBe("white");
  });
});
