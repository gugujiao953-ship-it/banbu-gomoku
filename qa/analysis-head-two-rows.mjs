/**
 * 门禁：分析面板头部的两行布局（用户 09-16：「分析功能的选项要补齐……实在不行就两行，
 * 和那个可调节的内存搁一块」）。在自调档（出现内存滑杆）下实测尺寸与滚动行为。
 * 断言：
 *  - 恰好两行，第一行控件全部在同一 top（没有因为补齐选项而挤散）
 *  - 第二行内容溢出时是横向可滚动（scrollWidth > clientWidth 且能滚到最右）
 *  - 每个控件的热区高度 ≥ 44px（点击方便），没有 0 宽/被裁切
 *  - 第一行没有横向溢出（原来就是一行放下的，不能被新样式破坏）
 * 用法：node scripts/.tmp-two-row-check.mjs [360,390,412]
 */
import { chromium } from "playwright";

const widths = (process.argv[2] || "360,390,412").split(",").map(Number);
const url = (process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/") + (process.env.QA_BASE_URL?.includes("?") ? "" : "?qa=1");
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    // 自调档 + 原生线程数可见（网页版下线程行不显示，所以这里同时打开多线程开关）
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 3, engineMultiThread: true, engineThreads: 0 }));
    localStorage.setItem("banbu-ai-engine-choice-v1", "tuned");
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // 精确点底部导航的「打谱」：DOM 里第一个含「打谱」的按钮不一定是它
// （开「横向滚动」时功能区两端会有两枚箭头按钮，起点处是 disabled，getByRole().first() 会点不到）。
await page.evaluate(() => [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click());
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith("H8"));
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const head = document.querySelector(".ai-analysis-head");
    if (!head) return { missing: true };
    const rows = [...head.querySelectorAll(".ai-analysis-row")];
    const describe = (row) => {
      const box = row.getBoundingClientRect();
      const kids = [...row.children].map((child) => {
        const r = child.getBoundingClientRect();
        return { label: (child.textContent || "").trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      });
      return {
        height: Math.round(box.height),
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        tops: [...new Set(kids.map((k) => k.top))].length,
        kids,
      };
    };
    // 滚到最右，确认真的能滚（不是被裁掉）
    const engineRow = rows[1];
    engineRow.scrollLeft = 9999;
    const scrolledTo = engineRow.scrollLeft;
    engineRow.scrollLeft = 0;
    return { headHeight: Math.round(head.getBoundingClientRect().height), rowCount: rows.length, main: describe(rows[0]), engine: describe(rows[1]), scrolledTo };
  });

  console.log(`\n=== 视口 ${width}px ===`);
  if (info.missing) { check(`${width} 找到分析头`, false); await context.close(); continue; }
  check(`${width} 恰好两行`, info.rowCount === 2, `rowCount=${info.rowCount} headH=${info.headHeight}`);
  const offBaseline = info.main.kids.filter((k) => k.top !== Math.min(...info.main.kids.map((x) => x.top)));
  check(`${width} 第一行控件同一基线`, info.main.tops === 1, `tops=${info.main.tops}${offBaseline.length ? ` 掉下去的：${offBaseline.map((k) => k.label).join("/")}` : ""}`);
  check(`${width} 第一行没有溢出`, info.main.scrollWidth <= info.main.clientWidth + 1, `scroll=${info.main.scrollWidth} client=${info.main.clientWidth}`);
  check(`${width} 第二行可横向滚动`, info.engine.scrollWidth > info.engine.clientWidth ? info.scrolledTo > 0 : true,
    `scroll=${info.engine.scrollWidth} client=${info.engine.clientWidth} scrolledTo=${info.scrolledTo}`);
  const tiny = [...info.main.kids, ...info.engine.kids].filter((k) => k.w === 0 || k.h < 44);
  check(`${width} 无零宽/矮热区控件`, tiny.length === 0, tiny.map((k) => `${k.label}:${k.w}x${k.h}`).join(" "));
  console.log(`  第一行(${info.main.kids.length}): ${info.main.kids.map((k) => `${k.label}${k.w}`).join(" | ")}`);
  console.log(`  第二行(${info.engine.kids.length}): ${info.engine.kids.map((k) => `${k.label}${k.w}`).join(" | ")}`);
  await context.close();
}
await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n两行布局断言全部通过");
process.exit(failed ? 1 : 0);
