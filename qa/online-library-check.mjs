import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 在线棋谱库 / 在线题库门禁（全程离线，夹具走 Playwright route 拦截）。
 *
 * R88（用户 09-26）改版后守这七件事：
 *  A. **入口常驻**（用户：「在线功能可以常驻了，不用开关打开了」）：棋谱库底部固定有
 *     「棋谱 / 题库 / 在线」三个界面，设置里不再有「在线棋谱库」「在线题库（自建题源）」
 *     两行实验开关；「数据与兼容」里的在线入口与代理地址也常驻。
 *  B. **不点第三方**：打开在线面一律不读第三方（棋手目录是打进包里的 `record-index-data.ts`，连自己服务器的文件都不取）；
 *     励精、renju.net、GitHub 的域名在面板挂载与筛选的全程都必须 0 请求。
 *  C. **棋手检索是两步式**（用户：「不是直接跳转，而是你搜到棋手、并且搜索到对应的对局
 *     之后，点击后才跳转到对应的浏览器网页界面」）：输名字 → 点检索 → 应用内列出这个人与
 *     他的对局；每一条对局是一个新标签的外链（读 href 即可核实，不点击）；没命中时如实说
 *     没有并给一条回退检索链接。
 *  D. **在线面不把第三方内容装进应用**：没有「在线查看」（取回本应用看局面）按钮、没有
 *     勾选框/批量条/下载按钮；界面文案不讲内部合规理由。
 *  E. **题库面是习题站导航**（用户：「题库搜索那里，也不再是连接 github」）：没有 GitHub
 *     地址输入框、没有「检索题库/下载并导入」；每张卡片是直达该站习题页的外链，筛选全在本地。
 *  F. **renju.net 一次都不许请求**（来源按条款停用；它只作为拼出来的跳转链接出现）。
 *  G. 设置页的在线代理地址仍可填写并持久化。
 *  H. **「其他」面（用户 2026-10-14：「在在线里面再加一个『其他』的版面，把这个链接放进去」）
 *     是网盘资料清单**：卡片是 `target=_blank` 的外链、提取码直接上屏、「复制」写进剪贴板的
 *     是「地址 + 换行 + 提取码」，并且这一面同样**零第三方请求**。
 *
 * 跑法：需要 dev 服务器（励精的三份夹具走 route 拦截，不真连外网）
 *   npm run dev -- --port 5301
 *   QA_BASE_URL=http://127.0.0.1:5301/ node qa/online-library-check.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
// runner 会把 qa=1 设在 QA_BASE_URL 上，这里必须用 URL 合并而不是拼字符串，
// 否则会得到 `?qa=1?qa=1` —— 参数值不再是 "1"，欢迎页照样弹出来挡点击。
const qaUrl = new URL(baseUrl);
qaUrl.searchParams.set("qa", "1");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// 励精连珠教室（唯一的棋谱来源，浏览式：史记索引 → 赛事页 → 轮次页）的夹具。
const ljrenjuDir = resolve("src/features/online/__fixtures__/ljrenju");
const ljRead = (name) => readFileSync(resolve(ljrenjuDir, name), "utf8");

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
// 「其他」面那颗「复制」按钮要真写剪贴板，门禁才测得到它写进去的是什么（不给权限时
// Chromium 会直接 reject，测出来的是探针的失败而不是功能的失败）。
await context.grantPermissions(["clipboard-read", "clipboard-write"]);

let sourceRequests = 0;
/** renju.net 的请求计数：来源已按条款停用，这个数必须整轮保持 0。 */
let renjuRequests = 0;
/** 任何 GitHub / 自建题库域的请求：这一版界面已经没有那条通道了，必须全程 0。 */
let githubRequests = 0;

// 关键：fulfill 必须带 CORS 头，否则浏览器直接拦掉响应，会被误读成「功能坏了」。
await page.route("**://www.renju.net/**", async (route) => {
  renjuRequests += 1;
  return route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" }, body: "不该被请求：renju.net 已停用" });
});
await page.route("**://www.ljrenju.com/**", async (route) => {
  sourceRequests += 1;
  const path = new URL(route.request().url()).pathname;
  const body = path.endsWith("/news/index.htm") ? ljRead("news-index.html")
    : /r\d+\.htm$/i.test(path) ? ljRead("round-wryc7dr9.html")
      : ljRead("event-wc18.html");
  return route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" }, body });
});
// 「自建题库通道不许复活」的守卫要**只盯那条通道**：应用自己的版本更新检查也走 GitHub
// （api.github.com/repos/…/releases/…），一刀切拦会把无关请求算成失败（实测踩过）。
// ⚠ 不能按 owner 名（gugujiao953-ship-it）判：应用自己的「检查更新」也带这个名字
//    （api.github.com/repos/gugujiao953-ship-it/... /releases、github.com/.../releases 页），
//    算进来就是假失败（09-28 实测 2 次）。只盯自建题库通道那三种形状。
const SELF_HOSTED_PATTERNS = [/\/contents\//, /\/tree\//, /manifest\.json/i, /gugujiao953-ship-it\.github\.io\//, /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(?:gh-pages|main)\//];
const blockIfSelfHosted = async (route) => {
  const url = route.request().url();
  if (SELF_HOSTED_PATTERNS.some((pattern) => pattern.test(url))) {
    githubRequests += 1;
    return route.fulfill({ status: 410, body: "不该被请求：自建题库通道已撤下入口" });
  }
  return route.fallback();
};
await page.route("**://api.github.com/**", blockIfSelfHosted);
await page.route("**://*.githubusercontent.com/**", blockIfSelfHosted);
await page.route("**://github.com/**", blockIfSelfHosted);

const failures = [];
const step = async (name, run) => {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}：${error.message}`);
    console.log(`  ✗ ${name}：${error.message}`);
  }
};

await page.goto(qaUrl.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav", { timeout: 60_000 });
await page.evaluate(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));

await step("在线入口常驻：棋谱库底部固定有「棋谱 / 题库 / 在线」三个界面", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav", { timeout: 60_000 });
  await page.click('.bottom-nav button:has-text("棋谱库")');
  await page.waitForSelector(".library-segment", { timeout: 20_000 });
  const tabs = await page.locator('.library-segment button[role="tab"]').allTextContents();
  for (const want of ["棋谱", "题库", "在线"]) {
    assert(tabs.some((label) => label.includes(want)), `缺少「${want}」界面（入口常驻，用户 09-26）：${tabs.join(" / ")}`);
  }
  assert(await page.locator('[data-library-tab="online"]').count() === 1, "「在线」入口应恰好渲染一次");
});

await step("设置里不再有在线实验开关，但在线入口与代理地址常驻", async () => {
  await page.click('.bottom-nav button:has-text("设置")');
  await page.waitForSelector(".settings-page", { timeout: 20_000 });
  await page.getByLabel("搜索设置").fill("在线");
  await page.waitForTimeout(400);
  assert(await page.locator("label.setting-row").filter({ hasText: "在线棋谱库" }).count() === 0, "「在线棋谱库」开关应已删除");
  assert(await page.locator("label.setting-row").filter({ hasText: "在线题库" }).count() === 0, "「在线题库（自建题源）」开关应已删除");
  assert(await page.locator(".settings-link").filter({ hasText: "在线棋谱库" }).count() === 1, "设置里应常驻「在线棋谱库」入口");
  assert(await page.locator("[data-setting-online-proxy]").count() === 1, "代理地址应常驻（不再随开关隐藏）");
});

await step("打开在线面不请求任何第三方（棋手目录已打进包里，连自己服务器的文件都不用取）", async () => {
  await page.click('.bottom-nav button:has-text("棋谱库")');
  await page.waitForSelector(".library-segment", { timeout: 20_000 });
  await page.click('[data-library-tab="online"]');
  await page.waitForSelector("[data-online-player-search]", { timeout: 20_000 });
  await page.waitForTimeout(900);
  assert(sourceRequests === 0, `打开面板就取了励精 ${sourceRequests} 次，必须是 0`);
  assert(renjuRequests === 0 && githubRequests === 0, `打开面板请求了停用来源（renju ${renjuRequests} / github ${githubRequests}）`);
});

await step("棋谱面只有一个检索框（两块搜索重复，用户 09-26）", async () => {
  const inputs = await page.evaluate(() => ({
    panel: [...document.querySelectorAll("[data-online-panel] input")].map((el) => el.getAttribute("data-online-player-query") !== null ? "player" : (el.getAttribute("data-online-external-query") !== null ? "external" : el.type)),
    externalBox: document.querySelectorAll("[data-online-external-query]").length,
    externalButtons: document.querySelectorAll("[data-online-external-player], [data-online-external-event]").length,
    label: (document.querySelector("[data-online-player-search] .online-field")?.textContent || "").slice(0, 12),
  }));
  assert(inputs.panel.length === 1 && inputs.panel[0] === "player", `棋谱面应该只剩一个检索框，实际：${JSON.stringify(inputs.panel)}`);
  assert(inputs.externalBox === 0 && inputs.externalButtons === 0, `「跳转到来源网站」里不该再留第二个检索框与按钮：${JSON.stringify(inputs)}`);
  assert(inputs.label.includes("棋手或赛事"), `那一个框要说明两类都能查，实际标签：${inputs.label}`);
});

await step("同一个框也能按赛事查，结果标明是哪个来源的哪一届", async () => {
  const urlBefore = page.url();
  await page.fill("[data-online-player-query]", "世界连珠锦标赛");
  await page.click("[data-online-player-go]");
  await page.waitForSelector("[data-online-event-entry]", { timeout: 20_000 });
  assert(page.url() === urlBefore, "按赛事检索也不该把用户送出应用");
  const names = await page.locator("[data-online-event-entry]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-online-event-entry")));
  assert(names.some((name) => name.includes("世界连珠锦标赛")), `应列出命中的赛事：${names.join(" / ")}`);
  // 只命中一个赛事时界面会自动展开它（省一次点击），所以这里只在没展开时才点。
  if (!(await page.locator("[data-online-event-entry] [data-online-index-game]").count())) {
    await page.locator("[data-online-event-entry] .online-player-head").first().click();
  }
  await page.waitForSelector("[data-online-event-entry] [data-online-index-game]", { timeout: 20_000 });
  const row = await page.locator("[data-online-event-entry] .online-game-open").first().innerText();
  assert(/来源[：:]/.test(row), `每条结果要写清来自哪个站，实际：${row.replace(/\s+/g, " ")}`);
  assert(sourceRequests === 0 && renjuRequests === 0, "按赛事检索不该向任何第三方发请求（目录是打进包里的）");
});

await step("棋手检索第一步：搜「梅凡」在应用内列出这个棋手（不跳走）", async () => {
  const urlBefore = page.url();
  await page.fill("[data-online-player-query]", "梅凡");
  await page.click("[data-online-player-go]");
  await page.waitForSelector("[data-online-player-results]", { timeout: 20_000 });
  assert(page.url() === urlBefore, "点检索就把页面导航走了：这一步必须留在应用内");
  const names = await page.locator("[data-online-player]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-online-player")));
  assert(names.includes("梅凡"), `应列出棋手「梅凡」，实际：${names.join(" / ")}`);
  const status = await page.textContent("[data-online-player-status]");
  assert(/共 \d+ 位/.test(status), `应如实报目录规模，实际：${status}`);
});

await step("棋手检索第二步：展开后列出他的对局，每一条都是指向来源页的新标签外链", async () => {
  const player = page.locator('[data-online-player="梅凡"]');
  if (!(await page.locator('[data-online-player="梅凡"] [data-online-player-games]').count())) await player.locator(".online-player-head").click();
  await page.waitForSelector('[data-online-player="梅凡"] [data-online-player-games]', { timeout: 20_000 });
  const rows = await page.locator('[data-online-player="梅凡"] [data-online-index-game]').count();
  assert(rows > 0, "目录里这个人有对局，界面却一条都没列出来");
  const firstRow = await page.locator('[data-online-player="梅凡"] .online-game-open').first().innerText();
  assert(/来源[：:]/.test(firstRow), `棋手名下的每条对局也要标来源，实际：${firstRow.replace(/\s+/g, " ")}`);
  assert(/决赛 第一轮/.test(firstRow), `对局行要写清是哪一轮，实际：${firstRow.replace(/\s+/g, " ")}`);
  const links = await page.locator('[data-online-player="梅凡"] .online-game-open').evaluateAll((nodes) => nodes.slice(0, 4).map((node) => ({
    href: node.getAttribute("href") || "",
    target: node.getAttribute("target") || "",
    rel: node.getAttribute("rel") || "",
    text: (node.textContent || "").replace(/\s+/g, " ").slice(0, 60),
  })));
  for (const link of links) {
    assert(/^https:\/\/www\.ljrenju\.com\/news\//.test(link.href), `对局链接应指向来源站那一页：${link.href}`);
    assert(link.target === "_blank" && link.rel === "noreferrer", `对局链接应新标签打开：${JSON.stringify(link)}`);
  }
  // 读 href 与文本都不该产生请求（点了才由浏览器去开）。
  assert(sourceRequests === 0 && renjuRequests === 0, `列对局、读链接就联网了（励精 ${sourceRequests} / renju ${renjuRequests}）`);
});

await step("中文名靠别名表读成来源认的写法；查无此人时如实说明并给回退入口", async () => {
  await page.fill("[data-online-player-query]", "河田典人");
  await page.waitForTimeout(150);
  await page.click("[data-online-player-go]");
  await page.waitForTimeout(600);
  await page.fill("[data-online-player-query]", "不存在的名字zzz");
  await page.click("[data-online-player-go]");
  await page.waitForSelector("[data-online-player-miss]", { timeout: 20_000 });
  const miss = await page.textContent("[data-online-player-miss]");
  assert(miss.includes("不存在的名字zzz"), `未命中提示要带上用户输入：${miss}`);
  const fallback = await page.getAttribute("[data-online-player-fallback]", "href");
  assert(fallback.startsWith("https://www.renju.net/people/search?name="), `回退链接应是来源站的棋手检索页：${fallback}`);
  assert(decodeURIComponent(fallback.split("name=")[1]) === "不存在的名字zzz", `回退链接要带上用户输入：${fallback}`);
  // ⚠ 反向断言（用户 09-28 的 404 空棋盘）：棋手链接绝不能拼成 game/search?player1=<名字>，
  //    那个参数要的是站内数字 id，填名字会被站点判成 [404] Page not found。
  assert(!/game\/search\?player1=/.test(fallback), `棋手回退链接用错了形状（会 404）：${fallback}`);
  assert(await page.getAttribute("[data-online-player-fallback]", "target") === "_blank", "回退链接应新标签打开");
  assert(renjuRequests === 0, "拼回退链接不该请求 renju.net");
});

await step("搜到了人但目录没记局：如实说明，并把来源站入口直接递到手边", async () => {
  // 09-28 之前这一步用的是「中村茂」——那时目录里只有第 18 届世锦赛，他没被记到局。
  // 现在历届世锦赛补进来了，他有 21 局（正好是下面那条断言），所以这里换成目录里
  // 确实还没有对局的「艾显平」，验的仍然是「搜到人但没局时不让人对着空卡发呆」。
  const urlBefore = page.url();
  await page.fill("[data-online-player-query]", "艾显平");
  await page.click("[data-online-player-go]");
  await page.waitForSelector("[data-online-player-nogames]", { timeout: 20_000 });
  assert(page.url() === urlBefore, "这一步也不该把用户送出应用");
  const text = await page.textContent("[data-online-player-nogames]");
  assert(text.includes("艾显平"), `提示要指名这个人：${text}`);
  const href = await page.getAttribute("[data-online-player-empty-link]", "href");
  assert(href.startsWith("https://www.renju.net/people/search?name="), `应给一条来源站棋手检索链接：${href}`);
  assert(!/game\/search\?player1=/.test(href), `棋手链接用错了形状（player1 要数字 id，填名字会 404）：${href}`);
  assert((await page.locator("[data-online-index-game]").count()) === 0, "目录没记局时不该凭空列出对局");
  assert(renjuRequests === 0, "给链接不该请求 renju.net");
});

await step("搜老棋手要列得出具体届次（用户 09-28：「搜索棋手后还是没有具体赛事」）", async () => {
  await page.fill("[data-online-player-query]", "中村茂");
  await page.click("[data-online-player-go]");
  await page.waitForSelector('[data-online-player="中村茂"] [data-online-player-games]', { timeout: 20_000 });
  const card = await page.locator('[data-online-player="中村茂"]').evaluate((node) => ({
    count: node.querySelector(".online-player-count")?.textContent || "",
    events: [...node.querySelectorAll(".online-player-event-head b")].map((element) => element.textContent),
    games: node.querySelectorAll("[data-online-index-game]").length,
    links: [...node.querySelectorAll(".online-player-link")].map((element) => element.getAttribute("href") || ""),
  }));
  // 展开卡片后默认列出他最近那一届；届次分组要在，且每组都写着是哪一届
  assert(/\d+ 局/.test(card.count), `棋手行上要写他有多少局，实际：${card.count}`);
  assert(card.events.length >= 2, `按届分组应至少列出两届，实际：${card.events.join(" / ")}`);
  assert(card.events.every((name) => /世界连珠锦标赛/.test(name || "")), `分组标题要是完整届名：${card.events.join(" / ")}`);
  assert(card.games > 0, "展开后一条对局都没列出来");
  // 每条入口都必须是核实过的形状（game/search?player1=<名字> 会被站点判 404）
  assert(card.links.length >= 3, `三条入口没给全：${card.links.join(" / ")}`);
  for (const href of card.links) {
    assert(/^https:\/\/[^\s]+$/.test(href), `入口不是完整地址：${href}`);
    assert(!/game\/search\?player1=/.test(href), `入口用了会 404 的旧形状：${href}`);
  }
  // 点某一届的标题能换展开的那一届（分组不是摆设）
  const before = await page.locator('[data-online-player="中村茂"] [data-online-index-game]').count();
  await page.locator('[data-online-player="中村茂"] .online-player-event-head').last().click();
  await page.waitForTimeout(250);
  const after = await page.locator('[data-online-player="中村茂"] [data-online-index-game]').count();
  assert(after > 0 && after !== before, `切换届次后对局数没变化（${before} → ${after}）`);
});

await step("在线面不再把第三方内容装进应用：没有取回按钮、没有勾选框与下载", async () => {
  const face = await page.evaluate(() => ({
    preview: document.querySelectorAll("[data-online-preview]").length,
    download: document.querySelectorAll("[data-online-download]").length,
    selectionBar: document.querySelectorAll("[data-online-selection-bar]").length,
    checkbox: document.querySelectorAll(".online-game-row input[type=checkbox]").length,
    puzzleManifest: document.querySelectorAll("[data-puzzle-manifest]").length,
    puzzleSearch: document.querySelectorAll("[data-puzzle-search]").length,
    puzzleDownload: document.querySelectorAll("[data-puzzle-download]").length,
    externalBlocks: document.querySelectorAll(".online-external").length,
  }));
  assert(face.preview === 0, `不该再有「在线查看」（取回本应用看局面）：${face.preview} 个`);
  assert(face.download === 0 && face.selectionBar === 0 && face.checkbox === 0, `在线棋谱不该有下载/批量/勾选：${JSON.stringify(face)}`);
  assert(face.puzzleManifest === 0 && face.puzzleSearch === 0 && face.puzzleDownload === 0, `题库面不该再有自建清单/下载：${JSON.stringify(face)}`);
  assert(face.externalBlocks === 1, `跳转入口区应只有一块，实际 ${face.externalBlocks}`);
});

await step("励精浏览仍在（赛事 → 轮次），列出的每一局都是点了才跳的外链", async () => {
  await page.click("[data-online-events]");
  await page.waitForSelector("[data-online-events-body]", { timeout: 20_000 });
  await page.waitForSelector("[data-online-event]", { timeout: 25_000 });
  assert(sourceRequests >= 1, "展开「最近赛事」才该去取索引页（用户点出来的）");
  const before = sourceRequests;
  await page.locator("[data-online-event] .online-event-head").first().click();
  await page.waitForSelector("[data-online-event-games] .online-game-open", { timeout: 25_000 });
  const links = await page.locator("[data-online-event-games] .online-game-open").evaluateAll((nodes) => nodes.slice(0, 3).map((node) => ({
    href: node.getAttribute("href") || "", target: node.getAttribute("target") || "",
  })));
  assert(links.length > 0, "轮次里没列出对局");
  for (const link of links) {
    assert(/^https:\/\/www\.ljrenju\.com\/news\//.test(link.href), `行链接应指向来源站该页：${link.href}`);
    assert(link.target === "_blank", "行链接应新标签打开");
  }
  // 点开一轮最多两页：赛事页只是各轮的目录（内存里缓存一次），轮次页才是棋谱。
  assert(sourceRequests - before <= 2, `点开一轮最多取赛事目录 + 轮次页两页，实际取了 ${sourceRequests - before} 次`);
});

await step("界面文案不讲内部合规理由（只说能做什么）", async () => {
  const text = await page.textContent("[data-online-panel]");
  const leaked = ["robots", "条款", "抓取", "授权", "只给链接", "停用"].filter((word) => text.includes(word));
  assert(leaked.length === 0, `界面出现了内部理由：${leaked.join("、")}`);
});

await step("题库面是习题站导航：卡片直达各站习题页，筛选全在本地", async () => {
  await page.click('[data-online-content="puzzles"]');
  await page.waitForSelector("[data-online-puzzle-dir]", { timeout: 20_000 });
  const cards = await page.locator("[data-puzzle-site-open]").evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute("href") || "",
    target: node.getAttribute("target") || "",
    action: (node.querySelector(".online-game-action")?.textContent || "").replace(/\s+/g, " ").trim(),
    what: (node.querySelector(".online-puzzle-main small")?.textContent || "").replace(/\s+/g, " ").trim(),
  })));
  assert(cards.length >= 3, `目录应有多家站点，实际 ${cards.length}`);
  const cardFill = await page.evaluate(() => [...document.querySelectorAll(".online-puzzle-row .online-puzzle-open")].map((link) => {
    const row = link.closest(".online-puzzle-row").getBoundingClientRect();
    const box = link.getBoundingClientRect();
    return { ratio: box.width / Math.max(1, row.width - 20), h: Math.round(box.height) };
  }));
  assert(cardFill.length > 0 && Math.min(...cardFill.map((item) => item.ratio)) >= 0.9, `习题卡片的链接没吃满卡片宽（最小 ${(Math.min(...cardFill.map((i) => i.ratio)) * 100).toFixed(0)}%），文字会挤成一团`);
  assert(Math.min(...cardFill.map((item) => item.h)) >= 40, `习题卡片高 ${Math.min(...cardFill.map((item) => item.h))}px，站名+说明+题型三行放不下`);
  for (const card of cards) {
    assert(/^https?:\/\/[^\s]+$/.test(card.href) && !/ljrenju|renju\.net/.test(card.href), `卡片应指向习题站：${card.href}`);
    assert(card.target === "_blank", `卡片应新标签打开：${card.href}`);
    assert(/打开/.test(card.action), `卡片要写清点下去干什么：${JSON.stringify(card)}`);
    assert(card.what.length > 6, `卡片要写清里面有什么题：${JSON.stringify(card)}`);
  }
  const credit = await page.textContent("[data-puzzle-credit]");
  assert(/核实于 \d{4}-\d{2}-\d{2}/.test(credit) && /版权/.test(credit), `目录要标核实日期与版权口径：${credit}`);
  const requestsBefore = [sourceRequests, githubRequests, renjuRequests];
  await page.fill("[data-puzzle-query]", "每日一练");
  await page.waitForTimeout(250);
  const filtered = await page.locator("[data-puzzle-site-open]").count();
  assert(filtered >= 1 && filtered < cards.length, `本地关键词筛选没生效：${filtered} / ${cards.length}`);
  await page.fill("[data-puzzle-query]", "");
  await page.click('[data-puzzle-tag="VCF"]');
  await page.waitForTimeout(250);
  assert(await page.locator("[data-puzzle-site-open]").count() >= 1, "按题型筛选后应有结果");
  assert(sourceRequests === requestsBefore[0] && githubRequests === requestsBefore[1] && renjuRequests === requestsBefore[2], "题库面的筛选不该发任何请求");
});

await step("切回棋谱面不重置请求预算，也不新增第三方请求", async () => {
  const before = [sourceRequests, githubRequests, renjuRequests];
  await page.click('[data-online-content="games"]');
  await page.waitForSelector("[data-online-player-search]", { timeout: 20_000 });
  await page.waitForTimeout(400);
  assert(sourceRequests === before[0] && githubRequests === before[1] && renjuRequests === before[2], "切页签不该产生请求");
});

await step("renju.net 整轮一次都没被请求过（来源已按条款停用）", async () => {
  assert(renjuRequests === 0, `renju.net 被请求了 ${renjuRequests} 次`);
  assert(githubRequests === 0, `自建题库通道被唤醒了：GitHub 的目录/清单请求 ${githubRequests} 次（这一版界面里没有那条通道；更新检查不在此列）`);
});

await step("窄屏（412）下在线面不横向溢出，行高不压字", async () => {
  const metrics = await page.evaluate(() => {
    const wrap = document.querySelector(".online-library");
    const rows = [...document.querySelectorAll("[data-online-index-game], .online-game-row")];
    // 整行链接必须吃满这一行：上一版遗留的 `.online-game-row>a{width:32px}` 会把所有文字
    // 挤进 32px 见方（用户看到的「字都堆在一块」就是这个），所以按比例断言而不是只看溢出。
    const fills = [...document.querySelectorAll(".online-game-row .online-game-open")].map((link) => {
      const row = link.closest(".online-game-row").getBoundingClientRect();
      const box = link.getBoundingClientRect();
      return { ratio: box.width / Math.max(1, row.width - 20), h: Math.round(box.height) };
    });
    return {
      overflowX: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
      minRowHeight: rows.length ? Math.min(...rows.map((row) => row.getBoundingClientRect().height)) : 0,
      rowCount: rows.length,
      linkCount: fills.length,
      minFillRatio: fills.length ? Math.min(...fills.map((item) => item.ratio)) : 0,
      minLinkHeight: fills.length ? Math.min(...fills.map((item) => item.h)) : 0,
    };
  });
  assert(metrics.overflowX <= 2, `在线面横向溢出 ${metrics.overflowX}px，右侧内容会被推出屏幕`);
  assert(metrics.linkCount > 0, "没量到整行链接（前面步骤跑歪了）");
  assert(metrics.minFillRatio >= 0.9, `整行链接没吃满行宽（最小 ${(metrics.minFillRatio * 100).toFixed(0)}%），文字会被挤成一团`);
  assert(metrics.minLinkHeight >= 34, `链接高 ${metrics.minLinkHeight}px，黑白/赛事两行文字放不下`);
  assert(metrics.minRowHeight > 34, `行被压扁了（${metrics.minRowHeight}px），文字会挤在一起`);
});

await step("设置页的代理地址可填写并持久化", async () => {
  await page.click('.bottom-nav button:has-text("设置")');
  await page.waitForSelector(".settings-page", { timeout: 20_000 });
  await page.getByLabel("搜索设置").fill("在线棋谱");
  const proxy = page.locator("[data-setting-online-proxy]");
  await proxy.waitFor({ state: "visible", timeout: 20_000 });
  assert((await proxy.inputValue()) === "", "代理地址默认应为空（安卓端根本不需要它）");
  await proxy.fill("https://proxy.example/?url={url}");
  await proxy.blur();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
  await page.click('.bottom-nav button:has-text("设置")');
  await page.getByLabel("搜索设置").fill("在线棋谱");
  const persisted = page.locator("[data-setting-online-proxy]");
  await persisted.waitFor({ state: "visible", timeout: 20_000 });
  assert((await persisted.inputValue()) === "https://proxy.example/?url={url}", "代理地址没有持久化");
  await persisted.fill("");
  await persisted.blur();
  await page.waitForTimeout(200);
});

await step("「其他」面是网盘资料：卡片是外链、提取码上屏、复制拿走地址，全程零请求", async () => {
  const before = [sourceRequests, githubRequests, renjuRequests];
  await page.click('.bottom-nav button:has-text("棋谱库")');
  await page.waitForSelector(".library-segment", { timeout: 20_000 });
  await page.click('[data-library-tab="online"]');
  await page.waitForSelector('[data-online-content="other"]', { timeout: 20_000 });
  await page.click('[data-online-content="other"]');
  await page.waitForSelector("[data-online-other]", { timeout: 20_000 });
  const cards = await page.locator("[data-other-open]").evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute("href") || "",
    target: node.getAttribute("target") || "",
    code: (node.querySelector("[data-other-code]")?.textContent || "").replace(/\s+/g, " ").trim(),
    note: (node.querySelector(".online-puzzle-meta")?.textContent || "").replace(/\s+/g, " ").trim(),
  })));
  assert(cards.length >= 2, `「其他」至少两条网盘资料，实际 ${cards.length} 条`);
  assert(cards.some((card) => card.href.includes("pan.baidu.com/s/")), "缺百度网盘那条");
  assert(cards.some((card) => card.href.includes("pan.quark.cn/s/")), "缺夸克网盘那条");
  for (const card of cards) {
    assert(card.target === "_blank", "网盘卡片应当新标签打开");
    assert(card.note.length > 6, "每张卡片要有一行说明（里面是什么、要不要登录）");
  }
  assert(cards.some((card) => /提取码\s*r7av/.test(card.code)), "百度网盘那条要把提取码显示在卡片上");
  // 排版两条（都是 412 宽截图里真看到过的毛病）：三颗页签要在同一行；
  // 行尾「打开」与「复制」两颗挨着，高度差超过 2px 就是肉眼可见的错位。
  const tabTops = await page.locator("[data-online-content]").evaluateAll((nodes) => nodes.map((node) => ({
    label: (node.textContent || "").trim(),
    top: Math.round(node.getBoundingClientRect().top),
  })));
  assert(tabTops.length === 3, `「在线」面应有棋谱/题库/其他三颗页签，实际 ${tabTops.map((tab) => tab.label).join(" / ")}`);
  assert(new Set(tabTops.map((tab) => tab.top)).size === 1, `三颗页签要排在同一行，实际 ${tabTops.map((tab) => `${tab.label}:${tab.top}`).join(" ")}`);
  const pair = await page.locator("[data-other-resource]").first().evaluate((row) => ({
    open: Math.round(row.querySelector(".online-game-action")?.getBoundingClientRect().height || 0),
    copy: Math.round(row.querySelector("[data-other-copy]")?.getBoundingClientRect().height || 0),
  }));
  assert(Math.abs(pair.open - pair.copy) <= 2, `行尾两颗高度差太大：打开 ${pair.open}px vs 复制 ${pair.copy}px`);
  assert(pair.copy >= 44 && pair.open >= 44, `两颗都要守住 44px 热区：打开 ${pair.open} / 复制 ${pair.copy}`);
  // 「复制」拿走的是「地址 + 换行 + 提取码」，粘到群里就能直接用
  await page.click("[data-other-copy=\"baidu-pan\"]");
  await page.waitForFunction(() => (document.querySelector("[data-other-copy=\"baidu-pan\"]")?.textContent || "").includes("已复制"), null, { timeout: 10_000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(/https:\/\/pan\.baidu\.com\/s\/\S+/.test(clip) && clip.includes("提取码: r7av"), `剪贴板里不是该有的样子：${JSON.stringify(clip.slice(0, 80))}`);
  assert(sourceRequests === before[0] && githubRequests === before[1] && renjuRequests === before[2],
    `「其他」面发了请求（励精 +${sourceRequests - before[0]} / github +${githubRequests - before[1]} / renju +${renjuRequests - before[2]}），这一面只许给链接`);
});

await browser.close();

if (failures.length) {
  console.error(`\n在线棋谱库门禁失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`\n在线门禁通过：入口常驻（三个界面、设置里无开关）、打开面板零第三方请求、棋手检索两步式（应用内出棋手与对局 → 点了才开浏览器新标签）、未命中如实说并给回退检索、在线面不取回不下载、题库面是逐站核实过的习题站导航（筛选全本地）、「其他」面是网盘外链＋提取码上屏＋复制可粘（同样零请求）、renju.net 与 GitHub 整轮 0 请求。`);
