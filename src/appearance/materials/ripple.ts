/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   水波 · 10 版。结构见 skins/_TEMPLATE.js。

   ★ 这一套的核心不是「蓝色棋盘」，而是「水波棋盘」：
     整张网格过 feTurbulence + feDisplacementMap（低频、位移 ≤ 6.2），
     让直线自然弯成水下的样子。这是区分「水波」和「蓝色」的唯一标准。

   上一版被认可的做法（保留）：
     · 网格过折射滤镜 → 线弯
     · 两层错开的同心涟漪 → 干涉
     · 棋子过细噪声位移 → 边缘有水的扰动
     · 棋子顶部一道弧光 → 刚浮出水面

   上一版的坑（本版修正）：
     ① 涟漪太实 → 像「靶环」。本版同心圆全部 ≤18% 透明度，
        线宽 1.6~5.4（粗线 + 低对比，经位移打散后是水光不是圈），
        并且每个 pattern 里的圆环都带虚线或渐变，
        避免等间距实线同心环。
     ② feDisplacementMap 极贵。本套 scale 一律 ≤6.2、baseFrequency ≥.011，
        每个皮肤最多一个棋盘级位移滤镜（棋子用独立的轻滤镜）。

   10 版方向（水体 / 色调 / 波纹）：
     1  ripple-calm       浅溪 · 晴光     亮调  平行水波横移
     2  ripple-spring     雨后天光       最亮  雨滴扩散点
     3  ripple-pool       深潭 · 墨绿     暗调  同心涟漪干涉（基准版）
     4  ripple-sea        海面 · 长浪     中调  长浪带缓慢扫过
     5  ripple-rain       雨落水面       暗调  雨痕 + 碎波
     6  ripple-ice        冰面 · 银灰     亮调  冰裂纹 + 折射
     7  ripple-onsen      温泉 · 水汽     中调  水汽缓缓上飘
     8  ripple-tide       潮汐 · 月光银蓝  暗调  潮线上下推移
     9  ripple-shaft      水下 · 光柱     深海紫 光柱摇曳
    10  ripple-mud        琥珀 · 浑水     琥珀   浑水浊流缓动

   全部带 .rp-* class 的动画，选择器命中真实 DOM：
     #board > rect            棋盘底（boardOverlay 里的 rect 带 class）
     #board #stones circle    棋子
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  /* ── 棋子构造（10 版共用骨架，材质由 cfg 描述） ────────────────────────
     传入的 x / y / r 全部用上，不写死坐标。
       · 落影：让棋子「沉」在水里而不是浮在纸上
       · 体：径向渐变（高光偏上）
       · 水下折射：一层轻噪声位移，边缘微微抖
       · 水位光：顶上一道弧，像刚浮出水面
       · isLast：两圈扩散涟漪（CSS 驱动，幅度 0.9→1.5，肉眼可辨）
       · isWin：金边由引擎画，这里只加强一圈水光 */
  const stoneSVG = ({ x, y, r, player, isLast, cfg }) => {
    const c = cfg;
    const p = c.p;
    const fill = player === 1 ? `url(#${p}Black)` : `url(#${p}White)`;
    let s = "";

    // 水下落影：偏下、略扁，颜色是水的暗部而不是纯黑
    s += `<ellipse cx="${x}" cy="${y + r * 0.26}" rx="${r * 1.02}" ry="${r * 0.84}" fill="${c.shadow}" opacity="${c.shadowOpacity}"/>`;

    // 棋子体（过水折射滤镜）
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" filter="url(#${p}Wet)"/>`;

    if (player === 1) {
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.blackEdge}" stroke-width="${c.edgeW}" opacity="${c.edgeOpacity}" filter="url(#${p}Wet)"/>`;
      // 釉面高光：水中的一枚亮斑
      s += `<ellipse cx="${x - r * 0.32}" cy="${y - r * 0.36}" rx="${r * 0.30}" ry="${r * 0.18}" fill="${c.blackGlaze}" opacity="${c.blackGlazeOpacity}" transform="rotate(-34 ${x - r * 0.32} ${y - r * 0.36})"/>`;
      // 底部水的反弹光
      s += `<ellipse cx="${x + r * 0.10}" cy="${y + r * 0.54}" rx="${r * 0.44}" ry="${r * 0.15}" fill="${c.bounce}" opacity="${c.bounceOpacity}"/>`;
    } else {
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.whiteEdge}" stroke-width="${c.edgeW}" opacity="${c.edgeOpacity}" filter="url(#${p}Wet)"/>`;
      s += `<ellipse cx="${x - r * 0.31}" cy="${y - r * 0.35}" rx="${r * 0.27}" ry="${r * 0.16}" fill="#ffffff" opacity="${c.whiteGlazeOpacity}" transform="rotate(-34 ${x - r * 0.31} ${y - r * 0.35})"/>`;
      s += `<ellipse cx="${x + r * 0.14}" cy="${y + r * 0.48}" rx="${r * 0.40}" ry="${r * 0.18}" fill="${c.bounce}" opacity="${c.bounceOpacity}"/>`;
    }

    // ★ 水位光：顶部一道弧（「刚浮出水面」的签名笔触）
    if (c.arc !== false) {
      const a = r * 0.78;
      const dy = -r * 0.34;
      s += `<path d="M${x - a} ${y + dy}Q${x} ${y + dy - r * 1.02} ${x + a} ${y + dy}" fill="none" stroke="${c.arcColor}" stroke-width="${r * 0.115}" opacity="${c.arcOpacity}" stroke-linecap="round"/>`;
    }

    // 当前手：扩散涟漪（两圈错相位，扩散感更强）
    if (isLast) {
      s += `<circle class="${p}Last" cx="${x}" cy="${y}" r="${r + 1.5}" fill="none" stroke="${c.lastRing}" stroke-width="1.9"/>`
        + `<circle class="${p}Last2" cx="${x}" cy="${y}" r="${r + 3.5}" fill="none" stroke="${c.lastRing}" stroke-width="1.2" opacity=".6"/>`
        + `<circle class="${p}LastCore" cx="${x}" cy="${y}" r="${r * 0.42}" fill="${c.lastCore}" opacity=".5"/>`;
    }
    return s;
  };

  /* ── 公共动画：涟漪扩散 + 水面平移 + 高光扫过 ───────────────────────── */
  const CSS_KF = `
@keyframes %P%RippleOut{
  0%  {transform:scale(.90);opacity:.92}
  55% {transform:scale(1.30);opacity:.34}
  100%{transform:scale(1.52);opacity:0}
}
@keyframes %P%RippleOut2{
  0%  {transform:scale(.86);opacity:.70}
  60% {transform:scale(1.44);opacity:.20}
  100%{transform:scale(1.66);opacity:0}
}
@keyframes %P%Glint{
  0%  {transform:translate(-150px,-150px);opacity:0}
  18% {opacity:.9}
  82% {opacity:.9}
  100%{transform:translate(160px,160px);opacity:0}
}`;

  /** 当前手涟漪那三圈 + 核心光斑的规则（每版只差前缀），供 stoneMotions 复用。
   *  ⚠ 这三条都是 infinite（常驻），playable.html 的 suppressEntrance() 靠这个
   *    区分"重建棋子时该掐哪类动画"，别改成一次性。 */
  const LAST_RULES = (ID, core = ".26/.7") => {
    const [a, b] = core.split("/");
    return `
#board .${ID}-Last{transform-box:fill-box;transform-origin:center;animation:${ID}-RippleOut 2.6s ease-out infinite}
#board .${ID}-Last2{transform-box:fill-box;transform-origin:center;animation:${ID}-RippleOut2 2.6s ease-out infinite .65s}
#board .${ID}-LastCore{animation:${ID}-core 1.8s ease-in-out infinite}
@keyframes ${ID}-core{0%,100%{opacity:${a}}50%{opacity:${b}}}
@media (prefers-reduced-motion:reduce){#board .${ID}-Last,#board .${ID}-Last2,#board .${ID}-LastCore{animation:none}}
`;
  };
  /** 涟漪扩散的两张 @keyframes（跟着上面的规则一起走） */
  const RIPPLE_KF = (ID) => `
@keyframes ${ID}-RippleOut{
  0%  {transform:scale(.90);opacity:.92}
  55% {transform:scale(1.30);opacity:.34}
  100%{transform:scale(1.52);opacity:0}
}
@keyframes ${ID}-RippleOut2{
  0%  {transform:scale(.86);opacity:.70}
  60% {transform:scale(1.44);opacity:.20}
  100%{transform:scale(1.66);opacity:0}
}`;

  /* 无障碍：系统要求「减少动态效果」时掐掉这条选择器上的动画 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* ── 造皮肤骨架 ───────────────────────────────────────────────────────
     defs 里每个 id 都带 P() 前缀；css 里的 %P% 也会被替换。 */
  const make = (o) => {
    const ID = o.id;
    const P = (n) => `${ID}-${n}`;
    const cfg = Object.assign({
      p: P(""),
      shadow: "#02141c",
      shadowOpacity: 0.34,
      edgeW: 0.9,
      edgeOpacity: 0.7,
      blackEdge: "rgba(160,215,235,.32)",
      blackGlaze: "#e6fbff",
      blackGlazeOpacity: 0.7,
      whiteEdge: "rgba(110,170,200,.46)",
      whiteGlazeOpacity: 0.95,
      bounce: "#6fc4dd",
      bounceOpacity: 0.24,
      arcColor: "#ffffff",
      arcOpacity: 0.5,
      arc: true,
      lastRing: "#cdf3ff",
      lastCore: "#eafcff",
    }, o.stone || {});

    /* 会动的东西按「谁在动」分两堆（契约见 skins/_TEMPLATE.js）：
         stoneMotions ← 当前手的涟漪扩散（跟着棋子走）
         boardMotions ← 这块盘自己的水汽/暖光（跟着棋盘走）
       只有显式声明了 boardMotion / stoneMotion 的版走新机制；
       没声明的版保持原样（css 末尾继续拼公共 CSS_KF），改一半留一半最容易出怪事。 */
    const migrated = Boolean(o.boardMotion || o.stoneMotion);
    const css = (migrated ? (o.css || "") : ((o.css || "") + CSS_KF)).replace(/%P%/g, P(""));

    const skin = {
      id: ID,
      name: o.name,
      swatch: o.swatch,
      pageBg: o.pageBg,
      vars: o.vars,

      defs: o.defs || "",

      boardFill: o.boardFill,
      lineStroke: o.lineStroke,
      lineW: o.lineW,
      lineOpacity: o.lineOpacity,
      lineFilter: o.lineFilter,
      starFill: o.starFill,
      starR: o.starR,
      starOpacity: o.starOpacity,

      boardOverlay: o.boardOverlay,
      frame: o.frame,
      gridExtra: o.gridExtra,

      stone: (a) => stoneSVG(Object.assign({}, a, { cfg })),

      css,
      boardMotions: o.boardMotion ? [{ id: `bmo-${ID}`, ...o.boardMotion }] : [],
      stoneMotions: o.stoneMotion ? [{ id: `smo-${ID}-ripple`, ...o.stoneMotion }] : [],
    };

    SKINS.push(skin);
    return skin;
  };

  /* 棋盘底：所有版本都是 620×620 的 rect，圆角跟引擎一致（14） */
  const BG = (id, extra) => `<rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${id})"${extra || ""}/>`;

  /* ══════════════════════════════════════════════════════════════════════
     1 · ripple-calm 浅溪 · 晴光   【亮调】
     浅溪：亮青绿底 + 看得到溪石的水，网格被平行水波轻轻扭动。
     动效：平行水波带整体横向平移（6s 循环，位移 46px，肉眼可辨）。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-calm",
    name: "水波 · 浅溪晴光",
    swatch: "#3fa9bd",
    pageBg: "#dfeeed",

    vars: {
      "--bd-bg": "#cfe9e6", "--bd-line": "#2c6f7c", "--bd-star": "#1e5a66",
      "--st-black": "#2b4a52", "--st-white": "#fbfefd", "--ui-accent": "#2f8fa3",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"ripple-calm-base"}" x1="0" y1="0" x2=".6" y2="1">
        <stop offset="0" stop-color="#e7f6f2"/><stop offset=".42" stop-color="#cfeae6"/>
        <stop offset=".78" stop-color="#b7dcdc"/><stop offset="1" stop-color="#a3cfd4"/>
      </linearGradient>
      <!-- 溪底亮斑：太阳透过水面打在沙上的光池 -->
      <radialGradient id="${"ripple-calm-pool"}" cx="30%" cy="24%" r="60%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".68"/>
        <stop offset=".55" stop-color="#eafaf6" stop-opacity=".22"/>
        <stop offset="1" stop-color="#b7dcdc" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-calm-pool2"}" cx="76%" cy="80%" r="52%">
        <stop offset="0" stop-color="#8fd0c4" stop-opacity=".30"/>
        <stop offset="1" stop-color="#a8d4d6" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 折射：整张网格过这个滤镜，线弯成水下的样子（scale 5.4，安全的量级） -->
      <filter id="${"ripple-calm-refract"}" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency=".016 .042" numOctaves="3" seed="17" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 平行水波：横向长条纹（不是同心环，避开「靶环」感），带虚线缺口打散 -->
      <pattern id="${"ripple-calm-wave"}" width="120" height="34" patternUnits="userSpaceOnUse">
        <path d="M0 9Q30 1 60 9T120 9" fill="none" stroke="#ffffff" stroke-width="5.2" opacity=".17" stroke-dasharray="42 22"/>
        <path d="M0 22Q30 14 60 22T120 22" fill="none" stroke="#7fc4bd" stroke-width="4.4" opacity=".15" stroke-dasharray="30 28"/>
        <path d="M0 30Q30 24 60 30T120 30" fill="none" stroke="#ffffff" stroke-width="3" opacity=".13" stroke-dasharray="24 32"/>
      </pattern>
      <!-- 水面高光带：斜向柔亮 -->
      <linearGradient id="${"ripple-calm-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".40" stop-color="#ffffff" stop-opacity=".34"/>
        <stop offset=".52" stop-color="#eafcff" stop-opacity=".44"/>
        <stop offset=".66" stop-color="#ffffff" stop-opacity=".10"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-calm-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="5" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-calm-Black"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#6d99a2"/><stop offset=".30" stop-color="#3b6069"/>
        <stop offset=".68" stop-color="#274850"/><stop offset="1" stop-color="#17333b"/>
      </radialGradient>
      <radialGradient id="${"ripple-calm-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f4fdfb"/>
        <stop offset=".70" stop-color="#d6efea"/><stop offset="1" stop-color="#a9d2ce"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-calm-base"})`,
    boardOverlay: `
      ${BG("ripple-calm-pool")}
      ${BG("ripple-calm-pool2")}
      <g class="rp-calm-waves">
        <rect x="-140" y="-40" width="900" height="720" fill="url(#${"ripple-calm-wave"})"/>
      </g>
      <rect class="rp-calm-glint" x="-160" y="-160" width="300" height="300" rx="60" fill="url(#${"ripple-calm-glint"})" transform="rotate(28 310 310)"/>
    `,
    gridExtra: `<path d="M46 46H574M46 111.7H574M46 177.4H574M46 243.1H574M46 308.8H574M46 374.5H574M46 440.2H574M46 505.9H574M46 571.6H574" fill="none" stroke="#7fc4bd" stroke-width="2.6" opacity=".16" filter="url(#${"ripple-calm-refract"})"/>`,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#3f9fae" stroke-width="1.2" opacity=".44"/>`,
    lineStroke: "#2c6f7c",
    lineW: 1.2,
    lineOpacity: 0.6,
    lineFilter: "ripple-calm-refract",
    starFill: "#1e5a66",
    starR: 3.4,

    stone: { shadow: "#3d7a86", shadowOpacity: 0.2, blackGlaze: "#ffffff", bounce: "#7fd6e4", arcColor: "#ffffff", arcOpacity: 0.62, lastRing: "#1f7c8c", lastCore: "#d8f6ff" },

    css: `
/* ★ 平行水波横移：整条波带缓慢向左流（幅度 46px，明显但不像抖动） */
#board .rp-calm-waves{animation:ripple-calm-flow 6s linear infinite}
@keyframes ripple-calm-flow{
  0%  {transform:translateX(0)}
  100%{transform:translateX(-120px)}
}
/* ★ 水面高光带扫过：从左上扫到右下，7s 一轮 */
#board .rp-calm-glint{animation:ripple-calm-glint 7s ease-in-out infinite}
@keyframes ripple-calm-glint{
  0%  {transform:translate(-120px,-120px) rotate(28deg);opacity:.25}
  45% {opacity:.95}
  100%{transform:translate(440px,440px) rotate(28deg);opacity:.25}
}
#board .ripple-calm-Last{transform-box:fill-box;transform-origin:center;animation:ripple-calm-RippleOut 2.3s ease-out infinite}
#board .ripple-calm-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-calm-RippleOut2 2.3s ease-out infinite .5s}
#board .ripple-calm-LastCore{animation:ripple-calm-core 1.5s ease-in-out infinite}
@keyframes ripple-calm-core{0%,100%{opacity:.28}50%{opacity:.7}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     2 · ripple-spring 雨后天光   【最亮】
     雨刚停，天光从云缝里斜照下来的积水。近白的水面 + 靛青的网格线。
     动效：雨滴落点同心扩散（错相位三圈）+ 水面微亮呼吸。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-spring",
    name: "水波 · 雨后天光",
    swatch: "#7fb3d8",
    pageBg: "#edf5f9",

    vars: {
      "--bd-bg": "#e2eff5", "--bd-line": "#3a6d90", "--bd-star": "#2a5674",
      "--st-black": "#2f4b5e", "--st-white": "#ffffff", "--ui-accent": "#4b8fbf",
      "--bd-radius": "18px",
    },

    defs: `
      <linearGradient id="${"ripple-spring-base"}" x1=".1" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#f6fbfe"/><stop offset=".40" stop-color="#e4f1f7"/>
        <stop offset=".74" stop-color="#d2e6f0"/><stop offset="1" stop-color="#bcd8e8"/>
      </linearGradient>
      <radialGradient id="${"ripple-spring-light"}" cx="34%" cy="20%" r="66%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".92"/>
        <stop offset=".48" stop-color="#f2fafe" stop-opacity=".30"/>
        <stop offset="1" stop-color="#cfe4ef" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-spring-cool"}" cx="80%" cy="86%" r="54%">
        <stop offset="0" stop-color="#8fb6d4" stop-opacity=".26"/>
        <stop offset="1" stop-color="#bcd8e8" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 天光被水波切碎的折射（比 calms 更细密一点） -->
      <filter id="${"ripple-spring-refract"}" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency=".019 .038" numOctaves="3" seed="23" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.0" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 雨滴落点：同心涟漪一律「淡、粗」——粗线 + 低透明度，被位移打散成碎光而不是靶环 -->
      <pattern id="${"ripple-spring-drops"}" width="88" height="88" patternUnits="userSpaceOnUse">
        <circle cx="44" cy="44" r="30" fill="none" stroke="#7fb3d8" stroke-width="4.6" opacity=".13"/>
        <circle cx="44" cy="44" r="17" fill="none" stroke="#a9cfe6" stroke-width="3.4" opacity=".11"/>
        <circle cx="44" cy="44" r="6"  fill="#ffffff" opacity=".30"/>
      </pattern>
      <pattern id="${"ripple-spring-drops2"}" width="118" height="118" patternUnits="userSpaceOnUse">
        <circle cx="59" cy="59" r="42" fill="none" stroke="#5f9dc4" stroke-width="5.4" opacity=".10"/>
        <circle cx="20" cy="94" r="14" fill="none" stroke="#a9cfe6" stroke-width="3" opacity=".10"/>
      </pattern>
      <!-- 水面天光带 -->
      <linearGradient id="${"ripple-spring-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".46" stop-color="#ffffff" stop-opacity=".55"/>
        <stop offset=".56" stop-color="#f4fcff" stop-opacity=".62"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-spring-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="12" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-spring-Black"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#7898ab"/><stop offset=".30" stop-color="#476b80"/>
        <stop offset=".68" stop-color="#2f4f63"/><stop offset="1" stop-color="#223c4c"/>
      </radialGradient>
      <radialGradient id="${"ripple-spring-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".38" stop-color="#fbfdff"/>
        <stop offset=".72" stop-color="#e2eef7"/><stop offset="1" stop-color="#b9d2e2"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-spring-base"})`,
    boardOverlay: `
      ${BG("ripple-spring-light")}
      ${BG("ripple-spring-cool")}
      <g class="rp-spring-drops">
        <rect x="-120" y="-120" width="880" height="880" fill="url(#${"ripple-spring-drops"})"/>
      </g>
      <g class="rp-spring-drops2">
        <rect x="-120" y="-120" width="880" height="880" fill="url(#${"ripple-spring-drops2"})"/>
      </g>
      <rect class="rp-spring-glint" x="-140" y="-140" width="280" height="280" rx="50" fill="url(#${"ripple-spring-glint"})" transform="rotate(26 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="17" fill="none" stroke="#6aa6cc" stroke-width="1.3" opacity=".5"/>`,
    lineStroke: "#3a6d90",
    lineW: 1.15,
    lineOpacity: 0.64,
    lineFilter: "ripple-spring-refract",
    starFill: "#2a5674",
    starR: 3.4,

    stone: { shadow: "#4d7d96", shadowOpacity: 0.2, blackGlaze: "#ffffff", bounce: "#9fd8ef", arcColor: "#ffffff", arcOpacity: 0.66, lastRing: "#2f6f9c", lastCore: "#eaf7ff" },

    css: `
/* ★ 雨滴同心波：两层错位、反向极其缓慢地扩散/收拢，制造落雨感 */
#board .rp-spring-drops{animation:ripple-spring-rain 9s ease-in-out infinite}
@keyframes ripple-spring-rain{
  0%  {transform:translate(0,0) scale(1);opacity:.85}
  50% {transform:translate(-10px,-14px) scale(1.06);opacity:1}
  100%{transform:translate(0,0) scale(1);opacity:.85}
}
#board .rp-spring-drops2{animation:ripple-spring-rain2 13s ease-in-out infinite}
@keyframes ripple-spring-rain2{
  0%  {transform:translate(0,0) scale(1.04);opacity:.7}
  50% {transform:translate(14px,10px) scale(1);opacity:1}
  100%{transform:translate(0,0) scale(1.04);opacity:.7}
}
/* ★ 天光带缓慢扫过（幅度大，一眼看得出来） */
#board .rp-spring-glint{animation:ripple-spring-glint 8s ease-in-out infinite}
@keyframes ripple-spring-glint{
  0%  {transform:translate(-110px,-110px) rotate(26deg);opacity:.34}
  50% {opacity:.9}
  100%{transform:translate(430px,430px) rotate(26deg);opacity:.34}
}
#board .ripple-spring-Last{transform-box:fill-box;transform-origin:center;animation:ripple-spring-RippleOut 2.1s ease-out infinite}
#board .ripple-spring-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-spring-RippleOut2 2.1s ease-out infinite .45s}
#board .ripple-spring-LastCore{animation:ripple-spring-core 1.4s ease-in-out infinite}
@keyframes ripple-spring-core{0%,100%{opacity:.3}50%{opacity:.75}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     3 · ripple-pool 深潭 · 墨绿   【基准版 · 暗调】
     这一版是整套的「正楷」：墨绿深潭、两层错开的同心涟漪形成干涉、
     网格在深水里明显弯折。照着上一版被认可的思路做，但把涟漪压淡。
     动效：两层涟漪反向缓慢漂移 + 高光带扫过。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-pool",
    name: "水波 · 深潭墨绿",
    swatch: "#1f7a6a",
    pageBg: "#07100f",

    vars: {
      "--bd-bg": "#0b2422", "--bd-line": "#7fd0c0", "--bd-star": "#cdf3e8",
      "--st-black": "#123330", "--st-white": "#e8fbf6", "--ui-accent": "#1f7a6a",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"ripple-pool-base"}" x1=".1" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#12403a"/><stop offset=".42" stop-color="#0e312e"/>
        <stop offset=".74" stop-color="#0a2523"/><stop offset="1" stop-color="#061716"/>
      </linearGradient>
      <!-- 潭心的两点柔光：暗底绝不填成一块纯色 -->
      <radialGradient id="${"ripple-pool-glowA"}" cx="38%" cy="32%" r="58%">
        <stop offset="0" stop-color="#4fb8a4" stop-opacity=".38"/>
        <stop offset=".55" stop-color="#1f7a6a" stop-opacity=".14"/>
        <stop offset="1" stop-color="#08201e" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-pool-glowB"}" cx="80%" cy="82%" r="60%">
        <stop offset="0" stop-color="#2a8f86" stop-opacity=".26"/>
        <stop offset="1" stop-color="#051413" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-pool-deep"}" cx="52%" cy="56%" r="72%">
        <stop offset="0" stop-color="#12564d" stop-opacity=".42"/>
        <stop offset="1" stop-color="#04100f" stop-opacity=".66"/>
      </radialGradient>
      <!-- ★ 核心折射：低频 + scale 5.5（上一版被认可的量级） -->
      <filter id="${"ripple-pool-refract"}" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency=".012 .03" numOctaves="3" seed="9" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.5" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- ★ 涟漪：淡 + 粗 + 低对比。stroke-width 大（3.6~5），opacity 只 .07~.12，
           经折射滤镜打散后是水光碎点，不是一圈实线靶环 -->
      <pattern id="${"ripple-pool-ringA"}" width="64" height="64" patternUnits="userSpaceOnUse">
        <circle cx="32" cy="32" r="24" fill="none" stroke="#7fd4e8" stroke-width="4.2" opacity=".12" stroke-dasharray="22 18"/>
        <circle cx="32" cy="32" r="13" fill="none" stroke="#9ae2f0" stroke-width="3.2" opacity=".1" stroke-dasharray="13 11"/>
      </pattern>
      <pattern id="${"ripple-pool-ringB"}" width="92" height="92" patternUnits="userSpaceOnUse">
        <circle cx="46" cy="46" r="37" fill="none" stroke="#5fc3dd" stroke-width="5" opacity=".1" stroke-dasharray="34 26"/>
        <circle cx="46" cy="46" r="21" fill="none" stroke="#8adcee" stroke-width="3.4" opacity=".082" stroke-dasharray="20 16"/>
      </pattern>
      <linearGradient id="${"ripple-pool-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#cdf3ff" stop-opacity="0"/>
        <stop offset=".42" stop-color="#cdf3ff" stop-opacity=".14"/>
        <stop offset=".54" stop-color="#eafcff" stop-opacity=".18"/>
        <stop offset="1" stop-color="#cdf3ff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-pool-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-pool-Black"}" cx="32%" cy="26%" r="74%">
        <stop offset="0" stop-color="#3f7f72"/><stop offset=".28" stop-color="#1b4f47"/>
        <stop offset=".68" stop-color="#0c302c"/><stop offset="1" stop-color="#041715"/>
      </radialGradient>
      <radialGradient id="${"ripple-pool-White"}" cx="32%" cy="26%" r="74%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#e8fbf6"/>
        <stop offset=".68" stop-color="#b3e2d8"/><stop offset="1" stop-color="#74b6ad"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-pool-base"})`,
    boardOverlay: `
      ${BG("ripple-pool-glowA")}
      ${BG("ripple-pool-glowB")}
      ${BG("ripple-pool-deep")}
      <g class="rp-pool-ringA">
        <rect x="-140" y="-140" width="900" height="900" fill="url(#${"ripple-pool-ringA"})"/>
      </g>
      <g class="rp-pool-ringB">
        <rect x="-140" y="-140" width="900" height="900" fill="url(#${"ripple-pool-ringB"})"/>
      </g>
      <rect class="rp-pool-glint" x="-150" y="-150" width="300" height="300" rx="60" fill="url(#${"ripple-pool-glint"})" transform="rotate(30 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#7fd0c0" stroke-width="1.2" opacity=".34"/>`,
    lineStroke: "#8fd8ea",
    lineW: 1.05,
    lineOpacity: 0.48,
    lineFilter: "ripple-pool-refract",
    starFill: "#d8f6ff",
    starR: 3.2,
    starOpacity: 0.88,

    stone: { shadow: "#02181a", shadowOpacity: 0.4, blackGlaze: "#dcfaff", blackGlazeOpacity: 0.74, blackEdge: "rgba(140,225,205,.34)", whiteEdge: "rgba(90,180,175,.46)", bounce: "#5fc9bd", arcColor: "#ffffff", arcOpacity: 0.5, lastRing: "#cdf3ff", lastCore: "#eafcff" },

    css: `
/* ★ 两层涟漪反向漂移：干涉感来自「错位 + 反向」，不是靠画得更密 */
#board .rp-pool-ringA{animation:ripple-pool-driftA 17s linear infinite}
@keyframes ripple-pool-driftA{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-64px,-64px)}
}
#board .rp-pool-ringB{animation:ripple-pool-driftB 23s linear infinite}
@keyframes ripple-pool-driftB{
  0%  {transform:translate(0,0)}
  100%{transform:translate(92px,46px)}
}
/* ★ 水面高光带扫过 */
#board .rp-pool-glint{animation:ripple-pool-glint 9s ease-in-out infinite}
@keyframes ripple-pool-glint{
  0%  {transform:translate(-130px,-130px) rotate(30deg);opacity:.3}
  50% {opacity:.85}
  100%{transform:translate(450px,450px) rotate(30deg);opacity:.3}
}
#board .ripple-pool-Last{transform-box:fill-box;transform-origin:center;animation:ripple-pool-RippleOut 2.4s ease-out infinite}
#board .ripple-pool-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-pool-RippleOut2 2.4s ease-out infinite .55s}
#board .ripple-pool-LastCore{animation:ripple-pool-core 1.6s ease-in-out infinite}
@keyframes ripple-pool-core{0%,100%{opacity:.25}50%{opacity:.68}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     4 · ripple-sea 海面 · 长浪   【中调】
     开阔海面：远处亮、近处沉，长浪带缓慢地从左上流向右下。
     动效：长浪带斜向流动（8s，位移 (-90,+70)，非常明显）。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-sea",
    name: "水波 · 海面长浪",
    swatch: "#1d7fa8",
    pageBg: "#0a1a24",

    vars: {
      "--bd-bg": "#12415c", "--bd-line": "#9fd6ea", "--bd-star": "#e0f6ff",
      "--st-black": "#123a4e", "--st-white": "#eefbff", "--ui-accent": "#1d7fa8",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"ripple-sea-base"}" x1=".2" y1="0" x2=".8" y2="1">
        <stop offset="0" stop-color="#1a5c7a"/><stop offset=".38" stop-color="#134a66"/>
        <stop offset=".74" stop-color="#0e3a52"/><stop offset="1" stop-color="#092838"/>
      </linearGradient>
      <radialGradient id="${"ripple-sea-horizon"}" cx="50%" cy="6%" r="72%">
        <stop offset="0" stop-color="#bfe8f8" stop-opacity=".40"/>
        <stop offset=".4" stop-color="#5fa8c8" stop-opacity=".16"/>
        <stop offset="1" stop-color="#0e3a52" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-sea-near"}" cx="50%" cy="96%" r="58%">
        <stop offset="0" stop-color="#061d2a" stop-opacity=".62"/>
        <stop offset="1" stop-color="#0a2e42" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 海面折射：横向频率更快（长浪是横向拉长的） -->
      <filter id="${"ripple-sea-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".011 .034" numOctaves="3" seed="41" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="6.2" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 长浪带：斜向、长波长、粗带（不是圈） -->
      <pattern id="${"ripple-sea-swell"}" width="200" height="76" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
        <path d="M0 14Q50 0 100 14T200 14" fill="none" stroke="#cdf0fb" stroke-width="7" opacity=".13"/>
        <path d="M0 40Q50 26 100 40T200 40" fill="none" stroke="#8fd0e6" stroke-width="5.6" opacity=".11"/>
        <path d="M0 62Q50 50 100 62T200 62" fill="none" stroke="#cdf0fb" stroke-width="4" opacity=".09"/>
      </pattern>
      <pattern id="${"ripple-sea-foam"}" width="150" height="52" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
        <path d="M0 26Q37 14 75 26T150 26" fill="none" stroke="#ffffff" stroke-width="3.4" opacity=".10" stroke-dasharray="18 26"/>
      </pattern>
      <linearGradient id="${"ripple-sea-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".44" stop-color="#d8f4ff" stop-opacity=".26"/>
        <stop offset=".56" stop-color="#eafcff" stop-opacity=".3"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-sea-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="8" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-sea-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#4a94b4"/><stop offset=".28" stop-color="#1d5c7c"/>
        <stop offset=".68" stop-color="#0e3a52"/><stop offset="1" stop-color="#07202e"/>
      </radialGradient>
      <radialGradient id="${"ripple-sea-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#eefbff"/>
        <stop offset=".70" stop-color="#bce4f2"/><stop offset="1" stop-color="#80bed6"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-sea-base"})`,
    boardOverlay: `
      ${BG("ripple-sea-horizon")}
      <g class="rp-sea-swell">
        <rect x="-220" y="-160" width="1100" height="1000" fill="url(#${"ripple-sea-swell"})"/>
      </g>
      <g class="rp-sea-foam">
        <rect x="-220" y="-160" width="1100" height="1000" fill="url(#${"ripple-sea-foam"})"/>
      </g>
      ${BG("ripple-sea-near")}
      <rect class="rp-sea-glint" x="-160" y="-160" width="320" height="320" rx="70" fill="url(#${"ripple-sea-glint"})" transform="rotate(32 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#9fd6ea" stroke-width="1.2" opacity=".3"/>`,
    lineStroke: "#a8dcee",
    lineW: 1.05,
    lineOpacity: 0.5,
    lineFilter: "ripple-sea-refract",
    starFill: "#e0f6ff",
    starR: 3.3,
    starOpacity: 0.9,

    stone: { shadow: "#041c28", shadowOpacity: 0.42, blackGlaze: "#e6fbff", blackGlazeOpacity: 0.72, bounce: "#4fa8ca", arcColor: "#ffffff", arcOpacity: 0.54, lastRing: "#d6f6ff", lastCore: "#eafcff" },

    css: `
/* ★ 长浪斜向流动：8s 位移 (-90,+70)，是整个棋盘级的明显移动 */
#board .rp-sea-swell{animation:ripple-sea-flow 8s linear infinite}
@keyframes ripple-sea-flow{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-90px,72px)}
}
/* 泡沫层反方向流，两层交错才有海面感 */
#board .rp-sea-foam{animation:ripple-sea-foam 11s linear infinite}
@keyframes ripple-sea-foam{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-150px,58px)}
}
/* ★ 海面高光带扫过 */
#board .rp-sea-glint{animation:ripple-sea-glint 10s ease-in-out infinite}
@keyframes ripple-sea-glint{
  0%  {transform:translate(-140px,-140px) rotate(32deg);opacity:.28}
  50% {opacity:.8}
  100%{transform:translate(470px,470px) rotate(32deg);opacity:.28}
}
#board .ripple-sea-Last{transform-box:fill-box;transform-origin:center;animation:ripple-sea-RippleOut 2.5s ease-out infinite}
#board .ripple-sea-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-sea-RippleOut2 2.5s ease-out infinite .6s}
#board .ripple-sea-LastCore{animation:ripple-sea-core 1.6s ease-in-out infinite}
@keyframes ripple-sea-core{0%,100%{opacity:.26}50%{opacity:.7}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     5 · ripple-rain 雨落水面   【暗调】
     夜里下雨的水面：密集的小落点 + 碎波。波纹碎而密，不是大同心环。
     动效：雨点层斜向下落（3.5s，位移 (-22,+46)，看得见在「下雨」）。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-rain",
    name: "水波 · 雨落水面",
    swatch: "#4a7fa8",
    pageBg: "#080f16",

    vars: {
      "--bd-bg": "#0f2534", "--bd-line": "#8ec2dd", "--bd-star": "#dcf2ff",
      "--st-black": "#10303f", "--st-white": "#e9f7ff", "--ui-accent": "#3d7ba0",
      "--bd-radius": "13px",
    },

    defs: `
      <linearGradient id="${"ripple-rain-base"}" x1=".1" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#173c52"/><stop offset=".42" stop-color="#112d3f"/>
        <stop offset=".76" stop-color="#0c2130"/><stop offset="1" stop-color="#071620"/>
      </linearGradient>
      <radialGradient id="${"ripple-rain-glow"}" cx="66%" cy="18%" r="62%">
        <stop offset="0" stop-color="#7fc4e0" stop-opacity=".30"/>
        <stop offset=".55" stop-color="#2f6d90" stop-opacity=".12"/>
        <stop offset="1" stop-color="#0a1c28" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-rain-deep"}" cx="40%" cy="72%" r="66%">
        <stop offset="0" stop-color="#061620" stop-opacity=".55"/>
        <stop offset="1" stop-color="#0c2230" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 雨点把水面打得全是碎波，折射频率比深潭更高、位移略小 -->
      <filter id="${"ripple-rain-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".022 .046" numOctaves="3" seed="63" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.2" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 密集小落点：很小的同心环（r 只有 5~11），且带虚线缺口，
           经折射后是碎光点阵，而不是满地小图章 -->
      <pattern id="${"ripple-rain-hit"}" width="46" height="46" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="14" r="9" fill="none" stroke="#a8dcf0" stroke-width="3.2" opacity=".12" stroke-dasharray="10 7"/>
        <circle cx="34" cy="33" r="6" fill="none" stroke="#cdeaf8" stroke-width="2.4" opacity=".11" stroke-dasharray="7 5"/>
        <circle cx="12" cy="14" r="1.8" fill="#eafcff" opacity=".2"/>
      </pattern>
      <pattern id="${"ripple-rain-hit2"}" width="71" height="71" patternUnits="userSpaceOnUse">
        <circle cx="22" cy="24" r="13" fill="none" stroke="#6fb0cc" stroke-width="3.6" opacity=".10" stroke-dasharray="14 10"/>
        <circle cx="56" cy="55" r="8" fill="none" stroke="#a8dcf0" stroke-width="2.6" opacity=".09" stroke-dasharray="9 6"/>
      </pattern>
      <!-- 雨丝：斜向细短线 -->
      <pattern id="${"ripple-rain-streak"}" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(16)">
        <path d="M6 0V13" stroke="#cdeaf8" stroke-width="1.3" opacity=".16" stroke-linecap="round"/>
        <path d="M26 14V22" stroke="#a8dcf0" stroke-width="1.1" opacity=".13" stroke-linecap="round"/>
      </pattern>
      <filter id="${"ripple-rain-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="15" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-rain-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#3d7f9e"/><stop offset=".28" stop-color="#17455c"/>
        <stop offset=".68" stop-color="#0b2838"/><stop offset="1" stop-color="#05131c"/>
      </radialGradient>
      <radialGradient id="${"ripple-rain-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#e9f7ff"/>
        <stop offset=".70" stop-color="#b6dcef"/><stop offset="1" stop-color="#78aec9"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-rain-base"})`,
    boardOverlay: `
      ${BG("ripple-rain-glow")}
      ${BG("ripple-rain-deep")}
      <g class="rp-rain-hit">
        <rect x="-100" y="-160" width="860" height="960" fill="url(#${"ripple-rain-hit"})"/>
      </g>
      <g class="rp-rain-hit2">
        <rect x="-100" y="-160" width="860" height="960" fill="url(#${"ripple-rain-hit2"})"/>
      </g>
      <g class="rp-rain-streak">
        <rect x="-100" y="-160" width="860" height="960" fill="url(#${"ripple-rain-streak"})"/>
      </g>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="14" fill="none" stroke="#8ec2dd" stroke-width="1.2" opacity=".3"/>`,
    lineStroke: "#9ccde6",
    lineW: 1.05,
    lineOpacity: 0.46,
    lineFilter: "ripple-rain-refract",
    starFill: "#dcf2ff",
    starR: 3.1,
    starOpacity: 0.86,

    stone: { shadow: "#03121b", shadowOpacity: 0.44, blackGlaze: "#dcf7ff", blackGlazeOpacity: 0.7, bounce: "#4d95b5", arcColor: "#ffffff", arcOpacity: 0.48, lastRing: "#cdefff", lastCore: "#eafcff" },

    css: `
/* ★ 雨点层斜向下落：3.5s 位移 (-22,+46)，循环无缝（pattern 高度 46 的倍数） */
#board .rp-rain-hit{animation:ripple-rain-fall 3.5s linear infinite}
@keyframes ripple-rain-fall{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-23px,46px)}
}
#board .rp-rain-hit2{animation:ripple-rain-fall2 6s linear infinite}
@keyframes ripple-rain-fall2{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-35.5px,71px)}
}
/* ★ 雨丝下落更快，斜度更大（这是「在下雨」而不是「有纹理」的关键） */
#board .rp-rain-streak{animation:ripple-rain-streakfall 1.6s linear infinite}
@keyframes ripple-rain-streakfall{
  0%  {transform:translate(0,0)}
  100%{transform:translate(11px,40px)}
}
#board .ripple-rain-Last{transform-box:fill-box;transform-origin:center;animation:ripple-rain-RippleOut 2s ease-out infinite}
#board .ripple-rain-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-rain-RippleOut2 2s ease-out infinite .4s}
#board .ripple-rain-LastCore{animation:ripple-rain-core 1.2s ease-in-out infinite}
@keyframes ripple-rain-core{0%,100%{opacity:.3}50%{opacity:.8}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     6 · ripple-ice 冰面 · 银灰   【亮调】
     结冰的湖面：银灰 + 极浅的青。网格下面有冰裂，网格本身被冰折射。
     动效：冰下寒光带极慢地游走（14s）+ 冰裂纹呼吸。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-ice",
    name: "水波 · 冰面银灰",
    swatch: "#8fb6cc",
    pageBg: "#e6eef2",

    vars: {
      "--bd-bg": "#dbe7ee", "--bd-line": "#42647a", "--bd-star": "#33566c",
      "--st-black": "#33495a", "--st-white": "#fdfeff", "--ui-accent": "#5c8aa6",
      "--bd-radius": "10px",
    },

    defs: `
      <linearGradient id="${"ripple-ice-base"}" x1=".15" y1="0" x2=".85" y2="1">
        <stop offset="0" stop-color="#eaf3f8"/><stop offset=".38" stop-color="#d5e3ec"/>
        <stop offset=".74" stop-color="#bfd2e0"/><stop offset="1" stop-color="#aabfce"/>
      </linearGradient>
      <radialGradient id="${"ripple-ice-sheen"}" cx="36%" cy="22%" r="64%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".56"/>
        <stop offset=".52" stop-color="#eaf4f9" stop-opacity=".16"/>
        <stop offset="1" stop-color="#c8dae4" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-ice-blue"}" cx="78%" cy="84%" r="56%">
        <stop offset="0" stop-color="#8fb6cc" stop-opacity=".30"/>
        <stop offset="1" stop-color="#c2d5e0" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 冰的折射比水硬、比水浅（位移小一点、频率高一点），线是「碎折」不是「软弯」 -->
      <filter id="${"ripple-ice-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".026 .021" numOctaves="3" seed="37" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 冰裂：直折线而不是同心圆（避免靶环） -->
      <g id="${"ripple-ice-cracks"}">
        <path d="M78 154L186 208L214 320L352 356L430 470" fill="none" stroke="#8fb6cc" stroke-width="2.6" opacity=".22"/>
        <path d="M186 208L292 176L340 96" fill="none" stroke="#a8c6d8" stroke-width="2.2" opacity=".19"/>
        <path d="M214 320L128 396L96 520" fill="none" stroke="#a8c6d8" stroke-width="2" opacity=".17"/>
        <path d="M352 356L470 314L556 344" fill="none" stroke="#8fb6cc" stroke-width="2.4" opacity=".2"/>
        <path d="M418 92L470 168L570 196" fill="none" stroke="#b6d0de" stroke-width="2" opacity=".16"/>
        <path d="M136 96L96 200L62 236" fill="none" stroke="#b6d0de" stroke-width="1.8" opacity=".15"/>
        <path d="M292 176L316 262L430 296" fill="none" stroke="#8fb6cc" stroke-width="1.9" opacity=".16"/>
      </g>
      <!-- 冰面的泛白气泡/霜斑（压得很淡：它在网格之上，太亮会把网格糊掉） -->
      <pattern id="${"ripple-ice-frost"}" width="58" height="58" patternUnits="userSpaceOnUse">
        <circle cx="20" cy="18" r="7" fill="#ffffff" opacity=".09"/>
        <circle cx="44" cy="42" r="5" fill="#ffffff" opacity=".07"/>
        <circle cx="12" cy="46" r="3.4" fill="#ffffff" opacity=".06"/>
      </pattern>
      <linearGradient id="${"ripple-ice-cold"}" x1="0" y1="0" x2="1" y2=".8">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".42" stop-color="#ffffff" stop-opacity=".24"/>
        <stop offset=".56" stop-color="#f4fbff" stop-opacity=".28"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-ice-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="2" seed="19" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.0" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-ice-Black"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#7e97a8"/><stop offset=".30" stop-color="#4d6879"/>
        <stop offset=".68" stop-color="#33495a"/><stop offset="1" stop-color="#243645"/>
      </radialGradient>
      <radialGradient id="${"ripple-ice-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".40" stop-color="#fbfdff"/>
        <stop offset=".74" stop-color="#e4eef4"/><stop offset="1" stop-color="#bdd0dc"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-ice-base"})`,
    boardOverlay: `
      ${BG("ripple-ice-sheen")}
      ${BG("ripple-ice-blue")}
      <g class="rp-ice-cracks" filter="url(#${"ripple-ice-refract"})">
        <use href="#ripple-ice-cracks"/>
      </g>
      <rect class="rp-ice-cold" x="-150" y="-150" width="300" height="300" rx="60" fill="url(#${"ripple-ice-cold"})" transform="rotate(24 310 310)"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${"ripple-ice-frost"})"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="11" fill="none" stroke="#7fa4bc" stroke-width="1.4" opacity=".5"/>
      <rect x="9" y="9" width="602" height="602" rx="8" fill="none" stroke="#ffffff" stroke-width="1.6" opacity=".5"/>`,
    lineStroke: "#33556e",
    lineW: 1.25,
    lineOpacity: 0.7,
    lineFilter: "ripple-ice-refract",
    starFill: "#2a4a60",
    starR: 3.4,

    stone: { shadow: "#5c7c90", shadowOpacity: 0.22, blackGlaze: "#ffffff", blackGlazeOpacity: 0.8, blackEdge: "rgba(120,165,195,.4)", whiteEdge: "rgba(90,130,160,.5)", bounce: "#a8cede", arcColor: "#ffffff", arcOpacity: 0.72, lastRing: "#3d6d8c", lastCore: "#eef8ff" },

    css: `
/* ★ 冰下寒光带游走：14s 很慢，但位移 480px，是「冰在动」而不是「有个亮点」 */
#board .rp-ice-cold{animation:ripple-ice-cold 14s ease-in-out infinite}
@keyframes ripple-ice-cold{
  0%  {transform:translate(-70px,-90px) rotate(24deg);opacity:.4}
  50% {transform:translate(360px,300px) rotate(24deg);opacity:.86}
  100%{transform:translate(-70px,-90px) rotate(24deg);opacity:.4}
}
/* ★ 冰裂纹微微起伏（scale + 极轻旋转），像冰在应力下呼吸 */
#board .rp-ice-cracks{transform-box:fill-box;transform-origin:center;animation:ripple-ice-breathe 12s ease-in-out infinite}
@keyframes ripple-ice-breathe{
  0%  {transform:scale(1) rotate(0deg);opacity:.72}
  50% {transform:scale(1.035) rotate(.7deg);opacity:1}
  100%{transform:scale(1) rotate(0deg);opacity:.72}
}
#board .ripple-ice-Last{transform-box:fill-box;transform-origin:center;animation:ripple-ice-RippleOut 2.2s ease-out infinite}
#board .ripple-ice-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-ice-RippleOut2 2.2s ease-out infinite .5s}
#board .ripple-ice-LastCore{animation:ripple-ice-core 1.5s ease-in-out infinite}
@keyframes ripple-ice-core{0%,100%{opacity:.3}50%{opacity:.72}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     7 · ripple-onsen 温泉 · 水汽   【中调】
     乳白的温泉水 + 缓缓上升的水汽。水偏浑、光偏暖，不是冷蓝。
     动效：水汽两层向上飘（幅度 60px，明显）+ 水面暖光呼吸。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-onsen",
    name: "水波 · 温泉水汽",
    swatch: "#4d9a9a",
    pageBg: "#0f1d1d",

    vars: {
      "--bd-bg": "#2c4f4f", "--bd-line": "#bce8e2", "--bd-star": "#f0fffc",
      "--st-black": "#26484a", "--st-white": "#fbfefd", "--ui-accent": "#4d9a9a",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"ripple-onsen-base"}" x1=".15" y1="0" x2=".85" y2="1">
        <stop offset="0" stop-color="#3f736e"/><stop offset=".38" stop-color="#325f5e"/>
        <stop offset=".74" stop-color="#224a4c"/><stop offset="1" stop-color="#173638"/>
      </linearGradient>
      <radialGradient id="${"ripple-onsen-warm"}" cx="42%" cy="30%" r="62%">
        <stop offset="0" stop-color="#d8f0e8" stop-opacity=".3"/>
        <stop offset=".5" stop-color="#8fc4bc" stop-opacity=".11"/>
        <stop offset="1" stop-color="#2b5658" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-onsen-deep"}" cx="62%" cy="82%" r="58%">
        <stop offset="0" stop-color="#173638" stop-opacity=".55"/>
        <stop offset="1" stop-color="#2b5658" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 温泉水比溪水浑，折射更「软」、位移略大 -->
      <filter id="${"ripple-onsen-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".013 .026" numOctaves="3" seed="51" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.8" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 水面暖雾：大团、极淡的柔光斑（不是圈） -->
      <pattern id="${"ripple-onsen-haze"}" width="130" height="130" patternUnits="userSpaceOnUse">
        <ellipse cx="40" cy="46" rx="34" ry="24" fill="#ffffff" opacity=".05"/>
        <ellipse cx="94" cy="98" rx="28" ry="19" fill="#eafaf6" opacity=".042"/>
      </pattern>
      <pattern id="${"ripple-onsen-haze2"}" width="180" height="180" patternUnits="userSpaceOnUse">
        <ellipse cx="64" cy="70" rx="48" ry="32" fill="#d8f2ec" opacity=".042"/>
        <ellipse cx="140" cy="28" rx="34" ry="22" fill="#ffffff" opacity=".036"/>
      </pattern>
      <!-- 蒸汽上升的竖条（极淡） -->
      <pattern id="${"ripple-onsen-steam"}" width="54" height="120" patternUnits="userSpaceOnUse">
        <path d="M14 120Q26 90 14 62T14 0" fill="none" stroke="#ffffff" stroke-width="6" opacity=".05"/>
        <path d="M40 120Q28 88 40 58T40 0" fill="none" stroke="#eafaf6" stroke-width="4.4" opacity=".04"/>
      </pattern>
      <linearGradient id="${"ripple-onsen-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".44" stop-color="#f4fffb" stop-opacity=".18"/>
        <stop offset=".58" stop-color="#ffffff" stop-opacity=".20"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-onsen-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="7" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-onsen-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#6fa8a2"/><stop offset=".30" stop-color="#3a6a68"/>
        <stop offset=".68" stop-color="#26484a"/><stop offset="1" stop-color="#183638"/>
      </radialGradient>
      <radialGradient id="${"ripple-onsen-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".38" stop-color="#f6fffd"/>
        <stop offset=".72" stop-color="#d8efea"/><stop offset="1" stop-color="#a8cfc9"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-onsen-base"})`,
    boardOverlay: `
      ${BG("ripple-onsen-warm")}
      ${BG("ripple-onsen-deep")}
      <g class="rp-onsen-haze">
        <rect x="-160" y="-160" width="940" height="940" fill="url(#${"ripple-onsen-haze"})"/>
      </g>
      <g class="rp-onsen-haze2">
        <rect x="-160" y="-160" width="940" height="940" fill="url(#${"ripple-onsen-haze2"})"/>
      </g>
      <g class="rp-onsen-steam">
        <rect x="-120" y="-180" width="900" height="1000" fill="url(#${"ripple-onsen-steam"})"/>
      </g>
      <rect class="rp-onsen-glint" x="-150" y="-150" width="300" height="300" rx="60" fill="url(#${"ripple-onsen-glint"})" transform="rotate(20 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#bce8e2" stroke-width="1.2" opacity=".34"/>`,
    lineStroke: "#cdf0ea",
    lineW: 1.15,
    lineOpacity: 0.56,
    lineFilter: "ripple-onsen-refract",
    starFill: "#f0fffc",
    starR: 3.2,
    starOpacity: 0.86,

    stone: { shadow: "#0d2324", shadowOpacity: 0.42, blackGlaze: "#eafff9", blackGlazeOpacity: 0.7, bounce: "#6fc0b4", arcColor: "#ffffff", arcOpacity: 0.5, lastRing: "#dcfff6", lastCore: "#f0fffc" },

    css: "",
    /* ★ 水汽向上飘：两层不同速度 + 蒸汽 + 暖光扫过。
       原来和「当前手涟漪」混在同一块 css 里，现在按谁在动拆成两堆，
       周期/位移/相位一个没改（60~90px 的上升位移是这块盘的签名，故意大于通用约束）。 */
    boardMotion: {
      name: "水汽上升 · 暖光扫过",
      desc: "两层水汽与蒸汽缓缓上飘，一团的暖光斜着扫过水面",
      css: () => `
#board .rp-onsen-haze{animation:ripple-onsen-rise 9s linear infinite}
@keyframes ripple-onsen-rise{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-18px,-130px)}
}
#board .rp-onsen-haze2{animation:ripple-onsen-rise2 14s linear infinite}
@keyframes ripple-onsen-rise2{
  0%  {transform:translate(0,0)}
  100%{transform:translate(26px,-180px)}
}
#board .rp-onsen-steam{animation:ripple-onsen-steam 11s linear infinite}
@keyframes ripple-onsen-steam{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-14px,-240px)}
}
#board .rp-onsen-glint{animation:ripple-onsen-glint 11s ease-in-out infinite}
@keyframes ripple-onsen-glint{
  0%  {transform:translate(-120px,-120px) rotate(20deg);opacity:.3}
  50% {opacity:.82}
  100%{transform:translate(420px,420px) rotate(20deg);opacity:.3}
}
${RM("#board .rp-onsen-haze,#board .rp-onsen-haze2,#board .rp-onsen-steam,#board .rp-onsen-glint")}
`,
    },
    stoneMotion: {
      name: "当前手涟漪",
      desc: "最后一手外两圈错相位的水纹扩散 + 核心光斑呼吸",
      css: () => RIPPLE_KF("ripple-onsen") + LAST_RULES("ripple-onsen", ".24/.62"),
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
     8 · ripple-tide 潮汐 · 月光银蓝   【暗调】
     夜里的潮水：月光银蓝 + 一排排潮线缓慢向上推。
     动效：潮线整体上下推移（9s，位移 96px）+ 光线呼吸。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-tide",
    name: "水波 · 潮汐月银",
    swatch: "#6f8fc4",
    pageBg: "#0a0e1a",

    vars: {
      "--bd-bg": "#141d33", "--bd-line": "#a8bce6", "--bd-star": "#e6eeff",
      "--st-black": "#1a2540", "--st-white": "#f0f5ff", "--ui-accent": "#5b7bb4",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"ripple-tide-base"}" x1=".1" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#1e2b4a"/><stop offset=".40" stop-color="#172138"/>
        <stop offset=".76" stop-color="#101828"/><stop offset="1" stop-color="#0a0f1c"/>
      </linearGradient>
      <radialGradient id="${"ripple-tide-moon"}" cx="28%" cy="16%" r="58%">
        <stop offset="0" stop-color="#cfe0ff" stop-opacity=".38"/>
        <stop offset=".46" stop-color="#7f96d0" stop-opacity=".14"/>
        <stop offset="1" stop-color="#101828" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-tide-deep"}" cx="70%" cy="86%" r="60%">
        <stop offset="0" stop-color="#080d1a" stop-opacity=".6"/>
        <stop offset="1" stop-color="#141d33" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 潮水的折射是「一排排」的：横向频率高、纵向低，位移 5.6 -->
      <filter id="${"ripple-tide-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".017 .009" numOctaves="3" seed="71" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="5.6" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 潮线：一排排水平长波（不是同心环） -->
      <pattern id="${"ripple-tide-line"}" width="160" height="48" patternUnits="userSpaceOnUse">
        <path d="M0 8Q40 -2 80 8T160 8" fill="none" stroke="#cfdcff" stroke-width="5" opacity=".1" stroke-dasharray="66 30"/>
        <path d="M0 26Q40 16 80 26T160 26" fill="none" stroke="#9fb4e8" stroke-width="4.4" opacity=".085" stroke-dasharray="52 36"/>
        <path d="M0 41Q40 33 80 41T160 41" fill="none" stroke="#cfdcff" stroke-width="3" opacity=".07" stroke-dasharray="40 44"/>
      </pattern>
      <pattern id="${"ripple-tide-foam"}" width="120" height="32" patternUnits="userSpaceOnUse">
        <path d="M0 16Q30 6 60 16T120 16" fill="none" stroke="#ffffff" stroke-width="2.6" opacity=".10" stroke-dasharray="14 22"/>
      </pattern>
      <linearGradient id="${"ripple-tide-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e6eeff" stop-opacity="0"/>
        <stop offset=".44" stop-color="#e6eeff" stop-opacity=".15"/>
        <stop offset=".56" stop-color="#ffffff" stop-opacity=".18"/>
        <stop offset="1" stop-color="#e6eeff" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-tide-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="27" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-tide-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#5872ad"/><stop offset=".28" stop-color="#26386a"/>
        <stop offset=".68" stop-color="#172043"/><stop offset="1" stop-color="#0c1226"/>
      </radialGradient>
      <radialGradient id="${"ripple-tide-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f0f5ff"/>
        <stop offset=".70" stop-color="#ccd8f4"/><stop offset="1" stop-color="#94a8da"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-tide-base"})`,
    boardOverlay: `
      ${BG("ripple-tide-moon")}
      ${BG("ripple-tide-deep")}
      <g class="rp-tide-line">
        <rect x="-160" y="-200" width="940" height="1020" fill="url(#${"ripple-tide-line"})"/>
      </g>
      <g class="rp-tide-foam">
        <rect x="-160" y="-200" width="940" height="1020" fill="url(#${"ripple-tide-foam"})"/>
      </g>
      <rect class="rp-tide-glint" x="-150" y="-150" width="300" height="300" rx="60" fill="url(#${"ripple-tide-glint"})" transform="rotate(36 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#a8bce6" stroke-width="1.2" opacity=".3"/>`,
    lineStroke: "#b4c6ec",
    lineW: 1.05,
    lineOpacity: 0.48,
    lineFilter: "ripple-tide-refract",
    starFill: "#e6eeff",
    starR: 3.2,
    starOpacity: 0.9,

    stone: { shadow: "#050913", shadowOpacity: 0.46, blackGlaze: "#e6eeff", blackGlazeOpacity: 0.7, bounce: "#6f8fc4", arcColor: "#ffffff", arcOpacity: 0.5, lastRing: "#dbe6ff", lastCore: "#f0f5ff" },

    css: `
/* ★ 潮线整体上下推移：9s 位移 96px（pattern 高 48 的倍数，接缝不着痕迹） */
#board .rp-tide-line{animation:ripple-tide-ebb 9s ease-in-out infinite}
@keyframes ripple-tide-ebb{
  0%  {transform:translate(0,0)}
  50% {transform:translate(-16px,-96px)}
  100%{transform:translate(0,0)}
}
/* 泡沫层反向、错相位，像潮水拍到又退回去 */
#board .rp-tide-foam{animation:ripple-tide-foam 6.5s ease-in-out infinite}
@keyframes ripple-tide-foam{
  0%  {transform:translate(0,64px);opacity:.6}
  50% {transform:translate(12px,0);opacity:1}
  100%{transform:translate(0,64px);opacity:.6}
}
/* ★ 月光带扫过 */
#board .rp-tide-glint{animation:ripple-tide-glint 12s ease-in-out infinite}
@keyframes ripple-tide-glint{
  0%  {transform:translate(-130px,-130px) rotate(36deg);opacity:.24}
  50% {opacity:.78}
  100%{transform:translate(440px,440px) rotate(36deg);opacity:.24}
}
#board .ripple-tide-Last{transform-box:fill-box;transform-origin:center;animation:ripple-tide-RippleOut 2.4s ease-out infinite}
#board .ripple-tide-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-tide-RippleOut2 2.4s ease-out infinite .55s}
#board .ripple-tide-LastCore{animation:ripple-tide-core 1.6s ease-in-out infinite}
@keyframes ripple-tide-core{0%,100%{opacity:.24}50%{opacity:.66}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     9 · ripple-shaft 水下 · 光柱   【深海紫】
     潜到水下仰头看：几道阳光柱从左上斜插下来，水是深紫的。
     动效：光柱摇曳（12s，translateX ±22px + skew，明显）。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-shaft",
    name: "水波 · 水下光柱",
    swatch: "#4a3a8c",
    pageBg: "#0b0816",

    vars: {
      "--bd-bg": "#1d1440", "--bd-line": "#b0a0e8", "--bd-star": "#e8e0ff",
      "--st-black": "#231a44", "--st-white": "#f2ecff", "--ui-accent": "#5a48a8",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"ripple-shaft-base"}" x1=".15" y1="0" x2=".85" y2="1">
        <stop offset="0" stop-color="#42308c"/><stop offset=".38" stop-color="#2e2262"/>
        <stop offset=".74" stop-color="#1e1542"/><stop offset="1" stop-color="#110b28"/>
      </linearGradient>
      <radialGradient id="${"ripple-shaft-top"}" cx="30%" cy="8%" r="66%">
        <stop offset="0" stop-color="#b0a0f0" stop-opacity=".5"/>
        <stop offset=".46" stop-color="#5a48a8" stop-opacity=".2"/>
        <stop offset="1" stop-color="#181034" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-shaft-deep"}" cx="62%" cy="88%" r="62%">
        <stop offset="0" stop-color="#07040f" stop-opacity=".55"/>
        <stop offset="1" stop-color="#1d1440" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 深水的折射更慢更软（低频、位移 6.0） -->
      <filter id="${"ripple-shaft-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".012 .019" numOctaves="3" seed="83" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="6.0" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 光柱：三道斜的柔亮楔形 -->
      <g id="${"ripple-shaft-beams"}">
        <path d="M150 -40L214 -40L438 660L286 660Z" fill="#d8ccff" opacity=".17"/>
        <path d="M286 -40L330 -40L500 660L400 660Z" fill="#c8b8ff" opacity=".14"/>
        <path d="M74 -40L110 -40L250 660L160 660Z" fill="#e0d8ff" opacity=".11"/>
      </g>
      <!-- ★ 焦散：水底被光柱打出的网状亮斑（弧线交错，不是同心圆） -->
      <pattern id="${"ripple-shaft-caustic"}" width="52" height="52" patternUnits="userSpaceOnUse">
        <path d="M0 20Q13 6 26 20T52 20" fill="none" stroke="#d8ccff" stroke-width="3.6" opacity=".13"/>
        <path d="M0 42Q13 28 26 42T52 42" fill="none" stroke="#b0a0f0" stroke-width="3" opacity=".10"/>
      </pattern>
      <pattern id="${"ripple-shaft-caustic2"}" width="78" height="78" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
        <path d="M0 30Q19 14 39 30T78 30" fill="none" stroke="#e0d8ff" stroke-width="4" opacity=".09"/>
        <path d="M0 60Q19 44 39 60T78 60" fill="none" stroke="#b0a0f0" stroke-width="3.2" opacity=".08"/>
      </pattern>
      <filter id="${"ripple-shaft-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="33" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-shaft-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#7a63c8"/><stop offset=".28" stop-color="#3d2c78"/>
        <stop offset=".68" stop-color="#231a44"/><stop offset="1" stop-color="#120c28"/>
      </radialGradient>
      <radialGradient id="${"ripple-shaft-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f2ecff"/>
        <stop offset=".70" stop-color="#d0c4f6"/><stop offset="1" stop-color="#9a86d8"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-shaft-base"})`,
    boardOverlay: `
      ${BG("ripple-shaft-top")}
      ${BG("ripple-shaft-deep")}
      <g class="rp-shaft-beams">
        <use href="#ripple-shaft-beams"/>
      </g>
      <g class="rp-shaft-caustic">
        <rect x="-140" y="-140" width="900" height="900" fill="url(#${"ripple-shaft-caustic"})"/>
      </g>
      <g class="rp-shaft-caustic2">
        <rect x="-140" y="-140" width="900" height="900" fill="url(#${"ripple-shaft-caustic2"})"/>
      </g>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#b0a0e8" stroke-width="1.2" opacity=".34"/>`,
    lineStroke: "#d0c4f8",
    lineW: 1.15,
    lineOpacity: 0.58,
    lineFilter: "ripple-shaft-refract",
    starFill: "#e8e0ff",
    starR: 3.2,
    starOpacity: 0.88,

    stone: { shadow: "#05030d", shadowOpacity: 0.48, blackGlaze: "#e8e0ff", blackGlazeOpacity: 0.72, bounce: "#7a63c8", arcColor: "#ffffff", arcOpacity: 0.5, lastRing: "#e0d8ff", lastCore: "#f4f0ff" },

    css: `
/* ★ 光柱摇曳：12s，translateX ±24px + 不同 skew，肉眼一定看得见 */
#board .rp-shaft-beams{transform-box:fill-box;transform-origin:50% 0%;animation:ripple-shaft-sway 12s ease-in-out infinite}
@keyframes ripple-shaft-sway{
  0%  {transform:translateX(-24px) skewX(-4deg);opacity:.7}
  32% {transform:translateX(16px) skewX(3deg);opacity:1}
  66% {transform:translateX(-8px) skewX(-1.5deg);opacity:.85}
  100%{transform:translateX(-24px) skewX(-4deg);opacity:.7}
}
/* ★ 焦散水面下缓慢游动，两层不同向 */
#board .rp-shaft-caustic{animation:ripple-shaft-caustic 13s linear infinite}
@keyframes ripple-shaft-caustic{
  0%  {transform:translate(0,0)}
  100%{transform:translate(52px,52px)}
}
#board .rp-shaft-caustic2{animation:ripple-shaft-caustic2 17s linear infinite}
@keyframes ripple-shaft-caustic2{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-39px,39px)}
}
#board .ripple-shaft-Last{transform-box:fill-box;transform-origin:center;animation:ripple-shaft-RippleOut 2.5s ease-out infinite}
#board .ripple-shaft-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-shaft-RippleOut2 2.5s ease-out infinite .6s}
#board .ripple-shaft-LastCore{animation:ripple-shaft-core 1.6s ease-in-out infinite}
@keyframes ripple-shaft-core{0%,100%{opacity:.26}50%{opacity:.72}}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     10 · ripple-mud 琥珀 · 浑水   【琥珀色】
     一场雨后的黄河/泥塘：琥珀偏黄的浑水，水面泛着油亮的浑光。
     动效：浑浊悬浮物缓慢旋流（18s，平移 + 轻微旋转）。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "ripple-mud",
    name: "水波 · 琥珀浑水",
    swatch: "#b07a34",
    pageBg: "#1a1108",

    vars: {
      "--bd-bg": "#523716", "--bd-line": "#f0d8a8", "--bd-star": "#fff4dc",
      "--st-black": "#4a3218", "--st-white": "#fff8ec", "--ui-accent": "#a8742f",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"ripple-mud-base"}" x1=".15" y1="0" x2=".85" y2="1">
        <stop offset="0" stop-color="#a2762c"/><stop offset=".38" stop-color="#805a22"/>
        <stop offset=".74" stop-color="#5c4118"/><stop offset="1" stop-color="#3d2b0f"/>
      </linearGradient>
      <radialGradient id="${"ripple-mud-sun"}" cx="38%" cy="24%" r="62%">
        <stop offset="0" stop-color="#ffe0a0" stop-opacity=".56"/>
        <stop offset=".5" stop-color="#c8934a" stop-opacity=".2"/>
        <stop offset="1" stop-color="#4d3514" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"ripple-mud-deep"}" cx="68%" cy="84%" r="58%">
        <stop offset="0" stop-color="#241806" stop-opacity=".5"/>
        <stop offset="1" stop-color="#4d3514" stop-opacity="0"/>
      </radialGradient>
      <!-- ★ 浑水的折射更「粘」：位移 6.0、低频，线被揉得比较明显 -->
      <filter id="${"ripple-mud-refract"}" x="-7%" y="-7%" width="114%" height="114%">
        <feTurbulence type="fractalNoise" baseFrequency=".013 .022" numOctaves="3" seed="97" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="6.0" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <!-- 浑水悬浮物：不规则团块（不是圈） -->
      <pattern id="${"ripple-mud-silt"}" width="96" height="96" patternUnits="userSpaceOnUse">
        <ellipse cx="30" cy="34" rx="22" ry="14" fill="#e8c88a" opacity=".075" transform="rotate(18 30 34)"/>
        <ellipse cx="70" cy="70" rx="16" ry="11" fill="#c8a060" opacity=".07" transform="rotate(-24 70 70)"/>
      </pattern>
      <pattern id="${"ripple-mud-silt2"}" width="142" height="142" patternUnits="userSpaceOnUse">
        <ellipse cx="46" cy="52" rx="32" ry="18" fill="#f0d8a8" opacity=".065" transform="rotate(-14 46 52)"/>
        <ellipse cx="108" cy="112" rx="24" ry="15" fill="#d8b478" opacity=".06" transform="rotate(22 108 112)"/>
      </pattern>
      <!-- 浑水的油亮反光：顺着水流方向的粗亮带 -->
      <pattern id="${"ripple-mud-sheen"}" width="140" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(-6)">
        <path d="M0 12Q35 2 70 12T140 12" fill="none" stroke="#ffe8c0" stroke-width="4.6" opacity=".10"/>
        <path d="M0 32Q35 24 70 32T140 32" fill="none" stroke="#f0d098" stroke-width="3.2" opacity=".08"/>
      </pattern>
      <linearGradient id="${"ripple-mud-glint"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff0d0" stop-opacity="0"/>
        <stop offset=".44" stop-color="#fff0d0" stop-opacity=".26"/>
        <stop offset=".58" stop-color="#ffffff" stop-opacity=".3"/>
        <stop offset="1" stop-color="#fff0d0" stop-opacity="0"/>
      </linearGradient>
      <filter id="${"ripple-mud-Wet"}" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".048" numOctaves="2" seed="45" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"ripple-mud-Black"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#b08a4a"/><stop offset=".28" stop-color="#6a4c1e"/>
        <stop offset=".68" stop-color="#4a3218"/><stop offset="1" stop-color="#2a1c0a"/>
      </radialGradient>
      <radialGradient id="${"ripple-mud-White"}" cx="32%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#fff8ec"/>
        <stop offset=".72" stop-color="#f0dfc0"/><stop offset="1" stop-color="#c8ac7c"/>
      </radialGradient>
    `,

    boardFill: `url(#${"ripple-mud-base"})`,
    boardOverlay: `
      ${BG("ripple-mud-sun")}
      ${BG("ripple-mud-deep")}
      <g class="rp-mud-silt">
        <rect x="-160" y="-160" width="940" height="940" fill="url(#${"ripple-mud-silt"})"/>
      </g>
      <g class="rp-mud-silt2">
        <rect x="-160" y="-160" width="940" height="940" fill="url(#${"ripple-mud-silt2"})"/>
      </g>
      <g class="rp-mud-sheen">
        <rect x="-160" y="-160" width="940" height="940" fill="url(#${"ripple-mud-sheen"})"/>
      </g>
      <rect class="rp-mud-glint" x="-150" y="-150" width="300" height="300" rx="60" fill="url(#${"ripple-mud-glint"})" transform="rotate(22 310 310)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#f0d8a8" stroke-width="1.2" opacity=".34"/>`,
    lineStroke: "#f5e0b4",
    lineW: 1.2,
    lineOpacity: 0.6,
    lineFilter: "ripple-mud-refract",
    starFill: "#fff4dc",
    starR: 3.3,
    starOpacity: 0.88,

    stone: { shadow: "#1c1206", shadowOpacity: 0.44, blackGlaze: "#ffeccf", blackGlazeOpacity: 0.72, bounce: "#c8924a", arcColor: "#ffffff", arcOpacity: 0.5, lastRing: "#ffe8c0", lastCore: "#fff6e6" },

    css: `
/* ★ 浑浊悬浮物缓慢旋流：两个方向相反，18s/24s，位移 96px（pattern 尺寸的倍数） */
#board .rp-mud-silt{animation:ripple-mud-swirl 18s linear infinite}
@keyframes ripple-mud-swirl{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-96px,96px)}
}
#board .rp-mud-silt2{animation:ripple-mud-swirl2 24s linear infinite}
@keyframes ripple-mud-swirl2{
  0%  {transform:translate(0,0)}
  100%{transform:translate(142px,-71px)}
}
/* ★ 油亮反光层顺着水流横向挪动 */
#board .rp-mud-sheen{animation:ripple-mud-sheen 10s linear infinite}
@keyframes ripple-mud-sheen{
  0%  {transform:translate(0,0)}
  100%{transform:translate(-140px,12px)}
}
/* ★ 浑水上的日头反光带扫过 */
#board .rp-mud-glint{animation:ripple-mud-glint 10s ease-in-out infinite}
@keyframes ripple-mud-glint{
  0%  {transform:translate(-130px,-130px) rotate(22deg);opacity:.3}
  50% {opacity:.84}
  100%{transform:translate(430px,430px) rotate(22deg);opacity:.3}
}
#board .ripple-mud-Last{transform-box:fill-box;transform-origin:center;animation:ripple-mud-RippleOut 2.4s ease-out infinite}
#board .ripple-mud-Last2{transform-box:fill-box;transform-origin:center;animation:ripple-mud-RippleOut2 2.4s ease-out infinite .55s}
#board .ripple-mud-LastCore{animation:ripple-mud-core 1.6s ease-in-out infinite}
@keyframes ripple-mud-core{0%,100%{opacity:.24}50%{opacity:.66}}
`,
  });
})();
