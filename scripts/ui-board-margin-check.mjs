import { chromium } from "playwright";

// 棋盘侧边（四边坐标缝）门禁：设置页滑杆能把四边坐标空间压窄、棋盘本体随之变大，
// 且压到最小档时坐标仍完整落在底板内（"勉强容纳"而不是被裁掉）。默认档必须与
// 改造前逐像素一致，否则等于偷偷改掉所有人的棋盘观感。
// Usage: BANBU_URL=http://127.0.0.1:5299 node scripts/ui-board-margin-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1）；?qa=1 必须带上（首运行欢迎页幕布会挡死点击，表现为假失败）。
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5299/";
const url = base.includes("?") ? base : `${base}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

const tab = async (label) => {
  await page.evaluate((name) => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim() === name)?.click(); }, label);
  await page.waitForTimeout(900);
};

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await tab("打谱");
for (const coord of ["H8", "I9", "G7", "J8"]) {
  await page.evaluate((label) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(label));
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, coord);
  await page.waitForTimeout(200);
}

const geometry = () => page.evaluate(() => {
  const firstGrid = document.querySelector(".grid-lines line");
  const letters = [...document.querySelectorAll(".coordinates text")];
  const xs = letters.map((element) => Number(element.getAttribute("x"))).filter(Number.isFinite);
  const ys = letters.map((element) => Number(element.getAttribute("y"))).filter(Number.isFinite);
  return {
    gridX1: Number(firstGrid?.getAttribute("x1")),
    gridX2: Number(firstGrid?.getAttribute("x2")),
    coordMinX: Math.min(...xs), coordMaxX: Math.max(...xs),
    coordMinY: Math.min(...ys), coordMaxY: Math.max(...ys),
  };
});
// 底板矩形是 4..568（board-bg x/y=4 / width=564）；坐标越过它就意味着被裁。
const insideFrame = (geometry_) => geometry_.coordMinX >= 4 && geometry_.coordMaxX <= 568 && geometry_.coordMinY >= 4 && geometry_.coordMaxY <= 568;
const setMargin = async (value) => {
  await page.evaluate((next) => {
    const input = document.querySelector('[aria-label="棋盘侧边"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(600);
};

const before = await geometry();
check("默认档格线仍是 34–538", before.gridX1 === 34 && before.gridX2 === 538, JSON.stringify(before));
check("默认档坐标仍是 18/554/20/560（未改观感）", before.coordMinX === 18 && before.coordMaxX === 554 && before.coordMinY === 20 && before.coordMaxY === 560, JSON.stringify({ minX: before.coordMinX, maxX: before.coordMaxX, minY: before.coordMinY, maxY: before.coordMaxY }));

await tab("设置");
const slider = page.locator('[aria-label="棋盘侧边"]');
check("设置 → 棋盘显示 有「棋盘侧边」滑杆", await slider.count() === 1);
if (!(await slider.count())) {
  await browser.close();
  process.exitCode = 1;
  console.log("\n缺少滑杆，后续断言跳过");
  process.exit(1);
}
await page.locator(".settings-order-10 > summary").first().click();
await page.waitForTimeout(400);
check("滑杆在展开后可见", await slider.isVisible());
const min = Number(await slider.getAttribute("min"));
const max = Number(await slider.getAttribute("max"));
check("量程 = 最小档..34，默认在右端", max === 34 && min > 4 && min < 34, `min=${min} max=${max}`);

await setMargin(26);
await tab("打谱");
const compact = await geometry();
check("中间档格线 26–546（棋盘变大）", compact.gridX1 === 26 && compact.gridX2 === 546, JSON.stringify({ x1: compact.gridX1, x2: compact.gridX2 }));
check("中间档坐标收回缝内、未越界", insideFrame(compact), JSON.stringify(compact));

await tab("设置");
await setMargin(min);
await tab("打谱");
const tight = await geometry();
check("最小档格线贴到最小侧边", tight.gridX1 === min && tight.gridX2 === 572 - min, JSON.stringify({ x1: tight.gridX1, x2: tight.gridX2 }));
check("最小档坐标仍完整落在底板内（勉强容纳，不被裁）", insideFrame(tight), JSON.stringify(tight));
check("最小档棋盘明显更大", tight.gridX2 - tight.gridX1 >= before.gridX2 - before.gridX1 + 20, `最窄 ${tight.gridX2 - tight.gridX1} vs 默认 ${before.gridX2 - before.gridX1}`);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
const persisted = await geometry();
check("刷新后侧边设置保留", persisted.gridX1 === min, JSON.stringify({ x1: persisted.gridX1, min }));

await tab("设置");
await setMargin(34);
await tab("打谱");
const restored = await geometry();
check("拖回默认档恢复 34–538", restored.gridX1 === 34 && restored.gridX2 === 538, JSON.stringify({ x1: restored.gridX1, x2: restored.gridX2 }));
check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
