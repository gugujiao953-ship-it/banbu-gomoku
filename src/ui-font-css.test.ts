import { describe, expect, it } from "vitest";
import { scaleUiFontDeclarations } from "./ui-font-css";

describe("全局字号 CSS 转换", () => {
  it("缩放 font-size 和 font 简写中的像素字号", () => {
    const source = ".a{font-size:10px;width:10px}.b{font:700 clamp(21px,6vw,27px) serif}.c{font:inherit}";
    expect(scaleUiFontDeclarations(source)).toBe(
      ".a{font-size:calc(10px * var(--ui-font-scale, 1));width:10px}.b{font:700 clamp(calc(21px * var(--ui-font-scale, 1)),6vw,calc(27px * var(--ui-font-scale, 1))) serif}.c{font:inherit}",
    );
  });

  it("不会重复包裹已经接入缩放变量的声明", () => {
    const source = ".a{font-size:calc(10px * var(--ui-font-scale, 1))}";
    expect(scaleUiFontDeclarations(source)).toBe(source);
  });

  it("带 no-scale 标记的声明保持原样（SVG 用户单位里的文字）", () => {
    const source = ".a text{font-size:10px /* no-scale */;font:700 12px serif /* no-scale */}.b{font-size:11px}";
    expect(scaleUiFontDeclarations(source)).toBe(
      ".a text{font-size:10px /* no-scale */;font:700 12px serif /* no-scale */}.b{font-size:calc(11px * var(--ui-font-scale, 1))}",
    );
  });
});
