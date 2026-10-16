/**
 * **暗色主题名单的漂移检查**（静态读 CSS，不开浏览器）。
 *
 * 起因（2026-10-15 发布前排查）：`dunhuang`（飞天敦煌）进了 `DARK_THEME_IDS`，
 * 但 CSS 里那批**手抄**的"深色主题"名单没跟着补 ⇒ 实测每日一题难度星在它上面只有
 * **1.41:1**（浅底用的深金压在深棕底上），`library.css` 那条"整壳继承文字色"也漏了它
 * （那条注释本身就写着"漏一个 = 字在深底上隐身"，pelican 当年就是这么翻的车）。
 *
 * 为什么不改成"CSS 只认一个 `data-theme-tone` 属性"：那些名单里不少规则**逐主题**还带着
 * 各自的底色值，而且 `legacy-webview.css` 不许用 `:is()`，收口一次要动 9 个文件、
 * 发布前不宜。所以留着手抄，但**由这条测试盯着**：以后新增暗色主题，
 * 改了 `theme-options.ts` 忘了改 CSS ⇒ 这里直接红。
 *
 * 判据（宁可漏报不可误报）：只看"整组主题 id **全部**属于暗色、且去重后 ≥10 个"的名单 ——
 * 那说明它想收全暗色主题；只列 6 套的老名单不算（它不是漏一个的问题）。
 */
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync, readdirSync, statSync } from "node:fs";
// @ts-expect-error 同上：应用侧故意不挂 Node 类型，这条约定在本仓库每个读文件的测试里都有。
import { join } from "node:path";

/** Node 全局：只用 `cwd()` 把绝对路径换回 `src/…`；应用侧不挂 Node 类型，就地声明（与上面两条 @ts-expect-error 同一个原因）。 */
declare const process: { cwd: () => string };
import { describe, expect, it } from "vitest";
import { DARK_THEME_IDS } from "./theme-options";

const cssFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) cssFiles(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
};

/** 按顶层逗号切选择器组（括号内的逗号不算分隔）。 */
const splitTopLevel = (text: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { out.push(current); current = ""; } else current += char;
  }
  out.push(current);
  return out;
};

const themeIds = (text: string): string[] => [...text.matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]);

interface DarkList { file: string; line: number; selector: string; missing: string[] }

/** 扫出"想收全暗色主题却漏了谁"的名单。 */
const findIncompleteDarkLists = (): DarkList[] => {
  const hits: DarkList[] = [];
  for (const path of cssFiles(join(process.cwd(), "src")).sort()) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of source.matchAll(/([^{}]+)\{/g)) {
      const prelude = rule[1];
      if (!prelude.includes("data-theme=")) continue;
      for (const group of splitTopLevel(prelude)) {
        const ids = [...new Set(themeIds(group))];
        if (ids.length < 10) continue;
        if (!ids.every((id) => (DARK_THEME_IDS as string[]).includes(id))) continue;
        const missing = DARK_THEME_IDS.filter((id) => !ids.includes(id));
        if (!missing.length) continue;
        hits.push({
          file: path.replace(`${join(process.cwd(), "src")}${path.includes("\\") ? "\\" : ""}`, "src/"),
          line: source.slice(0, rule.index).split("\n").length,
          selector: group.trim().replace(/\s+/g, " ").slice(0, 72),
          missing,
        });
      }
    }
  }
  return hits;
};

describe("暗色主题名单不许漏主题", () => {
  it("每条「全是暗色主题」的名单都收全 DARK_THEME_IDS", () => {
    const offenders = findIncompleteDarkLists();
    expect(offenders.map((item) => `${item.file}:${item.line} 缺 ${item.missing.join("/")} ← ${item.selector}`)).toEqual([]);
  });
});
