import { describe, expect, it } from "vitest";
import { identifyOpening, OPENING_TABLE_FOR_AUDIT } from "./opening-name";

/**
 * 开局识别的单测（2026-10-09）。
 *
 * 这里除了功能正确性，还钉住两条容易退化的性质：
 *  - **八向对称不变**：同一开局的 8 个旋转/镜像同形必须给出同一个名字（用户看到的是棋形）；
 *  - **不硬套**：不满足「黑1 天元 + 白2 相邻 + 黑3 在表里」时必须返回 null，
 *    绝不能因为「看起来像」就给个名字——用户摆自由开局时不该被乱命名。
 */

const C = 7; // 15 路天元
const at = (dRow: number, dCol: number) => ({ row: C + dRow, col: C + dCol });
const CENTER = at(0, 0);

describe("26 开局识别", () => {
  it("直指系 13 个全部识别", () => {
    const expected: Array<[number, number, string]> = [
      [2, 0, "寒星"], [2, 1, "溪月"], [2, 2, "疏星"], [1, 1, "花月"], [1, 2, "残月"],
      [0, 1, "雨月"], [0, 2, "金星"], [-1, 0, "松月"], [-1, 1, "丘月"], [-1, 2, "新月"],
      [-2, 0, "瑞星"], [-2, 1, "山月"], [-2, 2, "游星"],
    ];
    for (const [dRow, dCol, name] of expected) {
      const identity = identifyOpening(CENTER, at(1, 0), at(dRow, dCol));
      expect(identity?.name, `黑3 (${dRow},${dCol}) 应为 ${name}`).toBe(name);
      expect(identity?.family).toBe("direct");
    }
  });

  it("斜指系 13 个全部识别", () => {
    const expected: Array<[number, number, string]> = [
      [2, 2, "长星"], [1, 2, "峡月"], [0, 1, "云月"], [0, 2, "恒星"], [-1, -1, "斜月"],
      [-1, 0, "银月"], [-1, 1, "浦月"], [-1, 2, "水月"], [-2, -2, "彗星"], [-2, -1, "名月"],
      [-2, 0, "明星"], [-2, 1, "岚月"], [-2, 2, "流星"],
    ];
    for (const [dRow, dCol, name] of expected) {
      const identity = identifyOpening(CENTER, at(1, 1), at(dRow, dCol));
      expect(identity?.name, `黑3 (${dRow},${dCol}) 应为 ${name}`).toBe(name);
      expect(identity?.family).toBe("indirect");
    }
  });

  it("两个族合起来正好 26 个名字，且互不重叠", () => {
    const names = new Set([
      ...OPENING_TABLE_FOR_AUDIT.direct.map((x) => x.name),
      ...OPENING_TABLE_FOR_AUDIT.indirect.map((x) => x.name),
    ]);
    expect(names.size).toBe(26);
    expect(OPENING_TABLE_FOR_AUDIT.direct).toHaveLength(13);
    expect(OPENING_TABLE_FOR_AUDIT.indirect).toHaveLength(13);
  });

  it("八向对称：同一开局的 8 个同形给同一个名字", () => {
    const transforms: Array<(p: { row: number; col: number }) => { row: number; col: number }> = [
      (p) => ({ row: p.row, col: p.col }),
      (p) => ({ row: 2 * C - p.row, col: p.col }),
      (p) => ({ row: p.row, col: 2 * C - p.col }),
      (p) => ({ row: 2 * C - p.row, col: 2 * C - p.col }),
      (p) => ({ row: C + (p.col - C), col: C + (p.row - C) }),
      (p) => ({ row: C - (p.col - C), col: C + (p.row - C) }),
      (p) => ({ row: C + (p.col - C), col: C - (p.row - C) }),
      (p) => ({ row: C - (p.col - C), col: C - (p.row - C) }),
    ];
    // 花月：黑1 天元、白2 (1,0)、黑3 (1,1)
    for (const transform of transforms) {
      const identity = identifyOpening(transform(CENTER), transform(at(1, 0)), transform(at(1, 1)));
      expect(identity?.name, "花月的所有同形都该认成花月").toBe("花月");
    }
  });

  it("黑1 不在天元 ⇒ 不命名（平移过的同形不是 RIF 的开局）", () => {
    const off = at(1, 1); // 黑1 挪到 (1,1)
    const identity = identifyOpening(off, { row: off.row + 1, col: off.col }, { row: off.row + 1, col: off.col + 1 });
    expect(identity).toBeNull();
  });

  it("白2 不相邻 ⇒ 不命名", () => {
    // 白2 拉到 (3,0)（与黑1 相隔两格）
    expect(identifyOpening(CENTER, at(3, 0), at(1, 1))).toBeNull();
  });

  it("白2 相邻但黑3 不在表里 ⇒ 不命名", () => {
    // 白2 直指，黑3 落到远处 (5,5)：不是 26 开局里的任何一手
    expect(identifyOpening(CENTER, at(1, 0), at(5, 5))).toBeNull();
  });

  it("黑3 与已有子重叠的退化输入不会假装命名", () => {
    // 黑3 落在天元（黑1 的位置）：表里没有 (0,0)，应为 null
    expect(identifyOpening(CENTER, at(1, 0), CENTER)).toBeNull();
  });

  it("偶数路数没有中心点 ⇒ 不命名", () => {
    expect(identifyOpening({ row: 7, col: 7 }, { row: 8, col: 7 }, { row: 8, col: 8 }, 14)).toBeNull();
  });

  it("其它奇数路数按各自中心识别（形状相同即算）", () => {
    // 17 路：中心 = 8
    const identity = identifyOpening({ row: 8, col: 8 }, { row: 9, col: 8 }, { row: 9, col: 9 }, 17);
    expect(identity?.name).toBe("花月");
  });

  it("只认前三手：传进来的就是前三个点，不受后续手数影响（函数签名如此）", () => {
    // 直指花月之后随便走多少手，识别结果不变——这里用「同一组入参调两次结果一致」表达
    const a = identifyOpening(CENTER, at(1, 0), at(1, 1));
    const b = identifyOpening(CENTER, at(1, 0), at(1, 1));
    expect(a?.name).toBe(b?.name);
    expect(a?.name).toBe("花月");
  });
});
