import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// 新版本下载入口门禁：更新入口必须有「应用内下载 + 网盘（按 version.json 显隐）」，
// 且下载链路要真的走通（预检 → 分片 → 校验 → 交出去）。
//
// 关键点：**网盘入口是「标了才显示」**。作者没把当期安装包传到某个网盘时就不在
// version.json 里写该字段，界面不能凭空出现一个指向旧包的按钮。
//
// 走「设置 → 关于」这条正常路径断言：?qa=1 会抑制启动时的「发现新版本」模态
// （它会挡住自动化点击），但关于页里的下载入口是同一组件，覆盖同样的渲染逻辑。
//
// Usage: BANBU_URL=http://127.0.0.1:5299 node scripts/ui-update-download-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5299/";
const qaUrl = new URL(url);
qaUrl.searchParams.set("qa", "1");
const RELEASES_API = "https://api.github.com/repos/gugujiao953-ship-it/banbu-gomoku/releases?per_page=20";
const APK_URL = "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/download/v9.9.9/banbu-gomoku-9.9.9-android-release.apk";

const APK_SIZE = 512 * 1024 + 4096; // 跨两个分片，验证分片路径
const apkBytes = new Uint8Array(APK_SIZE);
for (let index = 0; index < APK_SIZE; index += 1) apkBytes[index] = (index * 31 + 7) % 251;
const APK_SHA256 = createHash("sha256").update(apkBytes).digest("hex");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block", acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`); };

let versionPayload = {};
let apkHits = 0;
let rangeHits = 0;
const apkCors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
  "access-control-allow-headers": "Range",
  "access-control-expose-headers": "Content-Length,Content-Range,Accept-Ranges",
};
await context.route("https://gh-proxy.com/**", (route) => route.fulfill({ status: 503, headers: apkCors }));
await context.route("https://gugujiao953-ship-it.github.io/**.apk", (route) => route.fulfill({ status: 404, headers: apkCors }));

await context.route("**/version.json", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(versionPayload),
}));
await context.route(RELEASES_API, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
// APK 响应：HEAD 报长度与 Range 支持，GET 按 Range 切片——模拟 release asset 的真实行为。
await context.route(APK_URL, (route) => {
  apkHits += 1;
  const request = route.request();
  const range = request.headers()["range"];
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: apkCors });
  if (request.method() === "HEAD") {
    return route.fulfill({ status: 200, headers: { ...apkCors, "content-length": String(APK_SIZE), "accept-ranges": "bytes", "content-type": "application/vnd.android.package-archive" } });
  }
  if (range) {
    rangeHits += 1;
    const [start, end] = range.replace("bytes=", "").split("-").map(Number);
    return route.fulfill({ status: 206, headers: { ...apkCors, "content-range": `bytes ${start}-${end}/${APK_SIZE}` }, body: Buffer.from(apkBytes.subarray(start, end + 1)) });
  }
  return route.fulfill({ status: 200, headers: { ...apkCors, "content-type": "application/vnd.android.package-archive" }, body: Buffer.from(apkBytes) });
});

const links = () => page.locator(".update-download-links").first();
const linksText = async () => (await links().textContent().catch(() => "")) || "";

const boot = async (payload) => {
  versionPayload = payload;
  apkHits = 0;
  rangeHits = 0;
  // ?qa=1 必须带：首运行欢迎页幕布会盖住整个界面，点击全部被拦（假失败）。
  await page.goto(qaUrl.href, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1900);
  // 正常路径：设置 → 关于 → 检查更新。
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim() === "设置")?.click(); });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").includes("关于半步五子棋打谱"))?.click(); });
  await page.waitForTimeout(950);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => /联网检查更新|重新检查/.test(element.textContent || ""))?.click(); });
  await page.waitForTimeout(1700);
};

const base = { version: "9.9.9", tag: "v9.9.9", publishedAt: "2026-09-15T00:00:00Z", url: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v9.9.9" };

// ── S1 三个入口齐全：直下 + 百度云 + 蓝奏云 ────────────────────────────
await boot({ ...base, mirrors: { baidu: "https://pan.baidu.com/s/1N5TW5BlXPQgNVFGKap3VhQ?pwd=v6tn", lanzou: "https://wwbwc.lanzouq.com/iJJgS48ghxji", lanzouCode: "1i8s" } });
const body1 = await linksText();
check("S1 出现下载入口区块", body1.length > 0, body1.slice(0, 60));
check("S1 有应用内下载入口", body1.includes("下载并安装 v9.9.9"));
check("S1 有百度网盘入口", body1.includes("百度网盘"));
check("S1 有蓝奏云入口并带密码", body1.includes("蓝奏云") && body1.includes("1i8s"));
check("S1 百度云指向配置的链接", await links().locator('a:has-text("百度网盘")').getAttribute("href") === "https://pan.baidu.com/s/1N5TW5BlXPQgNVFGKap3VhQ?pwd=v6tn");
check("S1 蓝奏云指向配置的链接", await links().locator('a:has-text("蓝奏云")').getAttribute("href") === "https://wwbwc.lanzouq.com/iJJgS48ghxji");
check("S1 GitHub 发布页仍在", await links().locator(`a[href="${base.url}"]`).count() === 1);

// ── S2 只标了百度云 → 蓝奏云不出现 ─────────────────────────────────────
await boot({ ...base, mirrors: { baidu: "https://pan.baidu.com/s/1N5TW5BlXPQgNVFGKap3VhQ?pwd=v6tn" } });
const body2 = await linksText();
check("S2 百度云显示", body2.includes("百度网盘"));
check("S2 蓝奏云不显示（本期没传）", !body2.includes("蓝奏云"));

// ── S3 一个网盘都没标 → 只剩应用内下载与 GitHub ────────────────────────
await boot(base);
const body3 = await linksText();
check("S3 无网盘时不渲染网盘区", !body3.includes("百度网盘") && !body3.includes("蓝奏云"), body3.slice(0, 60));
check("S3 应用内下载入口仍在", body3.includes("下载并安装 v9.9.9"));

// ── S4 点「下载并安装」→ 真的去拉 APK（预检 + 分片），进度出现 ──────────
await boot({ ...base, apk: APK_URL, size: APK_SIZE, sha256: APK_SHA256 });
const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).then((download) => ({ download }), (error) => ({ error }));
await links().locator("button", { hasText: "下载并安装" }).click();
const progressSeen = await (async () => {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const text = await linksText();
    const matched = text.match(/正在下载安装包 \d+%|正在准备下载/);
    if (matched) return matched[0];
    await page.waitForTimeout(150);
  }
  return null;
})();
check("S4 点击后出现下载进度", Boolean(progressSeen), String(progressSeen));
const downloadedEvent = await downloadPromise;
if (downloadedEvent.error) throw new Error(`安装包未交给浏览器：${await linksText()}；APK 请求 ${apkHits} / Range ${rangeHits}`);
const download = downloadedEvent.download;
const downloaded = await readFile(await download.path());
check("S4 真的请求了 APK 地址", apkHits > 0, `命中 ${apkHits} 次`);
check("S4 走了分片（多次 Range 请求）", rangeHits >= 2, `Range 请求 ${rangeHits} 次`);
check("S4 浏览器收到已校验的完整 APK 字节", downloaded.equals(Buffer.from(apkBytes)) && createHash("sha256").update(downloaded).digest("hex") === APK_SHA256);
check("S4 下载保留 APK 文件名", download.suggestedFilename() === "banbu-gomoku-9.9.9-android-release.apk");
check("S4 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exitCode = 1;
