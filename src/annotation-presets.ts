import type { BoardMarkKind, BoardMarkStyle } from "./types";

/** 标注内容类型：决定「内容框」里给出哪一组候选字符。 */
export type AnnotationMarkType = "none" | "number" | "letter" | "conclusion" | "common" | "custom";

export interface AnnotationTypePreset {
  id: AnnotationMarkType;
  label: string;
  hint: string;
  values: readonly string[];
  /** 切换到该类型时的默认内容。 */
  fallback: string;
}

export const ANNOTATION_TYPES: readonly AnnotationTypePreset[] = [
  // 「无」= 只画图案、不带任何文字。放在第一个：勾/叉/圆/方这类纯图形标注是最常用的。
  { id: "none", label: "无", hint: "只画图案，不带文字", values: [], fallback: "" },
  { id: "number", label: "数字", hint: "手序 1–9", values: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], fallback: "1" },
  { id: "letter", label: "字母", hint: "大写 A–E · 小写 a–e", values: ["A", "B", "C", "D", "E", "a", "b", "c", "d", "e"], fallback: "A" },
  { id: "conclusion", label: "局面结论", hint: "胜 败 平 衡 攻 守 要 疑", values: ["胜", "败", "平", "平衡", "攻", "守", "要", "疑"], fallback: "胜" },
  { id: "common", label: "常用组", hint: "a b c h # 等约定记号", values: ["a", "b", "c", "h", "#"], fallback: "a" },
  { id: "custom", label: "自定义", hint: "手输最多 4 个字符", values: [], fallback: "" },
];

export const annotationTypePreset = (type: AnnotationMarkType): AnnotationTypePreset =>
  ANNOTATION_TYPES.find((preset) => preset.id === type) || ANNOTATION_TYPES[0];

export interface AnnotationStylePreset {
  id: BoardMarkStyle;
  label: string;
}

/** 样式清单：几何形状在棋盘上用 SVG 绘制，避免依赖系统字形的 emoji 回退。
 *  实心一组（勾/叉/圆/方/菱）对齐常见五子棋软件的简洁记号，配合内容「无」使用最干净。 */
export const ANNOTATION_STYLES: readonly AnnotationStylePreset[] = [
  { id: "text", label: "文字" },
  { id: "check", label: "对勾" },
  { id: "cross", label: "叉号" },
  { id: "circle", label: "圆圈" },
  { id: "circle-solid", label: "实心圆" },
  { id: "triangle", label: "三角" },
  { id: "triangle-solid", label: "实心三角" },
  { id: "square-solid", label: "实心方块" },
  { id: "diamond", label: "菱形" },
  { id: "star", label: "五角星" },
  { id: "sun", label: "太阳" },
  { id: "moon", label: "月亮" },
];

export const ANNOTATION_COLORS: readonly (readonly [string, string])[] = [
  ["#1d1c19", "墨黑"],  ["#4f5357", "石墨"],
  ["#2872b8", "蓝"],
  ["#0f766e", "青"],
  ["#365e4b", "松绿"],
  ["#6b4f3a", "棕"],
  ["#b27b18", "金"],
  ["#c46a20", "橙"],
  ["#b94b3f", "朱红"],
  ["#b04474", "莓红"],
  ["#7b4fb3", "紫"],
  ["#7d8790", "雾灰"],
];

/** 五角星路径（外接半径 21，内切 9），原点为中心。 */
export const STAR_MARK_PATH = "M0 -21L5.3 -7.3L20 -6.5L8.6 2.8L12.3 17L0 9L-12.3 17L-8.6 2.8L-20 -6.5L-5.3 -7.3Z";
/** 月牙路径：外弧半径 20 + 内弧半径 26，开口朝右。 */
export const MOON_MARK_PATH = "M0 -20A20 20 0 0 0 0 20A26 26 0 0 1 0 -20Z";
/** 太阳：核心圆 + 8 道光芒线段（原点为中心）。 */
export const SUN_MARK_CORE_RADIUS = 11;
export const SUN_MARK_RAYS: readonly (readonly [number, number, number, number])[] = Array.from({ length: 8 }, (_, index) => {
  const angle = (Math.PI / 4) * index;
  return [Math.cos(angle) * 16, Math.sin(angle) * 16, Math.cos(angle) * 23, Math.sin(angle) * 23] as const;
});

/**
 * 形状语义映射：**这是 style → SGF 属性的唯一出处**。
 *
 * 修的是一个真 bug：以前 UI 建标注时把 `kind` 一律写成 "label"，而 SGF 导出按
 * `kind` 选属性，于是圆圈/三角/叉全被写成 `LB[xx:?]`——导出到任何别的软件都只剩
 * 一个问号。形状必须由所选的画法推导语义，不能恒为 label。
 *
 * `check`（对勾）在 SGF 里没有对应图形，退化成 MA（通用的「已标记」）——这是有意
 * 选的降级：点仍然被标记，且所有读取器都认；写进 LB 反而会污染文字标注的语义。
 */
export const MARK_KIND_FOR_STYLE: Readonly<Record<BoardMarkStyle, BoardMarkKind>> = {
  text: "label",
  circle: "circle",
  "circle-solid": "circle",
  triangle: "triangle",
  "triangle-solid": "triangle",
  "square-solid": "square",
  diamond: "square",
  cross: "cross",
  check: "check",
  // 装饰性形状没有对应的 SGF 属性，归到通用标记 MA。
  star: "cross",
  sun: "cross",
  moon: "cross",
};

/** kind → SGF 属性名。square 用标准的 SQ；check 无标准属性，退化成 MA。 */
export const MARK_SGF_PROPERTY: Readonly<Record<BoardMarkKind, "CR" | "TR" | "SQ" | "MA" | "LB">> = {
  circle: "CR",
  triangle: "TR",
  square: "SQ",
  cross: "MA",
  check: "MA",
  label: "LB",
};

/** SGF 属性名 → kind（导入用）。MA 同时覆盖 cross/check，按 cross 读回是刻意的：
 *  对勾在 SGF 里本来就是 MA，无法区分。 */
export const MARK_KIND_FOR_SGF_PROPERTY: Readonly<Record<"CR" | "TR" | "SQ" | "MA", BoardMarkKind>> = {
  CR: "circle",
  TR: "triangle",
  SQ: "square",
  MA: "cross",
};

export const markKindForStyle = (style: BoardMarkStyle | undefined, fallback: BoardMarkKind = "label"): BoardMarkKind =>
  style ? MARK_KIND_FOR_STYLE[style] ?? fallback : fallback;

/** 只有语义没有画法时的默认画法（老文档、从 SGF 导入、原生标注等）。
 *  注意 kind 里的 "square"/"check" 不是合法 style，直接拿 kind 当 style 会画错。 */
export const DEFAULT_STYLE_FOR_KIND: Readonly<Record<BoardMarkKind, BoardMarkStyle>> = {
  circle: "circle",
  triangle: "triangle",
  square: "square-solid",
  cross: "cross",
  check: "check",
  label: "text",
};

export const styleForMark = (mark: { style?: BoardMarkStyle; kind: BoardMarkKind }): BoardMarkStyle =>
  mark.style ?? DEFAULT_STYLE_FOR_KIND[mark.kind] ?? "text";

/** 标注的中文名，用于搜索串与无障碍说明。以前这段映射在 App 与 compact-index
 *  各写了一份，新增画法后就退化成兜底的「叉号」——收到这里就不会再漏。 */
export const markStyleLabel = (mark: { style?: BoardMarkStyle; kind: BoardMarkKind; label?: string }): string => {
  if (mark.kind === "label" && !mark.style) return mark.label || "文字标注";
  return ANNOTATION_STYLES.find((item) => item.id === styleForMark(mark))?.label || "标注";
};


/** 实心填充类画法：需要在上面写字时得换成反差色，否则文字看不见。 */
export const SOLID_MARK_STYLES: ReadonlySet<BoardMarkStyle> = new Set<BoardMarkStyle>(["circle-solid", "triangle-solid", "square-solid", "diamond"]);

/** 相对字形半径 r 的形状几何，预览与棋盘共用，避免两边画得不一样。 */
export const markShapeGeometry = (style: BoardMarkStyle, r: number) => {
  const triangle = `M0 ${-r}L${-r * 0.882} ${r * 0.706}L${r * 0.882} ${r * 0.706}Z`;
  switch (style) {
    case "triangle":
    case "triangle-solid":
      return { d: triangle };
    case "diamond":
      return { d: `M0 ${-r}L${r * 0.86} 0L0 ${r}L${-r * 0.86} 0Z` };
    case "check":
      return { d: `M${-r * 0.84} ${r * 0.04}L${-r * 0.2} ${r * 0.7}L${r * 0.86} ${-r * 0.76}` };
    case "cross":
      return { d: `M${-r * 0.8} ${-r * 0.8}L${r * 0.8} ${r * 0.8}M${r * 0.8} ${-r * 0.8}L${-r * 0.8} ${r * 0.8}` };
    default:
      return {};
  }
};

/** 相对字形半径 r 的方块几何（■）。 */
export const markSquareGeometry = (r: number) => ({ x: -r * 0.78, y: -r * 0.78, size: r * 1.56, radius: r * 0.1 });

