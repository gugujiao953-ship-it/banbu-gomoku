/**
 * 找出「能被精确识别」的局面：试若干手数，比对 源子数 vs 识别子数，
 * 找到完全一致的一组就把它拍成 21-board-source / 21b / 21c。
 */
import { launch, boot, settle, safeClick, resolveDraftModal, dismissToast, clickPoint, STILLS } from "./lib.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const { browser, context, page } = await launch();
const ALL = ["H8","I8","H9","I9","G8","J8","G9","J9","F8","K8","F9","E9","G10","F10","H7","I7"];

const stones = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);

async function openImport() {
  for (let i = 0; i < 5; i++) {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "导入" }));
    await settle(page, 900);
    await resolveDraftModal(page, "discard");
    await settle(page, 450);
    const labels = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map(d => d.getAttribute("aria-label")).join(","));
    if (labels.includes("选择导入方式")) return;
  }
  throw new Error("导入对话框打不开");
}

async function recognize(imgPath) {
  await openImport();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    page.getByRole("button", { name: /图片识谱/ }).first().click({ timeout: 10000 }),
  ]);
  await chooser.setFiles(imgPath);
  const rec = page.locator("button.board-fs-action").filter({ hasText: "识别" }).first();
  await rec.waitFor({ timeout: 25000 });
  await settle(page, 1200);
  await rec.click({ timeout: 8000 });
  for (let i = 0; i < 16; i++) { await settle(page, 1200); if ((await stones()) > 0) break; }
  await settle(page, 900);
  return stones();
}

async function freshBoard() {
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
  await settle(page, 600);
  await page.getByRole("button", { name: "新建空白棋局" }).first().click({ timeout: 6000 }).catch(() => {});
  await settle(page, 600);
  await resolveDraftModal(page, "discard");
  await settle(page, 500);
  await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
  await settle(page, 400);
}

try {
  await boot(page);
  await mkdir(path.join(STILLS, "..", "seq", "_imgtest"), { recursive: true });
  const tmp = path.join(STILLS, "..", "seq", "_imgtest", "probe.png");
  const results = [];

  for (const n of [4, 6, 8, 10, 12, 16]) {
    await freshBoard();
    for (const m of ALL.slice(0, n)) { await clickPoint(page, m); await settle(page, 95); }
    await settle(page, 700);
    const src = await stones();
    const png = await page.locator(".renju-board").screenshot({ type: "png" });
    await writeFile(tmp, png);
    let got = 0;
    try { got = await recognize(tmp); } catch (e) { console.log(`  n=${n} 识别异常 ${e.message.split("\n")[0]}`); }
    console.log(`  ${n} 手：源 ${src} → 识别 ${got}  ${src === got ? "★一致" : "差 " + (got - src)}`);
    results.push({ n, src, got, match: src === got });
  }

  console.log("=== 汇总 ===");
  // 取「能精确识别」里子数最多的那个 —— 画面最丰富
  const best = results.filter(r => r.match).sort((a, b) => b.n - a.n)[0];
  console.log(JSON.stringify(results));
  if (best) {
    // 用这个手数重建源图与结果图
    await freshBoard();
    for (const m of ALL.slice(0, best.n)) { await clickPoint(page, m); await settle(page, 95); }
    await settle(page, 800);
    const png = await page.locator(".renju-board").screenshot({ type: "png" });
    await writeFile(path.join(STILLS, "21-board-source.png"), png);

    // 走一次完整识谱，途中把「对齐界面」也拍下来
    await openImport();
    await page.screenshot({ path: path.join(STILLS, "21a-image-import-entry.png") });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByRole("button", { name: /图片识谱/ }).first().click({ timeout: 10000 }),
    ]);
    await chooser.setFiles(path.join(STILLS, "21-board-source.png"));
    const rec = page.locator("button.board-fs-action").filter({ hasText: "识别" }).first();
    await rec.waitFor({ timeout: 25000 });
    await settle(page, 1600);
    await page.screenshot({ path: path.join(STILLS, "21b-image-recognizing.png") });
    await rec.click({ timeout: 8000 });
    let got = 0;
    for (let i = 0; i < 16; i++) { await settle(page, 1200); got = await stones(); if (got > 0) break; }
    await settle(page, 1200);
    await dismissToast(page);
    await page.screenshot({ path: path.join(STILLS, "21c-image-recognized.png") });
    console.log(`★ 采用 ${best.n} 手局面：源 ${best.src} → 识别 ${got}  ${best.src === got ? "完全一致 ✓" : "仍有偏差"}`);
  } else {
    console.log("★ 没有找到完全一致的，需要换思路");
  }
} catch (e) { console.log("ERR", e.message.split("\n")[0]); }
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
