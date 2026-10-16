// @ts-expect-error Node is available to Vitest, not the browser application.
import { readFileSync, readdirSync, statSync } from "node:fs";
// @ts-expect-error 同上：应用侧故意不挂 Node 类型，这条约定在本仓库每个读文件的测试里都有。
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CSS 里多一个 `}` 是**静默**的：浏览器不会报错，它按错误恢复把「紧跟其后的那一条规则」
 * 整条丢掉。2026-10-13 撤对弈道具栏时就在 `game-screen.css` 留了一个孤零零的 `}`，
 * 被吞掉的正好是 `.duel-actions{display:grid;grid-template-columns:…}` ——
 * 表现是操作条从一行 44px 变成五排 220px，整页多出 176px 可滚（`scripts/ui-duel-screen-check`
 * 的 F3/F5/F9c 三条红）。而对弈界面的门禁当时全绿：摆子阶段那几行本来就不渲染，
 * 这条坏规则在该屏上看不见。所以补一条**读文件**的静态检查，不靠某一屏的截图。
 */
const cssFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) cssFiles(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
};

/** 注释里可以有任何字符（本项目大量中文注释里带花括号），所以先把 block comment 整段剥掉再数。 */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

describe("样式文件的花括号平衡", () => {
  const files = cssFiles("src").sort();

  it("src 下确实扫到了一批 .css（不是空跑）", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(`${file}：括号配对，且中间从不预先闭合`, () => {
      const css = stripComments(readFileSync(file, "utf8"));
      let depth = 0;
      let firstNegativeLine = 0;
      let line = 1;
      for (const ch of css) {
        if (ch === "\n") line += 1;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth < 0 && !firstNegativeLine) firstNegativeLine = line;
        }
      }
      // 具体行号比「不平衡」三个字有用得多：这条测试的价值就是让人不用再去逐个文件找。
      expect(`${depth}${firstNegativeLine ? ` (第 ${firstNegativeLine} 行提前闭合)` : ""}`).toBe("0");
    });
  }
});
