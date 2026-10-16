// 半步五子棋打谱 · 1.1.9 宣传片录制脚本
//
// 用 Playwright 驱动**真实构建**的应用界面，按 STORYBOARD.md 的 8 个镜头逐步操作（旗舰引擎优先）。
// 每个镜头一个干净的浏览器上下文（localStorage 重置），CDP screencast 采帧序列
// （784x1704，视口 392x852 @DPR2），字幕是注入页面里的浮层——所以一次成型，不需要后期烧字。
//
// 产物：
//   artifacts/promo/1.1.9/shots/sNN/frames/f00001.jpg …   帧序列（变帧率，带时间戳）
//   artifacts/promo/1.1.9/shots/sNN/concat.txt            该镜头的帧时长表
//   artifacts/promo/1.1.9/shots/manifest.json             镜头时长/帧表（compose 的输入）
//   artifacts/promo/1.1.9/shots/anomalies.json            录制过程中发现的应用异常
//
// 用法（可重跑、参数化）：
//   PROMO_URL=http://127.0.0.1:5547/?qa=1 node scripts/promo-119/record.mjs
//   PROMO_SHOTS=s1,s2 node scripts/promo-119/record.mjs     # 只重录某几个镜头（其余保留）
//   PROMO_DPR=2 PROMO_JPEG_Q=82 PROMO_FPS=30 node scripts/promo-119/record.mjs
import { chromium } from "playwright";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_URL = process.env.PROMO_URL || "http://127.0.0.1:5547/?qa=1";
const OUT = path.resolve(ROOT, process.env.PROMO_OUT || path.join("artifacts", "promo", "1.1.9"));
const SHOTS_DIR = path.join(OUT, "shots");
const FPS = Number(process.env.PROMO_FPS || 30);
const DPR = Number(process.env.PROMO_DPR || 2);
const JPEG_Q = Number(process.env.PROMO_JPEG_Q || 82);
const VW = Number(process.env.PROMO_VW || 392);
const VH = Number(process.env.PROMO_VH || 852);
const ONLY = (process.env.PROMO_SHOTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const FRAME_MIN = 1000 / (FPS * 2);
const TAB_LABEL = { record: "打谱", library: "棋谱库", duel: "对弈", settings: "设置" };

/* ---------------------------------------------------------------- 字幕浮层 */

const CAPTION_CSS = `
.promo-cap{position:fixed;left:10px;right:10px;bottom:96px;z-index:2147483000;display:flex;justify-content:center;pointer-events:none;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.promo-cap .box{opacity:0;transform:translateY(12px) scale(.98);transition:opacity .34s cubic-bezier(.2,.7,.3,1),transform .34s cubic-bezier(.2,.7,.3,1);background:rgba(16,17,20,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);border-radius:15px;padding:9px 15px;max-width:100%;text-align:center;box-shadow:0 8px 26px rgba(0,0,0,.38)}
.promo-cap.on .box{opacity:1;transform:none}
.promo-cap .t{display:block;color:#fff;font-size:18px;font-weight:700;line-height:1.3;letter-spacing:.4px;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.promo-cap .t::before{content:"";display:inline-block;width:4px;height:14px;border-radius:2px;background:#e6b45c;margin-right:9px;vertical-align:-1px}
.promo-cap .s{display:block;margin-top:4px;color:rgba(255,255,255,.74);font-size:12.5px;line-height:1.35}
.promo-cap .bar{display:block;height:2px;margin-top:7px;border-radius:2px;background:linear-gradient(90deg,#e6b45c,#f6dfae);transform-origin:left center;animation:promo-bar 3.6s cubic-bezier(.4,0,.6,1) infinite}
@keyframes promo-bar{0%{transform:scaleX(.04);opacity:.5}55%{transform:scaleX(1);opacity:1}100%{transform:scaleX(.04);opacity:.5}}
.promo-end{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(8,9,11,.87);opacity:0;transition:opacity .55s ease;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.promo-end.on{opacity:1}
.promo-end .card{text-align:center;padding:24px 28px;border:1px solid rgba(230,180,92,.42);border-radius:22px;background:rgba(20,21,25,.92);box-shadow:0 20px 60px rgba(0,0,0,.55)}
.promo-end .mark{width:58px;height:58px;margin:0 auto 12px;border-radius:17px;background:linear-gradient(150deg,#f0c674,#c98b2c);color:#171307;font-size:32px;font-weight:800;display:flex;align-items:center;justify-content:center}
.promo-end .name{color:#fff;font-size:21px;font-weight:800;letter-spacing:1px}
.promo-end .ver{margin-top:8px;color:#f0c674;font-size:36px;font-weight:800;letter-spacing:.5px}
.promo-end .code{margin-top:2px;color:rgba(255,255,255,.6);font-size:13px;letter-spacing:1.2px}
.promo-end .eng{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.82);font-size:12.5px;line-height:1.65}
.promo-end .shine{display:block;height:2px;margin-top:16px;border-radius:2px;background:linear-gradient(90deg,transparent,#e6b45c,transparent);animation:promo-shine 2.4s linear infinite}
@keyframes promo-shine{0%{transform:translateX(-46%);opacity:.25}50%{opacity:1}100%{transform:translateX(46%);opacity:.25}}
`;

async function installCaption(page) {
  await page.addStyleTag({ content: CAPTION_CSS }).catch(() => {});
  await page.evaluate(() => {
    document.getElementById("promo-caption")?.remove();
    const el = document.createElement("div");
    el.id = "promo-caption";
    el.className = "promo-cap";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<div class="box"><b class="t"></b><small class="s"></small><i class="bar"></i></div>';
    document.body.appendChild(el);
  });
}

/* ---------------------------------------------------------------- 操作原语
   一律走 DOM 层点击（scrollIntoView -> el.click()），**不用 Playwright 的 force 点击**：
   force 会跳过稳定性等待，长列表里 scrollIntoView 之后按旧坐标点下去，会点到滚动后
   恰好移到那个位置的元素上（实测把「设置 → 主题」点成了底栏「棋谱库」，整段镜头跑偏）。
   仓库既有的 QA 脚本也都是这个口径。 */

const domClickText = (page, text, sel, exact) => page.evaluate(({ text, sel, exact }) => {
  const n = (s) => (s || "").replace(/\s+/g, "");
  const pool = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
  const hit = (exact ? pool.find((e) => n(e.textContent) === n(text)) : null)
    || pool.find((e) => n(e.textContent).includes(n(text)))
    || pool.find((e) => n(e.getAttribute("aria-label") || "").includes(n(text)));
  if (!hit) return false;
  hit.scrollIntoView({ block: "center", behavior: "instant" });
  hit.click();
  return true;
}, { text, sel, exact });

const domClickSel = (page, sel, i) => page.evaluate(({ sel, i }) => {
  const el = [...document.querySelectorAll(sel)][i];
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.click();
  return true;
}, { sel, i });

async function tapText(rec, page, text, opts = {}) {
  const ok = await domClickText(page, text, opts.sel || "button,a,[role=radio],[role=tab],[role=button],label", !!opts.exact);
  if (!ok) rec.anomaly(`点不到「${text}」${opts.where ? `（${opts.where}）` : ""}`);
  return ok;
}

async function tapSel(rec, page, selector, index = 0) {
  const ok = await domClickSel(page, selector, index);
  if (!ok) rec.anomaly(`点不到 ${selector}`);
  return ok;
}

/** 落一子（点 SVG 的 <circle role=gridcell>）；判据是 aria-label 变成「已有棋子」。 */
async function playStone(rec, page, coord) {
  const ok = await page.evaluate((c) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(c));
    if (!cell) return false;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, coord);
  if (!ok) { rec.anomaly(`棋盘上找不到交叉点 ${coord}`); return false; }
  await page.waitForTimeout(150);
  const placed = await page.evaluate((c) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(c));
    return !!cell && (cell.getAttribute("aria-label") || "").includes("已有棋子");
  }, coord).catch(() => false);
  if (!placed) rec.anomaly(`落子 ${coord} 后盘面没有棋子（点了没反应）`);
  return placed;
}

async function expectState(rec, page, label, fn, { timeout = 6000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let v = false;
    try { v = await page.evaluate(fn); } catch { v = false; }
    if (v) return true;
    if (Date.now() > deadline) break;
    await page.waitForTimeout(interval);
  }
  rec.anomaly(`等不到「${label}」（${timeout}ms 超时）`);
  return false;
}

/* ---------------------------------------------------------------- 帧采集 */

/** 采集方式：CDP `Page.startScreencast`。
 *  试过 `Page.captureScreenshot`：能给到 DPR2 的 784x1704 清晰帧，但它会挤掉 Playwright 的输入
 *  （落子全部点不中）、并发还抓到过空白帧；`Emulation.setDeviceMetricsOverride` 也会让点击错位。
 *  screencast 只给 CSS 尺寸（392x852，无视 DPR），但**完全不干扰操作**、能到 ~40fps，
 *  清晰度交给 compose 用 lanczos 放大 + unsharp 找回。 */
function makeCapture(cdp, frameDir) {
  const state = { frames: [], writes: [], t0: 0, idx: 0, lastT: -1e9, dropped: 0 };
  const onFrame = (f) => {
    const ack = () => cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    const t = Date.now() - state.t0;
    if (t - state.lastT < FRAME_MIN) { state.dropped += 1; void ack(); return; }
    state.lastT = t;
    const name = `f${String(state.idx + 1).padStart(5, "0")}.jpg`;
    state.idx += 1;
    state.frames.push({ f: name, t });
    state.writes.push(writeFile(path.join(frameDir, name), Buffer.from(f.data, "base64")).catch(() => {}));
    void ack();
  };
  return {
    state,
    async start() {
      await rm(frameDir, { recursive: true, force: true });
      await mkdir(frameDir, { recursive: true });
      cdp.on("Page.screencastFrame", onFrame);
      state.t0 = Date.now();
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: JPEG_Q, everyNthFrame: 1 });
    },
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      cdp.off("Page.screencastFrame", onFrame);
      await new Promise((r) => setTimeout(r, 200));       // 最后几张还在飞的帧落完
      await Promise.all(state.writes);
    },
  };
}

/** 帧表 -> 每帧停留时长，写 concat.txt（路径相对 concat.txt 所在目录，便于搬动/重跑） */
async function writeConcat(shotDir, frames, shotSeconds) {
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : shotSeconds * 1000;
    let d = (next - frames[i].t) / 1000;
    if (!(d > 0)) d = 1 / FPS;
    lines.push(`file 'frames/${frames[i].f}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file 'frames/${frames[frames.length - 1].f}'`);
  await writeFile(path.join(shotDir, "concat.txt"), lines.join("\n") + "\n", "utf8");
}

/* ---------------------------------------------------------------- 镜头定义
   seed = 镜头开始前先把界面备好的东西（不进视频）；run = 镜头里的真实操作。 */

const SHOTS = [
  {
    id: "s1", title: "旗舰引擎 KataGo（引擎与模型介绍）", seconds: 5.0,
    caption: ["旗舰引擎 · KataGo 进正式版", "安卓随包自带 · 小网 3.2MB / int8 大网 21.9MB"],
    seed: { tab: "settings" },
    async run(A) {
      await A.cap();
      await A.tapText("关于半步五子棋打谱", { where: "设置底部" });
      await A.wait(350);
      await A.tapSel('[data-about-entry="engine"]');
      await A.expect("引擎与模型介绍页出现", () => !!document.querySelector('[data-about-view="engine"] [data-engine-list]'), { timeout: 6000 });
      await A.wait(300);
      await A.scrollTo('[data-engine-list] li:nth-child(3)');
      await A.wait(500);
      await A.scrollTo('[data-engine-list] li:nth-child(4)');
      await A.wait(800);
    },
  },
  {
    id: "s2", title: "打谱落子", seconds: 4.0,
    caption: ["打谱 · 点一下就是落子", "手数 · 最后一手标记 · 分支记录"],
    seed: { tab: "record" },
    async run(A) {
      await A.cap();
      for (const c of ["H8", "I9", "G7", "J10", "F6"]) { await A.play(c); await A.wait(380); }
      await A.expect("顶部手数走到第 5 手", () => /第\s*5\s*手/.test(document.body.textContent || ""), { timeout: 4000 });
      await A.wait(300);
    },
  },
  {
    id: "s3", title: "分析面板候选点", seconds: 4.5,
    caption: ["分析 · 本机引擎给候选点", "内置 rapfi 0.43.02 · 断网可用 · 仅供参考"],
    seed: { tab: "record", moves: ["H8", "I9", "G7", "J10"] },
    async run(A) {
      await A.cap();
      await A.tap("分析");                                            // 打开分析面板
      await A.wait(350);
      await A.tapSel(".ai-analysis-head .analysis-toggle input");     // 面板头部的持续分析总开关
      await A.expect("持续分析开关已打开", () => {
        const i = document.querySelector(".ai-analysis-head .analysis-toggle input");
        return !!i && i.checked;
      }, { timeout: 3000 });
      await A.expect("候选点列表出现", () => !!document.querySelector(".ai-analysis-candidates .analysis-candidate-chip"), { timeout: 14000 });
      await A.expect("引擎统计出数字", () => /[0-9]/.test(document.querySelector(".ai-analysis-stats")?.textContent || ""), { timeout: 8000 });
      await A.wait(700);
    },
  },
  {
    id: "s4", title: "人机对弈", seconds: 4.5,
    caption: ["对弈 · 和 AI 下一盘", "开局前把规则、难度、时间一次配好"],
    seed: { tab: "record" },
    async run(A) {
      await A.cap();
      await A.openTab("duel");
      await A.wait(350);
      await A.tapSel('[aria-label="开始 AI 对战"]');
      await A.wait(350);
      await A.tapSel(".ai-start-button");
      await A.expect("进入人机对局界面", () => !!document.querySelector("[data-duel-screen]"), { timeout: 9000 });
      await A.wait(400);
      await A.play("H8");
      await A.wait(500);
      await A.expect("AI 接手（思考中或已应子）", () => {
        const busy = !!document.querySelector("[data-duel-thinking]");
        const stones = document.querySelectorAll('[role="gridcell"][aria-label*="已有棋子"]').length;
        return busy || stones >= 2;
      }, { timeout: 12000 });
      await A.wait(400);
    },
  },
  {
    id: "s5", title: "比赛计时器（读秒）", seconds: 4.0,
    caption: ["比赛计时器 · 读秒制式", "对面那半屏是正的 · 一人一半"],
    seed: { tab: "duel" },
    async run(A) {
      await A.cap();
      await A.tapSel('[aria-label="打开比赛计时器"]');
      await A.expect("全屏棋钟出现", () => !!document.querySelector("[data-clock-panel]"), { timeout: 6000 });
      await A.wait(350);
      await A.tapSel('[aria-label="时限设置"]');
      await A.wait(300);
      await A.tapText("读秒", { sel: '[data-clock-setup] .clock-modes button', where: "棋钟设置" });
      await A.wait(300);
      await A.tapSel('[aria-label="关闭设置"]');
      await A.wait(350);
      await A.tapSel('[data-clock-side="black"]');          // 先走方按下 = 开始走时
      await A.wait(600);
      await A.tapSel('[data-clock-side="white"]');          // 交钟
      await A.wait(400);
      await A.expect("钟面读数在走", () => {
        const b = document.querySelector('[data-clock-time="black"]')?.textContent || "";
        return /\d/.test(b);
      }, { timeout: 3000 });
    },
  },
  {
    id: "s6", title: "外观换主题 + 公用效果实时预览", seconds: 6.0,
    caption: ["外观 · 主题一套一换", "「公用效果」：落子交互与棋子进场，切换即刻预览"],
    seed: { tab: "record" },
    async run(A) {
      await A.cap();
      await A.openTab("settings");
      await A.wait(600);
      for (const t of ["夜雨江南", "青花瓷影", "尊贵黑金"]) {
        await A.tapText(t, { sel: ".app-shell button", where: "主题" });
        await A.wait(400);
      }
      await A.scrollTo('[aria-label="公用效果预览棋盘"]');
      await A.wait(300);
      await A.select("落子交互方案", "pl-petal");
      await A.wait(500);
      await A.select("棋子进场方案", "dp-jelly");
      await A.wait(500);
      await A.tapSel('[aria-label="重播预览动画"]');
      await A.wait(600);
    },
  },
  {
    id: "s7", title: "界面字号「特大字」前后对比", seconds: 3.0,
    caption: ["看得清 · 界面字号特大字", "100% → 130% · 棋盘不会被挤出屏幕"],
    seed: { tab: "settings", fontScale: "normal" },
    async run(A) {
      await A.cap();
      await A.scrollTo('[role="radiogroup"][aria-label="界面字号"]');
      await A.wait(350);
      await A.tapText("正常", { sel: '[role="radiogroup"][aria-label="界面字号"] button', exact: true, where: "字号" });
      await A.wait(500);
      await A.tapText("特大字", { sel: '[role="radiogroup"][aria-label="界面字号"] button', where: "字号" });
      await A.expect("字号组里选中的是特大字", () => document.querySelector('[aria-label="界面字号"] .selected')?.textContent?.includes("特大字") ?? false, { timeout: 3000 });
      await A.scrollTo('[role="radiogroup"][aria-label="界面字号"]');   // 重排之后把它拉回画面里
      await A.wait(900);
    },
  },
  {
    id: "s8", title: "结尾版本卡", seconds: 3.0,
    caption: null,
    seed: { tab: "record", moves: ["H8", "I9"] },
    async run(A) {
      await A.endCard({
        name: "半步五子棋打谱",
        version: "1.1.9",
        code: "versionCode 65",
        engines: "安卓旗舰 KataGo · b10c128 3.2MB + b24c256 int8 21.9MB<br>内置 rapfi 0.43.02 · 网页与安卓同步",
      });
      await A.wait(2300);
    },
  },
];

/* ---------------------------------------------------------------- 单镜头 */

async function runShot(shot, browser, anomalies) {
  const shotDir = path.join(SHOTS_DIR, shot.id);
  const frameDir = path.join(shotDir, "frames");
  const shotAnomalies = [];
  const rec = { anomaly: (msg) => { shotAnomalies.push(msg); anomalies.push({ shot: shot.id, title: shot.title, msg }); } };

  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true,
    serviceWorkers: "block", locale: "zh-CN", timezoneId: "Asia/Shanghai",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => rec.anomaly(`页面抛错 pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") rec.anomaly(`控制台报错: ${m.text().slice(0, 200)}`); });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/onnx-shibie|engine-packs|favicon/.test(u)) return;    // 可选资源，缺失是预期内
    rec.anomaly(`请求失败 ${u.replace(/^https?:\/\/[^/]/, "").slice(0, 120)} (${r.failure()?.errorText || "?"})`);
  });

  // 首启欢迎遮罩 / 新手引导是会挡住点击的模态，一律预先关掉
  await page.addInitScript(() => {
    try {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-onboarding-tour-v1", "seen");
      localStorage.setItem("banbu-motion-enabled-v2", "true");
      // 录制环境关掉自动检查更新：它一进页面就后台打 github/gh-pages/jsDelivr，
      // 请求还没回来镜头就切走，perf 上记成 ERR_ABORTED，会在 anomalies.json 里混进
      // 与视频无关的网络失败（2026-10-02 实测 9 条）。真机上这些请求会正常完成。
      localStorage.setItem("banbu-update-auto-check-v1", "false");
      if (localStorage.getItem("banbu-font-scale-v1") === "REMOVE_ME") localStorage.removeItem("banbu-font-scale-v1");
    } catch {}
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  let ready = await expectState(rec, page, "应用外壳渲染完成", () => !!document.querySelector(".app-shell") && (document.getElementById("root")?.textContent || "").length > 20, { timeout: 12000 });
  if (!ready) {
    // 白屏多半是**并行的那次 vite build 正好换掉了 dist 的哈希文件名**（index.html 指向老资源 -> 404）。
    // 如实记一条异常，然后重载一次再走，别把整条镜头废掉。
    rec.anomaly("首屏白屏/资源 404，重载一次重试（若并行会话正在重建 dist 会出现）");
    await page.reload({ waitUntil: "domcontentloaded" });
    ready = await expectState(rec, page, "重载后应用外壳渲染完成", () => !!document.querySelector(".app-shell") && (document.getElementById("root")?.textContent || "").length > 20, { timeout: 20000 });
  }
  await page.waitForTimeout(1200);

  const api = makeApi(rec, page, shot);

  /* --- 备场（不进视频） --- */
  if (shot.seed?.fontScale) {
    await page.evaluate((v) => { try { localStorage.setItem("banbu-font-scale-v1", v); } catch {} }, shot.seed.fontScale);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectState(rec, page, "改字号后外壳重新就绪", () => !!document.querySelector(".app-shell"), { timeout: 15000 });
    await page.waitForTimeout(900);
  }
  if (shot.seed?.tab && shot.seed.tab !== "record") await api.gotoTab(shot.seed.tab);
  else if (shot.seed?.tab) await api.gotoTab("record");
  for (const c of shot.seed?.moves || []) { await playStone(rec, page, c); await page.waitForTimeout(420); }
  if (shot.seed?.moves?.length) await page.waitForTimeout(600);

  await installCaption(page);              // 字幕浮层要在所有 reload 之后装
  await page.waitForTimeout(400);

  /* --- 开拍 --- */
  const cdp = await ctx.newCDPSession(page);
  const cap = makeCapture(cdp, frameDir);
  await cap.start();
  const t0 = Date.now();
  try { await shot.run(api); }
  catch (e) { rec.anomaly(`镜头脚本自身异常: ${String(e).slice(0, 220)}`); }
  const elapsed = (Date.now() - t0) / 1000;
  const seconds = Number(Math.max(shot.seconds, elapsed + 0.15).toFixed(3));
  await cap.stop();
  await cdp.detach().catch(() => {});

  if (!cap.state.frames.length) rec.anomaly("一帧都没采到（检查 screencast 是否被节流）");
  else await writeConcat(shotDir, cap.state.frames, seconds);

  await ctx.close();
  return {
    id: shot.id, title: shot.title, caption: shot.caption,
    requestedSeconds: shot.seconds, seconds,
    frameCount: cap.state.frames.length,
    droppedFrames: cap.state.dropped,
    frames: cap.state.frames.map((f) => ({ f: `${shot.id}/frames/${f.f}`, t: f.t })),
    anomalies: shotAnomalies,
  };
}

function makeApi(rec, page, shot) {
  const setCaption = (on, main, sub) => page.evaluate(({ on, main, sub }) => {
    const el = document.getElementById("promo-caption");
    if (!el) return;
    el.querySelector(".t").textContent = main || "";
    el.querySelector(".s").textContent = sub || "";
    el.classList.toggle("on", !!on);
  }, { on, main, sub }).catch(() => {});

  return {
    page,
    clearToast: () => page.evaluate(() => {
      const btn = document.querySelector(".app-toast-close");
      if (btn) btn.click();
      return !!btn;
    }).catch(() => false),
    cap: async (delay = 0.35) => {
      await page.waitForTimeout(delay);
      await page.evaluate(() => document.querySelector(".app-toast-close")?.click()).catch(() => {});  // 应用的提示条会压在同一块位置，先收掉
      const [m, s] = shot.caption || [];
      await setCaption(true, m, s);
    },
    capOff: () => setCaption(false),
    openTab: (tab) => tapText(rec, page, TAB_LABEL[tab] || tab, { sel: ".bottom-nav button", exact: true, where: "底栏" }),
    gotoTab: async (tab) => { await tapText(rec, page, TAB_LABEL[tab] || tab, { sel: ".bottom-nav button", exact: true, where: "底栏" }); await page.waitForTimeout(800); },
    tap: (t, o = {}) => tapText(rec, page, t, o),
    tapText: (t, o = {}) => tapText(rec, page, t, o),
    tapSel: (s, i = 0) => tapSel(rec, page, s, i),
    play: (c) => playStone(rec, page, c),
    select: async (ariaLabel, value) => {
      // 用 DOM 层赋值 + 派发 change（Playwright 的 selectOption 在有同名重复控件时会 strict 报错，
      // 而换主题之后确实会多出一套同名下拉，这里按「可见的那个」来选）
      const ok = await page.evaluate(({ ariaLabel, value }) => {
        const list = [...document.querySelectorAll(`select[aria-label="${ariaLabel}"]`)].filter((s) => s.getBoundingClientRect().width > 2);
        const sel = list.find((s) => [...s.options].some((o) => o.value === value));
        if (!sel) return "no-target";
        sel.scrollIntoView({ block: "center", behavior: "instant" });
        sel.value = value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return "ok";
      }, { ariaLabel, value });
      if (ok !== "ok") { rec.anomaly(`下拉「${ariaLabel}」选不到 ${value}（${ok}）`); return false; }
      return true;
    },
    scrollTo: async (sel, i = 0) => {
      const ok = await page.evaluate(({ sel, i }) => {
        const el = [...document.querySelectorAll(sel)][i];
        if (!el) return false;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        return true;
      }, { sel, i });
      if (!ok) rec.anomaly(`滚不到 ${sel}`);
      return ok;
    },
    expect: (label, fn, o = {}) => expectState(rec, page, label, fn, o),
    wait: (ms) => page.waitForTimeout(ms),
    endCard: async ({ name, version, code, engines }) => {
      await page.evaluate(({ name, version, code, engines }) => {
        document.getElementById("promo-caption")?.classList.remove("on");
        document.getElementById("promo-end")?.remove();
        const el = document.createElement("div");
        el.id = "promo-end";
        el.className = "promo-end";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = `<div class="card"><div class="mark">半</div><div class="name">${name}</div>`
          + `<div class="ver">${version}</div><div class="code">${code}</div>`
          + `<div class="eng">${engines}</div><i class="shine"></i></div>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add("on"));
      }, { name, version, code, engines });
    },
  };
}

/* ---------------------------------------------------------------- 主流程 */

await mkdir(SHOTS_DIR, { recursive: true });
const selected = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.id));
if (!selected.length) { console.error(`PROMO_SHOTS 里没有已知镜头（可选 ${SHOTS.map((s) => s.id).join(",")}）`); process.exit(2); }
if (!ONLY.length) await rm(SHOTS_DIR, { recursive: true, force: true }).then(() => mkdir(SHOTS_DIR, { recursive: true }));
for (const s of selected) await rm(path.join(SHOTS_DIR, s.id), { recursive: true, force: true });

console.log(`[promo-record] 应用   ${APP_URL}`);
console.log(`[promo-record] 输出   ${OUT}`);
console.log(`[promo-record] 画幅   视口 ${VW}x${VH} @DPR${DPR} -> screencast 帧 ${VW}x${VH}（无视 DPR），目标 ${FPS}fps`);
console.log(`[promo-record] 镜头   ${selected.map((s) => s.id).join(", ")}\n`);

const browser = await chromium.launch({ headless: true });
const anomalies = [];
const results = [];
for (const shot of selected) {
  const t0 = Date.now();
  console.log(`=== ${shot.id} ${shot.title}（目标 ${shot.seconds}s）===`);
  const r = await runShot(shot, browser, anomalies);
  results.push(r);
  console.log(`    帧 ${r.frameCount}（丢掉 ${r.droppedFrames}）/ 实长 ${r.seconds.toFixed(2)}s / 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s / 异常 ${r.anomalies.length}`);
  r.anomalies.forEach((a) => console.log(`    ! ${a}`));
}
await browser.close();

/* 只重录部分镜头时，把没重录的镜头从旧 manifest 里接回来，保持顺序 */
const manifestPath = path.join(SHOTS_DIR, "manifest.json");
let merged = results;
if (ONLY.length) {
  let prev = [];
  try { prev = JSON.parse(await readFile(manifestPath, "utf8")).shots || []; } catch {}
  const byId = new Map(results.map((r) => [r.id, r]));
  merged = [...prev.filter((p) => !byId.has(p.id)), ...results].sort((a, b) => a.id.localeCompare(b.id));
}
const manifest = {
  generatedAt: new Date().toISOString(), appUrl: APP_URL, fps: FPS, dpr: DPR,
  captureSize: { width: VW, height: VH }, viewport: { width: VW, height: VH },
  shots: merged,
  totalSeconds: Number(merged.reduce((a, b) => a + b.seconds, 0).toFixed(3)),
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
await writeFile(path.join(SHOTS_DIR, "anomalies.json"), JSON.stringify(anomalies, null, 2), "utf8");

console.log(`\n[promo-record] 合计 ${manifest.totalSeconds}s，${merged.reduce((a, b) => a + (b.frameCount || 0), 0)} 帧`);
console.log(`[promo-record] 本轮异常 ${anomalies.length} 条 -> ${path.join(SHOTS_DIR, "anomalies.json")}`);
if (anomalies.length) { console.log("---- 应用异常 ----"); anomalies.forEach((a) => console.log(` [${a.shot}] ${a.title}: ${a.msg}`)); }
