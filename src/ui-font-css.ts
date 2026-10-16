const FONT_DECLARATION = /\b(font-size|font)\s*:\s*([^;}]+)/g;
const PIXEL_VALUE = /(-?(?:\d*\.)?\d+)px\b/g;
/** 写在声明值里的注释标记：这条字号不参与界面字号缩放，给 SVG 内部按用户单位排版的文字用。 */
const NO_SCALE = /\/\*\s*no-scale\s*\*\//;

export const scaleUiFontDeclarations = (css: string) => css.replace(
  FONT_DECLARATION,
  (declaration, property: string, value: string) => {
    if (NO_SCALE.test(value) || !PIXEL_VALUE.test(value) || value.includes("--ui-font-scale")) {
      PIXEL_VALUE.lastIndex = 0;
      return declaration;
    }
    PIXEL_VALUE.lastIndex = 0;
    return `${property}:${value.replace(PIXEL_VALUE, "calc($1px * var(--ui-font-scale, 1))")}`;
  },
);
