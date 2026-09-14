import { chromium } from "playwright";

// 常驻门禁：快捷中心自定义（2026-09-10 用户需求）
//  S1 右上角「自定义快捷方式」按钮存在，点开列出全部条目
//  S2 取消勾选「循环当前变化」→ 抽屉里不再出现（默认视图）
//  S3 刷新后仍保持隐藏（本机持久化）
//  S4 「全部显示」恢复
//  S5 硬约束：条目池里每一项在设置页都有同一条目（快捷中心有的，设置里必须有）
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-quick-drawer-custom-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

// 与 src/quick-drawer-customization.ts 的 QUICK_DRAWER_ITEMS.settingsLabel 保持同步。
const ITEM_SETTINGS_LABELS = [
  ["功能区布局"],
  ["播放速度"], ["分支处理"], ["循环当前变化"],
  ["分析引擎"], ["思考显示位置"], ["持续", "自对弈"], ["棋盘显示实时选点"],
  ["候选点显示内容"], ["候选点数量"], ["分析模式"], ["自对弈每步时限"],
  ["主题"], ["棋盘"], ["棋子"], ["默认棋盘大小"],
  ["显示手数"], ["显示坐标"], ["禁手辅助"], ["最后一手标记"],
  ["棋子序号大小"], ["棋盘画线粗细"], ["坐标字体大小"],
  ["界面字号", "大字", "特大字"],
  ["退出后恢复上次局面"], ["导入棋谱"], ["导出棋谱"], ["一键备份"], ["恢复备份"], ["格式兼容说明"],
  ["新手引导"], ["使用手册"], ["反馈问题或建议"], ["关于半步五子棋打谱"],
];

const context = await browser.newContext({ viewport: { width: 392, height: 852 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

const openDrawer = async () => {
  await page.getByRole("button", { name: /打开快捷中心/ }).click();
  await page.locator(".quick-drawer-panel").waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
};
const closeDrawer = async () => { await page.evaluate(() => { document.querySelector(".quick-drawer-scrim")?.click(); }); await page.waitForTimeout(400); };
const drawerText = () => page.evaluate(() => document.querySelector(".quick-drawer-panel")?.textContent || "");
// 幂等展开：只在 aria-expanded=false 时点击，避免二次点击反而折叠
const ensureSection = async (label) => { await page.evaluate((name) => { const b = [...document.querySelectorAll(".quick-drawer-section-toggle")].find((e) => (e.textContent || "").includes(name)); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); }, label); await page.waitForTimeout(400); };
const toggleCustomItem = async (label) => { const ok = await page.evaluate((name) => { const label = [...document.querySelectorAll(".quick-drawer-customize-group .quick-drawer-toggle")].find((e) => (e.querySelector("b")?.textContent || "") === name); label?.querySelector("input")?.click(); return !!label; }, label); await page.waitForTimeout(350); return ok; };

// ── S1 自定义按钮 + 条目清单 ─────────────────────────────
await openDrawer();
const hasCustomizeButton = await page.evaluate(() => !!document.querySelector(".quick-drawer-customize"));
check("S1 抽屉右上角有「自定义快捷方式」按钮", hasCustomizeButton);
await page.evaluate(() => { document.querySelector(".quick-drawer-customize")?.click(); });
await page.waitForTimeout(500);
const picker = await page.evaluate(() => ({
  groups: [...document.querySelectorAll(".quick-drawer-customize-group")].map((g) => (g.querySelector("h3")?.textContent || "").trim()),
  items: [...document.querySelectorAll(".quick-drawer-customize-group .quick-drawer-toggle b")].map((b) => (b.textContent || "").trim()),
  hasAllShow: [...document.querySelectorAll(".quick-drawer-customize-actions button")].some((b) => (b.textContent || "").includes("全部显示")),
  hasSectionToggle: [...document.querySelectorAll(".quick-drawer-customize-group-head .quick-drawer-customize-section-toggle")].length,
}));
check("S1 选择面板列出全部条目（含新增棋盘/无障碍/数据/手册目录）", picker.items.length === 35 && picker.groups.length === 8 && picker.hasAllShow && picker.hasSectionToggle === 8, `items=${picker.items.length} groups=${picker.groups.join("/")} sectionToggles=${picker.hasSectionToggle}`);

// ── S2 隐藏「循环当前变化」 ──────────────────────────────
const toggled = await toggleCustomItem("循环当前变化");
await page.evaluate(() => { document.querySelector(".quick-drawer-customize")?.click(); }); // 完成
await page.waitForTimeout(400);
await ensureSection("自动演示");
const afterHide = await drawerText();
check("S2 取消勾选后抽屉里不再出现该项", toggled && !afterHide.includes("循环当前变化") && afterHide.includes("播放速度"), `playbackRows=${afterHide.includes("播放速度")}/${afterHide.includes("循环当前变化")}`);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-quick-drawer-v1") || "{}"));
check("S2 隐藏写入本机存储", Array.isArray(stored.hidden) && stored.hidden.includes("playback.loop"), JSON.stringify(stored));
await closeDrawer();

// ── S3 刷新后仍隐藏 ─────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await openDrawer();
await ensureSection("自动演示");
const afterReload = await drawerText();
check("S3 刷新后仍保持隐藏（持久化）", !afterReload.includes("循环当前变化") && afterReload.includes("播放速度"));

// ── S4 全部显示恢复 ─────────────────────────────────────
await page.evaluate(() => { document.querySelector(".quick-drawer-customize")?.click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { [...document.querySelectorAll(".quick-drawer-customize-actions button")].find((b) => (b.textContent || "").includes("全部显示"))?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector(".quick-drawer-customize")?.click(); });
await page.waitForTimeout(400);
await ensureSection("自动演示");
const afterRestore = await drawerText();
check("S4 「全部显示」恢复该项", afterRestore.includes("循环当前变化"));
await closeDrawer();

// ── S5 硬约束：快捷中心每一项在设置页都有 ────────────────
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
await page.waitForTimeout(1500);
// 「自对弈每步时限」只在分析模式=自对弈时渲染：先核对其余项，再切模式补核。
const CONDITIONAL = ["自对弈每步时限"];
const settingsText = await page.evaluate(() => document.body.textContent || "");
const missing = ITEM_SETTINGS_LABELS
  .filter((labels) => !labels.some((label) => CONDITIONAL.includes(label)))
  .filter((labels) => !labels.some((label) => settingsText.includes(label)))
  .map((labels) => labels.join("/"));
await page.evaluate(() => {
  const select = [...document.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "分析模式");
  if (!select) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, "selfplay");
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(900);
const settingsTextSelfplay = await page.evaluate(() => document.body.textContent || "");
const missingConditional = CONDITIONAL.filter((label) => !settingsTextSelfplay.includes(label));
check("S5 条目池逐项在设置页存在（快捷有的设置必须有）", missing.length === 0 && missingConditional.length === 0, missing.length || missingConditional.length ? `缺失=${[...missing, ...missingConditional].join("、")}` : `已核对 ${ITEM_SETTINGS_LABELS.length} 项`);
check("S6 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
