import { describe, expect, it } from "vitest";
import { VCF_BLACK as BLACK, VCF_WHITE as WHITE, emptyVcfBoard, vcfFivePoints, vcfPlace, blackFourMoves, blackMoveLegal, solveVcf, verifyVcfLine, generateVcfPuzzles, vcfCoordName, type VcfPuzzle } from "./vcf-generator";
import type { Position } from "../../types";

const P = (text: string): Position => {
  const m = text.trim().toUpperCase().match(/^([A-O])(\d{1,2})$/);
  if (!m) throw new Error(`非法坐标 ${text}`);
  return { col: m[1].charCodeAt(0) - 65, row: 15 - Number(m[2]) };
};
const boardFrom = (black: string[], white: string[]) => {
  const board = emptyVcfBoard();
  black.forEach((t) => vcfPlace(board, P(t), BLACK));
  white.forEach((t) => vcfPlace(board, P(t), WHITE));
  return board;
};
const name = (p: Position) => vcfCoordName(p);

describe("vcf-generator 禁手语义", () => {
  it("双三禁手：一子同时成两个活三（该手不合法）", () => {
    const b = boardFrom(["H9", "J9", "I10", "I11"], []);
    const i9 = P("I9");
    expect(blackMoveLegal(b, i9.row, i9.col)).toBe(false);
    const b2 = boardFrom(["H9", "J9", "I10", "I11"], ["G9"]);
    expect(blackMoveLegal(b2, i9.row, i9.col)).toBe(true);
  });
  it("双四禁手：两条线同时成四", () => {
    const b = boardFrom(["G9", "H9", "I9", "J8", "J10", "J11"], ["F9"]);
    const j9 = P("J9");
    expect(blackMoveLegal(b, j9.row, j9.col)).toBe(false);
    expect(blackFourMoves(b, "renju").some((m) => m.row === j9.row && m.col === j9.col)).toBe(false);
  });
  it("活四合法且带两个成五点", () => {
    const b = boardFrom(["H9", "I9", "J9"], []);
    const k9 = P("K9");
    const m = blackFourMoves(b, "renju").find((f) => f.row === k9.row && f.col === k9.col);
    expect(m).toBeTruthy();
    expect(m?.open).toBe(true);
    expect(m?.win.length).toBe(2);
  });
  it("长连禁手与成五优先", () => {
    const overline = boardFrom(["H9", "I9", "J9", "K9", "M9"], []);
    expect(blackFourMoves(overline, "renju").some((m) => name(m) === "L9")).toBe(false);
    const five = boardFrom(["H9", "I9", "J9", "K9"], []);
    expect(vcfFivePoints(five, BLACK, "renju").length).toBeGreaterThanOrEqual(1);
  });
});

describe("vcf-generator 求解与复核", () => {
  it("已知两步 VCF：J9 冲四 → 活四终局", () => {
    const b = boardFrom(["G9", "H9", "I9", "J10", "J11"], ["F9", "C3", "D3", "E3", "H3"]);
    const sol = solveVcf(b, { attacker: BLACK, rules: "renju", maxDepth: 5 });
    expect(sol.win).toBe(true);
    const atk = sol.line.filter((m) => m.player === BLACK).map(name);
    expect(atk.length).toBe(2);
    expect(atk[0]).toBe("J9");
    const check = verifyVcfLine({ rules: "renju", attacker: "black", black: ["G9", "H9", "I9", "J10", "J11"].map(P), white: ["F9", "C3", "D3", "E3", "H3"].map(P), line: sol.line });
    expect(check.ok).toBe(true);
  });
  it("活四端被封后不误报 VCF", () => {
    const b = boardFrom(["G9", "H9", "I9", "J10", "J11"], ["F9", "C3", "D3", "E3", "H3", "J7", "J13"]);
    expect(solveVcf(b, { attacker: BLACK, rules: "renju", maxDepth: 6 }).win).toBe(false);
  });
});

describe("vcf-generator 生成回灌", () => {
  it("连珠 8 题全部通过独立复核", () => {
    const gen = generateVcfPuzzles({ minDepth: 2, maxDepth: 5, rules: "renju", seed: 7 });
    const puzzles: VcfPuzzle[] = [];
    let attempts = 0;
    for (const step of gen) {
      attempts = step.attempts;
      if (step.puzzle) puzzles.push(step.puzzle);
      if (puzzles.length >= 8 || attempts > 500) break;
    }
    expect(puzzles.length).toBeGreaterThanOrEqual(5);
    for (const p of puzzles) {
      const check = verifyVcfLine({ rules: p.rules, attacker: "black", black: p.black, white: p.white, line: p.solution });
      expect(check.ok, `${p.title} 复核失败：${check.failures.join(";")}`).toBe(true);
    }
  }, 120000);
});
