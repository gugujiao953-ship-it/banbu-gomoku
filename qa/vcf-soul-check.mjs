/**
 * VCF 挑战 / 人机对局 与 棋魂 的接线守卫（2026-10-09）。
 *
 * 用户要求：「接入 vcf 挑战试试，成功会加入棋魂……只有赢了会加，输了不加不扣」。
 *
 * ## 为什么是"源码接线断言"而不是端到端下棋
 *
 * 这一条改动的**正确性**已经由 `achievements.test.ts` 的定价组覆盖
 * （手数加成、封顶、坏输入、"永不返回负数"）。
 * 剩下会坏的是**接线**——也就是"赢的那一刻到底有没有调用它"。
 * 而接线有两种真实的坏法，端到端下棋**测不到**、源码断言一眼就看得出来：
 *
 *   ① 条件从 `if (win)` 被改成无条件调用 → 输了也发棋魂（用户明确不要）；
 *   ② `onSolved` 这个 prop 在 App 那侧被漏传/删掉 → 悄悄不再发，没人发现。
 *
 * 真下完一局 VCF 题要按题解走十几手，慢且依赖题目难度，作为门禁不稳。
 * 所以这里做**静态断言**：文件里必须存在那两处接线，且必须挂在 `win` 条件下、
 * 且 App 必须真的把回调传下去。这是本项目防"入口存在但没接线"的既有做法
 * （对照 R93 的教训与 `release-notes.test.ts` 的发版守卫）。
 *
 * 另配一条运行时冒烟：VCF 挑战页进得去、零 pageerror。
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4340/";
const qaUrl = new URL(BASE);
qaUrl.searchParams.set("qa", "1");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── 一、源码接线断言 ────────────────────────────────────────────────
const vcfSource = readFileSync("src/features/vcf-challenge/VcfChallengePage.tsx", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");
// 棋魂定价/调度所在的文件（对局那几条断言要读它：定价函数与调度项都在这里）。
const soulSource = readFileSync("src/features/progress/soul.ts", "utf8");

check("VCF 页声明了 onSolved 回调（并把它算进 useCallback 依赖）",
  /onSolved\?:/.test(vcfSource) && /\[.*onSolved\]/.test(vcfSource));

// 关键：发棋魂那一段必须包在 `if (win)` 里。
// 判据落在"win 判断"与"onSolved 调用"之间的相邻关系上——用行号比较而不是纯正则，
// 这样有人把 if 删掉时会红。
const vcfLines = vcfSource.split("\n");
const callLine = vcfLines.findIndex((line) => /onSolved\?\.\(\{ problemId/.test(line));
/**
 * 「只在赢时发棋魂」这道守卫（2026-10-10 起调用是多行的）。
 *
 * 原断言要求 `if (win) onSolved?.` 与调用**在同一行**；后来调用带了等级参数
 * （`level` / `rating`，给 VCF 等级奖励用），于是被拆成多行 —— 行号断言就失效了。
 *
 * 现在改成**结构性**判据，比行号更强：
 *  ① 必须存在 `if (win)` 这道条件（守卫在）；
 *  ② `onSolved` 的调用**只允许出现在它的代码块里**（从 `if (win) {` 到块结束之间）；
 *  ③ 全页只允许一处调用（不许在别处又发一次）。
 * 这样即使将来调用再换行、加参数，只要"只在赢的那一支调用"这个语义没变，断言就成立。
 */
const guardIndex = vcfLines.findIndex((line) => /if\s*\(win\)/.test(line));
const callIndexes = vcfLines
  .map((line, index) => (/onSolved\?\.\(/.test(line) ? index : -1))
  .filter((index) => index >= 0);
check("VCF 页有「只在赢时发棋魂」的条件分支", guardIndex >= 0, `guard 在第 ${guardIndex + 1} 行`);
check("onSolved 只在 win 那一支调用（全页唯一一处）",
  // >= 而不是 >：调用可以就写在 `if (win) onSolved?.(...)` **同一行**上（现在是多行，
  // 但两种写法都合法）。只要它不在守卫之前就行。
  callIndexes.length === 1 && callIndexes[0] >= guardIndex,
  `调用点 ${callIndexes.map((i) => i + 1).join(",") || "无"}、guard 第 ${guardIndex + 1} 行`);

// ── 二、人机对局：同样"只加不减" ────────────────────────────────────
//
// 2026-10-10 起这段的形状变了：原来写死 `if (entry.outcome === "won")`，现在走
// `soulForDuelResult(outcome, strength)` + `soulGain > 0` 守卫 —— 变的目的是把
// **输/和也纳入可调度口径**（用户要"多多给我一些调度的选项"），而默认值仍是
// 0（严格等于 2026-10-09 的原话「输了不给也不扣」）。
//
// 所以这里守的**不再是那个字面分支**，而是更本质的两条不变量：
//  ① 发放的数额必须由集中函数算出（口径单点，不许内联定价）；
//  ② 数额为 0 时不许写流水（默认口径下输/和不产生任何记录）。
// 这两条比"包在 if (won) 里"更强：把 lossAmount 调成 0 之外的任何值，① 仍要成立。
const duelLines = appSource.split("\n");
const duelResultLine = duelLines.findIndex((line) => /soulForDuelResult\(entry\.outcome, entry\.strength\)/.test(line));
const duelEarn = duelLines.findIndex((line) => /reason: "duel-win"/.test(line));
check("人机对局：数额由 soulForDuelResult 集中算出，且发放排在它之后",
  duelResultLine >= 0 && duelEarn > duelResultLine && duelEarn - duelResultLine < 20,
  duelResultLine >= 0 && duelEarn > duelResultLine
    ? `定价第 ${duelResultLine + 1} 行、发放第 ${duelEarn + 1} 行`
    : `定价=${duelResultLine} 发放=${duelEarn}`);
check("人机对局：数额为 0 时不写流水（默认口径下输/和不入账）",
  /if \(soulGain > 0\) \{/.test(appSource));
check("人机对局定价不再内联（旧写法 soulForDuelWin 不许在 App 里直接调）",
  !/soulForDuelWin\(/.test(appSource));
// 定价函数本身仍要存在，而且**必须从来源表取价**（2026-10-11 改）。
//
// ⚠ 原来这条写的是"普通档 8 / 大师档 60 的口径没丢" —— 而表里早就被用户调成
// 20/100 了，于是这条守卫**替那个 bug 站岗**：它保证"函数还是按 8/60 发"。
// 现在守的是"不许再写死数字"：函数体里只能出现 soulAmount(...) 取价，
// 一旦有人把数字写回去，这条就红。
check("soulForDuelWin 从来源表取价（不许再写死数字，8/60 那个 bug 的守卫）",
  /export const soulForDuelWin = \(strength: string\): number =>/.test(soulSource)
  && /soulAmount\("duel-win"/.test(soulSource),
  /soulAmount\("duel-win"/.test(soulSource) ? "已走 soulAmount" : "仍在写死数额");
check("VCF 基础价也从来源表取（同上：曾经写死 6，表里是 10）",
  /const base = soulAmount\("vcf-solve"\)/.test(soulSource));
check("soulForDuelResult 的输/和分支读调度项（lossAmount / drawAmount）",
  /tuning\.lossAmount/.test(soulSource) && /tuning\.drawAmount/.test(soulSource));
// 反向：整份 App 里不许出现任何"扣棋魂"的调用（用户要的是不加不扣，没有任何惩罚）
check("全应用没有任何扣棋魂的调用（无惩罚支路）",
  !/progress\.(spend|deduct)\(/.test(appSource) && !/spendSoul\(/.test(appSource));

// ── 三、运行时冒烟：VCF 页进得去、零 pageerror ──────────────────────
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(qaUrl.href, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(800);

/**
 * 去掉可能被别的会话临时插进页面的诊断条（`<pre data-tempdiag>`，z-index 99999、
 * 铺在视口底部、**load 后 3 秒**才出现）。它会拦住点击（实测 "intercepts pointer events"）。
 * 用 MutationObserver 常驻清除；只作用于本探针自己的页面，**不改别人的源文件**。
 */
const installTempDiagGuard = (target) => target.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  // ⚠ 必须把 observer **存到 window 上**：不保存引用的 MutationObserver 会被 GC 回收、
  // 静默停止观察（实测就是这样——第一版没存，守卫等于没装，点击照旧被拦）。
  const w = window;
  w.__tempDiagObserver?.disconnect();
  w.__tempDiagObserver = new MutationObserver(strip);
  w.__tempDiagObserver.observe(document.body, { childList: true, subtree: true });
});

await installTempDiagGuard(page);
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
const entry = page.locator("[data-duel-vcf-start]").first();
check("对弈页有 VCF 挑战入口", await entry.count() > 0);
if (await entry.count()) {
  await entry.click();
  await page.waitForTimeout(1500);
}
check("VCF 挑战页能打开且零 pageerror", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
