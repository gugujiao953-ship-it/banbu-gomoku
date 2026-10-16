// 门禁：核对屏在**横屏（矮视口）**下必须完整可用（2026-10-15 立，用户报「识谱后横屏有 bug」）。
//
// 背景：核对屏的叠图是**方形**的，原来按 `width: 100%` 铺满 → 高度 = 视口宽，
// 740×360 横屏上棋盘变成 716×716，把底部「返回对齐 / 取消 / 确认导入」顶到视口外
// （实测按钮 y=356、视口只有 360 高 → 点不到确认）。修法见 image-verify.css 的
// `@media (max-height: 560px)`：让 stage 自己保持正方形（高度由 flex 定、宽度由纵横比反推）。
//
// 断言（三种横向尺寸各 7 条）：无横向溢出、无控件出屏、确认按钮在视口内、棋盘完整可见、
// 棋盘保持正方形、棋盘不高于 stage（不被裁）。竖屏不受影响（另有 ui-recognition-verify 门禁）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/recognition-landscape-fit.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const image = resolve(process.cwd(), process.env.LANDSCAPE_IMAGE || "qa/fixtures/recognition/app-played-game.png");
const sizes = (process.env.LANDSCAPE_SIZES || "852x392,740x360,960x450").split(",").map((pair) => {
  const [w, h] = pair.split("x").map(Number);
  return { width: w, height: h };
});

const assert = (ok, msg) => { if (!ok) { failures.push(msg); console.log(`FAIL ${msg}`); } else console.log(`PASS ${msg}`); };
const failures = [];
const browser = await chromium.launch({ headless: true });
for (const viewport of sizes) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 60_000 });

  const measure = (label) => page.evaluate((label) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflow = [];
    for (const el of document.querySelectorAll("button, .board-fs-actions, .image-verify, .image-verify-modes, .image-verify-confirm, .bottom-nav, .sheet, [role=dialog]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) {
        overflow.push({ tag: el.className || el.tagName, text: (el.textContent || "").trim().slice(0, 12), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
      }
    }
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const stage = box(".image-verify-stage"), frame = box(".image-verify-frame");
    const verifyBoard = document.querySelector(".image-verify-photo");
    const vb = verifyBoard ? verifyBoard.getBoundingClientRect() : null;
    return {
      label, viewport: `${vw}x${vh}`,
      scrollWidth: document.documentElement.scrollWidth, docOverflowX: document.documentElement.scrollWidth > vw + 1,
      verifyBoard: vb ? [Math.round(vb.left), Math.round(vb.top), Math.round(vb.width), Math.round(vb.height)] : null,
      confirm: (() => { const el = document.querySelector(".image-verify-confirm"); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
      modes: (() => { const el = document.querySelector(".image-verify-modes"); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
      stage, frame,
      overflow: overflow.slice(0, 8),
    };
  }, label);

  console.log(`\n=== 视口 ${viewport.width}x${viewport.height} ===`);
  await page.evaluate(() => { document.querySelector(".bottom-nav .nav-center")?.click(); });
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
  await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(image);
  await page.waitForSelector(".board-fs-actions", { timeout: 30_000 });
  await page.waitForTimeout(400);
  const align = await measure("对齐屏");
  console.log(`  对齐屏：${JSON.stringify(align)}`);
  await page.screenshot({ path: `qa/tmp-landscape-align-${viewport.width}x${viewport.height}.png` });

  await page.locator(".board-fs-actions button:has-text('识别')").click();
  await page.locator(".image-verify").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(600);
  const verify = await measure("核对屏");
  console.log(`  核对屏：${JSON.stringify(verify)}`);
  await page.screenshot({ path: `qa/tmp-landscape-verify-${viewport.width}x${viewport.height}.png` });
  if (errors.length) assert(false, `${viewport.width}x${viewport.height} 页面错误：${errors.slice(0, 2).join(" | ")}`);
  // 断言（2026-10-15 用户报「识谱后横屏有 bug」时立的）：
  // ① 核对屏不得有横向溢出；② 底部操作行（返回对齐/取消/确认导入）必须在视口内；
  // ③ 棋盘是正方形且完整落在 stage 里（不被裁）；④ 对齐屏也要在视口内。
  assert(align.docOverflowX === false, `${viewport.width}x${viewport.height} 对齐屏无横向溢出`);
  assert(verify.docOverflowX === false, `${viewport.width}x${viewport.height} 核对屏无横向溢出`);
  assert(verify.overflow.length === 0, `${viewport.width}x${viewport.height} 核对屏无控件出屏（实测 ${verify.overflow.length} 个）`);
  const fits = (box) => box && box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= viewport.width + 1 && box[1] + box[3] <= viewport.height + 1;
  assert(fits(verify.confirm), `${viewport.width}x${viewport.height} 「确认导入」在视口内 ${JSON.stringify(verify.confirm)}`);
  assert(fits(verify.verifyBoard), `${viewport.width}x${viewport.height} 棋盘完整可见（不超出视口） ${JSON.stringify(verify.verifyBoard)}`);
  assert(verify.stage && verify.verifyBoard && Math.abs(verify.verifyBoard[2] - verify.verifyBoard[3]) <= 2, `${viewport.width}x${viewport.height} 棋盘保持正方形`);
  assert(verify.stage && verify.verifyBoard && verify.verifyBoard[3] <= verify.stage[3] + 1, `${viewport.width}x${viewport.height} 棋盘不高于 stage（不被裁） 棋盘 ${verify.verifyBoard?.[3]} vs stage ${verify.stage?.[3]}`);
  await context.close();
}
await browser.close();
if (failures.length) { console.log(`[landscape-fit] fail：${failures.length} 条`); process.exit(1); }
console.log("[landscape-fit] pass");
