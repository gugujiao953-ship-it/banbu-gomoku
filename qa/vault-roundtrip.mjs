/**
 * 门禁：本机凭证的**整条往返**（用户 2026-10-15 报：「生成了文件、复制了凭证码、清空缓存后再导入，
 * 粘贴凭证码说码错误」）。加密链本身有 `vault.test.ts` / `vault-crypto.test.ts` 守着，
 * 但**"复制出来的那串"能不能粘回去解开**这条只有走一遍真实界面才知道 —— 它横跨
 * 生成 → 剪贴板 → 文件落盘 → 换环境 → 输入框 → 派生密钥，任何一环改了格式都会砸在用户手上。
 *
 * 断言：
 *  ① 屏上码是 4×4 带连字符，剪贴板是 16 位无分隔；两者规范化之后必须完全相同
 *     （不一样就是"复制的不是你看到的那份"，正是用户怀疑的那种）。
 *  ② 导出的文件带着 `vaultId` / `codeHint` / PBKDF2 25 万次迭代。
 *  ③ 选完文件，界面上要出现「这份的码以 XXXX 开头」—— 用户自查"手上这份码是不是这一份的"唯一线索。
 *  ④ **全新上下文（＝清空缓存 / 换机）**里把剪贴板原文粘进去 → 能解开（出现确认预览）。
 *  ⑤ 同一台机器上故意用错码 → 说清是码不对，并指向「用这台机器记着的码」那颗按钮；点它 → 能解开。
 *     全新上下文里那颗按钮**不该存在**（本机已经不认这份了），不许凭空长出来。
 *  ⑥ 全程无 pageerror。
 *
 * 用法：`QA_BASE_URL=http://127.0.0.1:<口>/ node qa/vault-roundtrip.mjs`
 * ⚠ 要跑在**生产构建的 preview**上：dev 服务器与本页无关，但导出走的是浏览器下载，
 *    dev 的模块图会让第一趟慢很多；用 `npx vite preview --outDir …` 起一个自己的口。
 */
import { chromium } from "playwright";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:5193/");
url.searchParams.set("qa", "1");
const FILE = join(tmpdir(), `banbu-vault-gate-${Date.now()}.json`);
const FILE3 = join(tmpdir(), `banbu-vault-gate-b-${Date.now()}.json`);
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

const openVault = async (page) => {
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]');
    [...nav.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "设置")?.click();
  });
  await page.waitForSelector(".settings-page", { timeout: 60000 });
  await page.waitForTimeout(1200);
  // 设置页每节是折叠的 <details>，可点的是里面的 button.settings-link-main（点外层 span 不触发）
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("details")) d.open = true;
    const b = [...document.querySelectorAll("button.settings-link-main")].find((e) => (e.textContent || "").includes("本机凭证"));
    if (!b) throw new Error("设置里找不到「本机凭证」入口");
    b.click();
  });
  await page.waitForSelector("[data-vault-panel]", { timeout: 30000 });
};

const normalize = (value) => String(value).replace(/[^0-9A-Za-z]/g, "").toUpperCase();

// ── 第一趟：建码 → 复制 → 导出 ─────────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block", acceptDownloads: true });
await ctx1.grantPermissions(["clipboard-read", "clipboard-write"]);
const p1 = await ctx1.newPage();
const errs1 = []; p1.on("pageerror", (e) => errs1.push(String(e).slice(0, 140)));
await p1.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
await p1.waitForSelector(".bottom-nav", { timeout: 60000 });
await openVault(p1);
await p1.evaluate(() => {
  const input = document.querySelector("[data-vault-newname]");
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, "门禁这一份"); input.dispatchEvent(new Event("input", { bubbles: true }));
});
await p1.click("[data-vault-create]");
await p1.waitForSelector("[data-vault-created]", { timeout: 30000 });
const shown = (await p1.textContent("[data-vault-newcode]")) ?? "";
await p1.evaluate(() => { [...document.querySelectorAll("[data-vault-created] button")].find((b) => (b.textContent || "").includes("复制"))?.click(); });
await p1.waitForTimeout(700);
const clip = await p1.evaluate(() => navigator.clipboard.readText());
check("① 屏上是 4×4 带连字符，剪贴板是 16 位无分隔", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(shown) && clip.length === 16, `屏上 ${shown} · 剪贴板 ${clip}`);
check("① 两者规范化后完全相同", normalize(shown) === normalize(clip), `${normalize(shown)}`);

await p1.evaluate(() => { const box = document.querySelector("[data-vault-ack]"); if (box && !box.checked) box.click(); });
const download = p1.waitForEvent("download", { timeout: 90000 });
await p1.click("[data-vault-first-export]");
const file = await download;
await file.saveAs(FILE);
const vault = JSON.parse(readFileSync(FILE, "utf8"));
check("② 导出文件带着 vaultId / codeHint / 25 万次迭代",
  Boolean(vault.vaultId) && Boolean(vault.codeHint) && vault.kdf?.iterations === 250000,
  `${file.suggestedFilename()} · ${vault.vaultId} · ${vault.codeHint} · ${vault.kdf?.iterations}`);
await ctx1.close();

// ── 第二趟：全新上下文（＝清空缓存 / 换机）──────────────────────
const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const p2 = await ctx2.newPage();
const errs2 = []; p2.on("pageerror", (e) => errs2.push(String(e).slice(0, 140)));
await p2.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
await p2.waitForSelector(".bottom-nav", { timeout: 60000 });
await openVault(p2);
await p2.setInputFiles("[data-vault-file]", FILE);
await p2.waitForSelector("[data-vault-restoring]", { timeout: 30000 });
const info = (await p2.textContent("[data-vault-fileinfo]")) ?? "";
check("③ 选完文件就写明「这份的码以 XXXX 开头」", info.includes(vault.codeHint.slice(0, 4)), info.trim());
check("⑤ 全新机器上不该长出「用这台机器记着的码」那颗按钮", await p2.locator("[data-vault-use-registry]").count() === 0);
await p2.fill("[data-vault-codeinput]", clip);
await p2.click("[data-vault-unlock]");
await p2.waitForTimeout(12000);
check("④ 粘贴剪贴板原文能解开（出现导入确认预览）", await p2.locator("[data-vault-preview]").count() === 1,
  await p2.evaluate(() => (document.querySelector(".vault-error")?.textContent || "").trim()));
await ctx2.close();

// ── 第三趟：同一台机器（登记过这份）故意用错码 ──────────────────
const ctx3 = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block", acceptDownloads: true });
const p3 = await ctx3.newPage();
const errs3 = []; p3.on("pageerror", (e) => errs3.push(String(e).slice(0, 140)));
await p3.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
await p3.waitForSelector(".bottom-nav", { timeout: 60000 });
await openVault(p3);
await p3.evaluate(() => {
  const input = document.querySelector("[data-vault-newname]");
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, "门禁这一份"); input.dispatchEvent(new Event("input", { bubbles: true }));
});
await p3.click("[data-vault-create]");
await p3.waitForSelector("[data-vault-created]", { timeout: 30000 });
// 这一趟自己那份码（不能拿第一趟的 clip 比：不同上下文各生成各的）
const shown3 = (await p3.textContent("[data-vault-newcode]")) ?? "";
await p3.evaluate(() => { const box = document.querySelector("[data-vault-ack]"); if (box && !box.checked) box.click(); });
// 第三趟必须导入**这一趟自己导出的那份**：注册表里的 vaultId 是本次新建的那串码推出来的，
// 拿第一趟的文件来对，本机当然不认（那正是用户踩的"复制成另一份的码"）。
const own = p3.waitForEvent("download", { timeout: 90000 });
await p3.click("[data-vault-first-export]");
await (await own).saveAs(FILE3);
await p3.setInputFiles("[data-vault-file]", FILE3);
await p3.waitForSelector("[data-vault-restoring]", { timeout: 30000 });
await p3.fill("[data-vault-codeinput]", "2222-2222-2222-222A");
await p3.click("[data-vault-unlock]");
await p3.waitForTimeout(12000);
const wrongText = await p3.evaluate(() => (document.querySelector(".vault-error")?.textContent || "").trim());
check("⑤ 错码要说清是码不对（不许把人引去怀疑文件）", /恢复码/.test(wrongText) && !/不像.*凭证/.test(wrongText), wrongText.slice(0, 90));
check("⑤ 本机登记过这一份时，要递出「用这台机器记着的码」", await p3.locator("[data-vault-use-registry]").count() === 1,
  /点下面那颗/.test(wrongText) ? "错码那句里也带了指引" : "只有按钮、句子没提（可接受）");
await p3.click("[data-vault-use-registry]");
const filled = await p3.inputValue("[data-vault-codeinput]");
check("⑤ 那颗按钮把本机记着的码填进输入框", normalize(filled) === normalize(shown3) && filled.length > 0, `填了 ${filled} · 本机那份 ${shown3}`);
await p3.click("[data-vault-unlock]");
await p3.waitForTimeout(12000);
check("⑤ 用它就能解开", await p3.locator("[data-vault-preview]").count() === 1);

check("⑥ 三趟全程无 pageerror", errs1.length + errs2.length + errs3.length === 0, [...errs1, ...errs2, ...errs3].slice(0, 2).join(" ; "));
await browser.close();
rmSync(FILE, { force: true });
rmSync(FILE3, { force: true });

if (failures.length) { console.error(`\n本机凭证往返门禁失败 ${failures.length} 项：\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\n本机凭证往返通过：屏上码＝剪贴板码（只差分隔符）、导出件带码前缀、全新机器粘贴能解开、错码归因正确且递出本机记着的那份码。");
