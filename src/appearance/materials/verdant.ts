/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   绿叶草 · Verdant —— 10 版

   共同骨架（上一版被认可的做法，这里保留并加强）：
     · 真实叶脉结构：一条主脉 + 四条侧脉，平铺成网（不是「绿底绿线」）
     · 三种深度的草叶弧线，叠出草地纵深
     · 从左上进来的一团透光，做「阳光穿过叶片」的通透
     · 黑子 = 深色果实/种子（棕绿、墨绿、松黑…），**绝不用亮绿**
     · 白子 = 浅色嫩叶球（带一点叶绿反光 / 晨露高光）

   10 版分别在「植物 / 光照 / 底色明度 / 笔法」四个维度上分头走：
     fern      蕨类     晨光透叶   浅底  写实叶脉    ← 动态：透光 14s 缓移
     bamboo    竹林     林间斑驳   中底  版画感      ← 动态：斑驳光 11s 过林 + 落子竹叶摆
     moss      苔藓     雨后湿润   中深  点彩质感    ← 动态：雨痕流动
     ivy       藤蔓     逆光边缘   深底  装饰线条    ← 静态（逆光靠 SVG 描边）
     lotus     荷叶     正午水面   浅底  水彩晕染    ← 动态：水面涟漪
     pine      松针     阴天柔光   墨绿深底 细密短线  ← 静态
     wheat     麦田     黄昏侧光   暖浅底  麦芒短线    ← 动态：麦浪起伏
     clover    三叶草   斑驳树荫   中浅底 几何色块    ← 动态：树影 13s 漂移
     lichen    地衣     林下幽光   极深底  版画刻痕    ← 动态：幽光呼吸
     sprout    嫩芽     温室漫射   极浅底  水彩细勾    ← 静态

   defs 里所有 id 一律加本皮肤前缀（P()），8 个风格文件同文档加载，
   不带前缀会互相串味（历史上踩过纸纹滤镜糊满所有棋盘）。
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  /* ── 叶子轮廓 path（多个皮肤共用，坐标固定在 0,0–40,40 局部系里） ──── */
  const LEAF_OUTLINE = "M2 40 C2 21 10 4 40 0 C36 30 19 40 2 40 Z";

  /* 叶脉组：主脉 + 四条侧脉，平铺时自然成网 */
  const leafVeins = (main, side, mw, sw, op) =>
    `<path d="M4 38.5C15 30 28 17 38.4 1.4" fill="none" stroke="${main}" stroke-width="${mw}" opacity="${op}"/>`
  + `<path d="M11 31Q18 30 24 25M19 21.5Q26 20.5 31.4 15.6M26 14Q31.6 12.8 36 8.8M8.4 36.4Q14 36 18.6 32.4"`
  + ` fill="none" stroke="${side}" stroke-width="${sw}" stroke-linecap="round" opacity="${op * 0.9}"/>`;

  /* ── 棋子：深色果实 ───────────────────────────────────────────────
     刻意把亮部压在 #33512A 以下。#4e7040 那一档会让黑子变「卷心菜」，
     所以深色果实的中心高光一律偏暖棕（brown），靠色相区分明度，不靠提亮。 */
  function darkFruit(x, y, r, g) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g.bg})"/>`
         + `<circle cx="${x}" cy="${y}" r="${r - 0.9}" fill="url(#${g.seed})" opacity=".92"/>`
         + `<ellipse cx="${x - r * 0.27}" cy="${y - r * 0.31}" rx="${r * 0.31}" ry="${r * 0.19}"`
         + ` fill="${g.hl}" opacity=".5" transform="rotate(-32 ${x - r * 0.27} ${y - r * 0.31})"/>`
         + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${g.edge}" stroke-width=".75" opacity=".6"/>`;
  }

  /* ── 棋子：浅色嫩叶球 ─────────────────────────────────────────────
     右下压一圈叶绿反光（背光嫩叶的通透），再加一颗晨露高光。
     **外圈用较深的叶绿描一道**——浅底（晨光/嫩芽那种 #f0f7e6 级别的底）
     上如果只描一条浅边，白子会整颗糊进背景里，看着像没落子。 */
  function leafBall(x, y, r, g) {
    return `<circle cx="${x}" cy="${y}" r="${r + 0.9}" fill="${g.rim || "#8aa86a"}" opacity=".72"/>`
         + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g.bg})"/>`
         + `<path d="M${x} ${y} A ${r} ${r} 0 0 0 ${x - r * 0.97} ${y + r * 0.24} A ${r * 0.82} ${r * 0.82} 0 0 1 ${x} ${y} Z"`
         + ` fill="${g.sheen}" opacity="${g.sheenOp}"/>`
         + `<ellipse cx="${x - r * 0.3}" cy="${y - r * 0.34}" rx="${r * 0.36}" ry="${r * 0.23}"`
         + ` fill="#ffffff" opacity=".88" transform="rotate(-30 ${x - r * 0.3} ${y - r * 0.34})"/>`
         + `<circle cx="${x}" cy="${y}" r="${r - 0.3}" fill="none" stroke="${g.edge}" stroke-width="1.1" opacity=".62"/>`;
  }

  /* ── 最后一手的柔光脉冲（动态） ───────────────────────────────────── */
  function pulse(x, y, r, color) {
    return `<circle class="gd-pulse" cx="${x}" cy="${y}" r="${r * 1.26}" fill="none"`
         + ` stroke="${color}" stroke-width="1.6" style="transform-box:fill-box;transform-origin:center"/>`;
  }

  /* ── 落子时草叶轻摆一次的「叶梢弧」（动态） ─────────────────────────
     从棋子右上方伸出的两根草叶，落子那一刻摆一下，静止时不可见。 */
  function swayTicks(x, y, r, color) {
    return `<g class="gd-sway" style="transform-box:fill-box;transform-origin:center;pointer-events:none">`
         + `<path d="M${x + r * 0.35} ${y - r * 0.8}Q${x + r * 1.5} ${y - r * 1.7} ${x + r * 2.1} ${y - r * 1.3}"`
         + ` fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>`
         + `<path d="M${x + r * 0.1} ${y - r * 0.95}Q${x + r * 0.7} ${y - r * 2.1} ${x + r * 1.6} ${y - r * 2.2}"`
         + ` fill="none" stroke="${color}" stroke-width=".9" stroke-linecap="round" opacity=".42"/>`
         + `</g>`;
  }

  /* ── 胜利时棋子下的柔光 ───────────────────────────────────────────── */
  function glow(x, y, r, color, op) {
    return `<circle cx="${x}" cy="${y}" r="${r * 1.5}" fill="${color}" opacity="${op}"/>`;
  }

  /* ── 每个皮肤各自的一套动态 keyframes ─────────────────────────────
     css 只在选中该皮肤时生效（loader 会替换 #skinStyle 的 textContent），
     所以每套都带自己的唯一动画名，换肤时不会被别的皮肤带走。 */
  const KF = {
    /* 透光斑缓慢移动，模拟云影过林 */
    drift: (n, dx, dy, dur, extra = "") => `
  @keyframes ${n}{
    0%  {transform:translate(0,0) scale(1)}
    50% {transform:translate(${dx}px,${dy}px) scale(1.06)}
    100%{transform:translate(0,0) scale(1)}
  }
  #board > .gd-sun{animation:${n} ${dur}s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  ${extra}`,
    /* 两团光斑反向游走 */
    drift2: (n, durA, durB) => `
  @keyframes ${n}-a{0%{transform:translate(0,0)}50%{transform:translate(26px,20px) scale(1.05)}100%{transform:translate(0,0)}}
  @keyframes ${n}-b{0%{transform:translate(0,0)}50%{transform:translate(-22px,-16px)}100%{transform:translate(0,0)}}
  #board > .gd-sun-a{animation:${n}-a ${durA}s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  #board > .gd-sun-b{animation:${n}-b ${durB}s ease-in-out infinite;transform-box:fill-box;transform-origin:center}`,
    /* 最后一手的柔光脉冲 */
    pulse: (n) => `
  @keyframes ${n}{0%,100%{opacity:.9;transform:scale(1)}50%{opacity:.28;transform:scale(1.14)}}
  #board #stones circle.gd-pulse{animation:${n} 2.6s ease-in-out infinite}`,
    /* 落子时草叶轻摆一次 */
    sway: (n) => `
  @keyframes ${n}{0%{opacity:0;transform:rotate(0deg)}12%{opacity:.9}45%{transform:rotate(-11deg)}100%{opacity:0;transform:rotate(0deg)}}
  #board #stones .gd-sway{animation:${n} 1.5s ease-out 1}
  #board #stones .gd-sway path{animation:${n} 1.5s ease-out 1}`,
    /* 水面/雨痕横向流动 */
    flow: (n, dur, dx) => `
  @keyframes ${n}{from{transform:translateX(0)}to{transform:translateX(${dx}px)}}
  #board > .gd-flow{animation:${n} ${dur}s linear infinite;transform-box:fill-box;transform-origin:center}`,
  };

  /* 无障碍：系统要求「减少动态效果」时掐掉这条选择器上的动画 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* ═══════════════════════════════════════════════════════════════════
     1. 蕨类 · 晨光透叶（浅底 / 写实叶脉 / 动态透光）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-fern", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "蕨类 · 晨光透叶", swatch: "#6d9448", pageBg: "#243122",
      vars: {
        "--bd-bg": "#f0f7e6", "--bd-line": "#6e8f4c", "--bd-line2": "#bcd29c",
        "--bd-star": "#4e6f34", "--bd-frame": "#8fae6a",
        "--st-black": "#26401f", "--st-white": "#f4faea",
        "--ui-accent": "#5f8a3f", "--ui-bg": "#f6fbee", "--ui-ink": "#26361c",
        "--ui-muted": "#6d7f5c", "--ui-line": "#cfdcbc", "--bd-radius": "16px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".85" y2="1">
          <stop offset="0" stop-color="#fbfdf4"/><stop offset=".42" stop-color="#eef6e0"/>
          <stop offset="1" stop-color="#d9e9c4"/>
        </linearGradient>
        <pattern id="${P("vein")}" width="62" height="62" patternUnits="userSpaceOnUse">
          <g transform="translate(0,0) scale(1.55)">${leafVeins("#7fa055", "#96b56c", 1.5, .85, .34)}</g>
          <g transform="translate(31,31) scale(1.55)">${leafVeins("#87a95c", "#9dbc72", 1.4, .8, .3)}</g>
        </pattern>
        <pattern id="${P("frond")}" width="96" height="104" patternUnits="userSpaceOnUse">
          <path d="M12 104C10 74 20 44 34 18" fill="none" stroke="#7ca052" stroke-width="1.5" opacity=".24"/>
          <path d="M34 18C26 24 20 34 17 46M34 18C31 28 27 38 21 48M34 18C38 26 42 34 47 40M34 18C39 24 45 29 52 32"
                fill="none" stroke="#8cb260" stroke-width="1.1" opacity=".21"/>
          <path d="M62 104C64 78 58 52 48 32" fill="none" stroke="#6f9648" stroke-width="1.2" opacity=".17"/>
          <path d="M48 32C44 42 41 52 40 64M48 32C52 42 53 50 51 60" fill="none" stroke="#84a95a" stroke-width=".9" opacity=".16"/>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fffce4" stop-opacity=".78"/>
          <stop offset=".45" stop-color="#fdf8d8" stop-opacity=".32"/>
          <stop offset="1" stop-color="#fdf8d8" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#4a6436"/><stop offset=".3" stop-color="#33512a"/>
          <stop offset=".68" stop-color="#1f3819"/><stop offset="1" stop-color="#14250f"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="66%">
          <stop offset="0" stop-color="#6b4d26"/><stop offset=".5" stop-color="#4a4423" stop-opacity=".6"/>
          <stop offset="1" stop-color="#2b3d1c" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#fefff8"/><stop offset=".42" stop-color="#f0f7e2"/>
          <stop offset=".78" stop-color="#d5e7bb"/><stop offset="1" stop-color="#b3cd92"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e3f0cd" stop-opacity="0"/><stop offset="1" stop-color="#a9c785" stop-opacity=".55"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("frond")})" opacity=".9"/>
        <rect class="gd-sun" x="-120" y="-140" width="620" height="620" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#6e8f4c", lineW: 1.05, lineOpacity: .5,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#54763a" stroke-width="2.1" opacity=".42"/>`,
      starFill: "#4e6f34", starR: 3.4,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#8a6a38", edge: "#101d0c" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .85, rim: "#6f9450", edge: "#93ad72" }))
      + (isLast ? pulse(x, y, r, "#f2ffd8") : "")
      + (isLast ? swayTicks(x, y, r, "#6d9448") : ""),
      css: KF.drift(`${ID}-drift`, 46, 34, 14, KF.pulse(`${ID}-pulse`) + KF.sway(`${ID}-sway`)),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     2. 竹林 · 林间斑驳（中底 / 版画感 / 动态斑驳光 + 落子竹叶摆）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-bamboo", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "竹林 · 林间斑驳", swatch: "#6f9a4e", pageBg: "#1d2a1a",
      vars: {
        "--bd-bg": "#dcebca", "--bd-line": "#57793f", "--bd-line2": "#a8c489",
        "--bd-star": "#3d5c2c", "--bd-frame": "#6f9a4e",
        "--st-black": "#1e3319", "--st-white": "#eef6de",
        "--ui-accent": "#4f7a38", "--ui-bg": "#eef5e2", "--ui-ink": "#22331a",
        "--ui-muted": "#657a55", "--ui-line": "#c4d6ac", "--bd-radius": "12px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".2" y2="1">
          <stop offset="0" stop-color="#e9f3da"/><stop offset=".5" stop-color="#d6e7c0"/>
          <stop offset="1" stop-color="#c2d8a8"/>
        </linearGradient>
        <pattern id="${P("culm")}" width="46" height="620" patternUnits="userSpaceOnUse">
          <rect x="6" y="0" width="19" height="620" fill="#9cbc72" opacity=".2"/>
          <rect x="6" y="0" width="5" height="620" fill="#8aae60" opacity=".18"/>
          <path d="M6 0V620M25 0V620" stroke="#7d9e56" stroke-width="1.1" opacity=".22"/>
          <path d="M6 96H25M6 214H25M6 332H25M6 450H25M6 568H25" stroke="#7d9e56" stroke-width="2.4" opacity=".26"/>
          <path d="M25 120C36 112 42 104 44 92M25 300C37 292 44 282 46 268" fill="none" stroke="#7ba152" stroke-width="1.6" opacity=".2"/>
          <path d="M6 400C-6 392 -12 384 -14 370" fill="none" stroke="#83a85a" stroke-width="1.6" opacity=".18"/>
        </pattern>
        <pattern id="${P("leaf")}" width="88" height="88" patternUnits="userSpaceOnUse">
          <g transform="translate(4,4) scale(1.9)">${leafVeins("#74a04b", "#8db263", 1.5, .8, .3)}</g>
          <g transform="translate(-36,46) scale(1.9)">${leafVeins("#7ea653", "#95b968", 1.3, .75, .24)}</g>
        </pattern>
        <radialGradient id="${P("shaft")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fffaDC" stop-opacity=".68"/>
          <stop offset=".55" stop-color="#fff8d0" stop-opacity=".24"/>
          <stop offset="1" stop-color="#fff8d0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fffce0" stop-opacity=".55"/><stop offset="1" stop-color="#fffce0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#435e30"/><stop offset=".3" stop-color="#2c4a23"/>
          <stop offset=".7" stop-color="#1a2e16"/><stop offset="1" stop-color="#101f0d"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="64%">
          <stop offset="0" stop-color="#6f5227"/><stop offset="1" stop-color="#31421f" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#fdfff6"/><stop offset=".44" stop-color="#ecf5da"/>
          <stop offset=".78" stop-color="#cfe3b2"/><stop offset="1" stop-color="#a9c487"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#dcebc2" stop-opacity="0"/><stop offset="1" stop-color="#9bbc74" stop-opacity=".5"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("culm")})"/>
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("leaf")})"/>
        <rect class="gd-sun-a" x="-60" y="-40" width="420" height="380" fill="url(#${P("shaft")})" pointer-events="none"/>
        <rect class="gd-sun-b" x="300" y="250" width="380" height="420" fill="url(#${P("shaft")})" opacity=".8" pointer-events="none"/>
        <rect class="gd-sun" x="-150" y="-170" width="880" height="880" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#57793f", lineW: 1.25, lineOpacity: .52,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#3d5c2c" stroke-width="2.6" opacity=".5"/>`,
      starFill: "#3d5c2c", starR: 3.6,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#84603a", edge: "#0c1a0a" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .8, rim: "#83a35e", edge: "#8fa96d" }))
      + (isLast ? pulse(x, y, r, "#eaffc8") : "")
      + (isLast ? swayTicks(x, y, r, "#5f8a3f") : ""),
      css: KF.drift2(`${ID}-d`, 11, 15) + KF.pulse(`${ID}-pulse`) + KF.sway(`${ID}-sway`)
         + KF.drift(`${ID}-drift`, 34, 26, 17),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     3. 苔藓 · 雨后湿润（中深底 / 点彩质感 / 动态雨痕）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-moss", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "苔藓 · 雨后湿润", swatch: "#3f5c2c", pageBg: "#1b2618",
      vars: {
        "--bd-bg": "#b6cd9d", "--bd-line": "#3f5c2c", "--bd-line2": "#8aa870",
        "--bd-star": "#2c4420", "--bd-frame": "#4e7038",
        "--st-black": "#182c12", "--st-white": "#e6f0d4",
        "--ui-accent": "#46662f", "--ui-bg": "#e9f1dd", "--ui-ink": "#1f2e17",
        "--ui-muted": "#5f7350", "--ui-line": "#b8caa2", "--bd-radius": "18px",
      },
      defs: `
        <radialGradient id="${P("bg")}" cx="30%" cy="22%" r="78%">
          <stop offset="0" stop-color="#cfe2b5"/><stop offset=".5" stop-color="#b3ca98"/>
          <stop offset="1" stop-color="#93ad78"/>
        </radialGradient>
        <pattern id="${P("moss")}" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="2.3" fill="#5d7f42" opacity=".22"/>
          <circle cx="11" cy="9" r="1.7" fill="#456630" opacity=".2"/>
          <circle cx="15" cy="15" r="2.6" fill="#6d9150" opacity=".18"/>
          <circle cx="7" cy="15" r="1.3" fill="#3a5a28" opacity=".2"/>
          <circle cx="16" cy="3" r="1.2" fill="#7ba25c" opacity=".22"/>
        </pattern>
        <pattern id="${P("vein")}" width="72" height="72" patternUnits="userSpaceOnUse">
          <g transform="translate(2,2) scale(1.7)">${leafVeins("#67874a", "#7d9e5e", 1.5, .85, .3)}</g>
          <g transform="translate(-32,40) scale(1.7)">${leafVeins("#6f8f50", "#86a665", 1.3, .8, .26)}</g>
        </pattern>
        <pattern id="${P("rain")}" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
          <path d="M6 -20V60" stroke="#eef7e2" stroke-width="1.1" opacity=".16"/>
          <path d="M22 -20V60" stroke="#eef7e2" stroke-width=".7" opacity=".11"/>
          <path d="M34 -20V60" stroke="#fff" stroke-width=".9" opacity=".13"/>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#f6ffe6" stop-opacity=".5"/><stop offset="1" stop-color="#f6ffe6" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#3a5530"/><stop offset=".3" stop-color="#26401f"/>
          <stop offset=".7" stop-color="#152511"/><stop offset="1" stop-color="#0d1a0b"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="62%">
          <stop offset="0" stop-color="#684a28"/><stop offset="1" stop-color="#2a3a19" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#fbfff4"/><stop offset=".44" stop-color="#e3efd0"/>
          <stop offset=".78" stop-color="#c2d8a4"/><stop offset="1" stop-color="#9bb87c"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d3e5b8" stop-opacity="0"/><stop offset="1" stop-color="#8dae68" stop-opacity=".52"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("moss")})"/>
        <rect class="gd-flow" x="-60" y="0" width="800" height="620" fill="url(#${P("rain")})" pointer-events="none"/>
        <rect class="gd-sun" x="-120" y="-130" width="640" height="640" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#3f5c2c", lineW: 1.15, lineOpacity: .5,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#2c4420" stroke-width="2" opacity=".45"/>`,
      starFill: "#2c4420", starR: 3.5,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#7d5a30", edge: "#0a1708" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .82, rim: "#79975a", edge: "#8aa568" }))
      + (isLast ? pulse(x, y, r, "#e4ffc4") : ""),
      css: KF.flow(`${ID}-flow`, 9, 40) + KF.pulse(`${ID}-pulse`) + KF.drift(`${ID}-drift`, 30, 22, 13),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     4. 藤蔓 · 逆光边缘（深底 / 装饰线条 / 静态）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-ivy", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "藤蔓 · 逆光边缘", swatch: "#4a6b34", pageBg: "#111a0f",
      vars: {
        "--bd-bg": "#8fae72", "--bd-line": "#2e4a24", "--bd-line2": "#a8c489",
        "--bd-star": "#22381a", "--bd-frame": "#b9d69c",
        "--st-black": "#122110", "--st-white": "#f2f8e6",
        "--ui-accent": "#5d8a42", "--ui-bg": "#eaf2de", "--ui-ink": "#1c2a15",
        "--ui-muted": "#5b6f4c", "--ui-line": "#b4c69e", "--bd-radius": "14px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".9" y2="1">
          <stop offset="0" stop-color="#a3c084"/><stop offset=".5" stop-color="#8aa96c"/>
          <stop offset="1" stop-color="#6f8f56"/>
        </linearGradient>
        <pattern id="${P("ivy")}" width="78" height="78" patternUnits="userSpaceOnUse">
          <path d="M-6 34C16 18 38 50 84 30" fill="none" stroke="#5c7b42" stroke-width="2.2" opacity=".28"/>
          <path d="M14 88C32 62 52 66 70 40" fill="none" stroke="#54703c" stroke-width="1.7" opacity=".24"/>
          <g transform="translate(20,16) rotate(-24) scale(1.15)">${leafVeins("#5f7f44", "#7a9a5c", 1.7, .9, .36)}</g>
          <g transform="translate(58,52) rotate(140) scale(1.05)">${leafVeins("#68884c", "#84a464", 1.6, .85, .32)}</g>
          <g transform="translate(-6,60) rotate(58) scale(.95)">${leafVeins("#587641", "#75955a", 1.6, .85, .28)}</g>
        </pattern>
        <pattern id="${P("rim")}" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M-8 24C12 8 34 40 68 18" fill="none" stroke="#fffbe0" stroke-width="1.6" opacity=".3"/>
          <path d="M-8 52C10 38 30 66 68 46" fill="none" stroke="#fff8d4" stroke-width="1.1" opacity=".2"/>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fff4c8" stop-opacity=".66"/>
          <stop offset=".55" stop-color="#ffeeb4" stop-opacity=".2"/>
          <stop offset="1" stop-color="#ffeeb4" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#31502a"/><stop offset=".3" stop-color="#1e3618"/>
          <stop offset=".7" stop-color="#0f1e0c"/><stop offset="1" stop-color="#08130a"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="60%">
          <stop offset="0" stop-color="#5e4423"/><stop offset="1" stop-color="#233414" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#eef6de"/>
          <stop offset=".78" stop-color="#cfe3ae"/><stop offset="1" stop-color="#a2bf7c"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d8e9bb" stop-opacity="0"/><stop offset="1" stop-color="#8fb068" stop-opacity=".5"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("ivy")})"/>
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("rim")})" opacity=".85"/>
        <rect x="-140" y="-150" width="640" height="640" rx="14" fill="url(#${P("sun")})" pointer-events="none"/>
        <rect x="1.5" y="1.5" width="617" height="617" rx="13" fill="none" stroke="#e6f7cc" stroke-width="2" opacity=".22"/>`,
      lineStroke: "#2e4a24", lineW: 1.2, lineOpacity: .58,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#24401c" stroke-width="2.4" opacity=".5"/>`,
      starFill: "#22381a", starR: 3.5,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#7a5830", edge: "#060f06" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .8, rim: "#7d9c5e", edge: "#8ba968" }))
      + (isLast ? pulse(x, y, r, "#fff2c4") : ""),
      css: KF.pulse(`${ID}-pulse`),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     5. 荷叶 · 正午水面（浅底 / 水彩晕染 / 动态涟漪）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-lotus", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "荷叶 · 正午水面", swatch: "#5d8f56", pageBg: "#22301f",
      vars: {
        "--bd-bg": "#e4f2e2", "--bd-line": "#4d7a51", "--bd-line2": "#a9cfae",
        "--bd-star": "#35663d", "--bd-frame": "#8fbf95",
        "--st-black": "#22402a", "--st-white": "#f3fbf2",
        "--ui-accent": "#3f7a4a", "--ui-bg": "#f0f8f0", "--ui-ink": "#1d3322",
        "--ui-muted": "#5c7a62", "--ui-line": "#c6dcc8", "--bd-radius": "20px",
      },
      defs: `
        <radialGradient id="${P("bg")}" cx="34%" cy="26%" r="82%">
          <stop offset="0" stop-color="#f2fbf1"/><stop offset=".5" stop-color="#dcefdd"/>
          <stop offset="1" stop-color="#bcdcc0"/>
        </radialGradient>
        <pattern id="${P("pad")}" width="112" height="112" patternUnits="userSpaceOnUse">
          <circle cx="56" cy="56" r="50" fill="none" stroke="#7fae83" stroke-width="1" opacity=".3"/>
          <circle cx="56" cy="56" r="44" fill="#a9cfae" opacity=".13"/>
          <path d="M56 6V106M6 56H106M20 20L92 92M92 20L20 92" stroke="#87b78c" stroke-width=".55" opacity=".22"/>
          <circle cx="56" cy="56" r="5" fill="#6fa074" opacity=".22"/>
        </pattern>
        <pattern id="${P("vein")}" width="66" height="66" patternUnits="userSpaceOnUse">
          <g transform="translate(3,3) scale(1.6)">${leafVeins("#6b9c6e", "#84b587", 1.5, .85, .3)}</g>
          <g transform="translate(-28,36) scale(1.6)">${leafVeins("#74a577", "#8dbd91", 1.3, .8, .25)}</g>
        </pattern>
        <pattern id="${P("ripple")}" width="120" height="120" patternUnits="userSpaceOnUse">
          <ellipse cx="30" cy="30" rx="26" ry="12" fill="none" stroke="#fff" stroke-width="1.3" opacity=".3"/>
          <ellipse cx="30" cy="30" rx="15" ry="7" fill="none" stroke="#fff" stroke-width=".9" opacity=".24"/>
          <ellipse cx="90" cy="84" rx="24" ry="11" fill="none" stroke="#fff" stroke-width="1.1" opacity=".26"/>
          <ellipse cx="90" cy="84" rx="11" ry="5" fill="none" stroke="#fff" stroke-width=".8" opacity=".2"/>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".62"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#3f6040"/><stop offset=".3" stop-color="#28482d"/>
          <stop offset=".7" stop-color="#17301c"/><stop offset="1" stop-color="#0f2013"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="62%">
          <stop offset="0" stop-color="#6a5028"/><stop offset="1" stop-color="#2b3f21" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#eef8ee"/>
          <stop offset=".78" stop-color="#cde5cf"/><stop offset="1" stop-color="#a6c9ab"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#dbeddd" stop-opacity="0"/><stop offset="1" stop-color="#8fbd97" stop-opacity=".5"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("pad")})"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("vein")})" opacity=".9"/>
        <rect class="gd-flow" x="-60" y="0" width="760" height="620" fill="url(#${P("ripple")})" pointer-events="none"/>
        <rect class="gd-sun" x="-130" y="-140" width="660" height="660" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#4d7a51", lineW: 1.05, lineOpacity: .46,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#35663d" stroke-width="2" opacity=".4"/>`,
      starFill: "#35663d", starR: 3.4,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#87653a", edge: "#0b1a0e" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .82, rim: "#7fa87e", edge: "#8fb896" }))
      + (isLast ? pulse(x, y, r, "#e8ffea") : ""),
      css: KF.flow(`${ID}-flow`, 13, 60) + KF.drift(`${ID}-drift`, 38, 30, 16) + KF.pulse(`${ID}-pulse`),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     6. 松针 · 阴天柔光（墨绿深底 / 细密短线 / 静态）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-pine", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "松针 · 阴天柔光", swatch: "#37552f", pageBg: "#0f1a10",
      vars: {
        "--bd-bg": "#54704a", "--bd-line": "#c3d6ae", "--bd-line2": "#7d9a6c",
        "--bd-star": "#e0ecd2", "--bd-frame": "#89a67a",
        "--st-black": "#16281a", "--st-white": "#f4f8ee",
        "--ui-accent": "#456b45", "--ui-bg": "#e8efe0", "--ui-ink": "#1b2a1d",
        "--ui-muted": "#5f7562", "--ui-line": "#adc0a4", "--bd-radius": "10px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#5d7b52"/><stop offset=".5" stop-color="#4e6a45"/>
          <stop offset="1" stop-color="#3c5636"/>
        </linearGradient>
        <pattern id="${P("needle")}" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 32H64" stroke="#2f4a2a" stroke-width="1.4" opacity=".3"/>
          <path d="M4 32L24 8M12 32L30 10M20 32L36 12M28 32L42 14M36 32L46 16M44 32L50 18M52 32L54 20"
                stroke="#819c6f" stroke-width="1.1" opacity=".42" stroke-linecap="round"/>
          <path d="M10 32L26 50M18 32L32 52M26 32L38 54M34 32L44 56M42 32L48 58M50 32L52 60"
                stroke="#6d8a5f" stroke-width="1" opacity=".34" stroke-linecap="round"/>
          <circle cx="20" cy="16" r="1.5" fill="#9ab387" opacity=".4"/>
          <circle cx="46" cy="46" r="1.3" fill="#89a477" opacity=".36"/>
        </pattern>
        <pattern id="${P("vein")}" width="86" height="86" patternUnits="userSpaceOnUse">
          <g transform="translate(4,4) scale(2)">${leafVeins("#3d5c37", "#4e7046", 1.6, .9, .34)}</g>
          <g transform="translate(-40,44) scale(2)">${leafVeins("#456440", "#577a4e", 1.4, .85, .28)}</g>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#eef6e4" stop-opacity=".34"/><stop offset="1" stop-color="#eef6e4" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#2c4a32"/><stop offset=".3" stop-color="#1a3020"/>
          <stop offset=".7" stop-color="#0d1c11"/><stop offset="1" stop-color="#07110a"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="60%">
          <stop offset="0" stop-color="#57421f"/><stop offset="1" stop-color="#20301a" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#f1f6ea"/>
          <stop offset=".78" stop-color="#d6e2c8"/><stop offset="1" stop-color="#adbe9d"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#dbe6cb" stop-opacity="0"/><stop offset="1" stop-color="#93a883" stop-opacity=".45"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("needle")})" opacity=".85"/>
        <rect class="${P("sunspot")}" x="-120" y="-130" width="640" height="640" rx="10" fill="url(#${P("sun")})" pointer-events="none"/>
        <rect x="0" y="0" width="620" height="620" rx="10" fill="none" stroke="#22381f" stroke-width="6" opacity=".34"/>`,
      lineStroke: "#c3d6ae", lineW: 1.15, lineOpacity: .62,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#e2eed4" stroke-width="1.8" opacity=".3"/>`,
      starFill: "#e0ecd2", starR: 3.6, starOpacity: .85,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#7a5c32", edge: "#050e07" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .7, rim: "#849e72", edge: "#93a686" }))
      + (isLast ? pulse(x, y, r, "#f2ffe0") : ""),
      css: "",
      /* 阴天不是没有光，是光走得很慢：整块柔光斑在盘面上缓慢游。
         （配方表里还提过"松针层极缓摇摆"—— 松针是 pattern 平铺，转/摆会让整张
           针叶一起错位，读起来像纸在动而不是树在动，所以只做光斑。） */
      boardMotions: [{
        id: "bmo-verdant-pine",
        name: "阴天光斑缓移",
        desc: "一层柔光在松针上缓慢游走，像云影过林",
        css: () => `
  @keyframes ${ID}-drift{
    0%  {transform:translate(0,0) scale(1)}
    50% {transform:translate(34px,26px) scale(1.05)}
    100%{transform:translate(0,0) scale(1)}
  }
  #board .${P("sunspot")}{animation:${ID}-drift 22s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  ${RM(`#board .${P("sunspot")}`)}
`,
      }],
      /* 当前手的柔光脉冲（常驻 infinite），从原 css 原样搬过来 */
      stoneMotions: [{
        id: "smo-verdant-pine",
        name: "当前手柔光脉冲",
        desc: "最后一手底下那团光一明一暗（常驻）",
        css: () => KF.pulse(`${ID}-pulse`) + `
  ${RM("#board #stones circle.gd-pulse")}`,
      }],
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     7. 麦田 · 黄昏侧光（暖浅底 / 麦芒短线 / 动态麦浪）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-wheat", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "麦田 · 黄昏侧光", swatch: "#a8b95c", pageBg: "#2b2a1a",
      vars: {
        "--bd-bg": "#f6f2d8", "--bd-line": "#77803c", "--bd-line2": "#c8cd94",
        "--bd-star": "#5c6528", "--bd-frame": "#c2c47a",
        "--st-black": "#33401d", "--st-white": "#fdfbe8",
        "--ui-accent": "#7d8a36", "--ui-bg": "#faf7e2", "--ui-ink": "#2f3318",
        "--ui-muted": "#79794f", "--ui-line": "#dedcb4", "--bd-radius": "14px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".9" y2="1">
          <stop offset="0" stop-color="#fdfbe4"/><stop offset=".45" stop-color="#f2f0cf"/>
          <stop offset="1" stop-color="#dfe2b0"/>
        </linearGradient>
        <pattern id="${P("ear")}" width="46" height="96" patternUnits="userSpaceOnUse">
          <path d="M10 96C8 66 12 40 20 12" fill="none" stroke="#7e8a3a" stroke-width="2" opacity=".3"/>
          <path d="M20 12C16 20 14 28 14 36M20 12C25 20 27 28 26 36M17 26C13 34 12 40 13 46M23 26C28 32 30 38 29 44"
                fill="none" stroke="#98a44e" stroke-width="1.2" opacity=".34"/>
          <path d="M20 12L14 8M20 12L26 8M14 22L7 20M26 22L33 20" stroke="#b4bd6c" stroke-width=".8" opacity=".34"/>
          <path d="M32 96C34 74 32 54 26 38" fill="none" stroke="#8b9646" stroke-width="1.3" opacity=".22"/>
          <path d="M4 96C2 80 4 66 10 52" fill="none" stroke="#a6b05f" stroke-width="1" opacity=".2"/>
        </pattern>
        <pattern id="${P("vein")}" width="78" height="78" patternUnits="userSpaceOnUse">
          <g transform="translate(2,2) scale(1.7)">${leafVeins("#8f9a4e", "#a7b168", 1.4, .8, .24)}</g>
          <g transform="translate(-34,40) scale(1.7)">${leafVeins("#99a456", "#b0ba72", 1.2, .75, .19)}</g>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fff2c0" stop-opacity=".66"/>
          <stop offset=".5" stop-color="#ffe9a4" stop-opacity=".22"/>
          <stop offset="1" stop-color="#ffe9a4" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#54622f"/><stop offset=".3" stop-color="#3b4a22"/>
          <stop offset=".7" stop-color="#26341a"/><stop offset="1" stop-color="#1a2512"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="62%">
          <stop offset="0" stop-color="#84622d"/><stop offset="1" stop-color="#3b4520" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#fdfcec"/>
          <stop offset=".78" stop-color="#eae7c0"/><stop offset="1" stop-color="#c9cb95"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#eeebc6" stop-opacity="0"/><stop offset="1" stop-color="#b7ba7c" stop-opacity=".45"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("ear")})" opacity=".95"/>
        <rect class="gd-sun" x="150" y="-160" width="620" height="620" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#77803c", lineW: 1.1, lineOpacity: .48,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#5c6528" stroke-width="2.1" opacity=".42"/>`,
      starFill: "#5c6528", starR: 3.4,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .34) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#9a7430", edge: "#141c0d" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .78, rim: "#7d8547", edge: "#a2a566" }))
      + (isLast ? pulse(x, y, r, "#fff6cc") : "")
      + (isLast ? swayTicks(x, y, r, "#94a04c") : ""),
      css: KF.drift(`${ID}-drift`, -42, 24, 12, KF.pulse(`${ID}-pulse`) + KF.sway(`${ID}-sway`)),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     8. 三叶草 · 斑驳树荫（中浅底 / 几何色块 / 动态树影）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-clover", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "三叶草 · 斑驳树荫", swatch: "#5f9445", pageBg: "#1e2a1a",
      vars: {
        "--bd-bg": "#e6f2d8", "--bd-line": "#5b8046", "--bd-line2": "#b6ce9e",
        "--bd-star": "#3f6132", "--bd-frame": "#8fb173",
        "--st-black": "#26401f", "--st-white": "#f6fbe9",
        "--ui-accent": "#54853e", "--ui-bg": "#f2f8e8", "--ui-ink": "#22331a",
        "--ui-muted": "#657a55", "--ui-line": "#cadcba", "--bd-radius": "16px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#f2f9e6"/><stop offset=".5" stop-color="#e2efd0"/>
          <stop offset="1" stop-color="#cadfb4"/>
        </linearGradient>
        <pattern id="${P("clover")}" width="96" height="96" patternUnits="userSpaceOnUse">
          <!-- 三叶草：三片心形小叶，用真实叶脉收边，避免变成「儿童风车」 -->
          ${[0, 120, 240].map((a, i) =>
            `<g transform="translate(46,44) rotate(${a}) scale(.86)">
               <path d="M0 0C-13 -3 -17 -13 -12 -21C-7 -29 3 -25 4 -14C5 -3 4 -1 0 0Z"
                     fill="${["#86b164", "#7aa858", "#93bc70"][i]}" opacity=".26"/>
               <path d="M0 0C-8 -6 -12 -14 -12 -21" fill="none" stroke="#5f8a3f" stroke-width=".9" opacity=".3"/>
               <path d="M-3 -12L-10 -14M-4 -18L-10 -21" fill="none" stroke="#5f8a3f" stroke-width=".7" opacity=".26"/>
             </g>`).join("")}
          <path d="M46 44V88" stroke="#6d9448" stroke-width="1.5" opacity=".28"/>
          <circle cx="46" cy="44" r="2.4" fill="#5f8a3f" opacity=".3"/>
          <g transform="translate(4,84) scale(.6)"><path d="M0 0C-13 -3 -17 -13 -12 -21C-7 -29 3 -25 4 -14C5 -3 4 -1 0 0Z" fill="#8bb469" opacity=".18" transform="rotate(-34)"/></g>
        </pattern>
        <pattern id="${P("vein")}" width="70" height="70" patternUnits="userSpaceOnUse">
          <g transform="translate(2,2) scale(1.65)">${leafVeins("#6d9448", "#86ac62", 1.5, .85, .3)}</g>
          <g transform="translate(-30,36) scale(1.65)">${leafVeins("#77a052", "#8fb76c", 1.3, .8, .25)}</g>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fbfff0" stop-opacity=".6"/><stop offset="1" stop-color="#fbfff0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#4a6436"/><stop offset=".3" stop-color="#33512a"/>
          <stop offset=".7" stop-color="#1f3819"/><stop offset="1" stop-color="#14250f"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="62%">
          <stop offset="0" stop-color="#6f4f26"/><stop offset="1" stop-color="#2b3d1c" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#f2f9e6"/>
          <stop offset=".78" stop-color="#d8eac0"/><stop offset="1" stop-color="#b0cc92"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e0f0ca" stop-opacity="0"/><stop offset="1" stop-color="#9cc079" stop-opacity=".5"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("clover")})"/>
        <rect class="gd-sun" x="-140" y="-150" width="680" height="680" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#5b8046", lineW: 1.1, lineOpacity: .5,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#3f6132" stroke-width="2.2" opacity=".45"/>`,
      starFill: "#3f6132", starR: 3.4,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#876038", edge: "#101d0c" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .82, rim: "#6b8f4d", edge: "#93b074" }))
      + (isLast ? pulse(x, y, r, "#f4ffdc") : "")
      + (isLast ? swayTicks(x, y, r, "#6d9448") : ""),
      css: KF.drift(`${ID}-drift`, 52, -30, 13, KF.pulse(`${ID}-pulse`) + KF.sway(`${ID}-sway`)),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     9. 地衣 · 林下幽光（极深底 / 版画刻痕 / 动态幽光呼吸）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-lichen", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "地衣 · 林下幽光", swatch: "#2c4a34", pageBg: "#0b120d",
      vars: {
        "--bd-bg": "#3a5540", "--bd-line": "#b8d4b4", "--bd-line2": "#5e7d63",
        "--bd-star": "#d6ecce", "--bd-frame": "#6b8f6e",
        "--st-black": "#0d1c13", "--st-white": "#f2f8ee",
        "--ui-accent": "#3e6a4a", "--ui-bg": "#e7efe4", "--ui-ink": "#182219",
        "--ui-muted": "#5c6f5e", "--ui-line": "#a8bca6", "--bd-radius": "8px",
      },
      defs: `
        <radialGradient id="${P("bg")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#48624c"/><stop offset=".5" stop-color="#3a5540"/>
          <stop offset="1" stop-color="#2a4030"/>
        </radialGradient>
        <pattern id="${P("etch")}" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M3 5H27M3 11H27M3 17H27M3 23H27M3 29H27" stroke="#22381f" stroke-width="1.2" opacity=".19"/>
          <path d="M6 3V29M12 3V29M18 3V29M24 3V29" stroke="#22381f" stroke-width=".75" opacity=".11"/>
          <circle cx="8" cy="8" r="2.2" fill="#1a2c18" opacity=".23"/>
          <circle cx="23" cy="20" r="2.8" fill="#1a2c18" opacity=".19"/>
          <circle cx="14" cy="26" r="1.5" fill="#16240f" opacity=".23"/>
        </pattern>
        <pattern id="${P("haz")}" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M24 4V44M4 24H44M10 10L38 38M38 10L10 38" stroke="#bfe0b0" stroke-width=".8" opacity=".3"/>
          <circle cx="24" cy="24" r="4" fill="#cdeec0" opacity=".2"/>
          <circle cx="24" cy="24" r="10" fill="none" stroke="#cdeec0" stroke-width=".6" opacity=".16"/>
        </pattern>
        <pattern id="${P("vein")}" width="92" height="92" patternUnits="userSpaceOnUse">
          <g transform="translate(4,4) scale(2.1)">${leafVeins("#1e3220", "#2a4229", 1.8, 1, .42)}</g>
          <g transform="translate(-42,46) scale(2.1)">${leafVeins("#243a26", "#314b2e", 1.6, .95, .34)}</g>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#d8f2c4" stop-opacity=".46"/>
          <stop offset=".5" stop-color="#c2e6ac" stop-opacity=".16"/>
          <stop offset="1" stop-color="#c2e6ac" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#2a4632"/><stop offset=".3" stop-color="#152a1c"/>
          <stop offset=".7" stop-color="#0a1710"/><stop offset="1" stop-color="#050d09"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="58%">
          <stop offset="0" stop-color="#5c4620"/><stop offset="1" stop-color="#1a2a18" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".44" stop-color="#eef6ea"/>
          <stop offset=".78" stop-color="#cdddc8"/><stop offset="1" stop-color="#a0b89e"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d8e8d2" stop-opacity="0"/><stop offset="1" stop-color="#87a486" stop-opacity=".45"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="8" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="8" fill="url(#${P("etch")})"/>
        <rect x="0" y="0" width="620" height="620" rx="8" fill="url(#${P("haz")})" opacity=".5"/>
        <rect class="gd-sun" x="-130" y="-140" width="660" height="660" fill="url(#${P("sun")})" pointer-events="none"/>
        <rect x="0" y="0" width="620" height="620" rx="8" fill="none" stroke="#0a140c" stroke-width="7" opacity=".4"/>`,
      lineStroke: "#b8d4b4", lineW: 1.1, lineOpacity: .55,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#d8eecd" stroke-width="1.7" opacity=".3"/>`,
      starFill: "#d6ecce", starR: 3.5, starOpacity: .8,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .34) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#6f5426", edge: "#030a06" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .7, rim: "#7d9679", edge: "#8ba389" }))
      + (isLast ? pulse(x, y, r, "#e2ffd4") : ""),
      css: KF.drift(`${ID}-drift`, 34, 26, 19) + KF.pulse(`${ID}-pulse`),
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════
     10. 嫩芽 · 温室漫射（极浅底 / 水彩细勾 / 静态）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "verdant-sprout", P = (n) => `${ID}-${n}`;
    SKINS.push({
      id: ID, name: "嫩芽 · 温室漫射", swatch: "#8fc46a", pageBg: "#2c3a28",
      vars: {
        "--bd-bg": "#f7fcf1", "--bd-line": "#7ea662", "--bd-line2": "#cfe4bc",
        "--bd-star": "#5f8a44", "--bd-frame": "#a9cd8c",
        "--st-black": "#2c4a24", "--st-white": "#fefff9",
        "--ui-accent": "#6aa348", "--ui-bg": "#f9fdf4", "--ui-ink": "#2a3823",
        "--ui-muted": "#71866a", "--ui-line": "#d8e6cc", "--bd-radius": "20px",
      },
      defs: `
        <linearGradient id="${P("bg")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#fdfff8"/><stop offset=".5" stop-color="#f5fbea"/>
          <stop offset="1" stop-color="#e6f2d6"/>
        </linearGradient>
        <pattern id="${P("sprout")}" width="112" height="112" patternUnits="userSpaceOnUse">
          <path d="M56 100V56" stroke="#8db76a" stroke-width="2" opacity=".3"/>
          <path d="M56 56C50 40 36 32 20 34" fill="none" stroke="#93bd70" stroke-width="1.6" opacity=".26"/>
          <path d="M56 56C62 40 76 32 92 34" fill="none" stroke="#9cc479" stroke-width="1.6" opacity=".26"/>
          <g transform="translate(20,28) scale(1.05)"><path d="${LEAF_OUTLINE}" fill="#9fca78" opacity=".26"/></g>
          <g transform="translate(74,28) scale(1.05)"><path d="${LEAF_OUTLINE}" fill="#95c26e" opacity=".24" transform="translate(40,0) scale(-1,1)"/></g>
          <path d="M56 56C54 76 48 90 40 100M56 56C60 76 66 88 74 98" fill="none" stroke="#8ab866" stroke-width="1" opacity=".2"/>
        </pattern>
        <pattern id="${P("vein")}" width="46" height="46" patternUnits="userSpaceOnUse">
          <g transform="translate(1,1) scale(1.15)">${leafVeins("#6f9c4c", "#87b262", 1.6, .95, .52)}</g>
          <g transform="translate(-19,24) scale(1.15)">${leafVeins("#7ba757", "#93bd6e", 1.4, .9, .44)}</g>
        </pattern>
        <radialGradient id="${P("sun")}" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".7"/>
          <stop offset=".5" stop-color="#f6ffe8" stop-opacity=".26"/>
          <stop offset="1" stop-color="#f6ffe8" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bl")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#4e6c3c"/><stop offset=".3" stop-color="#38542c"/>
          <stop offset=".7" stop-color="#243c1d"/><stop offset="1" stop-color="#182a13"/>
        </radialGradient>
        <radialGradient id="${P("blIn")}" cx="30%" cy="26%" r="62%">
          <stop offset="0" stop-color="#7a5c30"/><stop offset="1" stop-color="#33461f" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("wh")}" cx="33%" cy="27%" r="76%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#fbfff4"/>
          <stop offset=".82" stop-color="#e2f0d0"/><stop offset="1" stop-color="#c2dcaa"/>
        </radialGradient>
        <linearGradient id="${P("whIn")}" x1=".1" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#eaf6dc" stop-opacity="0"/><stop offset="1" stop-color="#a4c985" stop-opacity=".42"/>
        </linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("vein")})"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("sprout")})" opacity=".95"/>
        <rect x="-140" y="-150" width="680" height="680" rx="20" fill="url(#${P("sun")})" pointer-events="none"/>`,
      lineStroke: "#7ea662", lineW: 1, lineOpacity: .42,
      gridExtra: `<path d="M46 46H574M46 574H574M46 46V574M574 46V574" fill="none" stroke="#5f8a44" stroke-width="1.9" opacity=".38"/>`,
      starFill: "#5f8a44", starR: 3.3,
      stone: ({ x, y, r, player, isLast, isWin }) =>
        (isWin ? glow(x, y, r, "#ffe9a0", .3) : "")
      + (player === 1 ? darkFruit(x, y, r, { bg: P("bl"), seed: P("blIn"), hl: "#8d6a36", edge: "#132310" })
                      : leafBall(x, y, r, { bg: P("wh"), sheen: P("whIn"), sheenOp: .8, rim: "#7a9f57", edge: "#a3c489" }))
      + (isLast ? pulse(x, y, r, "#f6ffea") : ""),
      css: KF.pulse(`${ID}-pulse`),
    });
  })();
})();
