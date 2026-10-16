import type { CSSProperties, ReactNode } from "react";
import type { BoardMarkStyle } from "./types";
import {
  MOON_MARK_PATH, SOLID_MARK_STYLES, STAR_MARK_PATH, SUN_MARK_CORE_RADIUS, SUN_MARK_RAYS,
  markShapeGeometry, markSquareGeometry,
} from "./annotation-presets";

/**
 * 标注图形的**唯一**渲染实现，预览与棋盘共用。
 *
 * 这里修掉两个真 bug：
 *  ① 预览与棋盘各画一套，棋盘的 else 分支把圆圈/三角都画成叉 → 共用一份几何。
 *  ② 棋盘用属性 `stroke={color}` 传色，而 CSS `.board-mark{stroke:#be4035}` 会覆盖
 *     SVG 呈现属性 → 颜色选择器在棋盘上完全无效（实测紫色标注算出 rgb(190,64,53)）。
 *     所以颜色一律走**内联 style**，内联优先级高于样式表。
 *  ③ 「内容＝无」时不能退回画个占位字（以前会写 "?"）→ 没有文字就只画图案。
 *  ④ 文字类出口必须**内联**关掉描边（`stroke:none` + `paint-order:normal`）。`.renlib-variation-label`
 *     自带 3px 白描边（给变化说明护底），原生标注靠 `.renlib-native-label` 关掉；用户标注 09-17
 *     为了修颜色去掉了那个类，描边就回来了 → 用户报「我的标注有高亮」。**只改 CSS 关不掉**：
 *     `styles.css` 后面 board 样式块还有一条同特异性的 `paint-order:stroke` 会盖回来，内联才压得住。
 *
 * **不做底圆盘、不做光环**（用户 09-17 明确要求撤掉：「现在不研究这个功能了，只要能用就行」）。
 * 曾经试过两条可见性兜底，都撤了：
 *  · 白色光环：深色棋盘上保住可见性，但 6.5px 的白边把用户选的颜色淹掉（看着像白的）。
 *  · 浅色底圆盘：对局软件确实这么做，但它们的圆盘与棋盘**同色**才显得"透明"；
 *    我们若固定用浅色，在木色棋盘上会糊出一片白（用户原话「白茫茫的，看着很奇怪」）。
 * 现在的做法是让**默认标注色本身足够醒目**（朱红，见 ANNOTATION_DEFAULT_COLOR），
 * 各个棋盘上都分得开，于是不需要任何兜底装饰。
 */
export interface MarkShapeProps {
  style: BoardMarkStyle;
  color: string;
  /** 形状半径（半个外接尺寸）。棋盘传棋子半径量级，预览传固定值。 */
  r: number;
  strokeWidth?: number;
  /** 叠在图形上的文字；空串表示「只画图案」。 */
  label?: string;
  /** 文字节点：棋盘沿用既有 CSS 类字号契约，预览用固定字号。二者传其一。 */
  labelClassName?: string;
  labelFontSize?: number;
}

/** 实心色块上的文字要反色，否则同色压同色看不见。 */
const isLightColor = (color: string): boolean => {
  const hex = color.trim().replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
};

export function MarkShape({ style, color, r, strokeWidth = 2.6, label = "", labelClassName, labelFontSize }: MarkShapeProps) {
  const solid = SOLID_MARK_STYLES.has(style);
  const text = Array.from(label).slice(0, 4).join("");
  const textColor = solid ? (isLightColor(color) ? "#1d1c19" : "#ffffff") : color;
  // 内联样式压过 `.board-mark` 的 stroke/fill/stroke-width（否则颜色选择器无效）。
  const paint = (fill: string, stroke: string, width?: number): CSSProperties =>
    ({ fill, stroke, strokeWidth: width, pointerEvents: "none" });

  // 文字类标注**不能带白色描边**。`.renlib-variation-label` 自带
  // `paint-order:stroke;stroke:#fff9;stroke-width:3px`（给变化说明护底用的），原生标注靠
  // `.renlib-native-label{paint-order:normal;stroke:none}` 关掉它。用户标注去掉那个类之后
  // 描边就回来了 —— 看起来就是「我的标注有高亮」（用户 09-17 实测报的第二个问题）。
  // 这里用**内联样式**关，因为它压得住任何样式表改动（同一份几何还要给面板预览用，
  // 预览那条不带类，本来就无描边）。
  const noHalo: CSSProperties = { stroke: "none", paintOrder: "normal" };

  if (style === "text") {
    return labelClassName
      ? <text x={0} y={0} className={labelClassName} style={{ fill: color, ...noHalo }}>{text || "?"}</text>
      : <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={labelFontSize ?? r * 1.25} fontWeight={800} style={{ fill: color, ...noHalo }}>{text || "A"}</text>;
  }

  const labelNode: ReactNode = text
    ? (labelClassName
      ? <text x={0} y={0} className={labelClassName} style={{ fill: textColor, ...noHalo }}>{text}</text>
      : <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={labelFontSize ?? r * 1.05} fontWeight={800} style={{ fill: textColor, ...noHalo }}>{text}</text>)
    : null;

  if (style === "star") {
    const scale = r / 21;
    return <g>
      <path d={STAR_MARK_PATH} transform={`scale(${scale})`} style={paint("none", color, strokeWidth / scale)} strokeLinejoin="round"/>
      {labelNode}
    </g>;
  }

  if (style === "sun") {
    const scale = r / 23;
    return <g>
      <circle r={SUN_MARK_CORE_RADIUS} style={paint("none", color, strokeWidth / scale)}/>
      <g style={paint("none", color, strokeWidth / scale)}>{SUN_MARK_RAYS.map(([x1, y1, x2, y2], ray) => <line key={ray} x1={x1} y1={y1} x2={x2} y2={y2}/>)}</g>
      {labelNode}
    </g>;
  }

  if (style === "moon") {
    const scale = r / 20;
    return <g>
      <path d={MOON_MARK_PATH} transform={`scale(${scale})`} style={paint("none", color, strokeWidth / scale)} strokeLinejoin="round"/>
      {labelNode}
    </g>;
  }

  if (style === "circle" || style === "circle-solid") {
    return <g>
      {solid
        ? <circle r={r * 0.92} style={paint(color, "none")}/>
        : <circle r={r * 0.86} style={paint("none", color, strokeWidth)}/>}
      {labelNode}
    </g>;
  }

  if (style === "square-solid") {
    const square = markSquareGeometry(r);
    return <g>
      <rect x={square.x} y={square.y} width={square.size} height={square.size} rx={square.radius} style={paint(color, "none")}/>
      {labelNode}
    </g>;
  }

  // 三角 / 菱形 / 叉 / 对勾：几何在 markShapeGeometry 里，实心与否只切 fill。
  const geometry = markShapeGeometry(style, r);
  if (geometry.d) {
    const hollow = style === "check" || style === "cross" || style === "triangle";
    return <g>
      <path
        d={geometry.d}
        style={paint(hollow ? "none" : color, color, strokeWidth)}
        strokeLinejoin="round"
        strokeLinecap={style === "check" ? "round" : "butt"}
      />
      {labelNode}
    </g>;
  }

  // 兜底：认不出的画法画成圆圈，绝不画成叉（避免再次出现「选圆圈变叉」）。
  return <g>
    <circle r={r * 0.86} style={paint("none", color, strokeWidth)}/>
    {labelNode}
  </g>;
}
