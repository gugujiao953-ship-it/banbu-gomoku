import { chromium } from "playwright";

// Regression gate for T32 新手引导 (AppTour spotlight).
// Fresh profile → first-run welcome shows tour entry → full walkthrough:
// structure, hole masking, dots/back/keyboard, tab-following (library step),
// completion persistence, settings replay entry. Also writes a step-1
// screenshot for visual self-check.
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-tour-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const shotPath = process.env.TOUR_SHOT || (process.env.TEMP || ".") + "\\banbu-tour-step1.png";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(url, { waitUntil: "domcontentloaded" }); // 不加 ?qa=1——本门禁需要 first-run 弹窗
await page.waitForTimeout(2600);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const badge = () => page.evaluate(() => document.querySelector(".app-tour-badge")?.textContent?.trim() || "");
const cardVisible = () => page.evaluate(() => { const el = document.querySelector(".app-tour-card"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 40 && el.style.visibility !== "hidden"; });
const holeCount = () => page.evaluate(() => document.querySelectorAll("mask rect").length - 1); // mask 首项=全幅白底
const clickNext = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll(".app-tour-btns .primary-button")].find((x) => x.textContent.includes("下一步") || x.textContent.includes("开始使用")); b?.click(); }); await page.waitForTimeout(700); };
const dismiss = () => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("先自己试试")); b?.click(); });

// S1 welcome 三入口，引导按钮在最前
const welcome = await page.evaluate(() => ({
  open: Boolean(document.querySelector(".first-run-dialog")),
  buttons: [...document.querySelectorAll(".first-run-actions button")].map((b) => (b.textContent || "").trim()),
}));
check("S1a 初始弹窗出现", welcome.open, JSON.stringify(welcome.buttons));
check("S1b 首按钮=新手引导", /新手引导/.test(welcome.buttons[0] || ""), welcome.buttons[0] || "");
await page.evaluate(() => { const b = [...document.querySelectorAll(".first-run-actions button")].find((x) => x.textContent.includes("新手引导")); b?.click(); });
await page.waitForTimeout(900);

// S2 spotlight 结构
check("S2a 引导卡片锚定可见", await cardVisible());
check("S2b 第 1 步棋盘有光孔", (await holeCount()) >= 1, `holes=${await holeCount()}`);
check("S2c 步数徽章 1/10", (await badge()).includes("1/10"), await badge());
await page.screenshot({ path: shotPath }).catch(() => {});
console.log("screenshot:", shotPath);

// S3 键盘 ←/→ 与前进
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(600);
check("S3a 键盘右=下一步", (await badge()).includes("2/10"), await badge());
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(500);
check("S3b 键盘左=上一步", (await badge()).includes("1/10"), await badge());

// S4 圆点跳转：第 6 步=快捷中心与功能区布局（自动打开快捷中心）
await page.evaluate(() => document.querySelectorAll(".app-tour-dots button")[5]?.click());
await page.waitForTimeout(1200);
const quickState = await page.evaluate(() => ({
  badge: document.querySelector(".app-tour-badge")?.textContent?.trim() || "",
  drawerOpen: Boolean(document.querySelector(".quick-drawer-panel")),
  layoutEntryHole: [...document.querySelectorAll(".app-tour-tips li")][0]?.classList.contains("lit") || false,
}));
check("S4a 跳到第 6 步（快捷中心）", quickState.badge.includes("6/10"), quickState.badge);
check("S4b 快捷中心自动打开", quickState.drawerOpen, JSON.stringify(quickState));
check("S4c 功能区布局入口光孔点亮", quickState.layoutEntryHole, `lit=${quickState.layoutEntryHole}`);

// S4d 圆点跳转 + 库步骤跟随切页（点第 8 步=棋谱库）
await page.evaluate(() => document.querySelectorAll(".app-tour-dots button")[7]?.click());
await page.waitForTimeout(1400);
const libState = await page.evaluate(() => ({
  badge: document.querySelector(".app-tour-badge")?.textContent?.trim() || "",
  activeTab: document.querySelector("nav.bottom-nav button.active")?.textContent?.trim() || "",
  litTips: document.querySelectorAll(".app-tour-tips li.lit").length,
  drawerClosed: !document.querySelector(".quick-drawer-panel"),
}));
check("S4d 跳到第 8 步（棋谱库）", libState.badge.includes("8/10"), libState.badge);
check("S4e 自动切到棋谱库页", libState.activeTab.includes("棋谱库"), libState.activeTab);
check("S4f 离开快捷中心步后抽屉关闭", libState.drawerClosed, JSON.stringify(libState));
check("S4g 库页搜索框光孔点亮", libState.litTips >= 1, `lit=${libState.litTips}`);

// S5 走完剩余步 → 完成（9/10、10/10 各自断言，最后一步按钮=完成语义）
await clickNext();
check("S5a 进入第 9 步", (await badge()).includes("9/10"), await badge());
await clickNext();
const done = await page.evaluate(() => ({
  lastBadge: document.querySelector(".app-tour-badge")?.textContent?.trim() || "",
  hasFinishBtn: [...document.querySelectorAll(".app-tour-btns .primary-button")].some((b) => b.textContent.includes("开始使用")),
}));
check("S5b 到达最后一步（完成按钮）", done.lastBadge.includes("10/10") && done.hasFinishBtn, JSON.stringify(done));
if (done.hasFinishBtn) { await clickNext(); }
await page.waitForTimeout(700);
const afterFinish = await page.evaluate(() => ({
  card: Boolean(document.querySelector(".app-tour-card")),
  tourKey: localStorage.getItem("banbu-onboarding-tour-v1"),
  welcomeKey: localStorage.getItem("banbu-first-run-welcome-v1"),
}));
check("S5c 完成落盘 seen", afterFinish.tourKey === "seen" && afterFinish.welcomeKey === "true" && !afterFinish.card, JSON.stringify(afterFinish));

// S6 reload 不再自动弹（两键都已读），设置页可重播
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
check("S6a 重进不再弹初始窗", !(await page.evaluate(() => Boolean(document.querySelector(".first-run-dialog") || document.querySelector(".app-tour-card")))));
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
await page.waitForTimeout(900);
const replay = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".settings-link")].find((b) => (b.textContent || "").includes("新手引导"));
  row?.click();
  return Boolean(row);
});
await page.waitForTimeout(900);
check("S6b 设置页重播入口可用", replay && (await cardVisible()) && (await badge()).includes("1/10"), `row=${replay} badge=${await badge()}`);

// S7 Esc 退出（记 seen 不算完成，也允许）
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check("S7 Esc 可退出引导", !(await page.evaluate(() => Boolean(document.querySelector(".app-tour-card")))));
check("S8 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
