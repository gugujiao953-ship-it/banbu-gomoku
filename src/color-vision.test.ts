import { describe, expect, it } from "vitest";
import { ANNOTATION_COLORS } from "./annotation-presets";
import { COLOR_VISION_FRIENDLY_COLORS, friendlyAnnotationColor, friendlyAnnotationPalette } from "./color-vision";

/** 相对亮度（WCAG），用来验证「拉明度」这件事真的做到了。 */
const luminance = (hex: string) => {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("色觉友好配色", () => {
  it("默认色板里的每一个替代值都是合法十六进制", () => {
    for (const [from, to] of Object.entries(COLOR_VISION_FRIENDLY_COLORS)) {
      expect(from).toMatch(/^#[0-9a-f]{6}$/);
      expect(to).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("每个替代值都对应色板里真实存在的颜色（防色板改动后替代值变成孤儿）", () => {
    const palette = new Set(ANNOTATION_COLORS.map(([color]) => color.toLowerCase()));
    for (const from of Object.keys(COLOR_VISION_FRIENDLY_COLORS)) {
      expect(palette.has(from), `${from} 不在 ANNOTATION_COLORS 里`).toBe(true);
    }
  });

  it("最容易糊的三对颜色被拉开：对比度明显提升", () => {
    const pairs: Array<[string, string]> = [
      ["#b94b3f", "#365e4b"], // 朱红 vs 松绿
      ["#b27b18", "#6b4f3a"], // 金 vs 棕
      ["#b04474", "#7b4fb3"], // 莓红 vs 紫
    ];
    for (const [a, b] of pairs) {
      const before = contrast(a, b);
      const after = contrast(friendlyAnnotationColor(a), friendlyAnnotationColor(b));
      expect(after, `${a}/${b} 的对比度没有变好：${before.toFixed(2)} → ${after.toFixed(2)}`).toBeGreaterThan(before);
    }
  });

  it("没登记的色值原样返回（不动墨黑/石墨这类本来就安全的颜色）", () => {
    expect(friendlyAnnotationColor("#1d1c19")).toBe("#1d1c19");
    expect(friendlyAnnotationColor("#2872b8")).toBe("#2872b8");
    expect(friendlyAnnotationColor("#7d8790")).toBe("#7d8790");
  });

  it("大小写不敏感，且色板转换后仍与色板一一对应", () => {
    expect(friendlyAnnotationColor("#B94B3F")).toBe(COLOR_VISION_FRIENDLY_COLORS["#b94b3f"]);
    const converted = friendlyAnnotationPalette(ANNOTATION_COLORS);
    expect(converted).toHaveLength(ANNOTATION_COLORS.length);
    expect(converted.map(([, label]) => label)).toEqual(ANNOTATION_COLORS.map(([, label]) => label));
  });
});
