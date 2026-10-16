// 「复原手序」正式功能端到端门禁（09-28 转正：不再挂在开发测试功能下）。
// 双通道按钮（09-29 定名）：「复原手序-本地」= 应用内识别器重跑序号匹配；
// 「复原手序-云端」= 应用内直调识图大模型（route 拦截伪造服务，全程不碰外网；
// 真值取自识别器对 numbered.png 的序号读出——qa/recognition-number-baseline.mjs 基线 16/16）。
// 09-28 二批：云端支持三种接口格式（OpenAI 兼容 / Anthropic Messages /
// OpenAI Responses），三条 route 各自按本格式应答：S2 把三路「测试连接」
// 全走一遍（同一 askVisionModel 通路），S3 之后带 Responses 格式走
// 带图复原全链路；Claude/Responses 的带图请求结构由单测逐字段钉住。
//   S1 设置→「数据与兼容」常驻 AI 识图卡（不依赖任何实验开关）；实验区里
//      「复原手序」开关行已删；服务商预设下拉已删，换成「接口格式」三选
//   S2 手填自定义端点 → 切 Claude 格式测试连接（命中 /messages 并读 Claude 式回复）
//      → 切 Responses 格式测试连接（命中 /responses 并读 Responses 式回复）
//   S3 刷新后配置与格式都仍在（localStorage 持久化）
//   R1 对齐屏不再有复原开关；核对屏常驻「复原手序-本地 + 复原手序-云端」双按钮
//      （按钮文字也钉住），快路径识别出的叠图不带手序
//   R2 复原手序-本地：零 AI 请求 → 叠图 16 子全部标手序、提示写明第 1 手到第 16 手、
//      编辑被锁（改子会破坏手序）
//   R3 复原手序-云端（Responses 格式，S3 持久化带过来的就是它）：mock 回
//      1..16 → 按 AI 结果重建、同样带手序
//   R4 确认导入 → 建的是**有顺序的 16 手棋谱**且光标停在最后一手
//      （不是停在第 0 手的空盘）
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5301/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const fixture = resolve("qa/fixtures/recognition/numbered.png");
const b64 = readFileSync(fixture).toString("base64");
const MOCK_BASE = "https://mock.ai.test/v1";

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });

// ── 0) 向识别器要 numbered.png 的「答案」（真值 + 本地复原的可行性前提）──
const truth = await (async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/qa-ai-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
  }));
  await page.goto(new URL("qa-ai-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const moves = await page.evaluate(async (payload) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:image/png;base64,${payload}`)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], "numbered.png", { type: "image/png" }), 15, {});
    return result.numberedMoves.map((move) => ({
      number: move.number,
      coord: `${String.fromCharCode(65 + move.col)}${15 - move.row}`,
      player: move.player === "black" ? "B" : "W",
    }));
  }, b64);
  await context.close();
  return moves;
})();
if (truth.length !== 16 || !truth.every((move, index) => move.number === index + 1)) {
  console.log(`FAIL 门禁前提：识别器对 numbered.png 的序号真值不再是 1..16（拿到 ${truth.length} 条），本脚本的前提失效，请先跑 qa/recognition-number-baseline.mjs`);
  await browser.close();
  process.exit(1);
}
console.log(`真值就绪：numbered.png ${truth.length} 子 1..${truth.length}（本地复原与云端 mock 共用这份答案）`);

// ── 伪造 AI 服务：三种接口格式各挂一条 route，按本格式的请求体与响应封装 ──
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const visionCounts = { chat: 0, claude: 0, responses: 0 };
const totalRequests = () => visionCounts.chat + visionCounts.claude + visionCounts.responses;
const mockHandler = (slot, envelope) => async (route) => {
  visionCounts[slot] += 1;
  const post = route.request().postData() || "";
  // 测试连接与真实复原共用端点：提示词里带「回复 OK」就是连接测试。
  const content = post.includes("回复 OK") ? "OK" : JSON.stringify(truth);
  await route.fulfill({ status: 200, contentType: "application/json", body: envelope(content) });
};
await context.route("**/chat/completions", mockHandler("chat", (text) => JSON.stringify({
  id: "mock", choices: [{ index: 0, message: { role: "assistant", content: text } }],
})));
await context.route("**/messages", mockHandler("claude", (text) => JSON.stringify({
  id: "mock_msg", model: "mock", content: [{ type: "text", text }],
})));
await context.route("**/responses", mockHandler("responses", (text) => JSON.stringify({
  id: "mock_resp", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", output_text: text, annotations: [] }] }],
})));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event).slice(0, 200)));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });

const openSettingsAndSearch = async (keyword) => {
  await page.locator("nav.bottom-nav button").filter({ hasText: "设置" }).first().click();
  await page.waitForSelector(".settings-search input", { timeout: 15000 });
  await page.locator(".settings-search input").fill(keyword);
  await page.waitForTimeout(300);
};

// ── S1 转正：AI 卡常驻「数据与兼容」，实验开关与预设下拉都没了 ────────
await openSettingsAndSearch("复原手序");
check("S1a 搜「复原手序」直达常驻 AI 卡（不依赖实验开关）", await page.locator("[data-setting-ai-vision]").count() === 1);
check("S1b 开发测试功能里不再有「复原手序」开关行", await page.locator("label.setting-row").filter({ hasText: "图片识谱「复原手序」" }).count() === 0);
const aiCardText = (await page.locator("[data-setting-ai-vision] small").allTextContents()).join(" ");
/**
 * ⚠ 2026-10-11 起，这一项的长说明（服务商举例、"只有带手序的图能复原"、Key 存哪）
 * 挪进了 **ⓘ 问号浮层**（用户：「文字太多了，你可以用问号代替，有问题点问号」）。
 * 所以这条断言改成**两段都验**：
 *  ① 行内那句要能读懂这是干什么的（含「识图」「手序」两个关键词）；
 *  ② 点开问号，那些**真正重要的细节**仍要读得到 ——
 *     否则"精简"就变成"把信息删了"，那才是真退化。
 * 比原来那条更强：原来只 grep 行内两个词，现在连浮层内容一起验。
 */
check("S1c 行内说明写明这是识图 + 手序", aiCardText.includes("识图") && aiCardText.includes("手序"), aiCardText.slice(0, 80));
await page.locator("[data-ai-vision-info]").first().click();
await page.waitForTimeout(400);
const aiNoteText = (await page.locator(".chip-note-sheet").textContent()) || "";
check("S1c2 ⓘ 浮层里写明「要视觉模型」并举例、且点明只有带手序的图能复原",
  aiNoteText.includes("视觉") && (aiNoteText.includes("豆包") || aiNoteText.includes("通义")) && aiNoteText.includes("手序"),
  aiNoteText.replace(/\s+/g, " ").slice(0, 90));
check("S1c3 ⓘ 浮层里写明 Key 只存本机、不进备份", aiNoteText.includes("本机"), "");
// 关掉浮层：后面的步骤要接着在设置页里操作
await page.locator(".chip-note-sheet .secondary-button").first().click();
await page.waitForTimeout(300);
check("S1d 服务商预设下拉已删，换成「接口格式」三选下拉", await page.locator('[aria-label="AI 识图服务商"]').count() === 0
  && await page.locator("[data-setting-ai-vision-format]").count() === 1
  && await page.locator("[data-setting-ai-vision-format] option").count() === 3);

// ── S2 手填自定义端点 + 逐格式测试连接（全走 mock）───────────────
await page.locator("[data-setting-ai-vision-base]").fill(MOCK_BASE);
await page.locator("[data-setting-ai-vision-key]").fill("qa-key-123");
await page.locator("[data-setting-ai-vision-model]").fill("mock-vision");
await page.locator("[data-setting-ai-vision-model]").blur();
await page.waitForTimeout(300);
// 默认格式就该打 /chat/completions
await page.locator(".ai-vision-test button").click();
await page.waitForSelector(".ai-vision-ok", { timeout: 15000 });
check("S2a 默认格式（OpenAI 兼容）测试连接命中 /chat/completions", visionCounts.chat === 1 && visionCounts.claude === 0 && visionCounts.responses === 0 && (await page.locator(".ai-vision-ok").textContent()).includes("连接成功"), JSON.stringify(visionCounts));
await page.locator("[data-setting-ai-vision-format]").selectOption("claude");
await page.waitForTimeout(200);
await page.locator(".ai-vision-test button").click();
await page.waitForSelector(".ai-vision-ok", { state: "detached", timeout: 5000 }).catch(() => {});
await page.waitForSelector(".ai-vision-ok", { timeout: 15000 });
check("S2b 切 Claude 格式后测试连接命中 /messages 且按 Anthropic 结构读到回复", visionCounts.claude === 1 && visionCounts.responses === 0, JSON.stringify(visionCounts));
await page.locator("[data-setting-ai-vision-format]").selectOption("responses");
await page.waitForTimeout(200);
await page.locator(".ai-vision-test button").click();
await page.waitForSelector(".ai-vision-ok", { state: "detached", timeout: 5000 }).catch(() => {});
await page.waitForSelector(".ai-vision-ok", { timeout: 15000 });
check("S2c 切 Responses 格式后测试连接命中 /responses 且按 Responses 结构读到回复", visionCounts.responses === 1, JSON.stringify(visionCounts));

// ── S3 刷新后配置与格式都在 ──────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await openSettingsAndSearch("复原手序");
check("S3 刷新后端点/模型/Key/格式都持久化",
  (await page.locator("[data-setting-ai-vision-base]").inputValue()) === MOCK_BASE
  && (await page.locator("[data-setting-ai-vision-model]").inputValue()) === "mock-vision"
  && (await page.locator("[data-setting-ai-vision-key]").inputValue()) === "qa-key-123"
  && (await page.locator("[data-setting-ai-vision-format]").inputValue()) === "responses");

// ── R1 识谱流程：对齐屏无开关；核对屏双按钮常驻；快路径不带手序 ────
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
check("R1a 对齐屏不再有「复原手序」开关", await page.locator(".board-fs-restore-order").count() === 0);
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(600);
check("R1b 核对屏常驻「复原手序-本地」「复原手序-云端」双按钮", await page.locator("[data-local-restore]").count() === 1 && await page.locator("[data-ai-restore]").count() === 1
  && (await page.locator("[data-local-restore]").textContent()).includes("复原手序-本地")
  && (await page.locator("[data-ai-restore]").textContent()).includes("复原手序-云端"));
check("R1d 按钮旁说明点明「棋子印有手序数字才能复原」", ((await page.locator(".image-verify-restore small").textContent()) || "").includes("手序（手数）"), ((await page.locator(".image-verify-restore small").textContent()) || "").slice(0, 60));
check("R1c 快路径识别不带手序（要点复原才有）", await page.locator("[data-verify-number]").count() === 0);

// ── R2 复原手序-本地：零 AI 请求、16 子全标手序、编辑被锁 ─────────
const beforeLocal = totalRequests();
await page.locator("[data-local-restore]").click();
await page.waitForFunction(() => document.querySelector(".image-verify-hint")?.textContent?.includes("本地已按序号复原"), null, { timeout: 180000 }).catch(() => {});
const localState = await page.evaluate(() => ({
  hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
  numbers: document.querySelectorAll("[data-verify-number]").length,
  stones: document.querySelectorAll("[data-verify-stone]").length,
  editDisabled: document.querySelector(".image-verify-modes button:nth-child(4)")?.disabled === true,
}));
check("R2a 复原手序-本地零 AI 请求", totalRequests() === beforeLocal, `${beforeLocal}→${totalRequests()}`);
check("R2b 提示写明本地复原第 1 手到第 16 手", localState.hint.includes("第 1 手到第 16 手"), localState.hint.slice(0, 60));
check("R2c 16 颗叠图棋子全部标上手序", localState.numbers === 16 && localState.stones === 16, `numbers=${localState.numbers} stones=${localState.stones}`);
check("R2d 已复原手序 → 编辑被锁", localState.editDisabled === true);

// ── R3 复原手序-云端（Responses 格式，持久化带的就是它）：带图真实链路 ──
// 判定用按钮 busy→idle，而不是等提示文案首次出现：叠图上 R2 已有手序，
// 「等文案」若撞上 React 状态未更新会读到上一轮结果（假阳性）。
// 三种格式的「发出去/收回来」在 S2 测试连接已全部走查（测试连接走的
// 就是同一个 askVisionModel 通路）；这里用带图 + 完整复原解析再钉一路。
const beforeAi = visionCounts.responses;
await page.locator("[data-ai-restore]").click();
await page.waitForFunction(() => document.querySelector("[data-ai-restore]")?.disabled === true, null, { timeout: 5000 }).catch(() => {});
await page.waitForFunction(() => document.querySelector("[data-ai-restore]")?.disabled === false, null, { timeout: 30000 });
const aiState = await page.evaluate(() => ({
  hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
  numbers: document.querySelectorAll("[data-verify-number]").length,
}));
check("R3a Responses 格式复原只发一条 /responses 请求", visionCounts.responses === beforeAi + 1 && visionCounts.claude === 1, `${beforeAi}→${visionCounts.responses}`);
check("R3b 提示写明 AI 复原了第 1 手到第 16 手", aiState.hint.includes("第 1 手到第 16 手"), aiState.hint.slice(0, 60));
check("R3c Responses 结果同样带手序标图", aiState.numbers === 16, `numbers=${aiState.numbers}`);

// ── R4 确认导入 → 有顺序的棋谱，光标停在最后一手 ──────────────────
await page.locator(".image-verify-confirm").click();
await page.waitForTimeout(1200);
const imported = await page.evaluate(() => ({
  stones: document.querySelectorAll(".stone-piece").length,
  lastDot: !!document.querySelector(".last-dot, .last-move-number"),
}));
check("R4a 导入建谱 16 子", imported.stones === 16, `stones=${imported.stones}`);
check("R4b 是有序棋谱（最后一手有标记；静态摆子不会有）", imported.lastDot === true);
check("R9 无页面错误", errors.length === 0, errors.join(" | "));

console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
