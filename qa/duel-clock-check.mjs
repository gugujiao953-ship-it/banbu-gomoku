import { chromium } from "playwright";

// 常驻门禁：线下比赛计时器（用户 2026-09-23）
//
// 这是一个**独立功能**，不是对弈的一部分：两个人用真实棋盘棋子下棋，设备摆在旁边当钟。
// 所以本门禁最要紧的一条是「界面里除钟之外什么都没有」——没有棋盘、没有工具条。
// 这条一旦回归，功能性质就变了，必须挡住。
//
//  T1 对弈页有「比赛计时器」入口
//  T2 打开后占满整屏，且**没有棋盘**（不出现任何棋盘点）
//  T2c 打开后**钟是停的**：不按下去时间一秒都不走（用户 09-23 点名「点一下才开始计时」）
//  T3 上下各一半：两个大号数字（白上黑下），默认 5 分钟包干
//  T3e 初始方（黑，下半屏）写着「点这里开始计时」的提示
//  T3f 字号**按时长自适应**：短档比长档字号大，且任何档的数字都完整落在自己半屏内
//      （用户 09-23 点名「2 小时的秒数被挤出画面」——老版本字号写死，长时段必溢出）
//  T4 点自己那半屏＝按下开始/交给对方（整半屏都是热区，不是只有数字）
//  T5 包干制不因走子加秒（剩余只减不增）
//  T6 设置里有「5 分钟快棋」与「20 分钟包干」两档，切换立即生效
//  T6d 自定义能填「分 + 秒」两个字段（用户 09-23 点名「只能调整包干的时间」）——
//      真的填出 1 分 30 秒这种非整分值
//  T6e 四种计时方式都在：包干/加秒、延时（布龙斯坦）、读秒；而**不是只有两种**
//  T6e2b/T6e3b 「时限设置」浮层**一屏看完不用滚**（用户 2026-10-01：「尽量搞成一屏可看完，
//      就像人机对战里面那样」）。改之前 392×852 实测内容 1446px / 可视 750px，要滚 696px
//  T6f 预设按组排（超快棋/快棋/标准/读秒/延时），档数比原来多
//  T6g 上下**互为镜像**（用户 09-24 定的摆法）：上半天转 180°、下半天不转、中控条固定不动、
//      没有「翻转」按钮（镜像不是开关而是默认摆法）、镜像不影响热区
//  T7 剩 ≤10 秒整半屏变红；时间走完判超时
//  T7d 一方超时后「判和」仍可用：中控条那颗不 disabled，终局卡片上另给一颗**真点得到**的
//      （`.clock-over` 铺满整屏会盖住中控条，2026-10-01 实测那时它点不动）
//  T7e 布龙斯坦延时：思考 4 秒后交钟要把这 4 秒还回来（旧实现返还 0 秒＝退化成包干；
//      单测全绿是因为它们不跑那 200ms 的重绘定时器，所以这条只能在真实浏览器里钉）
//  T7f/T7g 布龙斯坦的延时额度是这一手的**保护时**：主时间走完 3 秒不落子不该判负，
//      落子交钟后主时间一分不扣（与简单延时等价）
//  T8 退出能关掉覆盖层、回到原界面
//  T9 全程无页面错误
//
// 用法：BANBU_URL=http://localhost:4173 node qa/duel-clock-check.mjs
const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:4173/";
const base = url.includes("?") ? url : `${url}?qa=1`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const clickText = async (text) => {
  const ok = await page.evaluate((t) => {
    const node = [...document.querySelectorAll("button")].find((b) => ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).includes(t));
    if (!node) return false;
    node.click(); return true;
  }, text);
  await page.waitForTimeout(700);
  return ok;
};
const clockText = (side) => page.evaluate((s) => document.querySelector(`[data-clock-time="${s}"]`)?.textContent?.trim() || "", side);
const sideState = (side) => page.evaluate((s) => {
  const el = document.querySelector(`[data-clock-side="${s}"]`);
  return el ? {
    active: el.getAttribute("data-clock-active") === "true",
    low: el.getAttribute("data-clock-low") === "true",
    idle: el.getAttribute("data-clock-idle") === "true",
    hint: (el.querySelector(".clock-half-hint")?.textContent || "").trim(),
  } : null;
}, side);
const parseClock = (text) => { const parts = text.split(":").map(Number); return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : (parts[0] || 0) * 60 + (parts[1] || 0); };
/** 点某半屏＝按钟（整半屏都是热区，这里故意点边角而不是数字上）。 */
const pressHalf = async (side, wait = 800) => {
  await page.evaluate((s) => {
    const el = document.querySelector(`[data-clock-side="${s}"]`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 10, clientY: r.bottom - 8 }));
  }, side);
  await page.waitForTimeout(wait);
};
const openSetup = async () => {
  await page.evaluate(() => document.querySelector('[data-clock-action="settings"]')?.click());
  await page.waitForTimeout(600);
};
const closeSetup = async () => {
  await page.evaluate(() => document.querySelector(".clock-setup-done")?.click());
  await page.waitForTimeout(500);
};
/** 选一个预设并关闭面板，返回该档下黑方数字的渲染信息。 */
const applyPreset = async (presetId) => {
  await openSetup();
  const hit = await page.evaluate((id) => {
    const button = document.querySelector(`[data-clock-preset="${id}"]`);
    if (!button) return false;
    button.click();
    return true;
  }, presetId);
  // 预设 id 不存在时必须立刻炸掉，不能静默跳过：静默跳过会让后面的断言拿同一个
  // 状态自比——看起来通过、其实什么都没验（本门禁踩过两次：id 从 wc 改名后
  // 「短档字号 > 长档字号」变成 5 分钟跟 5 分钟比，仍然 PASS）。
  if (!hit) throw new Error(`预设 ${presetId} 不存在——门禁脚本里的 id 过期了`);
  await page.waitForTimeout(700);
  await closeSetup();
  return measureDigits();
};
/**
 * 量数字有没有跑出自己的半屏。
 * 这是「2 小时的秒数被挤出画面」那个缺陷的判据：老版本字号写死，
 * 横向撑爆自己的半屏（数字比半屏还宽），必须能被这条抓住。
 */
const measureDigits = () => page.evaluate(() => {
  const el = document.querySelector('[data-clock-time="black"]');
  const half = document.querySelector('[data-clock-side="black"]');
  if (!el || !half) return null;
  const r = el.getBoundingClientRect();
  const hr = half.getBoundingClientRect();
  return {
    text: el.textContent,
    fontSize: Math.round(parseFloat(getComputedStyle(el).fontSize)),
    overflow: r.left < hr.left - 0.5 || r.right > hr.right + 0.5,
    // 数字比半屏还宽＝严重溢出（老版本 2 小时档就是这样）
    widerThanHalf: r.width >= hr.width,
  };
});
/** 往设置面板的一个字段填值（用原生 setter，React 才收得到）。 */
const setField = async (key, value) => {
  await page.evaluate(([k, v]) => {
    const input = document.querySelector(`[data-clock-field="${k}"]`);
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [key, value]);
  await page.waitForTimeout(400);
};
/** 把总时限设成 N 分钟（分与秒两个字段都要填：只填分会保留上一次的秒）。 */
const setBaseMinutes = async (minutes) => {
  await openSetup();
  await setField("base-min", minutes);
  await setField("base-sec", 0);
  await closeSetup();
};
/**
 * 量「时限设置」浮层在当前视口下要不要滚动才能看完（用户 2026-10-01：设置要一屏看完）。
 * 返回 scrollable = 内容高 - 可视高；>0 就是还有东西藏在屏幕外。
 */
const measureSetupFit = () => page.evaluate(() => {
  const card = document.querySelector(".clock-setup-card");
  if (!card) return null;
  const done = document.querySelector(".clock-setup-done");
  const r = done?.getBoundingClientRect();
  return {
    scrollable: card.scrollHeight - card.clientHeight,
    contentH: card.scrollHeight,
    clientH: card.clientHeight,
    doneInView: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight),
  };
});

// ── T1 入口 ────────────────────────────────────────────
await clickText("\u5bf9\u5f08");
check("T1 对弈页有「比赛计时器」入口", await page.evaluate(() => Boolean(document.querySelector("[data-duel-clock-start]"))));

// ── T2 整屏覆盖层且没有棋盘 ────────────────────────────
await page.evaluate(() => document.querySelector("[data-duel-clock-start]")?.click());
await page.waitForTimeout(1400);
const layout = await page.evaluate(() => {
  const panel = document.querySelector("[data-clock-panel]");
  if (!panel) return { open: false };
  const rect = panel.getBoundingClientRect();
  return {
    open: true,
    fullWidth: Math.abs(rect.width - window.innerWidth) <= 1,
    fullHeight: Math.abs(rect.height - window.innerHeight) <= 1,
    position: getComputedStyle(panel).position,
    boardCells: document.querySelectorAll('[role="gridcell"]').length,
    boards: document.querySelectorAll(".renju-board").length,
  };
});
check("T2 计时器 fixed 且占满整屏", layout.open && layout.fullWidth && layout.fullHeight && layout.position === "fixed", JSON.stringify({ w: layout.fullWidth, h: layout.fullHeight, pos: layout.position }));
check("T2b 界面里没有棋盘（不出现棋盘与任何落点）", layout.boardCells === 0 && layout.boards === 0, `gridcells=${layout.boardCells} boards=${layout.boards}`);

// ── T3 两半 + 默认 5 分钟 ──────────────────────────────
const whiteBox = await page.evaluate(() => { const r = document.querySelector('[data-clock-side="white"]')?.getBoundingClientRect(); return r ? { top: r.top, width: r.width } : null; });
const blackBox = await page.evaluate(() => { const r = document.querySelector('[data-clock-side="black"]')?.getBoundingClientRect(); return r ? { top: r.top, width: r.width } : null; });
check("T3 上下各占一半（白在上、黑在下）", Boolean(whiteBox && blackBox) && whiteBox.top < blackBox.top && Math.abs(whiteBox.width - blackBox.width) <= 1, JSON.stringify({ whiteTop: whiteBox?.top, blackTop: blackBox?.top }));
const whiteStart = await clockText("white");
const blackStart = await clockText("black");
check("T3b 默认 5 分钟包干", /^(5:00|4:5\d)$/.test(whiteStart) || /^(5:00|4:5\d)$/.test(blackStart), `白=${whiteStart} 黑=${blackStart}`);
const fontPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-clock-time="black"]')).fontSize));
check("T3c 数字够大（≥56px）", fontPx >= 56, `${fontPx}px`);
check("T3d 开局黑方走时", (await sideState("black"))?.active === true);

// ── T3e 不按下去时间一秒都不走（用户 09-23 点名）──────
// 摆着不动 6 秒：两边的数字一个字都不许变。这条守住「点一下才开始计时」。
await page.waitForTimeout(6000);
const idleWhite = await clockText("white");
const idleBlack = await clockText("black");
const idleBlackState = await sideState("black");
check("T2c 不按下去时间一秒都不走（钟是停的）", idleWhite === whiteStart && idleBlack === blackStart, `白 ${whiteStart}→${idleWhite} 黑 ${blackStart}→${idleBlack}`);
check("T3e 初始方那半屏写着「点一下开始计时」提示",
  idleBlackState?.idle === true && idleBlackState.hint.includes("\u5f00\u59cb\u8ba1\u65f6"),
  `idle=${idleBlackState?.idle} hint=${idleBlackState?.hint}`);

// ── T4 点自己那半屏＝按下开始 ──────────────────────────
await pressHalf("black");
const started = await sideState("black");
check("T4 点黑方半屏→钟开始走（第一次按不换手）",
  started?.active === true && started?.idle === false && (await sideState("white"))?.active === false,
  `黑 active=${started?.active} idle=${started?.idle}`);
// 按下之后才开始扣时间：再等 3 秒，黑方数字必须变小。
await page.waitForTimeout(3000);
const blackRunning = await clockText("black");
check("T4b 按下之后时间才开始走", parseClock(blackRunning) < parseClock(blackStart), `按下前=${blackStart} 按下后=${blackRunning}`);

// ── T5 点对方那半屏＝交给对方；包干制不加秒 ────────────
const beforeSwitch = await clockText("black");
await pressHalf("black");
check("T5 再点黑方半屏→交给白方（整半屏是热区）", (await sideState("white"))?.active === true && (await sideState("black"))?.active === false);
const blackAfter = await clockText("black");
check("T5b 包干制不因走子加秒（剩余只减不增）", parseClock(blackAfter) <= parseClock(beforeSwitch), `走子前=${beforeSwitch} 走子后=${blackAfter}`);

// ── T6 预设 + 新能力（计时方式 / 自定义分秒 / 分组 / 翻转） ──
await openSetup();
const presets = await page.evaluate(() => [...document.querySelectorAll("[data-clock-preset]")].map((el) => ({ id: el.getAttribute("data-clock-preset"), text: (el.textContent || "").trim() })));
const has5 = presets.some((preset) => preset.id === "blitz5" && preset.text.includes("5 \u5206\u949f"));
const has20 = presets.some((preset) => preset.id === "standard20" && preset.text.includes("20 \u5206\u949f"));
check("T6 设置里有「5 分钟快棋」与「20 分钟包干」", has5 && has20, presets.slice(0, 3).map((preset) => preset.text).join(" | "));
await page.evaluate(() => document.querySelector('[data-clock-preset="standard20"]')?.click());
await page.waitForTimeout(700);
const afterPreset = await clockText("black");
check("T6b 切到 20 分钟包干立即生效", /^(20:0\d|19:5\d)$/.test(afterPreset), afterPreset);
// 改时限＝重开一局，所以又回到了「等按下」的状态——顺带把这条钉住。
check("T6c 改时限重开一局后也回到「等按下」", (await sideState("black"))?.idle === true);

// ── T6d/T6e 自定义要能填「分 + 秒」，且四种计时方式都在 ──────────
// 用户 09-23 点名：「自定义只能调整包干的时间」。所以这里真的填一个
// 1 分 30 秒这种整分表达不了的值，并断言屏上读出来就是 1:30。
const customFields = await page.evaluate(() => [...document.querySelectorAll("[data-clock-field]")].map((el) => el.getAttribute("data-clock-field")));
check("T6d 自定义有「分」和「秒」两个字段（能填非整分时限）",
  customFields.includes("base-min") && customFields.includes("base-sec"),
  customFields.join("/"));
await setField("base-min", 1);
await setField("base-sec", 30);
await closeSetup();
check("T6d2 填 1 分 30 秒后屏上就是 1:30（老版本填不出来）", (await clockText("black")) === "1:30", await clockText("black"));

await openSetup();
const modes = await page.evaluate(() => [...document.querySelectorAll("[data-clock-mode]")].map((el) => el.getAttribute("data-clock-mode")));
check("T6e 计时方式有四类可选（不再是只有包干与加秒）",
  modes.includes("fischer") && modes.includes("bronstein") && modes.includes("readOff"),
  modes.join("/"));

// 切到读秒：自定义区应该换成「读秒额度 + 次数」，并且真的按读秒跑。
await page.evaluate(() => document.querySelector('[data-clock-mode="readOff"]')?.click());
await page.waitForTimeout(600);
const yomiFields = await page.evaluate(() => [...document.querySelectorAll("[data-clock-field]")].map((el) => el.getAttribute("data-clock-field")));
check("T6e2 切到读秒后出现读秒额度与次数两个字段",
  yomiFields.includes("readoff") && yomiFields.includes("periods"),
  yomiFields.join("/"));
// 读秒是字段最多的一制（分 + 秒 + 秒/次 + 次），它装得下就代表三种都装得下。
const yomiFit = await measureSetupFit();
check("T6e2b 设置浮层一屏看完，不用滚（读秒那制字段最多）",
  Boolean(yomiFit) && yomiFit.scrollable <= 0 && yomiFit.doneInView,
  yomiFit ? `内容 ${yomiFit.contentH}px / 可视 ${yomiFit.clientH}px 要滚 ${yomiFit.scrollable}px 「知道了」在屏内=${yomiFit.doneInView}` : "浮层没打开");

// 切到延时：应出现延时额度字段。
await page.evaluate(() => document.querySelector('[data-clock-mode="bronstein"]')?.click());
await page.waitForTimeout(600);
const delayFields = await page.evaluate(() => [...document.querySelectorAll("[data-clock-field]")].map((el) => el.getAttribute("data-clock-field")));
check("T6e3 切到延时后出现延时额度字段", delayFields.includes("delay"), delayFields.join("/"));
const delayFit = await measureSetupFit();
check("T6e3b 延时那制也是一屏看完（说明文字变长不许把内容顶出屏）",
  Boolean(delayFit) && delayFit.scrollable <= 0 && delayFit.doneInView,
  delayFit ? `内容 ${delayFit.contentH}px / 可视 ${delayFit.clientH}px 要滚 ${delayFit.scrollable}px` : "浮层没打开");

// ── T6f 预设按组排、档数比原来多 ────────────────────────
const groups = await page.evaluate(() => [...document.querySelectorAll("[data-clock-preset-group]")].map((el) => el.getAttribute("data-clock-preset-group")));
check("T6f 预设按组排（连珠正式赛/国内五子棋赛/快棋超快棋/读秒/延时）",
  groups.length >= 5 && groups.includes("连珠正式赛") && groups.includes("读秒") && groups.includes("延时"),
  `${groups.length} 组：${groups.join("/")}`);
check("T6f2 预设档数比原来多（原来 7 档，且只有包干/加秒）", presets.length >= 12, `${presets.length} 档`);
// 回到包干档，后面 T7 还要用它压到 1 分钟。
await page.evaluate(() => document.querySelector('[data-clock-mode="fischer"]')?.click());
await page.waitForTimeout(500);
await closeSetup();

// ── T6g 上下互为镜像（用户 09-24 定的摆法）──────────────
// 用户 09-24 纠正：之前做的是「翻转按钮」（点一下两半一起转），是错的——
// 一个按钮只能让一种朝向生效，而两人对坐是对称的，总有人要歪着头读。
// 正确的摆法是**固定镜像**：上半天（白方）整块转 180°（那半屏正对着对面那个人），
// 下半天（黑方）不转，中控条也不转。这条钉住的就是「两半朝向必须相反」。
const mirror = await page.evaluate(() => {
  // 关键：转的是**整个半屏**（照阿Q棋钟 cn.ezandroid.aq.clock 的 fragment_clock：
  // 上半屏容器上直接 rotation=180）。之前只转内层、外层照常居中，两半就只是各自
  // 倒过来、接缝处对不上——这条同时钉住「转对元素」和「两半靠中线相接」。
  const halfW = document.querySelector('[data-clock-side="white"]');
  const halfB = document.querySelector('[data-clock-side="black"]');
  const t = (el) => getComputedStyle(el).transform;
  const is180 = (m) => /matrix\(-1,\s*0,\s*0,\s*-1/.test(m);
  const mid = window.innerHeight / 2;
  const nameMid = (el) => {
    const n = el.querySelector(".clock-half-name").getBoundingClientRect();
    return Math.round(n.top + n.height / 2 - mid);
  };
  return {
    white: t(halfW), black: t(halfB),
    whiteRotated: is180(t(halfW)), blackRotated: is180(t(halfB)),
    // 白方方名在中线上方（负）、黑方在中线下方（正）＝ 两面在中缝相接
    whiteNameMid: nameMid(halfW), blackNameMid: nameMid(halfB),
    center: getComputedStyle(document.querySelector(".clock-center")).transform,
    hasFlipButton: Boolean(document.querySelector('[data-clock-action="flip"]')),
  };
});
check("T6g 上下互为镜像：**整个上半屏**转 180°、下半屏不转",
  mirror.whiteRotated && !mirror.blackRotated,
  `白=${mirror.white} 黑=${mirror.black}`);
check("T6g5 两面在中缝相接（白方名在中线上方、黑方名在下方，不是各自居中在半屏里）",
  mirror.whiteNameMid < 0 && mirror.blackNameMid > 0,
  `白方名 ${mirror.whiteNameMid}px / 黑方名 ${mirror.blackNameMid}px（相对中线）`);
// 中控条自己有一个 translate(-50%,-50%) 用来居中，所以它的 transform 不会是 "none"：
// 判据是「矩阵的前两位是 1,0（= 没有旋转/翻转）」而不是「等于 none」。
// 写成 === "none" 会把居中位移误判成旋转（本门禁自己踩过一次）。
const noRotation = (m) => m === "none" || /^matrix\(1,\s*0,\s*0,\s*1,/.test(m);
check("T6g2 中控条不跟着转（只有居中位移，没有旋转；两边都读得到）",
  noRotation(mirror.center) && !/matrix\(-1/.test(mirror.center), mirror.center);
check("T6g3 界面上不再有「翻转」按钮（镜像不是开关，是默认摆法）",
  !mirror.hasFlipButton, `hasFlipButton=${mirror.hasFlipButton}`);
// 上半屏确实带 rotate(180deg)（这是正确摆法），所以这里不能要求 transform === "none"；
// 要验的是「旋转没有把热区弄小/移走」——两半仍各自占满半个屏幕，且仍是可点的 button。
const zonesOk = await page.evaluate(() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  return ["white", "black"].map((s) => {
    const el = document.querySelector(`[data-clock-side="${s}"]`);
    const r = el.getBoundingClientRect();
    return { side: s, tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height),
             fullW: Math.abs(r.width - vw) <= 1, halfH: Math.abs(r.height - vh / 2) <= 1 };
  });
});
check("T6g4 镜像不影响热区：两半各自仍占满整屏宽 × 半屏高、且都是可点按钮",
  zonesOk.every((z) => z.tag === "BUTTON" && z.fullW && z.halfH),
  zonesOk.map((z) => `${z.side} ${z.tag} ${z.w}x${z.h}`).join(" | "));

// ── T6h 左下读秒次数 / 右下步数（照阿Q棋钟的角标安排）────────
// 先把钟跑起来，再连按两下让黑方真正「走完一手」（第一下只是按下开始，不计手数）。
await page.evaluate(() => document.querySelector('[data-clock-action="flag-both"]') ? null : null);
await pressHalf("black", 600);
await pressHalf("black", 900);
const cornerMoves = await page.evaluate(() => {
  const el = document.querySelector('[data-clock-moves="black"]');
  return el ? el.textContent.trim() : null;
});
check("T6h 黑方走完一手后出现「N 手」角标（右下）", Boolean(cornerMoves) && cornerMoves.includes("手"), String(cornerMoves));

// ── T6i 双超时判和（连珠/五子棋规则，与国象不同）──────────
const hasDrawBtn = await page.evaluate(() => Boolean(document.querySelector('[data-clock-action="flag-both"]')));
await page.evaluate(() => document.querySelector('[data-clock-action="flag-both"]')?.click());
await page.waitForTimeout(700);
const drawState = await page.evaluate(() => ({
  result: document.querySelector("[data-clock-result]")?.getAttribute("data-clock-result"),
  text: document.querySelector(".clock-over-card b")?.textContent || "",
}));
check("T6i 控制条有「判和」，按下后判为和棋而不是某方胜",
  hasDrawBtn && drawState.result === "draw" && drawState.text.includes("和棋"),
  `result=${drawState.result} text=${drawState.text}`);
// 退出重开，避免和棋遮罩影响后面的断言
await page.evaluate(() => document.querySelector(".clock-over-actions button")?.click());
await page.waitForTimeout(800);

// ── T6j 预设按连珠/五子棋赛事时限排（RIF 打头）────────────
await openSetup();
const presetIds = await page.evaluate(() => [...document.querySelectorAll("[data-clock-preset]")].map((el) => el.getAttribute("data-clock-preset")));
const groupNames = await page.evaluate(() => [...document.querySelectorAll("[data-clock-preset-group]")].map((el) => el.getAttribute("data-clock-preset-group")));
check("T6j 预设首档是 RIF 世锦赛档（连珠正式赛打头，不是国象档位）",
  presetIds[0] === "rif-wc" && groupNames[0] === "连珠正式赛",
  `首档=${presetIds[0]} 首组=${groupNames[0]}`);
check("T6j2 有「连珠正式赛」与「国内五子棋赛」两组（这个是五子棋应用，不是国象）",
  groupNames.includes("连珠正式赛") && groupNames.includes("国内五子棋赛"),
  groupNames.join("/"));
await closeSetup();

// ── T3f 字号按时长自适应，长时段不许溢出 ────────────────
// 用户 09-23 点名：「2 个小时，那些秒数都被挤出画面外面了，这个大小还是一样」。
// 老版本字号写死，2 小时档（7 字符）必溢出。现在要按档位算出不同字号。
const shortDigits = await applyPreset("blitz5");
const longDigits = await applyPreset("rif-wc");
check("T3f 短档字号 > 长档字号（字号按时长自适应，不再写死）",
  Boolean(shortDigits && longDigits) && shortDigits.fontSize > longDigits.fontSize,
  `5 分钟=${shortDigits?.fontSize}px，2 小时=${longDigits?.fontSize}px`);
check("T3f2 2 小时档的数字完整落在自己半屏内（不再被挤出画面）",
  Boolean(longDigits) && !longDigits.overflow && !longDigits.widerThanHalf,
  `${longDigits?.text} 字号=${longDigits?.fontSize}px 溢出=${longDigits?.overflow} 比半屏宽=${longDigits?.widerThanHalf}`);
check("T3f3 短档（5 分钟）也不溢出", Boolean(shortDigits) && !shortDigits.overflow, `${shortDigits?.text} 溢出=${shortDigits?.overflow}`);
// 极短档（1 分 + 2 秒）同样要在屏内。
const tinyDigits = await applyPreset("blitz1i2");
check("T3f4 极短档（1 分 + 2 秒）也不溢出", Boolean(tinyDigits) && !tinyDigits.overflow, `${tinyDigits?.text} 溢出=${tinyDigits?.overflow}`);

// ── T7 低时间变红与超时（压到 1 分钟真实等待）──────────
await setBaseMinutes(1);
// 1 分钟那档是刚重开的，钟停着——必须按一下才会走到超时。
await pressHalf("black", 500);
check("T7 压到 1 分钟后要先按一下才开始走时", (await sideState("black"))?.idle === false);
let sawLow = false;
let result = null;
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(5000);
  const snapshot = await page.evaluate(() => ({
    low: [...document.querySelectorAll("[data-clock-low]")].some((el) => el.getAttribute("data-clock-low") === "true"),
    result: document.querySelector("[data-clock-result]")?.textContent || null,
  }));
  if (snapshot.low) sawLow = true;
  if (snapshot.result) { result = snapshot.result; break; }
}
check("T7b 剩 ≤10 秒时整半屏变红", sawLow);
check("T7c 超时判负并显示原因", Boolean(result) && result.includes("\u8d85\u65f6"), String(result));

// ── T7d 超时之后「判和」仍然要能用（2026-10-01 用户问棋钟规则时实测到它点不动）──
// 这条按钮的设计场景就是「两人都没盯钟，抬头发现两边都是 0」，而状态机在任一方走完的那一刻
// 就已经终局了：原来按钮写的是 disabled={over}，恰好在这个时刻被禁掉；
// 而且 `.clock-over` 是铺满整屏的浮层，会把中控条盖住——光看 disabled 还不够，必须真点一次。
const centerDrawEnabled = await page.evaluate(() => {
  const btn = document.querySelector('[data-clock-action="flag-both"]');
  return btn ? btn.disabled === false : false;
});
await page.click('[data-clock-action="flag-both-over"]');   // 用真实点击，浮层挡住就会在这里报错
await page.waitForTimeout(700);
const afterDraw = await page.evaluate(() => ({
  result: document.querySelector("[data-clock-result]")?.getAttribute("data-clock-result"),
  text: document.querySelector(".clock-over-card b")?.textContent || "",
}));
check("T7d 一方超时后仍可按连珠规则记和（终局卡片上的那颗要真点得到）",
  centerDrawEnabled && afterDraw.result === "draw" && afterDraw.text.includes("和棋"),
  `中控条那颗 disabled=${!centerDrawEnabled} 记和后 result=${afterDraw.result} text=${afterDraw.text}`);
await page.evaluate(() => document.querySelector(".clock-over-actions button")?.click());
await page.waitForTimeout(800);

// ── T7e 布龙斯坦延时：交钟要把本手用掉的时问还回来 ─────────────────
// 2026-10-01 实测：旧实现「思考 4 秒交钟」返还 0 秒（因为 usedMs 取的是距离上一次
// 200ms 重绘的尾巴），整个制式退化成包干。单测当时全绿——因为它们都不跑那个定时器，
// 所以这条必须放在真实浏览器里，让每 200ms 的重绘参与进来。
await openSetup();
await page.evaluate(() => document.querySelector('[data-clock-mode="bronstein"]')?.click());
await page.waitForTimeout(600);
await setField("base-min", 5);
await setField("base-sec", 0);
await setField("delay", 5);
await closeSetup();
await pressHalf("black", 400);                 // 按下开始
await page.waitForTimeout(4000);               // 黑方"思考" 4 秒，期间重绘一直在跑
const yUsed = parseClock(await clockText("black"));
await pressHalf("black", 600);                 // 交钟 → 结算
const yBack = parseClock(await clockText("black"));
check("T7e 布龙斯坦：思考 4 秒后交钟把这 4 秒还回来（用时不超过延时额度就不扣）",
  yBack >= 299 && yBack > yUsed, `思考后=${yUsed}s 交钟后=${yBack}s（延时额度 5 秒）`);

// ── T7f/T7g 布龙斯坦的延时是这一手的保护时 ────────────────
// 主时间 1 秒 + 延时 5 秒 → 本手可用 6 秒；用 3 秒既不该判负、也不该扣主时间。
// 旧实现一见主时间归零就判负，实测那时屏上是 -0:01、结果已经写成「白方胜」。
await openSetup();
await setField("base-min", 0);
await setField("base-sec", 1);
await setField("delay", 5);
await closeSetup();
await pressHalf("black", 400);
await page.waitForTimeout(3000);
const protect = await page.evaluate(() => ({
  over: Boolean(document.querySelector("[data-clock-result]")),
  text: document.querySelector('[data-clock-time="black"]')?.textContent?.trim() || "",
}));
check("T7f 布龙斯坦保护期：主时间走完 3 秒不落子也不判负（屏上负数=已吃掉的延时）",
  !protect.over, `屏上=${protect.text} 终局=${protect.over}`);
await pressHalf("black", 600);
const protectAfter = await clockText("black");
check("T7g 保护期内落子交钟，主时间一分不扣（与简单延时等价）", protectAfter === "0:01", `交钟后=${protectAfter}（应为 0:01）`);
await openSetup();
await page.evaluate(() => document.querySelector('[data-clock-mode="fischer"]')?.click());
await page.waitForTimeout(400);
await closeSetup();

// ── T8 退出 ────────────────────────────────────────────
const exitOk = await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".clock-over-actions button")].find((b) => (b.textContent || "").includes("\u9000\u51fa"))
    || document.querySelector('[data-clock-action="exit"]');
  if (!btn) return false;
  btn.click(); return true;
});
await page.waitForTimeout(900);
const gone = await page.evaluate(() => !document.querySelector("[data-clock-panel]"));
check("T8 退出后覆盖层关闭、回到原界面", exitOk && gone, `clicked=${exitOk} gone=${gone}`);

check("T9 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
