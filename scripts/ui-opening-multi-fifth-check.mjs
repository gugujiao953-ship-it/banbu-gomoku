import { chromium } from "playwright";

// End-to-end gate for the merged human-vs-AI rule 「五手多打（山口）」.
//
// 取代 scripts/ui-opening-five-n-check.mjs（旧 T30 five-n 门禁，已删除）。
// 规则清单把「山口」与「五手多打」并成一条后，文本匹配「五手多打」只会选到
// openingRule=yamaguchi；旧脚本却断言 five-n 的流程（AI 宣布 N 打），已失效。
// five-n（白4后临场定数）仍存在于引擎/开局簿层，但不再出现在人机菜单里。
//
// 覆盖的真实交互（人类执黑 / AI 执白，openingRule=yamaguchi）：
//   人摆 黑1天元 → 白2（3×3）→ 黑3（5×5）→ 弹出「选择五手打数量」人宣布 N →
//   AI(白) 决定不交换 → AI 落白4 →【人(黑) 按宣布数量逐个打点】→ AI(白) 选一并下白6。
//
// 回归断言：
//   T30：offer-fifths 归属必须是人（黑）。修复前该阶段 actor 继承宣布方(白)，
//        执黑人类会遇到 AI 代放打点、人类被跳过；断言 4 子后棋盘不自行长到 >4，
//        且第 5 手必须来自人类亲手点出的候选。
//   T32(bug 2 → 2026-09-16 定案)：打点不得「同形」。判据 = **与「本局局面」自身的对称挂钩**
//        （对齐 五林五子棋 官方客户端：包 com.magicflute.renjuworld；网页版
//         https://renjuworld.net/renju/ 的 assets/main/index.0c96e.js 为明文，去混淆后
//         `posRelation` + `canPutAlternativeStone` 两个函数就是该规则的实现）：
//         · posRelation 给出同色两点所在的线型（LR 同行 / TB 同列 / LB2RT、LT2RB 两条对角），
//           并把「对称中心 = 两点坐标之和」写回；
//         · canPutAlternativeStone 取四手棋（黑1 白2 黑3 白4），先求 黑1↔黑3 与 白2↔白4 的
//           关系，**只有两对的对称轴/中心重合（即局面自身对称）时才进入判定**；进入后，新打点
//           与已打点关于同一轴/中心互为镜像才拒绝（返回 0，提示「打点重复或对称!」）。
//         语义：两个打点同形 ⇔ 存在等距变换把「局面 + 其中一个打点」映成另一个，即白方在这
//         两点间选择会得到完全一样的局面。局面不对称（绝大多数实战局面）时全部放行。
//         演进：初版 shapeKey（盘面+打点整体规范形）→ 盘面不对称时永不生效；T32 改成「打点
//         自身 D4 轨道」→ 与盘面无关，既误拦大量远点（用户 09-16 实测「右边一堆点都打不了」）
//         又漏掉真正该拦的一对（用户同一局里 (7,5)/(7,8) 关于局面中心对称）；现按五林实现重写
//         （`positionSymmetries`），并由 `src/opening-fifth-symmetry-oracle.test.ts` 对拍背书。
//
// Usage: BANBU_URL=http://[::1]:5193/ node scripts/ui-opening-multi-fifth-check.mjs
// 登记在 qa/regression-manifest.mjs：run-qa.mjs 会注入 QA_BASE_URL（已带 ?qa=1），
// 这里两种变量都接受，并避免重复追加查询串。
const rawUrl = process.env.BANBU_URL || process.env.QA_BASE_URL || "http://localhost:5193/";
const target = new URL(rawUrl);
if (!target.searchParams.has("qa")) target.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(target.href, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const banner = () => page.evaluate(() => { const el = document.querySelector(".ai-opening-banner"); return el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : ""; });
const toast = () => page.evaluate(() => { const el = document.querySelector(".toast"); return el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160) : ""; });
const stones = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).map((l) => (l.match(/[A-O]\d{1,2}/) || [""])[0]));
const candidates = () => page.evaluate(() => [...document.querySelectorAll(".opening-candidate")].map((e) => (e.getAttribute("aria-label") || "").trim()));
const thinking = () => page.evaluate(() => Boolean(document.querySelector(".ai-opening-thinking")));
const clickPoint = async (name, wait = 650) => { await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, name); await page.waitForTimeout(wait); };
const waitFor = async (fn, budgetMs, stepMs = 400) => { const t0 = Date.now(); let value = await fn(); while (Date.now() - t0 < budgetMs) { if (value) return value; await page.waitForTimeout(stepMs); value = await fn(); } return value; };

// 权威手序（含颜色）读草稿链：DOM 的棋面顺序不等于行棋顺序，别按棋面反推。
const readGame = () => page.evaluate(() => {
  // ⚠ 09-28 起对局中的棋谱**不进棋谱库、也不写「上次棋谱」**（用户：不主动保存就不入库），
  //   它只活在内存与「上次对局」会话快照里。所以这里要先读快照，再回退到老的存档键
  //   （打谱场景仍然写那两个键）。
  let doc = null;
  for (const k of ["banbu-duel-session-v1", "renju-note-active-v1", "renju-note-default-v1"]) {
    try { const raw = JSON.parse(localStorage.getItem(k) || "null"); doc = k === "banbu-duel-session-v1" ? (raw?.document || null) : raw; } catch { doc = null; }
    if (doc && doc.nodes && doc.rootId) break;
  }
  if (!doc || !doc.nodes || !doc.rootId) return { moves: [], openingRule: null };
  const moves = [];
  let id = doc.rootId; let guard = 0;
  while (id && doc.nodes[id] && guard < 400) {
    const node = doc.nodes[id];
    if (node.move) moves.push({ row: node.move.row, col: node.move.col, player: node.move.player });
    const kids = node.children || [];
    id = kids.length ? (node.preferredChildId && kids.includes(node.preferredChildId) ? node.preferredChildId : kids[kids.length - 1]) : null;
    guard += 1;
  }
  return { moves, openingRule: doc.metadata ? doc.metadata.openingRule : null };
});
const nameOf = (row, col) => `${String.fromCharCode(65 + col)}${15 - row}`;
// 草稿链落盘有延迟：轮询到目标手数再断言，避免读到「上一次」的快照。
const waitChain = async (n, budgetMs) => { const t0 = Date.now(); let g = await readGame(); while (Date.now() - t0 < budgetMs) { if (g.moves.length >= n) return g; await page.waitForTimeout(300); g = await readGame(); } return g; };

// 人类执黑，山口：黑1 H8(7,7)；白2 I9(6,8) ∈3×3；黑3 I6(9,8) ∈5×5。
// 打点用远角，确保 AI 白4（开局只会在中心附近）不会占用。
// 新判据是「与局面自身的对称挂钩」，本局局面不对称 ⇒ 三点互不同形全部接受：
//   A15=(0,0) ｜ O15=(0,14)（旧 D4 口径会误拦）｜ B15=(0,1)。
const HUMAN_MOVES = ["H8", "I9", "I6"];
const CAND_A = "A15";     // 轨道 00,00
const CAND_B = "B15";     // 轨道 00,01（与 A15/C15 均不同形）
const CAND_FAR = "O15";   // 远角：旧「D4 轨道」口径会误拦，新口径（局面不对称）必须放行
const CAND_C = "C15";     // 备用点（当前流程未用到）
const DECLARED = 3;

// S1 规则清单：有禁组现在 6 项，「五手多打（山口）」在列且不再有独立的 five-n 条目。
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
await page.waitForTimeout(700);
await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
await page.waitForTimeout(900);
// 09-28 起：若上次有没下完的对局，先弹「回到上次对局」——这条要开新局，所以选「放弃这局」。
if (await page.locator("[data-duel-resume-new]").count()) {
  await page.locator("[data-duel-resume-new]").click();
  await page.waitForTimeout(800);
}
await page.locator(".ai-game-setup").waitFor({ timeout: 10_000 });
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手"))?.click(); });
await page.waitForTimeout(500);
const ruleNames = await page.evaluate(() => [...document.querySelectorAll(".ai-float-list button")].map((e) => (e.querySelector("span")?.textContent || e.textContent || "").trim()));
check("S1a 有禁手规则组=6 项", ruleNames.length === 6, JSON.stringify(ruleNames));
check("S1b 清单含「五手多打（山口）」且无独立 five-n 条目", ruleNames.includes("五手多打（山口）") && !ruleNames.includes("五手多打") && !ruleNames.some((n) => /五手\s*N\s*打/.test(n)), JSON.stringify(ruleNames));
const picked = await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.querySelector("span")?.textContent || "").includes("五手多打（山口）")); if (b) { b.click(); return true; } return false; });
check("S1c 选中「五手多打（山口）」", picked);
await page.waitForTimeout(400);
// ⚠ 规则浮层是模态的（09-19 起是「格子 + 浮层列表」形态），**必须点掉它**才能点到底下的
//   「执黑 / 开始人机对战」——否则点了个空、规则留在默认「自由」，后面全垮。
//   （这条门禁一直没红是因为以前浮层选完会自己收；顺带还发现它自己没走「恢复上次对局」这一步。）
const closeFloat = async () => {
  if (await page.locator(".ai-float-backdrop").count()) {
    await page.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true });
    await page.waitForTimeout(400);
  }
};
await closeFloat();
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("执黑"))?.click(); });
await page.waitForTimeout(300);
await closeFloat();
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"))?.click(); });
await page.waitForTimeout(1400);

const game0 = await readGame();
check("S2a 元数据 openingRule=yamaguchi", game0.openingRule === "yamaguchi", String(game0.openingRule));

// S2 开局：人类（黑）摆前三手。山口是「开局方摆 1-3」，全程只有人类动。
const b1 = await banner();
check("S2b 横幅=第1手黑方天元（人类先动）", /第 1 手 · 黑方必须落在天元/.test(b1), `banner=「${b1.slice(0, 90)}」`);
await clickPoint(HUMAN_MOVES[0]);
let s = await stones();
check("S2c 黑1 落 H8（1 子）", s.length === 1 && s[0] === "H8", JSON.stringify(s));
const b2 = await banner();
check("S2d 横幅推进到第2手白方 3×3（人类继续摆）", /第 2 手 · 白方须落在中心 3×3 区域/.test(b2), `banner=「${b2.slice(0, 90)}」`);
await clickPoint(HUMAN_MOVES[1]);
const b3 = await banner();
check("S2e 横幅推进到第3手黑方 5×5", /第 3 手 · 黑方须落在中心 5×5 区域/.test(b3), `banner=「${b3.slice(0, 90)}」`);
await clickPoint(HUMAN_MOVES[2]);
await page.waitForTimeout(900);
s = await stones();
check("S2f 人类摆满前三子（AI 未插手，仍 3 子）", s.length === 3 && HUMAN_MOVES.every((n) => s.includes(n)), JSON.stringify(s));

// S3 宣布打点数：第三手后自动弹「选择五手打数量」浮层（归人类）。
const sheetReady = await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".fifth-count-sheet"))), 6000, 300);
const bDeclare = await banner();
check("S3a 宣布浮层自动弹出（归人类）", Boolean(sheetReady) && /请宣布本局第5手打点数量/.test(bDeclare), `sheet=${Boolean(sheetReady)} banner=「${bDeclare.slice(0, 100)}」`);
const declared = await page.evaluate((n) => { const b = [...document.querySelectorAll(".fifth-count-sheet button")].find((e) => new RegExp(`^${n}个打点`).test((e.textContent || "").replace(/\s+/g, ""))); if (b) { b.click(); return true; } return false; }, DECLARED);
check(`S3b 人类宣布 ${DECLARED} 个打点`, declared);

// S3c AI 思考期间点棋盘：必须给明确反馈，而不是静默无反应（2026-09-16 方案 A）。
// 这段时间棋盘是 disabled（aiBoardDisabled 含 aiThinking），点击本来就不该生效——但它
// 原先既不改 banner 也不弹 toast：用户看到横幅写着「第 4 手 · 白方落子」，点上去毫无动静，
// 很容易误判成「规则判定坏了」。09-16 排查「对称也能下子」时我正是被这个静默误导过。
const inThinking = await waitFor(() => thinking(), 6000, 100);
const bannerDuringThinking = await banner();
const stonesBeforeTap = (await stones()).length;
await clickPoint("A15", 400);
const stonesAfterTap = (await stones()).length;
const markersAfterTap = (await candidates()).length;
const thinkingToast = await toast();
check("S3c AI 思考期间点棋盘不会落子（那一下绝不进候选数组）",
  stonesAfterTap === stonesBeforeTap && markersAfterTap === 0,
  `棋子 ${stonesBeforeTap}→${stonesAfterTap} 候选=${markersAfterTap}`);
// 此刻 stage 还是 swap（AI 要决定是否交换），所以文案是「AI 正在决定是否交换黑白方…」；
// 落白4 时段文案才是「AI 正在落第 4 手…」。两者都必须**表明轮到 AI**，而不是催人类操作。
check("S3d AI 思考期间横幅如实显示轮到 AI，而不是催人类落子",
  inThinking && /AI 正在(落第 \d+ 手|决定是否交换)/.test(bannerDuringThinking),
  `thinking=${inThinking} banner=「${bannerDuringThinking.slice(0, 80)}」`);

// S4 AI(白) 拥有交换决定权并选择不交换 → 落白4。人类不参与这两步。
let ai4 = [];
const t04 = Date.now();
for (let i = 0; i < 80; i += 1) {
  ai4 = await stones();
  if (ai4.length >= 4) break;
  await page.waitForTimeout(500);
}
const g4 = await waitChain(4, 6000);
check("S4a AI 落白4（4 子）", ai4.length === 4, `ms=${Date.now() - t04} board=${JSON.stringify(ai4)}`);
check("S4b 白4 颜色=A白方（交换决定归 AI，人类未代劳）", g4.moves.length >= 4 && g4.moves[1].player === "white" && g4.moves[2].player === "black" && g4.moves[3].player === "white", JSON.stringify(g4.moves.map((m) => `${nameOf(m.row, m.col)}:${m.player[0]}`)));

// S5 打点阶段归属：必须回到人类（T30 回归）。
const offerBanner = await waitFor(async () => { const t = await banner(); return /请提供 3 个不同棋形的黑方第5手候选/.test(t) ? t : ""; }, 8000, 300);
check("S5a 人类收到打点提示（请提供 3 个，0/3）", /请提供 3 个不同棋形的黑方第5手候选（0\/3）/.test(offerBanner), `banner=「${offerBanner.slice(0, 120)}」`);
// 修复前 AI 会代放打点：观察窗口内棋子数不得自行超过 4，且不得出现候选标记。
const aiUsurped = await waitFor(async () => { const n = (await stones()).length; return n > 4 ? JSON.stringify(await stones()) : ""; }, 3000, 400);
const preCandidates = await candidates();
const stillThinking = await thinking();
check("S5b AI 未代放打点（T30：4 子后棋子不再增长）", !aiUsurped && preCandidates.length === 0, `grew=${aiUsurped || "no"} markers=${preCandidates.length} thinking=${stillThinking}`);

// S6 人（黑）逐个打点 + bug 2 的对称同形回归。
await clickPoint(CAND_A);
let marks = await candidates();
let curBanner = await banner();
check("S6a 候选1 接受（1/3，棋盘出现 1 个候选标记）", marks.length === 1 && /（1\/3）/.test(curBanner), `markers=${marks.length} banner=「${curBanner.slice(0, 120)}」`);

// —— 同形判据回归（2026-09-16 定案：与局面自身对称挂钩，对齐五林客户端）——
// 本局局面（黑1 H8、白2 I9、黑3 I6 + AI 白4）自身没有轴对称、也没有中心对称 ⇒ 稳定子群
// 平凡 ⇒ 任何两个打点给出的局面都真的不同形。旧口径（打点自身 D4 轨道、与盘面无关）会把
// 远角 O15 当成 A15 的「角轨道」同形点误拦 —— 这里断言它现在被接受。
await clickPoint(CAND_FAR);
marks = await candidates();
curBanner = await banner();
const symToast = await toast();
check("S6b 与局面无关的远点不再被误拦（候选 2/3、且不是同形提示）",
  marks.length === 2 && /（2\/3）/.test(curBanner) && !/同形/.test(symToast),
  `markers=${marks.length} banner=「${curBanner.slice(0, 120)}」 toast=「${symToast.slice(0, 80)}」`);
check("S6c 被接受的点未落子、也不计入盘面（棋盘仍 4 子）",
  (await stones()).length === 4, JSON.stringify(await stones()));

// 同一个点重复点击必须被拒（同点拦截在 addFifthCandidate，界面上也应给提示）
await clickPoint(CAND_FAR);
marks = await candidates();
const dupToast = await toast();
check("S6c2 同一个点重复点击被拒绝（候选数不变 + 提示已摆过）",
  marks.length === 2 && /已经摆过|同形/.test(dupToast), `markers=${marks.length} toast=「${dupToast.slice(0, 80)}」`);

// —— 第三个点加上去就满额，banner 当场切到「请从 3 个候选中选择」——
await clickPoint(CAND_B);
marks = await candidates();
curBanner = await banner();
// ⚠ 文案在 09-16 按 chooser 分岔过：人类执黑时「选择权在白方（AI）」，所以写的是
//   「白方将在 3 个候选中选择黑方第5手」。旧断言只认「请从 3 个候选中选择」，早就是陈旧的。
check("S6d 第三个打点被接受并凑满数量（进入选择阶段）",
  marks.length === 3 && /(请从|白方将在) 3 个候选中选择/.test(curBanner),
  `markers=${marks.length} banner=「${curBanner.slice(0, 120)}」`);

// S7 AI(白) 选一并下白6：第5手必须落在人类给出的三点之一，且颜色为黑。
let fin = [];
const t06 = Date.now();
for (let i = 0; i < 90; i += 1) {
  fin = await stones();
  if (fin.length >= 6) break;
  await page.waitForTimeout(500);
}
const g6 = await waitChain(6, 9000);
// 本轮人类实际给出的三点（新判据下 O15 也被接受）
const offered = [CAND_A, CAND_FAR, CAND_B];
const survived = offered.filter((n) => fin.includes(n));
check("S7a AI 选一并下白6（6 子）", fin.length === 6, `ms=${Date.now() - t06} board=${JSON.stringify(fin)}`);
check("S7b 幸存打点唯一且来自人类给出的候选（AI 只做选择）", survived.length === 1, `survivor=${survived[0] || "none"} board=${JSON.stringify(fin)}`);
if (g6.moves.length >= 6) {
  const m5 = g6.moves[4];
  const m6 = g6.moves[5];
  check("S7c 第5手=黑方且在第4手白4之后（人类点出候选、AI 定选）", m5.player === "black" && offered.includes(nameOf(m5.row, m5.col)), `${nameOf(m5.row, m5.col)}:${m5.player[0]}`);
  check("S7d 第6手=白方（AI 下白6）", m6.player === "white", `${nameOf(m6.row, m6.col)}:${m6.player[0]}`);
} else {
  check("S7c 草稿链手序完整（≥6 手）", false, JSON.stringify(g6.moves.map((m) => nameOf(m.row, m.col))));
  check("S7d 第6手=白方（AI 下白6）", false, "no chain");
}
check("S8 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
