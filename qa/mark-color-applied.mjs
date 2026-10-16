import { chromium } from "playwright";

/**
 * 门禁：**标注颜色必须真的生效**，且在全部棋盘主题上都成立。
 *
 * 守的是两条真实回归：
 *  ① `.board-mark{stroke:#be4035}` 之类的样式表规则压过属性色 → 颜色选择器形同虚设。
 *  ② 用户标注的文字类曾带上 `renlib-native-label`，而那条 CSS 是
 *     `fill:var(--renlib-native-label)!important`（墨黑）——`!important` 连内联样式都压得住，
 *     于是**只有文字类标注**永远不变色，图形类却正常（用户 09-17 报的「切换颜色不生效」
 *     就是他默认用文字类）。这条最隐蔽：数据里颜色是对的，渲染出来被 CSS 钉死。
 *  ③ 修②时去掉 `renlib-native-label`，连带把它关掉的**白色描边**也放回来了：
 *     `.renlib-variation-label{paint-order:stroke;stroke:#fff9;stroke-width:3px}` 是给变化说明
 *     护底用的，原生标注靠 native 类显式 `paint-order:normal;stroke:none` 关掉。
 *     用户 09-17 报「我也没打开高亮啊，我们的标注和其他棋谱的不一样」就是这圈描边
 *     （实测高亮设置存的是 none、图层也无滤镜，见 `.tmp-interop/probe-mark-halo.mjs`）。
 *     所以这里同时断言：文字标注**不得带描边**，且字体与原生标注一致。
 *
 * 所以断言不看「元素存在」，而是**逐主题比对渲染出来的填充色与所选的色是否完全一致**。
 * 颜色选了金色 `#b27b18`（= rgb(178,123,24)），在深浅底上都不容易与默认色混淆。
 *
 *   QA_BASE_URL='http://127.0.0.1:5300/?qa=1' node qa/mark-color-applied.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/?qa=1";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const GOLD = "#b27b18";
const GOLD_RGB = "rgb(178, 123, 24)";
const THEMES = ["wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut", "frosted", "circuit", "minimal", "blackgold", "pale", "kawaii", "aurora"];

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const unreadable = [];
try {
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript((value) => {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-board-theme-v1", value);
    }, theme);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".app-shell", { timeout: 30_000 });
      await page.waitForTimeout(900);
      await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "标注", exact: true }).click();
      await page.locator(".mark-studio").waitFor({ state: "visible", timeout: 10_000 });
      // **不动样式与内容**：用默认的「文字 + 数字」，这正是用户会踩到的那条路
      await page.locator(".mark-studio-box").filter({ hasText: "颜色" }).click();
      await page.locator(".mark-studio-options.colors").waitFor({ state: "visible" });
      await page.locator('.mark-studio-options.colors button[aria-label="金色"]').click();
      await page.waitForTimeout(400);
      await page.locator('[role="gridcell"][aria-label$="空位"]').nth(4).click();
      await page.waitForTimeout(900);

      const measured = await page.evaluate(() => {
        const layer = document.querySelector(".board-annotation-layer");
        if (!layer) return null;
        const el = [...layer.querySelectorAll("circle,path,rect,text")][0];
        if (!el) return { hasMark: false };
        const cs = getComputedStyle(el);
        const bg = document.querySelector(".board-bg");
        // 只有文字类标注才谈得上"描边"（图形类的 stroke 就是它自己的颜色，不能当描边判）。
        const text = layer.querySelector("text");
        const textCs = text ? getComputedStyle(text) : null;
        return {
          hasMark: true,
          tag: el.tagName.toLowerCase(),
          ink: cs.fill !== "none" ? cs.fill : cs.stroke,
          boardFill: bg ? getComputedStyle(bg).fill : null,
          halo: textCs ? { stroke: textCs.stroke, paintOrder: textCs.paintOrder, fontFamily: textCs.fontFamily.replace(/["']/g, "").slice(0, 26) } : null,
        };
      });

      assert(measured, `[${theme}] 找不到标注层`);
      assert(measured.hasMark, `[${theme}] 放了标注但标注层里没有元素`);
      assert(measured.ink === GOLD_RGB,
        `[${theme}] 选了金色但渲染成 ${measured.ink}（标记是 <${measured.tag}>）——颜色被样式表覆盖了`);

      // ③ 不得有描边（用户报的"看着像高亮"）。字体与原生标注同族（Microsoft YaHei）。
      if (measured.halo) {
        assert(measured.halo.stroke === "none" && measured.halo.paintOrder === "normal",
          `[${theme}] 文字标注描边状态不对（stroke=${measured.halo.stroke} paint-order=${measured.halo.paintOrder}）`
          + "—— 两者都必须是 none/normal。只压住 stroke 不够：任何主题规则一旦把 stroke 设回来，"
          + "paint-order:stroke 就会在字后面画出白描边，用户看到的就是「我的标注有高亮」");
        assert(/YaHei|Noto Sans SC/.test(measured.halo.fontFamily),
          `[${theme}] 标注字体是 ${measured.halo.fontFamily}，与原生标注（Microsoft YaHei）不一致`);
      }

      // 可见性只做提示不设门槛：默认色在深色棋盘上本来就不显眼（用户已明确选择不做底圆盘装饰）
      const board = measured.boardFill || "";
      const parse = (value) => (value.match(/\d+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { const x = v / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const inkRgb = parse(GOLD_RGB), boardRgb = parse(board);
      let contrast = null;
      if (boardRgb.length === 3) {
        const [hi, lo] = [lum(inkRgb), lum(boardRgb)].sort((x, y) => y - x);
        contrast = +((hi + .05) / (lo + .05)).toFixed(2);
      }
      if (contrast !== null && contrast < 1.5) unreadable.push(`${theme}(对比 ${contrast})`);
      console.log(`[mark-color] ${theme}: 渲染色 ${measured.ink} ✅（金色生效），与棋盘对比 ${contrast ?? "渐变底(不可测)"}`);
    } finally { await context.close(); }
  }
  if (unreadable.length) console.log(`[mark-color] 提示：这些主题上金色也偏暗，${unreadable.join("、")}——用户可自行换更亮的颜色`);
  console.log(`[mark-color] pass（${THEMES.length} 个主题上所选颜色都真的生效）`);
} finally { await browser.close(); }
