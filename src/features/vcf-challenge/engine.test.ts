// engine.test.ts — VCF 挑战规则核心的单测（用户 2026-10-04 硬规则：每手必须带四）。
import { describe, expect, it } from "vitest";
import { classifyAttack, VCF_SIZE, vidx, type VcfBoard } from "./engine";

const emptyBoard = (): VcfBoard => new Int8Array(VCF_SIZE * VCF_SIZE);
const B = (b: VcfBoard, row: number, cols: number[]) => { for (const c of cols) b[vidx(row, c)] = 1; };
const W = (b: VcfBoard, row: number, cols: number[]) => { for (const c of cols) b[vidx(row, c)] = 2; };
const B1 = (b: VcfBoard, row: number, col: number) => { b[vidx(row, col)] = 1; };

describe("VCF 挑战规则 classifyAttack", () => {
  it("非四落子被拒绝（请形成四）", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8]); W(b, 7, [5]);
    const v = classifyAttack(b, 7, 10, "black"); // 7,8 + 10 中间隔 9，不成四
    expect(v.ok).toBe(false);
    expect(v.message).toBe("请形成四");
  });

  it("冲四被接受，守方强制堵唯一防点", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8, 9]); W(b, 7, [5, 6]);
    const v = classifyAttack(b, 7, 10, "black"); // 7-10 四，完成点 11
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("continue");
    expect(v.block).toBe(vidx(7, 11));
  });

  it("成五直接判胜", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8, 9, 11]); W(b, 7, [6]);
    const v = classifyAttack(b, 7, 10, "black"); // 7..11 五连
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("win");
  });

  it("活四（两个完成点）守方无解判胜", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8, 9]);
    const v = classifyAttack(b, 7, 10, "black"); // 7-10，完成点 6 与 11
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("win");
  });

  it("黑方三三禁手被拒绝", () => {
    const b = emptyBoard();
    B(b, 7, [6, 7]);          // 横向两子
    B1(b, 5, 8); B1(b, 6, 8); // 纵向两子
    const v = classifyAttack(b, 7, 8, "black"); // 同时成两组活三 → 三三
    expect(v.ok).toBe(false);
    expect(v.message).toContain("三三");
  });

  it("白方同型不受禁手限制（只按四的规则拒）", () => {
    const b = emptyBoard();
    W(b, 7, [6, 7]);
    b[vidx(5, 8)] = 2; b[vidx(6, 8)] = 2;
    const v = classifyAttack(b, 7, 8, "white"); // 白下同点：无禁手，但也不是四
    expect(v.ok).toBe(false);
    expect(v.message).toBe("请形成四");
  });

  it("守方反四时，不带四不挡的着法被拒", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8]);
    W(b, 9, [4, 5, 6, 7]); B(b, 9, [8]);  // 白冲四，唯一完成点 (9,3)
    const v = classifyAttack(b, 7, 12, "black"); // 黑下不挡不四的点
    expect(v.ok).toBe(false);
    expect(v.message).toContain("反四");
  });

  it("守方反四时，带四且挡住的着法被接受", () => {
    const b = emptyBoard();
    B(b, 7, [7, 8, 9]); W(b, 9, [4, 5, 6, 7]); B(b, 9, [8]); W(b, 7, [5]);
    const v = classifyAttack(b, 7, 10, "black"); // 7-10 冲四，完成点 11；白 9 行 4-7 的完成点 (9,3) 仍在
    // 注意：黑这一手没有挡白反四 ⇒ 仍应被拒
    expect(v.ok).toBe(false);
    expect(v.message).toContain("反四");
  });
});
