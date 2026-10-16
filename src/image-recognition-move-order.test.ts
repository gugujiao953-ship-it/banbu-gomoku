import { describe, expect, it } from "vitest";
import { assignMoveNumbers, evaluateMoveNumberAssignment, type MoveNumberCandidate } from "./image-recognition";
import type { Player } from "./types";

const sequence = (n: number): { candidates: MoveNumberCandidate[][]; players: Player[] } => ({
  candidates: Array.from({ length: n }, (_, index) => [{ value: index + 1, score: 0.9 }]),
  players: Array.from({ length: n }, (_, index) => index % 2 === 0 ? "black" : "white"),
});

describe("move number coordinate reliability", () => {
  it("accepts a complete visually supported sequence", () => {
    const { candidates, players } = sequence(57);
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers).toEqual(Array.from({ length: 57 }, (_, index) => index + 1));
    expect(evaluateMoveNumberAssignment(solution, 57)).toMatchObject({ accepted: true, status: "accepted", assignmentMargin: null });
  });

  it("accepts the full 15x15 board range through move 225", () => {
    const { candidates, players } = sequence(225);
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers).toEqual(Array.from({ length: 225 }, (_, index) => index + 1));
    expect(evaluateMoveNumberAssignment(solution, 225)).toMatchObject({ accepted: true, status: "accepted" });
  });

  it("rejects a complete 41/49 permutation with nearly tied coordinate evidence", () => {
    const { candidates, players } = sequence(57);
    candidates[40] = [{ value: 49, score: 0.81 }, { value: 41, score: 0.8 }];
    candidates[48] = [{ value: 41, score: 0.81 }, { value: 49, score: 0.8 }];
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers[40]).toBe(49);
    expect(solution.numbers[48]).toBe(41);
    expect(new Set(solution.numbers).size).toBe(57);
    expect(solution.assignmentMargin).toBeCloseTo(0.02);
    expect(evaluateMoveNumberAssignment(solution, 57).accepted).toBe(false);
  });

  it("detects a three-way rotation even when no pair can be swapped", () => {
    const { candidates, players } = sequence(57);
    candidates[40] = [{ value: 41, score: 0.81 }, { value: 43, score: 0.8 }];
    candidates[42] = [{ value: 43, score: 0.81 }, { value: 49, score: 0.8 }];
    candidates[48] = [{ value: 49, score: 0.81 }, { value: 41, score: 0.8 }];
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.pairwiseMargin).toBe(Infinity);
    expect(solution.assignmentMargin).toBeCloseTo(0.03);
    expect(evaluateMoveNumberAssignment(solution, 57).accepted).toBe(false);
  });

  it("uses a strong peer to resolve a second choice without rejecting it", () => {
    const { candidates, players } = sequence(4);
    candidates[0] = [{ value: 3, score: 0.9 }, { value: 1, score: 0.86 }];
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers).toEqual([1, 2, 3, 4]);
    expect(solution.nonTop).toBe(1);
    expect(evaluateMoveNumberAssignment(solution, 4).accepted).toBe(true);
  });

  it("reports a wildcard fill as inferred instead of automatically restoring", () => {
    const { candidates, players } = sequence(6);
    candidates[2] = [];
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(evaluateMoveNumberAssignment(solution, 6)).toMatchObject({ accepted: false, wildcardUsed: 1 });
  });

  it("cannot manufacture a full sequence from missing or parity-forbidden edges", () => {
    const { candidates, players } = sequence(4);
    candidates[2] = [{ value: 2, score: 0.99 }];
    expect(assignMoveNumbers(candidates, players)).toBeNull();
    candidates[2] = [{ value: 1, score: 0.99 }];
    expect(assignMoveNumbers(candidates, players)).toBeNull();
  });

  // 印刷宋体的十位混淆（11/31、16/36…）会让逐颗局部边际都 <0.045，但整体解唯一。
  // 旧严格门按「低边际候选 8/40」拒掉一张联合求解全对的图，这里把两种情况分开钉住。
  it("accepts locally near-tied stones when the global alternative is clearly worse", () => {
    const { candidates, players } = sequence(40);
    for (const [hi, lo] of [[3, 23], [5, 25], [7, 27], [9, 29]]) {
      candidates[hi - 1] = [{ value: hi, score: 0.8 }, { value: lo, score: 0.765 }];
      candidates[lo - 1] = [{ value: lo, score: 0.8 }, { value: hi, score: 0.765 }];
    }
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.numbers).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(solution.ambiguous).toBe(8);
    expect(solution.assignmentMargin).toBeCloseTo(0.07);
    expect(evaluateMoveNumberAssignment(solution, 40)).toMatchObject({ accepted: true, ambiguous: 8 });
  });

  it("still rejects that shape once the global swap gap falls under the strict floor", () => {
    const { candidates, players } = sequence(40);
    for (const [hi, lo] of [[3, 23], [5, 25], [7, 27], [9, 29]]) {
      candidates[hi - 1] = [{ value: hi, score: 0.8 }, { value: lo, score: 0.79 }];
      candidates[lo - 1] = [{ value: lo, score: 0.8 }, { value: hi, score: 0.79 }];
    }
    const solution = assignMoveNumbers(candidates, players)!;
    expect(solution.assignmentMargin).toBeCloseTo(0.02);
    expect(evaluateMoveNumberAssignment(solution, 40).accepted).toBe(false);
  });
});
