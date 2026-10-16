/** 把一条材质记录渲染成本体的棋盘 SVG 片段。
 *
 *  ⚠ 几何差异是这里所有折中的根源：
 *      实验室 `预览/playable.html` 固定 viewBox 620×620、固定 15 路、边距写死 46；
 *      本体是 viewBox 572×572、5–21 路、边距还能被用户调（`clampBoardMargin`）。
 *    所以分两类处理：
 *      · **与几何无关的**（盘底色、线色/线宽/线透明、星色、defs、棋子、动效 CSS）
 *        直接照数据出，任何路数都对。
 *      · **带坐标的装饰**（外框、题字、印章、边角纹）按 `572/620` 缩放后整组出，
 *        并且**只在 15 路时出** —— 那些东西是照着 15×15 的格子摆的，
 *        换路数就会飘到格子外面去，宁可没有也不要错位。
 *
 *  刻意不动 `App.tsx` 里已有的 `.board-X` CSS 那条路：新材质的 id 没有对应 CSS 规则，
 *  两条路互不覆盖（CSS 优先级高于呈现属性，混用会让旧规则悄悄盖掉数据）。 */
import type { BoardMaterial, StoneMaterial } from "./types";
import { SKINS } from "./index";
import { deriveBoards, deriveStones } from "./derive";

const LAB_VIEWBOX = 620;
const APP_VIEWBOX = 572;
/** 实验室的网格是写死的：15 路、边距 46 → 间距 (620-92)/14。
 *  本体的边距和路数都是活的，所以材质里"钉在格子上"的东西不能按视野等比缩放，
 *  必须按网格换算 —— 否则两套线间距差 3%，边角上就错开一整格，看着就是断断续续。 */
const LAB_PAD = 46;
const LAB_GAP = (LAB_VIEWBOX - LAB_PAD * 2) / 14;
/** 盘边框、题字这类"钉在盘边上"的装饰：按视野等比缩放就够 */
const EDGE_SCALE = APP_VIEWBOX / LAB_VIEWBOX;

/** 把实验室 620 空间里的点映射到本体当前的网格上。 */
const gridTransform = (margin: number, gap: number) => {
  const k = gap / LAB_GAP;
  return `translate(${(margin - LAB_PAD * k).toFixed(3)} ${(margin - LAB_PAD * k).toFixed(3)}) scale(${k.toFixed(5)})`;
};

/** 带坐标的装饰只在这些路数下出（实验室就是 15 路） */
const LAB_BOARD_SIZE = 15;

let cachedBoards: BoardMaterial[] | null = null;
let cachedStones: StoneMaterial[] | null = null;

export function materialBoards(): BoardMaterial[] {
  if (!cachedBoards) cachedBoards = deriveBoards(SKINS);
  return cachedBoards;
}

export function materialStones(): StoneMaterial[] {
  if (!cachedStones) cachedStones = deriveStones(SKINS);
  return cachedStones;
}

const bySrc = <T extends { src: string }>(list: T[]) => {
  const m = new Map<string, T>();
  for (const x of list) m.set(x.src, x);
  return m;
};
let boardIndex: Map<string, BoardMaterial> | null = null;
let stoneIndex: Map<string, StoneMaterial> | null = null;

/** 按**皮肤 id**（本体的 theme 值就用它）取材质；没有这条记录就返回 null，
 *  调用方回落到旧的 `.board-X` CSS 那条路。
 *  ⚠ 本体移植那批皮肤的 id 带 `app-` 前缀（`app-wood`），而本体的 theme 值是 `wood`，
 *     所以查不到时要再试一次 `app-<theme>` —— 否则 14 套老材质会静默走回 CSS 那条路，
 *     看起来"改了没生效"。 */
export function findBoardMaterial(theme: string): BoardMaterial | null {
  if (!boardIndex) boardIndex = bySrc(materialBoards());
  return boardIndex.get(theme) ?? boardIndex.get(`app-${theme}`) ?? null;
}

export function findStoneMaterial(theme: string): StoneMaterial | null {
  if (!stoneIndex) stoneIndex = bySrc(materialStones());
  return stoneIndex.get(theme) ?? stoneIndex.get(`app-${theme}`) ?? null;
}

/** 盘底 + 装饰层。返回一段 SVG 字符串，由调用方交给 `src/appearance/svg-html.tsx` 的
 *  `<SvgHtml>` 注入（**不能**用 `dangerouslySetInnerHTML`：React 19 每次提交都重写它，
 *  材质层整段重挂、盘面的循环动效会从 0 重播），这样实验室那份 `defs/overlay/frame`
 *  原文不用翻成 JSX（它们是字符串，不是元素）。
 *  ⚠ margin/gap 必须传进来：钉在格子上的装饰要按本体的实际网格换算，
 *     按视野等比缩放会和本体自己画的网格错开（用户报的"线断断续续"就是这个）。 */
export function boardLayers(mat: BoardMaterial, boardSize: number, margin: number, gap: number): string {
  const out: string[] = [];
  if (mat.defs) out.push(`<defs>${mat.defs}</defs>`);
  out.push(`<rect x="4" y="4" width="564" height="564" rx="${mat.radius ?? 18}" fill="${mat.fill ?? "none"}"/>`);
  if (mat.overlay) out.push(`<g transform="scale(${EDGE_SCALE.toFixed(4)})">${mat.overlay}</g>`);
  if (mat.frame) out.push(`<g transform="scale(${EDGE_SCALE.toFixed(4)})">${mat.frame}</g>`);
  if (mat.gridExtra && boardSize === LAB_BOARD_SIZE) {
    out.push(`<g transform="${gridTransform(margin, gap)}">${mat.gridExtra}</g>`);
  }
  return out.join("");
}

/** 网格线与星位要按本体的真实几何现算（路数、边距都会变），只借用材质给的颜色。 */
export function boardLineProps(mat: BoardMaterial): { stroke: string; width: number; opacity: number; star: string; starOpacity?: number } {
  return {
    stroke: mat.lineStroke || "#594a36",
    width: mat.lineW ?? 1.25,
    opacity: mat.lineOpacity ?? 0.86,
    star: mat.starFill || (mat.lineStroke || "#594a36"),
    starOpacity: mat.starOpacity,
  };
}

/** 一颗子。`r` 由本体的几何算出来后传进来，材质的 stone() 只认坐标和半径。 */
export function stoneMarkup(mat: StoneMaterial, x: number, y: number, r: number, player: 1 | 2, isLast: boolean, isWin: boolean): string {
  return mat.stone({ x, y, r, player, isLast, isWin });
}

/** 材质自带的动效 CSS：选择器里的 `#board` 得换成本体棋盘的实际限定，
 *  实验室那份是按 `#board .xxx` 写的。 */
export function motionCss(motions: { css: (id: string) => string }[], id: string, on: boolean): string {
  if (!on || !motions.length) return "";
  return motions.map((m) => m.css(id)).join("\n");
}

/** 本体现有的主题：它们走 `styles.css` 里 `.board-X` / `.stones-X` 那条老路。
 *
 *  ⚠ 这批**不能**同时再走数据路 —— CSS 的优先级高于呈现属性，两条一起用会被旧规则
 *     悄悄盖掉，表现是"改了数据没反应"。所以这里显式列一份，`newMaterialBoard()`
 *     只服务实验室新增的那批。等某一套改成数据驱动，就从这份名单里划掉一行。 */
export const LEGACY_BOARD_THEMES = ["wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut", "frosted", "circuit", "minimal", "pale", "kawaii", "aurora"];
export const LEGACY_STONE_THEMES = ["classic", "jade", "yun", "ink", "mono", "notebook", "porcelain", "snow", "terminal", "gold-diamond", "gold", "diamond", "blackgold", "pale", "kawaii", "aurora"];

/** 只有"实验室新增、本体还没有 CSS 规则"的那批走数据路。查不到返回 null。 */
export function newMaterialBoard(theme: string): BoardMaterial | null {
  if (LEGACY_BOARD_THEMES.includes(theme)) return null;
  return findBoardMaterial(theme);
}

export function newMaterialStone(theme: string): StoneMaterial | null {
  if (LEGACY_STONE_THEMES.includes(theme)) return null;
  return findStoneMaterial(theme);
}

/** 用户点名删掉的主题：存档/备份里可能还记着，读的时候归一化到默认。
 *  ⚠ 但**不能**把它们从校验白名单里摘掉 —— `backup.ts` 的整份校验会因为一个
 *     未知值直接判整份备份非法（见改造表 R108 第四节）。 */
export const RETIRED_BOARD_THEMES: Record<string, string> = { notebook: "wood", porcelain: "wood", frosted: "wood" };
export const RETIRED_STONE_THEMES: Record<string, string> = { gold: "classic" };

export const normalizeBoardTheme = (value: string): string => RETIRED_BOARD_THEMES[value] ?? value;
export const normalizeStoneTheme = (value: string): string => RETIRED_STONE_THEMES[value] ?? value;
