import { chromium } from "playwright";

// 棋子大小门禁（2026-09-15 用户需求）：棋盘上棋子半径本来就随「棋路 + 侧边」自动缩放，
// 这个滑杆让用户在自动值上再缩放一档。三条硬约束：
//   ① 默认档必须与改造前逐像素一致（15 路 gap=36 → r=15.48 = 0.43×gap），
//      否则等于偷偷改掉所有人的棋盘观感；
//   ② 用户红线「最大不能压住其他棋子」——上限是相邻棋子相切（r = gap/2），
//      滑杆推到头也必须满足「任意两子圆心距 ≥ 两半径之和」；
//   ③ 「最小不能比默认小太多」——最小档 85%，仍随路数自动缩放。
// 另：落子热区必须跟着棋子长（否则点大棋子外缘没反应），但不能越过相切线，
// 越过之后相邻格的热区互相覆盖，点格子边界会落到隔壁。
// Usage: BANBU_URL=http://127.0.0.1:5195 node scripts/ui-stone-size-check.mjs
// 也接受 run-qa 的 QA_BASE_URL；?qa=1 必须带上（首运行欢迎页幕布会挡死点击）。
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5195/";
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
// 摆一手同排相邻的子（G8/H8/I8）：相邻两子的圆心距就正好是一个格距，
// 「不压住邻子」因此可以直接用「圆心距 ≥ 两半径之和」逐对核对。
for (const coord of ["G8", "H8", "I8"]) {
  await page.evaluate((label) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(label));
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, coord);
  await page.waitForTimeout(200);
}

// 全部读数都取自真实渲染：格距取网格线端点，半径取棋子图形自带半径 × 缩放变换。
const geometry = () => page.evaluate(() => {
  const gridLine = document.querySelector(".grid-lines line");
  const gridGroups = document.querySelectorAll(".grid-lines").length;
  const x1 = Number(gridLine?.getAttribute("x1"));
  const x2 = Number(gridLine?.getAttribute("x2"));
  const gap = gridGroups > 1 ? (x2 - x1) / (gridGroups - 1) : 0;
  const stones = [...document.querySelectorAll(".stone-piece .stone-body")].map((body) => {
    const transform = body.getAttribute("transform") || "";
    const scale = Number(/scale\(([-\d.eE]+)\)/.exec(transform)?.[1]);
    const parts = /translate\(([-\d.eE]+)[ ,]+([-\d.eE]+)\)/.exec(transform);
    const discRadius = Math.max(...[...body.querySelectorAll("circle")].map((circle) => Number(circle.getAttribute("r")) || 0));
    return { x: Number(parts?.[1]), y: Number(parts?.[2]), radius: discRadius * scale };
  });
  return { boardSize: gridGroups, gap, stones, hit: Number(document.querySelector(".board-hit")?.getAttribute("r")) };
});
/** 任意两子的圆心距是否都不小于两半径之和（相等＝相切，仍算「没压住」）。 */
const closestPairMargin = (stones) => {
  let worst = Number.POSITIVE_INFINITY;
  for (let i = 0; i < stones.length; i += 1) {
    for (let j = i + 1; j < stones.length; j += 1) {
      const distance = Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y);
      worst = Math.min(worst, distance - stones[i].radius - stones[j].radius);
    }
  }
  return worst;
};
const setStoneSize = async (value) => {
  await page.evaluate((next) => {
    const input = document.querySelector('[aria-label="棋子大小"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(600);
};
const expectRadius = 15.48; // 改造前公式 0.43 × 36（15 路、侧边 34）

const before = await geometry();
check("S1a 15 路格距仍是 36（棋盘几何未被本功能改动）", before.gap === 36, `gap=${before.gap} boardSize=${before.boardSize}`);
check("S1b 默认档半径仍是 15.48（改造前 0.43×gap，逐像素不变）", Math.abs(before.stones[0]?.radius - expectRadius) < 0.001, `r=${before.stones[0]?.radius}`);
check("S1c 默认档热区也未被改动", Math.abs(before.hit - 15.48 * 1.14) < 0.001, `hit=${before.hit}`);

await tab("设置");
const slider = page.locator('[aria-label="棋子大小"]');
check("S2a 设置 → 棋盘显示 有「棋子大小」滑杆", await slider.count() === 1);
if (!(await slider.count())) {
  await browser.close();
  process.exitCode = 1;
  console.log("\n缺少滑杆，后续断言跳过");
  process.exit(1);
}
await page.locator(".settings-order-10 > summary").first().click();
await page.waitForTimeout(400);
check("S2b 滑杆在展开后可见", await slider.isVisible());
const min = Number(await slider.getAttribute("min"));
const max = Number(await slider.getAttribute("max"));
const step = Number(await slider.getAttribute("step"));
const initial = Number(await slider.evaluate((element) => element.value));
check("S2c 量程 0.85–1.2、步长 0.05、默认落在 1（100%）", min === 0.85 && max === 1.2 && step === 0.05 && initial === 1, `min=${min} max=${max} step=${step} value=${initial}`);
check("S2d 读数写着「默认」", (await page.locator(".board-display-sliders output").first().textContent() || "").includes("默认"), await page.locator(".board-display-sliders output").first().textContent());

await setStoneSize(max);
await tab("打谱");
const biggest = await geometry();
check("S3a 最大档半径顶到相切：r = 格距/2 = 18", Math.abs(biggest.stones[0]?.radius - biggest.gap / 2) < 0.001, `r=${biggest.stones[0]?.radius} 相切=${biggest.gap / 2}`);
check("S3b 确实明显更大（比默认至少 +15%）", biggest.stones[0]?.radius >= expectRadius * 1.15, `${expectRadius} → ${biggest.stones[0]?.radius}`);
const margin = closestPairMargin(biggest.stones);
check("S4a 最大档下不压住邻子：任意两子圆心距 ≥ 两半径之和", margin >= -0.001, `最小余量=${margin.toFixed(4)} 子数=${biggest.stones.length}`);
check("S4b 至少含一对相邻子（断言真的量到了相邻关系）", biggest.stones.length >= 3 && Math.min(...biggest.stones.flatMap((stone, index) => biggest.stones.slice(index + 1).map((other) => Math.hypot(stone.x - other.x, stone.y - other.y)))) === biggest.gap, `子数=${biggest.stones.length}`);
check("S5 热区跟着棋子变大，但不超过相切线（格子边界不会抢邻格的点按）", biggest.hit > before.hit && biggest.hit <= biggest.gap / 2 + 0.001, `默认 ${before.hit} → 最大 ${biggest.hit}，相切 ${biggest.gap / 2}`);

await tab("设置");
await setStoneSize(min);
await tab("打谱");
const smallest = await geometry();
check("S6a 最小档比例正确（0.85）", Math.abs(smallest.stones[0]?.radius - expectRadius * 0.85) < 0.001, `r=${smallest.stones[0]?.radius} 期望=${(expectRadius * 0.85).toFixed(3)}`);
check("S6b 最小档不比默认小太多（≥ 默认的 80%）", smallest.stones[0]?.radius >= expectRadius * 0.8 && smallest.stones[0]?.radius < expectRadius, `r=${smallest.stones[0]?.radius} 默认=${expectRadius}`);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
const persisted = await geometry();
check("S7 刷新后棋子大小设置保留", Math.abs(persisted.stones[0]?.radius - expectRadius * 0.85) < 0.001, `r=${persisted.stones[0]?.radius}`);

await tab("设置");
await page.locator(".settings-order-10 > summary").first().click();
await page.waitForTimeout(300);
await page.evaluate(() => { [...document.querySelectorAll("button")].find((button) => (button.textContent || "").trim() === "恢复默认显示")?.click(); });
await page.waitForTimeout(500);
await tab("打谱");
const restored = await geometry();
check("S8 「恢复默认显示」把棋子大小一起复位", Math.abs(restored.stones[0]?.radius - expectRadius) < 0.001, `r=${restored.stones[0]?.radius}`);
check("S9 无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
