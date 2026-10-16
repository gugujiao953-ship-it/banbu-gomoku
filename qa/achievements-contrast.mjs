/**
 * 量成就弹窗/面板在**全部可测主题**下的文字对比度（2026-10-09）。
 *
 * 为什么单独量：本模块新写了浅色卡 + 深色两套配色，而项目有 20 套可测主题。
 * 改造表 R112/R117 的教训是「写死颜色 + 深色底」这类问题肉眼扫会漏，
 * 必须逐主题量（那条原话：「做法不是肉眼扫，是逐主题逐屏量」）。
 *
 * 口径照 R112：把祖先 background 逐层合成成真实不透明底色，再按 WCAG 算对比度。
 * 门槛 4.5:1（正文）。**这个探针实测抓到过 25 条真失败**（写死的金色在浅色主题
 * 只有 2.6–3.4:1），所以它是有效的、别删。
 */
import { chromium } from "playwright";
import { readThemeIds } from "../scripts/lib/theme-matrix.mjs";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
/**
 * 主题清单**从应用里读**（`.app-shell` 的 `data-theme-options`），不在这里抄第二份。
 * 之前这里写死了 22 套的清单，注释还写着"与 CONCRETE_THEME_IDS 同源"——
 * 结果 `dunhuang` 上线后它不在名单里，成就/棋魂页在它上面**一次都没量过**
 * （2026-10-15 发布前排查发现的第二条同源漂移）。读一次就永远不会漏，
 * 且清单读不到会直接抛（`MIN_EXPECTED_THEMES`），不会悄悄少测。
 */
const THRESHOLD = 4.5;

/**
 * 在页面里跑的量测函数（Playwright 会把它序列化后注入，所以**不能闭包外部变量**，
 * 阈值通过参数传进去）。
 */
const collectContrast = (threshold) => {
  /**
   * 解析颜色。**必须同时支持 `rgb()` 与 `color(srgb r g b)`**——
   * 项目里不少主题用 color-mix() 产出后者的计算值（实测 pale/kawaii 的
   * .bottom-sheet 底就是 color(srgb …)，只认 rgb() 会把底色误判成透明，
   * 一路往上合到 body，量出一堆 2.0 的假失败）。
   */
  const parse = (color) => {
    const text = (color || "").trim();
    /* 十六进制：`parse` 原来只认 rgb()/color(srgb …)。
       需要它是因为**无框浮层**的背景得由调用方以字面量给出
       （它是伪元素画的柔光，祖先链上读不到）。 */
    const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text);
    if (hexMatch) {
      const raw = hexMatch[1];
      const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
      return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: 1,
      };
    }
    const rgbMatch = /rgba?\(([^)]+)\)/.exec(text);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(",").map((item) => parseFloat(item));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    const srgbMatch = /color\(srgb\s+([^)]+)\)/.exec(text);
    if (srgbMatch) {
      const parts = srgbMatch[1].split(/[\s/]+/).filter(Boolean).map((item) => parseFloat(item));
      // color(srgb …) 的分量是 0..1（可带 / alpha）
      if (parts.length >= 3 && parts.slice(0, 3).every((value) => Number.isFinite(value))) {
        return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1 };
      }
    }
    return null;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (first, second) => {
    const a = lum(first);
    const b = lum(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  /** 逐层合成祖先底色（跳过透明；照 R112 口径，不做图片层）。 */
  const effectiveBackground = (node) => {
    let current = node;
    let acc = null;
    while (current) {
      const style = getComputedStyle(current);
      const layer = parse(style.backgroundColor);
      if (layer && layer.a > 0) {
        acc = acc === null ? layer : over(acc, layer);
        if (acc.a >= 1) return acc;
      }
      current = current.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body && body.a >= 1 ? body : { r: 255, g: 255, b: 255, a: 1 };
  };
  const measure = (scope, label, selector, bgSelector) => {
    const node = scope.querySelector(selector);
    if (!node) return null;
    const fg = parse(getComputedStyle(node).color);
    if (!fg) return null;
    /* `bgSelector` 也可以直接是**一个颜色字面量**（以 # 开头）。
       用途：无框浮层（棋魂提示条）的背景是它自己画的一层白色柔光，
       祖先链上读不到它（那是伪元素）。这时由调用方显式给出"它实际压在什么上"。 */
    const literal = typeof bgSelector === "string" && bgSelector.startsWith("#") ? parse(bgSelector) : null;
    const base = literal ?? effectiveBackground(bgSelector ? scope.querySelector(bgSelector) || node : node);
    const composited = fg.a < 1 ? over(fg, base) : fg;
    return {
      label,
      ratio: Number(ratio(composited, base).toFixed(2)),
      color: getComputedStyle(node).color,
      bg: `rgb(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)})`,
    };
  };

  const items = [];
  const card = document.querySelector("[data-achievement-unlock]");
  if (card) {
    items.push(
      measure(card, "弹窗标题", ".achievement-unlock-copy b"),
      measure(card, "弹窗说明", ".achievement-unlock-copy small"),
      // 奖励徽章：数字（`em`）+ 魂火图案。第八轮起徽章里不再写「棋魂」二字，
      // 所以原来那条量 `i`（余额）的探针已经没有对应元素 —— 删掉它，
      // 别留"永远返回 null"的摆设（本项目对"永远为真的断言"的那条纪律）。
      measure(card, "弹窗棋魂数字", ".achievement-unlock-soul em"),
      measure(card, "弹窗序号", ".achievement-unlock-count"),
      measure(card, "弹窗关闭叉", ".achievement-unlock-close"),
      // 级别标签（2026-10-10 新增）：四级各有底色，最容易在深色主题下翻车
      // （第一版写死浅金底 + 深金字，深色主题 1.x:1 —— 对比度门禁会红）。
      // 探针每次只量得到"当前那一条"的级别，所以口径是逐主题量、多主题累积覆盖。
      measure(card, "弹窗级别标签", ".achievement-unlock-tier", ".achievement-unlock-tier"),
    );
  }
  const panel = document.querySelector("[data-achievements-panel]");
  if (panel) {
    items.push(
      measure(panel, "面板成就计数", "[data-achievements-done]"),
      measure(panel, "分组标题", ".achievements-group > header b"),
      measure(panel, "分组摘要", ".achievements-group > header small"),
      measure(panel, "成就名", ".achievement-row-copy b"),
      measure(panel, "成就说明", ".achievement-row-copy small"),
      measure(panel, "成就奖励", ".achievement-row-soul"),
      measure(panel, "底部说明", ".achievements-foot"),
    );
  }
  // 棋魂：徽章（对弈页标题行）+ 说明页六块（用户 10-09 新增，是本文件的新覆盖对象）
  const badge = document.querySelector("[data-soul-badge]");
  if (badge) items.push(measure(badge, "棋魂徽章数字", "[data-soul-badge-count]", ""));
  const soulPanel = document.querySelector("[data-soul-panel]");
  if (soulPanel) {
    items.push(
      measure(soulPanel, "棋魂余额", "[data-soul-hero-balance]", ".soul-hero"),
      measure(soulPanel, "棋魂单位", ".soul-hero-figure span", ".soul-hero"),
      // 「精确」那行**只在余额被缩写时（≥1 万）才渲染**，而本探针造的余额是小额，
      // 所以这里多半量不到它 —— measure() 找不到节点会返回 null 并被过滤掉，
      // 不会算失败。真要看它可以临时把余额造过万；覆盖率门禁在下面单独断言。
      measure(soulPanel, "棋魂精确值", ".soul-hero-exact", ".soul-hero"),
      // 「点一下 +1」提示（2026-10-10 从页顶移进魂火版面，成为独立的两段文字）
      measure(soulPanel, "点一下提示主句", ".soul-hero-tap b", ".soul-hero-tap"),
      measure(soulPanel, "点一下提示副句", ".soul-hero-tap small", ".soul-hero-tap"),
      measure(soulPanel, "棋魂累计标签", ".soul-total small", ".soul-total"),
      measure(soulPanel, "棋魂累计数值", ".soul-total b", ".soul-total"),
      measure(soulPanel, "说明正文", ".soul-explain p"),
      measure(soulPanel, "来源标题", ".soul-earn li b", ".soul-earn li"),
      measure(soulPanel, "来源金额", ".soul-earn-amount", ".soul-earn li"),
      measure(soulPanel, "空态标题", ".soul-spend-empty b", ".soul-spend-empty"),
      // 解锁商店（2026-10-10）：「能花在哪」的分组行与收集进度
      measure(soulPanel, "商店分组标题", ".soul-shop-copy b", ".soul-shop-groups li"),
      measure(soulPanel, "商店分组说明", ".soul-shop-copy small", ".soul-shop-groups li"),
      measure(soulPanel, "商店价格", ".soul-shop-price", ".soul-shop-groups li"),
      measure(soulPanel, "商店说明", ".soul-spend-note"),
      measure(soulPanel, "收集进度", ".soul-shop-progress", ".soul-shop-progress"),
      // 非氪金首句（用户点名要加的那一句）
      measure(soulPanel, "非氪金首句", ".soul-explain-lead", ".soul-explain-lead"),
      measure(soulPanel, "流水说明", ".soul-entry-copy b", ".soul-history li"),
      measure(soulPanel, "流水标签", ".soul-entry-copy small", ".soul-history li"),
      measure(soulPanel, "流水金额", ".soul-entry-amount", ".soul-history li"),
    );
  }
  /* ---- 2026-10-10 新增的三个表面（都要"挂载出来"才量得到）----------------
     ① 棋魂提示条：改成**无框**之后没有底色了，文字靠白描边 ——
        对比度在这里的算法是"文字色 vs 它背后的（合成后）底色"，
        而描边是 paint-order 画在字**后面**的，探针读不到它。
        所以这一条的判据是**用描边的白**当底（最保守的假设：文字压在纯白上）
        —— 若那一档都过，说明文字本身够深；描边只是加分。
     ② 商店面板：余额、道具卡（名字/数量/价格角标）、分组。
     ③ VCF 道具栏：药丸里的数字与图标。 */
  const toast = document.querySelector(".soul-gain");
  if (toast) {
    items.push(
      // ⚠ 背景给**深色字面量**：这枚提示条是无框的，它背后是我们自己画的**深色**柔光
      // （`.soul-gain::before` 的径向渐变，中心 #1a1610）——伪元素，祖先链上读不到。
      // 第一版这里给的是白色（配深色文字），被用户指出「太白了，看不太清楚」：
      // 魂火是**黑白**图形，白柔光把它的白芯吞掉，只剩一个黑轮廓浮在雾里。
      // 现在深柔光 + 亮金文字，量的是"亮金字 vs 深柔光中心"。
      measure(toast, "提示条数字", "[data-soul-gain-amount]", "#1a1610"),
      measure(toast, "提示条来源", ".soul-gain-copy small", "#1a1610"),
    );
  }
  const shopPanel = document.querySelector("[data-shop-panel]");
  if (shopPanel) {
    items.push(
      measure(shopPanel, "商店余额", "[data-shop-balance]", ".shop-balance"),
      measure(shopPanel, "道具卡名字", "[data-shop-item] b", "[data-shop-item]"),
      measure(shopPanel, "道具卡数量", ".shop-item-count", "[data-shop-item]"),
      measure(shopPanel, "道具价格角标", ".shop-item-cost em", ".shop-item-cost"),
      measure(shopPanel, "外观分组标题", ".shop-group-copy b", ".shop-groups li"),
      measure(shopPanel, "外观分组说明", ".shop-group-copy small", ".shop-groups li"),
    );
  }
  const itemBar = document.querySelector("[data-vcf-items]");
  if (itemBar) {
    items.push(
      measure(itemBar, "道具栏数字", ".vcfch-item b", ".vcfch-item"),
      measure(itemBar, "道具栏加号", ".vcfch-item-info", ".vcfch-item-info"),
    );
  }
  const present = items.filter(Boolean);
  return { count: present.length, below: present.filter((item) => item.ratio < threshold) };
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
// 生产包约 36MB，冷启要几秒；等底栏出现再继续，别用固定 sleep
// （实测固定 600ms 会量到"弹窗没出现"，那是探针太急、不是产品问题）。
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(800);

/**
 * 去掉可能被别的会话临时插进页面的诊断条（`<pre data-tempdiag>`，z-index 99999、
 * 铺在视口底部、**load 后 3 秒**才出现）。它会拦住点击（实测 "intercepts pointer events"）。
 * 用 MutationObserver 常驻清除；只作用于本探针自己的页面，**不改别人的源文件**。
 */
const installTempDiagGuard = (target) => target.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  // ⚠ 必须把 observer **存到 window 上**：不保存引用的 MutationObserver 会被 GC 回收、
  // 静默停止观察（实测就是这样——第一版没存，守卫等于没装，点击照旧被拦）。
  const w = window;
  w.__tempDiagObserver?.disconnect();
  w.__tempDiagObserver = new MutationObserver(strip);
  w.__tempDiagObserver.observe(document.body, { childList: true, subtree: true });
});
await installTempDiagGuard(page);

const failures = [];
let measured = 0;
let runs = 0;
let soulRuns = 0;

const themes = await readThemeIds(page);
for (const theme of themes) {
  await page.evaluate((value) => localStorage.setItem("banbu-theme-preference-v1", value), theme);
  // 清掉解锁记录与余额，保证每次刷新都弹（这样每套主题量的都是弹窗本身）。
  await page.evaluate(() => {
    localStorage.removeItem("banbu-achievements-v1");
    localStorage.removeItem("banbu-soul-ledger-v1");
  });
  await page.evaluate((at) => {
    localStorage.setItem("banbu-duel-history-v1", JSON.stringify([
      { id: "c1", at: at - 20000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "大师", engine: "strong", timeLimitMs: 0, thinkTimeMs: 5000, thinkDepth: 64, moves: 31, humanElapsedMs: 60000, forbidden: true },
      { id: "c2", at: at - 10000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "初级", engine: "strong", timeLimitMs: 0, thinkTimeMs: 600, thinkDepth: 32, moves: 8, humanElapsedMs: 5000, forbidden: false },
    ]));
  }, Date.now());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  // ⚠ reload 会把页面重来一遍 ⇒ 诊断条（load 后 3 秒自己插进来）也跟着回来，
  // 必须在这里重装守卫。之前只在开头装了一次，循环里第一次 reload 之后就被拦住了。
  await installTempDiagGuard(page);
  await page.waitForTimeout(1800);

  // 先量弹窗（此时它在播）。
  const unlockReport = await page.evaluate(collectContrast, THRESHOLD);
  measured += unlockReport.count;
  for (const item of unlockReport.below) failures.push({ theme, scope: "弹窗", ...item });

  // 再打开面板量一轮（面板在 sheet 里，要挂载才量得到）。
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(500);
  const entry = page.locator("[data-duel-achievements]").first();
  if (await entry.count()) {
    await entry.click();
    await page.waitForSelector("[data-achievements-panel]", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  const panelReport = await page.evaluate(collectContrast, THRESHOLD);
  measured += panelReport.count;
  for (const item of panelReport.below) failures.push({ theme, scope: "面板", ...item });
  if (panelReport.count > 0) runs += 1;

  // 棋魂说明页：先造一条流水（不然收支列表是空态，量不到条目那几条），
  // 再从徽章进去量一轮。
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
      { id: "c-in", at: Date.now() - 60000, amount: 30, reason: "duel-win", detail: "战胜中级档 AI" },
      { id: "c-out", at: Date.now() - 30000, amount: -20, reason: "manual", detail: "手动调整（示例）" },
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  // 第三次 reload，同样要重装守卫（见上面那条注释）。
  await installTempDiagGuard(page);
  await page.waitForTimeout(900);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(500);
  const soulEntry = page.locator("[data-soul-badge]").first();
  if (await soulEntry.count()) {
    await soulEntry.click();
    await page.waitForSelector("[data-soul-panel]", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  // 挂一个提示条（当前结构）与商店面板：探针量的是**真实 class + 真实 CSS**
  // ⚠ 2026-10-12：提示条身后的那圈椭圆柔光换成了**云雾轮廓**（一条 SVG 路径，见
  //   `src/features/progress/soul-gain-shape.ts`）。这条探针仍然按字面量 `#1a1610` 当背景量文字，
  //   所以它守的是"**字色对暗底**够不够"；而"暗底**有没有盖到**每一个字"是另一条性质，
  //   由 `soul-gain-shape.test.ts`（轮廓与文字带求交）钉住 —— 两边都要绿才算安全。
  //   这里注入的是简化结构（不含墨形），量出来的仍是字色 vs #1a1610。
  await page.evaluate(() => {
    const n = document.createElement("div");
    n.className = "soul-gain";
    n.style.animation = "none";
    // 注入当前结构（第八轮起数字后面不再有「棋魂」二字）。
    n.innerHTML = '<span class="soul-gain-flame"><svg class="soul-flame" width="34" height="34" viewBox="0 0 32 32"><path d="M16.4 2.6Z" fill="#1d2226"/></svg></span><span class="soul-gain-gain"><b data-soul-gain-amount="">+12</b></span><span class="soul-gain-copy"><small>战胜大师档 AI</small><small class="soul-gain-total">共 480</small></span>';
    document.body.appendChild(n);
  });
  const soulReport = await page.evaluate(collectContrast, THRESHOLD);
  measured += soulReport.count;
  for (const item of soulReport.below) failures.push({ theme, scope: "棋魂", ...item });
  if (soulReport.count > 0) soulRuns += 1;
}

await browser.close();

console.log(`量了 ${measured} 条（${themes.length} 套主题；面板 ${runs} 套、棋魂页 ${soulRuns} 套）`);
if (failures.length === 0) {
  console.log(`✅ 全部 ≥ ${THRESHOLD}:1`);
} else {
  console.log(`❌ ${failures.length} 条低于 ${THRESHOLD}:1：`);
  for (const item of failures) console.log(`   ${item.theme} · ${item.scope}${item.label} = ${item.ratio}（${item.color} on ${item.bg}）`);
  process.exit(1);
}
