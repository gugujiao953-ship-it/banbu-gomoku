import { VCF_SIZE } from "./engine";
import { BOARD_VIEWBOX, clampBoardMargin, coordinateLayout, type CoordinateLayout } from "../settings/board-margin";
import { DEFAULT_COORDINATE_FONT_SIZE } from "../settings/display-defaults";
import { DEFAULT_STONE_SCALE, clampStoneScale, stoneHitRadiusFor, stoneRadiusFor } from "../settings/stone-size";

/**
 * 挑战棋盘的几何 —— **必须与主盘那套一致**，而且从 10-08 起是**跟着打谱的显示设置走**的。
 *
 * 为什么单独一个模块、还要有单测兜着：材质外观（`src/appearance`）是**按主盘的 572 空间画的**，
 * `boardLayers(mat, size, margin, gap)` 里的 `gridTransform` 也按这个空间把「钉在格子上」的装饰
 * 换算到传入的网格上。所以网格线、棋子、手数、坐标、点击命中**只能有一套坐标**。
 *
 * 2026-10-05 的事故（用户报「棋子都不在格子里、序号乱七八糟」）：挑战盘曾自己另用一套几何
 * （464 视野、边距 22、格 30），而材质棋子按 572 空间算完再整体缩放 → 子横向落在两套网格中间
 * （第 0 列：22 vs 37.3，差半个格），手数却还画在原网格上，于是全错位。
 * 现在两侧同源：所有坐标都从 `line()` 取。
 *
 * 2026-10-08（用户：「挑战里的棋盘没有坐标，侧边厚度也大，能不能搞得像正常打谱那个界面一样大」）：
 *  ① 边距不再写死 46 —— 改成主盘那张「棋盘侧边」滑杆的值（默认 `DEFAULT_BOARD_MARGIN` = 34）；
 *  ② 四边坐标用主盘同一个 `coordinateLayout()`（字号也随主盘「坐标字号」）；
 *  ③ 子半径与点击热区走主盘公式（格距 43% / 热区×1.14 且不越相切线），并随主盘「棋子大小」档缩放。
 *  ⚠ 这一批数字**不许再各写一份**：全部从 `src/features/settings/*` 引，主盘改一处挑战盘自动跟上
 *  （这正是 10-05 那次错位的教训）。所以这里是**工厂**而不是一堆常量 —— 每个用户每种设置一套几何。
 */
export const VCF_VIEWBOX = BOARD_VIEWBOX;
export const VCF_STAR_R = 4.2;

export interface VcfGeometryOptions {
  /** 棋盘侧边（打谱「棋盘侧边」滑杆；默认 34，随坐标字号收敛到合法区间）。 */
  margin?: number;
  /** 坐标字号（打谱「坐标字号」；默认 12）。 */
  coordinateFontSize?: number;
  /** 棋子大小档（打谱「棋子大小」滑杆，1 = 默认；上限仍被相切线兜住）。 */
  stoneScale?: number;
  /**
   * 棋盘**路数**（默认 15 = 挑战盘）。2026-10-11 加：每日一题是**独立页**，
   * 而题库里的题可以是 5–30 路（`Puzzle.boardSize`），所以几何必须能按路数现算。
   *
   * ⚠ 视野仍是固定的 572 —— 路数变了改的是**格距**，不是画布。
   * 这一条不能反：材质外观（`src/appearance`）是照 572 空间画的，
   * 换视野会让「按 572 算的材质」和「按新网格画的线」两套坐标错位
   * （2026-10-05 那次「棋子都不在格子里」就是这个原因，见文件头）。
   */
  size?: number;
}

export interface VcfGeometry {
  viewBox: number;
  /** 这一份几何对应的棋盘路数（15 = 挑战盘；每日一题页会传题目的路数）。 */
  size: number;
  margin: number;
  cell: number;
  coordinateFontSize: number;
  coord: CoordinateLayout;
  stoneR: number;
  hitR: number;
  starR: number;
  numFont: number;
  numDy: number;
  /** 第 i 条线的坐标（列与行共用）：网格、子心、手数锚点、点击命中都取它。 */
  line: (i: number) => number;
}

/** 路数兜底：题库里可能存着越界的旧值（导入的第三方 JSON 不做校验那一步），
 *  夹到 5–30 免得算出零格距或负半径。 */
const normalizeSize = (value?: number): number =>
  Number.isInteger(value) && (value as number) >= 5 && (value as number) <= 30 ? (value as number) : VCF_SIZE;

export const vcfGeometry = (options: VcfGeometryOptions = {}): VcfGeometry => {
  const coordinateFontSize = Number.isFinite(options.coordinateFontSize) && (options.coordinateFontSize as number) > 0
    ? (options.coordinateFontSize as number)
    : DEFAULT_COORDINATE_FONT_SIZE;
  // 与主盘同一条收敛：字号越大，侧边最小档越宽；上限永远是主盘默认 34。
  const margin = clampBoardMargin(options.margin, coordinateFontSize);
  const size = normalizeSize(options.size);
  const cell = (VCF_VIEWBOX - margin * 2) / (size - 1);
  const stoneR = stoneRadiusFor(cell, clampStoneScale(options.stoneScale ?? DEFAULT_STONE_SCALE));
  return {
    viewBox: VCF_VIEWBOX,
    size,
    margin,
    cell,
    coordinateFontSize,
    coord: coordinateLayout(margin, coordinateFontSize),
    stoneR,
    hitR: stoneHitRadiusFor(cell, clampStoneScale(options.stoneScale ?? DEFAULT_STONE_SCALE)),
    starR: VCF_STAR_R,
    /** 手数字号与基线偏移：照主盘 `.move-number` 的公式（r×0.64 / r×0.28）。 */
    numFont: Math.max(8, stoneR * 0.64),
    numDy: stoneR * 0.28,
    line: (i: number) => margin + i * cell,
  };
};

/**
 * 星位（天元 + 四角星）。**与主盘同一条口径**（App.tsx 里 Board 的 starPoints）。
 *
 * 抽到这里是因为每日一题页也要画（题目的路数不固定），而"各地各写一份星位表"
 * 迟早会出现"15 路有星、19 路没有"这种不一致。
 */
export const starPointsFor = (size: number): Array<[number, number]> => {
  const s = normalizeSize(size);
  if (s === 15) return [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
  if (s === 19) return [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]];
  const center = Math.floor(s / 2);
  return [[center, center]];
};

/** 默认档（没接设置时的兜底，也是单测的基准）。 */
export const DEFAULT_VCF_GEOMETRY = vcfGeometry();
