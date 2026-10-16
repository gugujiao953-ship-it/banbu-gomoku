/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   蓝调 10 版。结构见 skins/_TEMPLATE.js。

   被认可的做法（用户原话「蓝调其实还不错」），10 版都保留这套底层思路：
     · 棋盘底 = 两团错开的柔光（左上冷光 + 右下暗沉），暗底绝不填成一块纯色
     · 网格压到 ~46% 不抢戏（亮调版略高一点，否则线在浅底上消失）
     · 黑子 = 被冷光照到的深蓝，而不是纯黑；高光偏冷、暗部偏蓝紫
     · 白子 = 4 段渐变 + 一枚锐利小高光点，做「釉」的质感
   10 版在这个骨架上换材质 / 换光位 / 换网格 / 换明度：
     1 blue-nocturne   夜曲·绸缎     暗调  单侧左上冷光，缎面斜向高光带
     2 blue-velvet     丝绒·午夜     暗调  双光斑交错，天鹅绒吸光绒面
     3 blue-rain       雨夜玻璃      暗调  顶部聚光，玻璃雨痕 + 水珠
     4 blue-abyss      深海·光柱     暗调  水下光柱缓慢摇曳（动效）
     5 blue-sapphire   蓝宝石·切面   中调  宝石台面 + 切面反光
     6 blue-midnight   午夜天幕      极暗  星空 + 微光带缓慢漂移（动效）
     7 blue-enamel     珐琅·青花      中亮  珐琅釉面 + 通草蓝叠色
     8 blue-rimlight   边缘光·夜航   暗调  四角边缘光（rim light）呼吸（动效）
     9 blue-glacier    冰川·晨光      亮调  亮冰蓝，双高光斑错位
    10 blue-frost     霜白·冰棱      最亮  近白冰蓝，冷色格纹 + 交点亮点

   命名全部带 blue- 前缀；所有 defs id 再加皮肤自身前缀（P()），
   8 个皮肤文件同文档加载，id 一撞就串味。
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  /* ── 公共工具 ─────────────────────────────────────────────────────────
     stoneSVG：所有蓝调版本共用同一套「棋子体」构造。
       black: 4 段冷光渐变（冷高光 → 深蓝 → 蓝紫暗部） + 釉面高光点 + 底部反光
       white: 4 段白釉渐变 + 锐利小高光点 + 冷色暗边 + 落影
       isLast: 一枚冷色脉冲光环（CSS 驱动，静态截图里也看得见）
     传入的 x / y / r 一定用上，不写死坐标。 */
  const stoneSVG = ({ x, y, r, player, isLast, cfg }) => {
    const c = cfg;
    const id = c.prefix;
    const fill = player === 1 ? `url(#${id}Black)` : `url(#${id}White)`;
    let s = "";

    // 落影：让棋子「坐」在棋盘上而不是浮着
    s += `<ellipse cx="${x}" cy="${y + r * 0.2}" rx="${r * 0.98}" ry="${r * 0.92}" fill="#000" opacity="${c.shadowOpacity}"/>`;

    // 体
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

    if (player === 1) {
      // 冷光边缘：左上受光、右下压暗，黑子才不是一块死黑
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.blackEdge}" stroke-width="${c.edgeW}"/>`;
      // 釉面高光：一枚锐利的冷白小点（这是「被冷光照到」的关键）
      s += `<ellipse cx="${x - r * 0.34}" cy="${y - r * 0.38}" rx="${r * 0.30}" ry="${r * 0.19}" fill="${c.blackGlaze}" opacity="${c.blackGlazeOpacity}" transform="rotate(-32 ${x - r * 0.34} ${y - r * 0.38})"/>`;
      // 底部微弱反光，交代厚度
      s += `<ellipse cx="${x + r * 0.12}" cy="${y + r * 0.52}" rx="${r * 0.42}" ry="${r * 0.16}" fill="${c.blackBounce}" opacity="${c.blackBounceOpacity}"/>`;
    } else {
      // 白釉：锐利小高光点 + 冷色暗边
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.whiteEdge}" stroke-width="${c.edgeW}"/>`;
      s += `<ellipse cx="${x - r * 0.33}" cy="${y - r * 0.36}" rx="${r * 0.26}" ry="${r * 0.17}" fill="#ffffff" opacity="${c.whiteGlazeOpacity}" transform="rotate(-32 ${x - r * 0.33} ${y - r * 0.36})"/>`;
      // 前下方一圈冷色散射，釉面才不干
      s += `<ellipse cx="${x + r * 0.16}" cy="${y + r * 0.46}" rx="${r * 0.40}" ry="${r * 0.20}" fill="${c.whiteBounce}" opacity="${c.whiteBounceOpacity}"/>`;
    }

    // 当前手：冷色脉冲光环（动画，幅度够大才看得见）
    if (isLast) {
      s += `<circle class="${c.lastClass}" cx="${x}" cy="${y}" r="${r + 2.5}" fill="none" stroke="${c.lastRing}" stroke-width="1.8" opacity=".95"/>`
        + `<circle class="${c.lastClass}" cx="${x}" cy="${y}" r="${r + 6}" fill="none" stroke="${c.lastRing}" stroke-width="1" opacity=".45"/>`;
    }
    return s;
  };

  /* ── 公共 CSS：当前手脉冲环 + 落子回弹 ────────────────────────────────
     每个皮肤用自己前缀命名 class，选择器写成
       #board .<id>-last  → 让「最后一手」的光环真的动起来。
     棋子组 #board #stones > circle 也挂一个极轻的落子回弹（新棋子进 DOM 时触发）。
     ⚠ 实测：`#stones > circle` 这条**早就命不中了** —— 零件化之后每颗子外面
        套了一层 `<g data-cell>`（见 playable.html 的 stoneHtml），circle 不再是
        #stones 的直接子元素。所以蓝调的「落子回弹」其实一直没生效，
        只有古风的 `#stones circle`（后代选择器）在动。
        这里**没有**顺手改成 `circle` 去救活它：那等于给蓝调凭空加一层回弹，
        而且会和「棋子进场」方案抢同一个 transform。要真做整体回弹，
        应该挂在 g 外壳上并想清楚和进场方案的关系 —— 留给用户决定。 */
  const KF = (ID) => `
@keyframes ${ID}-lastPulse{
  0%  {transform:scale(.90);opacity:.95}
  55% {transform:scale(1.30);opacity:.30}
  100%{transform:scale(1.48);opacity:0}
}
@keyframes ${ID}-settle{
  0%  {transform:scale(.74)}
  62% {transform:scale(1.05)}
  100%{transform:scale(1)}
}
#board .${ID}-last{transform-box:fill-box;transform-origin:center;animation:${ID}-lastPulse 2.3s ease-out infinite}
#board #stones > circle{transform-box:fill-box;transform-origin:center;animation:${ID}-settle .22s cubic-bezier(.34,1.56,.64,1) both}
@media (prefers-reduced-motion:reduce){#board .${ID}-last,#board #stones > circle{animation:none}}
`;

  /* ── 造皮肤的公共骨架 ─────────────────────────────────────────────────
     make({...}) 统一生成 defs/boardFill/boardOverlay/stone/css，
     各版只描述自己「差在哪」。 */
  const make = (o) => {
    const ID = o.id;
    const P = (n) => `${ID}-${n}`;
    const cfg = Object.assign({
      prefix: P(""),
      lastClass: P("last"),
      lastRing: o.lastRing || "#cfe6ff",
      edgeW: 0.9,
      shadowOpacity: 0.34,
      blackEdge: "rgba(150,190,240,.30)",
      blackGlaze: "#dcecff",
      blackGlazeOpacity: 0.72,
      blackBounce: "#4a7fc0",
      blackBounceOpacity: 0.22,
      whiteEdge: "rgba(120,160,215,.42)",
      whiteGlazeOpacity: 0.95,
      whiteBounce: "#a8c8ec",
      whiteBounceOpacity: 0.5,
    }, o.stone || {});

    /* 会动的东西按「谁在动」分两堆（契约见 skins/_TEMPLATE.js）：
         stoneMotions ← 公共的当前手冷光环（跟着**棋子**走，可单独关）
         boardMotions ← 各版自己声明的天幕/釉光动效（跟着**棋盘**走）
       `css` 从此只放静态规则。
       ⚠ 只有传了 `boardMotion` 的版（目前 midnight / enamel，都在 KEEP 名单里）
         才把棋盘动效纳管；其余各版的 css 里若还留着动画，就仍是"常开不可关"。
         哪天把别的蓝调版加回 KEEP，记得同样搬一次。 */
    const css = o.css || "";

    SKINS.push({
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
      stoneMotions: [{
        id: `smo-${ID}-last`,
        name: "冷光当前手环",
        desc: "最后一手挂两圈冷色光环，反复胀开",
        css: () => KF(ID),
      }],
    });
  };

  /* 亮调版网格要稍微实一点，暗底压到 46% 是上一版被认可的比例 */
  const GRID_DIM = 0.46;

  /* ══════════════════════════════════════════════════════════════════════
     1 · blue-nocturne 夜曲 · 绸缎
     暗调。单侧左上冷光，缎面斜向高光带（近似 specular streak），
     网格细线低调。最「正」的一版，作为这套蓝调的基准。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-nocturne",
    name: "蓝调 · 夜曲绸缎",
    swatch: "#3f6ea8",
    pageBg: "#080f1c",

    vars: {
      "--bd-bg": "#0d1b30", "--bd-line": "#7ba6d6", "--bd-star": "#cfe4fa",
      "--st-black": "#16294a", "--st-white": "#eaf2fb", "--ui-accent": "#35619a",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"blue-nocturne-base"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#162a48"/><stop offset=".45" stop-color="#0e1f38"/>
        <stop offset="1" stop-color="#081324"/>
      </linearGradient>
      <!-- 两团错开的柔光：左上冷、右下沉 -->
      <radialGradient id="${"blue-nocturne-glowA"}" cx="24%" cy="18%" r="62%">
        <stop offset="0" stop-color="#6fa8e6" stop-opacity=".40"/>
        <stop offset=".55" stop-color="#3d6fa8" stop-opacity=".14"/>
        <stop offset="1" stop-color="#0b1a30" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-nocturne-glowB"}" cx="82%" cy="86%" r="66%">
        <stop offset="0" stop-color="#2a5a96" stop-opacity=".30"/>
        <stop offset=".6" stop-color="#12283f" stop-opacity=".10"/>
        <stop offset="1" stop-color="#060f1c" stop-opacity="0"/>
      </radialGradient>
      <!-- 绸缎：斜向的缎面光带，周期性明暗 -->
      <linearGradient id="${"blue-nocturne-satin"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".24" stop-color="#bcd8f8" stop-opacity=".16"/>
        <stop offset=".38" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".62" stop-color="#9cc4f0" stop-opacity=".11"/>
        <stop offset=".78" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <pattern id="${"blue-nocturne-weave"}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0 0V6" stroke="#8fb8e6" stroke-width=".7" opacity=".13"/>
        <path d="M0 3H6" stroke="#5d8cc4" stroke-width=".5" opacity=".07"/>
      </pattern>
      <radialGradient id="${"blue-nocturne-Black"}" cx="34%" cy="26%" r="78%">
        <stop offset="0" stop-color="#4a7cb8"/><stop offset=".26" stop-color="#22406e"/>
        <stop offset=".62" stop-color="#132a4e"/><stop offset="1" stop-color="#0a1730"/>
      </radialGradient>
      <radialGradient id="${"blue-nocturne-White"}" cx="34%" cy="26%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eaf3ff"/>
        <stop offset=".66" stop-color="#c6dcf6"/><stop offset="1" stop-color="#8fb2dc"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-nocturne-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-nocturne-glowA)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-nocturne-glowB)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-nocturne-weave)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-nocturne-satin)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#8fc0f0" stroke-width="1.1" opacity=".26"/>`,

    lineStroke: "#8fb6e0",
    lineW: 1,
    lineOpacity: GRID_DIM,
    starFill: "#cfe4fa",
    starR: 3.2,
    starOpacity: 0.8,

    css: `
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     2 · blue-velvet 丝绒 · 午夜
     暗调。天鹅绒吸光：绒面用密集乱点 + 极低对比，双光斑交错（左上偏冷、
     右下偏蓝紫）。绒面不吃高光，所以整体更沉，靠棋子拉出层次。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-velvet",
    name: "蓝调 · 丝绒午夜",
    swatch: "#2c3f79",
    pageBg: "#070a17",

    vars: {
      "--bd-bg": "#0a1130", "--bd-line": "#8093d0", "--bd-star": "#c8d4f8",
      "--st-black": "#141d47", "--st-white": "#e9eefb", "--ui-accent": "#2f4076",
      "--bd-radius": "18px",
    },

    defs: `
      <linearGradient id="${"blue-velvet-base"}" x1="0" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#141d47"/><stop offset=".5" stop-color="#0b1332"/>
        <stop offset="1" stop-color="#070c22"/>
      </linearGradient>
      <radialGradient id="${"blue-velvet-glowA"}" cx="18%" cy="14%" r="58%">
        <stop offset="0" stop-color="#7f9ae4" stop-opacity=".34"/>
        <stop offset=".5" stop-color="#3b4d92" stop-opacity=".13"/>
        <stop offset="1" stop-color="#070c22" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-velvet-glowB"}" cx="88%" cy="78%" r="60%">
        <stop offset="0" stop-color="#4a3a8c" stop-opacity=".32"/>
        <stop offset=".52" stop-color="#241d52" stop-opacity=".13"/>
        <stop offset="1" stop-color="#070c22" stop-opacity="0"/>
      </radialGradient>
      <!-- 丝绒：两向极细密绒线 + 一层吸光噪点 -->
      <pattern id="${"blue-velvet-pile"}" width="5" height="5" patternUnits="userSpaceOnUse">
        <path d="M0 1.4H5M0 3.6H5" stroke="#93a6e0" stroke-width=".9" opacity=".10"/>
        <path d="M1.2 0V5M3.4 0V5" stroke="#5c6cb0" stroke-width=".6" opacity=".07"/>
      </pattern>
      <filter id="${"blue-velvet-nap"}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="41" result="n"/>
        <feColorMatrix in="n" type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope=".16" intercept="0"/></feComponentTransfer>
      </filter>
      <radialGradient id="${"blue-velvet-sheen"}" cx="26%" cy="20%" r="70%">
        <stop offset="0" stop-color="#b9c9f6" stop-opacity=".16"/>
        <stop offset=".62" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-velvet-Black"}" cx="33%" cy="25%" r="78%">
        <stop offset="0" stop-color="#5468b4"/><stop offset=".28" stop-color="#26325f"/>
        <stop offset=".64" stop-color="#151d45"/><stop offset="1" stop-color="#0a0f2a"/>
      </radialGradient>
      <radialGradient id="${"blue-velvet-White"}" cx="33%" cy="25%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eef1fd"/>
        <stop offset=".66" stop-color="#ccd6f4"/><stop offset="1" stop-color="#98a8d8"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-velvet-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-velvet-glowA)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-velvet-glowB)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-velvet-pile)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#blue-velvet-nap)" opacity=".85" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-velvet-sheen)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="17" fill="none" stroke="#a0b0ee" stroke-width="1.2" opacity=".22"/>
            <rect x="7" y="7" width="606" height="606" rx="13" fill="none" stroke="#5b6aaa" stroke-width=".8" opacity=".16"/>`,

    lineStroke: "#93a4de",
    lineW: 0.95,
    lineOpacity: GRID_DIM,
    starFill: "#c8d4f8",
    starR: 3.1,
    starOpacity: 0.72,

    stone: { blackGlaze: "#cfd9ff", blackBounce: "#4a58a8", whiteBounce: "#9fb0e4", lastRing: "#b8c6ff" },

    css: `
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     3 · blue-rain 雨夜玻璃
     暗调。顶部聚光 + 玻璃雨痕（斜向条纹 + 水珠圆点），
     网格过一道极轻的折射滤镜，像隔着一层水看棋盘。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-rain",
    name: "蓝调 · 雨夜玻璃",
    swatch: "#4a7fb5",
    pageBg: "#060e18",

    vars: {
      "--bd-bg": "#0c1c2e", "--bd-line": "#86b4dd", "--bd-star": "#d3e8fb",
      "--st-black": "#152b44", "--st-white": "#e9f4fb", "--ui-accent": "#3a6d9c",
      "--bd-radius": "14px",
    },

    defs: `
      <linearGradient id="${"blue-rain-base"}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1a3d5c"/><stop offset="1" stop-color="#081320"/>
      </linearGradient>
      <radialGradient id="${"blue-rain-spot"}" cx="50%" cy="6%" r="76%">
        <stop offset="0" stop-color="#a8d4f8" stop-opacity=".40"/>
        <stop offset=".42" stop-color="#4d84bd" stop-opacity=".15"/>
        <stop offset="1" stop-color="#06101c" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-rain-corner"}" cx="88%" cy="92%" r="58%">
        <stop offset="0" stop-color="#22496f" stop-opacity=".34"/>
        <stop offset="1" stop-color="#06101c" stop-opacity="0"/>
      </radialGradient>
      <!-- 玻璃雨痕：斜向拉长的水条 -->
      <pattern id="${"blue-rain-streaks"}" width="34" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
        <rect x="3" y="0" width="1.6" height="46" fill="#bfe0fa" opacity=".13"/>
        <rect x="13" y="0" width="1" height="46" fill="#9cc6ea" opacity=".09"/>
        <rect x="26" y="0" width="1.3" height="46" fill="#d6ecff" opacity=".07"/>
        <circle cx="22" cy="16" r="1.5" fill="#e6f4ff" opacity=".22"/>
        <circle cx="8" cy="34" r="1.1" fill="#e6f4ff" opacity=".18"/>
      </pattern>
      <!-- 水珠：大小不一的小圆，边缘更亮 -->
      <pattern id="${"blue-rain-drops"}" width="72" height="72" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
        <circle cx="14" cy="18" r="5.4" fill="none" stroke="#d8ecff" stroke-width=".8" opacity=".16"/>
        <circle cx="14" cy="18" r="1.5" fill="#f0f8ff" opacity=".20"/>
        <circle cx="52" cy="40" r="3.4" fill="none" stroke="#d8ecff" stroke-width=".7" opacity=".13"/>
        <circle cx="52" cy="40" r="1" fill="#f0f8ff" opacity=".16"/>
        <circle cx="30" cy="62" r="4.4" fill="none" stroke="#cfe6fa" stroke-width=".7" opacity=".11"/>
      </pattern>
      <filter id="${"blue-rain-refract"}" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence type="fractalNoise" baseFrequency=".012 .05" numOctaves="2" seed="7" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-rain-Black"}" cx="36%" cy="24%" r="78%">
        <stop offset="0" stop-color="#4f86bd"/><stop offset=".26" stop-color="#24455f"/>
        <stop offset=".62" stop-color="#12293e"/><stop offset="1" stop-color="#081828"/>
      </radialGradient>
      <radialGradient id="${"blue-rain-White"}" cx="36%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#ecf6ff"/>
        <stop offset=".66" stop-color="#c8e0f6"/><stop offset="1" stop-color="#90b6da"/>
      </radialGradient>
    `,

    boardFill: "#0c1c2e",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="14" fill="#123049"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#blue-rain-spot)"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#blue-rain-corner)"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#blue-rain-streaks)"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#blue-rain-drops)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="13" fill="none" stroke="#bfe0fa" stroke-width="1" opacity=".3"/>`,

    lineStroke: "#8fbade",
    lineW: 1,
    lineOpacity: GRID_DIM,
    lineFilter: "blue-rain-refract",
    starFill: "#d3e8fb",
    starR: 3.1,
    starOpacity: 0.78,

    stone: { blackBounce: "#3f78b0", whiteBounce: "#a4c8e8", lastRing: "#d2ecff" },

    css: `
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     4 · blue-abyss 深海 · 光柱   ★ 动态
     暗调。水下光柱（斜向光带）缓慢摇曳 + 上方水面波纹呼吸，
     caustics 光斑在左下角游动。这一版动效幅度做得最大。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-abyss",
    name: "蓝调 · 深海光柱",
    swatch: "#2e6f9e",
    pageBg: "#03101a",

    vars: {
      "--bd-bg": "#06202f", "--bd-line": "#7fc4d8", "--bd-star": "#caf0f6",
      "--st-black": "#0d2c3f", "--st-white": "#e6f8fb", "--ui-accent": "#256a8c",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"blue-abyss-base"}" x1="0" y1="0" x2=".4" y2="1">
        <stop offset="0" stop-color="#0d3b52"/><stop offset=".5" stop-color="#072636"/>
        <stop offset="1" stop-color="#031420"/>
      </linearGradient>
      <!-- 斜向光柱：三条不等宽的亮带 -->
      <linearGradient id="${"blue-abyss-shaft"}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#bfeef8" stop-opacity="0"/>
        <stop offset=".16" stop-color="#bfeef8" stop-opacity=".22"/>
        <stop offset=".24" stop-color="#ffffff" stop-opacity=".10"/>
        <stop offset=".30" stop-color="#bfeef8" stop-opacity="0"/>
        <stop offset=".58" stop-color="#a8e4f2" stop-opacity=".17"/>
        <stop offset=".68" stop-color="#ffffff" stop-opacity=".07"/>
        <stop offset=".74" stop-color="#a8e4f2" stop-opacity="0"/>
        <stop offset="1" stop-color="#cff2fa" stop-opacity=".10"/>
      </linearGradient>
      <radialGradient id="${"blue-abyss-glow"}" cx="28%" cy="16%" r="70%">
        <stop offset="0" stop-color="#7fd4ea" stop-opacity=".34"/>
        <stop offset=".5" stop-color="#2b6a88" stop-opacity=".13"/>
        <stop offset="1" stop-color="#031420" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-abyss-caustic"}" cx="74%" cy="82%" r="46%">
        <stop offset="0" stop-color="#8fe6f0" stop-opacity=".30"/>
        <stop offset=".55" stop-color="#3f8fa8" stop-opacity=".12"/>
        <stop offset="1" stop-color="#031420" stop-opacity="0"/>
      </radialGradient>
      <!-- 水纹：横向波纹线，越往下越疏 -->
      <pattern id="${"blue-abyss-ripple"}" width="52" height="26" patternUnits="userSpaceOnUse">
        <path d="M0 7q13 -6 26 0t26 0" fill="none" stroke="#c8f0fa" stroke-width=".7" opacity=".11"/>
        <path d="M0 19q13 -6 26 0t26 0" fill="none" stroke="#9cdcea" stroke-width=".6" opacity=".08"/>
      </pattern>
      <filter id="${"blue-abyss-warp"}" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency=".008 .02" numOctaves="2" seed="19" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-abyss-Black"}" cx="34%" cy="25%" r="78%">
        <stop offset="0" stop-color="#4a9db8"/><stop offset=".26" stop-color="#1c4a5e"/>
        <stop offset=".62" stop-color="#0d2a3a"/><stop offset="1" stop-color="#061a26"/>
      </radialGradient>
      <radialGradient id="${"blue-abyss-White"}" cx="34%" cy="25%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eafaff"/>
        <stop offset=".66" stop-color="#c2e6f2"/><stop offset="1" stop-color="#87b8d0"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-abyss-base)",
    boardOverlay: `
      <rect class="blue-abyss-shafts" x="0" y="0" width="620" height="620" rx="16" fill="#0a2f42"/>
      <rect class="blue-abyss-shafts" x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-abyss-shaft)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-abyss-glow)"/>
      <rect class="blue-abyss-caustics" x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-abyss-caustic)"/>
      <rect class="blue-abyss-rips" x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-abyss-ripple)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#a8e0f0" stroke-width="1.1" opacity=".28"/>`,

    lineStroke: "#84c6da",
    lineW: 1,
    lineOpacity: 0.42,
    lineFilter: "blue-abyss-warp",
    starFill: "#caf0f6",
    starR: 3.2,
    starOpacity: 0.8,

    stone: { blackGlaze: "#d8f6ff", blackBounce: "#3d90ac", whiteBounce: "#a0d4e4", lastRing: "#d6f6ff" },

    css: `
/* ★ 动效：光柱左右摇曳（14s）+ caustics 游动（11s）+ 水面波纹横移（9s） */
#board .blue-abyss-shafts{transform-box:fill-box;transform-origin:50% 0%;animation:blue-abyss-sway 14s ease-in-out infinite}
@keyframes blue-abyss-sway{
  0%  {transform:translateX(-14px) skewX(-3deg);opacity:.72}
  35% {transform:translateX(10px)  skewX(2.5deg);opacity:1}
  70% {transform:translateX(-6px)  skewX(-1deg);opacity:.84}
  100%{transform:translateX(-14px) skewX(-3deg);opacity:.72}
}
#board .blue-abyss-caustics{transform-box:fill-box;animation:blue-abyss-drift 11s ease-in-out infinite}
@keyframes blue-abyss-drift{
  0%  {transform:translate(-26px,-16px) scale(1);opacity:.5}
  50% {transform:translate(24px,18px) scale(1.14);opacity:.95}
  100%{transform:translate(-26px,-16px) scale(1);opacity:.5}
}
#board .blue-abyss-rips{animation:blue-abyss-flow 9s linear infinite}
@keyframes blue-abyss-flow{
  0%  {transform:translateY(0)}
  100%{transform:translateY(-26px)}
}
#board .blue-abyss-last{transform-box:fill-box;transform-origin:center;animation:blue-abyss-lastPulse 2.2s ease-out infinite}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     5 · blue-sapphire 蓝宝石 · 切面
     中调。宝石台面：中央一块较亮的八角台面 + 切面反光（细窄亮楔），
     网格交点带小亮点，像切面棱上的反光。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-sapphire",
    name: "蓝调 · 蓝宝石切面",
    swatch: "#1f5fbf",
    pageBg: "#061024",

    vars: {
      "--bd-bg": "#0a1c46", "--bd-line": "#8fb8f0", "--bd-star": "#dceaff",
      "--st-black": "#12295c", "--st-white": "#eef4ff", "--ui-accent": "#1f5fbf",
      "--bd-radius": "12px",
    },

    defs: `
      <linearGradient id="${"blue-sapphire-base"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1a3f86"/><stop offset=".38" stop-color="#0e2456"/>
        <stop offset=".72" stop-color="#0a1c46"/><stop offset="1" stop-color="#061231"/>
      </linearGradient>
      <radialGradient id="${"blue-sapphire-table"}" cx="42%" cy="36%" r="58%">
        <stop offset="0" stop-color="#7fb0f4" stop-opacity=".34"/>
        <stop offset=".5" stop-color="#2a5bb0" stop-opacity=".15"/>
        <stop offset="1" stop-color="#0a1c46" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-sapphire-deep"}" cx="86%" cy="88%" r="52%">
        <stop offset="0" stop-color="#1a3a78" stop-opacity=".40"/>
        <stop offset="1" stop-color="#05101f" stop-opacity="0"/>
      </radialGradient>
      <!-- 切面：从中心发散的窄楔形亮带 -->
      <g id="${"blue-sapphire-facets"}">
        <path d="M310 310L120 40L196 30Z" fill="#bfd6ff" opacity=".13"/>
        <path d="M310 310L596 128L604 210Z" fill="#bcd4ff" opacity=".11"/>
        <path d="M310 310L470 598L392 606Z" fill="#a8c6f8" opacity=".09"/>
        <path d="M310 310L20 452L16 372Z" fill="#c8dcff" opacity=".10"/>
        <path d="M310 310L206 20L268 16Z" fill="#ffffff" opacity=".07"/>
      </g>
      <filter id="${"blue-sapphire-polish"}" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="2" seed="31" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-sapphire-Black"}" cx="34%" cy="24%" r="78%">
        <stop offset="0" stop-color="#5c8ff0"/><stop offset=".26" stop-color="#22407f"/>
        <stop offset=".62" stop-color="#122b5e"/><stop offset="1" stop-color="#091c40"/>
      </radialGradient>
      <radialGradient id="${"blue-sapphire-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eaf2ff"/>
        <stop offset=".66" stop-color="#c4d8f8"/><stop offset="1" stop-color="#8aacea"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-sapphire-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#blue-sapphire-table)"/>
      <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#blue-sapphire-deep)"/>
      <use href="#blue-sapphire-facets" filter="url(#blue-sapphire-polish)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="11" fill="none" stroke="#cfe0ff" stroke-width="1.4" opacity=".38"/>
            <rect x="6" y="6" width="608" height="608" rx="8" fill="none" stroke="#4a76c0" stroke-width=".8" opacity=".3"/>`,

    lineStroke: "#96bcf2",
    lineW: 1.05,
    lineOpacity: GRID_DIM,
    starFill: "#dceaff",
    starR: 3.6,
    starOpacity: 0.9,

    // 网格交点带小亮点：切面棱上的反光
    gridExtra: `<g fill="#dceaff" opacity=".2">
      ${[1, 2, 4, 5, 7, 8, 10, 12, 13].map((i) => [1, 2, 4, 5, 7, 8, 10, 12, 13]
        .map((j) => `<circle cx="${46 + i * ((620 - 92) / 14)}" cy="${46 + j * ((620 - 92) / 14)}" r="1.5"/>`).join("")).join("")}
    </g>`,

    stone: { blackGlaze: "#dcecff", blackBounce: "#3a68d0", whiteBounce: "#a6c0f4", lastRing: "#dcecff" },

    css: `
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     6 · blue-midnight 午夜天幕   ★ 动态
     极暗。星空 + 一条斜向银河微光带缓慢漂移（12s），
     底部有极弱地平线辉光。棋盘最沉的一版，靠星星和棋子提亮。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-midnight",
    name: "蓝调 · 午夜天幕",
    swatch: "#2a3a8c",
    pageBg: "#04060f",

    vars: {
      "--bd-bg": "#141d4e", "--bd-line": "#8a9ae8", "--bd-star": "#dbe4ff",
      "--st-black": "#12194a", "--st-white": "#eaeefc", "--ui-accent": "#2b3a8e",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"blue-midnight-base"}" x1="0" y1="0" x2=".7" y2="1">
        <stop offset="0" stop-color="#22306e"/><stop offset=".42" stop-color="#141d4e"/>
        <stop offset=".76" stop-color="#0c1136"/><stop offset="1" stop-color="#070a24"/>
      </linearGradient>
      <!-- 银河：斜向的弥散亮带 -->
      <linearGradient id="${"blue-midnight-milky"}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a8b8ff" stop-opacity="0"/>
        <stop offset=".3" stop-color="#b8c6ff" stop-opacity=".24"/>
        <stop offset=".44" stop-color="#ffffff" stop-opacity=".26"/>
        <stop offset=".58" stop-color="#9fb2ff" stop-opacity=".19"/>
        <stop offset="1" stop-color="#a8b8ff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${"blue-midnight-glow"}" cx="22%" cy="14%" r="68%">
        <stop offset="0" stop-color="#8f9ff0" stop-opacity=".46"/>
        <stop offset=".5" stop-color="#38429a" stop-opacity=".19"/>
        <stop offset="1" stop-color="#070a24" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-midnight-horizon"}" cx="74%" cy="96%" r="62%">
        <stop offset="0" stop-color="#4e5fd0" stop-opacity=".48"/>
        <stop offset=".5" stop-color="#232c7e" stop-opacity=".2"/>
        <stop offset="1" stop-color="#070a24" stop-opacity="0"/>
      </radialGradient>
      <!-- 星星：不同亮度不同大小（数量与亮度都给足，否则暗底上等于没有） -->
      <pattern id="${"blue-midnight-stars"}" width="97" height="83" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="18" r="1.7" fill="#ffffff" opacity=".92"/>
        <circle cx="44" cy="9" r="1.1" fill="#e4ebff" opacity=".72"/>
        <circle cx="78" cy="26" r="1.4" fill="#ffffff" opacity=".82"/>
        <circle cx="26" cy="47" r="1" fill="#d0dcff" opacity=".62"/>
        <circle cx="62" cy="58" r="1.8" fill="#ffffff" opacity=".88"/>
        <circle cx="90" cy="72" r="1.2" fill="#e4ebff" opacity=".66"/>
        <circle cx="8" cy="76" r="1.3" fill="#ffffff" opacity=".7"/>
        <circle cx="36" cy="34" r=".9" fill="#e8eeff" opacity=".5"/>
        <circle cx="54" cy="24" r="1" fill="#ffffff" opacity=".58"/>
        <circle cx="72" cy="48" r=".8" fill="#dce4ff" opacity=".46"/>
      </pattern>
      <pattern id="${"blue-midnight-stars2"}" width="143" height="121" patternUnits="userSpaceOnUse" patternTransform="rotate(9)">
        <circle cx="20" cy="30" r="2.4" fill="#ffffff" opacity=".8"/>
        <circle cx="106" cy="76" r="2" fill="#eef2ff" opacity=".7"/>
        <circle cx="66" cy="14" r="1.5" fill="#ffffff" opacity=".6"/>
        <circle cx="128" cy="20" r="1.2" fill="#ffffff" opacity=".5"/>
      </pattern>
      <filter id="${"blue-midnight-twk"}" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="53" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale=".8" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-midnight-Black"}" cx="34%" cy="24%" r="78%">
        <stop offset="0" stop-color="#6478d8"/><stop offset=".26" stop-color="#282f77"/>
        <stop offset=".62" stop-color="#161c56"/><stop offset="1" stop-color="#0c1040"/>
      </radialGradient>
      <radialGradient id="${"blue-midnight-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eceffd"/>
        <stop offset=".66" stop-color="#c8d2f6"/><stop offset="1" stop-color="#94a0e0"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-midnight-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-midnight-glow)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-midnight-horizon)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-midnight-stars)" filter="url(#blue-midnight-twk)"/>
      <rect class="blue-midnight-milky" x="-180" y="0" width="980" height="620" rx="16" fill="url(#blue-midnight-milky)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-midnight-stars2)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#9faeee" stroke-width="1.1" opacity=".3"/>`,

    lineStroke: "#7c90dc",
    lineW: 0.95,
    lineOpacity: 0.44,
    starFill: "#dbe4ff",
    starR: 3.1,
    starOpacity: 0.75,

    stone: { blackGlaze: "#d8deff", blackBounce: "#4a54c0", whiteBounce: "#a4aee8", lastRing: "#cfd8ff" },

    css: "",
    /* ★ 银河光带斜向漂移。原来这一条和公共 KF 混在 css 里，现在归到棋盘自带动效，
       可以单独关掉。（原 css 里还有一条 `.blue-midnight-last{…2.6s}` 的覆盖：
       它写在公共 KF 之前，一直被后面那条 2.3s 顶掉，从来没生效过，故不再搬。） */
    boardMotion: {
      name: "银河漂移",
      desc: "一条斜向的星河光带在夜空中缓缓游过",
      css: () => `
#board .blue-midnight-milky{animation:blue-midnight-drift 12s ease-in-out infinite}
@keyframes blue-midnight-drift{
  0%  {transform:translate(-120px,-70px);opacity:.55}
  50% {transform:translate(90px,52px);opacity:1}
  100%{transform:translate(-120px,-70px);opacity:.55}
}
@media (prefers-reduced-motion:reduce){#board .blue-midnight-milky{animation:none}}
`,
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
     7 · blue-enamel 珐琅 · 青花
     中亮。珐琅釉面：底色偏亮的群青，表面一层釉光（大面斜向反光），
     青花式的叠色（深浅两遍蓝），网格略深像釉下钴蓝描的线。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-enamel",
    name: "蓝调 · 珐琅青花",
    swatch: "#3567c4",
    pageBg: "#0a1228",

    vars: {
      "--bd-bg": "#16367a", "--bd-line": "#a8c4f0", "--bd-star": "#eef3ff",
      "--st-black": "#0e2450", "--st-white": "#f2f6ff", "--ui-accent": "#3567c4",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"blue-enamel-base"}" x1="0" y1="0" x2=".8" y2="1">
        <stop offset="0" stop-color="#2a56a8"/><stop offset=".35" stop-color="#1b3d84"/>
        <stop offset=".7" stop-color="#132c66"/><stop offset="1" stop-color="#0c1e4a"/>
      </linearGradient>
      <radialGradient id="${"blue-enamel-glowA"}" cx="26%" cy="18%" r="64%">
        <stop offset="0" stop-color="#a8c8ff" stop-opacity=".38"/>
        <stop offset=".52" stop-color="#4a72c8" stop-opacity=".15"/>
        <stop offset="1" stop-color="#0c1e4a" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-enamel-glowB"}" cx="84%" cy="88%" r="60%">
        <stop offset="0" stop-color="#0a1a44" stop-opacity=".52"/>
        <stop offset="1" stop-color="#0c1e4a" stop-opacity="0"/>
      </radialGradient>
      <!-- 珐琅釉光：一道宽的斜向反光带 -->
      <linearGradient id="${"blue-enamel-glaze"}" x1="0" y1="0" x2=".65" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/>
        <stop offset=".22" stop-color="#dceaff" stop-opacity=".11"/>
        <stop offset=".42" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".8" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <!-- 青花叠色：深浅两遍蓝的笔触感 -->
      <pattern id="${"blue-enamel-cobalt"}" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
        <path d="M2 8q11 -7 22 0t22 0" fill="none" stroke="#4a78d0" stroke-width="2.6" opacity=".11"/>
        <path d="M0 30q11 -7 22 0t22 0" fill="none" stroke="#7fa4e8" stroke-width="1.6" opacity=".09"/>
      </pattern>
      <filter id="${"blue-enamel-soft"}" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="13" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="1.8" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-enamel-Black"}" cx="34%" cy="24%" r="78%">
        <stop offset="0" stop-color="#5c8af0"/><stop offset=".26" stop-color="#1e3a7e"/>
        <stop offset=".62" stop-color="#102552"/><stop offset="1" stop-color="#081638"/>
      </radialGradient>
      <radialGradient id="${"blue-enamel-White"}" cx="34%" cy="24%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#f4f7ff"/>
        <stop offset=".66" stop-color="#d4dff8"/><stop offset="1" stop-color="#9db2e0"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-enamel-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-enamel-glowA)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-enamel-cobalt)" filter="url(#blue-enamel-soft)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-enamel-glowB)"/>
      <rect class="blue-enamel-glaze" x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-enamel-glaze)"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#dce8ff" stroke-width="1.6" opacity=".4"/>
            <rect x="8" y="8" width="604" height="604" rx="11" fill="none" stroke="#6f96e0" stroke-width=".9" opacity=".28"/>`,

    lineStroke: "#b4ccf2",
    lineW: 1.1,
    lineOpacity: 0.5,
    starFill: "#eef3ff",
    starR: 3.5,
    starOpacity: 0.9,

    stone: { blackGlaze: "#e0ecff", blackBounce: "#3a68e0", whiteBounce: "#a8c2f4", lastRing: "#e4eeff", blackGlazeOpacity: 0.82 },

    css: "",
    /* 珐琅釉面是亮面器，光得会走。整块釉光层横向缓扫，14s 一个来回。 */
    boardMotion: {
      name: "釉光横扫",
      desc: "器面上的高光带从左到右缓缓扫过",
      css: () => `
#board .blue-enamel-glaze{transform-box:fill-box;transform-origin:center;animation:blue-enamel-sheen 14s ease-in-out infinite alternate}
@keyframes blue-enamel-sheen{
  from{transform:translateX(-46px)}
  to  {transform:translateX(46px)}
}
@media (prefers-reduced-motion:reduce){#board .blue-enamel-glaze{animation:none}}
`,
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
     8 · blue-rimlight 边缘光 · 夜航   ★ 动态
     暗调。中央最暗、四边被冷光打亮（rim light）——与前面「左上亮」全部相反，
     光从边缘往内渗。边缘光呼吸（10s），棋子也吃边光。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-rimlight",
    name: "蓝调 · 边缘光夜航",
    swatch: "#4d8fd6",
    pageBg: "#050a14",

    vars: {
      "--bd-bg": "#17334d", "--bd-line": "#7fb0dc", "--bd-star": "#cfe6fa",
      "--st-black": "#132538", "--st-white": "#e9f2fa", "--ui-accent": "#33689e",
      "--bd-radius": "16px",
    },

    defs: `
      <radialGradient id="${"blue-rimlight-base"}" cx="50%" cy="50%" r="76%">
        <stop offset="0" stop-color="#12283e"/><stop offset=".34" stop-color="#17334d"/>
        <stop offset=".66" stop-color="#1e4262"/><stop offset=".88" stop-color="#2a5a7e"/>
        <stop offset="1" stop-color="#3a7396"/>
      </radialGradient>
      <!-- 四边边缘光：每条边一条渐隐亮带（透明度要给足，否则就是一块黑板） -->
      <linearGradient id="${"blue-rimlight-top"}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#cfe9ff" stop-opacity=".72"/>
        <stop offset=".45" stop-color="#7fb4e0" stop-opacity=".26"/>
        <stop offset="1" stop-color="#a8d8ff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${"blue-rimlight-bot"}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#9fd0f8" stop-opacity=".66"/>
        <stop offset=".5" stop-color="#5f97c8" stop-opacity=".22"/>
        <stop offset="1" stop-color="#6fb4f0" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${"blue-rimlight-left"}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#b8dcff" stop-opacity=".62"/>
        <stop offset=".5" stop-color="#6f9fd0" stop-opacity=".2"/>
        <stop offset="1" stop-color="#8fc8f8" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${"blue-rimlight-right"}" x1="1" y1="0" x2="0" y2="0">
        <stop offset="0" stop-color="#b8dcff" stop-opacity=".62"/>
        <stop offset=".5" stop-color="#6f9fd0" stop-opacity=".2"/>
        <stop offset="1" stop-color="#8fc8f8" stop-opacity="0"/>
      </linearGradient>
      <!-- 中央一团极弱的冷光，保证中心不是死黑 -->
      <radialGradient id="${"blue-rimlight-core"}" cx="46%" cy="42%" r="42%">
        <stop offset="0" stop-color="#4a7fa8" stop-opacity=".26"/>
        <stop offset="1" stop-color="#12283e" stop-opacity="0"/>
      </radialGradient>
      <pattern id="${"blue-rimlight-grain"}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
        <path d="M0 0V7" stroke="#9fc8e8" stroke-width=".6" opacity=".09"/>
      </pattern>
      <filter id="${"blue-rimlight-haze"}" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency=".008" numOctaves="2" seed="61" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="${"blue-rimlight-Black"}" cx="30%" cy="22%" r="80%">
        <stop offset="0" stop-color="#5c92c8"/><stop offset=".24" stop-color="#22405e"/>
        <stop offset=".6" stop-color="#132537"/><stop offset="1" stop-color="#0a1624"/>
      </radialGradient>
      <radialGradient id="${"blue-rimlight-White"}" cx="30%" cy="22%" r="76%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".30" stop-color="#eaf4fd"/>
        <stop offset=".66" stop-color="#c4dcf2"/><stop offset="1" stop-color="#8aaed2"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-rimlight-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-rimlight-core)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-rimlight-grain)"/>
      <g class="blue-rimlight-rims">
        <rect x="0" y="0" width="620" height="210" fill="url(#blue-rimlight-top)" filter="url(#blue-rimlight-haze)"/>
        <rect x="0" y="410" width="620" height="210" fill="url(#blue-rimlight-bot)" filter="url(#blue-rimlight-haze)"/>
        <rect x="0" y="0" width="200" height="620" fill="url(#blue-rimlight-left)" filter="url(#blue-rimlight-haze)"/>
        <rect x="420" y="0" width="200" height="620" fill="url(#blue-rimlight-right)" filter="url(#blue-rimlight-haze)"/>
      </g>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#a8d8ff" stroke-width="1.3" opacity=".34"/>`,

    lineStroke: "#82b4e0",
    lineW: 1,
    lineOpacity: 0.46,
    starFill: "#cfe6fa",
    starR: 3.2,
    starOpacity: 0.78,

    stone: { blackGlaze: "#d4ecff", blackBounce: "#3f7cb0", whiteBounce: "#a6c8e8", lastRing: "#d4ecff" },

    css: `
/* ★ 动效：四边边缘光整体呼吸（10s）—— 亮度与尺度一起动，幅度做得大 */
#board .blue-rimlight-rims{transform-box:fill-box;transform-origin:center;animation:blue-rimlight-breathe 10s ease-in-out infinite}
@keyframes blue-rimlight-breathe{
  0%  {opacity:.5;transform:scale(1)}
  50% {opacity:1;transform:scale(1.04)}
  100%{opacity:.5;transform:scale(1)}
}
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     9 · blue-glacier 冰川 · 晨光   亮调
     亮调。冰蓝底偏亮，双高光斑错位（左上冷白、右下淡青），
     像晨光穿过冰层。网格线和星位都要更深，否则浅底上看不见。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-glacier",
    name: "蓝调 · 冰川晨光",
    swatch: "#6fa8d8",
    pageBg: "#152a3c",

    vars: {
      "--bd-bg": "#cfe4f2", "--bd-line": "#4a7196", "--bd-star": "#2f5578",
      "--st-black": "#26496e", "--st-white": "#ffffff", "--ui-accent": "#4a86b8",
      "--bd-radius": "16px",
    },

    defs: `
      <linearGradient id="${"blue-glacier-base"}" x1="0" y1="0" x2=".7" y2="1">
        <stop offset="0" stop-color="#eaf5fd"/><stop offset=".34" stop-color="#cfe6f5"/>
        <stop offset=".68" stop-color="#a8cee6"/><stop offset="1" stop-color="#7fadc9"/>
      </linearGradient>
      <radialGradient id="${"blue-glacier-sun"}" cx="22%" cy="16%" r="58%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".85"/>
        <stop offset=".45" stop-color="#dff0fb" stop-opacity=".34"/>
        <stop offset="1" stop-color="#cfe6f5" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-glacier-deep"}" cx="84%" cy="86%" r="58%">
        <stop offset="0" stop-color="#4f7fa4" stop-opacity=".42"/>
        <stop offset=".6" stop-color="#7fa8c8" stop-opacity=".16"/>
        <stop offset="1" stop-color="#a8cee6" stop-opacity="0"/>
      </radialGradient>
      <!-- 冰层：大块断层斜带 -->
      <linearGradient id="${"blue-glacier-strata"}" x1="0" y1="0" x2=".5" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".30"/>
        <stop offset=".28" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".6" stop-color="#8fb8d6" stop-opacity=".16"/>
        <stop offset=".78" stop-color="#ffffff" stop-opacity=".12"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <!-- 冰裂纹：不规则折线，避免看出重复的模子 -->
      <pattern id="${"blue-glacier-crack"}" width="173" height="149" patternUnits="userSpaceOnUse" patternTransform="rotate(-7)">
        <path d="M6 12L38 44L24 81L52 112L44 141" fill="none" stroke="#5f8cae" stroke-width=".85" opacity=".22"/>
        <path d="M38 44L86 31M24 81L2 96M52 112L104 128" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".4"/>
        <path d="M120 6L98 52L126 88" fill="none" stroke="#6f9cc0" stroke-width=".75" opacity=".16"/>
        <path d="M98 52L60 66M126 88L160 78" fill="none" stroke="#ffffff" stroke-width="1" opacity=".32"/>
        <path d="M148 118L132 138L156 146" fill="none" stroke="#6f9cc0" stroke-width=".7" opacity=".15"/>
        <path d="M168 24L152 40M64 100L78 122" fill="none" stroke="#ffffff" stroke-width=".9" opacity=".26"/>
      </pattern>
      <radialGradient id="${"blue-glacier-Black"}" cx="34%" cy="24%" r="78%">
        <stop offset="0" stop-color="#6fa0cc"/><stop offset=".28" stop-color="#3a6288"/>
        <stop offset=".64" stop-color="#26496e"/><stop offset="1" stop-color="#183450"/>
      </radialGradient>
      <radialGradient id="${"blue-glacier-White"}" cx="34%" cy="24%" r="74%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#fbfeff"/>
        <stop offset=".7" stop-color="#e2f0fa"/><stop offset="1" stop-color="#b6d2e6"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-glacier-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-glacier-sun)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-glacier-deep)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-glacier-strata)"/>
      <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#blue-glacier-crack)" opacity=".8"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="15" fill="none" stroke="#ffffff" stroke-width="1.6" opacity=".55"/>
            <rect x="7" y="7" width="606" height="606" rx="12" fill="none" stroke="#6f9cc0" stroke-width=".8" opacity=".26"/>`,

    lineStroke: "#3f678c",
    lineW: 1.05,
    lineOpacity: 0.55,
    starFill: "#2f5578",
    starR: 3.5,
    starOpacity: 0.85,

    stone: {
      shadowOpacity: 0.26,
      blackEdge: "rgba(40,80,130,.55)",
      blackGlaze: "#cfe8ff",
      blackGlazeOpacity: 0.55,
      blackBounce: "#6fa0cc",
      blackBounceOpacity: 0.4,
      whiteEdge: "rgba(90,140,190,.5)",
      whiteBounce: "#9fc4de",
      whiteBounceOpacity: 0.55,
      lastRing: "#2f5578",
    },

    css: `
`,
  });

  /* ══════════════════════════════════════════════════════════════════════
     10 · blue-frost 霜白 · 冰棱   最亮
     最亮的一版：近白冰蓝底，冷色格纹（细密方格像霜花），
     交点带亮点，四周留一圈更亮的霜沿。棋子在这版要够深才立得住。
     ══════════════════════════════════════════════════════════════════════ */
  make({
    id: "blue-frost",
    name: "蓝调 · 霜白冰棱",
    swatch: "#9dc4e0",
    pageBg: "#1b3244",

    vars: {
      "--bd-bg": "#e6f1f8", "--bd-line": "#567d9e", "--bd-star": "#3a6486",
      "--st-black": "#2c5578", "--st-white": "#ffffff", "--ui-accent": "#5a93bd",
      "--bd-radius": "18px",
    },

    defs: `
      <linearGradient id="${"blue-frost-base"}" x1="0" y1="0" x2=".6" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#eef7fc"/>
        <stop offset=".66" stop-color="#d4e7f2"/><stop offset="1" stop-color="#b2cede"/>
      </linearGradient>
      <radialGradient id="${"blue-frost-hi"}" cx="18%" cy="12%" r="58%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".72"/>
        <stop offset=".46" stop-color="#ffffff" stop-opacity=".22"/>
        <stop offset="1" stop-color="#e6f1f8" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${"blue-frost-lo"}" cx="88%" cy="90%" r="56%">
        <stop offset="0" stop-color="#5784ac" stop-opacity=".5"/>
        <stop offset=".5" stop-color="#93b8d2" stop-opacity=".26"/>
        <stop offset="1" stop-color="#d4e7f2" stop-opacity="0"/>
      </radialGradient>
      <!-- 霜花格纹：细密方格 -->
      <pattern id="${"blue-frost-grid"}" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 .5H11M.5 0V11" stroke="#8fb4cf" stroke-width=".45" opacity=".3"/>
      </pattern>
      <pattern id="${"blue-frost-spike"}" width="197" height="163" patternUnits="userSpaceOnUse" patternTransform="rotate(-11)">
        <g stroke="#ffffff" stroke-width="1.3" opacity=".5" fill="none">
          <path d="M40 30L40 74M18 52H62M26 38L54 66M54 38L26 66"/>
        </g>
        <path d="M40 44l7 11-7 11-7-11z" fill="#cfe4f0" opacity=".34"/>
        <g stroke="#ffffff" stroke-width="1" opacity=".38" fill="none">
          <path d="M132 16L132 44M118 30H146M124 22L140 38M140 22L124 38"/>
        </g>
        <g stroke="#ffffff" stroke-width="1.15" opacity=".44" fill="none">
          <path d="M76 118L76 152M58 135H94M66 125L86 145M86 125L66 145"/>
        </g>
        <path d="M160 112l5 9-5 9-5-9z" fill="#cfe4f0" opacity=".3"/>
        <g stroke="#ffffff" stroke-width=".9" opacity=".3" fill="none">
          <path d="M172 62L172 80M163 71H181"/>
        </g>
        <g stroke="#ffffff" stroke-width=".85" opacity=".28" fill="none">
          <path d="M16 96L16 112M8 104H24"/>
        </g>
        <g stroke="#ffffff" stroke-width=".8" opacity=".24" fill="none">
          <path d="M104 62L104 78M96 70H112"/>
        </g>
      </pattern>
      <radialGradient id="${"blue-frost-Black"}" cx="34%" cy="24%" r="78%">
        <stop offset="0" stop-color="#7aa8cc"/><stop offset=".28" stop-color="#41698e"/>
        <stop offset=".64" stop-color="#2c5578"/><stop offset="1" stop-color="#1c3e5c"/>
      </radialGradient>
      <radialGradient id="${"blue-frost-White"}" cx="34%" cy="24%" r="74%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#fdfeff"/>
        <stop offset=".72" stop-color="#e8f3fa"/><stop offset="1" stop-color="#bcd6e6"/>
      </radialGradient>
    `,

    boardFill: "url(#blue-frost-base)",
    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-frost-hi)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-frost-grid)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-frost-lo)"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#blue-frost-spike)" opacity=".55"/>
    `,
    frame: `<rect x="1" y="1" width="618" height="618" rx="17" fill="none" stroke="#ffffff" stroke-width="2.2" opacity=".85"/>
            <rect x="8" y="8" width="604" height="604" rx="12" fill="none" stroke="#7fa8c8" stroke-width=".9" opacity=".3"/>`,

    lineStroke: "#4a7196",
    lineW: 1.1,
    lineOpacity: 0.52,
    starFill: "#3a6486",
    starR: 3.6,
    starOpacity: 0.9,

    // 交点亮点：霜在交点上结的晶
    gridExtra: `<g fill="#ffffff" opacity=".8">
      ${[0, 1, 3, 4, 5, 7, 9, 10, 11, 13, 14].map((i) => [0, 1, 3, 4, 5, 7, 9, 10, 11, 13, 14]
        .map((j) => `<circle cx="${46 + i * ((620 - 92) / 14)}" cy="${46 + j * ((620 - 92) / 14)}" r="1.6"/>`).join("")).join("")}
    </g>
    <g fill="none" stroke="#8fb4cf" stroke-width=".5" opacity=".4">
      ${[2, 6, 8, 12].map((i) => [2, 6, 8, 12]
        .map((j) => `<circle cx="${46 + i * ((620 - 92) / 14)}" cy="${46 + j * ((620 - 92) / 14)}" r="2.6"/>`).join("")).join("")}
    </g>`,

    stone: {
      shadowOpacity: 0.3,
      blackEdge: "rgba(30,70,115,.6)",
      blackGlaze: "#dcefff",
      blackGlazeOpacity: 0.6,
      blackBounce: "#7aa8cc",
      blackBounceOpacity: 0.42,
      whiteEdge: "rgba(80,130,175,.55)",
      whiteBounce: "#a8c8dd",
      whiteBounceOpacity: 0.6,
      lastRing: "#2c5578",
    },

    css: `
`,
  });

  /* 收尾：把 KF_SCALE 里定义的脉冲环 keyframes 用完（上面各版 CSS 已引用）。 */
})();
