/**
 * 棋魂定价**单一事实来源**守卫（2026-10-11）。
 *
 * ## 这一条是为了抓一类具体的 bug（本轮抓到两次）
 *
 * `SOUL_EARN_RULES`（来源表）与发放代码是**两处**，技术上无法互相约束：
 *  · 说明页读表 → 显示"赢一局 +20"；
 *  · 结算点自己算 → 实际发 8。
 * 两边不一致时，**没有任何报错**，用户只能靠自己对着账本发现
 * （数字差得不多，通常发现不了）。
 *
 * 本轮实测到的两次（都在"用户正在调数值"的背景下发生，所以格外危险）：
 *  ① `soulForDuelWin` 写死 `SOUL_DUEL_WIN = 8 / MASTER = 60`，而表里是 20/100；
 *  ② `soulForVcfProblem` 写死 `SOUL_VCF_BASE = 6`，而表里是 10。
 * 而**单测与门禁都在替它们站岗**（断言 8/60/6 不变），所以它们一直没被发现。
 *
 * ## 这个门禁怎么判
 *
 * 用**源码扫描 + 运行时对账**两条：
 *  A. 源码里那些"定价函数"不许出现数字字面量（只能走 `soulAmount(...)`）；
 *  B. 源码里也不许再有 `SOUL_DUEL_WIN` / `SOUL_VCF_BASE` 这类"影子常量"
 *     （它们的存在本身就是"第二个事实来源"）；
 *  C. 运行时：真发一笔，看它是不是等于表上的价（用真的浏览器跑，端到端）。
 *
 * 跑法：先起 preview（4321），再 `node qa/soul-pricing-check.mjs`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const soulSource = fs.readFileSync(path.join(root, "src", "features", "progress", "soul.ts"), "utf8");
const economySource = fs.readFileSync(path.join(root, "src", "features", "progress", "soul-economy.ts"), "utf8");

/**
 * 去掉注释再扫描。
 *
 * ⚠ 必须去（第一次写这条门禁就栽在这上面）：源码的**注释里正解释着**这些
 * 影子常量的历史（"上一版是 `export const SOUL_DUEL_WIN = 8;`"），
 * 直接在原文上正则匹配会把注释当成代码，报出两个假失败 ——
 * 而门禁假失败比漏报更糟（它会让人开始忽略这条门禁）。
 */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")     // 块注释（含 JSDoc）
  .replace(/\/\/.*$/gm, "");            // 行注释

const soulCode = stripComments(soulSource);
const economyCode = stripComments(economySource);

// ── A. 影子常量不许存在 ─────────────────────────────────────────────
//
// 这类常量的坏处不是"名字难看"，而是它**长得像一个正经的定价出口**：
// 下一个改价的人会去改它（因为它显眼），而说明页读的是表 —— 于是不一致复活。
// 表才是定价的地方，所以这些名字应该彻底消失。
for (const name of ["SOUL_DUEL_WIN", "SOUL_DUEL_WIN_MASTER", "SOUL_VCF_BASE"]) {
  const declared = new RegExp(`export\\s+const\\s+${name}\\b`).test(soulCode)
    || new RegExp(`export\\s+const\\s+${name}\\b`).test(economyCode);
  check(`影子定价常量 ${name} 已移除（定价只在来源表里）`, !declared,
    declared ? "仍然导出着 —— 它会让下一个人改错地方" : "已移除");
}

// ── B. 定价函数必须走 soulAmount ───────────────────────────────────
/**
 * 抠出一个导出函数/箭头常量的**定义体**（`soul.ts` 里两种写法都有）。
 *
 * 两种形态都要认（第一版只认带大括号的，于是在
 * `export const x = (...) => expr;` 上抠错了地方、报出假失败）：
 *  · `export const f = (…): T => { … };`  → 大括号配对
 *  · `export const f = (…): number => expr;` → 到该语句结束的分号
 *
 * 简化处理：从签名后开始，先看遇到的第一个非空白字符是 `{` 还是别的。
 * 是 `{` 走配对；否则沿到行尾/分号（表达式体只有一行，够用）。
 */
const bodyOf = (source, signature) => {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  const semi = source.indexOf(";", start);
  // 没有大括号、或者分号出现在大括号之前 ⇒ 表达式体（到分号为止）。
  if (brace < 0 || (semi >= 0 && semi < brace)) {
    return semi < 0 ? source.slice(start) : source.slice(start, semi + 1);
  }
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace, i + 1);
    }
  }
  return null;
};

const duelBody = bodyOf(soulCode, "export const soulForDuelWin");
check("soulForDuelWin 存在", duelBody !== null);
if (duelBody) {
  // 只许出现"取表里的哪一档"的下标，不许出现价格数字。
  // ⚠ 判据用"有没有数字字面量"而不是"有没有 soulAmount"：前者更强
  //    （`return 8` 这种回退写法也一并挡住）。
  //    下标 `0` / `-1` 是允许的（它们是"第几条"，不是"多少钱"）——
  //    所以只在**不是** soulAmount 第二个参数的位置上禁数字。
  const withoutIndexes = duelBody.replace(/soulAmount\(\s*"duel-win"\s*,\s*-?\d+\s*\)/g, "soulAmount(…)");
  const literals = withoutIndexes.match(/\b\d+\b/g) ?? [];
  check("soulForDuelWin 函数体里没有价格数字字面量（只从表取价）",
    literals.length === 0,
    literals.length ? `发现数字：${literals.join(", ")}` : "干净");
  check("soulForDuelWin 走 soulAmount(\"duel-win\", …) 取价",
    /soulAmount\(\s*"duel-win"/.test(duelBody),
    duelBody.trim().slice(0, 80));
}

const vcfBody = bodyOf(soulCode, "export const soulForVcfProblem");
check("soulForVcfProblem 存在", vcfBody !== null);
if (vcfBody) {
  check("soulForVcfProblem 的基础价走 soulAmount(\"vcf-solve\")",
    /soulAmount\(\s*"vcf-solve"/.test(vcfBody));
}

/**
 * ⚠ 这一条守的是"结算点不许自定价"：`App.tsx` 里所有 `amount:` 都必须是
 * `soulAmount(...)` 或从定价函数来的变量 —— 不许出现裸数字。
 *
 * 判据故意写得窄（只看 `reason:` 与 `amount:` 相邻的那种 earn 调用），
 * 免得把无关的数字（超时、帧数）也算进来 —— 门禁误报会让人开始忽略它。
 */
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const earnCalls = [...appSource.matchAll(/progress\.earn\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)].map((m) => m[1]);
check("App.tsx 里能找到 earn 调用点（判据本身没失效）", earnCalls.length >= 4, `${earnCalls.length} 处`);
const nakedAmounts = earnCalls.filter((body) => /amount:\s*\d/.test(body));
check("App.tsx 的 earn 调用点没有写成裸数字的 amount（必须取价）",
  nakedAmounts.length === 0,
  nakedAmounts.length ? `${nakedAmounts.length} 处写了数字` : `${earnCalls.length} 处全部取价`);

// ── B2. 所有"能改 VCF 等级分"的地方都必须抬水位线 ────────────────────
/**
 * ## 这条抓的是什么（2026-10-11 实测到的一条白拿旁路）
 *
 * 等级奖励靠一条**水位线**（`banbu-vcf-level-paid-v1`）保证"只发一次"。
 * 凡是把等级分**往上**改的入口，都必须顺手把水位线抬到对应等级 ——
 * 否则就有个闭环：把等级分调到高档 → 随便解一题 → `claimVcfLevelRewards`
 * 以为"从 0 级爬上去了"，把中间各级的奖励一起补发。
 * 实测数值：重置到 20 手档（11 级）能白拿 **1140 魂**。
 *
 * 「设置 → 棋魂解锁 → 自选起始难度」早就防了这件事（花 500 的那个），
 * 但 **VCF 页自己那个免费的重置面板当时漏了** —— 于是贵的那条路没人走、
 * 免费那条路白送。两处必须一致，所以这里**逐处**检查：
 * 每个调用 `resetToStartLevel` 的地方，附近都要有 `saveVcfLevelPaid`。
 */
const resetCallers = [];
for (const file of [
  path.join(root, "src", "features", "vcf-challenge", "VcfChallengePage.tsx"),
  // ⚠ 设置页**曾经**也在这个清单里（那节的「自选起始难度」调 `resetToStartLevel`）。
  // 2026-10-11 用户要求把设置里那节删掉，动作改由 VCF 页的重置面板承担，
  // 所以这里不再扫设置页。**但文件仍要能安全读**（下面的 readFileSync 会抛），
  // 于是保留在清单里也无妨 —— 真删了文件反而要改门禁。这里直接去掉，少一处维护点。
]) {
  const source = fs.readFileSync(file, "utf8");
  /**
   * ⚠ **先去掉注释再看**（门禁自检时踩到的）：第一版直接在原文上找
   * `saveVcfLevelPaid`，于是"把守卫注释掉"这种改法照样绿 ——
   * 而那恰恰是最可能发生的"看起来还在、其实已经不跑了"。判据只能认**活代码**。
   *
   * 坐标统一在 `code`（去注释后的源码）里算，不再混用两套行号。
   */
  const code = stripComments(source);
  const lines = code.split("\n");
  const pattern = /resetToStartLevel\(/g;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const lineIndex = code.slice(0, match.index).split("\n").length - 1;
    // 抠出这次调用的完整实参（大括号/圆括号配对），用来判断"重置到哪一档"。
    const open = code.indexOf("(", match.index + "resetToStartLevel".length);
    let depth = 0;
    let close = open;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") { depth -= 1; if (depth === 0) { close = i; break; } }
    }
    const args = code.slice(open + 1, close);
    /**
     * **目标档位是 `"lowest"` 的不用管** —— 它只会把等级分往下调，
     * 造不出"跳上去白拿"的闭环。（这条豁免很重要：不加的话门禁会要求
     * 给一个"只降不升"的入口也抬水位线，而那是**错的方向** ——
     * 抬上去反而会让从没用过的人领不到 1 级的奖励。）
     */
    const targetsLowest = /"lowest"/.test(args);
    // 守卫要在**同一次调用所在的块**里（前后 40 行够覆盖整个 onClick/函数体）
    const window = lines.slice(Math.max(0, lineIndex - 20), lineIndex + 40).join("\n");
    resetCallers.push({
      where: `${path.basename(file)}:${lineIndex + 1}`,
      target: (args.split(",")[1] || "").trim() || "(未指明)",
      targetsLowest,
      guarded: /saveVcfLevelPaid\s*\(/.test(window),
    });
  }
}
/**
 * ⚠ 阈值从 `>= 2` 改成 `>= 1`：设置里那节（「自选起始难度」）已按用户要求删除，
 * 所以现在**只有 VCF 页**一个入口会往上跳等级分。
 * 判据的**意图**没变 —— 仍然是"每个可能往上跳的入口都必须抬水位线"，
 * 只是入口少了一个。等到又加新入口时，这条会因为它真的扫到了而继续生效。
 */
check("能找到重置 VCF 等级分的入口（判据本身没失效）", resetCallers.length >= 1, `${resetCallers.length} 处`);
const risky = resetCallers.filter((item) => !item.targetsLowest);
const unguarded = risky.filter((item) => !item.guarded);
check("每个**可能往上跳**的重置入口都抬了等级奖励水位线（堵白拿旁路）",
  unguarded.length === 0,
  unguarded.length
    ? unguarded.map((item) => `${item.where}（目标 ${item.target}）`).join("、")
    : `${risky.length} 处向上入口全部有守卫；另有 ${resetCallers.length - risky.length} 处只降到最低档（无需守卫）`);

// ── C. 运行时对账：说明页显示的数额 == 真正发放的数额 ──────────────
//
// 上面 A/B 都是**静态**的（防"又写死一个数字"）。这一条是**动态**的：
// 让页面真的按表发一笔，再念账本，两边必须相等。
// 这是唯一能抓住"表被改了但代码没跟上"（或反过来）的判据。
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const testURL = new URL(BASE);
testURL.searchParams.set("qa", "1");
await page.goto(testURL.href, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(800);

/** 打开对弈页（对局结算点在那里）。 */
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);

/**
 * 用页面里的模块**直接算价**（不是把数字抄进脚本 —— 抄进来就又变成第二个事实来源）。
 *
 * `?qa=1` 的构建里有一个调试入口（`window.__banbuDebug`），但定价函数不在里面。
 * 所以这里走另一条路：读**说明页渲染出来的数字**（那正是用户看到的），
 * 与"表里的价"对比 —— 两者都来自同一个模块，能验出"渲染与取值脱节"。
 */
await page.locator("[data-soul-badge]").click();
await page.waitForTimeout(600);
const shown = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-soul-earn]")];
  return rows.map((row) => ({
    reason: row.getAttribute("data-soul-earn"),
    text: (row.querySelector(".soul-earn-amount")?.textContent || "").trim(),
  }));
});
check("说明页列出了来源（对账的前提）", shown.length >= 6, `${shown.length} 条`);

// 对每一类来源，念一遍"表里写的"与"页面显示的"——
// 页面显示走的是 applyEarnTuning（含调度），默认调度下两者应当相等。
const tuningRaw = await page.evaluate(() => localStorage.getItem("banbu-soul-tuning-v1"));
const tuned = tuningRaw ? JSON.parse(tuningRaw) : null;
const neutral = !tuned
  || (tuned.earnMultiplier === 1 && tuned.achievementMultiplier === 1
      && (tuned.earnCapPerGrant ?? 0) === 0 && (tuned.dailyEarnLimit ?? 0) === 0
      && (tuned.disabledReasons ?? []).length === 0);
if (!neutral) {
  console.log("  · 本机改过调度项，跳过「显示 == 表」的对账（那不是 bug）");
} else {
  const mismatch = shown.filter((row) => {
    if (row.reason === "achievement") return false;   // 按各成就自己的奖励发，表格里写的是"按成就"
    const match = /^\+(\d+)$/.exec(row.text);
    return match === null;                             // 有数额就该是"+N"，否则说明渲染脱节
  });
  check("说明页每条来源都显示得出数额（含调度的实际值）",
    mismatch.length === 0,
    mismatch.length ? mismatch.map((row) => `${row.reason}「${row.text}」`).join("、") : "全部正常");
}

check("没有 pageerror", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
