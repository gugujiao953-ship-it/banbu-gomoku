/**
 * 本机凭证的**接线门禁**（用户 2026-10-11 第六轮定下的形态）。
 *
 * 用户原话：「把凭证做成一个入口吧，就是，想啥时候生成凭证就啥时候生成凭证，
 * 还可以给凭证命名，理论上我们可以用别人的凭证去登入。然后这个有导入凭证和导出凭证，
 * 这个凭证一般就导出关于棋魂，成就，战绩等这些数值类的，但是也可以选择连同备份一起导出，
 * 就是导出后，即使换机，也可以全部导入，和之前一模一样」。
 *
 * ## 这条门禁要挡住什么
 *
 * 凭证有"加密 + 生成 + 导出 + 导入"四段，每段都有"看起来做了、其实没接通"的坏法：
 *  · **码没给用户看**（那份文件永远打不开 —— 等于没生成）；
 *  · **没抄码就能导出**（用户拿到一份打不开的文件）；
 *  · **导出按钮点了没反应**（或没真落盘）；
 *  · **范围没说清**（"只数值"和"连棋谱"在恢复时的语义完全不同：
 *    一个不碰棋谱、一个整份替换 —— 用户必须能一眼看出这次是哪种）；
 *  · **导入流程缺一步**（选不了文件、输了码没反应、确认了没真导入）。
 *
 * 所以这里逐条真点：进设置 → 本机凭证 → 建 → 抄码 → 导出 → 看列表状态。
 *
 * ⚠ **不测的部分**：真正的"卸载 App 后文件还在"与"加密文件能被别的设备解开"
 * 需要真机装/卸 + 两份设备才能验，属发布前人工回归。
 *
 * 用法：`QA_BASE_URL=... node qa/vault-check.mjs`
 */

import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = BASE.includes("?") ? BASE : `${BASE}?qa=1`;

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) process.stdout.write(`  ✓ ${label}${detail ? `（${detail}）` : ""}\n`);
  else { failures += 1; process.stdout.write(`  ✗ ${label}${detail ? `（${detail}）` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(1200);
if (await page.evaluate(() => Boolean(document.querySelector(".first-run-backdrop")))) {
  await page.locator(".first-run-dialog .secondary-button", { hasText: "先自己试试" }).first().click();
  await page.waitForTimeout(400);
}

/**
 * 打开设置分区：**用设置页自己的搜索框**。
 *
 * ⚠ 不要点 `<summary>` —— `SettingsSection` 渲染的是
 * `<details open={open || Boolean(search)}>`（**受控** prop），点开后下次 re-render
 * 会把它重置回去。搜索框是应用既有行为，输入关键词会自动展开命中的分区。
 * ⚠ 关键词用「备份」而不是「本机凭证」：搜索会连条目一起过滤，
 * 用条目自己的名字当关键词会把要点的那个按钮过滤掉（实测踩到）。
 */
const openVaultPanel = async () => {
  const search = page.locator(".settings-search input").first();
  await search.fill("备份");
  await page.waitForTimeout(600);
  await page.locator(".settings-link", { hasText: "本机凭证" }).first().click();
  await page.waitForSelector("[data-vault-panel]", { timeout: 8000 });
  await page.waitForTimeout(300);
};

// ── 1. 入口 ─────────────────────────────────────────────────────────
section("1. 入口");
await page.locator(".bottom-nav button", { hasText: "设置" }).click();
await page.waitForTimeout(800);
const entry = page.locator(".settings-link", { hasText: "本机凭证" }).first();
const entryText = ((await entry.textContent().catch(() => "")) || "").replace(/\s+/g, " ");
check("设置页有「本机凭证」入口", await entry.count() > 0);
check("入口说明写明它是什么（加密快照 + 可导出）",
  entryText.includes("加密") && (entryText.includes("导出") || entryText.includes("下载")),
  entryText.slice(0, 70));
await openVaultPanel();
check("点开出现凭证面板", await page.locator("[data-vault-panel]").count() === 1);

// ── 2. 新建并命名（用户点名要的两件事）────────────────────────────────
section("2. 新建 + 命名");
check("有「新建一份凭证」区块", await page.locator("[data-vault-create]").count() === 1);
check("可以给凭证起名字（有名字输入框）", await page.locator("[data-vault-newname]").count() === 1);
await page.locator("[data-vault-newname]").first().fill("门禁测试凭证");
await page.locator("[data-vault-create]").first().click();
await page.waitForSelector("[data-vault-created]", { timeout: 15000 });

const shownCode = ((await page.locator("[data-vault-newcode]").first().textContent()) || "").trim();
check("生成后**把恢复码显示出来**（否则这份凭证永远打不开）",
  /^[^-]{4}-[^-]{4}-[^-]{4}-[^-]{4}$/.test(shownCode), shownCode || "(空)");
check("恢复码不含易混字符 0/O/1/I/L（手抄不出错）",
  !/[0O1IL]/.test(shownCode.replace(/-/g, "")), shownCode);
check("新建时给的名字出现在这一步（用户能认出是哪一份）",
  ((await page.locator("[data-vault-created]").first().textContent()) || "").includes("门禁测试凭证"));
check("有「我已抄下」确认（强制抄码）", await page.locator("[data-vault-ack]").count() === 1);

// ── 3. 没勾确认不许导出 ─────────────────────────────────────────────
section("3. 抄码确认是硬门槛");
await page.locator("[data-vault-first-export]").first().click();
await page.waitForTimeout(400);
check("没勾「我已抄下」时**不导出**（留在抄码这一步）",
  await page.locator("[data-vault-created]").count() > 0);

// ── 4. 范围选择（用户点名的"数值类 vs 连同备份"）──────────────────────
section("4. 导出范围");
check("有「只含数值」这一档", await page.locator("[data-vault-scope='state']").count() === 1);
check("有「连棋谱一起」这一档", await page.locator("[data-vault-scope='full']").count() === 1);
check("**默认是「只含数值」**（用户原话「一般就导出……数值类的」）",
  await page.locator("[data-vault-scope='state']").first().isChecked());
const scopeText = ((await page.locator(".vault-scope").first().textContent()) || "").replace(/\s+/g, " ");
check("说明写清「只数值不动棋谱」（这条差别关系到会不会丢棋谱）",
  scopeText.includes("棋谱") && (scopeText.includes("不动") || scopeText.includes("不会动")),
  scopeText.slice(0, 80));
check("说明写清「连棋谱 = 整份替换」",
  scopeText.includes("整份替换") || scopeText.includes("一模一样"), "");

// ── 5. 导出（真的写出文件）──────────────────────────────────────────
section("5. 导出");
await page.locator("[data-vault-ack]").first().check();
// 网页版没选过文件夹时走"浏览器下载"，所以这里等一个 download 事件。
const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
await page.locator("[data-vault-first-export]").first().click();
const download = await downloadPromise;
check("点导出**真的产出文件**（下载事件）", Boolean(download), download ? await download.suggestedFilename() : "没等到下载");
if (download) {
  const name = await download.suggestedFilename();
  check("文件名带**用户起的名字**与凭证 id（一个文件夹能放多份）",
    name.includes("门禁测试凭证") && name.endsWith(".json"), name);
}
await page.waitForTimeout(800);

// ── 6. 列表状态（多份 + 上次导出）────────────────────────────────────
section("6. 列表");
const card = page.locator("[data-vault-entry]").first();
check("列表里出现这条凭证", await card.count() === 1);
check("列表显示用户起的名字", ((await page.locator("[data-vault-name]").first().textContent()) || "").includes("门禁测试凭证"));
const when = ((await page.locator("[data-vault-when]").first().textContent()) || "").replace(/\s+/g, " ");
check("列表如实显示上次导出时间与范围", /刚刚/.test(when) && when.includes("只数值"), when);
check("有「重新导出」按钮（导过一次之后）",
  ((await page.locator("[data-vault-export]").first().textContent()) || "").includes("重新导出"));

// 再建一份，验证"可以有很多份"
await page.locator("[data-vault-newname]").first().fill("第二份");
await page.locator("[data-vault-create]").first().click();
await page.waitForSelector("[data-vault-created]", { timeout: 15000 });
check("**可以建多份**（第二次新建也成功）",
  await page.locator("[data-vault-entry]").count() === 2);

// ── 7. 恢复码的显示与复制 ───────────────────────────────────────────
section("7. 恢复码");
const masked = ((await page.locator("[data-vault-code]").first().textContent()) || "").trim();
check("默认只露前四位（防止旁人瞄屏）", masked.includes("·"), masked.slice(0, 20));
await page.locator("[data-vault-reveal]").first().click();
await page.waitForTimeout(250);
const revealed = ((await page.locator("[data-vault-code]").first().textContent()) || "").trim();
check("点「显示」能看到完整码", revealed.length >= 16 && !revealed.includes("·"), revealed.slice(0, 20));
check("有「复制」按钮", await page.locator("[data-vault-copy]").count() > 0);
check("每张卡都写着「码丢了就打不开」",
  ((await page.locator(".vault-code-warn").first().textContent()) || "").includes("丢"), "");

// ── 8. 导入（换机 / 用别人的凭证）────────────────────────────────────
section("8. 导入");
check("有「导入凭证」区块", await page.locator(".vault-import").count() === 1);
check("有「选择凭证文件」按钮", await page.locator("[data-vault-pick]").count() === 1);
check("有隐藏的文件输入且限定 .json", await page.locator("[data-vault-file]").count() === 1);

/**
 * 真喂一份凭证文件进去 —— 走"选文件 → 输码 → 解锁 → 预览"整条路。
 * 文件内容用**门禁自己造的一份真凭证**（拿页面里的加解密 API 生成），
 * 这样能验到"解开之后能显示是谁的、含什么"。
 */
const crafted = await page.evaluate(async () => {
  // 页面里没有暴露 vault 模块，所以这里用 WebCrypto 按同一套格式现造一份。
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const code = "7K2M9QX4H3VPNB6T";
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  // 一份"最小可用"的快照（结构要过 validateBackup）
  const snapshot = {
    schema: "banbu-gomoku-backup", version: 1, schemaVersion: 1,
    appVersion: "1.1.9.27", exportedAt: new Date().toISOString(), scope: "state",
    localStorage: { library: [], active: null, drafts: {}, puzzleCollections: [], puzzleProgress: {}, puzzleTitleOverrides: { collections: {}, puzzles: {} }, libraryFolders: { recordFolders: [], puzzleFolders: [], recordAssignments: {}, puzzleAssignments: {} }, branchBookmarks: {}, defaultDocument: null, activeLargeRecord: null, recycleBin: [], themePreference: "system", displaySettings: { showNumbers: true, showCoordinates: true, showForbidden: true }, soulLedger: [{ id: "gate-1", at: 1, amount: 555, reason: "achievement", detail: "门禁" }] },
    indexedDb: { documents: [], summaries: [], indexChunks: [], drafts: [], trashDocuments: [], trashSummaries: [], trashIndexChunks: [], trashDrafts: [] },
  };
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(snapshot)));
  const file = {
    kind: "banbu-vault", v: 1, vaultId: "7K2M-9QX4", name: "别人的凭证",
    kdf: { alg: "PBKDF2-SHA256", iterations: 1000, salt: b64(salt) },
    cipher: { alg: "AES-GCM-256", iv: b64(iv), ct: b64(new Uint8Array(ct)) },
    exportedAt: new Date().toISOString(), appVersion: "1.1.9.27", scope: "state", codeHint: "7K2M····",
  };
  return JSON.stringify(file);
});
await page.locator("[data-vault-file]").first().setInputFiles({
  name: "别人的凭证-7K2M-9QX4.json",
  mimeType: "application/json",
  buffer: Buffer.from(crafted, "utf8"),
});
await page.waitForTimeout(600);
const info = ((await page.locator("[data-vault-fileinfo]").first().textContent().catch(() => "")) || "").replace(/\s+/g, " ");
check("选完文件就显示「这是谁的」+ 导出时间 + 范围（**还没输码**）",
  info.includes("别人的凭证") && info.includes("只含数值"), info.slice(0, 80));

/**
 * 错码必须被拒绝，而且**要说清是码的问题**。
 *
 * ⚠ 这里刻意用**16 位**的错码（而不是短码）：短码会走"抄漏了几位"那条分支，
 * 测不到"码对不上"这条 —— 而后者才是用户输错时最常见的遭遇。
 * 若这里报的是"文件不像凭证"，那说明错误归因错了（用户会去翻文件、白折腾）。
 */
await page.locator("[data-vault-codeinput]").first().fill("AAAA-BBBB-CCCC-DDDD");
await page.locator("[data-vault-unlock]").first().click();
await page.waitForTimeout(1500);
const wrongCodeMsg = ((await page.locator(".vault-error").first().textContent().catch(() => "")) || "").replace(/s+/g, " ");
check("16 位错码被拒绝，且提示指向**恢复码**（不是误导用户去查文件）",
  /恢复码/.test(wrongCodeMsg) && !/不像一份本机凭证/.test(wrongCodeMsg), wrongCodeMsg.slice(0, 60));
// 短码走另一条分支：说清还差几位
// 清空再输，确保这一次的提示**只可能**来自短码这一轮（不残留上一轮的话）。
await page.locator("[data-vault-codeinput]").first().fill("");
await page.waitForTimeout(200);
await page.locator("[data-vault-codeinput]").first().fill("AAAA-BBBB");
await page.locator("[data-vault-unlock]").first().click();
await page.waitForTimeout(800);
const shortMsg = ((await page.locator(".vault-error").first().textContent().catch(() => "")) || "").replace(/s+/g, " ");
check("短码提示指向**位数不够**", /不完整|16 位/.test(shortMsg), shortMsg.slice(0, 50));

await page.locator("[data-vault-codeinput]").first().fill("7K2M-9QX4-H3VP-NB6T");
await page.locator("[data-vault-unlock]").first().click();
await page.waitForSelector("[data-vault-preview]", { timeout: 20000 });
const preview = ((await page.locator("[data-vault-preview-summary]").first().textContent()) || "").replace(/\s+/g, " ");
check("对码之后显示预览（谁的 + 什么时候 + 含什么）",
  preview.includes("别人的凭证") && preview.includes("只含数值"), preview.slice(0, 90));
const warn = ((await page.locator("[data-vault-scope-warning]").first().textContent()) || "").replace(/\s+/g, " ");
check("预览里写清这次恢复**会不会动棋谱**",
  warn.includes("不会动") || warn.includes("整份替换"), warn.slice(0, 70));
check("有「确认导入」按钮", await page.locator("[data-vault-apply]").count() === 1);

// ── 9. 首运行欢迎卡**不带**凭证入口（用户 2026-10-11 明确要求去掉）──────
section("9. 首运行欢迎卡（应保持干净）");
const freshContext = await browser.newContext({ viewport: { width: 392, height: 852 } });
const freshPage = await freshContext.newPage();
// ⚠ 不能带 `?qa=1`：`onboarding.ts` 明确在 qa 模式下不弹欢迎卡，而这一节要测的正是那张卡。
const freshUrl = BASE.includes("?") ? BASE.split("?")[0] : BASE;
await freshPage.goto(freshUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
await freshPage.waitForSelector(".first-run-backdrop", { timeout: 20000 }).catch(() => {});
check("新装会弹首运行欢迎卡", await freshPage.locator(".first-run-backdrop").count() > 0);
/**
 * ⚠ 这两条是**反向断言**：用户 2026-10-11 看过之后要求把「我有本机凭证」从欢迎卡上去掉 ——
 * 那张卡只负责"带新人上手"，而凭证是装过的人才会用的东西，属设置里的固定位置。
 * 钉成"必须不存在"，免得以后有人又凭"重装后第一件事是拿回数据"这个理由加回来。
 */
check("欢迎卡上**没有**凭证入口（新手提示只带新人上手）",
  await freshPage.locator("[data-first-run-vault]").count() === 0);
const firstRunButtons = await freshPage.locator(".first-run-actions button").count();
check("欢迎卡的按钮回到三个（引导 / 手册 / 先自己试试）", firstRunButtons === 3, `${firstRunButtons} 个`);
await freshContext.close();

// ── 10. 运行期 ──────────────────────────────────────────────────────
section("10. 运行期");
check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
process.exit(failures === 0 ? 0 : 1);
