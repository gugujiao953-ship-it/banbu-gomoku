// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy WebView assets", () => {
  it("keeps the Rapfi worker free of logical assignment syntax unsupported by the supported WebView", () => {
    const source = readFileSync(new URL("../public/rapfi/fallback/rapfi-single.js", import.meta.url), "utf8");
    expect(source).not.toContain("||=");
  });

  it("引擎 worker 脚本不含 Chrome 80+ 语法（群友 HLTE203T 是 Chrome 79，2026-10-08）", () => {
    /* 手写脚本不走构建转译：`?.`/`??`（ES2020）与数字分隔符会让它在那台机器上
       **解析即死**——表现正是「引擎能打开、但没有速度」（worker 起不来，界面在、
       输出永远不来）。改动这个文件前先看这条断言。 */
    const source = readFileSync(new URL("../public/rapfi/rapfi-worker.js", import.meta.url), "utf8");
    expect(source).not.toContain("?.");
    expect(source).not.toContain("??");
    expect(source).not.toContain("||=");
    expect(source).not.toContain("&&=");
    expect(source).not.toMatch(/\b\d[\d_]*_\d/);   // 数字分隔符（12_000）
  });

  it("构建下限钉在 Chrome 79：worker 产物必须是 classic（iife），主包 target 不得抬回", () => {
    /* 10-07 那版把 worker 改成 ESM/module worker，前提「WebView 83+ 都支持」不成立：
       module worker 要 Chrome 80+，79 上 `new Worker(url,{type:"module"})` 直接抛
       「Module scripts are not supported on DedicatedWorker yet」（导入 / DP 数据库 /
       识谱线程 / 内置兜底引擎全体不可用）。这里的断言防止哪次构建配置回退。 */
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/worker:\s*\{\s*format:\s*"iife"\s*\}/);
    expect(config).toMatch(/target:\s*"chrome79"/);
    expect(config).not.toMatch(/worker:\s*\{\s*format:\s*"es"\s*\}/);
    expect(config).toMatch(/cssTarget:\s*"chrome79"/);
    expect(config).toContain("lowerLegacyChunksToChrome79");
    expect(config).toContain("lowerServiceWorkerSyntaxToChrome79");
  });

  it("ships an explicit old-WebView CSS fallback layer", () => {
    const source = readFileSync(new URL("./legacy-webview.css", import.meta.url), "utf8");
    /* 断言的是**生效的规则**，所以先剥注释：本文件的头部注释会解释"为什么不能用
       :is()/color-mix()"并原样引用那些写法，按裸文本断言会把文档当成违规。
       （选择器合法性由下面那条专门的老内核断言负责。） */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toContain(".legacy-webview .app-shell");
    expect(code).toContain(".legacy-webview .sheet-backdrop");
    expect(code).toContain("top:0;");
    expect(code).toContain("right:0;");
    expect(code).toContain("bottom:0;");
    expect(code).toContain("left:0;");
    expect(code).toContain("100vh");
    expect(code).toContain(".batch-selectable.selected");
    expect(code).toContain(".legacy-webview .puzzle-selector-current");
    expect(code).toContain(".legacy-webview .record-selector-current");
    /* 棋魂弹窗（2026-10-10）：遮罩的 `inset` 与卡片/价格/按钮的 `color-mix` 在 83 上都失效，
       旧安卓上会看到"遮罩盖不住、卡片没金边、价格没底色、按钮点了没反应"。
       这四条是那批兜底的锚点，改动弹窗时别把它们删了。 */
    expect(code).toContain(".legacy-webview .soul-buy-backdrop");
    expect(code).toContain(".legacy-webview .vcfch-itemback");
    expect(code).toContain(".legacy-webview .soul-buy-card");
    expect(code).toContain(".legacy-webview .soul-buy-price");
    expect(code).toContain(".legacy-webview .soul-buy-confirm");
    expect(code).not.toContain(":has(");
    expect(code).not.toContain("color-mix(");
  });

  it("老内核样式层的选择器只用 WebView 83 能解析的写法（K20 实测复盘，2026-10-09）", () => {
    /* 这一条是**用真机代价换来的**。用户在 K20 上反复看到「感觉都是只修复了一点的样子」：
       逐条 CDP 量下来，我写的兼容层本身在老内核上就是废的 ——
         · `:is(...)` / `:where(...)`：83 直接抛
           `Failed to execute 'querySelectorAll'`；CSS 规范里**选择器列表中任一非法 ⇒ 整条规则丢弃**
           （不是只丢那一个选择器），所以规则等于没写。
         · **复合** `:not(.a.b)`：同样非法。必须写成链式 `:not(.a):not(.b)`。
         · `color-mix(...)`：
             - 直接写在声明里 → 解析期丢弃，属"良性失效"；
             - 但存进**自定义属性**再 `var()` 引用 → 替换后才发现非法，该属性按 unset 处理，
               而 `!important` 又挡住其它规则 ⇒ **元素底色变透明**（手数行那排实测 rgba(0,0,0,0)）。
       结论：这两个文件（以及将来任何"要同时服务新老内核"的样式）只允许老写法；
       透明度一律由 JS 用 withAlpha() 算成 rgba 再写进变量。
       ⚠ 别为了"以后内核升级了再简化"而删掉这条断言：本应用明确支持 Chrome 79+。 */
    const files = ["./legacy-webview.css", "./action-opacity.css"];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      /* 注释里允许提到这些名字（本文档就写着），所以先剥掉注释再断言。 */
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, `${file} 不得使用 :is()/:where()/:has()`).not.toMatch(/:is\(|:where\(|:has\(/);
      expect(code, `${file} 不得使用 color-mix()`).not.toContain("color-mix(");
      /* 复合/带空格的 :not() 参数在老内核上是解析错误（整条规则作废）。 */
      const compoundNot = [...code.matchAll(/:not\(([^()]*)\)/g)]
        .map((match) => match[1].trim())
        .filter((arg) => /[\s>+~]/.test(arg) || /\.\w+\.\w/.test(arg));
      expect(compoundNot, `${file} 的 :not() 只能是简单选择器，复合项请改用链式 :not()`).toEqual([]);
    }
  });
});
