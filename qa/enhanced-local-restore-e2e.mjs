// 「复原手序-本地」增强链路的**生产路径**端到端验收（2026-10-07）：
// 在 vite preview（base="./"，与正式部署同构）上走真实 UI 流程：
//   导入图片 → 对齐屏识别 → 核对屏点「复原手序-本地」→ 断言完整复原第 1..89 手、
//   叠图 89 颗子全带手序号。
// 这条专门验证「内置增强包在生产相对路径下能加载」（此前 QA 都走 /node_modules 显式路径）。
// 用法：QA_BASE_URL=http://localhost:4173/ node qa/enhanced-local-restore-e2e.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
if (process.env.FAST_OFF === "1") url.searchParams.set("fastoff", "1");
const fixture = resolve("qa/fixtures/materials/remote-image2.png");

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // 诊断开关：FAST_OFF=1 时关掉识谱多核加速（排查生产构建下 worker 池）
  if (new URLSearchParams(location.search).get("fastoff") === "1") {
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ fastRecognition: false }));
  }
});
const errors = [];
const modelRequests = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(`${error?.name || ""}:${error?.message || String(error)}`.slice(0, 200)));
page.on("response", (response) => {
  const requestUrl = response.url();
  if (/\/models\/|ort-wasm/.test(requestUrl)) modelRequests.push(`${response.status()} ${requestUrl.split("/").slice(-1)[0]}`);
});
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });

// 走 UI：打谱 → 导入 → 图片识谱 → 对齐屏识别
await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
const beforeStones = await page.locator("[data-verify-stone]").count();
console.log(`识别后叠图棋子：${beforeStones}（默认路径下的现状）`);

// 点「复原手序-本地」——增强包（cell-cls 补位 + 长头数字头）就在这里生效
await page.locator("[data-local-restore]").click();
await page.waitForFunction(() => document.querySelector(".image-verify-hint")?.textContent?.includes("本地已按图上序号复原"), null, { timeout: 180000 }).catch(() => {});
const after = await page.evaluate(() => ({
  hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
  numbered: document.querySelectorAll("[data-verify-number]").length,
  stones: document.querySelectorAll("[data-verify-stone]").length,
  editDisabled: document.querySelector(".image-verify-modes button:nth-child(4)")?.disabled === true,
}));
check("增强包在生产路径下加载成功（models/ 与 ort-wasm 都有 200）", modelRequests.every((entry) => entry.startsWith("200")) && modelRequests.length >= 3, JSON.stringify(modelRequests.slice(0, 6)));
// 2026-10-07 起导入路径已能自己找齐白底图（占用扫描补位在全图 89 颗上零假阳零错色，
// 见 qa/tmp-import-truth-e2e.mjs 的逐坐标对账），所以这里不再断言「默认链路只认一半」
// ——那句话描述的是 2026-10-07 之前（§19）的旧现状。完整性与正确性由下面的复原断言
// 与那条逐坐标对账脚本负责。
check("识别后叠图棋子数在合理范围", beforeStones >= 4 && beforeStones <= 89, `before=${beforeStones}`);
check("复原后提示写明第 1 手到第 89 手", after.hint.includes("第 1 手到第 89 手"), after.hint.slice(0, 80));
check("叠图 89 颗子全带手序号", after.numbered === 89 && after.stones === 89, `numbers=${after.numbered} stones=${after.stones}`);
check("已复原手序 → 编辑被锁", after.editDisabled === true);

// 确认导入 → 建的是有序棋谱
await page.locator(".image-verify-confirm").click();
await page.waitForTimeout(1500);
const imported = await page.evaluate(() => ({
  stones: document.querySelectorAll(".stone-piece").length,
  lastDot: !!document.querySelector(".last-dot, .last-move-number"),
}));
check("导入建谱 89 子且是有序棋谱", imported.stones === 89 && imported.lastDot === true, JSON.stringify(imported));
check("无页面错误", errors.length === 0, errors.join(" | "));

console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
