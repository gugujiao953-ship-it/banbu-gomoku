/**
 * 门禁：新增控件必须适配**全部主题**（用户 2026-09-16 长期约定）。
 *
 * 为什么单独立门禁：本项目主题一直在加（可测的已 23 套）（`src/features/settings/SettingsPage.tsx` 的
 * `themeOptions`，也是本脚本 THEMES 的唯一正确来源），而「不写死颜色」这条约定靠肉眼
 * 是查不出来的——历轮抓到三个真问题：
 *   ① 我写的 `var(--border, 灰)` 里 **`--border` 从未定义**（真正的变量叫 `--line`），
 *      于是边框在所有主题里都是同一个灰色兜底；
 *   ② 探针一开始量错了元素（量外层 label 而不是内层 range input），把 accent-color 读成
 *      `auto`（浏览器默认蓝）——差点误判成「没适配」；
 *   ③ 分析面板的 `PanelSelect` 菜单通过 `createPortal` 挂到 `document.body`，而此前所有
 *      选择器都带 `.app-shell` 前缀——**portal 浮层永远匹配不到**，于是这个菜单从没被审计
 *      过：它写的是 `var(--color-surface-raised, #fffdf6)`，而 `--color-surface-raised` 只在
 *      `:root` 与青花瓷下定义，其余 8 个暗色主题全落到 `#ffffff` 兜底，同时文字是
 *      `var(--ink)`（暗色主题下近白）→ 白底白字，实测对比度 1.04–1.19。
 *      本脚本现在直接在 `document` 上查 `.panel-select-menu`，并断言它确实 portal 到 body，
 *      杜绝「浮层测不到却当成通过」。
 *
 * 断言（都要量出量级，不写「只要不是某个值就算过」）：
 *   ① 边框颜色必须随主题变化（去重数 ≥ 8）；
 *   ② 滑块 accent-color 不得为 auto 且随主题变化（去重数 ≥ 8）；
 *   ③ 文字压自身实际背景的对比度 ≥ 4.5:1（WCAG 相对亮度，不是 0–255 粗算）；
 *   ④ 每个主题都必须渲染出这些控件（不能因为主题差异而消失）；
 *   ⑤ 分析面板选框：触发器与展开后菜单 option（普通 + 选中）文字对比度 ≥ 4.5:1；
 *   ⑥ 菜单浮层背景必须随主题变化（去重数 ≥ 8），且浮层必须 portal 到 document.body。
 *
 * 对比度算法说明：早先版本用 `0.2126R+0.7152G+0.0722B`（0–255 直算）当亮度，既不满足
 * WCAG 的 sRGB 线性化，也会在「元素背景其实是 transparent」时把背景当成纯黑——于是
 * 「文字压面板」这条断言实际在跟黑色比，任何文字都能过。现在统一改为 WCAG 相对亮度，
 * 并把元素自身及其祖先的背景逐层合成出不透明底色后再比。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5300/?qa=1 node qa/theme-adaptation.mjs
 */
import { chromium } from "playwright";
import { THEME_OPTIONS } from "../src/theme-options.ts";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;

// 主题清单**从应用读**（`.app-shell[data-theme-options]`，源头是 src/theme-options.ts）。
// 用户 09-17：主题早就是二十多套了，脚本里写死的清单一定会过时；这里先探一次应用、按应用
// 给的清单扫描，并对照下面这份「文档清单」把漂移打出来（新增主题会自动纳入扫描，不再漏测）。
// system 由应用解析为 light/dark（记录在 resolved 列）；custom 的底色由用户自定，
// 无法判定对比度，因此**可测主题**是其余的 CONCRETE_THEME_IDS。
// ⚠ 文档清单不再抄第二份（2026-10-15）：原来这里手写了 23 项，`pelican`、`dunhuang`
//   上线后一直没同步，漂移提示成了常驻噪音。Node 能直接读 TS（类型擦除），所以引源文件。
const DOCUMENTED_THEME_OPTIONS = THEME_OPTIONS.map(([id]) => id);
const DOCUMENTED_TESTABLE = DOCUMENTED_THEME_OPTIONS.filter((id) => id !== "system" && id !== "custom");

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

// 探测应用的主题清单（顺带当作「页面能起来」的检查）。
const probeContext = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await probeContext.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const probePage = await probeContext.newPage();
await probePage.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await probePage.waitForSelector(".app-shell", { timeout: 120000 });
const runtimeThemes = (await probePage.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-theme-options") || ""))
  .split(/\s+/).filter(Boolean);
await probeContext.close();

const extraInApp = runtimeThemes.filter((id) => !DOCUMENTED_TESTABLE.includes(id));
const missingInApp = DOCUMENTED_TESTABLE.filter((id) => !runtimeThemes.includes(id));
console.log(`主题清单：应用 ${runtimeThemes.length} 套可测主题 · 脚本文档 ${DOCUMENTED_TESTABLE.length} 套`
  + (extraInApp.length ? ` · 应用新增 [${extraInApp.join(", ")}]（已自动纳入本次扫描，请把文件头的清单同步一下）` : "")
  + (missingInApp.length ? ` · 文档多出 [${missingInApp.join(", ")}]（应用里没有，已忽略）` : ""));
if (!runtimeThemes.length) console.log("⚠ 读不到应用主题清单，退回脚本文档清单扫描。");

const THEMES = (process.env.THEMES || "").split(",").filter(Boolean).length
  ? process.env.THEMES.split(",")
  : (runtimeThemes.length ? runtimeThemes : DOCUMENTED_TESTABLE);
const rows = [];
for (const theme of THEMES) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  // 颜色工具注入到 window：解析 CSS 颜色、把元素及其祖先背景合成为不透明底色、算 WCAG 对比度。
  await context.addInitScript((t) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-theme-preference-v1", t);
    // 打开多线程，让线程数选择器也渲染出来
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ engineMultiThread: true }));
    const parse = (css) => {
      const m = String(css).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const q = m[1].split(",").map((v) => parseFloat(v));
      if (q.length < 3 || q.some((v) => !Number.isFinite(v))) return null;
      return [q[0], q[1], q[2], q[3] === undefined ? 1 : q[3]];
    };
    const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    window.__qaColor = {
      parse,
      // 从元素自身向上合成背景，直到不透明；用于量「文字实际压在哪」。
      effectiveBg(el) {
        const layers = [];
        let node = el;
        while (node && node !== document.documentElement.parentNode) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c[3] > 0) layers.push(c);
          node = node.parentElement;
        }
        let base = [255, 255, 255];
        for (let i = layers.length - 1; i >= 0; i -= 1) {
          const a = layers[i];
          base = [a[0] * a[3] + base[0] * (1 - a[3]), a[1] * a[3] + base[1] * (1 - a[3]), a[2] * a[3] + base[2] * (1 - a[3])];
        }
        return base.map((v) => Math.round(v));
      },
      contrast(fg, bg) {
        if (!fg || !bg) return null;
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
        return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
      },
      hex(rgb) {
        if (!rgb) return null;
        return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
      },
    };
  }, theme);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "打谱")?.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const C = window.__qaColor;
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const bg = C.effectiveBg(el);
      return {
        border: cs.borderTopColor,
        color: cs.color,
        background: cs.backgroundColor,
        backgroundHex: C.hex(bg),
        accentColor: cs.accentColor,
        textOnBg: C.contrast(C.parse(cs.color), bg),
        vars: {
          line: root.getPropertyValue("--line").trim(),
          green: root.getPropertyValue("--green").trim(),
          jade: root.getPropertyValue("--jade").trim(),
          ink: root.getPropertyValue("--ink").trim(),
          muted: root.getPropertyValue("--muted").trim(),
          surface: root.getPropertyValue("--surface").trim(),
          surface2: root.getPropertyValue("--surface-2").trim(),
        },
      };
    };
    const out = { resolved: document.documentElement.getAttribute("data-theme") };
    const panel = document.querySelector(".ai-analysis-panel");
    out.panelBg = panel ? C.hex(C.effectiveBg(panel)) : null;
    // 内存格的 accent-color 在**内层 range input** 上，不是外层 label——量错元素会读成 auto。
    const memInput = document.querySelector('.ai-analysis-memory input[type="range"]');
    out.memAccent = memInput ? getComputedStyle(memInput).accentColor : null;
    for (const [name, sel] of [["多线程按钮", ".ai-analysis-mt"], ["内存格", ".ai-analysis-memory"], ["DotProd", ".ai-analysis-dotprod"]]) {
      out[name] = pick(sel);
    }
    out.vars = pick(".ai-analysis-mt")?.vars ?? null;
    // 分析面板的选框（PanelSelect 触发器）。菜单是 portal，单独一步量。
    const trig = document.querySelector('.panel-select-trigger[aria-label="分析模式"]') || document.querySelector(".panel-select-trigger");
    if (trig) {
      const cs = getComputedStyle(trig);
      const bg = C.effectiveBg(trig);
      out.selectTrigger = {
        label: trig.getAttribute("aria-label"),
        color: cs.color,
        background: cs.backgroundColor,
        backgroundHex: C.hex(bg),
        textOnBg: C.contrast(C.parse(cs.color), bg),
      };
    } else {
      out.selectTrigger = null;
    }
    return out;
  });

  // 展开 PanelSelect：菜单经 createPortal 挂到 document.body，所以选择器**不带** .app-shell 前缀。
  await page.evaluate(() => {
    const trig = document.querySelector('.panel-select-trigger[aria-label="分析模式"]') || document.querySelector(".panel-select-trigger");
    trig?.click();
  });
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const C = window.__qaColor;
    const el = document.querySelector(".panel-select-menu");
    if (!el) return null;
    const buttons = [...el.querySelectorAll("button")];
    const selected = buttons.find((b) => b.classList.contains("selected")) || buttons[0];
    const plain = buttons.find((b) => !b.classList.contains("selected")) || buttons[0];
    const read = (b) => {
      if (!b) return null;
      const cs = getComputedStyle(b);
      const bg = C.effectiveBg(b);
      return { text: (b.textContent || "").trim(), color: cs.color, backgroundHex: C.hex(bg), textOnBg: C.contrast(C.parse(cs.color), bg) };
    };
    const cs = getComputedStyle(el);
    const bg = C.effectiveBg(el);
    return {
      // 这条是防「盲区」的关键：菜单必须是 portal 到 body 的浮层，否则选择器又只覆盖 app-shell。
      portalToBody: el.parentElement === document.body,
      optionCount: buttons.length,
      background: cs.backgroundColor,
      backgroundHex: C.hex(bg),
      color: cs.color,
      plain: read(plain),
      selected: read(selected),
    };
  });
  // 关掉菜单，避免影响后面的开关量测。
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  await page.waitForTimeout(150);

  // 再量「开」态：点亮多线程后，按钮自己的底色/文字（jade 底 + green 字）
  const onState = await page.evaluate(() => {
    const C = window.__qaColor;
    const btn = document.querySelector(".ai-analysis-mt");
    if (!btn) return null;
    btn.click();
    return true;
  });
  await page.waitForTimeout(250);
  const onState2 = onState ? await page.evaluate(() => {
    const C = window.__qaColor;
    const btn = document.querySelector(".ai-analysis-mt");
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    const bg = C.effectiveBg(btn);
    return { background: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, contrastOn: C.contrast(C.parse(cs.color), bg) };
  }) : null;
  rows.push({ theme, ...data, menu, onState: onState2 });
  await context.close();
}

// 汇总 + 断言
const borders = rows.map((r) => r["多线程按钮"]?.border).filter(Boolean);
const accents = rows.map((r) => r.memAccent).filter(Boolean);
const distinctBorders = new Set(borders).size;
const distinctAccents = new Set(accents).size;
const minPanelContrast = Math.min(...rows.map((r) => r["多线程按钮"]?.textOnBg ?? 99));
// 只要求网页版就一定存在的两个控件。DotProd 按钮只在**安卓原生引擎就绪**时渲染
// （本机 CPU 得支持 armv8.2），浏览器里本来就不存在——要求它出现是断言写错了。
// 它与多线程按钮共用同一条 CSS 规则（.ai-analysis-mt, .ai-analysis-dotprod），
// 所以多线程按钮量到的颜色即为它量到的颜色。
const missing = rows.filter((r) => !r["多线程按钮"] || !r["内存格"]);
const autoAccent = accents.filter((a) => /^auto/i.test(String(a)));

// 选框（PanelSelect）相关汇总
const missingSelect = rows.filter((r) => !r.selectTrigger || !r.menu || r.menu.optionCount < 3);
const themeMismatch = rows.filter((r) => r.theme !== "system" && r.resolved !== r.theme);
const notPortal = rows.filter((r) => r.menu && !r.menu.portalToBody);
const triggerContrasts = rows.map((r) => r.selectTrigger?.textOnBg).filter((v) => typeof v === "number");
const menuContrasts = rows.map((r) => r.menu?.plain?.textOnBg).filter((v) => typeof v === "number");
const menuSelectedContrasts = rows.map((r) => r.menu?.selected?.textOnBg).filter((v) => typeof v === "number");
const minTrigger = Math.min(...triggerContrasts);
const minMenu = Math.min(...menuContrasts);
const minMenuSelected = Math.min(...menuSelectedContrasts);
const distinctMenuBg = new Set(rows.map((r) => r.menu?.backgroundHex).filter(Boolean)).size;
const distinctTriggerBg = new Set(rows.map((r) => r.selectTrigger?.backgroundHex).filter(Boolean)).size;

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

console.log(`主题数：${rows.length}（来源：应用的 .app-shell[data-theme-options]，源头 src/theme-options.ts）`);
console.log(`主题 | 按钮描边 | 文字对比(面板) | 内存格描边 | 滑块accent | 开态对比 | 选框触发器 | 菜单option | 菜单选中 | 菜单底色`);
for (const r of rows) {
  const mt = r["多线程按钮"], mem = r["内存格"];
  console.log(`${r.theme.padEnd(10)} | ${String(mt?.border).padEnd(22)} | ${String(mt?.textOnBg).padStart(5)} | ${String(mem?.border).padEnd(22)} | ${String(r.memAccent).padEnd(18)} | ${String(r.onState?.contrastOn).padStart(4)} | ${String(r.selectTrigger?.textOnBg).padStart(5)} | ${String(r.menu?.plain?.textOnBg).padStart(5)} | ${String(r.menu?.selected?.textOnBg).padStart(5)} | ${r.menu?.backgroundHex}`);
}
console.log("");
check("主题偏好实际生效（data-theme 与偏好一致）", themeMismatch.length === 0, themeMismatch.length ? `不一致：${themeMismatch.map((m) => `${m.theme}→${m.resolved}`).join(", ")}` : `${rows.length} 套全部生效（system 解析为 ${rows.find((r) => r.theme === "system")?.resolved}）`);
check("边框随主题变化（不是写死/兜底色）", distinctBorders >= 8, `去重 ${distinctBorders} 种`);
check("滑块 accent-color 不是浏览器默认 auto", autoAccent.length === 0, autoAccent.length ? `auto 出现在 ${autoAccent.length} 个主题` : "全部为具体颜色");
check("滑块 accent-color 随主题变化", distinctAccents >= 8, `去重 ${distinctAccents} 种`);
check("所有主题都渲染出引擎控件（不因主题消失）", missing.length === 0, missing.length ? `缺失主题：${missing.map((m) => m.theme).join(", ")}` : `${rows.length} 套全渲染出多线程按钮与内存格`);
check("文字压自身实际背景对比度 ≥ 4.5:1", minPanelContrast >= 4.5, `最低 ${minPanelContrast}`);

// 「开」态是 jade 底 + green 字：沿用全应用既有开关的配色（styles.css 里 --jade 用了 54 处），
// 门槛按本项目对开关类控件的既有标准 3:1（不是正文的 4.5:1）。
const onContrasts = rows.map((r) => r.onState?.contrastOn).filter((v) => typeof v === "number");
const minOn = Math.min(...onContrasts);
check("「开」态文字与底色对比 ≥ 3:1（全应用开关的既有标准）", minOn >= 3, `最低 ${minOn}`);

// ===== 分析面板选框（PanelSelect）：portal 浮层必须一起审计 =====
console.log("");
check("每个主题都渲染出选框触发器、且菜单能展开出 option", missingSelect.length === 0, missingSelect.length ? `缺失主题：${missingSelect.map((m) => m.theme).join(", ")}` : `${rows.length} 套均量到触发器 + 菜单（option ≥ 3）`);
check("选框菜单确实 portal 到 document.body（不是只在 .app-shell 内查）", notPortal.length === 0, notPortal.length ? `非 portal 主题：${notPortal.map((m) => m.theme).join(", ")}` : `${rows.length} 套菜单父节点均为 body`);
check("选框触发器文字对比度 ≥ 4.5:1", minTrigger >= 4.5, `最低 ${minTrigger}`);
check("选框菜单 option 文字对比度 ≥ 4.5:1", minMenu >= 4.5, `最低 ${minMenu}（${rows.filter((r) => (r.menu?.plain?.textOnBg ?? 99) < 4.5).map((r) => r.theme).join(", ") || "无"}）`);
check("选框菜单「选中」option 文字对比度 ≥ 4.5:1", minMenuSelected >= 4.5, `最低 ${minMenuSelected}（${rows.filter((r) => (r.menu?.selected?.textOnBg ?? 99) < 4.5).map((r) => r.theme).join(", ") || "无"}）`);
check("选框菜单底色随主题变化（不是同一个兜底色）", distinctMenuBg >= 8, `去重 ${distinctMenuBg} 种`);
check("选框触发器底色随主题变化（不是同一个兜底色）", distinctTriggerBg >= 8, `去重 ${distinctTriggerBg} 种`);

console.log(failed ? `\n主题适配门禁失败：${failed} 条` : `\n主题适配门禁通过：控件颜色全部来自主题变量，${rows.length} 套主题逐一量过（含 portal 到 body 的分析选框菜单）`);
process.exit(failed ? 1 : 0);
await browser.close();
