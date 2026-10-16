import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 手序匹配（matchMoveNumbers）耗时的专项基准（临时诊断，不入库）。
 *
 * 只报「带手序 − 无手序」这个同轮差值：它抵消了解码、网格检测等公共开销，
 * 剩下的就是这一段的净耗时。取各轮的**最小值**而不是中位数——本机常有其他会话
 * 抢 CPU，中位数会把负载尖峰算进去，最小值才接近无争用时的真实成本。
 *
 *   LABEL=before node scripts/.tmp-moveorder-bench.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5299/";
const label = process.env.LABEL || "run";
const reps = Number(process.env.BENCH_REPS || 9);

const fixtureDir = resolve("qa/fixtures/recognition");
const items = readdirSync(fixtureDir)
  .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
  .sort()
  .map((name) => ({
    name,
    b64: readFileSync(resolve(fixtureDir, name)).toString("base64"),
    mime: /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png",
  }));

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.route("**/qa-recognition-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
  }));
  await page.goto(new URL("qa-recognition-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });

  const rows = await page.evaluate(async ({ items, reps }) => {
    const mod = await import("/src/image-recognition.ts");
    const out = [];
    for (const item of items) {
      const file = new File(
        [await (await fetch(`data:${item.mime};base64,` + item.b64)).blob()],
        item.name,
        { type: item.mime },
      );
      await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false, parallel: false });
      const order = [], noOrder = [];
      // 交替跑，让机器负载漂移同时作用在两条腿上
      for (let i = 0; i < reps; i += 1) {
        let t = performance.now();
        await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false, parallel: false });
        order.push(performance.now() - t);
        t = performance.now();
        await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
        noOrder.push(performance.now() - t);
      }
      out.push({
        name: item.name,
        orderMin: Math.min(...order),
        noOrderMin: Math.min(...noOrder),
        deltaMin: Math.min(...order) - Math.min(...noOrder),
      });
    }
    return out;
  }, { items, reps });

  const round = (value) => Math.round(value * 10) / 10;
  console.log(`[${label}] 手序匹配净耗时（${reps} 轮取最小值, ms）`);
  for (const row of rows) console.log(`  ${row.name.padEnd(28)} 带手序 ${String(round(row.orderMin)).padStart(8)}  无手序 ${String(round(row.noOrderMin)).padStart(8)}  净 ${String(round(row.deltaMin)).padStart(8)}`);
  const total = rows.reduce((acc, row) => acc + row.deltaMin, 0);
  const totalOrder = rows.reduce((acc, row) => acc + row.orderMin, 0);
  const totalNoOrder = rows.reduce((acc, row) => acc + row.noOrderMin, 0);
  console.log(`[${label}] 七图合计：带手序 ${round(totalOrder)}  无手序 ${round(totalNoOrder)}  手序净耗时 ${round(total)}（占带手序识别的 ${((total / totalOrder) * 100).toFixed(1)}%）`);
  console.log(`[${label}] JSON ${JSON.stringify({ label, total, totalOrder, deltas: rows.map((r) => round(r.deltaMin)) })}`);
} finally {
  await browser.close();
}
