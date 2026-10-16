/**
 * 门禁：「自定义背景」的界面主题（用户 2026-10-12「自定义那里可以加入一个选择适配主题 ui
 * 的选项（不过要记得，解锁了的主题才能用）」）。
 *
 * 这条改动最容易"看着对了、实际没生效"的地方有三个，逐条量：
 *  ① `data-theme` 必须变成所选**界面主题**（不是 `custom`）—— 否则令牌/顶栏/面板全没换；
 *  ② `data-custom-bg` 必须在 —— 否则主题自带的盘面底图与场景装饰会把自定义背景盖掉；
 *  ③ 场景层 `.theme-scene` 必须 `display:none`、`.app-shell` 的 `background-image` 必须是
 *     自定义（图）或 `none`（只有色）—— 这是"背景归自定义"的实际判据。
 *
 * 外加一条**解锁口径**：未解锁的主题在「界面主题」清单里必须带锁徽章（只是列出来给买，
 * 不是能用）。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5173/?qa=1 node qa/custom-ui-theme-check.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;

const checks = [];
const check = (label, ok, detail = "") => {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  // ⚠ 只在"还没有"时写：本脚本要在同一 context 里 reload 并改 custom-ui-theme，
  //    无条件写会把上一步改的值冲掉（addInitScript 每次导航都会跑）。
  const seed = (key, value) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); };
  // 跳过首运行欢迎弹窗
  seed("banbu-first-run-welcome-v1", "true");
  // 背景颜色 = 一个显眼的青绿；界面主题 = cyber（深色，且自带走马灯场景最挑剔）
  seed("banbu-theme-preference-v1", "custom");
  seed("banbu-custom-ui-theme-v1", "cyber");
  seed("banbu-custom-background-color-v1", "#123456");
  // 只解锁 cyber，其余主题保持锁着 —— 用来验"未解锁的只是列出来、不能用"
  seed("banbu-soul-unlocks-v1", JSON.stringify(["theme-cyber"]));
  // 「买并换上」那一步要真扣钱：给足本金（主题单价 500/700，见 SOUL_PRICE_RULES）
  seed("banbu-soul-ledger-v1", JSON.stringify([
    { id: "qa-seed", at: Date.now(), amount: 5000, reason: "achievement", detail: "门禁本金" }]));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForSelector(".app-shell", { timeout: 120000 });
await page.waitForTimeout(1500);

// ── ① data-theme / data-custom-bg ───────────────────────────────
const dom = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  customBg: document.documentElement.hasAttribute("data-custom-bg"),
  scene: getComputedStyle(document.querySelector(".theme-scene")).display,
  shellBgImage: getComputedStyle(document.querySelector(".app-shell")).backgroundImage,
  shellBgColor: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
  colorScheme: document.documentElement.style.colorScheme,
}));
check("自定义背景 + 界面主题=cyber ⇒ data-theme 是 cyber", dom.theme === "cyber", `data-theme=${dom.theme}`);
check("挂了 data-custom-bg 标记", dom.customBg);
check("主题场景层已让位（display:none）", dom.scene === "none", `display=${dom.scene}`);
check("盘面底图不来自主题（none，自定义色没被主题图盖掉）", dom.shellBgImage === "none", `background-image=${dom.shellBgImage}`);
check("盘面底色是自定义色", dom.shellBgColor === "rgb(18, 52, 86)", dom.shellBgColor);
check("深色界面主题 ⇒ 原生控件用 dark", dom.colorScheme === "dark", `color-scheme=${dom.colorScheme}`);

// ── ② 换界面主题：data-theme 跟着变、data-custom-bg 保留 ─────────
await page.evaluate(() => localStorage.setItem("banbu-custom-ui-theme-v1", "light"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 120000 });
await page.waitForTimeout(1200);
const afterLight = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  customBg: document.documentElement.hasAttribute("data-custom-bg"),
  scene: getComputedStyle(document.querySelector(".theme-scene")).display,
  backgroundImage: getComputedStyle(document.querySelector(".app-shell")).backgroundImage,
  colorScheme: document.documentElement.style.colorScheme,
}));
check("界面主题换成 light ⇒ data-theme=light", afterLight.theme === "light", `data-theme=${afterLight.theme}`);
check("换界面主题后 data-custom-bg 仍在", afterLight.customBg);
check("浅色界面主题 ⇒ 原生控件回 light", afterLight.colorScheme === "light", afterLight.colorScheme);
check("light 主题没有场景层（依然让位）", afterLight.scene === "none", afterLight.scene);

// ── ③ 自定义**图片**背景时：内联图必须压过"让位"规则 ────────────
// 1×1 透明 PNG。存在图片时 `customAppStyle` 会内联 `linear-gradient(遮罩) + url(...)`，
// 它必须盖过 `html[data-custom-bg] .app-shell{background-image:none}`（内联 > 样式表）。
await page.evaluate(() => localStorage.setItem(
  "banbu-custom-background-image-v1",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 120000 });
await page.waitForTimeout(1200);
const withImage = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).backgroundImage);
check("自定义图片背景时盘面底图是那张图（内联压过让位规则）", withImage.includes("url("), withImage.slice(0, 60));
await page.evaluate(() => localStorage.removeItem("banbu-custom-background-image-v1"));

// ── ④ 设置页里的「界面主题」**下拉框** + 解锁口径 ────────────────────
// 用户 2026-10-12 第二轮：「选 UI 时不必要全部都展示，搞一个框框，然后选就行了」
// ⇒ 这里从"第二份卡片网格"改成一个 select，所以量的改成：框里列全、未解锁的标出来、
//   选未解锁的**不动界面**、试看能预览、先不用能退回、买并换上才真的换。
await page.evaluate(() => localStorage.setItem("banbu-custom-ui-theme-v1", "cyber"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 120000 });
await page.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await page.waitForTimeout(900);
const group = page.locator("details.settings-group", { hasText: "外观与音效" }).first();
if (await group.getAttribute("open") === null) { await group.locator("summary").first().click(); await page.waitForTimeout(500); }
const sub = page.locator("details.appearance-center-subsection", { hasText: "主题" }).first();
if (await sub.getAttribute("open") === null) { await sub.locator("> summary").first().click(); await page.waitForTimeout(600); }
// 这一节只在「自定义背景」下出现 —— 上面 addInitScript 已把主题偏好 seed 成 custom，
// 这里不再点卡片（点错会把偏好切走，那一节就整块消失了）。

const selectBox = page.locator('select[aria-label="自定义背景的界面主题"]');
check("「界面主题」是一个下拉框（不再是铺开的卡片网格）", await selectBox.count() === 1, `select=${await selectBox.count()}`);
check("卡片网格已经撤掉（这一节里没有第二份选项网格）",
  (await page.locator('[role="radiogroup"][aria-label="自定义背景的界面主题"]').count()) === 0);
const opts = await page.evaluate(() => Array.from(
  document.querySelectorAll('select[aria-label="自定义背景的界面主题"] option'))
  .map((o) => ({ value: o.value, text: o.textContent.trim() })));
check("框里把所有主题都列出来（≥20 项）", opts.length >= 20, `${opts.length} 项`);
const locked = opts.filter((o) => o.text.includes("🔒"));
const unlocked = opts.filter((o) => !o.text.includes("🔒"));
check("锁着的项写成「🔒 名字 · N 棋魂」（与快捷中心那三个外观下拉同一格式）",
  locked.length >= 10 && locked.every((o) => /^🔒 .+ · \d+ 棋魂$/.test(o.text)), `locked=${locked.length}/${opts.length}，例：${locked[0]?.text}`);
check("已解锁的项不带锁标记", unlocked.some((o) => o.value === "cyber") && !unlocked.find((o) => o.value === "cyber").text.includes("🔒"),
  unlocked.find((o) => o.value === "cyber")?.text);
check("框的当前值就是正在用的那一套（cyber）", (await selectBox.inputValue()) === "cyber", await selectBox.inputValue());
check("框左边跟着当前主题的色块", await page.locator(".custom-ui-theme-pick .theme-swatch.cyber").count() === 1);

const target = locked[0];
await selectBox.selectOption(target.value);
await page.waitForTimeout(600);
const afterLockedPick = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  selectValue: document.querySelector('select[aria-label="自定义背景的界面主题"]')?.value ?? "",
  pending: document.querySelector("[data-custom-ui-pending]")?.getAttribute("data-custom-ui-pending") ?? "",
  buttons: Array.from(document.querySelectorAll(".custom-ui-theme-buy-actions button")).map((b) => b.textContent.trim()),
}));
check(`选未解锁的「${target.value}」**不动界面**（data-theme 仍是 cyber）`, afterLockedPick.theme === "cyber", `data-theme=${afterLockedPick.theme}`);
check("选未解锁的会长出一行问价条（试看 / 买并换上 / 先不用）",
  afterLockedPick.pending === target.value && afterLockedPick.buttons.length === 3, JSON.stringify(afterLockedPick));

await page.locator(".custom-ui-theme-buy-actions button", { hasText: "试看" }).click();
await page.waitForTimeout(700);
const previewed = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
check("「试看」能预览（data-theme 临时变成那一套）", previewed === target.value, `data-theme=${previewed}`);
await page.locator(".custom-ui-theme-buy-actions button", { hasText: "先不用" }).click();
await page.waitForTimeout(700);
const reverted = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
check("「先不用」退回自己那套（预览不落盘）", reverted === "cyber", `data-theme=${reverted}`);

await selectBox.selectOption(target.value);
await page.waitForTimeout(400);
const balanceBefore = await page.evaluate(() => (JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]")).length);
await page.locator('[data-custom-ui-buy]').click();
await page.waitForTimeout(900);
const bought = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  unlocks: JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]"),
  pendingRow: Boolean(document.querySelector("[data-custom-ui-pending]")),
}));
check(`「买并换上」：扣魂解锁并把界面换成那一套`, bought.theme === target.value && bought.unlocks.includes(`theme-${target.value}`) && !bought.pendingRow,
  `data-theme=${bought.theme}、解锁数 ${balanceBefore}→${bought.unlocks.length}`);
check("买过之后这一项不再带锁标记", await page.evaluate((v) => {
  const o = Array.from(document.querySelectorAll('select[aria-label="自定义背景的界面主题"] option')).find((x) => x.value === v);
  return Boolean(o) && !o.textContent.includes("🔒");
}, target.value));

check("零 pageerror", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = checks.filter((item) => !item.ok);
console.log(`\n[custom-ui-theme] ${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) { console.error(`失败：${failed.map((item) => item.label).join("；")}`); process.exit(1); }
