/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   族 E · 欧美动画 —— 其余 9 个主题 × 各 10 套方案

   ────────────────────────────────────────────────────────────────────────
   结构：**1 个主题 = 1 种画法；1 个主题出 10 套方案（换取舍，不换画法）**
   本文件含 9 个主题：
     042 蜡笔起稿 · 043 木偶绒面 · 044 橡皮管肢 · 045 逐帧硬线 · 046 墨彩凯尔
     047 彩铅圣诞 · 048 拼贴银幕 · 049 云上白描 · 050 怒潮黑白
   （041 九老笔意在 `theme-jiulao.js`）

   注意：`illustrated-animation.js` 里那 10 套是本族**每个主题的第 1 套方案**，
   本文件补齐每个主题的第 02–10 套。id 一律 `<主题缩写>-<序号>`。

   ── 公用工具（与 theme-jiulao.js 同源；改动请同步两处）────────────────
     taper()      变宽包络：SVG 的 stroke-width 等宽，做不出"由粗到细"
     animGrid()   每根线单独一条 path；两端不外伸（ext ≤3px）
     ballStone()  球体棋子 + 自动护边（深底配深子必须描边，否则隐形）
     随机一律确定性 hash + 坐标 seed；defs id 一律走 P()
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    Q: (n) => `${ID}--${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  const N = 15;
  const PAD = 46;
  const SPAN = 620 - PAD * 2;
  const GAP = SPAN / (N - 1);
  const XY = (i) => PAD + i * GAP;

  /* ══════════════════════════════════════════════════════════════════
     公用工具
     ══════════════════════════════════════════════════════════════════ */

  /** 确定性伪随机。⚠ 不是密码学随机，只给 SVG 形状做确定性微扰；
   *  "可被预测"正是本意（同一棋子每次渲染必须一样）。安全扫描器报弱随机属误报，勿改。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };

  const wobble = (id, { bf = ".016", oct = 2, seed = 7, scale = 1.8 } = {}) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 无障碍：系统要求「减少动态效果」时把这条选择器上的动画掐掉。
   *  每个自带动效（boardMotions / stoneMotions）都必须带这条，
   *  .check-motion.mjs 会用 emulateMedia(reduce) 逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  const grain = (P, { slope = ".08", seed = 5, bf = ".8" } = {}) => `
    <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="2" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 绒面纤维（043 木偶绒面用）：密排短线，用 pattern 平铺，别逐条画。 */
  const fuzz = (P, key, { stroke = "#8a7a62", gap = 4, op = .3, deg = 0 } = {}) => `
    <pattern id="${P(key)}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${deg})">
      <path d="M1 0V${gap}" stroke="${stroke}" stroke-width=".9" opacity="${op}"/>
      <path d="M0 ${gap / 2}H${gap}" stroke="${stroke}" stroke-width=".7" opacity="${op * .7}"/>
    </pattern>`;

  /** 缠绕纹（046 墨彩凯尔用）：凯尔特结简化成装饰纹样。 */
  const knot = (P, key, { color = "#3a5a8a", op = .5 } = {}) => `
    <pattern id="${P(key)}" width="46" height="46" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${color}" stroke-width="1.5" opacity="${op}">
        <circle cx="23" cy="23" r="13"/>
        <circle cx="23" cy="23" r="6"/>
        <path d="M10 23q13 -14 26 0q-13 14 -26 0"/>
      </g>
      <circle cx="23" cy="23" r="1.8" fill="${color}" opacity="${op * 1.3}"/>
    </pattern>`;

  const ballGrad = (P, key, { lit, mid, dark, cx = "32%", cy = "24%", r = "76%" }) => `
    <radialGradient id="${P(key)}" cx="${cx}" cy="${cy}" r="${r}">
      <stop offset="0" stop-color="${lit}"/>
      <stop offset=".38" stop-color="${mid}"/>
      <stop offset="1" stop-color="${dark}"/>
    </radialGradient>`;

  const relLum = (hex) => {
    const q = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(q.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };

  const taper = (pts, w0, w1, { n = 22, ease = 1 } = {}) => {
    const at = (t) => {
      const seg = t * (pts.length - 1);
      const i = Math.min(Math.floor(seg), pts.length - 2);
      const f = seg - i;
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return [
        a.x + (mx - a.x) * 2 * f + (b.x - mx) * f * f,
        a.y + (my - a.y) * 2 * f + (b.y - my) * f * f,
      ];
    };
    const L = [], R = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const [x, y] = at(t);
      const [x2, y2] = at(Math.min(1, t + 0.004));
      let dx = x2 - x, dy = y2 - y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const hw = (w0 + (w1 - w0) * Math.pow(t, ease)) / 2;
      L.push([x - dy * hw, y + dx * hw]);
      R.push([x + dy * hw, y - dx * hw]);
    }
    const f = (v) => v.toFixed(1);
    let d = `M${f(L[0][0])} ${f(L[0][1])}`;
    for (let i = 1; i <= n; i += 1) d += `L${f(L[i][0])} ${f(L[i][1])}`;
    for (let i = n; i >= 0; i -= 1) d += `L${f(R[i][0])} ${f(R[i][1])}`;
    return `${d}Z`;
  };

  const animGrid = (P, seedList, {
    stroke = "#2a2018", w0 = 3.0, w1 = 1.2, jit = 1.8, op = .92, ext = 3,
  } = {}) => {
    let g = "";
    for (const [seed, vertical] of [[seedList[0], false], [seedList[1], true]]) {
      const rand = rng(seed);
      for (let i = 0; i < N; i += 1) {
        const v = XY(i);
        const j = () => (rand() - 0.5) * jit;
        const e = ext * (0.4 + rand() * 0.9);
        const a = vertical ? [v + j(), PAD - e] : [PAD - e, v + j()];
        const m = vertical ? [v + j() * .6, 310] : [310, v + j() * .6];
        const b = vertical ? [v + j(), PAD + SPAN + e] : [PAD + SPAN + e, v + j()];
        const d = taper([{ x: a[0], y: a[1] }, { x: m[0], y: m[1] }, { x: b[0], y: b[1] }],
          w0 + rand() * .8, w1 + rand() * .5);
        g += `<path d="${d}" fill="${stroke}" opacity="${(op - rand() * .12).toFixed(2)}"
                filter="url(#${P("wob")})"/>`;
      }
    }
    return g;
  };

  /** 硬直线网格（045/050 用：等宽、不抖、几何）。
   *  @param tag 给每条线补的属性串：(线序号) => 串。自带动效用它挂 class + --i
   *         （见 hard-08 的 boardMotions），**只加属性、不动 d/坐标/粗细**。
   *         线身上没有滤镜（这条函数画的线本来就不抖），所以可以直接动画它。 */
  const hardGrid = (stroke, w, { tag = () => "" } = {}) => {
    let g = "";
    for (let i = 0; i < N; i += 1) {
      const v = XY(i).toFixed(1);
      const a = PAD - 8, b = PAD + SPAN + 8;
      g += `<path d="M${a} ${v}H${b}" stroke="${stroke}" stroke-width="${w}" fill="none"${tag(i * 2)}/>`;
      g += `<path d="M${v} ${a}V${b}" stroke="${stroke}" stroke-width="${w}" fill="none"${tag(i * 2 + 1)}/>`;
    }
    return g;
  };

  const blob = (x, y, r, seed, { wob = 0.07, n = 14 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - wob / 2 + rand() * wob);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i += 1) {
      const c = pts[(i + 1) % n], nx = pts[(i + 2) % n];
      d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
    }
    return `${d}Z`;
  };

  /** 球体棋子 + 自动护边（子色与盘底太近时描一圈对比色）。 */
  const ballStone = ({
    P, lit, mid, dark, ink, hi = "#ffffff", hiOp = .85,
    ring, rim, lx = -.34, ly = -.38, board, bodyHex,
  }) => ({ x, y, r, player, isLast }) => {
    const seed = Math.round(x * 13 + y * 7 + player * 211);
    const gid = P(player === 1 ? "sb" : "sw");
    let s = "";
    s += `<ellipse cx="${x.toFixed(1)}" cy="${(y + r * 0.14).toFixed(1)}"
            rx="${(r * 0.98).toFixed(1)}" ry="${(r * 0.9).toFixed(1)}" fill="#000" opacity=".22"/>`;
    s += `<path d="${blob(x, y, r, seed)}" fill="url(#${gid})"
            stroke="${ink}" stroke-width="${(r * 0.11).toFixed(2)}"
            stroke-linejoin="round" filter="url(#${P("wob2")})"/>`;
    if (board && bodyHex && Math.abs(relLum(bodyHex) - relLum(board)) * 100 < 22) {
      const guard = relLum(bodyHex) > relLum(board) ? "rgba(24,18,12,.72)" : "rgba(255,246,224,.66)";
      s += `<path d="${blob(x, y, r + 1.1, seed)}" fill="none" stroke="${guard}"
              stroke-width="${(r * 0.2).toFixed(2)}" stroke-linejoin="round"
              filter="url(#${P("wob2")})"/>`;
    }
    s += `<ellipse cx="${(x + r * lx).toFixed(1)}" cy="${(y + r * ly).toFixed(1)}"
            rx="${(r * 0.26).toFixed(2)}" ry="${(r * 0.17).toFixed(2)}" fill="${hi}" opacity="${hiOp}"
            transform="rotate(-32 ${(x + r * lx).toFixed(1)} ${(y + r * ly).toFixed(1)})"/>`;
    s += `<ellipse cx="${(x + r * 0.14).toFixed(1)}" cy="${(y + r * 0.5).toFixed(1)}"
            rx="${(r * 0.4).toFixed(2)}" ry="${(r * 0.15).toFixed(2)}" fill="${rim}" opacity=".32"/>`;
    if (isLast) {
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}"
              fill="none" stroke="${ring}" stroke-width="2.2" opacity=".9"/>`;
    }
    return s;
  };

  /* 10 套方案的通用配色表：浅纸 → 深纸
     每个主题都按这张表走，保证"同一画法 10 种取舍"的一致节奏。 */
  const PALETTES = [
    ["-01", "暖黄纸", { b0: "#f4e6c6", b1: "#ecd9b2", b2: "#dcc79c", page: "#2a2118", sw: "#c9902f" }],
    ["-02", "冷灰纸", { b0: "#f2f2ee", b1: "#e6e6e0", b2: "#d2d2ca", page: "#22242a", sw: "#7a8a9a" }],
    ["-03", "暖米纸", { b0: "#fbf3e2", b1: "#f4e8ce", b2: "#e6d5b4", page: "#2c2418", sw: "#c08a40" }],
    ["-04", "樱粉纸", { b0: "#fdf2f0", b1: "#f8e2de", b2: "#eed0ca", page: "#302428", sw: "#d07878" }],
    ["-05", "青瓷纸", { b0: "#f0f6f2", b1: "#e0eae4", b2: "#c8d8d0", page: "#1e2a28", sw: "#5a9a86" }],
    ["-06", "夜蓝纸", { b0: "#26344a", b1: "#1c283a", b2: "#121c2a", page: "#0c1420", sw: "#6a9ad8" }],
    ["-07", "苔绿纸", { b0: "#2a3424", b1: "#20281c", b2: "#161c12", page: "#141a10", sw: "#8aa860" }],
    ["-08", "铁锈纸", { b0: "#3a2620", b1: "#2c1c16", b2: "#1e120e", page: "#1a100c", sw: "#c86838" }],
    ["-09", "墨黑纸", { b0: "#222226", b1: "#18181c", b2: "#0e0e12", page: "#0a0a0e", sw: "#b0b0c0" }],
    ["-10", "雪青纸", { b0: "#eef0f8", b1: "#dde2f0", b2: "#c4cce0", page: "#242438", sw: "#7a7ac8" }],
  ];
  const isDark = (hex) => relLum(hex) < 0.2;
  /** 按底纸明暗自动给线/星/棋子配对色，省得 10 套×9 主题手填 90 遍。 */
  const autoInk = (b1, dark) => (dark ? "#d8dce8" : "#3a3026");
  const autoStone = (b1) => (isDark(b1)
    ? { blLit: "#5a6478", blMid: "#1a2030", blDark: "#080c14", wDark: "#5a6a80" }
    : { blLit: "#7a6a58", blMid: "#3a2e24", blDark: "#1c1610", wDark: "#b8a67e" });

  /* ══════════════════════════════════════════════════════════════════
     042 · 蜡笔起稿 ×10
     画法：彩色蜡线压轮廓 + **保留草稿线**（旁边一条更淡的鬼影线）。
     变体：换蜡笔色（跟着底纸走）+ 换草稿线偏移量。
     ══════════════════════════════════════════════════════════════════ */
  const INK_COLORS = ["#6a4a2c", "#4a4a52", "#6a5030", "#7a4a4a", "#3a5a50",
    "#8ab0d8", "#a8c088", "#c08a60", "#c8c8d0", "#5a5a8a"];
  const ACCENTS = ["#c26a4a", "#7a8a9a", "#c08a40", "#d07878", "#5a9a86",
    "#6a9ad8", "#8aa860", "#c86838", "#b0b0c0", "#7a7ac8"];

  PALETTES.forEach(([suffix, label, pal], i) => {
    const { P, push } = mk(`crayon${suffix}`);
    const dark = isDark(pal.b1);
    const st = autoStone(pal.b1);
    const ink = INK_COLORS[i], accent = ACCENTS[i];
    // 草稿线：正式线旁边 offset 几像素再画一条更淡的（这是本主题的签名）
    const ghost = animGrid(P, [4203 + i, 4204 + i], { stroke: accent, w0: 1.6, w1: .7, op: .3 });
    const main = animGrid(P, [4201 + i, 4202 + i], { stroke: ink, w0: 2.0, w1: .9, op: .8 });
    push({
      name: `蜡笔起稿 · ${label}`, swatch: pal.sw, pageBg: pal.page,
      vars: {
        "--bd-bg": pal.b0, "--bd-line": ink, "--bd-star": ink,
        "--st-black": st.blMid, "--st-white": dark ? "#e8e4dc" : "#fdfaf0",
        "--ui-accent": accent, "--bd-radius": "14px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".022", oct: 2, seed: 41, scale: 2.6 })}
        ${wobble(P("wob2"), { bf: ".045", oct: 2, seed: 53, scale: 3.6 })}
        ${grain(P, { slope: dark ? ".12" : ".10", seed: 13, bf: ".65" })}
        ${ballGrad(P, "sb", { lit: st.blLit, mid: st.blMid, dark: st.blDark })}
        ${ballGrad(P, "sw", { lit: "#ffffff", mid: dark ? "#e8e4dc" : "#fdfaf0", dark: st.wDark })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${pal.b0}"/><stop offset="1" stop-color="${pal.b2}"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity="${dark ? ".5" : ".62"}"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: ink, starR: 3.4,
      gridExtra: `<g transform="translate(${(3 + i * 0.5).toFixed(1)},${(-2.5 + i * 0.4).toFixed(1)})">${ghost}</g>${main}`,
      stone: ballStone({
        P, lit: st.blLit, mid: st.blMid, dark: st.blDark, ink: st.blDark,
        rim: st.wDark, ring: accent, hi: dark ? "#f0f4ff" : "#fff6e0", hiOp: .75,
        board: pal.b1, bodyHex: dark ? "#e8e4dc" : "#fdfaf0",
      }),
      css: "",
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     049 · 云上白描 ×10
     画法：细瘦单线 + 水彩淡铺 + 天空大留白（本族最"轻"的一支）。
     变体：换天色（浅蓝/暖白/黄昏/雨灰/月夜…），线的粗细跟着天色的"空气感"走。
     ══════════════════════════════════════════════════════════════════ */
  const SKY = [
    ["-01", "晴空", { b0: "#fbfdff", b1: "#eef5fa", b2: "#dce8f2", page: "#242c34",
      wA: "#a8c8e0", wB: "#c8d8e0", sw: "#6a9ac0", inkLight: "#3a5a72", inkDark: "#a8c8e0" }],
    ["-02", "薄云", { b0: "#fdfdfb", b1: "#f4f4f0", b2: "#e4e4de", page: "#2c2e30",
      wA: "#c8c8c0", wB: "#d8d8d0", sw: "#8a9aa0", inkLight: "#5a5a54", inkDark: "#c0c0b8" }],
    ["-03", "黄昏", { b0: "#fdf4e8", b1: "#f8e4d0", b2: "#ecccb0", page: "#3a2a20",
      wA: "#e8b088", wB: "#f0c8a0", sw: "#d09050", inkLight: "#7a4a28", inkDark: "#e0b080" }],
    ["-04", "雨灰", { b0: "#f2f4f6", b1: "#e2e6ea", b2: "#ccd2d8", page: "#262a2e",
      wA: "#9aa8b4", wB: "#b8c2cc", sw: "#6a7a88", inkLight: "#3a4a58", inkDark: "#9aa8b8" }],
    ["-05", "月夜", { b0: "#2a3448", b1: "#202838", b2: "#161c28", page: "#0e1218",
      wA: "#6a88b8", wB: "#4a6088", sw: "#8aa8d8", inkLight: "#2a3448", inkDark: "#b8cce8" }],
    ["-06", "晨雾", { b0: "#f6f8f4", b1: "#e8ece4", b2: "#d4dcd0", page: "#2a3028",
      wA: "#a8bca8", wB: "#c8d4c0", sw: "#7a9a7a", inkLight: "#3e5a3e", inkDark: "#a8c0a8" }],
    ["-07", "暮紫", { b0: "#f4f0f8", b1: "#e4dcee", b2: "#cec2e0", page: "#2c2438",
      wA: "#b098d0", wB: "#c8b8e0", sw: "#9a7ac0", inkLight: "#4e3a6a", inkDark: "#c0a8e0" }],
    ["-08", "沙尘", { b0: "#f8f2e4", b1: "#ece0c8", b2: "#dcccb0", page: "#302818",
      wA: "#c8ac78", wB: "#dcc8a0", sw: "#b09050", inkLight: "#6a5028", inkDark: "#d8c090" }],
    ["-09", "深夜", { b0: "#1c2230", b1: "#141a26", b2: "#0c1018", page: "#06080c",
      wA: "#3a4a68", wB: "#26344a", sw: "#5a78a8", inkLight: "#1c2230", inkDark: "#8aa0c8" }],
    ["-10", "极地", { b0: "#f4fbff", b1: "#e4f2fa", b2: "#c8e0ee", page: "#20303a",
      wA: "#88c0d8", wB: "#a8d0e0", sw: "#5aa0c0", inkLight: "#2a5a72", inkDark: "#9ad0e8" }],
  ];

  SKY.forEach(([suffix, label, v], i) => {
    const { P, push } = mk(`ghibli${suffix}`);
    const dark = isDark(v.b1);
    const st = autoStone(v.b1);
    // ⚠ 线色必须**跟着天色走**，不能所有浅底都用同一个灰。
    //    早期 10 套里 8 套线色都是 #4a5a68，天色又都接近白 →
    //    方案之间几乎看不出差别，"10 套方案"就白做了。
    //    这里按天色推导线色：黄昏偏赭、雨灰偏青、暮紫偏紫、晨雾偏绿…
    const ink = dark ? v.inkDark : v.inkLight;
    push({
      name: `云上白描 · ${label}`, swatch: v.sw, pageBg: v.page,
      vars: {
        "--bd-bg": v.b0, "--bd-line": ink, "--bd-star": ink,
        "--st-black": st.blMid, "--st-white": dark ? "#e4eaf2" : "#fcfdff",
        "--ui-accent": v.sw, "--bd-radius": "10px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".024", oct: 2, seed: 171, scale: 1.5 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 181, scale: 1.8 })}
        ${grain(P, { slope: ".05", seed: 37, bf: ".9" })}
        ${ballGrad(P, "sb", { lit: st.blLit, mid: st.blMid, dark: st.blDark })}
        ${ballGrad(P, "sw", { lit: "#ffffff", mid: dark ? "#e4eaf2" : "#fcfdff", dark: st.wDark })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${v.b0}"/><stop offset=".55" stop-color="${v.b1}"/>
          <stop offset="1" stop-color="${v.b2}"/>
        </linearGradient>
        <radialGradient id="${P("washA")}" cx="30%" cy="34%" r="52%">
          <stop offset="0" stop-color="${v.wA}" stop-opacity="${dark ? ".3" : ".38"}"/>
          <stop offset="1" stop-color="${v.wA}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("washB")}" cx="72%" cy="68%" r="48%">
          <stop offset="0" stop-color="${v.wB}" stop-opacity="${dark ? ".24" : ".3"}"/>
          <stop offset="1" stop-color="${v.wB}" stop-opacity="0"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("washA")})"/>
        <rect width="620" height="620" fill="url(#${P("washB")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".3"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: ink, starR: 2.6,
      gridExtra: animGrid(P, [4901 + i, 4902 + i], { stroke: ink, w0: 1.4, w1: .7, op: .8 }),
      stone: ballStone({
        P, lit: st.blLit, mid: st.blMid, dark: st.blDark, ink: st.blDark,
        rim: st.wDark, ring: v.sw, hi: "#ffffff", hiOp: .8,
        board: v.b1, bodyHex: dark ? "#e4eaf2" : "#fcfdff",
      }),
      css: "",
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     046 · 墨彩凯尔 ×10
     画法：几何化轮廓 + 缠绕纹与点饰（平涂但轮廓有装饰性）。
     变体：换"彩"的主色（蓝/绿/红/紫/金…），缠绕纹跟着换色。
     ══════════════════════════════════════════════════════════════════ */
  const KELLS = [
    ["-01", "凯尔蓝", { b0: "#f4ecd8", b1: "#e4d8bc", b2: "#d0c0a0", knot: "#3a5a8a", accent: "#b8562e", sw: "#3a5a8a", page: "#22282e" }],
    ["-02", "苔绿", { b0: "#eef0e0", b1: "#dce0c8", b2: "#c4c8a8", knot: "#3a6a40", accent: "#c07830", sw: "#3a6a40", page: "#1e2a1e" }],
    ["-03", "绯红", { b0: "#f8ece4", b1: "#ecd4c8", b2: "#d8b8a8", knot: "#9a3228", accent: "#2e6a5a", sw: "#9a3228", page: "#2e1e1a" }],
    ["-04", "葡萄紫", { b0: "#f0eaf4", b1: "#ded2e8", b2: "#c4b4d4", knot: "#5a3a7a", accent: "#c09030", sw: "#5a3a7a", page: "#281e32" }],
    ["-05", "赭金", { b0: "#f6eedc", b1: "#e8d8b8", b2: "#d0bc94", knot: "#8a6420", accent: "#3a6a8a", sw: "#8a6420", page: "#2e2618" }],
    ["-06", "墨青", { b0: "#1e2a30", b1: "#162026", b2: "#0e161a", knot: "#6aa0b0", accent: "#d09040", sw: "#6aa0b0", page: "#0a1014" }],
    ["-07", "深绛", { b0: "#301e22", b1: "#24161a", b2: "#180e12", knot: "#c07a80", accent: "#c0a050", sw: "#c07a80", page: "#140a0e" }],
    ["-08", "深林", { b0: "#1c2820", b1: "#141e18", b2: "#0c1410", knot: "#7aaa78", accent: "#c8a050", sw: "#7aaa78", page: "#0a100c" }],
    ["-09", "夜蓝", { b0: "#1c2438", b1: "#141a2a", b2: "#0c1018", knot: "#88a8e0", accent: "#e0a850", sw: "#88a8e0", page: "#080c14" }],
    ["-10", "灰陶", { b0: "#e8e4dc", b1: "#d4cfc4", b2: "#bcb6a8", knot: "#5a5248", accent: "#a05038", sw: "#5a5248", page: "#242220" }],
  ];

  KELLS.forEach(([suffix, label, v], i) => {
    const { P, push } = mk(`kells${suffix}`);
    const dark = isDark(v.b1);
    const ink = dark ? "#c8d0dc" : "#2e3a46";
    const st = isDark(v.b1)
      ? { blLit: "#5a6878", blMid: "#1a2230", blDark: "#080c14", wDark: "#5a6878" }
      : { blLit: "#4a5a72", blMid: "#243040", blDark: "#121a24", wDark: "#d8ccb0" };
    push({
      name: `墨彩凯尔 · ${label}`, swatch: v.sw, pageBg: v.page,
      vars: {
        "--bd-bg": v.b0, "--bd-line": ink, "--bd-star": v.accent,
        "--st-black": st.blMid, "--st-white": dark ? "#e4e8f0" : "#fbf6e8",
        "--ui-accent": v.knot, "--bd-radius": "12px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".013", oct: 2, seed: 111, scale: 1.4 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 121, scale: 2.2 })}
        ${grain(P, { slope: ".08", seed: 23 })}
        ${knot(P, "knot", { color: v.knot, op: dark ? .42 : .5 })}
        ${ballGrad(P, "sb", { lit: st.blLit, mid: st.blMid, dark: st.blDark })}
        ${ballGrad(P, "sw", { lit: "#ffffff", mid: dark ? "#e4e8f0" : "#fbf6e8", dark: st.wDark })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="${v.b0}"/><stop offset="1" stop-color="${v.b2}"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
        <g opacity="${dark ? ".4" : ".55"}">
          <rect x="6" y="6" width="120" height="120" fill="url(#${P("knot")})"/>
          <rect x="494" y="6" width="120" height="120" fill="url(#${P("knot")})"/>
          <rect x="6" y="494" width="120" height="120" fill="url(#${P("knot")})"/>
          <rect x="494" y="494" width="120" height="120" fill="url(#${P("knot")})"/>
        </g>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: v.accent, starR: 4.4,
      gridExtra: animGrid(P, [4601 + i, 4602 + i], { stroke: ink, w0: 2.4, w1: 1.1, op: .9 }),
      stone: ballStone({
        P, lit: st.blLit, mid: st.blMid, dark: st.blDark, ink: st.blDark,
        rim: st.wDark, ring: v.accent, hi: dark ? "#c8d8ff" : "#e8f0ff", hiOp: .75,
        board: v.b1, bodyHex: dark ? "#e4e8f0" : "#fbf6e8",
      }),
      css: "",
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     050 · 怒潮黑白 ×10
     画法：单色高对比 + 粗描 + 一角笔触（hardGrid 粗线、无渐变棋子）。
     ⚠ 深底必须给黑子加白描，否则糊在底盘里（本主题的深浅两极最极端）。
     变体：换"那一角"的颜色（血红/橙/青/黄…）与底。
     ══════════════════════════════════════════════════════════════════ */
  const PRIMALC = [
    ["-01", "血红", { b0: "#141414", b1: "#0d0d0d", line: "#f0ece2", accent: "#c8321e", page: "#0a0a0a" }],
    ["-02", "血橙", { b0: "#1a1008", b1: "#0e0806", line: "#f0e8d8", accent: "#e06028", page: "#0e0806" }],
    ["-03", "冰原", { b0: "#182028", b1: "#0e141a", line: "#e8f0f8", accent: "#40a8d8", page: "#0e141a" }],
    ["-04", "苔骨", { b0: "#1c2018", b1: "#10140c", line: "#e4e8d4", accent: "#8ab040", page: "#10140c" }],
    ["-05", "靛夜", { b0: "#141830", b1: "#0a0c1e", line: "#e0e4f8", accent: "#e0b020", page: "#0a0c1e" }],
    ["-06", "赭石", { b0: "#38241a", b1: "#241610", line: "#f0dcc0", accent: "#f0a020", page: "#241610" }],
    ["-07", "灰烬", { b0: "#282828", b1: "#181818", line: "#e8e8e8", accent: "#d84828", page: "#181818" }],
    ["-08", "翡翠", { b0: "#0e2420", b1: "#061412", line: "#e0f4ee", accent: "#28c090", page: "#061412" }],
    ["-09", "骨白", { b0: "#e8e4d8", b1: "#d4cfc0", line: "#181818", accent: "#b83020", page: "#2a2820" }],
    ["-10", "沙岩", { b0: "#e0d0b8", b1: "#c8b498", line: "#2a1c10", accent: "#c05018", page: "#2c2014" }],
  ];

  PRIMALC.forEach(([suffix, label, v], i) => {
    const { P, push } = mk(`primal${suffix}`);
    const dark = isDark(v.b1);
    push({
      name: `怒潮黑白 · ${label}`, swatch: v.accent, pageBg: v.page,
      vars: {
        "--bd-bg": v.b0, "--bd-line": v.line, "--bd-star": v.accent,
        "--st-black": dark ? "#f0ece2" : "#000000", "--st-white": "#f4f0e6",
        "--ui-accent": v.accent, "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".012", oct: 2, seed: 191 + i, scale: 1.2 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 201 + i, scale: 2.0 })}
        ${grain(P, { slope: ".10", seed: 41, bf: ".85" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="${v.b0}"/><stop offset="1" stop-color="${v.b1}"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="68%">
          <stop offset=".5" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity="${dark ? ".6" : ".34"}"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".58"/>
        <path d="M0 620L120 470l40 60 70-90 30 80 60-70 40 170Z" fill="${v.accent}" opacity=".62"
              filter="url(#${P("wob")})"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: v.accent, starR: 5.6,
      gridExtra: hardGrid(v.line, 3.4),
      stone: ({ x, y, r, player, isLast }) => {
        const body = player === 1 ? "#000000" : "#f4f0e6";
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        let s = `<path d="${blob(x, y, r, seed, { wob: 0.06 })}" fill="${body}"
                  stroke="#000000" stroke-width="${(r * 0.28).toFixed(2)}" stroke-linejoin="round"
                  filter="url(#${P("wob2")})"/>`;
        // ⚠ 深底上的黑子必须补描边，否则糊在底盘里
        if (player === 1 && dark) {
          s += `<path d="${blob(x, y, r, seed, { wob: 0.06 })}" fill="none"
                  stroke="${v.line}" stroke-width="${(r * 0.1).toFixed(2)}" opacity=".62"
                  filter="url(#${P("wob2")})"/>`;
        }
        if (isLast) {
          s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 5).toFixed(1)}"
                  fill="none" stroke="${v.accent}" stroke-width="3.6"/>`;
        }
        return s;
      },
      css: "",
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     045 · 逐帧硬线 ×10
     画法：硬直线几何 + 无渐变纯平色块 + 等宽描边（与 041 的圆软对立）。
     变体：换强调色与底（本主题最"安全"—— 本来就没渐变没抖动，换色即换风格）。
     ══════════════════════════════════════════════════════════════════ */
  const HARD = [
    ["-01", "砖红", { b0: "#e8e4d8", b1: "#ddd7c8", line: "#20242a", accent: "#d8452e", black: "#1a1e24", white: "#faf8f2", page: "#20242a" }],
    ["-02", "石墨", { b0: "#dcdcda", b1: "#c8c8c6", line: "#181a1e", accent: "#e04a30", black: "#14161a", white: "#fafafa", page: "#1a1c20" }],
    ["-03", "钴蓝", { b0: "#dce8f4", b1: "#c4d6e8", line: "#14304e", accent: "#e8a020", black: "#102538", white: "#f8fcff", page: "#16283a" }],
    ["-04", "森绿", { b0: "#e2ecdc", b1: "#c8dcc0", line: "#1c3a22", accent: "#d84a20", black: "#16301c", white: "#f6fbf2", page: "#182c1e" }],
    ["-05", "芥末", { b0: "#f0e8c8", b1: "#ded2a4", line: "#3a3210", accent: "#a03060", black: "#2c260c", white: "#fdfaec", page: "#2a2410" }],
    ["-06", "紫罗兰", { b0: "#e8e0f0", b1: "#d0c4e0", line: "#2c1a48", accent: "#f0c020", black: "#221438", white: "#faf6ff", page: "#241838" }],
    ["-07", "藏青", { b0: "#1c2440", b1: "#141a30", line: "#e8ecf8", accent: "#f0a830", black: "#080c18", white: "#f0f4ff", page: "#080c18" }],
    ["-08", "纯黑", { b0: "#181818", b1: "#0e0e0e", line: "#f0f0f0", accent: "#e03020", black: "#000000", white: "#f8f8f8", page: "#000000" }],
    ["-09", "奶白", { b0: "#faf7f0", b1: "#eee9dc", line: "#2a2620", accent: "#c04828", black: "#22201c", white: "#ffffff", page: "#2a2620" }],
    ["-10", "青灰", { b0: "#e4ecec", b1: "#ccd8d8", line: "#1e3434", accent: "#c06030", black: "#16282a", white: "#f4fafa", page: "#182c2e" }],
  ];

  HARD.forEach(([suffix, label, v], i) => {
    const { P, push } = mk(`hard${suffix}`);
    push({
      name: `逐帧硬线 · ${label}`, swatch: v.accent, pageBg: v.page,
      vars: {
        "--bd-bg": v.b0, "--bd-line": v.line, "--bd-star": v.accent,
        "--st-black": v.black, "--st-white": v.white,
        "--ui-accent": v.accent, "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".01", oct: 1, seed: 101, scale: .8 })}
        ${grain(P, { slope: ".06", seed: 19, bf: ".95" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${v.b0}"/><stop offset="1" stop-color="${v.b1}"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: v.accent, starR: 5.2,
      // 只有 08 要认得每条线的序号（动效的相位差用它），其余 9 套一个属性都不加
      gridExtra: hardGrid(v.line, 2.6, suffix === "-08"
        ? { tag: (n) => ` class="${P("line")}" style="--i:${n}"` } : {}),
      // 纯平色块 + 等宽描边（本主题的性格：无渐变）
      stone: ({ x, y, r, player, isLast }) => {
        const body = player === 1 ? v.black : v.white;
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        let s = `<path d="${blob(x, y, r, seed, { wob: 0.05 })}" fill="${body}"
                  stroke="${v.line}" stroke-width="${(r * 0.16).toFixed(2)}" stroke-linejoin="miter"/>`;
        if (isLast) {
          s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4.5).toFixed(1)}"
                  fill="none" stroke="${v.accent}" stroke-width="3.4"/>`;
        }
        return s;
      },
      css: "",
      /* ── 自带动效（只有 08 纯黑）：极轻的扫描感 ────────────────────
         这块盘的性格是"纯黑无装饰"，所以动效不往盘上加任何东西 —— 只让画里
         已有的 30 条硬线自己亮一下。逐帧动画的性格是"一格一格"，于是走**单侧**
         起伏：常态压暗在 .7，只有亮带正经过的那几根线才顶到 1.0，看去就像
         老式赛璐珞片上扫过的一道摄影灯。
         ⚠ 线一根都不位移：硬线网格是这块盘的几何基准，一动就散了"硬线"的味道。 */
      boardMotions: suffix === "-08" ? [{
        id: "bmo-hard-08",
        name: "硬线扫描",
        desc: "一道亮带沿 30 条硬线缓缓走过，纯黑盘面上唯一的动",
        css: (id) => `
          /* 横竖共用一个序号（第 i 行与第 i 列挨着），所以同一相位上是一横一竖
             一起亮 —— 看到的是一枚"+" 的交点沿对角线从左上爬到右下，比"整片线
             一起闪"更像逐帧动画里的那道扫描。30 条各差 -.5s，爬完一遍正好 15s
             = 一个周期，接得上不过头。周期再短就不是"扫描"而是"闪屏"了。
             只动 stroke-opacity：hardGrid 画的是纯描边线、身上没有滤镜，
             stroke-width 一个像素都没动（红线 2）。 */
          @keyframes ${id}-sweep{ 0%,100%{stroke-opacity:.7} 50%{stroke-opacity:1} }
          #board .${P("line")}{
            animation: ${id}-sweep 15s ease-in-out infinite;
            animation-delay: calc(var(--i) * -.5s);
          }
          ${RM(`#board .${P("line")}`)}
        `,
      }] : [],
    });
  });
})();
