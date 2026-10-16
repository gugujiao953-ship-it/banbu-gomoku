/**
 * qa/android-bridge.mjs — 真机调试通道（用户 2026-10-09 提议：「搞一个专门适配大模型调试的模式功能…
 * 以后你点击按钮什么的，要做什么操作什么的，就用后台代码操作就行了」）。
 *
 * 痛点（这次排查 K20 主题问题实测）：
 *   · `adb shell input tap X Y` 按**设备像素**点屏幕 —— 每次都要先 uiautomator dump 找 bounds，
 *     稍不留神点偏就点到别的标签（实测点「设置」点进了「对弈」好几次）；
 *   · 截图只能看画面，看不到 DOM / computed style / 控制台报错，出问题只能靠推理；
 *   · `console.log` 在 WebView 里**不进 logcat**，真机上等于没有日志。
 *
 * 做法：走 **Chrome DevTools 协议（CDP）** 直连 WebView ——
 *   `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>` → 拿 ws 地址 → WebSocket 发命令。
 *   于是可以 `Runtime.evaluate` 任意 JS：读状态、按**可见文字**点按钮、切主题、截图、读 console 错误。
 *   刻意**不依赖 Playwright**：WebView 不是 Chrome 浏览器实例，直接用 Node 自带的 WebSocket 更可靠，
 *   也少一层"Playwright 是否接受这个 target"的不确定性。
 *
 * ⚠ 前置条件：应用必须是 **debug 构建**（`MainActivity` 里 `getPackageName().endsWith(".debug")`
 *   时才调 `WebView.setWebContentsDebuggingEnabled(true)`）—— release 包不开发调端口。
 *
 * 用法（CLI）：
 *   node qa/android-bridge.mjs state                  # 打印关键状态
 *   node qa/android-bridge.mjs eval "document.title"  # 任意求值
 *   node qa/android-bridge.mjs click "外观与音效"       # 按可见文字点（第 3 参数＝第几个）
 *   node qa/android-bridge.mjs theme plum             # 切主题（写偏好 + 重载 + 等待）
 *   node qa/android-bridge.mjs shot out.png           # 截图存文件
 *   node qa/android-bridge.mjs probe ".moves-row button.accent"   # 元素尺寸/颜色/可见性
 *   node qa/android-bridge.mjs errors                 # 控制台错误（需 __bb 已挂）
 *
 * 也作为模块导出（`connect()`），供其它 qa 脚本复用 —— 这是"以后用 API 自动操作应用"的底座。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

const ADB = process.env.ADB
  || (existsSync("artifacts/tools/android-sdk/platform-tools/adb.exe")
    ? "artifacts/tools/android-sdk/platform-tools/adb.exe"
    : "adb");
const PKG = process.env.ANDROID_PKG || "cn.renjunote.mobile.debug";
const PORT = Number(process.env.CDP_PORT || 9333);
/** 目标设备序列号（可留空＝唯一设备）。adb 在有多设备/离线设备时会拒绝执行，显式指定更稳。 */
const SERIAL = process.env.ANDROID_SERIAL || "";

const adb = (...args) => execFileSync(ADB, SERIAL ? ["-s", SERIAL, ...args] : args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** 找到应用的 WebView pid（devtools socket 名里带着它）。 */
const webviewPid = () => {
  const out = adb("shell", "cat /proc/net/unix");
  const names = [...out.matchAll(/webview_devtools_remote(?:_(\d+))?/g)].map((m) => m[1]).filter(Boolean);
  if (!names.length) throw new Error("没找到 WebView 调试 socket —— 应用是 release 包，或没在运行");
  return names.map(Number).sort((a, b) => b - a)[0];
};

/** 极简 CDP 客户端：一条命令 = 一个 id，等它的返回。 */
const openCdp = (wsUrl) => {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const waiting = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(new Error("WS 连接失败：" + String(e?.message || e))));
  });
  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.id === undefined) return;                 // 事件（console 等），本工具不订阅
    const slot = waiting.get(msg.id);
    if (!slot) return;
    waiting.delete(msg.id);
    if (msg.error) slot.reject(new Error(`${slot.method}: ${msg.error.message}`));
    else slot.resolve(msg.result);
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (waiting.delete(id)) reject(new Error(`${method} 超时`)); }, 20000);
    });
  };
  return { send, close: () => ws.close() };
};

/** 连接设备上的 WebView，返回可复用会话。 */
export async function connect() {
  const pid = webviewPid();
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const target = list.find((t) => t.type === "page") || list[0];
  if (!target?.webSocketDebuggerUrl) throw new Error(`CDP 目标里没有 page：${JSON.stringify(list).slice(0, 200)}`);
  const cdp = openCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");

  /** 在页面里求值。传进来的 expression 是**表达式**（会被 return 包一层）。 */
  const evaluate = async (expression) => {
    const res = await cdp.send("Runtime.evaluate", {
      expression: `(() => { ${HELPERS} return (${expression}); })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`页面求值异常：${String(msg).slice(0, 300)}`);
    }
    return res?.result?.value;
  };
  /** 跑一段语句（不要求返回值）。 */
  const run = (statements) => evaluate(`(() => { ${statements} })()`);

  const screenshot = async () => {
    const res = await cdp.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(res.data, "base64");
  };
  const reload = async (waitMs = 3000) => {
    await cdp.send("Page.reload", {});
    await new Promise((r) => setTimeout(r, waitMs));
  };
  return { pid, target, evaluate, run, screenshot, reload, close: () => cdp.close() };
}

/** 页面内的辅助函数（注入到每次求值的闭包里，随用随建、不污染全局）。 */
export const HELPERS = `
const __vis = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 6 || r.height < 6) return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0" && !el.disabled;
};
const __byText = (text, index = 0) => {
  const want = String(text).replace(/\\s+/g, "");
  const all = [...document.querySelectorAll("button,[role=button],a,summary,label,.workspace-action")];
  const vis = all.filter(__vis);
  const norm = (s) => String(s || "").replace(/\\s+/g, "");
  const exact = vis.filter((el) => norm(el.textContent) === want);
  const pool = exact.length ? exact : vis.filter((el) => norm(el.textContent).includes(want));
  return pool[index] || null;
};
`;

const CLI = async () => {
  const [cmd, arg, arg2] = process.argv.slice(2);
  if (!cmd || cmd === "help") {
    console.log(`用法：
  state                      关键状态（主题/各层/底栏底色/透明度变量）
  eval "<表达式>"             任意求值
  click "<文字>" [第几个]      按可见文字点按钮
  theme <id>                 切主题（写偏好 + 重载）
  shot <文件> [宽高]          截图（默认原始分辨率）
  probe "<选择器>"            元素尺寸/颜色/可见性（含其中的 svg 尺寸）
  errors                     控制台错误（需 __bb）
  tap <x> <y>                兜底：按坐标点（不推荐）

环境变量：ANDROID_PKG（默认 ${PKG}）、ADB、CDP_PORT（默认 ${PORT}）`);
    return;
  }
  const s = await connect();
  try {
    if (cmd === "state") {
      console.log(JSON.stringify(await s.evaluate(`({
        theme: document.documentElement.dataset.theme,
        legacy: document.documentElement.classList.contains("legacy-webview"),
        scene: (document.querySelector(".theme-scene") ? getComputedStyle(document.querySelector(".theme-scene")).display : "无"),
        ride: (document.querySelector(".ts-ride") ? [getComputedStyle(document.querySelector(".ts-ride")).width, getComputedStyle(document.querySelector(".ts-ride")).height] : "无"),
        navBg: (document.querySelector(".bottom-nav") ? getComputedStyle(document.querySelector(".bottom-nav")).backgroundColor : "无"),
        actionAlpha: document.documentElement.dataset.actionAlpha || null,
        paperAlpha: getComputedStyle(document.documentElement).getPropertyValue("--paper-with-alpha").trim() || null,
        viewport: [innerWidth, innerHeight],
      })`), null, 1));
    } else if (cmd === "eval") {
      console.log(JSON.stringify(await s.evaluate(`(${arg})`), null, 1));
    } else if (cmd === "click") {
      console.log(JSON.stringify(await s.evaluate(`(() => {
        const el = __byText(${JSON.stringify(arg)}, ${Number(arg2) || 0});
        if (!el) return { ok: false, reason: "找不到可见的「" + ${JSON.stringify(arg)} + "」" };
        const info = { tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 24) };
        el.click();
        return { ok: true, ...info };
      })()`)));
    } else if (cmd === "theme") {
      await s.run(`localStorage.setItem("banbu-theme-preference-v1", ${JSON.stringify(arg)});`);
      await s.reload(3500);
      console.log(JSON.stringify({ ok: true, theme: await s.evaluate("document.documentElement.dataset.theme"), legacy: await s.evaluate("document.documentElement.classList.contains('legacy-webview')") }));
    } else if (cmd === "errors") {
      console.log(JSON.stringify(await s.evaluate("(window.__bb && window.__bb.log && window.__bb.log()) || []"), null, 1));
    } else if (cmd === "probe") {
      console.log(JSON.stringify(await s.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(arg)});
        if (!el) return { found: false };
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        const svgs = [...el.querySelectorAll("svg")].map((sv) => {
          const b = sv.getBoundingClientRect(); const sc = getComputedStyle(sv);
          return { box: [Math.round(b.width), Math.round(b.height)], color: sc.color, opacity: sc.opacity, fill: sc.fill };
        });
        return { found: true, box: [Math.round(r.width), Math.round(r.height)], display: cs.display,
          color: cs.color, background: cs.backgroundColor, opacity: cs.opacity,
          hasAccent: el.classList.contains("accent"), svgs };
      })()`), null, 1));
    } else if (cmd === "tap") {
      /* 兜底：坐标点。优先用 click（按文字），坐标在不同 DPI 上很容易偏。 */
      adb("shell", "input", "tap", String(arg), String(arg2));
      console.log(JSON.stringify({ ok: true, note: "已按坐标点击（不推荐，优先用 click）" }));
    } else if (cmd === "shot") {
      const buf = await s.screenshot();
      const file = arg || "qa/tmp-studio/android-shot.png";
      writeFileSync(file, buf);
      console.log("→", file, `(${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`未知命令：${cmd}（用 help 看用法）`);
    }
  } finally {
    s.close();
  }
};

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) CLI().catch((error) => { console.error("✗", error.message); process.exit(1); });
