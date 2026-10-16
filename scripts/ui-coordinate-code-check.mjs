import { chromium } from "playwright";

// 常驻门禁：坐标代码（2026-09-17 用户需求）+ 触觉反馈（同日，默认关闭）。
//
// 坐标代码这一半守的是三条契约：
//   C1 导入面板有入口，且是「粘贴」而不是只能走文件（原先只有 POS/TXT 文件导入）；
//   C2 输入 → 实时报「识别到 N 手」→ 生成的是**未保存**棋谱、棋盘子数对得上；
//   C3/C4 看不懂 / 越界的坐标必须如实提示、且路数切换真的生效（15 路下 P8 该被拒）；
//   C5 反向：更多面板的「复制坐标代码」把主线写进剪贴板，内容与主线逐字一致。
// 触觉这一半守的是"默认关闭"与"开了真震"两头，用桩替换 navigator.vibrate 取证。
//
// 用法：BANBU_URL=http://127.0.0.1:5195 node scripts/ui-coordinate-code-check.mjs
// 也接受 run-qa 的 QA_BASE_URL；?qa=1 必须带上（首运行欢迎页幕布会挡死点击）。
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5195/";
const url = base.includes("?") ? base : `${base}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // 触觉取证：真机上是安卓 WebView 的 navigator.vibrate，桌面 headless 里换成记录桩。
  window.__vibrations = [];
  navigator.vibrate = (pattern) => { window.__vibrations.push(pattern); return true; };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` :: ${detail}`}`);
  if (!ok) failed += 1;
};
const clickText = async (text, selector = "button") => {
  const clicked = await page.evaluate(([needle, scope]) => {
    const node = [...document.querySelectorAll(scope)].find((element) => (element.getAttribute("aria-label") || element.textContent || "").includes(needle));
    if (!node) return false;
    node.click();
    return true;
  }, [text, selector]);
  await page.waitForTimeout(500);
  return clicked;
};
const clickCell = async (label) => {
  await page.evaluate((needle) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(needle));
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await page.waitForTimeout(600);
};
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const countLabel = () => page.evaluate(() => document.querySelector(".coordinate-code-count")?.textContent?.trim() || "");
const notes = () => page.evaluate(() => [...document.querySelectorAll(".coordinate-code-notes li")].map((element) => element.textContent?.trim()).join(" | "));
const statusText = () => page.evaluate(() => document.querySelector(".unified-status-lines")?.textContent || "");
const openCodeSheet = async () => {
  await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
  await page.waitForTimeout(600);
  return clickText("粘贴坐标代码");
};
const fillCode = async (value) => { await page.fill('textarea[aria-label="坐标代码"]', value); await page.waitForTimeout(400); };

// ── C 段：坐标代码导入 ───────────────────────────────────
check("C1 导入面板有「粘贴坐标代码」入口", await openCodeSheet());
await fillCode("H8 I9 H10");
check("C2a 输入时实时报「识别到 3 手」", (await countLabel()).includes("3 手"), await countLabel());
check("C2b 解析无警告（三个坐标都干净）", (await notes()) === "", await notes());
await clickText("生成棋谱");
await page.waitForTimeout(900);
check("C2c 生成后棋盘出现 3 颗子（停在最后一手，不是空盘）", (await stoneCount()) === 3, `stones=${await stoneCount()}`);
check("C2d 状态条手数与生成的手数一致", /第 3 手 \/ 3/.test(await statusText()), (await statusText()).slice(0, 46));

await openCodeSheet();
await fillCode("H16");
check("C3a 15 路下 H16 识别不到（不会静默错放）", (await countLabel()).includes("等待输入"), await countLabel());
check("C3b 越界如实提示并指路数", (await notes()).includes("超出 15 路范围"), await notes());
await page.selectOption('select[aria-label="坐标代码的棋盘路数"]', "17");
await page.waitForTimeout(500);
check("C4 切到 17 路后 P8 可识别（路数真的生效）", (await countLabel()).includes("1 手"), await countLabel());
await clickText("取消");
await page.waitForTimeout(400);

// ── C5：反向导出 ────────────────────────────────────────
await page.evaluate(() => document.querySelector('[data-action-id="view"]')?.click());
await page.waitForTimeout(700);
check("C5a 更多面板有「复制坐标代码」", await clickText("复制坐标代码"));
await page.waitForTimeout(600);
const clip = await page.evaluate(async () => {
  try { return await navigator.clipboard.readText(); } catch (error) { return `ERR:${String(error).slice(0, 60)}`; }
});
check("C5b 剪贴板内容与主线逐字一致", clip === "H8 I9 H10", clip);
await page.evaluate(() => document.querySelector('[data-action-id="view"]')?.click());
await page.waitForTimeout(400);

// ── H 段：触觉反馈 ──────────────────────────────────────
await clickCell("J10空位");
const offState = await page.evaluate(() => ({ stones: document.querySelectorAll(".stone-piece").length, vibrations: window.__vibrations.length }));
check("H1 默认关闭：落子成功但不震动", offState.stones === 4 && offState.vibrations === 0, JSON.stringify(offState));

await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ ...raw, haptics: true }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
// 换一个从未用过的点：重载后草稿可能已经恢复了刚才那一手，点"已占位置"会静默失败。
await clickCell("K11空位");
const onState = await page.evaluate(() => ({ stones: document.querySelectorAll(".stone-piece").length, vibrations: window.__vibrations.slice() }));
check("H2 打开开关后落子按 move-black 震动（12ms）", onState.stones >= 1 && onState.vibrations.includes(12), JSON.stringify(onState));

await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((button) => (button.textContent || "").includes("设置"))?.click(); });
await page.waitForTimeout(800);
await page.fill('input[aria-label="搜索设置"]', "震动");
await page.waitForTimeout(600);
const rowFound = await page.evaluate(() => [...document.querySelectorAll(".setting-row")].some((row) => (row.textContent || "").includes("触觉反馈")));
check("H3 设置搜索「震动」能找到触觉反馈开关", rowFound);

// ── D 段：面板配色对比度（找茬轮实测抓过 baroque 4.35 / rain 4.47，改配色后固化在此）──
await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((button) => (button.textContent || "").includes("打谱"))?.click(); });
await page.waitForTimeout(600);
// H2 落的子留了未保存草稿：不放弃它，开导入面板会被「有未保存草稿」确认框挡住。
await page.evaluate(() => document.querySelector('[data-action-id="navDiscard"]')?.click());
await page.waitForTimeout(500);
await openCodeSheet();
await fillCode("H8 I9 H16"); // 2 手有效（ready 徽标在场）+ 1 个越界（警告条在场），两个状态一次量齐
const elementContrast = () => page.evaluate(() => {
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (text) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(text); return m ? [+m[1], +m[2], +m[3]] : null; };
  const ratio = (a, b) => { const l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
  const measure = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const fg = parse(style.color), bg = parse(style.backgroundColor);
    return fg && bg ? ratio(fg, bg) : null;
  };
  return { note: measure(document.querySelector(".coordinate-code-notes")), count: measure(document.querySelector(".coordinate-code-count.ready")) };
});
for (const theme of ["", "dark", "rain", "baroque"]) {
  await page.evaluate((name) => { if (name) document.documentElement.dataset.theme = name; else delete document.documentElement.dataset.theme; }, theme);
  await page.waitForTimeout(300);
  const contrast = await elementContrast();
  check(`D ${theme || "默认"}主题：提示条与计数徽标对比度 ≥ 4.5`, (contrast.note ?? 0) >= 4.5 && (contrast.count ?? 0) >= 4.5, JSON.stringify(contrast));
}
await page.evaluate(() => { delete document.documentElement.dataset.theme; });
await clickText("取消");

check("Z 无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
