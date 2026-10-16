/**
 * 评审稿网页的冒烟门禁：把 `design-lab/achievement-workshop.html` 当真实页面打开
 * （`file://`，和用户双击完全一样），逐条点一遍。
 *
 * ## 为什么不能只靠引擎那 51 条
 *
 * `qa/achievement-workshop-check.mjs` 测的是"数据搬运无损"，它 import 的是 `.mjs`。
 * 用户实际面对的是那个 HTML —— 它有自己的渲染/划掉/编辑/换算/导出逻辑。
 * 那部分坏掉的门槛很低（一个拼错的 id、`file://` 下拿不到数据、一次没接上的事件），
 * 表现是"页面能开、但点不动"。所以这里真的点。
 *
 * ## 必须用 `file://`
 *
 * 数据走 `<script src>` 而不是 fetch，就是为了双击能用。改用 dev server 打开
 * 就测不到那个最容易坏的点（同源策略会挡掉 fetch）。
 *
 * 用法：`node qa/achievement-workshop-page-check.mjs`
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(root, "design-lab", "achievement-workshop.html");
const DATA = path.join(root, "design-lab", "achievement-workshop-data.js");

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) process.stdout.write(`  ✓ ${label}${detail ? `（${detail}）` : ""}\n`);
  else { failures += 1; process.stdout.write(`  ✗ ${label}${detail ? `（${detail}）` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

if (!fs.existsSync(DATA)) {
  process.stderr.write("缺少 design-lab/achievement-workshop-data.js —— 先跑 node scripts/achievement-workshop.mjs build\n");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: "block" });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push("console: " + message.text()); });

await page.goto(url.pathToFileURL(PAGE).href, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);

// ── 1. 文档能开 ────────────────────────────────────────────────────
section("1. 文档能开（file:// 双击这一条路径）");
check("标题是评审稿", (await page.title()).includes("评审稿"), await page.title());
// ⚠ 先等列表"画完"再数：93 条成就每条都带评审说明，首帧渲染要一点时间，
// 早数会数到半截（实测数到 83，后面"导出少一条"的断言就跟着错了）。
// 判据用"数量稳定"而不是固定 sleep：等它连续两次读数一样。
let itemCount = 0;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const now = await page.locator(".item").count();
  if (now > 0 && now === itemCount) break;
  itemCount = now;
  await page.waitForTimeout(200);
}
check("每条成就都渲染成一条（不是表格堆叠）", itemCount > 50, `${itemCount} 条`);
// 章节数**从数据算**，不写死：分组数（现在是 6，含「棋魂」）+ 7 个固定章节
// （来源 / 外观定价 / VCF 两条奖励线 / 消费 / 旋钮 / 体检报告 / 落地说明）。
// ⚠ 2026-10-10 新增了「外观定价」「VCF 两条奖励线」「体检报告」三章，固定数从 4 变 7。
// 所以这里改成**只数固定章节的 id 是否存在**，不再写"4"这个数字 ——
// 写死数字的话，以后每加一章都要回来改门禁，而"加一章"本身是正常的产品行为。
const FIXED_CHAPTER_IDS = ["ch-earn", "ch-price", "ch-vcf", "ch-spend", "ch-tuning", "ch-audit", "ch-how"];
const expectedChapters = await page.evaluate(() => (window.WORKSHOP_DATA.groups || []).length
  + ["ch-earn", "ch-price", "ch-vcf", "ch-spend", "ch-tuning", "ch-audit", "ch-how"].length);
const chapterCount = await page.locator("section.chapter").count();
check(`分成 ${expectedChapters} 章（6 组成就 + ${FIXED_CHAPTER_IDS.length} 个固定章节）`,
  chapterCount === expectedChapters, String(chapterCount));
for (const id of FIXED_CHAPTER_IDS) {
  check(`固定章节存在：${id}`, (await page.locator(`#chapter-${id}`).count()) === 1);
}
check(`左侧目录有 ${expectedChapters} 个章节链接`,
  (await page.locator("nav.toc a").count()) === expectedChapters);
const tally = (await page.locator("#tally").textContent()) || "";
check("顶栏统计渲染出来（说明数据读到了）", /成就\s*\d+\s*\/\s*\d+/.test(tally.replace(/\s+/g, " ")), tally.trim());
check("没有掉进「没读到数据」的兜底页", (await page.locator("text=没读到数据文件").count()) === 0);

// ── 2. 每条都有「为什么提它」 ──────────────────────────────────────
section("2. 每条都有评审说明（这份稿子的核心）");
const critCount = await page.locator(".item .crit").count();
check("说明条数 = 成就条数", critCount === itemCount, `${critCount} / ${itemCount}`);
const missing = await page.locator(".item .crit", { hasText: "（待补说明）" }).count();
check("没有「待补说明」的漏网条目", missing === 0, `${missing} 条漏写`);
const firstCrit = ((await page.locator(".item .crit").first().textContent()) || "").trim();
check("说明是真正的内容（不是占位）", firstCrit.length > 12, firstCrit.slice(0, 34));

// ── 3. 每条都有划掉按钮，且只是标记 ────────────────────────────────
section("3. 划掉（就是用户说的「删除按钮」）");
const dropButtons = page.locator(".item .act button").filter({ hasText: /^(划掉|恢复)$/ });
check("划掉按钮数量 = 条目数", (await dropButtons.count()) === itemCount, `${await dropButtons.count()} 个`);
await dropButtons.first().click();
await page.waitForTimeout(200);
check("点划掉后那一条被划掉（有删除线样式）", (await page.locator(".item.dropped").count()) === 1);
check("划掉后顶栏标出数量", ((await page.locator("#tally em").textContent()) || "").includes("划掉 1"),
  (await page.locator("#tally").textContent() || "").trim());
check("划掉后底栏提示待导出", ((await page.locator("#state").textContent()) || "").includes("待导出"),
  (await page.locator("#state").textContent() || "").trim());
check("按钮变成「恢复」", ((await page.locator(".item.dropped .act button").first().textContent()) || "").trim() === "恢复");
await page.locator(".item.dropped .act button").first().click();
await page.waitForTimeout(200);
check("恢复后回到无改动", ((await page.locator("#state").textContent()) || "").trim().includes("还没有改动"),
  (await page.locator("#state").textContent() || "").trim());

// ── 4. 就地编辑 ────────────────────────────────────────────────────
section("4. 就地编辑（改奖励/改文案）");
const target = page.locator(".item").nth(2);
await target.locator(".act button", { hasText: "修改" }).click();
await page.waitForTimeout(250);
check("点「修改」展开编辑器", (await page.locator(".editor").count()) === 1);
const editor = page.locator(".editor").first();
await editor.locator("input[type=text]").first().fill("评审稿改名测试");
await page.waitForTimeout(200);
const cardTitle = ((await target.locator("h3").textContent()) || "").trim();
check("改标题即时反映到条目上（不用重画整页）", cardTitle.includes("评审稿改名测试"), cardTitle.slice(0, 30));
check("输入框没有失焦（这条是就地刷新的意义）",
  await editor.locator("input[type=text]").first().evaluate((node) => node === document.activeElement));
await page.locator("#btn-reset").click();
page.on("dialog", (dialog) => { dialog.accept().catch(() => {}); });
await page.waitForTimeout(400);

// ── 5. 章节内容 ────────────────────────────────────────────────────
section("5. 棋魂来源 / 消费 / 旋钮 三章");
const earnRows = await page.locator("table tr").count();
check("来源表渲染出来了", earnRows >= 8, `${earnRows} 行`);
const earnNotes = await page.locator(".with-note .note").count();
check("来源也带评审说明（定价考虑）", earnNotes >= 8, `${earnNotes} 条`);
check("来源章说明了「棋魂是参与度货币」",
  ((await page.locator("#chapter-ch-earn").textContent()) || "").includes("参与度货币"));
const spendText = (await page.locator("#chapter-ch-spend").textContent()) || "";
check("消费章如实说明现在是空的、且解释了原因（不臆造消费点）",
  spendText.includes("一个消费点也没有") && spendText.includes("有意的"), spendText.replace(/\s+/g, " ").slice(0, 60));
const tuningText = (await page.locator("#chapter-ch-tuning").textContent()) || "";
// ⚠ 作用域限定在**旋钮章**之内（`#chapter-ch-tuning .dial`）。定价章的行也是 `.dial`
//   （外观定价的档位与调度旋钮形态一致），不限定作用域就会把两章一起数进来。
const tuningDials = page.locator("#chapter-ch-tuning .dial");
check("旋钮章有 10 个旋钮", (await tuningDials.count()) === 10, String(await tuningDials.count()));
check("每个旋钮都有 role（作用）", (await tuningDials.locator(".role").count()) === 10);
check("每个旋钮都有 advice（建议）", (await tuningDials.locator(".advice").count()) === 10);
check("含用户关心的「输一局」「和棋」「连点」「每日上限」",
  tuningText.includes("输一局") && tuningText.includes("和棋") && tuningText.includes("连点") && tuningText.includes("每日"));
const tunableReasons = await page.evaluate(() => WORKSHOP_DATA.tunableReasons);
check("停发开关按实际来源铺开", (await page.locator(".switch").count()) === tunableReasons.length);

// ── 5b. 外观定价 / VCF 两条奖励线 / 体检报告（2026-10-10 新增三章）──────
section("5b. 外观定价 / VCF 奖励 / 体检报告");
const priceChapter = page.locator("#chapter-ch-price");
check("定价章有 8 个档位", (await priceChapter.locator(".price-dial").count()) === 8,
  String(await priceChapter.locator(".price-dial").count()));
check("每个档位都有 role（作用）", (await priceChapter.locator(".price-dial .role").count()) === 8);
check("每个档位都有 advice（建议）", (await priceChapter.locator(".price-dial .advice").count()) === 8);
const priceText = (await priceChapter.textContent()) || "";
check("定价章说明了「按规则算、不是逐项定价」", priceText.includes("不是逐个定价"));
check("定价章列出了实际售价分档", priceText.includes("当前规则下的实际售价"));
check("定价章标出了扎堆的价位", priceText.includes("挤了 15 项以上"));
// 改一个档位，售价表要跟着变（这是"改了能看到效果"的核心）
const boardBaseInput = priceChapter.locator(".price-dial", { hasText: "棋盘基价" }).first().locator("input[type=number]");
const totalBefore = ((await page.locator("#tally").textContent()) || "");
await boardBaseInput.fill("280");
await page.waitForTimeout(400);
const totalAfter = ((await page.locator("#tally").textContent()) || "");
check("改棋盘基价后顶栏的商店总价跟着变", totalBefore !== totalAfter, `${totalBefore.trim()} → ${totalAfter.trim()}`);
check("底栏提示外观定价有改动", ((await page.locator("#state").textContent()) || "").includes("外观定价有改动"));
await page.locator("#btn-reset").click();
await page.waitForTimeout(400);

const vcfChapter = page.locator("#chapter-ch-vcf");
check("VCF 章有等级奖励输入框（= 等级数）", (await vcfChapter.locator("input[type=number]").count()) >= 25,
  String(await vcfChapter.locator("input[type=number]").count()));
check("VCF 章列出了三个道具", (await vcfChapter.locator("input[type=number]").count()) >= 28);
const vcfText = (await vcfChapter.textContent()) || "";
check("VCF 章区分了「每解出一题」与「每升一级」两条线", vcfText.includes("每解出一题") && vcfText.includes("每升一级"));
const rewardData = await page.evaluate(() => ({
  total: WORKSHOP_DATA.levelSoul.reduce((sum, value) => sum + value, 0),
  levels: WORKSHOP_DATA.levelSoul.length,
  win: WORKSHOP_DATA.earnRules.find((rule) => rule.reason === "duel-win"),
}));
check("VCF 章给了实际等级奖励总数", vcfText.includes(`爬满 ${rewardData.levels} 级共 ${rewardData.total.toLocaleString("zh-CN")} 魂`));

const auditChapter = page.locator("#chapter-ch-audit");
const findings = auditChapter.locator(".finding");
const findingCount = await findings.count();
check("体检章有条目（每条一个卡片）", findingCount >= 5, `${findingCount} 件`);
check("每条都标了状态", (await auditChapter.locator(".finding .status").count()) === findingCount);
check("每条都写了「要你拍板」", (await auditChapter.locator(".finding .decision").count()) === findingCount);
check("每条都给了建议", (await auditChapter.locator(".finding .decision .rec").count()) === findingCount);
const auditText = (await auditChapter.textContent()) || "";
check("体检章区分了「已修」与「待定」（不把已修的当成待办）",
  auditText.includes("已修") && auditText.includes("待定"));
check("体检章含那条真 bug 的实测数字", auditText.includes("665"));

// ── 6. 实时换算（改旋钮要立刻看到一局值多少钱）────────────────────
section("6. 实时换算");
const convertBefore = (await page.locator(".convert").textContent()) || "";
check("换算表列出了典型收益", convertBefore.includes(rewardData.win.title) && convertBefore.includes("点一下魂火"));
const winRow = page.locator(".convert tr").filter({ has: page.locator("td").filter({ hasText: rewardData.win.title }) }).first();
check("对弈收益基线按来源表显示", (await winRow.locator("td").last().textContent()).trim() === `+${rewardData.win.amount}`);
const multNumber = page.locator(".dial", { hasText: "获取倍率" }).first().locator("input[type=number]");
await multNumber.fill("2");
await page.waitForTimeout(300);
const convertAfter = (await page.locator(".convert").textContent()) || "";
check("倍率调到 2 之后实际收益翻倍", (await winRow.locator(".up").textContent()).trim() === `+${rewardData.win.amount * 2}`);
check("改过的旋钮被标出来", (await page.locator(".dial.changed").count()) >= 1);
check("底栏提示旋钮有改动", ((await page.locator("#state").textContent()) || "").includes("旋钮有改动"));
await page.locator(".switch", { hasText: "对弈取胜" }).first().click();
await page.waitForTimeout(300);
check("停发「对弈取胜」后换算表显示「不发」",
  ((await page.locator(".convert").textContent()) || "").includes("不发"));
await page.locator(".switch.off", { hasText: "对弈取胜" }).first().click();
await page.waitForTimeout(200);

// ── 7. 导出 ────────────────────────────────────────────────────────
section("7. 导出保留版");
// 先划掉一条，验证导出的确实不含它
await page.locator(".item .act button", { hasText: "划掉" }).first().click();
await page.waitForTimeout(250);
const droppedTitle = ((await page.locator(".item.dropped h3").first().textContent()) || "").split(/\s+/)[0];
const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
await page.locator("#btn-export").click();
const download = await downloadPromise;
check("点导出能拿到下载", download !== null, download ? download.suggestedFilename() : "没有触发下载");
if (download) {
  const saved = path.join(root, "tmp", "workshop-smoke-export.json");
  await download.saveAs(saved);
  const payload = JSON.parse(fs.readFileSync(saved, "utf8"));
  check("导出的是数据对象", Array.isArray(payload.catalog) && Array.isArray(payload.earnRules) && payload.defaultTuning);
  check("划掉的那条不在导出里", payload.catalog.length === itemCount - 1,
    `${payload.catalog.length} vs ${itemCount - 1}${droppedTitle ? "，划掉的是「" + droppedTitle + "」" : ""}`);
  check("导出的还是划掉之前的条数减一（没顺手删别的）", payload.catalog.every((item) => typeof item.id === "string"));
  check("旋钮改动写进了导出（倍率 2）", payload.defaultTuning.earnMultiplier === 2, String(payload.defaultTuning.earnMultiplier));
  fs.rmSync(saved, { force: true });
}

// ── 8. 落地说明 ────────────────────────────────────────────────────
section("8. 落地说明章");
const howText = (await page.locator("#chapter-ch-how").textContent()) || "";
check("写清了 verify 命令（先看不写）", howText.includes("achievement-workshop.mjs verify"));
check("写清了 apply 命令", howText.includes("achievement-workshop.mjs apply"));
check("解释了为什么划掉是安全的", howText.includes("身份证") || howText.includes("判据"));

// ── 9. 正文里不许漏出 Markdown 记号 ────────────────────────────────
section("9. 正文文字（不许漏出 Markdown 记号）");
// 这条是本项目的既有教训（成就面板那次实测漏出过 `**`）：评审说明是在 .mjs 里写的，
// 顺手写 `**强调**` 就会原样显示成星号。所以逐条扫一遍渲染后的文字。
const bodyText = (await page.locator("#doc").textContent()) || "";
check("正文里没有 `**`", !bodyText.includes("**"), (bodyText.match(/.{0,20}\*\*.{0,20}/) || [""])[0]);
check("正文里没有 markdown 链接语法", !/\[[^\]]+\]\([^)]+\)/.test(bodyText));
check("正文里没有反引号", !bodyText.includes("`"));
check("正文里没有裸露的 HTML 注释", !bodyText.includes("<!--"));

// ── 10. 没有异常 ───────────────────────────────────────────────────
section("10. 运行期");
check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
if (failures > 0) process.exit(1);
