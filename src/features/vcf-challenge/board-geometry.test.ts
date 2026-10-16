// board-geometry.test.ts — 钉住「网格 / 棋子 / 手数 / 坐标 / 点击命中共用同一套坐标」这条契约。
//
// 来历（2026-10-05 用户报障）：「VCF 挑战那个棋盘棋子不对呀，棋子都不在格子里面，序号也是乱七八糟的，
// 为什么人机对弈、打谱界面、其他所有地方都好好的」。原因是挑战盘自己另用一套几何（464 视野 / 边距 22 / 格 30），
// 而材质棋子按主盘的 572 空间算完再缩放（第 0 列 22 vs 37.3，差半个格），手数仍画在原网格上。
// 现在两侧同源（都走 line()），这组断言就是防止再出现「两套坐标」。
//
// 2026-10-08 追加（用户：「挑战里的棋盘没有坐标，侧边厚度也大，能不能搞得像正常打谱那个界面一样大」
// 以及「跟着打谱的设置走」）：边距/坐标字号/棋子大小全部从 `src/features/settings/*` 的纯函数推导，
// 这里把「默认档与主盘逐项同源」「自定义档确实跟着设置变」和「坐标落在缝里」都钉住。
import { describe, expect, it } from "vitest";
import { VCF_SIZE } from "./engine";
import { BOARD_VIEWBOX, DEFAULT_BOARD_MARGIN, clampBoardMargin, coordinateLayout, minBoardMargin } from "../settings/board-margin";
import { DEFAULT_COORDINATE_FONT_SIZE } from "../settings/display-defaults";
import { DEFAULT_STONE_SCALE, autoStoneRadius, stoneHitRadiusFor, stoneRadiusFor, tangentStoneRadius } from "../settings/stone-size";
import { DEFAULT_VCF_GEOMETRY, VCF_STAR_R, VCF_VIEWBOX, vcfGeometry } from "./board-geometry";

describe("VCF 挑战棋盘几何", () => {
  it("默认档与主盘同一套：572 视野 / 边距 = 主盘默认 34 / 子与热区走主盘公式 / 星位 4.2", () => {
    // 这些数字必须与 App.tsx 里主盘的棋盘（viewBox 0 0 572 572、margin 34、stoneRadius 公式、.star r 4.2）一致，
    // 因为材质外观与它的网格换算都是按 572 空间写的。
    const g = DEFAULT_VCF_GEOMETRY;
    expect(VCF_VIEWBOX).toBe(572);
    expect(g.viewBox).toBe(BOARD_VIEWBOX);
    expect(g.margin).toBe(34);
    expect(g.margin).toBe(DEFAULT_BOARD_MARGIN);
    expect(g.cell).toBeCloseTo((572 - 68) / 14, 6);
    expect(g.cell).toBe(36);
    expect(g.stoneR).toBeCloseTo(stoneRadiusFor(g.cell, DEFAULT_STONE_SCALE), 6);
    expect(g.stoneR).toBeCloseTo(autoStoneRadius(36), 6);
    expect(g.hitR).toBeCloseTo(stoneHitRadiusFor(g.cell, DEFAULT_STONE_SCALE), 6);
    expect(g.starR).toBe(VCF_STAR_R);
    expect(g.starR).toBe(4.2);
  });

  it("网格端点在边距内侧，且 15 条线等距（不再出现「子落在格子中间」）", () => {
    const g = DEFAULT_VCF_GEOMETRY;
    expect(g.line(0)).toBe(g.margin);
    expect(g.line(VCF_SIZE - 1)).toBeCloseTo(g.viewBox - g.margin, 6);
    const gaps = Array.from({ length: VCF_SIZE - 1 }, (_, i) => g.line(i + 1) - g.line(i));
    for (const gap of gaps) expect(gap).toBeCloseTo(g.cell, 6);
    // 事故复现：旧几何（边距 22 / 格 30）的第 0 列与现在差半个格，正是「子不在交叉点」的观感
    const legacyCell = 30, legacyMargin = 22;
    expect(Math.abs(legacyMargin - g.line(0))).toBeGreaterThan(legacyCell / 4);
    expect(Math.abs(legacyCell - g.cell)).toBeGreaterThan(1);
  });

  it("手数用主盘公式：字号 = max(8, r×0.64)、基线 = r×0.28", () => {
    const g = DEFAULT_VCF_GEOMETRY;
    expect(g.numFont).toBeCloseTo(Math.max(8, g.stoneR * 0.64), 6);
    expect(g.numDy).toBeCloseTo(g.stoneR * 0.28, 6);
    expect(g.numFont).toBeGreaterThanOrEqual(8);
    expect(g.numFont).toBeLessThanOrEqual(g.stoneR);
  });

  it("点击热区：不小于棋子、且不越过相邻格的相切线（点边线不会落到隔壁格）", () => {
    for (const scale of [0.85, 1, 1.2]) {
      const g = vcfGeometry({ stoneScale: scale });
      // 默认与最小档热区比子大一圈；最大档两者都被相切线（格距/2）兜住而相等 —— 与主盘同一条规则
      expect(g.hitR).toBeGreaterThanOrEqual(g.stoneR);
      expect(g.hitR).toBeLessThanOrEqual(tangentStoneRadius(g.cell));
      expect(g.hitR).toBeGreaterThanOrEqual(14);
    }
    expect(vcfGeometry({ stoneScale: 1 }).hitR).toBeGreaterThan(vcfGeometry({ stoneScale: 1 }).stoneR);
  });

  it("四边坐标用主盘同一个 layout，且落在缝里（不压网格、不被 viewBox 裁掉）", () => {
    const g = DEFAULT_VCF_GEOMETRY;
    expect(g.coordinateFontSize).toBe(DEFAULT_COORDINATE_FONT_SIZE);
    expect(g.coord).toEqual(coordinateLayout(g.margin, g.coordinateFontSize));
    const first = g.line(0), last = g.line(VCF_SIZE - 1);
    expect(g.coord.topY).toBeLessThan(first);
    expect(g.coord.bottomY).toBeGreaterThan(last);
    expect(g.coord.leftX).toBeLessThan(first);
    expect(g.coord.rightX).toBeGreaterThan(last);
    for (const v of [g.coord.topY, g.coord.bottomY, g.coord.leftX, g.coord.rightX]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(g.viewBox);
    }
    expect(g.coordinateFontSize).toBeGreaterThanOrEqual(8);
  });

  it("跟着打谱设置走：侧边压窄 → 格子变大；坐标字号变大 → 侧边最小档跟着放宽", () => {
    const wide = vcfGeometry({ margin: 34, coordinateFontSize: 12 });
    const narrow = vcfGeometry({ margin: 19, coordinateFontSize: 12 });
    expect(narrow.margin).toBe(minBoardMargin(12));
    expect(narrow.margin).toBeLessThan(wide.margin);
    expect(narrow.cell).toBeGreaterThan(wide.cell);           // 用户要的「压窄侧边＝棋盘更大」
    expect(narrow.coord).toEqual(coordinateLayout(narrow.margin, 12));

    // 字号 18：最小侧边被顶到 27，用户存的 19 会被收敛上来（否则两位数坐标放不下）
    const bigFont = vcfGeometry({ margin: 19, coordinateFontSize: 18 });
    expect(bigFont.coordinateFontSize).toBe(18);
    expect(bigFont.margin).toBe(clampBoardMargin(19, 18));
    expect(bigFont.margin).toBeGreaterThanOrEqual(minBoardMargin(18));
    expect(bigFont.coord).toEqual(coordinateLayout(bigFont.margin, 18));

    // 侧边永远不超过主盘默认 34
    expect(vcfGeometry({ margin: 999, coordinateFontSize: 12 }).margin).toBe(DEFAULT_BOARD_MARGIN);
    // 字号非法值落回默认
    expect(vcfGeometry({ coordinateFontSize: 0 }).coordinateFontSize).toBe(DEFAULT_COORDINATE_FONT_SIZE);
  });

  it("跟着打谱设置走：棋子大小档真的改变子半径与热区，且不越相切线", () => {
    const small = vcfGeometry({ stoneScale: 0.85 });
    const base = vcfGeometry({ stoneScale: 1 });
    const big = vcfGeometry({ stoneScale: 1.2 });
    expect(small.stoneR).toBeLessThan(base.stoneR);
    expect(big.stoneR).toBeGreaterThan(base.stoneR);
    expect(small.hitR).toBeLessThan(big.hitR);
    expect(big.stoneR).toBeLessThanOrEqual(tangentStoneRadius(base.cell));
    expect(vcfGeometry({ stoneScale: 99 }).stoneR).toBe(vcfGeometry({ stoneScale: 1.2 }).stoneR);
  });
});
