// 一次性测速脚本（非门禁）：分快慢两条路径测识别器耗时。
// 快路径 = 只找网格与棋子（skipMoveOrder: true，导入默认走这条）；
// 慢路径 = 加逐手序号匹配+装配（「复原手序-本地」走这条）。
// 目的：给「智子 1 秒完成」一个我们自己的对照刻度。
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");

const files = [
  { file: "numbered.png", mime: "image/png", note: "16 子一位数" },
  { file: "user-98-36.jpg", mime: "image/jpeg", note: "36 子两位数" },
  { file: "paper10.jpg", mime: "image/jpeg", note: "66 子极密最难" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-ai-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
}));
await page.goto(new URL("qa-ai-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of files) {
  const b64 = readFileSync(resolve("qa/fixtures/recognition", item.file)).toString("base64");
  const result = await page.evaluate(async ({ b64, mime, file, warm }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
    const make = () => new File([blob], file, { type: mime });
    const time = async (opts) => {
      const t0 = performance.now();
      const r = await mod.recognizeBoardImage(make(), 15, opts);
      return { ms: Math.round(performance.now() - t0), stones: r.board.flat().filter(Boolean).length, numbers: r.readMoveNumbers.length };
    };
    if (warm) await time({ skipMoveOrder: true, parallel: true }); // 预热（首次含 worker 启动）
    const fast1 = await time({ skipMoveOrder: true, parallel: true });
    const fast2 = await time({ skipMoveOrder: true, parallel: true });
    const full = await time({ skipMoveOrder: false, parallel: true });
    return { fast1, fast2, full };
  }, { b64, mime: item.mime, file: item.file, warm: true });
  console.log(`${item.file}（${item.note}）`);
  console.log(`  快路径（找网格+棋子） 第1次 ${result.fast1.ms}ms / 第2次 ${result.fast2.ms}ms  → ${result.fast1.stones} 子`);
  console.log(`  慢路径（+读序号装配） ${result.full.ms}ms  → ${result.full.stones} 子 / 读出 ${result.full.numbers} 个号`);
}

await browser.close();
