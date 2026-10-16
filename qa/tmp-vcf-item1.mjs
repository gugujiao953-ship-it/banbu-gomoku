/** tmp item1: 入口与设置面板 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const SHOTS = "qa/tmp-vcf-shots";
mkdirSync(SHOTS, { recursive: true });
const results = [];
const errs = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() ?? null, sel);
const topInfo = () => txt(".vcfch-top-info");
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const gear = () => page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());
const rowBySpan = (label) => page.evaluate((l) => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes(l));
  return r ? { chips: Array.from(r.querySelectorAll("button")).map((b) => b.textContent.trim()), selected: r.querySelector("button.chip.selected")?.textContent?.trim() ?? null } : null;
}, label);
const clickRowChip = (label, chipText) => page.evaluate(([l, c]) => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes(l));
  const b = r ? Array.from(r.querySelectorAll("button")).find((x) => (x.textContent || "").includes(c)) : null;
  if (b) { b.click(); return true; } return false;
}, [label, chipText]);
const clickSheet = (t) => page.evaluate((x) => {
  const bar = document.querySelector(".vcfch-sheet-actions");
  const b = bar ? Array.from(bar.querySelectorAll("button")).find((y) => (y.textContent || "").trim() === x) : null;
  if (b) { b.click(); return true; } return false;
}, t);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
// 入口
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(700);
check("对弈首页有 VCF 入口", await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').count() === 1);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 25000 });
await page.waitForTimeout(1200);
check("进入 VCF 挑战页（有棋盘）", await page.locator(".vcfch-board").count() === 1);
check("主按钮为「开始挑战」", await primary() === "开始挑战", await primary() ?? "?");

// 齿轮面板
await gear();
await page.waitForTimeout(500);
check("齿轮打开设置面板", await txt(".vcfch-sheet > header b") === "VCF 挑战设置", await txt(".vcfch-sheet > header b") ?? "?");
const rows = { attacker: await rowBySpan("你执子"), tier: await rowBySpan("出题档"), pace: await rowBySpan("计时难度") };
check("「你执子」三枚 chip", rows.attacker && rows.attacker.chips.length === 3 && ["随机", "黑先", "白先"].every((c) => rows.attacker.chips.includes(c)), JSON.stringify(rows.attacker));
check("「计时难度」三枚 chip 且标注倍数", rows.pace && rows.pace.chips.length === 3 && rows.pace.chips.includes("默认 ×2") && rows.pace.chips.includes("充裕 ×1") && rows.pace.chips.includes("休闲 ×0.5"), JSON.stringify(rows.pace));
check("「出题档」四档（自动/短/中/深）", rows.tier && rows.tier.chips.length === 4 && rows.tier.chips[0] === "自动" && rows.tier.chips.some((c) => c.startsWith("短")) && rows.tier.chips.some((c) => c.startsWith("中")) && rows.tier.chips.some((c) => c.startsWith("深")), JSON.stringify(rows.tier));
const checks = await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-check")).map((c) => ({ text: c.textContent.replace(/\s+/g, " ").trim(), checked: c.querySelector("input")?.checked })));
check("有勾选框（生成器补题，默认勾上）", checks.some((c) => c.text.includes("生成器") && c.checked === true), JSON.stringify(checks));
await page.screenshot({ path: `${SHOTS}/item1-settings.png` });

// 「?」说明
check("头部有「?」按钮", await page.locator("[data-vcf-help]").count() === 1);
await page.locator("[data-vcf-help]").click();
await page.waitForTimeout(400);
check("点「?」打开说明面板", await page.locator("[data-vcf-help-panel]").count() === 1);
const helpText = await txt("[data-vcf-help-panel]");
const need = ["60s", "90s", "150s", "30s", "等级差", "生成器"];
check("说明含三档时限关键数字", need.every((k) => (helpText || "").includes(k)), need.filter((k) => !(helpText || "").includes(k)).join("、") || "全在");
// 全表逐段核对（默认 30/35/40/45/50/55/60 · 充裕 30/40/50/60/70/80/90 · 休闲 30/50/70/90/110/130/150）
const tables = await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-help-table p")).map((p) => p.textContent.replace(/\s+/g, " ").trim()));
const norm = (s) => s.replace(/\d+[–-]\d+\s*手/g, "").replace(/\d+\+\s*手/g, "").replace(/[（）()]/g, "").replace(/\s/g, "");
const wantTable = { default: "30s/35s/40s/45s/50s/55s/60s", ample: "30s/40s/50s/60s/70s/80s/90s", casual: "30s/50s/70s/90s/110s/130s/150s" };
check("说明三档时限全表逐字与 paceSecondsFor 一致",
  Object.values(wantTable).every((w) => tables.some((t) => norm(t).includes(w))),
  Object.values(wantTable).filter((w) => !tables.some((t) => norm(t).includes(w))).join("、") || "三档全对");
await page.screenshot({ path: `${SHOTS}/item1-help-top.png` });
// 滚到底
const helpScroll = await page.evaluate(() => {
  const h = document.querySelector(".vcfch-help");
  h.scrollTop = h.scrollHeight;
  const bar = document.querySelector(".vcfch-sheet-actions");
  const r = bar.getBoundingClientRect();
  const btns = Array.from(bar.querySelectorAll("button"));
  return { scroll: h.scrollHeight, client: h.clientHeight, top: h.scrollTop, barInView: r.top >= 0 && r.bottom <= window.innerHeight + 1, labels: btns.map((b) => b.textContent.trim()), enabled: btns.every((b) => !b.disabled) };
});
check("说明可滚到底", helpScroll.scroll > helpScroll.client && helpScroll.top > 0, `${helpScroll.scroll}/${helpScroll.client} @${Math.round(helpScroll.top)}`);
check("滚到底时底部「取消/确定」仍在视口内且可用", helpScroll.barInView && helpScroll.enabled, JSON.stringify({ inView: helpScroll.barInView, labels: helpScroll.labels }));
await page.screenshot({ path: `${SHOTS}/item1-help-bottom.png` });
// 关闭：再点「?」
await page.locator("[data-vcf-help]").click();
await page.waitForTimeout(350);
check("再点「?」关闭说明回到设置", await page.locator("[data-vcf-help-panel]").count() === 0 && await page.locator(".vcfch-sheet-tabs").count() === 1);

// 草稿语义：改「休闲」点取消不落地
const before = await topInfo();
await clickRowChip("计时难度", "休闲");
await page.waitForTimeout(150);
check("点「休闲」草稿选中态跟随", (await rowBySpan("计时难度")).selected === "休闲 ×0.5", (await rowBySpan("计时难度")).selected ?? "?");
await clickSheet("取消");
await page.waitForTimeout(400);
check("「取消」不落地草稿（顶部计时标签不变）", (await topInfo()) === before, `${before} → ${await topInfo()}`);

// 确定才生效 + 作废当前局
await gear(); await page.waitForTimeout(400);
await clickRowChip("计时难度", "休闲");
await clickSheet("确定");
await page.waitForTimeout(500);
check("「确定」落地计时难度（顶部标签变休闲）", (await topInfo() || "").includes("休闲"), await topInfo() ?? "?");
check("确定后提示已应用", (await txt(".vcfch-message") || "").includes("已应用"), await txt(".vcfch-message") ?? "?");

// 开始一局，再改设置 → 应作废当前局
await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary").click());
for (let i = 0; i < 60 && await primary() !== "认输（判负）"; i += 1) await page.waitForTimeout(500);
check("开始挑战进入对局", await primary() === "认输（判负）", await primary() ?? "?");
await gear(); await page.waitForTimeout(400);
await clickRowChip("计时难度", "充裕");
await clickSheet("确定");
await page.waitForTimeout(500);
check("改设置点确定 → 当前对局已作废（回到开始挑战）", await primary() === "开始挑战", await primary() ?? "?");
check("作废提示写明当前对局作废", (await txt(".vcfch-message") || "").includes("作废"), await txt(".vcfch-message") ?? "?");

// 重置等级分面板：四档 + 清空勾选
await gear(); await page.waitForTimeout(400);
check("头部有「重置等级分」小按钮", await page.locator("[data-vcf-reset]").count() === 1);
await page.locator("[data-vcf-reset]").click();
await page.waitForTimeout(300);
check("展开重置面板", await page.locator(".vcfch-sheet-reset").count() === 1);
const resetPanel = await page.evaluate(() => {
  const p = document.querySelector(".vcfch-sheet-reset");
  const chips = Array.from(p.querySelectorAll(".vcfch-picker-row button")).map((b) => b.textContent.trim());
  const chk = p.querySelector(".vcfch-sheet-check input");
  const ok = Array.from(p.querySelectorAll("button")).find((b) => b.textContent.includes("确认重置"));
  return { chips, clearChecked: chk?.checked, hasOk: !!ok, chipTitle: chips.length };
});
check("重置面板四档（最低/9手/13手/20手）", resetPanel.chips.length === 4 && resetPanel.chips.some((c) => c.includes("最低档")) && resetPanel.chips.some((c) => c.includes("9 手档")) && resetPanel.chips.some((c) => c.includes("13 手档")) && resetPanel.chips.some((c) => c.includes("20 手档")), JSON.stringify(resetPanel.chips));
check("清空勾选默认不勾（防误清）", resetPanel.clearChecked === false, String(resetPanel.clearChecked));
check("有确认重置按钮", resetPanel.hasOk);
// 勾上 → 按钮文案/行为；点确认重置到 13 手档 + 清空
await page.evaluate(() => { const c = document.querySelector(".vcfch-sheet-reset .vcfch-sheet-check input"); if (c && !c.checked) c.click(); });
await page.evaluate(() => { const chips = Array.from(document.querySelectorAll(".vcfch-sheet-reset .vcfch-picker-row button")); chips.find((x) => x.textContent.includes("13 手档"))?.click(); });
await page.waitForTimeout(150);
await page.evaluate(() => { const p = document.querySelector(".vcfch-sheet-reset"); Array.from(p.querySelectorAll("button")).find((b) => b.textContent.includes("确认重置"))?.click(); });
await page.waitForTimeout(500);
const ratingAfter = await page.evaluate(() => document.querySelector(".vcfch-rating-inline b")?.textContent);
check("确认重置到 13 手档 = 3400 分", ratingAfter === "3400", ratingAfter ?? "?");
check("勾选清空 → 提示进度已清空", (await txt(".vcfch-message") || "").includes("进度已清空"), await txt(".vcfch-message") ?? "?");
const lsRating = await page.evaluate(() => JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}").rating);
check("等级分已持久化", lsRating === 3400, String(lsRating));
await page.screenshot({ path: `${SHOTS}/item1-reset.png` });
await clickSheet("取消");
await page.waitForTimeout(300);

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`item1: ${results.length - bad.length}/${results.length} 通过`);
if (errs.length) console.log("页面报错:", errs.slice(0, 8));
if (bad.length) { console.log("未通过:"); for (const x of bad) console.log("   ✗ " + x.name + " — " + x.detail); }
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);
process.exit(bad.length ? 1 : 0);
