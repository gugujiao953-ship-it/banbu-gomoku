import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest executes this contract test in Node; the browser app intentionally does not ship Node typings.
import { readFileSync } from "node:fs";

const tokens = readFileSync(new URL("./design-tokens.css", import.meta.url), "utf8");
const previews = readFileSync(new URL("./library.css", import.meta.url), "utf8");

const luminance = (hex: string) => {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => parseInt(value, 16) / 255) || [];
  const linear = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};
const contrast = (left: string, right: string) => {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

describe("porcelain theme contract", () => {
  it("defines warm porcelain, pattern, cobalt, indigo and navy tokens", () => {
    expect(tokens).toContain("--porcelain-white: #f8f5ed");
    expect(tokens).toContain("--porcelain-pattern: #b8d1dd");
    expect(tokens).toContain("--porcelain-cobalt: #1d5688");
    expect(tokens).toContain("--porcelain-indigo: #123f73");
    expect(tokens).toContain("--porcelain-navy: #102b4a");
  });

  it("keeps body text and primary controls at WCAG AA contrast", () => {
    expect(contrast("#102b4a", "#f8f5ed")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#1d5688")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#123f73", "#d8e7ee")).toBeGreaterThanOrEqual(4.5);
  });

  it("updates both theme and board preview cards with deeper cobalt structure", () => {
    expect(previews).toMatch(/theme-swatch\.porcelain[^}]+#1d5688/);
    expect(previews).toMatch(/board-preview\.porcelain[^}]+#315f84/);
  });
});
