import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(OUT, "site", "index.html");
const lines = readFileSync(HTML, "utf8").split(/\r?\n/);
console.log("源码里的「待填」行号：");
lines.forEach((l, i) => { if (l.includes("待填")) console.log(`  L${i + 1}: ${l.trim().slice(0, 96)}`); });
const URL_BASE = process.env.SELFCHECK_URL || "http://127.0.0.1:3911/";
const SHOTS = [
  // dsf 必须是 1：手机整页约 1.9 万像素高，2 倍会超过多数看图器 32767px 的上限打不开
  { name: "preview-手机.png", width: 392, height: 852, dsf: 1 },
  { name: "preview-桌面.png", width: 1280, height: 900, dsf: 1 },
];

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
let fatal = 0;

for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.dsf,
    colorScheme: "dark",
    locale: "zh-CN",
    isMobile: s.width < 500,
    hasTouch: s.width < 500,
  });
  const page = await ctx.newPage();
  const consoleErrs = [];
  const pageErrs = [];
  const badReqs = [];
  const failedReqs = [];
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") consoleErrs.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", e => pageErrs.push(String(e)));
  page.on("requestfailed", r => failedReqs.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", r => { if (r.status() >= 400) badReqs.push(`${r.status()} ${r.url()}`); });

  await page.goto(URL_BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(400);

  // 1) 滚到底再回顶，触发所有 IntersectionObserver（入场/计数/联动）
  //    页面 html{scroll-behavior:smooth}，不临时关掉的话 scrollTo 会被动画拖住、
  //    上一轮自检就是这样把 count-up 停在 0 的截图发了出去。
  await page.evaluate(async () => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    const step = Math.round(innerHeight * 0.5);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 90));
    }
    html.style.scrollBehavior = prev;
  });
  // 2) 兜底：确保 reveal 全部落地（截图看的是版式，不是动画中间态）
  await page.evaluate(() => {
    document.querySelectorAll("[data-rv],[data-split],.log-row").forEach(e => e.classList.add("in"));
    document.querySelectorAll(".ch").forEach(c => { c.style.transitionDelay = "0ms"; });
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1700);

  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const out = {
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      pageH: Math.ceil(document.documentElement.getBoundingClientRect().height),
      overflowers: [],
      clipped: [],
      counters: [],
      boxOverflow: [],
      ellipsis: [],
      invisible: [],
      badAnchors: [],
      external: [],
      placeholder: [],
      counts: {},
    };
    // 横向溢出元素（忽略故意越界的装饰件：watermark / bg / stage-hline / tick）
    const deco = /(^|\s)(watermark|bg|bg-grid|bg-glow|bg-scan|bg-noise|bg-vig|stage-hline|stage-vline|spot|crosshair)(\s|$)/;
    document.querySelectorAll("*").forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || el.closest("[aria-hidden=true]")) return;
      if (deco.test(el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || ""))) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > vw + 1.5 || r.left < -1.5) {
        // 祖先里有 overflow clip/hidden 的，认为视觉上被裁掉，不算溢出
        let p = el.parentElement, clippedByAncestor = false;
        while (p) {
          const pc = getComputedStyle(p);
          if (pc.overflowX === "hidden" || pc.overflowX === "clip") { clippedByAncestor = true; break; }
          p = p.parentElement;
        }
        if (!clippedByAncestor) out.overflowers.push({ sel: el.tagName + "." + String(el.className || "").slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) });
      }
    });
    // 文字被截断：叶子文本节点所在元素，滚动尺寸大于内容尺寸
    const isText = el => {
      if (!el.textContent || !el.textContent.trim()) return false;
      return ![...el.children].some(c => c.textContent && c.textContent.trim());
    };
    document.querySelectorAll("body *").forEach(el => {
      if (!isText(el)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== "visible" && cs.whiteSpace !== "nowrap" && !el.closest(".ticker")) {
        out.clipped.push({ what: "width", sel: el.tagName + "." + String(el.className || "").slice(0, 34), text: el.textContent.trim().slice(0, 26), sw: el.scrollWidth, cw: el.clientWidth });
      }
      if (el.scrollHeight > el.clientHeight + 2 && cs.overflowY !== "visible") {
        out.clipped.push({ what: "height", sel: el.tagName + "." + String(el.className || "").slice(0, 34), text: el.textContent.trim().slice(0, 26), sh: el.scrollHeight, ch: el.clientHeight });
      }
      if (cs.textOverflow === "ellipsis") out.ellipsis.push(el.tagName + "." + String(el.className || "").slice(0, 30));
    });
    // 盒子被 overflow:hidden 裁掉内容（手机示意屏最容易在这里出问题）
    const BOX = ".scr,.scr-body,.scr-rows,.scr-top,.scr-row,.readout,.ro,.dl-card,.dl-m,.dl-code,.sp,.sp-rows .r,.step,.step-rows .r,.lim,.fc,.th-item,.hero-in,.cta-box,.log-row";
    document.querySelectorAll(BOX).forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === "none") return;
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      if (dx > 2 || dy > 2) {
        const own = el.getBoundingClientRect();
        const culprits = [...el.querySelectorAll("*")].filter(c => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && (r.right > own.right + 2 || r.bottom > own.bottom + 2 || r.left < own.left - 2);
        }).slice(0, 4).map(c => {
          const r = c.getBoundingClientRect();
          return `${c.tagName}.${String(c.className || "").slice(0, 22)}[r+${Math.round(r.right - own.right)} b+${Math.round(r.bottom - own.bottom)}]`;
        });
        out.boxOverflow.push({ sel: el.tagName + "." + String(el.className || "").slice(0, 28), dx, dy, text: (el.textContent || "").trim().slice(0, 22), culprits });
      }
    });
    // count-up 必须已经跑到终值（停在 0 = 截图里就是一个空数字）
    document.querySelectorAll("[data-count]").forEach(el => {
      const t = Number(el.dataset.count), dec = Number(el.dataset.dec || 0);
      const want = dec ? t.toFixed(dec) : String(Math.round(t));
      const got = el.textContent.trim();
      if (got !== want) out.counters.push({ want, got, label: (el.closest(".ro") ? el.closest(".ro").querySelector(".k").textContent : "").trim() });
    });
    // 隐形区块：data-rv / data-split 没有 in
    document.querySelectorAll("[data-rv],[data-split]").forEach(el => {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.opacity) < 0.9) out.invisible.push(String(el.className).slice(0, 40));
    });
    // 锚点是否命中
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const id = a.getAttribute("href");
      if (id === "#" || !id) return;
      if (!document.querySelector(id)) out.badAnchors.push(id);
    });
    // 外部资源（应当只有 data: 与 https 链接，不得有 https 资源请求）
    document.querySelectorAll("script[src],link[rel=stylesheet],img").forEach(el => {
      const u = el.src || el.href || "";
      if (u && !u.startsWith("data:")) out.external.push(u.slice(0, 80));
    });
    // 占位符与可疑空块
    const visibleText = el => !["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName);
    const pending = [...document.querySelectorAll("body *")].filter(el => visibleText(el) && !el.children.length && /待填/.test(el.textContent));
    out.counts.pending = pending.length;
    out.placeholder = pending.map(el => el.textContent.trim().slice(0, 30));
    // 可疑占位文案
    out.counts.suspicious = [...document.body.innerText.matchAll(/TODO|lorem|xxx+/gi)].length;
    // 空下载卡（dl-card 内部没有可见文字）
    out.counts.emptyCards = [...document.querySelectorAll(".dl-card,.sp,.step,.log-row,.lim,.fc")].filter(el => !el.innerText.trim()).length;
    out.counts.logs = document.querySelectorAll(".log-row").length;
    out.counts.limits = document.querySelectorAll(".lim").length;
    out.counts.themes = document.querySelectorAll(".th-item").length;
    out.counts.boards = document.querySelectorAll(".board svg").length;
    out.counts.pendingLiteral = (document.body.innerText.match(/待填/g) || []).length;
    return out;
  });

  const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")).filter(h => h && !h.startsWith("#")));
  const uniq = [...new Set(links)];

  // 外链可达性（仅探测，不计入问题数：Release 页面要等发布后才存在；本机也可能没代理）
  const probe = [];
  for (const u of uniq) {
    try {
      const r = await page.request.head(u, { timeout: 12000, maxRedirects: 4 }).catch(async () => await page.request.get(u, { timeout: 12000, maxRedirects: 4 }));
      probe.push(`${r.status()} ${u}`);
    } catch (e) { probe.push(`ERR  ${u} :: ${String(e).slice(0, 60)}`); }
  }

  console.log(`\n===== ${s.name}  ${s.width}×${s.height} =====`);
  console.log("文档 scrollWidth / clientWidth :", res.scrollW, "/", s.width);
  console.log("页面高度 :", res.pageH);
  console.log("横向溢出元素 :", res.overflowers.length ? JSON.stringify(res.overflowers, null, 1) : "none");
  console.log("文字截断 :", res.clipped.length ? JSON.stringify(res.clipped, null, 1) : "none");
  console.log("盒子被裁 :", res.boxOverflow.length ? JSON.stringify(res.boxOverflow, null, 1) : "none");
  console.log("count-up 终值 :", res.counters.length ? "停在半路 → " + JSON.stringify(res.counters) : "全部到位");
  console.log("ellipsis 用法 :", res.ellipsis.length ? res.ellipsis.join(", ") : "none");
  console.log("未入场区块 :", res.invisible.length ? res.invisible.join(", ") : "none");
  console.log("失效锚点 :", res.badAnchors.length ? res.badAnchors.join(", ") : "none");
  console.log("外部资源请求 :", res.external.length ? res.external.join(", ") : "none（纯单文件）");
  console.log("「待填」出现次数 :", res.counts.pendingLiteral, "｜节点 :", JSON.stringify(res.placeholder));
  console.log("可疑占位（TODO/lorem/xxx）:", res.counts.suspicious, "｜空卡片 :", res.counts.emptyCards);
  console.log("统计 :", JSON.stringify({ 更新条数: res.counts.logs, 限制条数: res.counts.limits, 主题行数: res.counts.themes, 内联棋盘: res.counts.boards }));
  console.log("控制台 error/warning :", consoleErrs.length ? consoleErrs : "none");
  console.log("pageerror :", pageErrs.length ? pageErrs : "none");
  console.log("请求失败 :", failedReqs.length ? failedReqs : "none");
  console.log("4xx/5xx 响应 :", badReqs.length ? badReqs : "none");
  console.log("页内链接 :", uniq.join("\n           "));
  if (s.width >= 1000) console.log("外链探测（不计入问题数）:\n           " + probe.join("\n           "));

  await page.screenshot({ path: path.join(OUT, s.name), fullPage: true });
  console.log("截图已写入 :", path.join(OUT, s.name));

  // 分区复核图（人眼看版式用，落在 tools/review/，不是交付物）
  const reviewDir = path.join(OUT, "tools", "review");
  mkdirSync(reviewDir, { recursive: true });
  for (const id of ["hero", "sec01", "sec02", "sec03", "sec04", "sec05", "download", "sec06"]) {
    const el = await page.$("#" + id);
    if (!el) continue;
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: path.join(reviewDir, `${s.width}-${id}.png`) }).catch(() => {});
  }

  const problems = res.overflowers.length + res.clipped.length + res.boxOverflow.length + res.counters.length + res.invisible.length + res.badAnchors.length
    + consoleErrs.length + pageErrs.length + failedReqs.length + badReqs.length + res.external.length + res.counts.emptyCards;
  if (problems) fatal += problems;
  await ctx.close();
}

await browser.close();
console.log("\n=== 汇总问题数：", fatal, "===");
process.exit(0);
