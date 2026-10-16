import { describe, expect, it } from "vitest";
// @ts-expect-error Node is available to Vitest, not the browser application.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const previews = readFileSync(new URL("./library.css", import.meta.url), "utf8");

describe("appearance material contracts", () => {
  it("preserves the default material while making yunzi low-gloss", () => {
    expect(source).toContain('<radialGradient id="blackStone" cx="30%" cy="24%"><stop offset="0" stopColor="#5b5a55"/><stop offset=".42" stopColor="#242420"/><stop offset="1" stopColor="#090a09"/></radialGradient>');
    expect(source).toContain('<radialGradient id="whiteStone" cx="30%" cy="24%"><stop offset="0" stopColor="#fffef8"/><stop offset=".6" stopColor="#e8e2d5"/><stop offset="1" stopColor="#aaa397"/></radialGradient>');
    expect(source).toContain('id="yunStoneShadow"');
    expect(css).toContain('.stones-yun .stone-piece { filter:url(#yunStoneShadow); }');
    expect(previews).toContain('.material-live-preview .material-preview-stone.yun::after { display:none; }');
  });
  it("keeps yunzi and blue ink palettes aligned with their previews", () => {
    for (const color of ['#343a35', '#efedde', '#3c5140', '#355a8b', '#c5d5ee']) {
      expect(source).toContain(color);
      expect(previews).toContain(color);
    }
  });
  it("only mixes diamond and gold for the mixed theme", () => {
    expect(source).toContain('const jewelMaterial = stoneTheme === "gold-diamond" ? (player === "black" ? "diamond" : "gold") : stoneTheme');
  });
  it("keeps monochrome stones outlined without gloss", () => {
    expect(css).toMatch(/.stones-mono .stone.white[^}]+stroke:#434851; stroke-width:1.65/);
    expect(css).toContain('.stones-mono .stone-piece { filter:none; }');
    expect(previews).toMatch(/.material-preview-stone.white.mono[^}]+border:1.65px solid #434851/);
  });
  it("keeps pale strata below stones and coupled to board opacity", () => {
    expect(source).toContain('fill="url(#paleStrata)" opacity={boardOpacity} pointerEvents="none"');
    // 比对的必须是**决定 SVG 里谁先谁后的使用处**：棋子标记在 10-15 抽进了 `stoneLayer` memo
    // （每次重渲染少建 ~1500 个元素），`const jewelMaterial` 的定义位置因此前移，
    // 拿它当「棋子在哪儿」的代理就不再代表渲染顺序了（源码顺序变了、画出**来**的顺序没变：
    // 实测 rect 在 115980、{stoneLayer} 在 119025）。
    expect(source.indexOf('fill="url(#paleStrata)"')).toBeLessThan(source.indexOf("{stoneLayer}"));
  });
  it("leaves the face area clear when move numbers are shown", () => {
    expect(source).toContain('{!showNumbers && <><ellipse');
    expect(source).not.toContain('className="kawaii-heart"');
  });
});
