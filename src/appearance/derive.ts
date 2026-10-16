/** 从「一个对象 = 一套外观」派生出「棋盘零件」和「棋子零件」两张清单。
 *  判据与实验室 `预览/parts/parts.js` 的 `derive()` 逐条对齐 —— 两边不一致的话，
 *  实验室里能挑到的外观在本体里会少（或多）出来，那种差异查起来很费时间。 */
import type { BoardMaterial, MotionScheme, Skin, StoneMaterial } from "./types";

const motionsOf = (sk: Skin, key: "boardMotions" | "stoneMotions"): MotionScheme[] =>
  (Array.isArray(sk[key]) ? sk[key] : []) as MotionScheme[];

/** 这套皮肤有没有画盘。用户点名"只删盘留子"时，这些字段会被一起删空 —— 于是
 *  不再生成棋盘零件，也就不会出现"名字写着子、画的却是回退默认盘"的假卡片。 */
export const hasBoardHalf = (sk: Skin): boolean =>
  !!(sk.boardFill || sk.frame || sk.lineStroke || sk.gridExtra || sk.boardOverlay || sk.boardMotions?.length);

/** 这套皮肤有没有子。`noStone` 是"只删子留盘"的声明位。 */
export const hasStoneHalf = (sk: Skin): boolean => !sk.noStone && typeof sk.stone === "function";

export function deriveBoards(skins: Skin[]): BoardMaterial[] {
  const out: BoardMaterial[] = [];
  for (const sk of skins) {
    if (!sk?.id || !hasBoardHalf(sk)) continue;
    out.push({
      id: `bd-${sk.id}`, src: sk.id, name: sk.name, group: sk.group || "", sub: sk.sub,
      swatch: sk.swatch, pageBg: sk.pageBg, radius: sk.radius,
      fill: sk.boardFill, overlay: sk.boardOverlay, frame: sk.frame, gridExtra: sk.gridExtra,
      lineStroke: sk.lineStroke, lineW: sk.lineW, lineOpacity: sk.lineOpacity, lineFilter: sk.lineFilter,
      starFill: sk.starFill, starR: sk.starR, starOpacity: sk.starOpacity,
      defs: sk.defs, vars: sk.vars, css: sk.css,
      motions: motionsOf(sk, "boardMotions"),
    });
  }
  return out;
}

export function deriveStones(skins: Skin[]): StoneMaterial[] {
  const out: StoneMaterial[] = [];
  for (const sk of skins) {
    if (!sk?.id || !hasStoneHalf(sk)) continue;
    out.push({
      id: `st-${sk.id}`, src: sk.id, name: sk.name, group: sk.group || "", sub: sk.sub,
      swatch: sk.swatch, stone: sk.stone as StoneMaterial["stone"],
      defs: sk.defs, vars: sk.vars, selfRim: !!sk.selfRim,
      motions: motionsOf(sk, "stoneMotions"),
    });
  }
  return out;
}

/** 给 `<svg>` 根的 CSS 自定义属性串。 */
export function varsToStyle(vars?: Record<string, string>): string {
  return Object.entries(vars || {}).map(([k, v]) => `${k}:${v}`).join(";");
}
