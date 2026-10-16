// 批量跑数字头集成原型：对一组（探针 JSON, 素材图）逐个打开测速页并汇总成绩单。
// 用法：MODEL=数字头onnx路径 node qa/tmp-ort-batch.mjs
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const model = process.env.MODEL || "/qa/fixtures/models/digit-head-iter2.onnx";
const items = [
  { id: "numbered", cv: "/qa/tmp-cv-numbered.json", image: "/qa/fixtures/recognition/numbered.png", truth: "none" },
  { id: "user-98-36", cv: "/qa/tmp-cv-user-98-36.json", image: "/qa/fixtures/recognition/user-98-36.jpg", truth: "none" },
  { id: "paper10", cv: "/qa/tmp-cv-paper10.json", image: "/qa/fixtures/recognition/paper10.jpg", truth: "none" },
  { id: "paper02", cv: "/qa/tmp-cv-paper02.json", image: "/qa/fixtures/recognition/paper02.jpg", truth: "/qa/fixtures/recognition/paper02.truth.json" },
  { id: "user-99-43", cv: "/qa/tmp-cv-user-99-43.json", image: "/qa/fixtures/recognition/user-99-43.jpg", truth: "none" },
  { id: "remote-image1", cv: "/qa/tmp-cv-img1.json", image: "/qa/fixtures/recognition/remote-image1.jpeg", truth: "/qa/fixtures/recognition/remote-image1.truth.json" },
  { id: "fy11", cv: "/qa/tmp-cv-fy11.json", image: "/qa/fixtures/materials/fy11.png", truth: "none" },
  { id: "fy42", cv: "/qa/tmp-cv-fy42.json", image: "/qa/fixtures/materials/fy42.png", truth: "none" },
  { id: "remote-img-011", cv: "/qa/tmp-cv-remote-img-011.json", image: "/qa/fixtures/materials/remote-img-011.png", truth: "none" },
  { id: "remote-image2", cv: "/qa/tmp-cv-remote-image2.json", image: "/qa/fixtures/materials/remote-image2.png", truth: "none" },
  { id: "m1000_p40", cv: "/qa/tmp-cv-m1000_p40.json", image: "/qa/fixtures/materials/m1000_p40.png", truth: "none" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });

// 预热一页：vite 首次预打包 onnxruntime-web 时，页面内的 fetch 会瞬时失败（实测竞态），
// 预热后所有条目都稳定。
const warm = await context.newPage();
await warm.goto(new URL("qa/ort-digit-harness.html?cv=/qa/tmp-cv-fy11.json&image=/qa/fixtures/materials/fy11.png&truth=none&threads=4&model=" + encodeURIComponent(model), base).toString(), { waitUntil: "domcontentloaded" });
await warm.waitForFunction(() => globalThis.__harnessResult && globalThis.__harnessResult.ok === true, null, { timeout: 300000 });
await warm.close();

const rows = [];
for (const item of items) {
  let attempt = 0;
  let row = null;
  while (attempt < 3 && !row) {
    attempt += 1;
    const page = await context.newPage();
    const query = new URLSearchParams({ cv: item.cv, image: item.image, truth: item.truth || "none", threads: "4", model });
    try {
      await page.goto(new URL(`qa/ort-digit-harness.html?${query}`, base).toString(), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.__harnessResult && globalThis.__harnessResult.ok === true, null, { timeout: 300000 });
      const result = await page.evaluate(() => globalThis.__harnessResult);
      if (result.error) { row = null; } else {
        const digits = (result.reads || []).map((read) => read.digit).filter((digit) => digit > 0);
        const counts = new Map();
        for (const digit of digits) counts.set(digit, (counts.get(digit) || 0) + 1);
        const dups = [...counts.entries()].filter(([, n]) => n > 1);
        row = {
          id: item.id,
          stones: result.summary.stones,
          read: digits.length,
          unique: new Set(digits).size,
          dupPairs: dups.length,
          range: digits.length ? `${Math.min(...digits)}..${Math.max(...digits)}` : "-",
          ms: result.summary.totalMs,
          correct: item.truth === "none" ? "-" : `${result.summary.correct}/${result.summary.stones}`,
        };
      }
    } catch (error) {
      row = null;
    }
    await page.close();
  }
  rows.push(row ?? { id: item.id, error: "3 次尝试均失败" });
}
console.log(`模型：${model}`);
console.log("图 | 棋子 | 读出 | 唯一 | 重号对 | 范围 | 耗时ms | 真值对");
for (const row of rows) {
  console.log([row.id, row.stones ?? "-", row.read ?? "-", row.unique ?? "-", row.dupPairs ?? "-", row.range ?? "-", row.ms ?? "-", row.correct ?? (row.error ? `ERR ${row.error}` : "-")].join(" | "));
}
await browser.close();
