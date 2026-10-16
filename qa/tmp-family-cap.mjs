// 手序读号「升格」的成本/收益（2026-10-09）。
//
// 现场：手序净耗时 4.6 秒（76 手密盘，363 次扫描 / 10M 比对）而那张图最终**复原 0**
// （序号读不全 → 如实拒绝）。也就是说升格（15 个字体族 × 投票样本 × Stage2/3/4）
// 在这张图上一分收益都没换来，纯花时间。
//
// 本探针用 __BANBU_FAMILY_CAP__（把参与投票/升格的族数上限压到 N）对比：
//   · 读出数（readMoveNumbers.length）——少了就说明升格真在产出
//   · 复原数（numberedMoves.length）——最终目标
//   · 净耗时
// 若在若干图上「读出/复原不变而耗时大降」，就说明可以安全收窄族池。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-family-cap.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png", note: "网页密盘 76 子" },
  { path: "qa/fixtures/recognition/user-98-36.jpg", mime: "image/jpeg", note: "36 子两位数" },
  { path: "qa/fixtures/materials/remote-image2.png", mime: "image/png", note: "白底 89 手" },
  { path: "qa/fixtures/recognition/paper10.jpg", mime: "image/jpeg", note: "书谱 66 子" },
];
const caps = [0, 6, 4];

const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const line = [];
  for (const cap of caps) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 120)));
    await page.route("**/qa-fc-host.html", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
    }));
    await page.goto(new URL("qa-fc-host.html", base).toString(), { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(async ({ dataUrl, name, cap }) => {
      globalThis.__BANBU_FAMILY_CAP__ = cap;
      const mod = await import("/src/image-recognition.ts");
      const head = await import("/src/features/record/digit-head.ts");
      const [digitReader, boardScanner] = await Promise.all([
        head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
        head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      ]);
      const blob = await (await fetch(dataUrl)).blob();
      const make = () => new File([blob], name, { type: blob.type });
      // 预热一次（排除首轮装载）
      await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false });
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined });
      return {
        ms: Math.round(performance.now() - started),
        stones: result.board.flat().filter(Boolean).length,
        reads: result.readMoveNumbers.length,
        restored: result.numberedMoves.length,
        sweeps: mod.moveOrderPerf.sweeps,
      };
    }, { dataUrl, name: item.path.split("/").pop(), cap });
    await context.close();
    line.push(`cap=${cap || "全"}: ${out.ms}ms / 读出 ${out.reads} / 复原 ${out.restored} / 扫 ${out.sweeps}`);
  }
  console.log(`\n${item.note}`);
  for (const row of line) console.log(`  ${row}`);
}
await browser.close();
