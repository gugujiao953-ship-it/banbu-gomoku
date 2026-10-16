// 验证：①「下一手」禁用态与同排一致（不再常亮）②外观卡片跟随主题（不再是写死纯白/浅色岛）
//      ③手数行 / 常驻区普通按钮底色不是透明
// 关键：主题切换必须走**应用自己的路径**（写偏好 + 重载）——直接改 data-theme 属性不会触发
// React 里那条把 --action-surface 重算成 rgba 的 effect，测出来的是假象。
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://localhost:4174/";
const url = BASE.includes("?") ? BASE : `${BASE}?qa=1`;

const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const parseRgba = (css) => {
  const raw = String(css).trim();
  const hex8 = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (hex8) return { r: parseInt(hex8[1], 16), g: parseInt(hex8[2], 16), b: parseInt(hex8[3], 16), a: hex8[4] ? parseInt(hex8[4], 16) / 255 : 1 };
  const hex3 = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3) return { r: parseInt(hex3[1] + hex3[1], 16), g: parseInt(hex3[2] + hex3[2], 16), b: parseInt(hex3[3] + hex3[3], 16), a: 1 };
  const m = raw.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
};

const run = async (legacyMode) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 800 } });
  await context.addInitScript((legacy) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    if (legacy) {
      const real = CSS.supports.bind(CSS);
      CSS.supports = (...args) => {
        const first = String(args[0] || "");
        if (first.startsWith("selector(")) return false;                    // :is/:where/:has/:focus-visible
        if (first === "color" && String(args[1] || "").includes("color-mix")) return false;
        if (first === "height" && String(args[1] || "").includes("dvh")) return false;
        if (first === "inset") return false;
        return real(...args);
      };
    }
  }, legacyMode);

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const tag = legacyMode ? "老内核(legacy)" : "现代内核";

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  await page.waitForTimeout(2500);

  const isLegacy = await page.evaluate(() => document.documentElement.classList.contains("legacy-webview"));
  check(`${tag} legacy 标记符合预期`, isLegacy === legacyMode, `legacy=${isLegacy}`);

  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const n of ["--action-surface", "--action-border", "--paper-with-alpha", "--line-with-alpha"]) out[n] = cs.getPropertyValue(n).trim();
    return out;
  });
  check(`${tag} 透明度变量已由 JS 算成 rgba（不依赖 color-mix）`,
    /^rgba?\(/.test(vars["--action-surface"]) && /^rgba?\(/.test(vars["--paper-with-alpha"]), JSON.stringify(vars));

  // ── ① 「下一手」accent ─────────────────────────────────────
  const accentProbe = await page.evaluate(() => {
    const accents = [...document.querySelectorAll(".moves-row button.accent")];
    const siblings = [...document.querySelectorAll(".moves-row button")].filter((b) => !b.classList.contains("accent"));
    const read = (b) => {
      const cs = getComputedStyle(b);
      const svg = b.querySelector("svg");
      return { bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity, svg: svg ? getComputedStyle(svg).color : null, disabled: b.disabled };
    };
    const greenVar = getComputedStyle(document.documentElement).getPropertyValue("--green").trim();
    // 合成一个"可用的 accent"：拿同排一个按钮克隆后去掉 disabled —— 用来证明 accent 可用时仍是强调色
    const sample = accents[0];
    let enabledProbe = null;
    if (sample) {
      const clone = sample.cloneNode(true);
      clone.removeAttribute("disabled");
      sample.parentElement.appendChild(clone);
      enabledProbe = read(clone);
      clone.remove();
    }
    return {
      disabledAccents: accents.filter((b) => b.disabled).map(read),
      siblingDisabled: siblings.filter((b) => b.disabled).slice(0, 3).map(read),
      enabledProbe, greenVar,
    };
  });
  console.log(`${tag} accent probe:`, JSON.stringify(accentProbe));
  const disabledLight = (() => {
    const list = accentProbe.disabledAccents;
    if (!list.length) return false;
    const green = parseRgba(accentProbe.greenVar);
    return list.some((a) => {
      const bg = parseRgba(a.bg);
      if (!bg) return true;
      // "常亮"＝底色接近主题强调色（几乎同色且不透明）
      const nearGreen = green && bg.a > 0.85 && Math.abs(bg.r - green.r) + Math.abs(bg.g - green.g) + Math.abs(bg.b - green.b) < 40;
      return Boolean(nearGreen);
    });
  })();
  check(`${tag} 禁用的「下一手」不再是强调色实底（不常亮）`, !disabledLight, JSON.stringify(accentProbe.disabledAccents));
  const sameAsSiblings = (() => {
    const sib = accentProbe.siblingDisabled[0];
    if (!sib || !accentProbe.disabledAccents.length) return true;
    return accentProbe.disabledAccents.every((a) => a.bg === sib.bg);
  })();
  check(`${tag} 禁用的「下一手」与同排普通禁用按钮同一底子`, sameAsSiblings,
    JSON.stringify({ accent: accentProbe.disabledAccents[0]?.bg, sibling: accentProbe.siblingDisabled[0]?.bg }));
  const enabledIsGreen = (() => {
    const e = accentProbe.enabledProbe;
    if (!e) return true;
    const bg = parseRgba(e.bg);
    const green = parseRgba(accentProbe.greenVar);
    return Boolean(bg && green && Math.abs(bg.r - green.r) + Math.abs(bg.g - green.g) + Math.abs(bg.b - green.b) < 24);
  })();
  check(`${tag} 可用的 accent 仍是强调色（修好的同时没把正常态弄坏）`, enabledIsGreen, JSON.stringify(accentProbe.enabledProbe));

  // ── ② 外观卡片：走应用自己的主题路径（写偏好 → 重载） ──────
  const measureCards = async (theme) => {
    await page.evaluate((t) => localStorage.setItem("banbu-theme-preference-v1", t), theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 60000 });
    await page.waitForTimeout(1800);
    return page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "__qaCards";
      host.style.cssText = "position:absolute;left:-9999px;top:0;width:320px";
      host.innerHTML = '<div class="visual-option-grid"><button><span><b>甲</b><small>说明</small></span></button><button class="selected"><span><b>乙</b></span></button></div>'
        + '<div class="theme-preference"><button><span></span><span><b>丙</b></span></button><button class="selected"><span></span><span><b>丁</b></span></button></div>';
      (document.querySelector(".app-shell") || document.body).appendChild(host);
      const read = (sel) => {
        const el = host.querySelector(sel);
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
      };
      const out = {
        theme: document.documentElement.getAttribute("data-theme"),
        plain: read(".visual-option-grid > button:not(.selected)"),
        selected: read(".visual-option-grid > button.selected"),
        themePlain: read(".theme-preference > button:not(.selected)"),
        themeSelected: read(".theme-preference > button.selected"),
        ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
        surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
        actionSurface: getComputedStyle(document.documentElement).getPropertyValue("--action-surface").trim(),
      };
      host.remove();
      return out;
    });
  };
  for (const theme of ["deepsea", "dark", "mono", "plum"]) {
    const cards = await measureCards(theme);
    const white = (css) => /^rgba?\(255,\s*255,\s*255(?:,\s*1)?\)$/.test(css);
    check(`${tag} [${theme}] 未选中卡片不再是写死纯白`, !white(cards.plain.bg) && !white(cards.themePlain.bg),
      JSON.stringify({ plain: cards.plain.bg, themePlain: cards.themePlain.bg, surface: cards.surface, actionSurface: cards.actionSurface }));
    // surface 是主题色（非白）时，卡片底色应当与它同色（跟随主题，而不是浅色岛）
    const surfaceParsed = parseRgba(cards.surface);
    const plainParsed = parseRgba(cards.plain.bg);
    if (surfaceParsed && plainParsed && !white(cards.surface)) {
      const same = Math.abs(surfaceParsed.r - plainParsed.r) + Math.abs(surfaceParsed.g - plainParsed.g) + Math.abs(surfaceParsed.b - plainParsed.b) < 24;
      check(`${tag} [${theme}] 未选中卡片与主题 --surface 同色`, same, `surface=${cards.surface} card=${cards.plain.bg}`);
    }
    const selBg = parseRgba(cards.selected.bg);
    check(`${tag} [${theme}] 选中卡片保留了强调底（不与未选中同色）`, cards.selected.bg !== cards.plain.bg,
      `selected=${cards.selected.bg} plain=${cards.plain.bg} ink=${cards.ink}`);
  }

  // ── ③ 手数行 / 常驻区底色 ─────────────────────────────────
  // 回到浅色主题，避免"深色主题下透明看不出"的干扰
  await page.evaluate(() => localStorage.setItem("banbu-theme-preference-v1", "porcelain"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  await page.waitForTimeout(1800);
  const rows = await page.evaluate(() => {
    const pick = (sel, exclude) => [...document.querySelectorAll(sel)]
      .filter((b) => !b.classList.contains("accent") && !(exclude && b.closest(exclude)))
      .map((b) => ({ t: (b.textContent || "").trim().slice(0, 4), bg: getComputedStyle(b).backgroundColor, cls: String(b.className) }));
    return {
      moves: pick(".moves-row button"),
      // 排除两类"刻意的透明格"：黑白切换器内的格子、规则切换器内的分段格 ——
      // 它们的底色由外层的容器/滑块承载，按钮本身就是透明的。
      cmd: pick(".record-command-bar button", ".stone-color-switch, .rule-toggle"),
      dock: pick(".dock-panel > button"),
      ruleToggleBg: (() => { const e = document.querySelector(".rule-toggle"); return e ? getComputedStyle(e).backgroundColor : null; })(),
      stoneSwitchBg: (() => { const e = document.querySelector(".stone-color-switch"); return e ? getComputedStyle(e).backgroundColor : null; })(),
    };
  });
  const transparent = [...rows.moves, ...rows.cmd, ...rows.dock].filter((r) => /rgba\(0,\s*0,\s*0,\s*0\)/.test(r.bg));
  check(`${tag} 手数行/常驻区/面板普通按钮底色不是透明`, transparent.length === 0,
    transparent.map((r) => `${r.t || r.cls.slice(0, 24)}=${r.bg}`).join(" | "));
  // 两个分段控件（规则 / 黑白）的**容器**必须有底色 + 有边框（分段格的透明是设计）
  const containersOpaque = ![rows.ruleToggleBg, rows.stoneSwitchBg].some((bg) => !bg || /rgba\(0,\s*0,\s*0,\s*0\)/.test(bg));
  check(`${tag} 分段控件容器（规则切换 / 黑白切换）有底色`, containersOpaque,
    `rule=${rows.ruleToggleBg} stone=${rows.stoneSwitchBg}`);
  console.log(`${tag} 采样：moves=${rows.moves.length} cmd=${rows.cmd.length} dock=${rows.dock.length}`);

  check(`${tag} 无页面错误`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
};

await run(false);
await run(true);

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
await browser.close();
process.exit(failed ? 1 : 0);
