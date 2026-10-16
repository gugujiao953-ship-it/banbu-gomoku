import { chromium } from "playwright";

// Regression for the launch update prompt (发现新版本 dialog). The version
// sources are mocked, so this proves the whole chain: silent launch check
// -> once-per-release interruption -> per-version dismissal memory -> red dot
// keeps marking the update -> disabled/offline checks stay silent.
//
// 2026-09-15 修复：本脚本原先只 mock `/releases/latest`，而生产代码早已改为
// 「站点 version.json → jsDelivr → GitHub 发布列表」三源链（T35），并且
// /releases/latest 会因为公开仓里的 engine-pack 发布而返回非版本号 tag——
// 于是检查永远失败、弹窗永远不出现，S1 长期假失败。现在按真实调用面打桩：
// 关掉 API 那一源（回空列表），让站点 version.json 成为唯一可用源。
//
// Usage: BANBU_URL=http://127.0.0.1:5299 node scripts/ui-update-prompt-check.mjs
const url = process.env.BANBU_URL || "http://127.0.0.1:5299/";
const VERSION_JSON = "**/version.json";
const RELEASES_API = "https://api.github.com/repos/gugujiao953-ship-it/banbu-gomoku/releases?per_page=20";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 } }); // 手机主形态
let mockTag = "v9.9.9";
let offline = false;
await context.route(VERSION_JSON, (route) => (offline
  ? route.abort()
  : route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({
      version: mockTag.replace(/^v/, ""),
      tag: mockTag,
      publishedAt: "2026-09-08T00:00:00Z",
      url: `https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/${mockTag}`,
    }),
  })));
// GitHub API 兜底源：空列表 = 该源不可用（没有匹配应用版本的发布）。
await context.route(RELEASES_API, (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: "[]",
}));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const checks = [];
const expect = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}`); };
const dialog = () => page.locator('.bottom-sheet[aria-label="发现新版本"]');
const boot = async (clearPrompt) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  if (clearPrompt) await page.evaluate(() => localStorage.removeItem("banbu-update-prompt-dismissed-v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
};

// 1. first launch with a newer release: dialog with both versions + download entries
await boot(true);
expect("S1 弹窗出现", (await dialog().count()) === 1);
const text = (await dialog().textContent()) || "";
expect("S1 显示当前版本 1.1.8", text.includes("1.1.8"));
expect("S1 显示最新版本 9.9.9", text.includes("9.9.9"));
// 2026-09-15 起主操作是「应用内下载并安装」（按钮），不再是跳 release 页的链接；
// release 页入口降级为区块里的「GitHub 下载页」链接。
expect("S1 主操作是应用内下载", text.includes("下载并安装 v9.9.9"));
const githubHref = await dialog().locator('a:has-text("GitHub 下载页")').getAttribute("href");
expect("S1 GitHub 下载页仍指向 release", githubHref === "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v9.9.9");

// 2. 以后再说：关闭并按版本记忆；重启不再弹，但红点仍在
await dialog().getByRole("button", { name: "以后再说" }).click();
await page.waitForTimeout(400);
expect("S2 弹窗已关闭", (await dialog().count()) === 0);
expect("S2 按版本记录已忽略", await page.evaluate(() => localStorage.getItem("banbu-update-prompt-dismissed-v1")) === "9.9.9");
await boot(false);
expect("S2 同一版本不再打扰", (await dialog().count()) === 0);
expect("S2 红点仍提示有新版本", (await page.locator(".brand-trigger.has-update").count()) === 1);

// 3. 未来发布新版本：再次提醒一次（关闭按钮 X 与「以后再说」同语义）
mockTag = "v10.0.0";
await boot(false);
expect("S3 新版本再次弹窗", (await dialog().count()) === 1);
await dialog().getByRole("button", { name: "关闭" }).click();
await page.waitForTimeout(300);
expect("S3 X 关闭同样记忆版本", await page.evaluate(() => localStorage.getItem("banbu-update-prompt-dismissed-v1")) === "10.0.0");

// 4. 关闭自动检查：永不弹窗
await page.evaluate(() => localStorage.setItem("banbu-update-auto-check-v1", "false"));
mockTag = "v11.0.0";
await boot(false);
expect("S4 关闭自动检查后不弹窗", (await dialog().count()) === 0);

// 5. 断网/接口失败：静默，不打扰不报错
await page.evaluate(() => localStorage.removeItem("banbu-update-auto-check-v1"));
offline = true;
await boot(true);
expect("S5 离线检查保持静默", (await dialog().count()) === 0);

await browser.close();
const failed = checks.filter((c) => !c.ok);
if (errors.length) console.log("page errors:", errors.join(" | "));
console.log(failed.length || errors.length ? `FAILED ${failed.length}/${checks.length} (+${errors.length} page errors)` : `ALL ${checks.length} PASS`);
process.exit(failed.length || errors.length ? 1 : 0);
