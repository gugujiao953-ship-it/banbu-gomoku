/**
 * 字号放大后的排版体检（用户 2026-10-05：「把文字大小点到 130 时有些地方布局就乱…档位那行右边都突破边界了」）。
 *
 * 用手机视口（390×844 与 360×800）在 normal / xlarge 两种字号下，逐个打开**用到版面最多的几面**：
 *   设置页（含展开全部折叠子分节）→ 分析面板 → 对弈页的人机对战设置浮层 → 比赛计时器 → VCF 挑战 → 棋题生成器，
 * 每面都量两件事：
 *   ① **横向溢出**（scrollWidth > clientWidth）与整页横向滚动；
 *   ② **孤行**——flex 横排换行后某一行只剩一个子元素（用户说的「孤零零的换行到下面」）。
 *
 * 用法：
 *   node qa/font-scale-layout-check.mjs                 # 检查（有问题则退出码 1）
 *   BANBU_URL=http://127.0.0.1:5197/ node qa/font-scale-layout-check.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BANBU_URL || "http://127.0.0.1:5197/";
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
  // VCF 挑战横屏改成「棋盘居中＋左右两栏」（2026-10-12 R190）后，那些行都挤进 150~200px
  // 的窄栏里，特大字号最容易在窄栏里横向溢出——这条档以前完全没有。
  { name: "844x390", width: 844, height: 390 },
];
const SCALES = ["normal", "large", "xlarge"];   // 用户说的「中等」= large(115%)

/** 故意可横向滑动的容器：它们溢出是设计（例如计时器 17 档预设一行横滑）。 */
const SCROLLABLE = [
  "duel-clock-preset-row", "clock-preset", "online-filters", "move-strip", "battle-clock", "preset-scroll",
  // 走棋区那一行（起点/上一手/…）在 railbar 里就是**故意横向滑动**的：容器 overflow-x:auto，
  // 且 data-overflow 会给出提示，所以它的 scrollWidth 大于 clientWidth 属设计，不算问题。
  "rail-scroll",
];

/** 在页面里跑：横向溢出扫描。 */
const scanOverflow = (scrollable) => {
  const out = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 8) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    // 4px 容差：中文在窄列里换行时，scrollWidth 会因亚像素取整虚高 2–4px（实测过：0 处真实内容被裁）。
    // 真实事故的量级远大于此（用户报的那行溢出 25–41px，元素直接跑到屏幕外），所以 4px 只用来滤噪。
    if (el.scrollWidth <= el.clientWidth + 4) continue;
    // 假阳性：自身 overflow:hidden 的截断盒（line-clamp 的名字/说明就是这种）——内容多几像素已被裁掉，
    // 屏幕上什么也看不到，不可能「突破边界」。
    if (style.overflow === "hidden" || style.overflowX === "hidden") continue;
    // 假阳性：父级已经 overflow:hidden + ellipsis 的 nowrap 内联元素（状态行就是这种，裁剪在设计里）
    if (style.whiteSpace === "nowrap" && el.parentElement) {
      const ps = getComputedStyle(el.parentElement);
      if (ps.overflow === "hidden" && (ps.textOverflow === "ellipsis" || ps.overflowX === "hidden")) continue;
    }
    const cls = typeof el.className === "string" ? el.className : "";
    const parentCls = typeof el.parentElement?.className === "string" ? el.parentElement.className : "";
    if (scrollable.some((s) => cls.includes(s) || parentCls.includes(s))) continue;
    const key = `${cls}|${Math.round(rect.width)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cls: cls.slice(0, 56), over: el.scrollWidth - el.clientWidth, text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 44) });
  }
  return out.slice(0, 20);
};

/** 在页面里跑：孤行扫描（flex 换行后只剩一个孩子的那一行）。 */
const scanOrphans = () => {
  const found = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (style.display !== "flex" || style.flexWrap !== "wrap") continue;
    const kids = Array.from(el.children).filter((c) => c instanceof HTMLElement && getComputedStyle(c).display !== "none");
    if (kids.length < 3) continue;
    const lines = new Map();
    for (const k of kids) { const top = Math.round(k.getBoundingClientRect().top); lines.set(top, (lines.get(top) ?? 0) + 1); }
    const counts = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
    if (counts.length < 2) continue;
    if (!(counts[counts.length - 1] === 1 && counts[counts.length - 2] >= 2)) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    if (seen.has(cls)) continue;
    seen.add(cls);
    found.push({ cls: cls.slice(0, 56), lines: counts.join("+"), text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 42) });
  }
  return found.slice(0, 12);
};

const clickByText = async (page, text) => page.evaluate((t) => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === t);
  if (btn) { btn.click(); return true; }
  return false;
}, text);

const clickNav = async (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const btn = nav ? Array.from(nav.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === l) : null;
  if (btn) { btn.click(); return true; }
  return false;
}, label);

/** 打开各面；每一面失败就跳过（例如桌面环境下 VCF 题池还没加载完），不让整轮体检挂掉。 */
const SURFACES = [
  {
    name: "设置页",
    open: async (page) => {
      await clickNav(page, "设置");
      await page.waitForTimeout(900);
      await page.evaluate(() => { for (const d of Array.from(document.querySelectorAll("details"))) d.open = true; });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "分析面板",
    open: async (page) => {
      await clickNav(page, "打谱");
      await page.waitForTimeout(500);
      await Promise.all([clickByText(page, "分析"), clickByText(page, "开始分析")]);
      await page.waitForTimeout(800);
    },
  },
  {
    name: "人机对战设置浮层",
    open: async (page) => {
      await clickNav(page, "对弈");
      await page.waitForTimeout(700);
      await Promise.all([clickByText(page, "开始对局"), clickByText(page, "继续对局")]);
      await page.waitForTimeout(1000);
    },
    close: async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); },
  },
  {
    name: "比赛计时器",
    open: async (page) => {
      await clickNav(page, "对弈");
      await page.waitForTimeout(700);
      await clickByText(page, "开始计时");
      await page.waitForTimeout(1000);
    },
    close: async (page) => { await clickByText(page, "退出"); await page.waitForTimeout(500); },
  },
  {
    name: "VCF 挑战",
    open: async (page) => {
      await clickNav(page, "对弈");
      await page.waitForTimeout(700);
      await clickByText(page, "开始挑战");
      await page.waitForSelector(".vcfch-board", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
    close: async (page) => { await clickByText(page, "返回对弈").catch(() => {}); await page.waitForTimeout(500); },
  },
  {
    name: "棋题生成器",
    open: async (page) => {
      await clickNav(page, "对弈");
      await page.waitForTimeout(700);
      await clickByText(page, "进入生成器");
      await page.waitForTimeout(1200);
    },
  },
];

const browser = await chromium.launch();
let problems = 0;

for (const vp of VIEWPORTS) {
  for (const scale of SCALES) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript((value) => {
      try { localStorage.setItem("banbu-font-scale-v1", value); } catch { /* ignore */ }
    }, scale);
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 60000 });

    const lines = [];
    for (const surface of SURFACES) {
      try {
        await surface.open(page);
        const overflow = await page.evaluate(scanOverflow, SCROLLABLE);
        const orphans = await page.evaluate(scanOrphans);
        const pageOver = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (pageOver > 0) { lines.push(`   整页横向溢出 ${pageOver}px`); problems += 1; }
        for (const item of overflow) { lines.push(`   溢出 ${item.over}px  .${item.cls}  「${item.text}」`); problems += 1; }
        for (const item of orphans) { lines.push(`   孤行(${item.lines})  .${item.cls}  「${item.text}」`); problems += 1; }
        if (surface.close) await surface.close(page);
      } catch (error) {
        lines.push(`   （${surface.name} 打不开，跳过：${String(error).slice(0, 60)}）`);
      }
    }
    const tag = `${vp.name} @ ${scale}`;
    if (lines.length) {
      console.log(`\n✗ ${tag}`);
      for (const l of lines) console.log(l);
    } else {
      console.log(`✓ ${tag}  各面都没有横向溢出与孤行`);
    }
    await context.close();
  }
}

await browser.close();
console.log(problems ? `\n共 ${problems} 处需要处理` : "\n全部通过");
process.exit(problems ? 1 : 0);
