/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   族 F · 独立游戏美学（Indie Game Art Direction）—— 051-060
   ★ 本族按「每个风格 10 套方案」交付：10 风格 × 10 情绪变体 = 100 套

   ── 两层结构（重要，别拍平成 100 个独立块）────────────────────────────
     第一层 · 风格（style）：一款独立游戏的**规则**——限色、限形、限笔触。
       如「沙旅极简」= 只用色块不用线、边缘全靠 blur 化开。
       风格是**画法**，写在 makeXxxStyle(pal) 工厂里，只写一次。
     第二层 · 情绪（mood）：同一画法换 10 组调子。
       如「沙旅极简 · 霜原」= 同一套软边色块，换成冷白蓝的雪原调。
       情绪是**色板**，每组只有十几个色值。

     ⚠ 为什么必须这么拆：100 个手写块 ≈ 8500 行近似重复代码，
       改一个共同毛病要改 100 处。工厂化后画法只有 10 份，
       加/改情绪只动色板（十几行）。

   ── 10 组情绪（全族统一，让同一个"情绪"在各风格间可对照）──────────────
     MOODS 数组里每项是一套色板的**角色定义**，各风格把它翻译成自己的语言：
       日（暖黄）· 雨（冷灰青）· 夜（深蓝紫）· 雪（冷白）
       火（橙红）· 苔（绿褐）  · 墨（黑灰）  · 霞（粉紫）
       海（青蓝）· 沙（褐黄）
     ⚠ 各风格的色板不是照抄 MOODS 的色值，而是按该风格的材质/工艺重新配，
       但**明暗倾向要一致**（"夜"在哪一族都是深底），这样 100 套才不会乱。

   ── 每套必满足的三条（与前五族一致）──────────────────────────────────
     ① 线有性格：不是自由手绘，而是**被规则约束过**的线
     ② 形有取舍：形状服从该作品的世界观
     ③ 色有情绪：**限色**，每套色板不超过 4~5 色

   ── 技法要点（前五族的坑，别重犯）────────────────────────────────────
     · 随机必须用**确定性 hash + 坐标派生 seed**，不能用 Math.random()
     · 滤镜必须显式写 x/y/width/height（默认 -10%/120% 会裁掉位移）
     · 网格不要用一条 path 画完 15 条 —— 每根线单独一条
     · defs id 一律走 P()，且**必须与渲染器请求的字符串逐字一致**
     · 棋子必须过 safeRim 护边（白子放浅盘上会"隐形"，ΔL 检查查不出）
     · 色相 ≠ 明度：色相负责好看，明度负责分得清，两个都要照顾
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    Q: (n) => `${ID}--${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  /* ── 棋盘几何（与 playable.html 一致：15 路 / viewBox 620 / PAD 46）── */
  const N = 15;
  const PAD = 46;
  const SPAN = 620 - PAD * 2;
  const GAP = SPAN / (N - 1);
  const XY = (i) => PAD + i * GAP;

  /* ══════════════════════════════════════════════════════════════════
     共用工具
     ══════════════════════════════════════════════════════════════════ */

  /** 确定性伪随机：同一 seed 永远同一序列。
   *  ⚠ 不要用 Math.random() —— 每落一子整盘重绘，形状会跳。
   *  ⚠ 这不是密码学随机，也不该是：它只给 SVG 形状做**确定性**微扰，
   *     "可被预测"正是本意（同一颗棋子每次渲染必须一模一样）。
   *     安全扫描器可能报成弱随机，属误报，勿改。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };

  /** 抖动滤镜。x/y/width/height 必须显式写，否则位移被裁。 */
  const wobble = (id, { bf = ".016", oct = 2, seed = 7, scale = 1.8 } = {}) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 颗粒 / 纸感。 */
  const grain = (P, { slope = ".07", seed = 5, bf = ".8", key = "grain" } = {}) => `
    <filter id="${P(key)}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="2" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 柔边（沙旅/幽光这类"没有硬线"的风格用）。 */
  const softBlur = (P, { std = 2.6, key = "soft" } = {}) => `
    <filter id="${P(key)}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${std}"/>
    </filter>`;

  /** 柔光溢出（霓虹/幽光用）。 */
  const bloom = (P, key, { color = "#7fd8ff", op = .5, x = "50%", y = "50%", r = "52%" } = {}) => `
    <radialGradient id="${P(key)}" cx="${x}" cy="${y}" r="${r}">
      <stop offset="0" stop-color="${color}" stop-opacity="${op}"/>
      <stop offset=".5" stop-color="${color}" stop-opacity="${op * .28}"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>`;

  /** 不规则团块。 */
  const blob = (x, y, r, seed, { wob = 0.06, n = 16 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - wob / 2 + rand() * wob);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i += 1) {
      const c = pts[(i + 1) % n];
      const nx = pts[(i + 2) % n];
      d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
    }
    return `${d}Z`;
  };

  /** 像素方块（像素族用）：**硬边**多边形，不是圆。 */
  const pixelBlock = (x, y, r, seed, { jag = 0.18, cell = 3 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    const s = r * 1.02;
    const step = Math.max(2, Math.round((r * 2) / cell));
    for (let i = 0; i <= step; i += 1) {
      const t = i / step;
      pts.push([x - s + t * s * 2, y - s + (rand() < jag ? -cell * rand() : 0)]);
    }
    for (let i = 0; i <= step; i += 1) {
      const t = i / step;
      pts.push([x + s + (rand() < jag ? cell * rand() : 0), y - s + t * s * 2]);
    }
    for (let i = step; i >= 0; i -= 1) {
      const t = i / step;
      pts.push([x - s + t * s * 2, y + s + (rand() < jag ? cell * rand() : 0)]);
    }
    for (let i = step; i >= 0; i -= 1) {
      const t = i / step;
      pts.push([x - s + (rand() < jag ? -cell * rand() : 0), y - s + t * s * 2]);
    }
    return `M${pts.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join("L")}Z`;
  };

  /** 等距菱形（纪念碑谷用）：30° 菱形面，无透视。 */
  const isoDiamond = (x, y, r, { flat = 0.58 } = {}) => {
    const w = r * 1.06, h = r * 1.06 * flat;
    return `M${x.toFixed(1)} ${(y - h).toFixed(1)}L${(x + w).toFixed(1)} ${y.toFixed(1)}` +
           `L${x.toFixed(1)} ${(y + h).toFixed(1)}L${(x - w).toFixed(1)} ${y.toFixed(1)}Z`;
  };

  /** 抖动网点（Obra Dinn 用）：1-bit 双色造灰阶，用 Bayer 有序抖动。 */
  const dither = (P, key, { fg = "#0d0d0d", bg = "#e8e4d8", density = 0.5, cell = 4 } = {}) => {
    let dots = "";
    const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    const th = density * 16;
    for (let by = 0; by < cell; by += 1) {
      for (let bx = 0; bx < cell; bx += 1) {
        if (bayer[by % 4][bx % 4] < th) dots += `M${bx} ${by}h1v1h-1Z`;
      }
    }
    return `<pattern id="${P(key)}" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse">
      <rect width="${cell}" height="${cell}" fill="${bg}"/>
      <path d="${dots}" fill="${fg}"/>
    </pattern>`;
  };

  /** 相对亮度（WCAG）。 */
  const relLum = (hex) => {
    const h = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const lumDiff = (a, b) => Math.abs(relLum(a) - relLum(b)) * 100;

  /** 自动护边：棋子色和盘底色太接近时，补一圈对比描边。
   *  ⚠ 本族必须 —— 白子放浅盘上会"隐形"，`.check-stones.mjs` 查不出。 */
  const safeRim = (stoneColor, boardColor, { tol = 22 } = {}) => {
    if (lumDiff(stoneColor, boardColor) >= tol) return null;
    return relLum(stoneColor) > relLum(boardColor) ? "rgba(24,18,12,.72)" : "rgba(255,246,224,.66)";
  };

  /** 无障碍：系统要求「减少动态效果」时掐掉这条选择器上的动画。
   *  每条自带动效（boardMotions）都要带，`.check-motion.mjs` 会逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* ══════════════════════════════════════════════════════════════════
     10 组情绪变体（全族共用这套"角色"，各风格翻译成自己的语言）
     ── 每组给出色板**角色**，不是固定色值：
        bd1/bd2  盘底渐变两端      ln   网格线
        star     星位              sB/sW 黑子/白子主色
        sBh/sWh  两子的受光/高光    accent UI 强调色
        pageBg   页面底色（换肤时整页跟着变）
     ⚠ 明暗倾向要跨风格一致："夜"在哪一族都是深底，这样 100 套排在一起不乱。
     ⚠ **10 组情绪必须占据互不重叠的"色彩领地"**（这是踩过坑改的）：
       第一版我给了 day 和 sand 都是暖赭（金褐）、rain 和 sea 都是冷蓝（青蓝），
       结果实测跨全族最像的两对就是 day-vs-sand（距离 3.3）和 rain-vs-sea（4.2），
       远低于 18 的"过像"红线 —— 缩略图里就是同一块颜色。
       修法：给每个情绪**排他**的色相 + 明度定位，10 组分别占：
         day  暖金黄 · 中高明度        rain 冷灰蓝 · 中高明度、低饱和
         night 深靛蓝 · 极暗            snow 中性冷白 · 极高明度、近无彩
         ember 橙红 · 中低明度、高饱和   moss 黄绿 · 中明度、土气
         ink  中性灰 · 全明度压缩        dusk 紫红 · 中低明度
         sea  深青绿 · 暗、高饱和        sand 漂白浅黄 · 极高明度、极低饱和
       尤其注意两组容易撞的：**day(金黄) vs sand(漂白黄)** 靠"饱和度 + 明度"分，
       **rain(灰蓝) vs sea(青绿)** 靠"色相偏绿 + 暗度"分。
     ══════════════════════════════════════════════════════════════════ */
  const MOODS = [
    { key: "day",   label: "暖日", dark: false },
    { key: "rain",  label: "冷雨", dark: false },
    { key: "night", label: "深宵", dark: true },
    { key: "snow",  label: "霜雪", dark: false },
    { key: "ember", label: "炉火", dark: true },
    { key: "moss",  label: "苔原", dark: false },
    { key: "ink",   label: "墨砚", dark: true },
    { key: "dusk",  label: "暮霞", dark: true },
    { key: "sea",   label: "深海", dark: true },
    { key: "sand",  label: "漂沙", dark: false },
  ];

  /* ══════════════════════════════════════════════════════════════════
     风格工厂总表。每个工厂： (P, push, mood) => void
     注册后每套的 id = `${styleId}-${mood.key}`，name = `${styleName} · ${mood.label}`
     ══════════════════════════════════════════════════════════════════ */

  /* ────────────────────────────────────────────────────────────────
     051 · 沙旅极简（《Journey》）
     规则：**不用线**，只有色块；边缘全靠 blur 化开；棋子是无描边的软边袍子。
     ════════════════════════════════════════════════════════════════ */
  const buildJourney = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    /* ⚠ 子体半径 0.92r 不是随手定的：加上 0.16r 的霓虹描边正好 1.0r，
       与其他棋子同一外径。原来写 1.25r，换到这枚子会突然大 42%，
       用户就是因此说「一类大、一类小」。 */
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 13 + y * 7 + player * 211);
      const body = player === 1 ? pal.sB : pal.sW;
      // ⚠ 沙旅第一版白子是"隐形"的（白沙金盘 + 沙金白子，同色系同明度）。
      //   ΔL 检查只比黑子 vs 白子，查不出"子 vs 盘底"，必须自己补。
      //   沙旅的边要"软"——用 blur 化开，硬描边就不像沙旅了。
      const guard = safeRim(body, pal.bd2, { tol: 26 });
      let s = "";
      if (guard) {
        s += `<path d="${blob(x, y, r + 1.4, seed, { wob: 0.09 })}" fill="none"
                stroke="${player === 1 ? pal.rimB : pal.rimW}"
                stroke-width="${(r * 0.3).toFixed(2)}" filter="url(#${P("soft")})"/>`;
      }
      s += `<path d="${blob(x, y, r, seed, { wob: 0.09 })}" fill="${body}"
              filter="url(#${P("soft")})"/>`;
      s += `<ellipse cx="${(x - r * 0.3).toFixed(1)}" cy="${(y - r * 0.34).toFixed(1)}"
              rx="${(r * 0.5).toFixed(1)}" ry="${(r * 0.36).toFixed(1)}"
              fill="${player === 1 ? pal.sBh : pal.sWh}" opacity=".5"
              filter="url(#${P("soft")})"/>`;
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 3.5).toFixed(1)}"
                fill="none" stroke="${pal.ring}" stroke-width="2.2" opacity=".8"
                filter="url(#${P("soft")})"/>`;
      }
      return s;
    };
    push({
      name: `沙旅极简 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd2, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.sB, "--st-white": pal.sW,
        "--ui-accent": pal.accent, "--bd-radius": "20px",
      },
      defs: `
        ${softBlur(P, { std: 2.6 })}
        ${grain(P, { slope: ".09", seed: 11, bf: ".7" })}
        <linearGradient id="${P("base")}" x1="0" y1="1" x2=".2" y2="0">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".45" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("sun")}" cx="72%" cy="24%" r="56%">
          <stop offset="0" stop-color="${pal.sun}" stop-opacity=".65"/>
          <stop offset="1" stop-color="${pal.sun}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="52%" r="76%">
          <stop offset=".55" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${pal.vig}" stop-opacity=".34"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <g fill="none" stroke="${pal.dune}" stroke-width="26" opacity=".28" filter="url(#${P("soft")})">
          <path d="M-20 520q180-70 340-30t300-40"/>
          <path d="M-20 570q220-50 380-14t280-30"/>
        </g>
        <rect width="620" height="620" fill="url(#${P("sun")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 1.4, lineOpacity: .22, lineFilter: P("soft"),
      starFill: pal.star, starR: 3.4, starOpacity: .55,
      stone, css: "",
    });
  };
  const JOURNEY_PAL = {
    day:   { bd1: "#c98f52", bd2: "#e8bd82", bd3: "#f2d8a8", ln: "#b8854a", star: "#a8703a",
             sB: "#8a5a3c", sW: "#f0d8a8", sBh: "#c98a4a", sWh: "#fffbf0",
             sun: "#ffd98a", vig: "#5a3418", dune: "#b87c42",
             rimB: "rgba(60,30,10,.6)", rimW: "rgba(90,50,20,.72)",
             swatch: "#d9a05b", pageBg: "#241a12", accent: "#c98a4a" },
    rain:  { bd1: "#8fa0a8", bd2: "#b8c6cc", bd3: "#d4dee2", ln: "#7a8c94", star: "#5f7178",
             sB: "#46565e", sW: "#e8f0f4", sBh: "#6f8794", sWh: "#ffffff",
             sun: "#cfe4ee", vig: "#3a4a54", dune: "#8ea2ab",
             rimB: "rgba(24,36,44,.6)", rimW: "rgba(40,60,72,.7)",
             swatch: "#a8bcc6", pageBg: "#1c262c", accent: "#7fa0b0" },
    night: { bd1: "#1e2a48", bd2: "#2c3a5e", bd3: "#3e4e78", ln: "#5a6f9a", star: "#8fa8d0",
             sB: "#131a30", sW: "#d8e2f4", sBh: "#41598c", sWh: "#ffffff",
             sun: "#7f9fd8", vig: "#0a0e1c", dune: "#2a3a60",
             rimB: "rgba(160,190,240,.5)", rimW: "rgba(10,16,32,.7)",
             swatch: "#4a5f92", pageBg: "#0c1020", accent: "#6f8cc8" },
    snow:  { bd1: "#b8c8d8", bd2: "#d8e4ee", bd3: "#eef4f8", ln: "#8fa2b4", star: "#6f8496",
             sB: "#3a4a5c", sW: "#fbfdff", sBh: "#6f8ba4", sWh: "#ffffff",
             sun: "#ffffff", vig: "#5a6c7e", dune: "#a8bcc8",
             rimB: "rgba(30,44,58,.6)", rimW: "rgba(60,80,96,.55)",
             swatch: "#cfe0ec", pageBg: "#28323c", accent: "#8fb0c4" },
    ember: { bd1: "#4a2418", bd2: "#6e3a20", bd3: "#8e5030", ln: "#a86a44", star: "#d89050",
             sB: "#1c0e08", sW: "#f4d8b0", sBh: "#8a4020", sWh: "#fff4e0",
             sun: "#ffb060", vig: "#200c04", dune: "#7a4020",
             rimB: "rgba(255,180,120,.5)", rimW: "rgba(40,16,6,.7)",
             swatch: "#c96a30", pageBg: "#1a0c06", accent: "#d88040" },
    moss:  { bd1: "#5a6a44", bd2: "#7e8e5e", bd3: "#9caa7c", ln: "#5f6f48", star: "#4a5a34",
             sB: "#2a3420", sW: "#e4ecd0", sBh: "#5a7040", sWh: "#f8fce8",
             sun: "#d8e0a0", vig: "#2a3418", dune: "#6f8050",
             rimB: "rgba(190,210,150,.5)", rimW: "rgba(28,36,16,.7)",
             swatch: "#8a9e64", pageBg: "#1c2414", accent: "#7a9048" },
    ink:   { bd1: "#4a4a4c", bd2: "#6a6a6c", bd3: "#8c8c8e", ln: "#565658", star: "#3e3e40",
             sB: "#141416", sW: "#ececee", sBh: "#5a5a5e", sWh: "#ffffff",
             sun: "#b0b0b4", vig: "#18181a", dune: "#5a5a5e",
             rimB: "rgba(200,200,206,.5)", rimW: "rgba(16,16,18,.72)",
             swatch: "#8a8a8e", pageBg: "#1a1a1c", accent: "#9a9a9e" },
    dusk:  { bd1: "#5a3a5c", bd2: "#8a5a78", bd3: "#c08a94", ln: "#8a5a72", star: "#6e4260",
             sB: "#2a1830", sW: "#f8e0e8", sBh: "#8a4a70", sWh: "#fff8fc",
             sun: "#ffb8a0", vig: "#2a1230", dune: "#9a5a70",
             rimB: "rgba(255,190,210,.5)", rimW: "rgba(36,16,40,.7)",
             swatch: "#c07a92", pageBg: "#241228", accent: "#b06a8a" },
    sea:   { bd1: "#0e2e26", bd2: "#14453a", bd3: "#1e5c4a", ln: "#2f7a62", star: "#4fa88c",
             sB: "#061a16", sW: "#d0f4e8", sBh: "#1a5044", sWh: "#f0fff8",
             sun: "#5fd0a8", vig: "#03130f", dune: "#145044",
             rimB: "rgba(120,220,190,.5)", rimW: "rgba(4,18,14,.72)",
             swatch: "#1e6a56", pageBg: "#04120e", accent: "#2f8a6e" },
    sand:  { bd1: "#ece0c4", bd2: "#f6efdc", bd3: "#fdf8ec", ln: "#b8a888", star: "#a09070",
             sB: "#6a5844", sW: "#fffaf0", sBh: "#a89070", sWh: "#ffffff",
             sun: "#fff4d0", vig: "#8a7a5e", dune: "#dccdb0",
             rimB: "rgba(80,64,44,.55)", rimW: "rgba(120,104,80,.5)",
             swatch: "#e8dcc0", pageBg: "#3a3226", accent: "#c0a878" },
  };

  /* ────────────────────────────────────────────────────────────────
     052 · 幽光林线（《Ori》）
     规则：**线是发光的** —— 主体的亮来自线的外溢，不是色块。
     ════════════════════════════════════════════════════════════════ */
  const buildOri = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 17 + y * 11 + player * 337);
      const core = player === 1 ? pal.sB : pal.sW;
      const glowC = player === 1 ? pal.gB : pal.gW;
      let s = "";
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 1.5).toFixed(1)}"
              fill="${glowC}" opacity=".2" filter="url(#${P("soft")})"/>`;
      s += `<path d="${blob(x, y, r, seed, { wob: 0.07 })}" fill="${core}"
              stroke="${glowC}" stroke-width="${(r * 0.2).toFixed(2)}"
              filter="url(#${P("wob2")})"/>`;
      s += `<path d="${blob(x - r * 0.1, y - r * 0.12, r * 0.4, seed + 9, { wob: 0.2 })}"
              fill="${glowC}" opacity="${player === 1 ? .5 : .8}"
              filter="url(#${P("soft")})"/>`;
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 5).toFixed(1)}"
                fill="none" stroke="${glowC}" stroke-width="2" opacity=".85"
                filter="url(#${P("soft")})"/>`;
      }
      return s;
    };
    push({
      name: `幽光林线 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.sB, "--st-white": pal.sW,
        "--ui-accent": pal.accent, "--bd-radius": "18px",
      },
      defs: `
        ${softBlur(P, { std: 3.2 })}
        <filter id="${P("soft2")}" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7"/></filter>
        <filter id="${P("wob2")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".028" numOctaves="2" seed="29" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".55" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("pool")}" cx="30%" cy="26%" r="60%">
          <stop offset="0" stop-color="${pal.gW}" stop-opacity=".34"/>
          <stop offset="1" stop-color="${pal.gW}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="48%" r="74%">
          <stop offset=".42" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".72"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("pool")})"/>
        <g fill="none" stroke="${pal.vine}" stroke-width="2.4" opacity=".4" filter="url(#${P("soft")})">
          <path d="M30 40q60 120 20 240t40 280"/>
          <path d="M590 60q-70 130-24 250t-46 270"/>
          <path d="M120 600q40-90 130-120t150-140"/>
        </g>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 1.5, lineOpacity: .5, lineFilter: P("soft"),
      starFill: pal.star, starR: 3.2, starOpacity: .9,
      stone, css: "",
    });
  };
  const ORI_PAL = {
    day:   { bd1: "#2a4a3a", bd2: "#1e3a2e", bd3: "#142a20", ln: "#5fa878", star: "#9fe0a8",
             sB: "#0d2a1c", sW: "#e8ffe8", gB: "#4fd87a", gW: "#c8ffd8", vine: "#2a7a48",
             swatch: "#4fd87a", pageBg: "#0c1a12", accent: "#5fc87a" },
    rain:  { bd1: "#28414a", bd2: "#1c2e36", bd3: "#121f26", ln: "#5f9aaa", star: "#9fd8e4",
             sB: "#0d2630", sW: "#e4f8ff", gB: "#4fb8d0", gW: "#c8eeff", vine: "#2a6a7a",
             swatch: "#4fb8d0", pageBg: "#0a161c", accent: "#5fa8c0" },
    night: { bd1: "#1e2444", bd2: "#161a34", bd3: "#0e1024", ln: "#5f6fae", star: "#a8b8f0",
             sB: "#0d1030", sW: "#e8eaff", gB: "#6f7fe8", gW: "#d0d8ff", vine: "#3a4a9a",
             swatch: "#6f7fe8", pageBg: "#080a1a", accent: "#7f8fe0" },
    snow:  { bd1: "#3a4c56", bd2: "#2a3842", bd3: "#1c262e", ln: "#8fb4c4", star: "#d8eef8",
             sB: "#1c3038", sW: "#ffffff", gB: "#a8d8ee", gW: "#ffffff", vine: "#4a7a8e",
             swatch: "#a8d8ee", pageBg: "#10181e", accent: "#8fc4dc" },
    ember: { bd1: "#4a2a1e", bd2: "#361e14", bd3: "#24120c", ln: "#c07048", star: "#ffb070",
             sB: "#2a1008", sW: "#ffe8cc", gB: "#ff8040", gW: "#ffd8a0", vine: "#a04a20",
             swatch: "#ff8040", pageBg: "#180a04", accent: "#e87030" },
    moss:  { bd1: "#2e3c24", bd2: "#222e1a", bd3: "#161f10", ln: "#7a9a5a", star: "#c0d890",
             sB: "#182410", sW: "#f0ffe0", gB: "#8ac850", gW: "#d8f0a8", vine: "#4a6a2a",
             swatch: "#8ac850", pageBg: "#0e1408", accent: "#7ab848" },
    ink:   { bd1: "#2e2e30", bd2: "#222224", bd3: "#161618", ln: "#8a8a8e", star: "#d0d0d4",
             sB: "#101012", sW: "#f8f8fa", gB: "#a8a8b0", gW: "#ffffff", vine: "#5a5a60",
             swatch: "#a8a8b0", pageBg: "#0e0e10", accent: "#909098" },
    dusk:  { bd1: "#3c2444", bd2: "#2c1a32", bd3: "#1c1024", ln: "#b07ac0", star: "#f0a8e0",
             sB: "#20102a", sW: "#ffe8ff", gB: "#d060e0", gW: "#f8c8ff", vine: "#7a3a8a",
             swatch: "#d060e0", pageBg: "#140818", accent: "#c050d0" },
    sea:   { bd1: "#0e3228", bd2: "#0a2820", bd3: "#061a14", ln: "#2f8a6a", star: "#6fe0b0",
             sB: "#041a14", sW: "#d0ffe8", gB: "#2fd096", gW: "#a0ffd0", vine: "#146a50",
             swatch: "#2fd096", pageBg: "#031410", accent: "#28b884" },
    sand:  { bd1: "#e8dcc0", bd2: "#d4c6a4", bd3: "#b8a888", ln: "#a89878", star: "#8a7a5a",
             sB: "#5a4a34", sW: "#fff8e8", gB: "#c0a878", gW: "#fff0d0", vine: "#8a7a58",
             swatch: "#d4c6a4", pageBg: "#3a3226", accent: "#b8a078" },
  };

  /* ────────────────────────────────────────────────────────────────
     053 · 冥界彩绘（《Hades》）
     规则：**厚黑描边 + 高饱和平涂**，明暗只分两档（没有渐变过渡）。
     ════════════════════════════════════════════════════════════════ */
  const buildHades = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 19 + y * 23 + player * 401);
      const body = player === 1 ? pal.sB : pal.sW;
      let s = `<path d="${blob(x, y, r, seed, { wob: 0.09, n: 12 })}" fill="${body}"
                stroke="${pal.ink}" stroke-width="${(r * 0.34).toFixed(2)}"
                stroke-linejoin="round" filter="url(#${P("wob2")})"/>`;
      // 明暗只两档：一道硬边的月牙暗部（不是渐变）
      s += `<path d="M${(x - r * 0.1).toFixed(1)} ${(y + r * 0.92).toFixed(1)}
                 A${(r * 0.92).toFixed(1)} ${(r * 0.92).toFixed(1)} 0 0 0 ${(x + r * 0.86).toFixed(1)} ${(y - r * 0.1).toFixed(1)}
                 L${(x + r * 0.6).toFixed(1)} ${(y - r * 0.05).toFixed(1)}
                 A${(r * 0.66).toFixed(1)} ${(r * 0.66).toFixed(1)} 0 0 1 ${(x - r * 0.05).toFixed(1)} ${(y + r * 0.66).toFixed(1)}Z"
              fill="${player === 1 ? pal.shadeB : pal.shadeW}" opacity=".55"/>`;
      if (player === 1) {
        s += `<path d="M${(x - r * 0.34).toFixed(1)} ${(y + r * 0.2).toFixed(1)}
                   q${(r * 0.34).toFixed(1)} ${(-r * 0.5).toFixed(1)} ${(r * 0.68).toFixed(1)} 0"
                fill="none" stroke="${pal.mark}" stroke-width="${(r * 0.14).toFixed(2)}"
                stroke-linecap="round"/>`;
      } else {
        s += `<path d="M${x.toFixed(1)} ${(y - r * 0.42).toFixed(1)}
                   q${(r * 0.26).toFixed(1)} ${(r * 0.3).toFixed(1)} 0 ${(r * 0.56).toFixed(1)}
                   q${(-r * 0.26).toFixed(1)} ${(-r * 0.3).toFixed(1)} 0 ${(-r * 0.56).toFixed(1)}Z"
                fill="${pal.mark2}" opacity=".85"/>`;
      }
      if (isLast) {
        s += `<path d="${blob(x, y, r + 4.5, seed + 7, { wob: 0.12 })}" fill="none"
                stroke="${pal.ring}" stroke-width="3" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: `冥界彩绘 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.sB, "--st-white": pal.sW,
        "--ui-accent": pal.accent, "--bd-radius": "10px",
      },
      defs: `
        <filter id="${P("wob2")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="37" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${grain(P, { slope: ".06", seed: 17 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".6" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("fire")}" cx="50%" cy="82%" r="52%">
          <stop offset="0" stop-color="${pal.accent}" stop-opacity=".3"/>
          <stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="46%" r="72%">
          <stop offset=".44" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".68"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("fire")})"/>
        <g fill="none" stroke="${pal.gold}" stroke-width="2.6" opacity=".5">
          <path d="M12 46h26v-30h30v22h-22v-12h14"/>
          <path d="M608 46h-26v-30h-30v22h22v-12h-14"/>
          <path d="M12 574h26v30h30v-22h-22v12h14"/>
          <path d="M608 574h-26v30h-30v-22h22v12h-14"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 2.2, lineOpacity: .78,
      starFill: pal.star, starR: 5.4, starOpacity: .95,
      stone, css: "",
    });
  };
  const HADES_PAL = {
    day:   { bd1: "#4a3a2a", bd2: "#332618", bd3: "#1e1610", ln: "#c09050", star: "#f0c060",
             sB: "#2a1c10", sW: "#f4e4c0", shadeB: "#5a4028", shadeW: "#c0a070",
             ink: "#140c06", mark: "#e8a020", mark2: "#4fd8a0", ring: "#f0c060", gold: "#e8a020",
             swatch: "#c99040", pageBg: "#1a1208", accent: "#d8a040" },
    rain:  { bd1: "#2a3a44", bd2: "#1c2a32", bd3: "#121c22", ln: "#5f9ab0", star: "#8fd0e8",
             sB: "#0e1e26", sW: "#dcf0f8", shadeB: "#2a4a58", shadeW: "#a8c8d8",
             ink: "#060e14", mark: "#3fb8e0", mark2: "#8fe0ff", ring: "#5fc0e8", gold: "#3fa0c8",
             swatch: "#3fa0c8", pageBg: "#0a1418", accent: "#4fb0d8" },
    night: { bd1: "#2a2050", bd2: "#1c1638", bd3: "#120e26", ln: "#8a6ade", star: "#c0a0ff",
             sB: "#120a2a", sW: "#e8e0ff", shadeB: "#3a2a6a", shadeW: "#b8a8e8",
             ink: "#080418", mark: "#a070ff", mark2: "#70e0ff", ring: "#c0a0ff", gold: "#9080e0",
             swatch: "#8a6ade", pageBg: "#0a0620", accent: "#9a7ae8" },
    snow:  { bd1: "#3a4a58", bd2: "#28343e", bd3: "#1a2228", ln: "#9fc4d8", star: "#e0f4ff",
             sB: "#18262e", sW: "#ffffff", shadeB: "#3a5a68", shadeW: "#c8dce8",
             ink: "#0c1418", mark: "#7fd0f0", mark2: "#a8e8ff", ring: "#c0e8ff", gold: "#8fc8e8",
             swatch: "#a8d8f0", pageBg: "#121a20", accent: "#90c8e0" },
    ember: { bd1: "#4a1e14", bd2: "#33140e", bd3: "#1e0c08", ln: "#d06040", star: "#ff9060",
             sB: "#20080a", sW: "#ffdcc0", shadeB: "#5a2418", shadeW: "#d0a080",
             ink: "#180604", mark: "#ffb040", mark2: "#ffe080", ring: "#ff9060", gold: "#ffa040",
             swatch: "#e06040", pageBg: "#1a0806", accent: "#e86030" },
    moss:  { bd1: "#32402a", bd2: "#24301e", bd3: "#161e12", ln: "#8ab060", star: "#c8e090",
             sB: "#182410", sW: "#eef8d8", shadeB: "#384a26", shadeW: "#b8c898",
             ink: "#0c1208", mark: "#a8d850", mark2: "#e0f0a0", ring: "#c8e090", gold: "#90b850",
             swatch: "#8ab060", pageBg: "#121a0c", accent: "#7aa848" },
    ink:   { bd1: "#343438", bd2: "#242428", bd3: "#18181c", ln: "#8a8a92", star: "#d8d8e0",
             sB: "#0e0e12", sW: "#f4f4f8", shadeB: "#3a3a42", shadeW: "#b0b0b8",
             ink: "#040406", mark: "#c0c0c8", mark2: "#e8e8f0", ring: "#d8d8e0", gold: "#a8a8b0",
             swatch: "#909098", pageBg: "#141416", accent: "#a0a0a8" },
    dusk:  { bd1: "#40244a", bd2: "#2e1a36", bd3: "#1c1022", ln: "#c070c0", star: "#f0a0e8",
             sB: "#200c28", sW: "#ffe0f8", shadeB: "#54285a", shadeW: "#d0a0c8",
             ink: "#160618", mark: "#e060c8", mark2: "#ffb0f0", ring: "#f0a0e8", gold: "#d080c8",
             swatch: "#c070c0", pageBg: "#180a1c", accent: "#c860b8" },
    sea:   { bd1: "#102e26", bd2: "#0a221c", bd3: "#061612", ln: "#30906c", star: "#60d8a8",
             sB: "#041610", sW: "#ccf4e0", shadeB: "#1a4a3c", shadeW: "#88c8b0",
             ink: "#02100c", mark: "#28d098", mark2: "#90f0c0", ring: "#60d8a8", gold: "#2aa87a",
             swatch: "#28a078", pageBg: "#03110e", accent: "#28b088" },
    sand:  { bd1: "#e4d8b8", bd2: "#d0c2a0", bd3: "#b4a684", ln: "#a09070", star: "#7a6a4a",
             sB: "#4a3a26", sW: "#fff6e0", shadeB: "#7a6648", shadeW: "#e0d4b8",
             ink: "#241a0e", mark: "#c0a060", mark2: "#a0c090", ring: "#d8c090", gold: "#c0a868",
             swatch: "#d0c2a0", pageBg: "#3a3222", accent: "#b8a478" },
  };

  /* ────────────────────────────────────────────────────────────────
     054 · 囚徒残影（《Dead Cells》）
     规则：**像素块 + 拖尾残影**（运动感来自残留粒子，不是笔触）。
     ════════════════════════════════════════════════════════════════ */
  const buildDeadcells = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 23 + y * 29 + player * 419);
      const body = player === 1 ? pal.sB : pal.sW;
      const trail = player === 1 ? pal.trailB : pal.trailW;
      // ⚠ 深底 + 深色黑子 = 看不见子落哪（ΔL 检查查不出）。
      //   补亮色描边（用拖尾色）：既解决可见性，又强化"残影"的霓虹感。
      let s = "";
      const rand = rng(seed + 5);
      for (let i = 1; i <= 3; i += 1) {
        const ox = -i * r * 0.42, oy = i * r * 0.2 + (rand() - .5) * 2;
        s += `<path d="${pixelBlock(x + ox, y + oy, r * (1 - i * 0.14), seed + i * 31, { jag: 0.3, cell: 4 })}"
                fill="${trail}" opacity="${(0.34 - i * 0.09).toFixed(2)}"/>`;
      }
      s += `<path d="${pixelBlock(x, y, r, seed, { jag: 0.22, cell: 4 })}" fill="${body}"
              stroke="${trail}" stroke-width="${(r * 0.14).toFixed(2)}"/>`;
      s += `<rect x="${(x - r * 0.3).toFixed(1)}" y="${(y - r * 0.16).toFixed(1)}"
              width="${(r * 0.34).toFixed(1)}" height="${(r * 0.32).toFixed(1)}"
              fill="${trail}" opacity=".95"/>`;
      if (isLast) {
        s += `<path d="${pixelBlock(x, y, r + 3.5, seed + 3, { jag: 0.16, cell: 4 })}"
                fill="none" stroke="${pal.ring}" stroke-width="2"/>`;
      }
      return s;
    };
    push({
      name: `囚徒残影 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.sB, "--st-white": pal.sW,
        "--ui-accent": pal.accent, "--bd-radius": "4px",
      },
      defs: `
        ${grain(P, { slope: ".07", seed: 23, bf: "1.1" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".55" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("glowA")}" cx="22%" cy="20%" r="54%">
          <stop offset="0" stop-color="${pal.glowA}" stop-opacity=".34"/>
          <stop offset="1" stop-color="${pal.glowA}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("glowB")}" cx="80%" cy="84%" r="50%">
          <stop offset="0" stop-color="${pal.glowB}" stop-opacity=".28"/>
          <stop offset="1" stop-color="${pal.glowB}" stop-opacity="0"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("glowA")})"/>
        <rect width="620" height="620" fill="url(#${P("glowB")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
      `,
      // 像素风网格：硬边、等宽、绝对直（这一版的"限制"就是不许手抖）
      lineStroke: pal.ln, lineW: 1.6, lineOpacity: .5,
      starFill: pal.star, starR: 4, starOpacity: .8,
      stone, css: "",
    });
  };
  const DEADCELLS_PAL = {
    day:   { bd1: "#4a3a24", bd2: "#33280f", bd3: "#221a0a", ln: "#b09050", star: "#f0c060",
             sB: "#2a1f10", sW: "#f0e4c0", trailB: "#d09030", trailW: "#40b880",
             glowA: "#c09040", glowB: "#509060", ring: "#f0d060",
             swatch: "#c09040", pageBg: "#1a1208", accent: "#c09040" },
    rain:  { bd1: "#2e3e48", bd2: "#1e2c34", bd3: "#141e24", ln: "#5f96b0", star: "#8fd0e8",
             sB: "#10202a", sW: "#d8f0f8", trailB: "#3fa0c0", trailW: "#60d8b0",
             glowA: "#3f8098", glowB: "#2f8068", ring: "#60c0e0",
             swatch: "#3fa0c0", pageBg: "#0c161c", accent: "#4fb0d0" },
    night: { bd1: "#241e44", bd2: "#181234", bd3: "#0e0a22", ln: "#6f5ab0", star: "#b0a0f0",
             sB: "#120c2a", sW: "#e0dcff", trailB: "#7a50d0", trailW: "#60d8c0",
             glowA: "#5a3a9a", glowB: "#2a6a7a", ring: "#c0a8ff",
             swatch: "#7a50d0", pageBg: "#0a0620", accent: "#8a60d8" },
    snow:  { bd1: "#3a4a56", bd2: "#26343e", bd3: "#1a242a", ln: "#9fc4d8", star: "#d8f0ff",
             sB: "#16262e", sW: "#ffffff", trailB: "#80c8e8", trailW: "#a0e8f0",
             glowA: "#5f9ab8", glowB: "#4f88a0", ring: "#c0e8ff",
             swatch: "#8fc8e8", pageBg: "#121a20", accent: "#90c8e0" },
    ember: { bd1: "#481c12", bd2: "#30120c", bd3: "#1c0a06", ln: "#c05030", star: "#ff8050",
             sB: "#1e0806", sW: "#ffd0b0", trailB: "#e04020", trailW: "#ffb060",
             glowA: "#c04020", glowB: "#a06020", ring: "#ffd060",
             swatch: "#d04020", pageBg: "#180604", accent: "#e05030" },
    moss:  { bd1: "#2e3c22", bd2: "#202c18", bd3: "#141e0e", ln: "#7aa050", star: "#c0e080",
             sB: "#16220e", sW: "#eaf8d0", trailB: "#60b030", trailW: "#a0e060",
             glowA: "#4a8030", glowB: "#608020", ring: "#c0e080",
             swatch: "#70b040", pageBg: "#0e1608", accent: "#70a840" },
    ink:   { bd1: "#303034", bd2: "#222226", bd3: "#161618", ln: "#8a8a92", star: "#d0d0d8",
             sB: "#0e0e12", sW: "#f4f4f8", trailB: "#909098", trailW: "#c0c0c8",
             glowA: "#6a6a70", glowB: "#5a5a60", ring: "#e0e0e8",
             swatch: "#909098", pageBg: "#121214", accent: "#a0a0a8" },
    dusk:  { bd1: "#3c2046", bd2: "#2a1432", bd3: "#1a0c20", ln: "#b060c0", star: "#f0a0e0",
             sB: "#1e0a26", sW: "#ffd8f8", trailB: "#d040b0", trailW: "#ff90d0",
             glowA: "#a040a0", glowB: "#80406a", ring: "#ffb0f0",
             swatch: "#c050b0", pageBg: "#16081a", accent: "#c050c0" },
    sea:   { bd1: "#0e2e24", bd2: "#0a201a", bd3: "#061410", ln: "#2f8e68", star: "#60d8a0",
             sB: "#04160e", sW: "#ccf4dc", trailB: "#18b878", trailW: "#78f0b8",
             glowA: "#187a58", glowB: "#186a50", ring: "#60e0a8",
             swatch: "#18b078", pageBg: "#03120c", accent: "#18b878" },
    sand:  { bd1: "#e2d6b6", bd2: "#cec09e", bd3: "#b2a482", ln: "#9e8e6e", star: "#786848",
             sB: "#483822", sW: "#fff4dc", trailB: "#b89858", trailW: "#d8c898",
             glowA: "#c0a878", glowB: "#a8a070", ring: "#d8c898",
             swatch: "#cec09e", pageBg: "#38301e", accent: "#b6a476" },
  };

  /* ────────────────────────────────────────────────────────────────
     055 · 霓虹遗迹（《Hyper Light Drifter》）
     规则：**像素块 + 光溢出**（硬边与散光必须同时存在）。
     ════════════════════════════════════════════════════════════════ */
  const buildHyperlight = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 31 + y * 37 + player * 443);
      const body = player === 1 ? pal.sB : pal.sW;
      const neon = player === 1 ? pal.neonB : pal.neonW;
      let s = "";
      s += `<path d="${pixelBlock(x, y, r * 0.92, seed + 2, { jag: 0.1, cell: 3 })}"
              fill="${neon}" opacity=".3" filter="url(#${P("bloom")})"/>`;
      s += `<path d="${pixelBlock(x, y, r, seed, { jag: 0.2, cell: 3 })}" fill="${body}"
              stroke="${neon}" stroke-width="${(r * 0.16).toFixed(2)}"/>`;
      s += `<rect x="${(x - r * 0.44).toFixed(1)}" y="${(y - r * 0.06).toFixed(1)}"
              width="${(r * 0.88).toFixed(1)}" height="${(r * 0.14).toFixed(1)}"
              fill="${neon}" opacity=".85"/>`;
      if (isLast) {
        s += `<path d="${pixelBlock(x, y, r + 4, seed + 4, { jag: 0.08, cell: 3 })}"
                fill="none" stroke="${neon}" stroke-width="2.2" filter="url(#${P("bloom")})"/>`;
      }
      return s;
    };
    /* 动效钩子：只有「暮霞」这一版该动（画面里那排遗迹剪影 + 屋顶的霓虹亮线）。
       类名带 pid 前缀、再按情绪 gate —— 另外 9 个情绪共用这段模板，
       字符串一字节不变，绝不会跟着莫名动起来。 */
    const mc = mood.key === "dusk" ? (n) => ` class="${P(n)}"` : () => "";
    push({
      name: `霓虹遗迹 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.sB, "--st-white": pal.sW,
        "--ui-accent": pal.accent, "--bd-radius": "6px",
      },
      defs: `
        <filter id="${P("bloom")}" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5"/></filter>
        <filter id="${P("bloom2")}" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9"/></filter>
        ${grain(P, { slope: ".06", seed: 31, bf: "1.2" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".6" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("haze")}" cx="50%" cy="60%" r="60%">
          <stop offset="0" stop-color="${pal.haze}" stop-opacity=".22"/>
          <stop offset="1" stop-color="${pal.haze}" stop-opacity="0"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("haze")})"/>
        <g${mc("ruin")} fill="${pal.bd3}" opacity=".8">
          <rect x="34" y="470" width="26" height="120"/>
          <rect x="70" y="500" width="18" height="90"/>
          <rect x="556" y="452" width="30" height="138"/>
          <rect x="520" y="498" width="20" height="92"/>
          <path d="M240 620v-70h40v70Z"/>
          <path d="M360 620v-56h32v56Z"/>
        </g>
        <g${mc("roof")} stroke="${pal.neonW}" stroke-width="1.6" opacity=".4" fill="none">
          <path d="M34 470h26M556 452h30"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".42"/>
      `,
      lineStroke: pal.ln, lineW: 1.4, lineOpacity: .55,
      starFill: pal.star, starR: 3.6, starOpacity: .95,
      stone, css: "",
      /* ── 自带动效：这块盘画的是"暮色里的霓虹遗迹"，该动的是遗迹轮廓上那层辉光 ──
         ① 辉光呼吸：剪影层与屋顶霓虹层周期不同 → 天然错峰，两层交替明暗
         ② 远景视差：这两层一起极缓横移，而雾霭/底色不动，深度就出来了
         ⚠ 最后那张 grain rect 挂着 feTurbulence：它自己不动，也不是被动画元素的祖先。 */
      boardMotions: mood.key === "dusk" ? [{
        id: "bmo-indie-hyperlight-dusk",
        name: "霓虹辉光 · 远景视差",
        desc: "遗迹轮廓上的霓虹错峰呼吸，远景极缓横移",
        css: (id) => `
          /* 剪影和屋顶那道霓虹亮线**共用同一条 drift**：亮线本来就压在建筑顶边上
             （M34 470h26 / M556 452h30），两层各走各的会让高光从屋顶滑下去。
             只有横移同步、脉冲错开，才既脱开"整块板在动"又不散架。 */
          @keyframes ${id}-drift{
            0%,100% { transform: translate(0,0) }
            50%     { transform: translate(-5px,2px) }
          }
          /* 呼吸只在原值之下走（.8→.6 / .4→.18）：这两个 opacity 是原画配好的上限，
             往上加就是把画改亮了。周期 6~9s —— 霓虹是"闪"的东西，比雾快一档就够。 */
          @keyframes ${id}-pulse-a{ 0%,100%{opacity:.8}  50%{opacity:.6} }
          @keyframes ${id}-pulse-b{ 0%,100%{opacity:.4}  50%{opacity:.18} }
          #board .${P("ruin")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-drift 21s ease-in-out infinite,
                       ${id}-pulse-a 8s ease-in-out infinite;
          }
          #board .${P("roof")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-drift 21s ease-in-out infinite,
                       ${id}-pulse-b 6.2s ease-in-out infinite;
            animation-delay: 0s, -2.6s;   /* 只错开脉冲，横移必须同相位 */
          }
          ${RM(`#board .${P("ruin")},#board .${P("roof")}`)}
        `,
      }] : [],
    });
  };
  const HYPERLIGHT_PAL = {
    day:   { bd1: "#3a3220", bd2: "#28220f", bd3: "#1a1608", ln: "#b09050", star: "#ffd060",
             sB: "#3a2a10", sW: "#fff0d0", neonB: "#ffb020", neonW: "#60e0a0",
             haze: "#c09040", swatch: "#ffb020", pageBg: "#181208", accent: "#ffb020" },
    rain:  { bd1: "#1e2e3a", bd2: "#141f28", bd3: "#0a1218", ln: "#4a7a9a", star: "#70d0f0",
             sB: "#102030", sW: "#d8f0ff", neonB: "#40c0f0", neonW: "#90e0ff",
             haze: "#3a7aa0", swatch: "#40c0f0", pageBg: "#08101a", accent: "#40c0f0" },
    night: { bd1: "#1a1438", bd2: "#120e28", bd3: "#0a0818", ln: "#5a4a9a", star: "#b0a0ff",
             sB: "#1c1240", sW: "#e0dcff", neonB: "#9a70ff", neonW: "#70d0ff",
             haze: "#5a4aa8", swatch: "#9a70ff", pageBg: "#080618", accent: "#9a70ff" },
    snow:  { bd1: "#2a3a46", bd2: "#1c2830", bd3: "#101a20", ln: "#7aa8c0", star: "#d0f0ff",
             sB: "#182830", sW: "#ffffff", neonB: "#70d0f0", neonW: "#b0f0ff",
             haze: "#5a9ab8", swatch: "#70d0f0", pageBg: "#0c161c", accent: "#70d0f0" },
    ember: { bd1: "#38160e", bd2: "#260e08", bd3: "#160804", ln: "#b04020", star: "#ff7040",
             sB: "#2a0e06", sW: "#ffc8a0", neonB: "#ff5010", neonW: "#ffb060",
             haze: "#c04018", swatch: "#ff5010", pageBg: "#140604", accent: "#ff5010" },
    moss:  { bd1: "#1e2c14", bd2: "#141e0c", bd3: "#0c1406", ln: "#5a8a30", star: "#a0e060",
             sB: "#14220a", sW: "#e8ffd0", neonB: "#70d020", neonW: "#c0ff70",
             haze: "#4a7a20", swatch: "#70d020", pageBg: "#081004", accent: "#70d020" },
    ink:   { bd1: "#26262a", bd2: "#1a1a1e", bd3: "#101012", ln: "#7a7a82", star: "#d0d0d8",
             sB: "#0e0e12", sW: "#f8f8fc", neonB: "#b0b0b8", neonW: "#e8e8f0",
             haze: "#6a6a72", swatch: "#b0b0b8", pageBg: "#0e0e10", accent: "#b0b0b8" },
    dusk:  { bd1: "#2c1438", bd2: "#1e0e28", bd3: "#120818", ln: "#a040b0", star: "#ff80e0",
             sB: "#280e30", sW: "#ffd8f8", neonB: "#ff40c0", neonW: "#c080ff",
             haze: "#a040a0", swatch: "#ff40c0", pageBg: "#100614", accent: "#ff40c0" },
    sea:   { bd1: "#0a2820", bd2: "#061c16", bd3: "#041210", ln: "#208868", star: "#40e0a0",
             sB: "#041c14", sW: "#c8ffe4", neonB: "#00e090", neonW: "#50f0b0",
             haze: "#187a58", swatch: "#00e090", pageBg: "#031008", accent: "#00e090" },
    sand:  { bd1: "#e0d4b4", bd2: "#ccbe9c", bd3: "#b0a280", ln: "#9c8c6c", star: "#766646",
             sB: "#463620", sW: "#fff2d8", neonB: "#c0a050", neonW: "#a8c888",
             haze: "#b8a478", swatch: "#ccbe9c", pageBg: "#362e1c", accent: "#b4a274" },
  };

  /* ────────────────────────────────────────────────────────────────
     056 · 等距迷失（《Monument Valley》）
     规则：所有形都是 **30° 等距面**，没有圆、没有透视 —— 纯几何。
     ════════════════════════════════════════════════════════════════ */
  const buildMonument = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 41 + y * 43 + player * 461);
      const top = player === 1 ? pal.topB : pal.topW;
      const left = player === 1 ? pal.leftB : pal.leftW;
      const right = player === 1 ? pal.rightB : pal.rightW;
      const rand = rng(seed);
      const jitter = () => (rand() - 0.5) * r * 0.16;
      const cx = x + jitter(), cy = y + jitter();
      const w = r * 1.05, h = r * 0.6, d = r * 0.5;
      let s = "";
      s += `<path d="M${cx} ${cy - h - d * 0.5}L${cx + w} ${cy - d * 0.5}L${cx} ${cy + d * 0.5}L${cx - w} ${cy - d * 0.5}Z"
              fill="${top}"/>`;
      s += `<path d="M${cx - w} ${cy - d * 0.5}L${cx} ${cy + d * 0.5}L${cx} ${cy + d * 0.5 + h}L${cx - w} ${cy - d * 0.5 + h}Z"
              fill="${left}"/>`;
      s += `<path d="M${cx + w} ${cy - d * 0.5}L${cx} ${cy + d * 0.5}L${cx} ${cy + d * 0.5 + h}L${cx + w} ${cy - d * 0.5 + h}Z"
              fill="${right}"/>`;
      // 棱线：等距的棱必须画出来，否则三个面会糊在一起
      s += `<path d="M${cx} ${cy - h - d * 0.5}L${cx + w} ${cy - d * 0.5}L${cx + w} ${cy - d * 0.5 + h}L${cx} ${cy + d * 0.5 + h}L${cx - w} ${cy - d * 0.5 + h}L${cx - w} ${cy - d * 0.5}Z"
              fill="none" stroke="${pal.edge}" stroke-width="${(r * 0.1).toFixed(2)}" stroke-linejoin="round" opacity=".7"/>`;
      s += `<path d="M${cx} ${cy + d * 0.5}V${cy + d * 0.5 + h}M${cx} ${cy - h - d * 0.5}V${cy + d * 0.5}"
              stroke="${pal.edge}" stroke-width="${(r * 0.07).toFixed(2)}" opacity=".5" fill="none"/>`;
      // 护边：等距面放在同色系盘上会糊，补一圈
      const guard = safeRim(top, pal.bd2, { tol: 20 });
      if (guard) {
        s += `<path d="M${cx} ${cy - h - d * 0.5}L${cx + w} ${cy - d * 0.5}L${cx + w} ${cy - d * 0.5 + h}L${cx} ${cy + d * 0.5 + h}L${cx - w} ${cy - d * 0.5 + h}L${cx - w} ${cy - d * 0.5}Z"
                fill="none" stroke="${guard}" stroke-width="${(r * 0.16).toFixed(2)}" stroke-linejoin="round"/>`;
      }
      if (isLast) {
        s += `<path d="${isoDiamond(cx, cy + d * 0.5 + h, r + 3)}" fill="none"
                stroke="${pal.ring}" stroke-width="2.2"/>`;
      }
      return s;
    };
    /* 动效钩子：只有「墨砚」这一版该动（见下面 boardMotions）。类名带 pid 前缀 +
       按情绪 gate —— 另外 9 个情绪共用这段模板，字符串一字节不变。 */
    const mc = mood.key === "ink" ? (n) => ` class="${P(n)}"` : () => "";
    push({
      name: `等距迷失 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.topB, "--st-white": pal.topW,
        "--ui-accent": pal.accent, "--bd-radius": "10px",
      },
      defs: `
        ${grain(P, { slope: ".05", seed: 41, bf: ".75" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".55" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("sun")}" cx="70%" cy="18%" r="56%">
          <stop offset="0" stop-color="${pal.sun}" stop-opacity=".42"/>
          <stop offset="1" stop-color="${pal.sun}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="76%">
          <stop offset=".55" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${pal.vig}" stop-opacity=".3"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("sun")})"/>
        <g${mc("float")} opacity=".5">
          <path d="M30 620V540l30-18v-40l30 18v120Z" fill="${pal.block1}"/>
          <path d="M560 620V520l34-20v-34l30 18v136Z" fill="${pal.block2}"/>
          <path d="M250 620v-46l26-15v-30l26 15v76Z" fill="${pal.block1}"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".35"/>
        <rect${mc("bleed")} width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 1.4, lineOpacity: .5,
      starFill: pal.star, starR: 3.6, starOpacity: .8,
      stone, css: "",
      /* ── 自带动效：这版是"墨砚"调子，画面里该动的是等距浮城 + 边缘洇开的墨 ──
         ① 浮城：三座等距塔整层极缓上下浮（纪念碑谷的城本来就是浮着的）
         ② 墨晕：暗角那层（vig 用的正是墨色）缓慢洇开 / 收住
         ⚠ 它上一张 grain rect 挂着 feTurbulence —— 只动它下面/上面的兄弟，
           那张滤镜页一动不动，浏览器就能复用它的噪声缓存。 */
      boardMotions: mood.key === "ink" ? [{
        id: "bmo-indie-monument-ink",
        name: "墨晕呼吸 · 浮城",
        desc: "等距塔极缓上下浮，盘缘的墨晕一明一暗地洇开",
        css: (id) => `
          /* 塔只**往下**浮（0→3px），不走 −3px：这三座塔的底边正好压在盘底 y=620 上，
             抬起来会在脚下露出一道底色缝，塔就"塌"了；压下去被 viewBox 裁掉，无痕。
             幅度仍是 ±3px 量级，只是把零点放在原位、往安全的半边偏。 */
          @keyframes ${id}-float{
            0%,100% { transform: translateY(0) }
            50%     { transform: translateY(3px) }
          }
          /* 呼吸只在原值之下走（.66→1）：1 就是原画配好的最深墨。
             6s —— 墨洇得快慢是这版的"呼吸"，比位移那一层快一档正好分得开。 */
          @keyframes ${id}-bleed{ 0%,100%{opacity:.66} 50%{opacity:1} }
          #board .${P("float")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-float 19s ease-in-out infinite;
          }
          #board .${P("bleed")}{
            animation: ${id}-bleed 6s ease-in-out infinite;
          }
          ${RM(`#board .${P("float")},#board .${P("bleed")}`)}
        `,
      }] : [],
    });
  };
  const MONUMENT_PAL = {
    day:   { bd1: "#f0e4cc", bd2: "#ddd0b4", bd3: "#c4b494", ln: "#b0a080", star: "#8a7a5a",
             topB: "#4a5a8a", leftB: "#2a3560", rightB: "#1c2450",
             topW: "#f8f0e0", leftW: "#d0c0a8", rightW: "#b0a088",
             edge: "#3a2c1a", block1: "#c0b094", block2: "#cdbd9e", sun: "#ffe0b0", vig: "#5a4a30",
             ring: "#c08020", swatch: "#8a7a5a", pageBg: "#2a2418", accent: "#8a7ab8" },
    rain:  { bd1: "#dce4ea", bd2: "#c4d0d8", bd3: "#a8b8c4", ln: "#8fa2b0", star: "#5f7484",
             topB: "#3a4a66", leftB: "#243450", rightB: "#162440",
             topW: "#eef4f8", leftW: "#c0ccd8", rightW: "#a0b0c0",
             edge: "#2a3844", block1: "#a8b8c4", block2: "#b8c6d0", sun: "#e0f0ff", vig: "#3a4a58",
             ring: "#40a0c0", swatch: "#5f7484", pageBg: "#1c262c", accent: "#5a8ab8" },
    night: { bd1: "#2a2a4a", bd2: "#20203c", bd3: "#161630", ln: "#5a5a8a", star: "#9090c8",
             topB: "#4a5a9a", leftB: "#2a3568", rightB: "#1a2450",
             topW: "#c8d0f0", leftW: "#8a94c0", rightW: "#6a74a0",
             edge: "#0e0e22", block1: "#2a2a4a", block2: "#32325a", sun: "#8090d0", vig: "#0a0a1c",
             ring: "#c0a0ff", swatch: "#5a5a9a", pageBg: "#101024", accent: "#7a7ac8" },
    snow:  { bd1: "#e4ecf2", bd2: "#ccd9e2", bd3: "#b0c0cc", ln: "#93a8b8", star: "#6a8090",
             topB: "#4a5c70", leftB: "#2e4054", rightB: "#1e3044",
             topW: "#ffffff", leftW: "#ccd8e2", rightW: "#aabac8",
             edge: "#2e3c48", block1: "#b0c0cc", block2: "#c0ced8", sun: "#ffffff", vig: "#4a5a68",
             ring: "#50a8d0", swatch: "#6a8090", pageBg: "#222c34", accent: "#6a9ac0" },
    ember: { bd1: "#e0c0a0", bd2: "#c8a480", bd3: "#ac8860", ln: "#a07850", star: "#7a5838",
             topB: "#5a3a4a", leftB: "#38202e", rightB: "#241420",
             topW: "#f8e0c0", leftW: "#d0ac88", rightW: "#b08c68",
             edge: "#3a2014", block1: "#ac8860", block2: "#bc9870", sun: "#ffc070", vig: "#5a3018",
             ring: "#ffb040", swatch: "#a07850", pageBg: "#2a1c12", accent: "#d08040" },
    moss:  { bd1: "#dce4c8", bd2: "#c4d0ac", bd3: "#a8b890", ln: "#8fa078", star: "#64784e",
             topB: "#3a4a30", leftB: "#243220", rightB: "#162414",
             topW: "#eef4dc", leftW: "#c0ccaa", rightW: "#a0b08c",
             edge: "#2a3418", block1: "#a8b890", block2: "#b8c4a0", sun: "#e8f0b0", vig: "#3a4428",
             ring: "#80c040", swatch: "#64784e", pageBg: "#1e2416", accent: "#7a9a50" },
    ink:   { bd1: "#d8d8da", bd2: "#c0c0c4", bd3: "#a4a4a8", ln: "#8a8a90", star: "#606066",
             topB: "#3a3a40", leftB: "#26262c", rightB: "#18181e",
             topW: "#ececee", leftW: "#c0c0c4", rightW: "#a0a0a6",
             edge: "#222226", block1: "#a4a4a8", block2: "#b4b4b8", sun: "#f0f0f2", vig: "#3a3a3e",
             ring: "#909098", swatch: "#606066", pageBg: "#1e1e20", accent: "#8a8a90" },
    dusk:  { bd1: "#e8d4e0", bd2: "#d0b4c8", bd3: "#b496ac", ln: "#9a7c92", star: "#705a72",
             topB: "#5a3a5c", leftB: "#38203c", rightB: "#241428",
             topW: "#f8e4f0", leftW: "#d0aec0", rightW: "#b08ea4",
             edge: "#3a1c30", block1: "#b496ac", block2: "#c4a6bc", sun: "#ffc0d8", vig: "#4a2840",
             ring: "#e060b0", swatch: "#9a7c92", pageBg: "#241826", accent: "#c060a0" },
    sea:   { bd1: "#c2e0d2", bd2: "#a2c8b6", bd3: "#84ae9c", ln: "#6b9682", star: "#466e5c",
             topB: "#1e5442", leftB: "#103828", rightB: "#0a261a",
             topW: "#d4eede", leftW: "#a2c4b2", rightW: "#84a894",
             edge: "#122e22", block1: "#84ae9c", block2: "#94bcaa", sun: "#a0f0c8", vig: "#264a3a",
             ring: "#20c090", swatch: "#466e5c", pageBg: "#14261e", accent: "#28a878" },
    sand:  { bd1: "#e2d6b8", bd2: "#cec0a0", bd3: "#b2a482", ln: "#9e8e6e", star: "#786848",
             topB: "#5a4c34", leftB: "#3a301e", rightB: "#241c10",
             topW: "#fff8e4", leftW: "#dcd0b4", rightW: "#bcae92",
             edge: "#342a18", block1: "#b2a482", block2: "#c2b492", sun: "#fff4d0", vig: "#544830",
             ring: "#d8b060", swatch: "#7e6e4e", pageBg: "#3a3222", accent: "#b8a478" },
  };

  /* ────────────────────────────────────────────────────────────────
     057 · 纸牌木刻（《Slay the Spire》）
     规则：**卡片语法** —— 每颗子是一张小牌，有框、有底色、有符号。
     ════════════════════════════════════════════════════════════════ */
  const buildSpire = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const card = player === 1 ? pal.cardB : pal.cardW;
      const ink = player === 1 ? pal.inkB : pal.inkW;
      const s2 = r * 0.94;
      let s = "";
      s += `<rect x="${(x - s2).toFixed(1)}" y="${(y - s2 * 1.12).toFixed(1)}"
              width="${(s2 * 2).toFixed(1)}" height="${(s2 * 2.24).toFixed(1)}"
              rx="${(r * 0.16).toFixed(1)}" fill="${card}" stroke="${ink}" stroke-width="${(r * 0.15).toFixed(2)}"/>`;
      s += `<rect x="${(x - s2 * 0.84).toFixed(1)}" y="${(y - s2 * 0.94).toFixed(1)}"
              width="${(s2 * 1.68).toFixed(1)}" height="${(s2 * 1.88).toFixed(1)}"
              rx="${(r * 0.1).toFixed(1)}" fill="none" stroke="${pal.gold}"
              stroke-width="${(r * 0.08).toFixed(2)}" opacity=".85"/>`;
      if (player === 1) {
        s += `<path d="M${x.toFixed(1)} ${(y - s2 * 0.56).toFixed(1)}v${(s2 * 0.9).toFixed(1)}
                   M${(x - s2 * 0.3).toFixed(1)} ${(y - s2 * 0.2).toFixed(1)}h${(s2 * 0.6).toFixed(1)}"
                stroke="${pal.gold}" stroke-width="${(r * 0.11).toFixed(2)}" stroke-linecap="round" fill="none"/>`;
      } else {
        s += `<path d="M${x.toFixed(1)} ${(y - s2 * 0.5).toFixed(1)}
                   l${(s2 * 0.46).toFixed(1)} ${(s2 * 0.3).toFixed(1)}
                   v${(s2 * 0.42).toFixed(1)}
                   l${(-s2 * 0.46).toFixed(1)} ${(s2 * 0.3).toFixed(1)}
                   l${(-s2 * 0.46).toFixed(1)} ${(-s2 * 0.3).toFixed(1)}
                   v${(-s2 * 0.42).toFixed(1)}Z"
                fill="none" stroke="${ink}" stroke-width="${(r * 0.1).toFixed(2)}" stroke-linejoin="round"/>`;
      }
      if (isLast) {
        s += `<rect x="${(x - s2 - 3).toFixed(1)}" y="${(y - s2 * 1.12 - 3).toFixed(1)}"
                width="${(s2 * 2 + 6).toFixed(1)}" height="${(s2 * 2.24 + 6).toFixed(1)}"
                rx="${(r * 0.2).toFixed(1)}" fill="none" stroke="${pal.ring}" stroke-width="2.6"/>`;
      }
      return s;
    };
    /* 动效钩子：只有「暖日」这一版该动（torch 那团暖光就是画面里该扫过的东西）。
       类名带 pid 前缀 + 按情绪 gate —— 另外 9 个情绪共用这段模板，字符串一字节不变。 */
    const mc = mood.key === "day" ? (n) => ` class="${P(n)}"` : () => "";
    push({
      name: `纸牌木刻 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.cardB, "--st-white": pal.cardW,
        "--ui-accent": pal.accent, "--bd-radius": "8px",
      },
      defs: `
        <filter id="${P("wob2")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="53" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${grain(P, { slope: ".1", seed: 47, bf: ".7" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".6" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("torch")}" cx="50%" cy="34%" r="58%">
          <stop offset="0" stop-color="${pal.gold}" stop-opacity=".26"/>
          <stop offset="1" stop-color="${pal.gold}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="48%" r="72%">
          <stop offset=".42" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".7"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect${mc("sweep")} width="620" height="620" fill="url(#${P("torch")})"/>
        <rect x="14" y="14" width="592" height="592" rx="6" fill="none"
              stroke="${pal.gold}" stroke-width="3" opacity=".55"/>
        <rect x="24" y="24" width="572" height="572" rx="4" fill="none"
              stroke="${pal.gold2}" stroke-width="1.4" opacity=".45"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".55"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.gold, lineW: 1.8, lineOpacity: .34, lineFilter: P("wob2"),
      starFill: pal.star, starR: 5, starOpacity: .85,
      stone, css: "",
      /* ── 自带动效：木刻牌桌被一侧的日光照着，该动的是 torch 那团暖光斑 ──
         横扫用 alternate 来回，不走"到尽头啪一下跳回"的单向循环。
         ⚠ 中间那张 grain rect 挂着 feTurbulence、网格 path 挂着 wob2（displacement），
           两者都不碰；torch 自己从内到 #board 这条链上没有任何 filter。 */
      boardMotions: mood.key === "day" ? [{
        id: "bmo-indie-spire-day",
        name: "暖日横扫",
        desc: "一团日光从牌桌这侧缓缓掠到那侧，来回不停",
        css: (id) => `
          /* 光斑的位移**可以大于常规 8px**：它没有形、只有亮，边界是径向渐变自己糊
             出来的（r=58% 处已归零），横扫时不会像"物体挪位"那样露馅。
             真正兜住"不抢戏"的是速度：24s 走完 80px ≈ 3.3px/s，一眼看不出在跑。
             ⚠ 别学物体那样 ±0 起跳——alternate 从 -40px 起步，均值正好是原画位置。 */
          @keyframes ${id}-sweep{
            from { transform: translateX(-40px) }
            to   { transform: translateX(40px) }
          }
          #board .${P("sweep")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-sweep 24s ease-in-out infinite alternate;
          }
          ${RM(`#board .${P("sweep")}`)}
        `,
      }] : [],
    });
  };
  const SPIRE_PAL = {
    day:   { bd1: "#5a4630", bd2: "#3d2f1e", bd3: "#2a2014", ln: "#c9a24a", star: "#e8c060",
             cardB: "#2a1c14", cardW: "#f0e4c8", inkB: "#0f0a06", inkW: "#3a2c1c",
             gold: "#c9a24a", gold2: "#8a6a2a", ring: "#e8a020",
             swatch: "#c9a24a", pageBg: "#181008", accent: "#c9a24a" },
    rain:  { bd1: "#3a4a54", bd2: "#28343c", bd3: "#1a242a", ln: "#8fb0c0", star: "#b8d8e8",
             cardB: "#1c2830", cardW: "#e0ecf2", inkB: "#0a1218", inkW: "#2a3a44",
             gold: "#7fa8c0", gold2: "#4a6a80", ring: "#a0d0e8",
             swatch: "#8fb0c0", pageBg: "#101820", accent: "#8fb0c0" },
    night: { bd1: "#3a3050", bd2: "#28203a", bd3: "#1a1428", ln: "#9a8ad0", star: "#d0c0ff",
             cardB: "#1e1638", cardW: "#e4e0f8", inkB: "#0c0820", inkW: "#2e2a50",
             gold: "#a090e0", gold2: "#5a5090", ring: "#c0b0ff",
             swatch: "#9a8ad0", pageBg: "#12102a", accent: "#9a8ad0" },
    snow:  { bd1: "#5a6470", bd2: "#3e4650", bd3: "#2a3038", ln: "#c0d0dc", star: "#f0f8ff",
             cardB: "#28323a", cardW: "#ffffff", inkB: "#101820", inkW: "#3a4650",
             gold: "#a8c0d4", gold2: "#5f7888", ring: "#e0f0ff",
             swatch: "#c0d0dc", pageBg: "#1a2026", accent: "#c0d0dc" },
    ember: { bd1: "#5a3020", bd2: "#3d2014", bd3: "#2a140c", ln: "#e08050", star: "#ffb070",
             cardB: "#2a0e08", cardW: "#ffd8b8", inkB: "#140604", inkW: "#4a2418",
             gold: "#ffa040", gold2: "#a06020", ring: "#ffc060",
             swatch: "#e08050", pageBg: "#180a06", accent: "#e08050" },
    moss:  { bd1: "#46543a", bd2: "#303c28", bd3: "#1e2818", ln: "#a0d060", star: "#d0f090",
             cardB: "#1e2c16", cardW: "#e8f4d0", inkB: "#0c1408", inkW: "#2e4020",
             gold: "#90c050", gold2: "#4a6a28", ring: "#c0e080",
             swatch: "#a0d060", pageBg: "#121a0c", accent: "#a0d060" },
    ink:   { bd1: "#4a4a4e", bd2: "#323236", bd3: "#222226", ln: "#c0c0c8", star: "#e8e8f0",
             cardB: "#1a1a1e", cardW: "#f4f4f8", inkB: "#08080a", inkW: "#323238",
             gold: "#a8a8b0", gold2: "#5a5a62", ring: "#d8d8e0",
             swatch: "#c0c0c8", pageBg: "#161618", accent: "#c0c0c8" },
    dusk:  { bd1: "#54324e", bd2: "#382038", bd3: "#261428", ln: "#e070c0", star: "#ffa8e0",
             cardB: "#2a0e28", cardW: "#ffe0f4", inkB: "#140418", inkW: "#4a1e44",
             gold: "#e060b0", gold2: "#8a3068", ring: "#ff90d0",
             swatch: "#e070c0", pageBg: "#1a0c1e", accent: "#e070c0" },
    sea:   { bd1: "#1a3a30", bd2: "#122a22", bd3: "#0a1c16", ln: "#40b088", star: "#70e0a8",
             cardB: "#08221a", cardW: "#d4f4e4", inkB: "#041410", inkW: "#1e4034",
             gold: "#30a878", gold2: "#1a5f48", ring: "#70e0a8",
             swatch: "#40b088", pageBg: "#061612", accent: "#40b088" },
    sand:  { bd1: "#e6dabc", bd2: "#d2c4a2", bd3: "#b8aa88", ln: "#a49474", star: "#7e6e4e",
             cardB: "#3a2e1c", cardW: "#fff6e0", inkB: "#1c1408", inkW: "#4a3e28",
             gold: "#c0a868", gold2: "#8a7a4a", ring: "#e0c890",
             swatch: "#d2c4a2", pageBg: "#3a3220", accent: "#c0a868" },
  };

  /* ────────────────────────────────────────────────────────────────
     058 · 灰证词卷（《Papers, Please》）
     规则：**一切都在表格里** —— 棋子是"证件照"，落子是盖章。
     ════════════════════════════════════════════════════════════════ */
  const buildPapers = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const s2 = r * 0.96;
      const photo = player === 1 ? pal.photoB : pal.photoW;
      const silh = player === 1 ? pal.silhB : pal.silhW;
      let s = "";
      s += `<rect x="${(x - s2 * 0.82).toFixed(1)}" y="${(y - s2).toFixed(1)}"
              width="${(s2 * 1.64).toFixed(1)}" height="${(s2 * 2).toFixed(1)}"
              fill="${pal.frame}" stroke="${pal.ink}" stroke-width="${(r * 0.1).toFixed(2)}"/>`;
      s += `<rect x="${(x - s2 * 0.66).toFixed(1)}" y="${(y - s2 * 0.84).toFixed(1)}"
              width="${(s2 * 1.32).toFixed(1)}" height="${(s2 * 1.5).toFixed(1)}"
              fill="${photo}"/>`;
      const hy = y - s2 * 0.3, hr = s2 * 0.22;
      s += `<circle cx="${x.toFixed(1)}" cy="${hy.toFixed(1)}" r="${hr.toFixed(2)}" fill="${silh}"/>`;
      s += `<path d="M${(x - s2 * 0.42).toFixed(1)} ${(y + s2 * 0.66).toFixed(1)}
                 q${(s2 * 0.42).toFixed(1)} ${(-s2 * 0.5).toFixed(1)} ${(s2 * 0.84).toFixed(1)} 0Z"
              fill="${silh}"/>`;
      s += `<path d="M${(x - s2 * 0.6).toFixed(1)} ${(y + s2 * 0.78).toFixed(1)}
                 h${(s2 * 1.2).toFixed(1)}
                 M${(x - s2 * 0.6).toFixed(1)} ${(y + s2 * 0.9).toFixed(1)}h${(s2 * 0.8).toFixed(1)}"
              stroke="${pal.rule}" stroke-width="${(r * 0.06).toFixed(2)}" fill="none"/>`;
      if (player === 2) {
        s += `<circle cx="${(x + s2 * 0.3).toFixed(1)}" cy="${(y + s2 * 0.36).toFixed(1)}"
                r="${(s2 * 0.3).toFixed(2)}" fill="none" stroke="${pal.stamp}"
                stroke-width="${(r * 0.11).toFixed(2)}" opacity=".8"/>`;
      }
      if (isLast) {
        s += `<rect x="${(x - s2 * 0.82 - 3).toFixed(1)}" y="${(y - s2 - 3).toFixed(1)}"
                width="${(s2 * 1.64 + 6).toFixed(1)}" height="${(s2 * 2 + 6).toFixed(1)}"
                fill="none" stroke="${pal.stamp}" stroke-width="2.4"/>`;
      }
      return s;
    };
    push({
      name: `灰证词卷 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.photoB, "--st-white": pal.photoW,
        "--ui-accent": pal.stamp, "--bd-radius": "4px",
      },
      defs: `
        ${grain(P, { slope: ".08", seed: 59, bf: ".9" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".6" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="78%">
          <stop offset=".58" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${pal.vig}" stop-opacity=".3"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect x="16" y="16" width="588" height="588" fill="none"
              stroke="${pal.rule}" stroke-width="2" opacity=".6"/>
        <rect x="26" y="26" width="568" height="568" fill="none"
              stroke="${pal.rule2}" stroke-width="1" opacity=".5"/>
        <g stroke="${pal.rule2}" stroke-width="1" opacity=".55">
          <path d="M470 26v56M470 82h124"/>
          <path d="M26 560h150M26 578h110"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".48"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 1.2, lineOpacity: .62,
      starFill: pal.star, starR: 3, starOpacity: .7,
      stone, css: "",
    });
  };
  const PAPERS_PAL = {
    day:   { bd1: "#e8e2d0", bd2: "#d6cfba", bd3: "#c2b9a0", ln: "#8a8674", star: "#4a4a40",
             frame: "#f4f2e8", photoB: "#6a6458", photoW: "#d4cec0",
             silhB: "#2a2820", silhW: "#74705f", rule: "#a09a86", rule2: "#b4ae9a",
             ink: "#3a382e", stamp: "#b8352a", vig: "#3a382c",
             swatch: "#8a8674", pageBg: "#262420", accent: "#b8352a" },
    rain:  { bd1: "#ccd6dc", bd2: "#b4c2ca", bd3: "#9aaab4", ln: "#6f8494", star: "#3a4a58",
             frame: "#e4ecf0", photoB: "#4a5a66", photoW: "#c0ccd4",
             silhB: "#1c2a34", silhW: "#5f7482", rule: "#8fa2b0", rule2: "#a4b6c2",
             ink: "#28343c", stamp: "#a83828", vig: "#2a3a44",
             swatch: "#6f8494", pageBg: "#1c262c", accent: "#a83828" },
    night: { bd1: "#4a4c60", bd2: "#3a3c4e", bd3: "#2c2e3e", ln: "#7a7c94", star: "#c0c4dc",
             frame: "#5a5c70", photoB: "#2e3044", photoW: "#8a8ea8",
             silhB: "#181a2a", silhW: "#5f6480", rule: "#6a6c84", rule2: "#7a7c94",
             ink: "#181a26", stamp: "#c04030", vig: "#0e1018",
             swatch: "#7a7c94", pageBg: "#181a24", accent: "#c04030" },
    snow:  { bd1: "#eef2f6", bd2: "#dde4ea", bd3: "#c8d2da", ln: "#93a4b0", star: "#4a5a66",
             frame: "#ffffff", photoB: "#5a6670", photoW: "#dce4ea",
             silhB: "#2a323a", silhW: "#6a7680", rule: "#a8b6c0", rule2: "#bcc8d2",
             ink: "#3a444c", stamp: "#b03828", vig: "#3a4650",
             swatch: "#93a4b0", pageBg: "#28323a", accent: "#b03828" },
    ember: { bd1: "#dcc4a8", bd2: "#c6a888", bd3: "#ae8c68", ln: "#8a6c4c", star: "#4a3020",
             frame: "#ecd8c0", photoB: "#6a4a34", photoW: "#d8be9e",
             silhB: "#2a1a10", silhW: "#7a5c40", rule: "#a08360", rule2: "#b4987a",
             ink: "#3a2618", stamp: "#c03820", vig: "#3a2414",
             swatch: "#8a6c4c", pageBg: "#2a1e14", accent: "#c03820" },
    moss:  { bd1: "#d4dcc4", bd2: "#bec8ac", bd3: "#a4b090", ln: "#7a8a68", star: "#3e4a30",
             frame: "#e6ecd8", photoB: "#546048", photoW: "#c8d0b8",
             silhB: "#242c1a", silhW: "#64705a", rule: "#93a080", rule2: "#a6b294",
             ink: "#323a28", stamp: "#a83a28", vig: "#2e381f",
             swatch: "#7a8a68", pageBg: "#20261a", accent: "#a83a28" },
    ink:   { bd1: "#d8d8d8", bd2: "#c4c4c4", bd3: "#aaaaaa", ln: "#7a7a7a", star: "#3a3a3a",
             frame: "#ececec", photoB: "#5a5a5a", photoW: "#c8c8c8",
             silhB: "#1e1e1e", silhW: "#6a6a6a", rule: "#8e8e8e", rule2: "#a2a2a2",
             ink: "#2e2e2e", stamp: "#b03030", vig: "#2a2a2a",
             swatch: "#7a7a7a", pageBg: "#1e1e1e", accent: "#b03030" },
    dusk:  { bd1: "#e0d0dc", bd2: "#cbb8c8", bd3: "#b4a0b0", ln: "#8f7a8a", star: "#4a3446",
             frame: "#f0e4ee", photoB: "#6a5060", photoW: "#d4c2d0",
             silhB: "#2c1c28", silhW: "#76607a", rule: "#a08c9c", rule2: "#b49eae",
             ink: "#3c2c38", stamp: "#b03040", vig: "#3a2834",
             swatch: "#8f7a8a", pageBg: "#241a22", accent: "#b03040" },
    sea:   { bd1: "#c2ded0", bd2: "#a4c4b4", bd3: "#86a896", ln: "#6c9280", star: "#2e4a3c",
             frame: "#d6ece0", photoB: "#3a5a4a", photoW: "#b8ccbe",
             silhB: "#142e22", silhW: "#507868", rule: "#84a494", rule2: "#98b8a8",
             ink: "#243c30", stamp: "#a83830", vig: "#22402f",
             swatch: "#6c9280", pageBg: "#16281f", accent: "#a83830" },
    sand:  { bd1: "#f0ead8", bd2: "#e4dcc4", bd3: "#d0c6ac", ln: "#a89c80", star: "#6a5e48",
             frame: "#fbf7ec", photoB: "#7a6c54", photoW: "#e0d6c0",
             silhB: "#3a3020", silhW: "#8a7c64", rule: "#b8ac94", rule2: "#c8bca6",
             ink: "#4a3e2c", stamp: "#b03428", vig: "#4a4030",
             swatch: "#a89c80", pageBg: "#3a3428", accent: "#b03428" },
  };

  /* ────────────────────────────────────────────────────────────────
     059 · 一比特抖动（《Return of the Obra Dinn》）
     规则：**全画面只有两个颜色**，所有"灰"都是网点密度的错觉。
     ════════════════════════════════════════════════════════════════ */
  const buildObraDinn = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const dark = player === 1;
      let s = "";
      // 黑子用 d9（纯 fg）；白子用 sw（**以 paper 打底**的稀疏网点）
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
              fill="url(#${P(dark ? "d9" : "sw")})"/>`;
      // 内芯：白子中间再密一档网点，做出"有体积"的错觉（仍是那两色）
      if (!dark) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.58).toFixed(1)}"
                fill="url(#${P("swIn")})"/>`;
      }
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
              fill="none" stroke="${pal.fg}" stroke-width="${(r * (dark ? 0.1 : 0.14)).toFixed(2)}"/>`;
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 3.5).toFixed(1)}"
                fill="none" stroke="${pal.fg}" stroke-width="2" stroke-dasharray="3 3"/>`;
      }
      return s;
    };
    /* 棋子专用网点：**底色用 pal.paper**（真正的亮色），不是盘底色。
       ⚠ 这里踩过坑：一开始白子直接复用盘面的 d2 网点，而 d2 的底是 pal.bg
         （盘底色）。浅色主题看不出问题，但**深色主题**里"白子"就变成了
         "深底 + 稀疏亮点"，实测黑子 L=15 / 白子 L=34，两枚子都是暗的 → FAIL。
       1-bit 的规矩是「子只能用那两色」，所以子要自己一组以 paper 打底的网点。 */
    push({
      name: `一比特抖动 · ${mood.label}`,
      swatch: pal.fg, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bg, "--bd-line": pal.fg, "--bd-star": pal.fg,
        "--st-black": pal.fg, "--st-white": pal.paper,
        "--ui-accent": pal.fg, "--bd-radius": "2px",
      },
      defs: `
        ${dither(P, "d1", { fg: pal.fg, bg: pal.bg, density: 0.14, cell: 4 })}
        ${dither(P, "d2", { fg: pal.fg, bg: pal.bg, density: 0.3, cell: 4 })}
        ${dither(P, "d3", { fg: pal.fg, bg: pal.bg, density: 0.5, cell: 4 })}
        ${dither(P, "d4", { fg: pal.fg, bg: pal.bg, density: 0.68, cell: 4 })}
        ${dither(P, "d9", { fg: pal.fg, bg: pal.fg, density: 1.0, cell: 4 })}
        ${/* 白子：以 paper 打底 + 少量 fg 点（依旧是那两色，只是"谁当底"不同） */ ""}
        ${dither(P, "sw", { fg: pal.fg, bg: pal.paper, density: 0.18, cell: 4 })}
        ${dither(P, "swIn", { fg: pal.fg, bg: pal.paper, density: 0.36, cell: 4 })}
      `,
      boardFill: `url(#${P("d1")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("d1")})"/>
        <rect x="0" y="0" width="620" height="150" fill="url(#${P("d3")})" opacity=".8"/>
        <rect x="0" y="470" width="620" height="150" fill="url(#${P("d3")})" opacity=".8"/>
        <rect x="0" y="0" width="150" height="620" fill="url(#${P("d3")})" opacity=".8"/>
        <rect x="470" y="0" width="150" height="620" fill="url(#${P("d3")})" opacity=".8"/>
      `,
      // 1-bit 网格：纯色线（没有任何抗锯齿的余地）
      lineStroke: pal.fg, lineW: 1, lineOpacity: 1,
      starFill: pal.fg, starR: 2.6, starOpacity: 1,
      stone, css: "",
    });
  };
  // 1-bit 只有两色，10 组"情绪"靠**色对**区分（依旧是严格两色）
  // ⚠ paper 必须是真正的**亮色** —— 它是白子的底，不是"中间调"
  const OBRADINN_PAL = {
    day:   { fg: "#1a1206", bg: "#e8dcc0", paper: "#fdf8ec", pageBg: "#181210" },
    rain:  { fg: "#0e1a22", bg: "#ccdae2", paper: "#f2f8fb", pageBg: "#101a20" },
    night: { fg: "#080c1e", bg: "#1a2246", paper: "#c8d4f4", pageBg: "#06081a" },
    snow:  { fg: "#1c2a34", bg: "#f0f6fa", paper: "#ffffff", pageBg: "#161e24" },
    ember: { fg: "#240c04", bg: "#e8c0a0", paper: "#fff0dc", pageBg: "#1a0c08" },
    moss:  { fg: "#141f0c", bg: "#d0dcb8", paper: "#f4fae4", pageBg: "#121a0e" },
    ink:   { fg: "#0d0d0d", bg: "#e8e4d8", paper: "#ffffff", pageBg: "#141414" },
    dusk:  { fg: "#2a0e28", bg: "#e4c8dc", paper: "#fdf0f8", pageBg: "#1c0e1a" },
    sea:   { fg: "#04181f", bg: "#bcdce4", paper: "#ecf8fb", pageBg: "#08161c" },
    sand:  { fg: "#241a08", bg: "#e4d4b0", paper: "#fbf4e0", pageBg: "#1a1408" },
  };

  /* ────────────────────────────────────────────────────────────────
     060 · 手抄谜案（《Pentiment》）
     规则：**抄本的版面** —— 留白、首字母、页边注、朱红与蓝的固定用法。
     ⚠ 明度必须靠**底色**拉开：纹章用色相分阵营（红/蓝），
       但色相不等于明度 —— 两枚徽记明度太近会直接 FAIL。
     ════════════════════════════════════════════════════════════════ */
  const buildPentiment = (pid, push, mood, pal) => {
    const P = (n) => `${pid}-${n}`;
    const stone = ({ x, y, r, player, isLast }) => {
      const bg = player === 1 ? pal.crestA : pal.crestB;
      const fg = player === 1 ? pal.markA : pal.markB;
      const rim = player === 1 ? pal.rimA : pal.rimB;
      let s = "";
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
              fill="${bg}" stroke="${rim}" stroke-width="${(r * 0.14).toFixed(2)}"/>`;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.82).toFixed(1)}"
              fill="none" stroke="${fg}" stroke-width="${(r * 0.06).toFixed(2)}" opacity=".7"/>`;
      // 暗阵营画十字、亮阵营画百合 —— 形状+明度双区分（色相只负责好看）
      if (player === 1) {
        s += `<path d="M${x.toFixed(1)} ${(y - r * 0.5).toFixed(1)}v${(r * 1).toFixed(1)}
                   M${(x - r * 0.4).toFixed(1)} ${(y - r * 0.08).toFixed(1)}h${(r * 0.8).toFixed(1)}"
                stroke="${fg}" stroke-width="${(r * 0.17).toFixed(2)}" stroke-linecap="square" fill="none"/>`;
      } else {
        s += `<path d="M${x.toFixed(1)} ${(y - r * 0.5).toFixed(1)}
                   q${(r * 0.3).toFixed(1)} ${(r * 0.16).toFixed(1)} ${(r * 0.22).toFixed(1)} ${(r * 0.44).toFixed(1)}
                   q${(r * 0.02).toFixed(1)} ${(r * 0.26).toFixed(1)} ${(-r * 0.22).toFixed(1)} ${(r * 0.4).toFixed(1)}
                   q${(-r * 0.24).toFixed(1)} ${(-r * 0.14).toFixed(1)} ${(-r * 0.22).toFixed(1)} ${(-r * 0.4).toFixed(1)}
                   q${(-r * 0.08).toFixed(1)} ${(-r * 0.28).toFixed(1)} ${(r * 0.22).toFixed(1)} ${(-r * 0.44).toFixed(1)}Z"
                fill="${fg}" opacity=".98"/>`;
      }
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}"
                fill="none" stroke="${pal.gold}" stroke-width="2.4"/>`;
      }
      return s;
    };
    push({
      name: `手抄谜案 · ${mood.label}`,
      swatch: pal.swatch, pageBg: pal.pageBg,
      vars: {
        "--bd-bg": pal.bd1, "--bd-line": pal.ln, "--bd-star": pal.star,
        "--st-black": pal.crestA, "--st-white": pal.crestB,
        "--ui-accent": pal.crestB, "--bd-radius": "6px",
      },
      defs: `
        <filter id="${P("wob2")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="67" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${grain(P, { slope: ".11", seed: 71, bf: ".65" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stop-color="${pal.bd1}"/><stop offset=".6" stop-color="${pal.bd2}"/>
          <stop offset="1" stop-color="${pal.bd3}"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="48%" r="76%">
          <stop offset=".55" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${pal.vig}" stop-opacity=".34"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect x="20" y="20" width="580" height="580" fill="none"
              stroke="${pal.rule}" stroke-width="2.4" opacity=".7"/>
        <rect x="30" y="30" width="560" height="560" fill="none"
              stroke="${pal.rule2}" stroke-width="1" opacity=".55"/>
        <g>
          <rect x="30" y="30" width="46" height="46" fill="${pal.initA}" opacity=".78"/>
          <rect x="544" y="30" width="46" height="46" fill="${pal.initB}" opacity=".78"/>
          <rect x="30" y="544" width="46" height="46" fill="${pal.initB}" opacity=".78"/>
          <rect x="544" y="544" width="46" height="46" fill="${pal.initA}" opacity=".78"/>
          <path d="M42 66V44h10M66 42h10v22M554 66V44h10M578 42h10v22
                   M42 554v22h10M66 578h10v-22M554 554v22h10M578 578h10v-22"
                stroke="${pal.gold}" stroke-width="2.4" fill="none"/>
        </g>
        <g stroke="${pal.initB}" stroke-width="1.4" opacity=".5" fill="none">
          <path d="M96 40h34M140 40h22M172 40h46"/>
          <path d="M96 582h28M134 582h40"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: pal.ln, lineW: 1.2, lineOpacity: .6,
      starFill: pal.star, starR: 3.4, starOpacity: .8,
      stone, css: "",
    });
  };
  const PENTIMENT_PAL = {
    // ⚠ 每组 crestA/crestB 的**明度必须拉开**（这是这版最容易翻车的地方）
    day:   { bd1: "#ece0c6", bd2: "#e0d2b4", bd3: "#cdbd9c", ln: "#9a8a68", star: "#7a6a4a",
             crestA: "#5a1c12", crestB: "#7f9cd8", markA: "#c9a24a", markB: "#fbfdff",
             rimA: "#3a1208", rimB: "#2a3a68", gold: "#c9a24a",
             initA: "#3a4a72", initB: "#8a3a2a", rule: "#8a7a5a", rule2: "#a89468", vig: "#4a3a20",
             swatch: "#b8352a", pageBg: "#2a2418", accent: "#b8352a" },
    rain:  { bd1: "#d6dce0", bd2: "#c2ccd2", bd3: "#aab8c0", ln: "#7a8c98", star: "#5a6c78",
             crestA: "#1e3a4a", crestB: "#8fb8cc", markA: "#a8d0e0", markB: "#ffffff",
             rimA: "#0e2430", rimB: "#3a5a6c", gold: "#7fa8bc",
             initA: "#2a4a5c", initB: "#8a4a3a", rule: "#8fa2ae", rule2: "#a4b6c0", vig: "#3a4a54",
             swatch: "#4a7a94", pageBg: "#1e2a30", accent: "#4a7a94" },
    night: { bd1: "#3c3a52", bd2: "#302e44", bd3: "#242236", ln: "#7a7698", star: "#c0bce0",
             crestA: "#5a1c3a", crestB: "#a8b4e8", markA: "#e8b0c8", markB: "#ffffff",
             rimA: "#38101f", rimB: "#5a6494", gold: "#c0a860",
             initA: "#3a3a68", initB: "#7a3a5a", rule: "#6a6688", rule2: "#7a7698", vig: "#141228",
             swatch: "#a8b4e8", pageBg: "#1a1828", accent: "#c07090" },
    snow:  { bd1: "#f0f4f6", bd2: "#e2e8ec", bd3: "#d0dae0", ln: "#93a4b0", star: "#5a6c78",
             crestA: "#4a2418", crestB: "#96b4d0", markA: "#d8c090", markB: "#ffffff",
             rimA: "#2e140c", rimB: "#44607a", gold: "#b8c4a8",
             initA: "#3a5470", initB: "#8a4238", rule: "#a8b6c0", rule2: "#bcc8d2", vig: "#4a5a64",
             swatch: "#6a94b8", pageBg: "#28343c", accent: "#6a94b8" },
    ember: { bd1: "#e0c8a8", bd2: "#d0b490", bd3: "#ba9c78", ln: "#9a7a54", star: "#7a5a38",
             crestA: "#5a1c10", crestB: "#c89a6a", markA: "#f0c060", markB: "#fff4dc",
             rimA: "#380e06", rimB: "#8a6038", gold: "#e8b050",
             initA: "#7a4a2a", initB: "#9a3a20", rule: "#a08760", rule2: "#b89c78", vig: "#4a2c14",
             swatch: "#c05a28", pageBg: "#2c1c10", accent: "#c05a28" },
    moss:  { bd1: "#dfe4ce", bd2: "#cdd4b8", bd3: "#b8c2a0", ln: "#8a9670", star: "#66744e",
             crestA: "#2a3018", crestB: "#a8c088", markA: "#d8e0a0", markB: "#ffffff",
             rimA: "#161c0c", rimB: "#5f7450", gold: "#b0b868",
             initA: "#3e5434", initB: "#8a4838", rule: "#94a07c", rule2: "#a8b490", vig: "#39442a",
             swatch: "#6a8a4a", pageBg: "#1e2416", accent: "#6a8a4a" },
    ink:   { bd1: "#dedede", bd2: "#cccccc", bd3: "#b4b4b4", ln: "#8a8a8a", star: "#666666",
             crestA: "#26262a", crestB: "#b4b4ba", markA: "#d8d8dc", markB: "#ffffff",
             rimA: "#121214", rimB: "#6a6a70", gold: "#a0a0a4",
             initA: "#3a3a40", initB: "#6a6a70", rule: "#969696", rule2: "#a8a8a8", vig: "#3a3a3e",
             swatch: "#6a6a70", pageBg: "#1e1e20", accent: "#8a8a90" },
    dusk:  { bd1: "#ecd8e4", bd2: "#dcc4d4", bd3: "#c6aebe", ln: "#a07f94", star: "#7a5a70",
             crestA: "#4a1230", crestB: "#c0a4d0", markA: "#e8b0c0", markB: "#ffffff",
             rimA: "#2e0a20", rimB: "#6f5480", gold: "#c8a860",
             initA: "#4a3a68", initB: "#8a3a58", rule: "#a890a0", rule2: "#bca4b4", vig: "#4a2a3e",
             swatch: "#a05a84", pageBg: "#26182a", accent: "#a05a84" },
    sea:   { bd1: "#c6e2d4", bd2: "#a8c8b8", bd3: "#8cac9a", ln: "#6e9480", star: "#465e50",
             crestA: "#0a3428", crestB: "#8cc8a8", markA: "#a8e4cc", markB: "#ffffff",
             rimA: "#04201a", rimB: "#3c6a56", gold: "#78b098",
             initA: "#1e5442", initB: "#8a4a3a", rule: "#84a494", rule2: "#98b8a8", vig: "#264438",
             swatch: "#2e8060", pageBg: "#122420", accent: "#2e8060" },
    sand:  { bd1: "#e8dcc0", bd2: "#d6c8a8", bd3: "#bfae8c", ln: "#947f5e", star: "#6e5c40",
             crestA: "#4a2410", crestB: "#b09c6c", markA: "#e0b860", markB: "#fff6e0",
             rimA: "#2c1408", rimB: "#6f5f3c", gold: "#d0a848",
             initA: "#5a4a2e", initB: "#8e3f28", rule: "#a08c68", rule2: "#b4a080", vig: "#443620",
             swatch: "#9a7038", pageBg: "#241c0e", accent: "#9a7038" },
  };

  /* ══════════════════════════════════════════════════════════════════
     注册：10 风格 × 10 情绪 = 100 套
     id 规则：`indie-<style>-<mood>`（如 indie-journey-night）
     name    ：`独立游戏 · <风格> · <情绪>`
     ══════════════════════════════════════════════════════════════════ */
  const STYLES = [
    { key: "journey",    build: buildJourney,    pal: JOURNEY_PAL },
    { key: "ori",        build: buildOri,        pal: ORI_PAL },
    { key: "hades",      build: buildHades,      pal: HADES_PAL },
    { key: "deadcells",  build: buildDeadcells,  pal: DEADCELLS_PAL },
    { key: "hyperlight", build: buildHyperlight, pal: HYPERLIGHT_PAL },
    { key: "monument",   build: buildMonument,   pal: MONUMENT_PAL },
    { key: "spire",      build: buildSpire,      pal: SPIRE_PAL },
    { key: "papers",     build: buildPapers,     pal: PAPERS_PAL },
    { key: "obradinn",   build: buildObraDinn,   pal: OBRADINN_PAL },
    { key: "pentiment",  build: buildPentiment,  pal: PENTIMENT_PAL },
  ];

  for (const st of STYLES) {
    for (const mood of MOODS) {
      const pid = `indie-${st.key}-${mood.key}`;
      const pal = st.pal[mood.key];
      if (!pal) continue;
      const { push } = mk(pid);
      st.build(pid, push, mood, pal);
    }
  }
})();
