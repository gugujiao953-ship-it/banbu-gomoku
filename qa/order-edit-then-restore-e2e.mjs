// 用户流程端到端（2026-10-13 报障）：「导入 → 在核对屏删掉多认的那颗子 → 点『复原手序-本地』」，
// 断言复原**尊重用户改过的棋盘**（那颗子不再冒出来），并且手序仍完整。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/order-edit-then-restore-e2e.mjs
//
// 与清单里的 order-user-report-cases 的分工：那条是**模块级**（直接调识别器、断言读数与网格），
// 这条是**界面级**——它专门证明「核对屏的编辑真的传到了复原那一趟」（boardRevision +
// onBoardChange + knownBoard 三处接线），模块级测不到接线。UI 级 e2e 按本仓库惯例不入清单，
// 与 enhanced-local-restore-e2e / followup-buttons-e2e 同一档，按需手跑。
import { chromium } from "playwright";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const fixture = resolve("qa/fixtures/materials/user-report/book-blur-71.jpg");
/** 多认出来的那颗（真值只有 71 子；识别稳定给出 72 子）。 */
const EXTRA = "5-0";

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(`${error?.name || ""}:${error?.message || String(error)}`.slice(0, 200)));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });

// 导入 → 图片识谱
await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 180000 });
await page.waitForTimeout(600);

const stonesBefore = await page.locator("[data-verify-stone]").count();
const hasExtra = await page.locator(`[data-verify-stone="${EXTRA}"]`).count();
check("导入后核对屏出现那颗粒子（72 子）", stonesBefore === 72 && hasExtra === 1, `棋子 ${stonesBefore}，[${EXTRA}] 存在 ${hasExtra} 次`);

// 进编辑 → 去子 → 点掉它
await page.locator(".image-verify-modes button", { hasText: "编辑" }).click();
await page.locator(".image-verify-tools button", { hasText: "去子" }).click();
const box = await page.locator(`[data-verify-stone="${EXTRA}"]`).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(400);
const stonesAfterEdit = await page.locator("[data-verify-stone]").count();
const stillThere = await page.locator(`[data-verify-stone="${EXTRA}"]`).count();
check("手工删掉后棋盘变成 71 子", stonesAfterEdit === 71 && stillThere === 0, `棋子 ${stonesAfterEdit}，[${EXTRA}] 存在 ${stillThere} 次`);
await page.locator(".image-verify-exit").click();

// 复原手序
await page.locator("[data-local-restore]").click();
await page.waitForFunction(
  () => /本地已按图上序号复原|无法复原手序|序号不完整|没读出序号/.test(document.querySelector(".image-verify-hint")?.textContent || ""),
  null, { timeout: 300000 },
).catch(() => {});
const after = await page.evaluate(() => ({
  hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
  stones: document.querySelectorAll("[data-verify-stone]").length,
  numbered: document.querySelectorAll("[data-verify-number]").length,
  extra: document.querySelectorAll('[data-verify-stone="5-0"]').length,
}));
console.log(`提示：${after.hint.slice(0, 130)}`);
check("复原完成：第 1 手到第 71 手", /复原第 1 手到第 71 手/.test(after.hint), after.hint.slice(0, 90));
check("**删掉的那颗没被找回来**（仍 71 子）", after.stones === 71 && after.extra === 0, `棋子 ${after.stones}，[${EXTRA}] 存在 ${after.extra} 次`);
check("71 颗子全带手序号", after.numbered === 71, `numbers=${after.numbered}`);
check("无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failed > 0) { console.error(`fail：${failed} 条断言未通过`); process.exit(1); }
console.log("全部断言通过");
