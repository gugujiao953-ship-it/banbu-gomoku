// 一次性展示脚本：实拍书谱 → 本地复原手序 → 截图成品。
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5301/";
const url = new URL(base);
url.searchParams.set("qa", "1");
const fixture = resolve("qa/fixtures/recognition/user-98-36.jpg");
const outShot = "D:/Projects/经济学知识/15_半步五子棋/辅助/复原成果-实拍36子.png";

// 1) 先从识别器拿出手序真值清单（打印用）
const browser = await chromium.launch({ headless: true });
const probeCtx = await browser.newContext({ serviceWorkers: "block" });
const probe = await probeCtx.newPage();
await probe.route("**/qa-host.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
await probe.goto(new URL("qa-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const moves = await probe.evaluate(async (b64) => {
  const mod = await import("/src/image-recognition.ts");
  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const result = await mod.recognizeBoardImage(new File([blob], "user-98-36.jpg", { type: "image/jpeg" }), 15, {});
  return result.numberedMoves.map((m) => ({ n: m.number, coord: `${String.fromCharCode(65 + m.col)}${15 - m.row}`, p: m.player === "black" ? "●" : "○" }));
}, readFileSync(fixture).toString("base64"));
await probeCtx.close();
console.log(`识别器复原出的落子顺序（${moves.length} 手）：`);
for (let i = 0; i < moves.length; i += 6) {
  console.log("  " + moves.slice(i, i + 6).map((m) => `${String(m.n).padStart(2)}:${m.p}${m.coord}`).join("  "));
}

// 2) 驱动应用 UI：导入 → 识别（快路径）→ 核对屏点「复原手序-本地」→ 确认 → 截图（09-29 定名）
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
});
const page = await context.newPage();
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(600);
await page.locator("[data-local-restore]").click(); // 「复原手序-本地」：重跑带序号匹配的识别
await page.waitForFunction(() => document.querySelector(".image-verify-hint")?.textContent?.includes("本地已按序号复原"), null, { timeout: 120000 });
const hintText = await page.locator(".image-verify-hint").textContent();
console.log(`\n核对屏提示：${hintText?.trim()}`);
console.log(`叠图带手序的棋子数：${await page.locator("[data-verify-number]").count()}`);
console.log(`编辑是否被锁（已按序号复原则锁）：${await page.locator(".image-verify-modes button").last().evaluate((b) => b.disabled)}`);
await page.locator(".image-verify-confirm").click();
await page.waitForTimeout(1500);
// 关掉底部面板让棋盘更大，然后截棋盘区域
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(600);
const board = page.locator("svg.board-svg, .board-container, svg").first();
const shot = await page.evaluate(() => {
  const el = document.querySelector(".record-board, .board-stage, svg");
  if (!el) return null;
  const r = (el.closest("[class*=board]") || el).getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
});
if (shot && shot.width > 50) await page.screenshot({ path: outShot, clip: shot });
else await page.screenshot({ path: outShot, fullPage: false });
console.log(`\n截图已存：${outShot}`);
await browser.close();
