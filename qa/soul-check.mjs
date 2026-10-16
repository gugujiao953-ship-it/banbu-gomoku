/**
 * 棋魂端到端探针（2026-10-09）。
 *
 * 用户这一轮的要求逐条验：
 *  ① 入口在**对弈页标题行、和战绩/成就同一行、且在更左边**，形态是「图案 + 数量」；
 *  ② **点图案或点数字都能进**说明页（所以整个徽章必须是一个按钮）；
 *  ③ 数字过万用 w、过亿用 e（含进位边界）；
 *  ④ 说明页有：魂火版面 + 说明 + **最近 100 条收支**（2026-10-10 由 50 提到 100）；
 *  ⑤ 棋魂**不是只有成就给**——来源表要在页面上列出来，且日常行为（对弈取胜）真的入账；
 *  ⑥ 点徽章不会误触发别的（真能跳转，不是装饰）。
 *
 * 跑法：先起 preview（4321），再 `node qa/soul-check.mjs`。
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
const qaUrl = new URL(BASE);
qaUrl.searchParams.set("qa", "1");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(qaUrl.href, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(800);

/**
 * 去掉可能存在的临时诊断条（`<pre data-tempdiag>`，z-index 99999、铺在视口底部）。
 * 它**不是本功能的一部分**，而是别的会话临时插在 `main.tsx` 里的排查工具：
 * 铺在底部会拦住我的点击（实测报 "intercepts pointer events"）。
 * 这里只在自己这条探针里把它移除，**不去改别人的源文件**。
 */
const installTempDiagGuard = () => page.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  // ⚠ 那根诊断条是 **load 后 3 秒**才插进来的（main.tsx 里一个 setTimeout(3000)），
  // 所以"进来删一次"不够 —— 用 MutationObserver 常驻，插进来就立刻移除。
  // 只作用于这条探针自己的页面，**不改别人的源文件**。
  new MutationObserver(strip).observe(document.body, { childList: true, subtree: true });
});
await installTempDiagGuard();

// ── 1. 徽章位置：对弈页标题行，且在战绩左边 ────────────────────────
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
const badge = page.locator("[data-soul-badge]");
check("对弈页标题行有棋魂徽章", await badge.count() > 0);

const geometry = await page.evaluate(() => {
  const soul = document.querySelector("[data-soul-badge]");
  const stats = document.querySelector("[data-duel-stats]");
  const ach = document.querySelector("[data-duel-achievements]");
  if (!soul) return null;
  const box = (node) => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  const flame = soul.querySelector("svg");
  const number = soul.querySelector("[data-soul-badge-count]");
  return {
    soul: box(soul), stats: box(stats), ach: box(ach),
    flame: box(flame), number: box(number),
    inTitleRow: Boolean(soul.closest(".duel-title")),
    sameRowAsStats: stats ? Math.abs(box(soul).y - box(stats).y) < 12 : null,
    leftOfStats: stats ? box(soul).x < box(stats).x : null,
    threeOnOneRow: stats && ach ? Math.abs(box(stats).y - box(ach).y) < 12 : null,
  };
});
check("徽章在标题行内", Boolean(geometry?.inTitleRow));
check("徽章与战绩、成就**同一行**", Boolean(geometry?.sameRowAsStats) && Boolean(geometry?.threeOnOneRow));
check("棋魂在战绩**更左边**", Boolean(geometry?.leftOfStats), geometry ? `soul.x=${Math.round(geometry.soul.x)} < stats.x=${Math.round(geometry.stats.x)}` : "");
check("形态是「图案 + 数量」（两者都在）", Boolean(geometry?.flame) && Boolean(geometry?.number));

// ── 2. 点图案能进 / 点数字也能进 ───────────────────────────────────
const clickAndVerify = async (target, label) => {
  for (const close of await page.locator(".sheet-head button, [aria-label=\"关闭\"]").all()) {
    // 关掉可能开着的 sheet
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await target.click();
  await page.waitForSelector("[data-soul-panel]", { timeout: 8000 }).catch(() => {});
  const opened = await page.locator("[data-soul-panel]").count() > 0;
  check(label, opened);
  return opened;
};
// 图案区域（svg 的左上角）
await clickAndVerify(page.locator("[data-soul-badge] svg").first(), "点**图案**能进棋魂说明页");
// 数字区域
await clickAndVerify(page.locator("[data-soul-badge-count]").first(), "点**数字**能进棋魂说明页");

// ── 3. 说明页三块内容 ──────────────────────────────────────────────
check("说明页有魂火版面", await page.locator(".soul-hero svg").count() > 0);
const heroText = await page.locator("[data-soul-hero-balance]").first().textContent().catch(() => null);
check("版面显示余额数字", /^\d/.test((heroText || "").trim()), `读到「${heroText}」`);
const explains = await page.locator(".soul-explain").count();
check("说明页有「棋魂是什么」说明", explains > 0);
const earnRows = await page.locator("[data-soul-earn]").count();
check("说明页列出**怎么攒**（多渠道来源，不只成就）", earnRows >= 7, `${earnRows} 条来源`);

// ── 3b. 两个版面（用户 10-09 第十二轮）────────────────────────────────
// 「搞成两个版面，一个是说明，一个是明细……切换按钮放在累计消耗，累计获得的下面，
//   就是上面部分是共用，下面部分才分开放」
//
// 上半共用 = 魂火版面 + 累计两格（切换按钮必须排在它们**下面**，这是用户点名的位置）；
// 下半 = 说明 / 明细 二选一。
check("有「说明 / 明细」两个版面按钮",
  await page.locator("[data-soul-tab]").count() === 2);
check("默认停在说明版面",
  await page.locator("[data-soul-pane='guide']").count() === 1
  && await page.locator("[data-soul-pane='detail']").count() === 0);

// 切换按钮在累计两格下面（上半共用、下面才分开放）
const tabBelowTotals = await page.evaluate(() => {
  const tabs = document.querySelector(".soul-tabs");
  const totals = document.querySelector(".soul-totals");
  const hero = document.querySelector(".soul-hero");
  if (!tabs || !totals || !hero) return null;
  return {
    belowTotals: tabs.getBoundingClientRect().top >= totals.getBoundingClientRect().bottom - 1,
    belowHero: tabs.getBoundingClientRect().top > hero.getBoundingClientRect().top,
  };
});
check("切换按钮排在「累计获得 / 累计消耗」下面",
  Boolean(tabBelowTotals?.belowTotals && tabBelowTotals?.belowHero),
  tabBelowTotals ? `在累计下面=${tabBelowTotals.belowTotals}、在魂火下面=${tabBelowTotals.belowHero}` : "");

// 上半共用：切到明细后，魂火版面与累计两格**仍然在**
await page.locator("[data-soul-tab='detail']").click();
await page.waitForTimeout(300);
check("切到明细后，上半（魂火 + 累计）仍然共用显示",
  await page.locator(".soul-hero").count() === 1
  && await page.locator(".soul-totals").count() === 1);
check("切到明细后，说明版面的三段收起来了",
  await page.locator(".soul-explain").count() === 0
  && await page.locator(".soul-earn").count() === 0
  && await page.locator(".soul-spend").count() === 0);
check("明细版面有最近收支列表", await page.locator("[data-soul-history]").count() > 0);
const historyRows = await page.locator("[data-soul-history-list] li").count();
check("收支条目数量合理（上限 100）", historyRows <= 100, `实测 ${historyRows} 条`);

/**
 * **上限是真的在限**（2026-10-10 新增）。
 *
 * 上面那条只验"不超过 100"，而它**永远为真**——哪怕列表根本不截断
 * （只差一个 `slice` 就变成渲染 1000 条），断言照样绿。
 * 用户这次报的正是这类观感问题（"说是最近 50 个，其实好像无限制"），
 * 所以补一条**真的把账本灌过上限**、再数渲染条数的断言：
 * 灌 150 条 → 列表必须**恰好 100**（既不少也不多）。
 *
 * ⚠ 灌之前先把原账本**存下来**（不是删掉）——后面「备份应入账 +4」那一段
 * 要拿灌入前的余额做基准，直接把账本删了会让它的 before/after 变得没意义。
 */
const originalLedger = await page.evaluate(() => localStorage.getItem("banbu-soul-ledger-v1"));
const seeded = await page.evaluate(() => {
  const key = "banbu-soul-ledger-v1";
  const now = Date.now();
  const entries = Array.from({ length: 150 }, (_, i) => ({
    id: `qa-seed-${i}`,
    at: now - (150 - i) * 1000,
    amount: 1,
    reason: "manual",
    detail: `QA 灌入第 ${i + 1} 条`,
    token: `qa-seed-token-${i}`,
  }));
  localStorage.setItem(key, JSON.stringify(entries));
  return entries.length;
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
// ⚠ reload 之后 App 回到**默认那一格**（棋盘/打谱），而徽章住在对弈页的标题行里
// ——必须先把底部导航切到「对弈」再点，否则这里会等一个永远不出现的元素
// （实测：`locator.click` 30 秒超时，报 "waiting for [data-soul-badge]"）。
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
await page.locator("[data-soul-badge]").first().click();
await page.waitForSelector("[data-soul-panel]", { timeout: 8000 }).catch(() => {});
await page.locator("[data-soul-tab='detail']").click();
await page.waitForTimeout(400);
const cappedRows = await page.locator("[data-soul-history-list] li").count();
const totalLabel = (await page.locator("[data-soul-history] h3 small").first().textContent().catch(() => "")) || "";
check("灌入 150 条后，列表被**恰好截到 100 条**", cappedRows === 100, `灌入 ${seeded} 条、渲染 ${cappedRows} 条`);
check("标题如实写出「共 N 条记录」= 账本总数",
  totalLabel.includes("150"),
  `标题「${totalLabel.trim()}」`);

// 收尾：**还原**灌入前的账本（不是删掉）——后面的断言要接着用真实账本。
await page.evaluate((raw) => {
  if (raw === null) localStorage.removeItem("banbu-soul-ledger-v1");
  else localStorage.setItem("banbu-soul-ledger-v1", raw);
}, originalLedger);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
await page.locator("[data-soul-badge]").first().click();
await page.waitForSelector("[data-soul-panel]", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);

// 切回说明：明细收起、说明回来（两个版面是互斥的）
await page.locator("[data-soul-tab='guide']").click();
await page.waitForTimeout(300);
check("切回说明后，明细版面收起来",
  await page.locator("[data-soul-history]").count() === 0
  && await page.locator(".soul-explain").count() === 1);

// ── 4. 棋魂不只来自成就：走一次**真实路径**（点魂火 → 应入账）──────────
//
// ⚠ 这一条**原来走的是"设置 → 一键备份"**（那会给 `study` 来源）。
// 但 2026-10-11 用户在评审稿里把 `study` / `review` 从来源表删掉了，
// 代码里那两处结算点随之断开（见 soul-economy.ts 顶部的对照表）——
// 于是备份不再发棋魂，这条断言失去依托。
//
// 换成**点魂火**（`manual` 来源）：它是稳定可复现的真实路径
// （开说明页 → 点一下），而且**确实不是成就** —— 断言的意图（
// "棋魂不止来自成就"）一字未改，只是换了个还在发钱的入口。
/** 读账本（本文件此处的局部读法：直接读那个键，不依赖别处的 helper）。 */
const readLedger = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); } catch { return []; }
});
const before = await readLedger();
const beforeSum = before.reduce((sum, item) => sum + (item.amount || 0), 0);
// 说明页此刻已经开着（上面那一节刚点进来过），直接点魂火
const tapButton = page.locator("[data-soul-tap]").first();
if (await tapButton.count()) {
  for (let i = 0; i < 3; i += 1) await tapButton.click({ force: true });
  await page.waitForTimeout(800);
}
const ledgerAfterTaps = await readLedger();
const after = ledgerAfterTaps.reduce((sum, item) => sum + (item.amount || 0), 0);
const reasons = [...new Set(ledgerAfterTaps.map((item) => item.reason))];

check("棋魂有**成就是外**的来源（走真实路径入账）", after > beforeSum, `${beforeSum} → ${after}`);
check("账本里出现成就以外的 reason", reasons.some((item) => item !== "achievement"), `reasons=${reasons.join(",")}`);

// ── 5. 收支列表现在应该有内容了（回对弈页开说明页看）──────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
const badgeText = (await page.locator("[data-soul-badge-count]").first().textContent().catch(() => "")) || "";
check("徽章数字已渲染", badgeText.trim().length > 0, `显示「${badgeText}」`);
await page.locator("[data-soul-badge]").first().click();
await page.waitForSelector("[data-soul-panel]", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(500);
// 收支流水现在在**明细**版面，要先切过去（第十二轮改成两版面之后）
await page.locator("[data-soul-tab='detail']").click();
await page.waitForTimeout(300);
const historyRowsAfter = await page.locator("[data-soul-history-list] li").count();
check("明细版面的最近收支有内容", historyRowsAfter > 0, `${historyRowsAfter} 条`);
check("收支条目带来源/时间标签", await page.locator("[data-soul-history-list] li small").count() > 0);

check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));

// ── 6b. 魂火图案确实是黑白多舌火焰（不是旧的单色水滴）──────────────────
const flameInfo = await page.evaluate(() => {
  const svg = document.querySelector("[data-soul-badge] svg, [data-soul-panel] svg");
  if (!svg) return null;
  const paths = svg.querySelectorAll("path").length;
  const stops = [...svg.querySelectorAll("linearGradient stop")].map((s) => s.getAttribute("stop-color"));
  const cores = svg.querySelectorAll("radialGradient").length;
  return { paths, stops, cores, viewBox: svg.getAttribute("viewBox") };
});
// 判据随造型一起改：现在照成熟火焰图标的构造法做成**一条连续路径**（外轮廓自带
// 内凹成形），芯由这条路径缩放形变而来、内缘另加高光 —— 所以不再是"多块图形叠加"。
check("魂火是连续轮廓 + 形变芯（不是单一简单形状）", flameInfo !== null && flameInfo.paths >= 2, flameInfo ? `${flameInfo.paths} 条 path` : "");
// 用户 10-09 第三次反馈的核心：「里面的芯应该像是外面大形状的一种形变」。
// 判据：同一段 `d` 在 SVG 里出现两次，且其中一次带 transform（= 由同一条路径缩放派生）。
const coreDerived = await page.evaluate(() => {
  const svg = document.querySelector("[data-soul-badge] svg, [data-soul-panel] svg");
  if (!svg) return null;
  const paths = [...svg.querySelectorAll("path")];
  const byD = new Map();
  for (const node of paths) { const d = node.getAttribute("d") || ""; if (d) byD.set(d, (byD.get(d) || 0) + 1); }
  const shared = [...byD.values()].some((count) => count >= 2);
  const withTransform = paths.some((node) => node.getAttribute("transform"));
  return { shared, withTransform };
});
check("芯是外轮廓的形变（同一条路径 + transform 缩放）",
  Boolean(coreDerived && coreDerived.shared && coreDerived.withTransform),
  coreDerived ? `${coreDerived.shared ? "共用同一路径" : "芯与外形不同源"}、transform=${coreDerived.withTransform}` : "");

// 用户 10-09 第六轮：「里面的一个轮廓太粗了，还和外面那个轮廓碰到了」。
// 用户 10-09 第七轮改了设计：**去掉芯的描边环**，只留一个渐变的火焰形芯
// （原话：「要么直接给轮廓去掉，留下一个渐变的内部的火焰形状的芯」）。
//
// 所以原来那两条"环宽 ≤1.2""描边不超间隙"的判据**已经失效**——现在没有环了。
// 换成的判据是这套设计真正的要点：
//  ① **渲染出来的 path 里不许有描边**（除了外轮廓那圈固定的反色发丝边）——
//     芯若又被加回描边，就说明"两个轮廓"又回来了（用户为此提了三轮）；
//  ② 芯必须仍在、且**只用渐变**（fill 指向渐变 url），形状由明暗交代而不靠边线。
const coreFit = await page.evaluate(() => {
  const svg = document.querySelector("[data-soul-badge] svg, [data-soul-panel] svg");
  if (!svg) return null;
  const live = [...svg.querySelectorAll("path")].filter((n) => !n.closest("defs"));
  const outer = live.find((n) => !n.getAttribute("transform"));
  const core = live.find((n) => n.getAttribute("transform"));
  if (!outer || !core) return null;
  const t = core.getAttribute("transform") || "";
  const m = /translate\(([-\d.]+) ([-\d.]+)\)\s*scale\(([-\d.]+) ([-\d.]+)\)/.exec(t);
  if (!m) return null;
  const [ax, sy] = [+m[1], +m[4]];
  const ob = outer.getBBox();
  return {
    // 芯底边到外焰底边的距离（按同一锚点缩放换算）——仍然要在，否则芯贴边
    gapBottom: +((ob.y + ob.height) - (20 + ((ob.y + ob.height) - 20) * sy)).toFixed(2),
    // 芯那层有没有描边（不该有）
    coreStroke: core.getAttribute("stroke"),
    coreFill: core.getAttribute("fill") || "",
    ax,
  };
});
check("芯没有描边（去掉环之后不该再有第二个轮廓）",
  Boolean(coreFit && coreFit.coreStroke === null),
  coreFit ? `stroke=${coreFit.coreStroke}` : "");
check("芯只用渐变成形（fill 指向 gradient）",
  Boolean(coreFit && /^url\(#/.test(coreFit.coreFill)),
  coreFit ? `fill=${coreFit.coreFill}` : "");
check("芯仍与外轮廓留出余地（按 .58/.66 缩放的换算值）",
  Boolean(coreFit && coreFit.gapBottom > 1),
  coreFit ? `底 ${coreFit.gapBottom}（viewBox 单位）` : "");

// 用户 10-09 第四轮：「这个怎么还有两条无关的线条呢，去掉那两个无关的白色线条吧」。
// 那两条是我加的装饰性内缘弧线（跟火焰轮廓无关）。反向钉住：**所有 path 的 `d` 只能是
// 同一条**（外轮廓那条）——出现第二种 `d` 就说明又混进了装饰线条。
const strayPaths = await page.evaluate(() => {
  const svg = document.querySelector("[data-soul-badge] svg, [data-soul-panel] svg");
  if (!svg) return null;
  // ⚠ 只数**渲染出来的** path：`<defs>` 里的 clipPath 也含 `<path>`，但那是定义、
  // 不画在图上（阴阳方案的分界线就放在那儿，默认方案用不到它）。
  // 第一版没排除 defs，把两条 clipPath 误判成"装饰线条"。
  const defs = new Set([...svg.querySelectorAll("defs path")]);
  const ds = [...svg.querySelectorAll("path")]
    .filter((node) => !defs.has(node))
    .map((node) => (node.getAttribute("d") || "").trim())
    .filter(Boolean);
  const kinds = [...new Set(ds)];
  const shortOnes = kinds.filter((d) => d.length < 80);
  return { kinds: kinds.length, rendered: ds.length, shortCount: shortOnes.length, sample: shortOnes[0]?.slice(0, 40) ?? null };
});
check("没有多余的装饰线条（所有 path 段都必须是外轮廓那条）",
  Boolean(strayPaths && strayPaths.kinds === 1),
  strayPaths ? `path 段种类=${strayPaths.kinds}${strayPaths.shortCount ? `（其中 ${strayPaths.shortCount} 段是短线：${strayPaths.sample}…）` : ""}` : "");
// 黑白混色的判据：渐变里必须**同时**出现足够暗与足够亮的色停。
// 用真实亮度而不是"十六进制开头字母"——上一版按 `^#[c-f]` 判，把 #b3bfc7
// （视觉上明显的浅灰蓝）判成了"不算浅色"，是探针写错不是产品错。
const toLum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const lums = (flameInfo?.stops || []).map(toLum).filter((v) => v !== null);
const darkest = lums.length ? Math.min(...lums) : null;
const lightest = lums.length ? Math.max(...lums) : null;
check("魂火是黑白混色（渐变里同时有明显暗部与亮部）",
  darkest !== null && lightest !== null && darkest <= 40 && lightest >= 150,
  flameInfo ? `${flameInfo.stops.join(" → ")}（亮度 ${darkest === null ? "?" : Math.round(darkest)} → ${lightest === null ? "?" : Math.round(lightest)}）` : "");
check("魂火带内层发光（radialGradient）", Boolean(flameInfo && flameInfo.cores >= 1), flameInfo ? `${flameInfo.cores} 个` : "");

// ── 7. 说明页正文不许漏出 Markdown 星号（实测踩过：写成 **粗体** 直接显示了）──
const asteriskLeak = await page.evaluate(() => {
  const panel = document.querySelector("[data-soul-panel]");
  if (!panel) return null;
  const text = panel.innerText || "";
  return { hasStars: text.includes("**"), sample: (text.match(/\*\*[^*]{1,20}\*\*/) || [""])[0] };
});
check("说明页正文没有漏出 ** 星号", asteriskLeak !== null && !asteriskLeak.hasStars, asteriskLeak?.sample || "");

// ── 8. 棋魂获得提示条的样式（用户 10-09 第三次反馈抓到的两处）──────────
// ① 它必须和兄弟元素一样**淡入上浮**，不能一进画面就杵在那儿；
// ② 底色必须够浅——黑焰落在深底上会把三个火舌全丢掉。
const gainStyle = await page.evaluate(() => {
  // 造一个提示条（真实 class，真实 CSS）
  const node = document.createElement("div");
  node.className = "soul-gain";
  node.setAttribute("data-soul-gain", "9");
  // ⚠ 这里必须用**当前**的标记结构（2026-10-10 改成游戏风之后是"图标 + 大数字 + 来源"；
  // 第八轮又去掉了数字后面那两个字 ⇒ 现在是三段，不再有 `<em>棋魂</em>`）。
  // 用旧结构注入的话，探针量的是"一个页面上不存在的形状"的样式，全部断言都成了摆设。
  node.innerHTML = '<span class="soul-gain-flame"><svg class="soul-flame" width="34" height="34" viewBox="0 0 32 32"><path d="M16.4 2.6Z" fill="#1d2226"/></svg></span><span class="soul-gain-gain"><b data-soul-gain-amount="">+9</b></span><span class="soul-gain-copy"><small>测试来源</small><small class="soul-gain-total">共 480</small></span>';
  document.body.appendChild(node);
  const cs = getComputedStyle(node);
  const bg = cs.backgroundColor;
  // 取背景亮度（判"够不够浅"）
  const m = /rgba?\(([^)]+)\)/.exec(bg) || /color\(srgb ([^)]+)\)/.exec(bg);
  let lum = null;
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) {
      const scale = parts[0] <= 1 && parts[1] <= 1 ? 255 : 1;
      lum = 0.2126 * parts[0] * scale + 0.7152 * parts[1] * scale + 0.0722 * parts[2] * scale;
    }
  }
  /* 新结构（用户 2026-10-10：「改成像游戏一样的，右上角一个棋魂的图案，
   然后右边是加多少的数字」）：图标在前、数字紧随其后，且数字是**最大号的字**。 */
  const flame = node.querySelector(".soul-gain-flame");
  const amount = node.querySelector("[data-soul-gain-amount]");
  const amountSize = amount ? parseFloat(getComputedStyle(amount).fontSize) : 0;
  const copySize = parseFloat(getComputedStyle(node.querySelector(".soul-gain-copy small")).fontSize);
  const result = {
    animation: cs.animationName, pointerEvents: cs.pointerEvents, bg, lum,
    // 顺序：图标在数字**之前**（游戏里都是"图标 + 数字"，反过来读着别扭）
    iconBeforeAmount: Boolean(flame && amount && (flame.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING)),
    amountSize, copySize,
    // 无框与位置（2026-10-10 的新口径）
    transparent: cs.backgroundImage === "none" && (cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent"),
    borderZero: parseFloat(cs.borderTopWidth) === 0,
    shadow: cs.boxShadow,
    amountStroke: amount ? parseFloat(getComputedStyle(amount).webkitTextStrokeWidth) || 0 : 0,
    // ⚠ 判"在右上角"要用**实测几何**，不能读 `cs.left`：
    // `right: 12px` 在浏览器里会把 `left` 解析成一个具体像素值（不是 "auto"），
    // 所以"left 是 auto"这种判据永远为假（我第一次就是这么写错的）。
    rightAnchored: (() => {
      const r = node.getBoundingClientRect();
      const vw = window.innerWidth;
      // 贴右：右边缘距视口右边 ≤24px；同时**不在中间**（左边缘要过半屏）
      return (vw - r.right) <= 24 && r.left > vw / 2;
    })(),
    /**
     * **在最上面那条带子里、不压棋盘**（用户 2026-10-10 第三轮：
     * 「然后成就的那个还不够靠上，你最好是放到最上面区域，不要挡住棋盘了，
     *  说起来那个棋魂获取的弹窗也是」）。
     *
     * ⚠ 必须**在注入的这里**量：那个 node 在函数结尾就被 `remove()` 了，
     * 出了这个 evaluate 再去 `querySelector` 只会拿到 null（我第一次就是那么写的，
     * 结果断言永远报 null）。
     * 判据用实测几何：顶栏高 68px、**棋盘从 108px 开始**（390×844 实测），
     * 所以提示条整条必须落在 0..70 里。
     */
    band: (() => {
      const r = node.getBoundingClientRect();
      const board = document.querySelector(".board-scroller, .vcfch-board")?.getBoundingClientRect();
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        overlapsBoard: board ? r.bottom > board.top + 1 : false,
      };
    })(),
    /**
     * **可见文字里不许有「棋魂」二字**（用户 2026-10-10 第八轮原话：
     * 「我现在看着获得棋魂的时候依旧会有棋魂的文本存在，目前是图标-数字-棋魂-说明，
     *  这四个，你把棋魂这个字去了呀」）。
     *
     * ⚠ 必须在**这个 evaluate 里**量：下面的代码会在函数结尾 `remove()` 掉 node，
     * 出了这一层再 querySelector 只会拿到 null（本文件已经吃过两次这个亏，
     * 上面 band 那段注释也写着）。第一次我给这条单独写了个 evaluate，结果拿到 "null"。
     */
    visibleText: (() => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(".soul-sr-only").forEach((el) => el.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    })(),
  };
  node.remove();
  return result;
});
check("棋魂提示条带动画（不是一开始就杵在那儿）",
  gainStyle.animation && gainStyle.animation !== "none",
  gainStyle.animation);
check("棋魂提示条不拦截操作（pointer-events:none）", gainStyle.pointerEvents === "none", gainStyle.pointerEvents);
/**
 * 2026-10-10 用户改了口径：提示条**不要框**、**挪到右上角**。
 *
 * 所以原来那条"底色够浅"的断言（黑焰在深底上会丢轮廓）**不适用了** ——
 * 现在它没有底色，黑焰落在**任意**底上（浅色主题 / 深色主题 / 棋盘木纹）。
 * 换成两条针对新形态的：
 *  ① 无框（无背景、无边框、无阴影）；
 *  ② 文字自带白描边（无框之后这是"到哪儿都读得清"的唯一保证）。
 */
check("提示条**没有框**（无底色无边框 —— 用户：「背景是没有框框的」）",
  gainStyle.transparent === true && gainStyle.borderZero === true,
  `底色 ${gainStyle.bg}、边框 ${gainStyle.borderWidth}、阴影 ${gainStyle.shadow}`);
check("提示条的文字带白描边（无框之后靠它保证任意底色都可读）",
  gainStyle.amountStroke > 0, `${gainStyle.amountStroke}px`);
// 位置：右上角（用户：「应该在最右上角出现吧，不然太容易遮挡视线」）
check("提示条在**右上角**（不再居中遮挡视线）",
  gainStyle.rightAnchored === true, `贴右=${gainStyle.rightAnchored}`);
check("提示条落在**最上面那条带子里**（不压棋盘）",
  gainStyle.band.top >= 0 && gainStyle.band.bottom <= 70 && !gainStyle.band.overlapsBoard,
  JSON.stringify(gainStyle.band));

// ③ 2026-10-10 改成游戏风：图标在前、数字紧随其后，且数字是**最大号的字**
//   （用户：「改成像游戏一样的，右上角一个棋魂的图案，然后右边是加多少的数字」）。
check("提示条是「图标 + 数字」的游戏风（图标在前、数字在后）",
  gainStyle.iconBeforeAmount === true, `图标在数字前=${gainStyle.iconBeforeAmount}`);
check("提示条的数字是最大号的字（一眼能扫到加了多少）",
  gainStyle.amountSize >= 18 && gainStyle.amountSize > gainStyle.copySize * 1.4,
  `数字 ${gainStyle.amountSize}px vs 来源 ${gainStyle.copySize}px`);
/**
 * **数字后面不再写「棋魂」二字**（用户 2026-10-10 第八轮原话：
 * 「我现在看着获得棋魂的时候依旧会有棋魂的文本存在，目前是图标-数字-棋魂-说明，
 *  这四个，你把棋魂这个字去了呀」）。
 *
 * 断言用**实际渲染出来的文字**，不是"某个类名不存在" ——
 * 后者只能证明我删了那个元素，证明不了"别处没有又冒出来一份"。
 * ⚠ 注入用的来源文案是「测试来源」，本身不含"棋魂"二字，
 *   所以这里若出现"棋魂"就一定是数字旁边那个单位标签又回来了。
 */
check("提示条的可见文字里没有「棋魂」二字（图标已经是单位）",
  !gainStyle.visibleText.includes("棋魂"), `可见文字「${gainStyle.visibleText}」`);

// ── 9. 点一下 +1（用户 10-09 第十轮，10-10 调位置）───────────────────
// 10-09 原话：「点一下这个棋魂（面板里面的），就会获得1个棋魂，右上角会飘出一个＋1，
//   同时这个棋魂的样子还会切换形态……这个点击是可以无限点击的，
//   相当于免费的无尽能源，这个机制可以写在上面一点让人知道」
//
// 10-10 用户指出这块**位置不对**：「你先优化一下那个棋魂界面的布局板块，目前感觉
//   设计的不够好，有点乱这些位置，上面那个点击棋魂+1的里面的说明去掉，放到合适的位置」。
//   ⇒ 从"压在整个页面最顶上"改成"贴在魂火正下方的一枚胶囊提示"。
//
// 所以这条断言也换了口径：不再要求"在版面之上"，而是要求
//   ① 说明存在（机制仍要让人知道）；
//   ② 它**落在魂火版面内部**、且在**魂火下方**、与魂火同屏（贴着它解释的那个动作）；
//   ③ 余额不再被同义重复（这是本轮量出来的第三处乱）。
//
// 撤掉了上一轮的"自动燃烧循环"判据（用户改成手动两态，自动动画已删）。
// 现在四条：① 机制说明贴着魂火；② 点一下就真的入账 +1；
//          ③ 点一下形态翻面；④ 连点多次每次都入账（不是幂等去重掉）。
await page.locator("[data-soul-badge]").first().click().catch(() => {});
await page.waitForSelector("[data-soul-panel]", { timeout: 15000 });
await page.waitForTimeout(600);

check("面板里有「点一下 +1」的机制说明",
  await page.locator("[data-soul-tap-hint]").count() > 0);

// 说明必须**在魂火版面内部、且在魂火本体下方**（贴着它解释的那个动作）
const hintPlacement = await page.evaluate(() => {
  const hint = document.querySelector("[data-soul-tap-hint]");
  const hero = document.querySelector(".soul-hero");
  const flame = document.querySelector(".soul-hero-flame");
  if (!hint || !hero || !flame) return null;
  const hintBox = hint.getBoundingClientRect();
  const flameBox = flame.getBoundingClientRect();
  return {
    insideHero: hint.closest(".soul-hero") === hero,
    belowFlame: hintBox.top >= flameBox.bottom - 1,
    // 与魂火同屏：提示的顶边要在视口内（面板很高，说明被推到下一屏就等于没贴着）
    sameScreen: hintBox.top < window.innerHeight && hintBox.bottom > 0,
  };
});
check("说明贴着魂火（在版面容内、在魂火下方、同一屏可见）",
  Boolean(hintPlacement?.insideHero && hintPlacement?.belowFlame && hintPlacement?.sameScreen),
  hintPlacement ? `在版面容内=${hintPlacement.insideHero}、在魂火下方=${hintPlacement.belowFlame}、同屏=${hintPlacement.sameScreen}` : "");

// 余额不被同义重复：小额（不到一万）时不该出现「精确 xxx」那一行
const balanceDup = await page.evaluate(() => {
  const big = document.querySelector("[data-soul-hero-balance]");
  const exact = document.querySelector(".soul-hero-exact");
  if (!big) return null;
  const shown = (big.textContent || "").trim();
  // 读到「1.2w」这种形式就说明被缩写了 ⇒ 那时才该有"精确"那一行
  return { shown, abbreviated: /[we]$/.test(shown), hasExact: exact !== null };
});
check("余额没被同义重复（不缩写时不显示「精确」那一行）",
  Boolean(balanceDup && (balanceDup.abbreviated ? balanceDup.hasExact : !balanceDup.hasExact)),
  balanceDup ? `显示「${balanceDup.shown}」、缩写=${balanceDup.abbreviated}、有精确行=${balanceDup.hasExact}` : "");

// 窄屏：那枚提示胶囊在 360 / 320 上都要**排得下**（不溢出、不横滚）。
// 这是"位置不合适"那类反馈里最容易复发的一种：文案一改长就撑破卡片。
// 顺带确认它没有反过来把魂火挤小 —— 只查排布，不查观感。
const narrowReports = [];
for (const width of [360, 320]) {
  const probe = await page.context().newPage();
  await probe.setViewportSize({ width, height: 880 });
  await probe.goto(qaUrl.href, { waitUntil: "domcontentloaded", timeout: 120000 });
  await probe.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await probe.waitForTimeout(600);
  await probe.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
  await probe.waitForTimeout(400);
  await probe.locator("[data-soul-badge]").first().click().catch(() => {});
  await probe.waitForSelector("[data-soul-panel]", { timeout: 15000 }).catch(() => {});
  await probe.waitForTimeout(400);
  const report = await probe.evaluate(() => {
    const chip = document.querySelector(".soul-hero-tap");
    if (!chip) return null;
    const panel = document.querySelector("[data-soul-panel]").getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    return {
      overflow: rect.left < panel.left - 0.5 || rect.right > panel.right + 0.5,
      scrollX: chip.scrollWidth > chip.clientWidth + 1,
      // 提示里两段文字都必须完整渲染（不是被裁掉）
      main: (chip.querySelector("b")?.textContent || "").trim(),
      sub: (chip.querySelector("small")?.textContent || "").trim(),
      h: Math.round(rect.height),
    };
  });
  narrowReports.push({ width, report });
  await probe.close();
}
for (const { width, report } of narrowReports) {
  check(`${width}px 窄屏：提示胶囊排得下（不溢出、不横滚）`,
    Boolean(report && !report.overflow && !report.scrollX),
    report ? `溢出=${report.overflow}、横滚=${report.scrollX}、高 ${report.h}px` : "没找到提示胶囊");
}

const readBalance = () => page.evaluate(() => {
  try { const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    return Array.isArray(raw) ? raw.reduce((sum, item) => sum + (item.amount || 0), 0) : 0; } catch { return 0; }
});
const tapStart = await readBalance();
const flameBtn = page.locator("[data-soul-tap]").first();
check("魂火本体是可点的按钮", await flameBtn.count() > 0);

// 点一下：应当 +1、飘出 +1、并且翻面。
//
// ⚠ 2026-10-10 起余额增量**可能大于 1**：点一下会顺带判定成就，而"碰一下"这条
// （`soul-tap-1`，8 魂）就是"点第一次魂火"触发的 —— 所以第一次点会看到 1 + 8。
// 断言因此改成"至少 +1"，并**单独验"点这一下本身给了 1"**（从账本里数 manual 条目）。
await flameBtn.click();
await page.waitForTimeout(200);
const afterOne = await readBalance();
check("点一下真的入账（至少 +1）", afterOne >= tapStart + 1, `${tapStart} → ${afterOne}`);
const manualGain = await page.evaluate(() => {
  try {
    const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    return raw.filter((item) => item.reason === "manual").reduce((sum, item) => sum + item.amount, 0);
  } catch { return 0; }
});
check("点这一下本身确实入了 1（manual 条目总额 ≥1）", manualGain >= 1, `manual 累计 +${manualGain}`);
check("点一下会飘出「+1」", await page.locator(".soul-tap-float").count() > 0);
const flipped = await page.locator(".soul-hero .soul-flame.is-burnt").count();
check("点一下魂火会翻面（burned 形态）", flipped > 0, `is-burnt 元素 ${flipped} 个`);

// 连点 5 次：每次都入账（证明不是幂等去重掉）、形态来回切
for (let i = 0; i < 5; i += 1) { await flameBtn.click(); await page.waitForTimeout(60); }
await page.waitForTimeout(150);
const afterMany = await readBalance();
// ⚠ 用"至少"而不是"恰好"：2026-10-10 起每次点击都顺带判一次成就，
// 连点过程中可能跨过某个连点档（额外发一笔成就奖励）。所以这条验的是
// **"这 5 次点击各自都入了账"**（>= 就够），而不是"增量恰好等于 5"。
check("连点 5 次每次都入账（无限点，不被幂等去重）",
  afterMany >= afterOne + 5, `${afterOne} → ${afterMany}`);

// 连点后飘字会自己清掉（不积压成永久层）
await page.waitForTimeout(1200);
const leftover = await page.locator(".soul-tap-float").count();
check("飘字会自己清掉（不积压）", leftover === 0, `残留 ${leftover} 个`);

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
