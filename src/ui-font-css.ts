const FONT_DECLARATION = /\b(font-size|font)\s*:\s*([^;}]+)/g;
const PIXEL_VALUE = /(-?(?:\d*\.)?\d+)px\b/g;

export const scaleUiFontDeclarations = (css: string) => css.replace(
  FONT_DECLARATION,
  (declaration, property: string, value: string) => {
    if (!PIXEL_VALUE.test(value) || value.includes("--ui-font-scale")) {
      PIXEL_VALUE.lastIndex = 0;
      return declaration;
    }
    PIXEL_VALUE.lastIndex = 0;
    return `${property}:${value.replace(PIXEL_VALUE, "calc($1px * var(--ui-font-scale, 1))")}`;
  },
);
