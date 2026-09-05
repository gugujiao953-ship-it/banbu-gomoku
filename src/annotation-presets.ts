import type { BoardMarkStyle } from "./types";

/** 标注内容类型：决定「内容框」里给出哪一组候选字符。 */
export type AnnotationMarkType = "number" | "letter" | "conclusion" | "common" | "custom";

export interface AnnotationTypePreset {
  id: AnnotationMarkType;
  label: string;
  hint: string;
  values: readonly string[];
  /** 切换到该类型时的默认内容。 */
  fallback: string;
}

export const ANNOTATION_TYPES: readonly AnnotationTypePreset[] = [
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

/** 样式清单：几何形状在棋盘上用 SVG 绘制，避免依赖系统字形的 emoji 回退。 */
export const ANNOTATION_STYLES: readonly AnnotationStylePreset[] = [
  { id: "text", label: "文字" },
  { id: "circle", label: "圆圈" },
  { id: "triangle", label: "三角" },
  { id: "cross", label: "叉号" },
  { id: "star", label: "五角星" },
  { id: "sun", label: "太阳" },
  { id: "moon", label: "月亮" },
];

export const ANNOTATION_COLORS: readonly (readonly [string, string])[] = [
  ["#1d1c19", "墨黑"],
  ["#4f5357", "石墨"],
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
