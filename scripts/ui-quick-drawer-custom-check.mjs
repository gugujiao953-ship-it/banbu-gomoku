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

// 条目总数与分区数不再手抄：由 scripts/ui-quick-drawer-count.mjs 直接从
// src/quick-drawer-customization.ts 的池子与分区表读出后经环境变量传入。
// 2026-09-23：以前这里写死 39，池子改了两边不同步——门禁会因为「数量对不上」
// 这种与意图无关的原因红灯，或者反过来静默放过。现在只有一个真源。
// 2026-09-26 更新到 55：期间池子一路加条目（在线棋谱/分析小数位等）涨到 56，
// 同一天删掉「画中画」整功能后又回到 55。这个数**谁动池子谁改**，别让它再漂。
const EXPECTED_ITEM_COUNT = Number(process.env.BANBU_EXPECTED_DRAWER_ITEMS || 55);
const EXPECTED_GROUP_COUNT = Number(process.env.BANBU_EXPECTED_DRAWER_GROUPS || 8);

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
  items: [...document.querySelectorAll(".quick-drawer-sortable .quick-drawer-toggle b")].map((b) => (b.textContent || "").trim()),
  hasAllShow: [...document.querySelectorAll(".quick-drawer-customize-actions button")].some((b) => (b.textContent || "").includes("全部显示")),
  hasSectionToggle: [...document.querySelectorAll(".quick-drawer-customize-group-head .quick-drawer-customize-section-toggle")].length,
}));
// 条目总数是硬编码的：新增条目必须同步这里（否则漏登记会静默通过）。
// 39 = 38 + board.stoneSize（棋子大小，2026-09-15）。用户 09-16 把深度选项从设置/快捷中心撤掉（深度改成统计行里的只读区间），计数回到 39。
// 改条目池时这里必须同步，否则门禁会因为「数量对不上」这种与意图无关的原因红灯。
check("S1 选择面板列出全部条目（含新增棋盘/无障碍/数据/手册目录）", picker.items.length === EXPECTED_ITEM_COUNT && picker.groups.length === EXPECTED_GROUP_COUNT && picker.hasAllShow && picker.hasSectionToggle === EXPECTED_GROUP_COUNT, `items=${picker.items.length}/${EXPECTED_ITEM_COUNT} groups=${picker.groups.join("/")} sectionToggles=${picker.hasSectionToggle}`);

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
// 条目标签必须在**自定义模式还开着**的时候读：下一次点 .quick-drawer-customize 是
// 「完成」，一完成 .quick-drawer-sortable 整块就卸载了，那之后再查只会拿到 0 条
// （S4b/S5a 就是专门盯住这个时机问题的）。
const panelLabels = await page.evaluate(() => [...document.querySelectorAll(".quick-drawer-sortable .quick-drawer-toggle b")].map((b) => (b.textContent || "").trim()));
check("S4b 自定义面板里读到了全部条目标签", panelLabels.length === EXPECTED_ITEM_COUNT, `读到 ${panelLabels.length} / 期望 ${EXPECTED_ITEM_COUNT}`);
await page.evaluate(() => { document.querySelector(".quick-drawer-customize")?.click(); });
await page.waitForTimeout(400);
await ensureSection("自动演示");
const afterRestore = await drawerText();
check("S4 「全部显示」恢复该项", afterRestore.includes("循环当前变化"));
await closeDrawer();

// ── S5 硬约束：快捷中心每一项在设置页都有 ────────────────
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
await page.waitForTimeout(1500);
// 2026-09-23 根治：这张清单以前是手抄的镜像表（与 quick-drawer-customization.ts 的
// settingsLabel 双份维护），池子加了条目而这里没加时，S5 会**静默通过**——覆盖缺口
// 就是这么漏出来的。现在改为从「自定义面板真实渲染出的条目」取，只保留一个真源：
// 自定义面板本来就渲染 item.label，取 label 回设置页正文里找同名的可见文字即可。
// 下面这张表只登记「快捷标签 ≠ 设置页可见文字」的例外，必须逐条写清为什么。
const SETTINGS_LABEL_OVERRIDES = {
  // 快捷中心叫「自动演示」，设置页的分区标题也是「自动演示」，正文里没有同名行
  "播放速度": ["播放速度"],
  "分支处理": ["分支处理"],
  // 设置页的分析模式是下拉，正文出现的是选项文字
  "分析模式": ["持续", "自对弈"],
  // 设置页该行标题随状态在「持续」「自对弈」之间切换
  "自对弈每步时限": ["自对弈每步时限"],
  // 设置页分区名是「外观与音效」，行标题为「主题」
  "应用主题": ["主题"],
  // 分区标题是「声音与音效」
  "声音与音效": ["声音与音效"],
  // 结果横幅与反馈条目在设置页写作「反馈问题或建议」
  "关于与更新": ["关于半步五子棋打谱"],
  "界面字号": ["界面字号", "大字", "特大字"],
  // 引擎这一组的标签已与设置页对齐（2026-09-23）：内存滑杆、内嵌的「多线程」小开关、
  // 「线程数」下拉都能直接按标签命中，不再需要例外。留此注释是为了提醒：以后若又
  // 把设置页的控件改名，这里要么同步标签、要么登记例外，别让 S5 悄悄失配。
};
// 面板里读到的全部条目标签（真源）
// panelLabels 在 S4 之后（抽屉仍开着时）读取，见上。
const itemSettingsLabels = panelLabels.map((label) => SETTINGS_LABEL_OVERRIDES[label] ?? [label]);

// 自检：条目数必须与面板一致，防止取标签的 DOM 选择器失效后静默退化成空数组
check("S5a 从自定义面板读到了全部条目标签", itemSettingsLabels.length === panelLabels.length && panelLabels.length > 0, `读到的条目标签=${panelLabels.length}`);

// 「自对弈每步时限」只在分析模式=自对弈时渲染：先核对其余项，再切模式补核。
const CONDITIONAL = ["自对弈每步时限"];
const settingsText = await page.evaluate(() => document.body.textContent || "");
const missing = itemSettingsLabels
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
check("S5 条目池逐项在设置页存在（快捷有的设置必须有）", missing.length === 0 && missingConditional.length === 0, missing.length || missingConditional.length ? `缺失=${[...missing, ...missingConditional].join("、")}` : `已核对 ${itemSettingsLabels.length} 项`);
check("S6 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
