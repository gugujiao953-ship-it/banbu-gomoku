/**
 * qa/opening-reveal-check.mjs — 开局名浮字的门禁（用户 2026-10-09 三条原话）。
 *
 * 用户要求：「我们摆出这个开局后，会出现弹窗的字『xx』，比如花月，雨月这种的，
 * 这个字出现在棋盘中心的下面，**不会影响点击棋盘什么的**，然后也**不会出现很久**」。
 *
 * 这三条在这里变成可断言的黑盒检查，而且是**在真实人机对局里跑**：
 *
 *  A. 摆出某个 26 开局 → 棋盘中心下方出现它的名字，且名字与盘面几何相符。
 *  B. **不影响点击**：浮字还在时点棋盘空位仍能落子（手数真的 +1）；
 *     且浮字中心点的 `elementFromPoint` 命中的是棋盘热区而不是浮字本身。
 *  C. **不会出现很久**：过了揭示时长后浮字从 DOM 消失。
 *  D. 名字必须是 26 开局之一（不允许出现表外的名字）。
 *  E. 浮字是绝对定位、不进文档流；水平居中于棋盘、纵向在棋盘范围内（中心下方）。
 *
 * 第二轮追加（用户 2026-10-09 复报）：
 *  F. **存留时长**：用户报「落子后一下子就没了，还不到1秒钟」——根因是 CSS 里
 *     关键帧自带淡出而 animation 时长只给了 260ms。这里断言浮字**至少存活 2 秒**
 *     （揭示总时长 2.6s），这条专门钉住那个组合错误不再长回来。
 *  G. **美术**：毛笔/楷体字形栈、朱红小印刻着 RIF 编号、竖排「直指/斜指」落款都在。
 *  H. **悔棋回退开局状态机**（同一轮报的另一个 bug）：五手两打摆完打点并选定后，
 *     悔棋几步必须让阶段跟着盘面回退——不能再出现「盘上只有 2 颗子却要求放第 5 手打点」。
 *
 * 盘面怎么读：直接数棋盘 SVG 里的 `circle.stone.black/.white`，按单元格坐标换算成行列。
 * 棋盘几何（实测）：viewBox `0 0 572 572`，225 个 `.board-hit` 的 cx/cy 从 34 到 538，
 * 间距 36 —— 即 `cx = 34 + col*36`、`cy = 34 + row*36`。
 *
 * 点击时机：人类执黑，所以第 3 手（触发浮字）之后轮到 AI；本脚本等 AI 走完第 4 手，
 * 那一瞬间**既是人类的回合、浮字也还在屏幕上**（初级档 0.6 秒/步 < 2.6 秒揭示时长），
 * 正好用来做「浮字不影响落子」的真实点击测试。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5211/ node qa/opening-reveal-check.mjs
 */
import { chromium } from "playwright";

const rawBase = process.env.QA_BASE_URL || "http://127.0.0.1:5211/";
const baseURL = (() => {
  const url = new URL(rawBase);
  if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
  return url.toString();
})();

const SIZE = 15;
const HIT_ORIGIN = 34;   // 第一个交点的 cx/cy（viewBox 单位）
const HIT_STEP = 36;     // 交点间距
const VIEWBOX = 572;

const KNOWN_OPENINGS = ["寒星", "溪月", "疏星", "花月", "残月", "雨月", "金星", "松月", "丘月", "新月", "瑞星", "山月", "游星",
  "长星", "峡月", "云月", "恒星", "斜月", "银月", "浦月", "水月", "彗星", "名月", "明星", "岚月", "流星"];

/** 与 src/features/duel/opening-name.ts 同一张表（相对天元）。 */
const DIRECT = [
  { dr: 2, dc: 0, name: "寒星" }, { dr: 2, dc: 1, name: "溪月" }, { dr: 2, dc: 2, name: "疏星" },
  { dr: 1, dc: 1, name: "花月" }, { dr: 1, dc: 2, name: "残月" }, { dr: 0, dc: 1, name: "雨月" },
  { dr: 0, dc: 2, name: "金星" }, { dr: -1, dc: 0, name: "松月" }, { dr: -1, dc: 1, name: "丘月" },
  { dr: -1, dc: 2, name: "新月" }, { dr: -2, dc: 0, name: "瑞星" }, { dr: -2, dc: 1, name: "山月" },
  { dr: -2, dc: 2, name: "游星" },
];
const INDIRECT = [
  { dr: 2, dc: 2, name: "长星" }, { dr: 1, dc: 2, name: "峡月" }, { dr: 0, dc: 1, name: "云月" },
  { dr: 0, dc: 2, name: "恒星" }, { dr: -1, dc: -1, name: "斜月" }, { dr: -1, dc: 0, name: "银月" },
  { dr: -1, dc: 1, name: "浦月" }, { dr: -1, dc: 2, name: "水月" }, { dr: -2, dc: -2, name: "彗星" },
  { dr: -2, dc: -1, name: "名月" }, { dr: -2, dc: 0, name: "明星" }, { dr: -2, dc: 1, name: "岚月" },
  { dr: -2, dc: 2, name: "流星" },
];
const D4 = [
  (r, c) => [r, c], (r, c) => [r, -c], (r, c) => [-r, c], (r, c) => [-r, -c],
  (r, c) => [c, r], (r, c) => [c, -r], (r, c) => [-c, r], (r, c) => [-c, -r],
];

/** 由盘上三颗子算出开局名（与应用同一套 D4 归一逻辑）——用来**独立复核**应用报出的名字。 */
const solveName = (b1, w2, b3) => {
  let found = null;
  for (const t of D4) {
    const [wr, wc] = t(w2[0] - b1[0], w2[1] - b1[1]);
    const [br, bc] = t(b3[0] - b1[0], b3[1] - b1[1]);
    const family = wr === 1 && wc === 0 ? DIRECT : wr === 1 && wc === 1 ? INDIRECT : null;
    if (!family) continue;
    const hit = family.find((e) => e.dr === br && e.dc === bc);
    if (!hit) continue;
    if (found && found !== hit.name) return null;
    found = hit.name;
  }
  return found;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const results = [];
let failed = 0;
const assert = (ok, name, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

/** 读盘面：从 circle.stone.black/.white 反推行列。 */
const readStones = () => page.evaluate(([origin, step]) => {
  const svg = document.querySelector("[data-duel-board] svg");
  if (!svg) return [];
  return Array.from(svg.querySelectorAll("circle.stone")).map((el) => {
    const cx = Number(el.getAttribute("cx"));
    const cy = Number(el.getAttribute("cy"));
    const cls = String(el.getAttribute("class"));
    return {
      row: Math.round((cy - origin) / step),
      col: Math.round((cx - origin) / step),
      player: cls.includes("black") ? "black" : "white",
    };
  });
}, [HIT_ORIGIN, HIT_STEP]);

const moveCount = () => page.evaluate(() => {
  const svg = document.querySelector("[data-duel-board] svg");
  return svg ? svg.querySelectorAll("circle.stone").length : -1;
});

const isThinking = () => page.evaluate(() => Boolean(document.querySelector("[data-duel-thinking]")));

/** 点交点：把 SVG 单位换算成屏幕坐标。 */
const clickCell = async (row, col) => {
  const box = await page.evaluate(() => {
    const svg = document.querySelector("[data-duel-board] svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) return false;
  const vbX = HIT_ORIGIN + col * HIT_STEP;
  const vbY = HIT_ORIGIN + row * HIT_STEP;
  await page.mouse.click(box.x + (vbX / VIEWBOX) * box.w, box.y + (vbY / VIEWBOX) * box.h);
  return true;
};

/** 等盘上手数到达 n（AI 走完）。 */
const waitMoveCount = async (n, maxMs = 25_000) => {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if ((await moveCount()) >= n) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

const revealState = () => page.evaluate(() => {
  const el = document.querySelector("[data-opening-reveal]");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const board = document.querySelector("[data-duel-board]");
  const br = board ? board.getBoundingClientRect() : null;
  const style = getComputedStyle(el);
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const nameEl = el.querySelector("[data-opening-reveal-name]");
  const sealEl = el.querySelector("[data-opening-reveal-seal]");
  return {
    text: (nameEl?.textContent || "").trim(),
    pointerEvents: style.pointerEvents,
    position: style.position,
    centerX: cx,
    top: rect.top,
    boardCenterX: br ? br.left + br.width / 2 : null,
    boardTop: br ? br.top : null,
    boardBottom: br ? br.bottom : null,
    hitInsideReveal: hit ? el.contains(hit) : false,
    hitTag: hit ? hit.tagName.toLowerCase() : null,
    hitClass: hit ? String(hit.getAttribute("class") || "") : null,
    // —— 美术与时长（第二轮追加的两组断言用）——
    fontFamily: nameEl ? getComputedStyle(nameEl).fontFamily : "",
    sealText: sealEl ? (sealEl.textContent || "").trim() : null,
    familyLabel: (el.querySelector(".opening-reveal-family")?.textContent || "").trim(),
    // animation 的**总时长**（不是只算进场那一段）：这正是「一下就没」的根因所在
    animationDurationMs: (() => {
      const raw = getComputedStyle(el).animationDuration || "0s";
      const first = raw.split(",")[0].trim();
      return first.endsWith("ms") ? parseFloat(first) : parseFloat(first) * 1000;
    })(),
  };
});

const restart = async () => {
  await page.evaluate(() => document.querySelector("[data-duel-restart]")?.click());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("确认重开"));
    if (b) b.click();
  });
  await page.waitForTimeout(2_500);
};

// ── 进入人机对战（执黑，初级 0.6 秒/步）────────────────────────────────────
await page.goto(baseURL, { waitUntil: "load" });
await page.waitForTimeout(4_500);
assert(await page.evaluate(() => Boolean(document.querySelector(".app-shell"))), "应用已加载");

await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav && Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈");
  if (b) b.click();
});
await page.waitForTimeout(1_200);
assert(await page.evaluate(() => Boolean(document.querySelector("[data-duel-entry='ai']"))), "到达对弈页");

await page.evaluate(() => document.querySelector("[data-duel-entry='ai'] .duel-entry-action")?.click());
await page.waitForTimeout(1_200);
assert(await page.evaluate(() => Boolean(document.querySelector(".ai-game-setup"))), "打开人机设置浮层");

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("执黑"));
  if (b) b.click();
});
await page.waitForTimeout(300);

/**
 * 选「五手两打」而不是默认的自由开局——**这是让本门禁确定性的关键**。
 *
 * 自由开局下 AI 的白2 可以落在任意空位，多数时候与天元不相邻，于是凑不出 26 开局、
 * 整轮白跑（实测会因此反复重开到超时）。而五手两打把第 2 手限制在中心 3×3
 * （`openingPositionAllowed` 的 radius=1），**白2 必然与天元相邻** ⇒ 只要我们把黑3
 * 落在表里的对应点，就一定能摆出一个 26 开局。这样断言不再靠运气。
 */
const rulePicked = await page.evaluate(() => {
  const group = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("有禁手"));
  if (group) { group.click(); return true; }
  return false;
});
if (rulePicked) {
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll(".ai-float-list button"));
    const target = list.find((x) => (x.textContent || "").includes("五手两打"));
    if (target) target.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const close = document.querySelector(".ai-float-head button");
    if (close && document.querySelector(".ai-float-wrap")) close.click();
  });
  await page.waitForTimeout(300);
}
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => /开始人机对战|按新规则重新开始/.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(2_500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes("放弃这局"));
  if (b) b.click();
});
await page.waitForTimeout(2_000);
assert(await page.evaluate(() => Boolean(document.querySelector("[data-duel-board]"))), "进入专门的对弈界面");

/**
 * ── 确定性地摆出「花月」─────────────────────────────────────────────────────
 *
 * 为什么这里从「等 AI 落白2 再反推黑3」换成「三手全自己下」：
 * 在**五手两打**里，开局三手（黑1 天元 → 白2 → 黑3）**全部由先手方摆放**，
 * 摆完才轮到后手决定是否交换（这是规则本身，不是实现细节）。所以人执黑时这三手都由我们落，
 * 白2 不必再听 AI 的随机选择 —— 门禁由此从"靠运气凑相邻"变成**每次都精确走花月**。
 * （旧写法在自由开局下等 AI 的白2，常常落在不相邻处直接凑不出 26 开局，整轮白跑。）
 *
 * 花月的几何（相对天元）：白2 = (1,0) 直指，黑3 = (1,1)。这正是用户点名的例子。
 */
const CENTER = 7;
const HANATSUKI_WHITE2 = [CENTER + 1, CENTER];     // 白2 直指：在黑1 正下方
const HANATSUKI_BLACK3 = [CENTER + 1, CENTER + 1]; // 黑3 花月位

let verified = false;
for (let attempt = 1; attempt <= 3 && !verified; attempt += 1) {
  console.log(`\n── 第 ${attempt} 次尝试 ──`);
  // 黑1 天元
  while (await isThinking()) await page.waitForTimeout(200);
  await clickCell(CENTER, CENTER);
  if (!(await waitMoveCount(1))) { console.log("   黑1 未落下"); continue; }

  // 白2 直指（五手两打下也是自己摆）
  while (await isThinking()) await page.waitForTimeout(200);
  await clickCell(HANATSUKI_WHITE2[0], HANATSUKI_WHITE2[1]);
  if (!(await waitMoveCount(2))) { console.log("   白2 未落下（可能不在允许区域内）"); await restart(); continue; }

  // 黑3 花月位
  while (await isThinking()) await page.waitForTimeout(200);
  await clickCell(HANATSUKI_BLACK3[0], HANATSUKI_BLACK3[1]);
  await page.waitForTimeout(700);
  const stones = await readStones();
  const hasBlack3 = stones.some((s) => s.row === HANATSUKI_BLACK3[0] && s.col === HANATSUKI_BLACK3[1]);
  if (!hasBlack3) { console.log("   黑3 没落上"); await restart(); continue; }
  console.log(`   三手已摆：黑1(${CENTER},${CENTER}) 白2(${HANATSUKI_WHITE2.join(",")}) 黑3(${HANATSUKI_BLACK3.join(",")})`);

  const expected = "花月";
  const b3 = HANATSUKI_BLACK3;
  const reveal = await revealState();
  console.log(`   浮字：${reveal ? `「${reveal.text}」` : "(无)"}`);
  if (!reveal) { console.log("   未出现浮字，重开再试"); await restart(); continue; }

  // ① 名字正确
  assert(reveal.text === expected, `浮字名字与盘面几何相符（期望「${expected}」）`, reveal.text);
  assert(KNOWN_OPENINGS.includes(reveal.text), "浮字名字是 26 开局之一", reveal.text);

  /**
   * ①b **第二轮报的「一下就没了」**：断言动画总时长 ≥2 秒。
   * 这是那条 bug 的根因所在（关键帧自带淡出，而 animation 只给了 260ms），
   * 所以这里量的是 computed 的总时长，不是"看起来有没有动画"。
   */
  assert(reveal.animationDurationMs >= 2000, "揭示动画总时长 ≥2 秒（修「一下就没了」）",
    `${reveal.animationDurationMs}ms`);

  /** ①c **第二轮要的「美术效果」**：毛笔楷体字形 + 朱红编号小印 + 直指/斜指落款。 */
  assert(/Kaiti|KaiTi|STKaiti|楷/i.test(reveal.fontFamily), "题名用毛笔/楷体字形栈", reveal.fontFamily);
  assert(Boolean(reveal.sealText) && /^[di]\d{1,2}$/.test(reveal.sealText), "朱红小印上刻着 RIF 编号",
    String(reveal.sealText));
  assert(reveal.familyLabel === "直指" || reveal.familyLabel === "斜指", "有直指/斜指落款",
    reveal.familyLabel);

  /** ①e **独立复核**：用探针自己的 D4 表从盘面几何重算一次，必须与应用报出的名字一致。 */
  const independent = solveName([CENTER, CENTER], HANATSUKI_WHITE2, HANATSUKI_BLACK3);
  assert(independent === reveal.text, "探针独立算出的开局名与应用一致",
    `探针「${independent}」 vs 应用「${reveal.text}」`);
  // 花月对应 RIF d4 —— 编号也要对得上
  assert(reveal.sealText === "d4", "花月的 RIF 编号是 d4", String(reveal.sealText));

  /**
   * ①d **直接复现用户那句「不到 1 秒就没了」**：出现后再等 1.2 秒，浮字必须还在
   * （此时距出现约 1.9 秒，而用户看到的是不到 1 秒就消失）。
   * 留 0.7 秒余量给后面那条「浮字还在时能落子」的点击测试，两处不至于抢同一时间窗。
   */
  await page.waitForTimeout(1_200);
  const stillAlive = await revealState();
  assert(stillAlive !== null, "出现约 1.9 秒后浮字仍在（用户报的「不到1秒就没了」）",
    stillAlive ? `仍在显示「${stillAlive.text}」` : "已经消失");

  // ② 位置：水平居中于棋盘、纵向在棋盘范围内（中心下方）
  assert(Math.abs(reveal.centerX - reveal.boardCenterX) <= 4, "浮字水平居中于棋盘",
    `${reveal.centerX.toFixed(1)} vs ${reveal.boardCenterX.toFixed(1)}`);
  assert(reveal.top > reveal.boardTop && reveal.top < reveal.boardBottom, "浮字纵向在棋盘内（中心下方）",
    `top ${reveal.top.toFixed(0)} ∈ (${reveal.boardTop.toFixed(0)}, ${reveal.boardBottom.toFixed(0)})`);

  // ③ 不影响点击
  assert(reveal.pointerEvents === "none", "浮字 pointer-events:none", reveal.pointerEvents);
  assert(reveal.hitInsideReveal === false, "浮字中心的命中测试落在浮字之外（不挡棋盘）",
    `<${reveal.hitTag} class="${reveal.hitClass}">`);

  // ④ 不进文档流
  assert(reveal.position === "absolute", "浮字绝对定位（不进文档流）", reveal.position);
  const boardBefore = await page.evaluate(() => {
    const b = document.querySelector("[data-duel-board]");
    const r = b.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });

  /**
   * ⑤ **浮字在屏幕上时，点击必须照常到达棋盘**（用户：「不会影响点击棋盘什么的」）。
   *
   * 为什么断言写成「落子数 +1 **或** 出现 toast」两种都算通过：
   * 五手两打摆完三手后进入**交换决策**阶段，此时棋盘上的点击会被应用明确拒绝并弹一句
   * 「请先在开局提示卡中选择是否交换」；而若 AI 已决定不交换、轮到人类落第 4 手，则点击会真的落子。
   * 两条路径都证明「这一下点击穿过了浮字、被棋盘收到了」——被浮字吃掉的话**两者都不会发生**。
   * （另两条更直接的证据是同轮的 `pointer-events:none` 与 `elementFromPoint` 命中 `board-hit`。）
   */
  const toastText = () => page.evaluate(() => (document.querySelector(".app-toast-message")?.textContent || "").trim());
  {
    const before = moveCount ? await moveCount() : 0;
    const occupiedNow = new Set((await readStones()).map((s) => `${s.row},${s.col}`));
    // 挑一个靠近中心的空点（交换后轮到白方第 4 手时，这里通常也在允许区域内）
    let spot = null;
    for (const [r, c] of [[7, 8], [8, 8], [6, 8], [8, 6], [6, 6], [9, 9]]) {
      if (!occupiedNow.has(`${r},${c}`)) { spot = [r, c]; break; }
    }
    const revealAtClick = await revealState();
    if (spot) await clickCell(spot[0], spot[1]);
    await page.waitForTimeout(700);
    const after = await moveCount();
    const toast = await toastText();
    assert(
      after > before || toast.length > 0,
      "浮字显示期间点击仍到达棋盘（落子或被明确拒绝，而不是被浮字吞掉）",
      `落子 ${before}→${after}${toast ? ` · toast「${toast.slice(0, 30)}」` : ""}（点击时浮字${revealAtClick ? `在：「${revealAtClick.text}」` : "已消失"}）`,
    );
    if (revealAtClick) assert(revealAtClick.text === expected, "点击期间浮字仍显示同一开局名", revealAtClick.text);
  }

  // ⑥ 不会出现很久：等过揭示时长，浮字消失
  await page.waitForTimeout(3_400);
  assert((await revealState()) === null, "揭示结束后浮字从 DOM 消失");

  // ⑦ 棋盘没有因为这块 UI 位移
  const boardAfter = await page.evaluate(() => {
    const b = document.querySelector("[data-duel-board]");
    const r = b.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });
  assert(Math.abs(boardAfter.top - boardBefore.top) <= 1 && Math.abs(boardAfter.height - boardBefore.height) <= 1,
    "浮字未推动棋盘布局（top/height 变化 ≤1px）",
    `top ${boardBefore.top.toFixed(0)}→${boardAfter.top.toFixed(0)} · height ${boardBefore.height.toFixed(0)}→${boardAfter.height.toFixed(0)}`);

  verified = true;
}

assert(verified, "至少成功验证了一次开局浮字的完整行为");
assert(errors.length === 0, "全程无 console/page 错误", errors.slice(0, 3).join(" | "));

console.log(failed === 0 ? `\n✅ 开局名浮字门禁 ${results.length} 项全过` : `\n❌ ${failed}/${results.length} 项失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
