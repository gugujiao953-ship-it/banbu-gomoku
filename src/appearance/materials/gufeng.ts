/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   古风 10 版 —— 陈年宣纸 / 水墨 / 诗词 / 花草 / 朱印。

   审美标杆（用户给的围棋古风海报，一以贯之）：
     底   陈年宣纸的暖黄褐 + 水渍霉斑 + 纤维纹，四周深褐晕染做旧
     墨   写意水墨（近浓远淡），不是工笔
     文   竖排毛笔书法诗词，右上或角上有更大的题字
     印   朱红小印（落款）—— 这一版的辨识度全靠它
     棋   细线木色/褐线棋盘；棋子扁平实心黑白，素

   10 版各走一路（纸/题材/墨色/棋盘/棋子全不同）：
     gu-xuanzhi   陈年宣纸 · 墨竹     ★动  墨点洇开 + 竹叶摇曳 + 烛光晃
     gu-meihua    梅花词笺           ★动  梅瓣飘落 + 烛光晃
     gu-lanzhu    兰石朱印                淡青绿 + 双勾兰叶
     gu-shanshui  青绿山水 · 江帆    ★动  薄雾横移 + 烛光晃
     gu-juanshu   仿古绢本 · 竹简        绢目织纹 + 编绳竹简
     gu-songzhi   松风煮茶           ★动  松针摇 + 热气升
     gu-youlan    朱砂落款 · 生宣         淡紫茄花 + 满地朱印
     gu-tezhi     茶色皮纸                深褐粗线 + 云子温润棋子
     gu-gupu     古谱残卷（断线棋谱）     汉简墨书 + 盘上谱字
     gu-zhugui   瘦金朱印 · 熟宣         细挺墨线 + 洒金点

   ⚠ 所有 defs id 一律走 P()/Q() 加皮肤前缀：8 个皮肤文件同载一个文档，
     id 撞了会互相串味（历史上踩过：一个纸纹滤镜糊到所有棋盘上）。
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    Q: (n) => `${ID}--${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  /* 棋盘几何：15 路、viewBox 620、PAD 46（与 playable.html 一致）。
     这里只用来摆放纸上的花纹装饰，棋子坐标永远用传入的 x/y/r。 */
  const X0 = 46;
  const X1 = 574;
  const SPAN = X1 - X0;
  const at = (col, row) => [X0 + (col * SPAN) / 14, X0 + (row * SPAN) / 14];

  /* 棋盘四角 2×2 星位（与 playable.html 一致），题字要避让开 */
  const STAR_CORNERS = [[3, 3], [3, 11], [11, 3], [11, 11]];

  /* 竖排毛笔行列：把一行字拆成单字，自上而下排。
     返回的字都加 class，方便皮肤自己做「墨色浓淡随机」的 CSS。 */
  const col = (cls, x, str, y0, step, o = {}) => {
    const size = o.size || 25;
    let s = "";
    for (let i = 0; i < str.length; i += 1) {
      s += `<text class="${cls}" x="${x}" y="${y0 + i * step}" font-size="${size}">${str[i]}</text>`;
    }
    return s;
  };

  /* 朱红小印：满朱底 + 白文反字（最像真印章的做法）。 */
  const seal = (cls, cx, cy, size, ch, o = {}) => {
    const r = o.radius ?? 2.5;
    const fs = size * 0.78;
    let s = `<rect class="${cls}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="${r}" fill="${o.fill || "#b8352a"}" opacity="${o.opacity ?? 0.9}"/>`;
    if (ch) s += `<text class="${cls} t" x="${cx}" y="${cy}" font-size="${fs}" fill="${o.ink || "#f2e2c4"}" opacity="${o.opacity ?? 0.9}">${ch}</text>`;
    return s;
  };

  /* 落款小方形印章：2 字左右排列（更像真印面），落在纸角。 */
  const signSeal = (cls, cx, cy, size, a, b, o = {}) => {
    const t = size * 0.42;
    return `<rect class="${cls}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="${o.radius ?? 1.5}" fill="${o.fill || "#b8352a"}" opacity="${o.opacity ?? 0.9}"/>`
      + `<rect class="${cls}" x="${cx - size / 2 + 1.8}" y="${cy - size / 2 + 1.8}" width="${size - 3.6}" height="${size - 3.6}" rx="1" fill="none" stroke="${o.ink || "#f2e2c4"}" stroke-width="${size * .07}" opacity="${o.opacity ?? 0.9}"/>`
      + `<text class="${cls} t" x="${cx - size * .2}" y="${cy + size * .04}" font-size="${t}" fill="${o.ink || "#f2e2c4"}">${a}</text>`
      + (b ? `<text class="${cls} t" x="${cx + size * .2}" y="${cy + size * .04}" font-size="${t}" fill="${o.ink || "#f2e2c4"}">${b}</text>` : "")
      + `<text class="${cls} t" x="${cx - size * .2}" y="${cy + size * .3}" font-size="${size * .17}" fill="${o.ink || "#f2e2c4"}" opacity=".85">甲</text>`
      + (b ? `<text class="${cls} t" x="${cx + size * .2}" y="${cy + size * .3}" font-size="${size * .17}" fill="${o.ink || "#f2e2c4"}" opacity=".85">子</text>` : "");
  };

  /* 满地朱印（闲章）：用 pattern 平铺，落在纸的任何位置都完整、不会像「贴歪的作业纸」。
     density 控制稀疏度，skip 让四角留白，读起来仍像随手钤印。 */
  const sealTile = (id, gems) => {
    let body = "";
    for (const g of gems) {
      const [gx, gy, s, ch, op] = g;
      body += `<rect x="${gx}" y="${gy}" width="${s}" height="${s}" rx="1.4" fill="#b8352a" opacity="${op}"/>`
        + `<rect x="${gx + 1.6}" y="${gy + 1.6}" width="${s - 3.2}" height="${s - 3.2}" rx=".8" fill="none" stroke="#f2e2c4" stroke-width=".9" opacity="${op * .95}"/>`
        + `<text x="${gx + s / 2}" y="${gy + s / 2}" font-size="${s * .5}" fill="#f2e2c4" opacity="${op * .95}">${ch}</text>`;
    }
    return `<pattern id="${id}" width="420" height="420" patternUnits="userSpaceOnUse">${body}</pattern>`;
  };

  /* 落款/题跋的多列行文：每列一个绝对定位的 <text>，字符逐字加 letter-spacing。
     瘦金体那种「字距均匀、笔画细挺」的感觉靠它比逐字 <tspan> 更像手写（也更好读）。 */
  const writeCol = (cls, x, str, y, step, size) => {
    let s = "";
    for (let i = 0; i < str.length; i += 1) {
      s += `<text class="${cls}" x="${x}" y="${y + i * step}" font-size="${size}">${str[i]}</text>`;
    }
    return s;
  };

  /* 手书线条（远山、水波这类）：用一块白噪声位移，比纯弧线像毛笔。
     这些白噪声是**局部**的（只作用于本元素），不会糊到棋盘和棋子上。 */
  const WOBBLE = [
    `<filter id="gu-wob-a" x="-9%" y="-9%" width="118%" height="118%">
       <feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="3" seed="5" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="6" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`,
    `<filter id="gu-wob-b" x="-9%" y="-9%" width="118%" height="118%">
       <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="41" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="8" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`,
    `<filter id="gu-wob-c" x="-9%" y="-9%" width="118%" height="118%">
       <feTurbulence type="turbulence" baseFrequency=".06" numOctaves="2" seed="77" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`,
  ].join("\n");

  /* 竖排书法样式：楷/行楷字体 + 字身居中对齐。
     ⚠ 选择器必须是 #board 而不是 #<皮肤id>：棋盘 SVG 的 id 是 "board"
     （见 playable.html），皮肤 id 从来不落在 DOM 上。早先写成 #${id}
     导致这条规则匹配不到任何元素，所有题字都退回 system-ui 黑体——
     这就是「一股电子汉字味」的来源。 */
  const STAMP = () => `#board text{font-family:"KaiTi","STKaiti","楷体","Kaiti SC","Kaiti TC","SimSun","Songti SC",serif;text-anchor:middle;dominant-baseline:central}`;

  /* 落子回弹：每个皮肤都挂一条，换肤后落子有「啪」一下的手感。
     注意：这是给棋子加 transform 动画，和下面 WOBBLE/NB 类滤镜的
     transform 动画互不干扰（一个在 circle 上，一个在滤镜元素上）。 */
  const SETTLE = (id) => `@keyframes ${id}-settle{from{opacity:0;transform:scale(.6)}70%{transform:scale(1.04)}to{opacity:1;transform:scale(1)}}`;

  /* 无障碍：系统要求「减少动态效果」时把这条选择器上的动画掐掉。
     每条自带动效（boardMotions / stoneMotions）都要带，.check-motion.mjs 会逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* 局部做旧纹理（水渍/霉点/纤维）专用的白噪声位移。
     ⚠ 只在「装饰元素」上引用。绝不要挂到棋盘 grid 路径或棋盘底 rect 上：
     那些元素会被塞进 <pattern> 定义里，Chromium 在 tile 内渲染 feTurbulence
     会直接崩（历史踩过：整个位图被涂成透明，页面全白）。 */
  const NB = [
    `<filter id="gu-nb-a" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="4" seed="113" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    `<filter id="gu-nb-b" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="3" seed="127" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="10" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    `<filter id="gu-nb-c" x="-12%" y="-12%" width="124%" height="124%"><feTurbulence type="fractalNoise" baseFrequency=".008" numOctaves="4" seed="139" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="18" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  ].join("\n");

  /* 一组水渍/霉点：用 NB 滤镜把几个圆泡「泡开」，再乘上渐隐。
     做法：<g filter> 里的圆被位移+模糊，形状不规则；渐变填色让边缘化开。 */
  const blotch = (filt, fill, blobs, g) => `<g class="${g || ""}" filter="url(#${filt})" fill="${fill}">`
    + blobs.map(([cx, cy, r, op]) => `<circle cx="${cx}" cy="${cy}" r="${r}" opacity="${op}"/>`).join("")
    + `</g>`;

  /* ═══════════════════════════════════════════════════════════════════
     01 · gu-xuanzhi  陈年宣纸 · 墨竹
     海报本尊：暖黄宣纸 + 左上墨竹 + 右侧竖排诗词 + 朱红落款 + 木色细线棋盘。
     ★动：三处墨点缓缓洇开、竹叶轻摇、灯烛光斑晃。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-xuanzhi");

    push({
      name: "古风 · 陈年宣纸墨竹",
      swatch: "#c9a45c",
      pageBg: "#221a10",
      vars: {
        "--bd-bg": "#e0c078", "--bd-line": "#5a4326", "--bd-star": "#4e3a20",
        "--st-black": "#181410", "--st-white": "#f2ead6",
        "--ui-accent": "#8a6a34", "--bd-radius": "4px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".82" y2="1">
          <stop offset="0" stop-color="#e6cb8c"/><stop offset=".34" stop-color="#dcc078"/>
          <stop offset=".68" stop-color="#cfa75e"/><stop offset="1" stop-color="#c39a50"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="48%" cy="42%" r="76%">
          <stop offset=".48" stop-color="#5a3f16" stop-opacity="0"/>
          <stop offset=".78" stop-color="#5a3f16" stop-opacity=".2"/>
          <stop offset="1" stop-color="#4a320f" stop-opacity=".46"/>
        </radialGradient>
        <radialGradient id="${P("damp1")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#8a6220" stop-opacity=".3"/>
          <stop offset=".6" stop-color="#8a6220" stop-opacity=".13"/>
          <stop offset="1" stop-color="#8a6220" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("damp2")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#6f4a12" stop-opacity=".24"/>
          <stop offset=".7" stop-color="#6f4a12" stop-opacity=".07"/>
          <stop offset="1" stop-color="#6f4a12" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("candle")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff3c2" stop-opacity=".5"/>
          <stop offset=".55" stop-color="#ffdf9a" stop-opacity=".2"/>
          <stop offset="1" stop-color="#ffcf78" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(6)">
          <path d="M0 0V9" stroke="#a8802f" stroke-width=".55" opacity=".3"/>
          <path d="M4.5 0V9" stroke="#f0dcaa" stroke-width=".45" opacity=".34"/>
        </pattern>
        <pattern id="${P("fib2")}" width="23" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(-72)">
          <path d="M0 0V23" stroke="#96702a" stroke-width="1" opacity=".16"/>
        </pattern>
        <pattern id="${P("mold")}" width="280" height="280" patternUnits="userSpaceOnUse">
          <circle cx="26" cy="34" r="1.8" fill="#6b4a14" opacity=".48"/>
          <circle cx="52" cy="20" r="1" fill="#3f2a0c" opacity=".42"/>
          <circle cx="41" cy="49" r="1.4" fill="#6b4a14" opacity=".36"/>
          <circle cx="188" cy="44" r="1.3" fill="#3f2a0c" opacity=".44"/>
          <circle cx="205" cy="62" r="2" fill="#6b4a14" opacity=".33"/>
          <circle cx="96" cy="118" r="1.7" fill="#3f2a0c" opacity=".38"/>
          <circle cx="238" cy="152" r="1.1" fill="#6b4a14" opacity=".4"/>
          <circle cx="150" cy="196" r="1.9" fill="#3f2a0c" opacity=".33"/>
          <circle cx="68" cy="240" r="1.5" fill="#6b4a14" opacity=".42"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".58" numOctaves="4" seed="11" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".17" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".026" numOctaves="3" seed="5" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.9" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("bleed")}" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="9" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
          <feGaussianBlur stdDeviation="1.1"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".14" numOctaves="2" seed="4" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib2")})" opacity=".45"/>
        <ellipse cx="132" cy="196" rx="176" ry="132" fill="url(#${P("damp1")})"/>
        <ellipse cx="470" cy="132" rx="98" ry="74" fill="url(#${P("damp2")})"/>
        <ellipse cx="392" cy="474" rx="146" ry="104" fill="url(#${P("damp1")})" opacity=".8"/>
        <ellipse cx="96" cy="486" rx="82" ry="64" fill="url(#${P("damp2")})"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <path class="${P("ink")}" d="M118 132a17 13 0 1 0 1 0Z" fill="#2a241c" opacity=".1" filter="url(#${P("bleed")})"/>
        <path class="${P("ink")}" d="M452 402a23 15 0 1 0 1 0Z" fill="#2a241c" opacity=".09" filter="url(#${P("bleed")})"/>
        <path class="${P("ink")}" d="M214 522a14 10 0 1 0 1 0Z" fill="#2a241c" opacity=".1" filter="url(#${P("bleed")})"/>
        <g class="${P("bamboo")}" fill="#20211c" filter="url(#${P("brush")})">
          <path d="M74 -8C82 84 88 176 74 268 66 318 58 358 46 404" fill="none" stroke="#20211c" stroke-width="5.2" stroke-linecap="round"/>
          <path d="M104 -6C114 62 122 132 122 200 122 250 116 296 106 336" fill="none" stroke="#2c2d26" stroke-width="3" stroke-linecap="round" opacity=".85"/>
          <g stroke="#20211c" stroke-width="1.6" stroke-linecap="round" opacity=".9">
            <path d="M78 44H100"/><path d="M82 130H110"/><path d="M66 216H98"/><path d="M56 306H82"/>
          </g>
          <g fill="#20211c">
            <path d="M100 30c30-16 62-14 78 2-24 12-56 12-78-2Z"/>
            <path d="M100 34c26 10 46 30 50 52-22-10-42-30-50-52Z" opacity=".82"/>
            <path d="M92 74c34-10 66-2 80 14-26 8-58 2-80-14Z" opacity=".74"/>
            <path d="M92 78c22 14 34 36 32 58-18-16-30-38-32-58Z" opacity=".6"/>
            <path d="M110 120c34-8 62 2 74 18-26 6-54-2-74-18Z" opacity=".68"/>
            <path d="M112 124c20 14 30 34 28 54-16-16-26-36-28-54Z" opacity=".54"/>
            <path d="M86 168c32-12 62-8 76 6-24 12-54 8-76-6Z" opacity=".62"/>
            <path d="M88 172c18 16 26 38 22 58-14-18-22-40-22-58Z" opacity=".48"/>
            <path d="M62 252c26-14 52-14 66-2-20 12-46 12-66 2Z" opacity=".44"/>
            <path d="M64 256c16 14 22 32 18 50-12-16-18-34-18-50Z" opacity=".36"/>
            <path d="M20 376c22-12 44-12 56-2-16 10-38 10-56 2Z" opacity=".3"/>
          </g>
        </g>
        <g id="gx-verse" fill="#23201a" filter="url(#${P("brush")})">
          ${col(P("c1"), 520, "松下问童子", 158, 30, { size: 27 })}
          ${col(P("c2"), 484, "言师采药去", 166, 30, { size: 27 })}
          ${col(P("c3"), 448, "只在此山中", 174, 30, { size: 27 })}
          ${col(P("c4"), 412, "云深不知处", 182, 30, { size: 27 })}
        </g>
        ${signSeal(P("seal1"), 552, 470, 44, "墨", "竹")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".95"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("candle")})" opacity=".22"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".62" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#7d5c28" stroke-width="3.2" opacity=".42" filter="url(#${P("wob")})"/>
        <rect x="14" y="14" width="592" height="592" fill="none" stroke="#5f4419" stroke-width="1" opacity=".34" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#5a4326",
      lineW: 1.25,
      lineOpacity: .78,
      lineFilter: P("wob"),
      starFill: "#4e3a20",
      starR: 3.6,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#4a3620" stroke-width="2.2" opacity=".72" filter="url(#${P("wob")})"/>
      `,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#181410" : "#f2ead6"}" stroke="#2a2318" stroke-width=".5" stroke-opacity=".45"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".85"/>` : ""),
      /* css 里只留**与动效无关**的静态规则（题字字体）。
         会动的东西分成两堆，各自可开关（契约见 skins/_TEMPLATE.js）：
           boardMotions → 纸上的墨晕/竹叶/烛影（跟着棋盘走）
           stoneMotions → 落子回弹（跟着棋子走）
         下面的规则与 @keyframes 是从原来这一整块 css 里**原样搬出来的**，
         参数一个没改（周期、缓动、相位、origin 全照旧）。 */
      css: `${STAMP()}`,
      boardMotions: [{
        id: "bmo-gu-xuanzhi",
        name: "墨晕洇开 · 竹叶轻摆 · 烛影摇",
        desc: "三处墨点缓缓洇开，竹叶以根部为轴轻摆，烛光忽明忽暗",
        css: () => `
        @keyframes ${P("bleed")} {
          0%   { transform: scale(.28); opacity: .55 }
          70%  { transform: scale(1.6);  opacity: .1 }
          100% { transform: scale(1.9);  opacity: 0 }
        }
        @keyframes ${P("sway")} {
          0%,100% { transform: rotate(-.6deg) }
          50%     { transform: rotate(.9deg) }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .18; transform: translate(0,0) }
          35%     { opacity: .34; transform: translate(7px,-5px) }
          70%     { opacity: .24; transform: translate(-5px,6px) }
        }
        #board .${P("ink")}   { transform-box: fill-box; transform-origin: center; animation: ${P("bleed")} 7s ease-out infinite; }
        #board .${P("ink")}:nth-of-type(2) { animation-delay: 2.4s }
        #board .${P("ink")}:nth-of-type(3) { animation-delay: 4.6s }
        #board .${P("bamboo")} { transform-box: fill-box; transform-origin: 12% 4%; animation: ${P("sway")} 6.5s ease-in-out infinite; }
        #board .${P("candle")} { animation: ${P("candle")} 4.6s ease-in-out infinite; }
        ${RM(`#board .${P("ink")},#board .${P("bamboo")},#board .${P("candle")}`)}
      `,
      }],
      stoneMotions: [{
        id: "smo-gu-xuanzhi",
        name: "落子回弹",
        desc: "子按下去时弹一下（一次性，重建旧子时不会重播）",
        css: () => `
        ${SETTLE(P("v"))}
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
        ${RM("#board #stones circle")}
      `,
      }],
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     02 · gu-meihua  梅花词笺
     生宣（吸水、边缘晕开）+ 粉梅疏影 + 竖排词句 + 长条朱印。
     ★动：梅瓣缓缓飘落（周期错开）、灯烛光斑晃。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-meihua");

    push({
      name: "古风 · 梅花词笺",
      /* 2026-10-01 用户点名删掉这枚子（盘留着：墨晕洇开 + 梅花飘落还在用）。
         连带 smo-gu-meihua 那套棋子动效一起不再被派生。 */
      noStone: true,
      swatch: "#b8563f",
      pageBg: "#241a14",
      vars: {
        "--bd-bg": "#eee1c8", "--bd-line": "#6b5334", "--bd-star": "#5f4629",
        "--st-black": "#1d1a17", "--st-white": "#fbf5e8",
        "--ui-accent": "#a8442f", "--bd-radius": "5px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#f3e8d2"/><stop offset=".42" stop-color="#ede0c6"/>
          <stop offset=".78" stop-color="#e4d3b2"/><stop offset="1" stop-color="#dcc8a2"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="52%" cy="46%" r="74%">
          <stop offset=".52" stop-color="#6b4a1c" stop-opacity="0"/>
          <stop offset=".82" stop-color="#6b4a1c" stop-opacity=".16"/>
          <stop offset="1" stop-color="#57381a" stop-opacity=".38"/>
        </radialGradient>
        <radialGradient id="${P("damp")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#a97e34" stop-opacity=".26"/>
          <stop offset=".6" stop-color="#a97e34" stop-opacity=".1"/>
          <stop offset="1" stop-color="#a97e34" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("bloom")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#b8563f" stop-opacity=".24"/>
          <stop offset=".68" stop-color="#b8563f" stop-opacity=".08"/>
          <stop offset="1" stop-color="#b8563f" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">
          <path d="M0 0V8" stroke="#b89a5e" stroke-width=".5" opacity=".28"/>
          <path d="M4 0V8" stroke="#fff8e4" stroke-width=".45" opacity=".4"/>
        </pattern>
        <pattern id="${P("fib2")}" width="27" height="27" patternUnits="userSpaceOnUse">
          <path d="M0 13H27" stroke="#c4a86a" stroke-width=".8" opacity=".2"/>
          <path d="M0 0V27" stroke="#fff8e4" stroke-width=".6" opacity=".26"/>
        </pattern>
        <pattern id="${P("mold")}" width="260" height="260" patternUnits="userSpaceOnUse">
          <circle cx="30" cy="40" r="1.6" fill="#7d5a22" opacity=".4"/>
          <circle cx="58" cy="18" r="1" fill="#4a3210" opacity=".34"/>
          <circle cx="182" cy="52" r="1.4" fill="#7d5a22" opacity=".36"/>
          <circle cx="214" cy="30" r="1.9" fill="#4a3210" opacity=".3"/>
          <circle cx="104" cy="140" r="1.5" fill="#7d5a22" opacity=".34"/>
          <circle cx="236" cy="168" r="1.2" fill="#4a3210" opacity=".34"/>
          <circle cx="62" cy="224" r="1.7" fill="#7d5a22" opacity=".32"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".66" numOctaves="4" seed="23" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".15" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="17" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("bleed")}" x="-45%" y="-45%" width="190%" height="190%">
          <feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="3" seed="29" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.6" xChannelSelector="R" yChannelSelector="G"/>
          <feGaussianBlur stdDeviation="1.6"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".16" numOctaves="2" seed="13" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
        ${sealTile(Q("gems"), [
          [186, 214, 20, "香", 0.5], [318, 296, 17, "雪", 0.44], [122, 372, 16, "春", 0.4],
          [252, 386, 21, "影", 0.5], [358, 210, 15, "月", 0.42], [64, 292, 18, "寒", 0.38],
          [296, 92, 16, "疏", 0.4], [158, 468, 17, "暗", 0.4], [386, 468, 19, "清", 0.42],
        ])}
        <g id="${P("plum1")}" fill="#9c3f2c" opacity=".5">
          <path d="M36 452c34-30 60-58 96-74 40-18 78-16 116 4" fill="none" stroke="#7d3a26" stroke-width="3.1" stroke-linecap="round"/>
          <path d="M92 408c14-24 30-38 48-44" fill="none" stroke="#7d3a26" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M158 378c12-22 28-34 46-38" fill="none" stroke="#7d3a26" stroke-width="1.7" stroke-linecap="round"/>
          <circle cx="78" cy="392" r="8"/><circle cx="94" cy="380" r="6.4"/><circle cx="64" cy="404" r="6"/>
          <circle cx="110" cy="366" r="7.2"/><circle cx="140" cy="364" r="8.4"/><circle cx="166" cy="352" r="6.6"/>
          <circle cx="190" cy="366" r="7"/><circle cx="206" cy="348" r="5.6"/><circle cx="228" cy="368" r="6.8"/>
          <circle cx="246" cy="382" r="5.2"/>
        </g>
        <g id="${P("plum2")}" fill="#8c4530" opacity=".34">
          <path d="M520 596c-24-44-40-84-58-124-16-38-12-72 10-100" fill="none" stroke="#7d3a26" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M462 472c-18-10-28-24-32-40" fill="none" stroke="#7d3a26" stroke-width="1.6" stroke-linecap="round"/>
          <circle cx="500" cy="512" r="6.4"/><circle cx="482" cy="488" r="5.4"/><circle cx="470" cy="516" r="4.8"/>
          <circle cx="512" cy="548" r="5.6"/><circle cx="440" cy="440" r="5"/><circle cx="524" cy="576" r="4.4"/>
        </g>
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".45"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib2")})" opacity=".5"/>
        <ellipse cx="448" cy="164" rx="152" ry="118" fill="url(#${P("damp")})"/>
        <ellipse cx="118" cy="524" rx="132" ry="96" fill="url(#${P("damp")})" opacity=".85"/>
        <ellipse cx="300" cy="300" rx="230" ry="200" fill="url(#${P("bloom")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${Q("gems")})" opacity=".85"/>
        <use href="#${P("plum1")}"/>
        <use href="#${P("plum2")}"/>
        <g filter="url(#${P("brush")})" fill="#6b5a45" opacity=".85">
          <ellipse class="${P("petal")}" cx="196" cy="140" rx="5.4" ry="3.2" transform="rotate(-24 196 140)"/>
          <ellipse class="${P("petal")}" cx="248" cy="96"  rx="4.6" ry="2.8" transform="rotate(38 248 96)"/>
          <ellipse class="${P("petal")}" cx="164" cy="238" rx="6"   ry="3.4" transform="rotate(12 164 238)"/>
          <ellipse class="${P("petal")}" cx="300" cy="186" rx="5"   ry="3"   transform="rotate(-52 300 186)"/>
          <ellipse class="${P("petal")}" cx="352" cy="268" rx="5.6" ry="3.2" transform="rotate(64 352 268)"/>
          <ellipse class="${P("petal")}" cx="404" cy="212" rx="4.4" ry="2.6" transform="rotate(-16 404 212)"/>
        </g>
        <g id="mh-verse" fill="#241f19" filter="url(#${P("brush")})">
          ${col(P("c1"), 528, "疏影横斜水清浅", 152, 28, { size: 24 })}
          ${col(P("c2"), 494, "暗香浮动月黄昏", 160, 28, { size: 24 })}
        </g>
        ${signSeal(P("seal1"), 550, 480, 44, "梅", "雪")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".92"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("bloom")})" opacity=".3"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#8a6a34" stroke-width="2.6" opacity=".36" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#6b5334",
      lineW: 1.15,
      lineOpacity: .74,
      lineFilter: P("wob"),
      starFill: "#5f4629",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1d1a17" : "#fbf5e8"}" stroke="#2b2419" stroke-width=".5" stroke-opacity=".42"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#a8442f" stroke-width="1.6" opacity=".85"/>` : ""),
      css: `${STAMP()}`,
      boardMotions: [{
        id: "bmo-gu-meihua",
        name: "梅花飘落 · 烛影摇",
        desc: "六瓣梅花各自错峰落下，烛光忽明忽暗",
        css: () => `
        @keyframes ${P("fall")} {
          0%   { transform: translate(0,-40px) rotate(0deg); opacity: 0 }
          12%  { opacity: .92 }
          70%  { opacity: .8 }
          100% { transform: translate(74px,430px) rotate(320deg); opacity: 0 }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .2; transform: translate(0,0) scale(1) }
          40%     { opacity: .38; transform: translate(-8px,5px) scale(1.06) }
          72%     { opacity: .26; transform: translate(6px,-6px) scale(.97) }
        }
        /* mh-settle 目前没有选择器在用（原样搬过来，留着给以后要落定的装饰） */
        @keyframes ${P("mh-settle")} {
          from { opacity: 0; transform: scale(.55) }
          to   { opacity: 1; transform: scale(1) }
        }
        #board .${P("petal")} { transform-box: fill-box; transform-origin: center; animation: ${P("fall")} 9s linear infinite; }
        #board .${P("petal")}:nth-of-type(2) { animation-duration: 11s; animation-delay: 1.6s }
        #board .${P("petal")}:nth-of-type(3) { animation-duration: 8s;  animation-delay: 3.4s }
        #board .${P("petal")}:nth-of-type(4) { animation-duration: 12s; animation-delay: 5s }
        #board .${P("petal")}:nth-of-type(5) { animation-duration: 10s; animation-delay: 2.6s }
        #board .${P("petal")}:nth-of-type(6) { animation-duration: 13s; animation-delay: 6.4s }
        #board .${P("candle")} { animation: ${P("candle")} 5.4s ease-in-out infinite; }
        ${RM(`#board .${P("petal")},#board .${P("candle")}`)}
      `,
      }],
      stoneMotions: [{
        id: "smo-gu-meihua",
        name: "落子回弹",
        desc: "子按下去时弹一下（一次性，重建旧子时不会重播）",
        css: () => `
        ${SETTLE(P("v"))}
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
        ${RM("#board #stones circle")}
      `,
      }],
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     03 · gu-lanzhu  兰石朱印
     淡青绿一路：竹简色纸 + 双勾兰叶 + 淡青墨远山 + 满地朱印点缀。
     静版（纸感与朱印最足，动效留给别的版）。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-lanzhu");

    push({
      name: "古风 · 兰石朱印",
      swatch: "#7d9a78",
      pageBg: "#1c201a",
      vars: {
        "--bd-bg": "#d8cfa8", "--bd-line": "#4e5a44", "--bd-star": "#4a563f",
        "--st-black": "#1b1f1a", "--st-white": "#f6f2e2",
        "--ui-accent": "#7d9a78", "--bd-radius": "4px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#e2dbb8"/><stop offset=".4" stop-color="#d9d1a6"/>
          <stop offset=".76" stop-color="#cdc296"/><stop offset="1" stop-color="#c2b687"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="46%" cy="44%" r="76%">
          <stop offset=".5" stop-color="#5c5426" stop-opacity="0"/>
          <stop offset=".8" stop-color="#5c5426" stop-opacity=".18"/>
          <stop offset="1" stop-color="#4a441c" stop-opacity=".4"/>
        </radialGradient>
        <radialGradient id="${P("wash")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#7f9a72" stop-opacity=".22"/>
          <stop offset=".62" stop-color="#7f9a72" stop-opacity=".09"/>
          <stop offset="1" stop-color="#7f9a72" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(2)">
          <path d="M0 0V10" stroke="#a69a63" stroke-width=".5" opacity=".32"/>
          <path d="M5 0V10" stroke="#f2ecd2" stroke-width=".45" opacity=".34"/>
        </pattern>
        <pattern id="${P("reed")}" width="17" height="17" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
          <path d="M0 0V17" stroke="#b3a86f" stroke-width="1.5" opacity=".22"/>
          <path d="M8.5 0V17" stroke="#8f8654" stroke-width=".8" opacity=".16"/>
        </pattern>
        <pattern id="${P("mold")}" width="230" height="230" patternUnits="userSpaceOnUse">
          <circle cx="24" cy="36" r="1.5" fill="#5f5726" opacity=".38"/>
          <circle cx="66" cy="20" r="1" fill="#3c3718" opacity=".32"/>
          <circle cx="158" cy="48" r="1.6" fill="#5f5726" opacity=".34"/>
          <circle cx="198" cy="140" r="1.2" fill="#3c3718" opacity=".32"/>
          <circle cx="88" cy="180" r="1.7" fill="#5f5726" opacity=".3"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="31" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".14" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".028" numOctaves="3" seed="27" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.7" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".12" numOctaves="2" seed="43" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
        ${sealTile(Q("gems"), [
          [178, 202, 26, "幽", 0.5], [330, 168, 22, "兰", 0.44], [96, 322, 25, "清", 0.42],
          [268, 344, 30, "香", 0.5], [382, 296, 21, "远", 0.4], [148, 452, 24, "素", 0.42],
          [318, 468, 21, "心", 0.4], [40, 178, 22, "石", 0.38], [396, 412, 20, "君", 0.4],
        ])}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("reed")})" opacity=".34"/>
        <ellipse cx="140" cy="150" rx="150" ry="118" fill="url(#${P("wash")})"/>
        <ellipse cx="452" cy="470" rx="164" ry="122" fill="url(#${P("wash")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${Q("gems")})" opacity=".82"/>
        <g filter="url(#${P("brush")})">
          <path d="M46 232c46-42 84-64 124-64 38 0 62 16 66 46-52-10-102-4-190 18Z" fill="#7f9a72" opacity=".3"/>
          <path d="M470 196c40-30 74-40 108-30 26 8 38 24 30 40-44-18-92-20-138-10Z" fill="#6f8a68" opacity=".26"/>
          <path d="M96 372c60 6 96 28 112 66-42-16-84-38-112-66Z" fill="#7f9a72" opacity=".2"/>
        </g>
        <g id="lz-orchid" filter="url(#${P("brush")})" fill="none" stroke="#23281f" stroke-linecap="round">
          <path class="${P("leaf")}" d="M338 528C300 448 258 380 196 316" stroke-width="2.6"/>
          <path class="${P("leaf")}" d="M338 528C320 430 332 336 372 250" stroke-width="2.4"/>
          <path class="${P("leaf")}" d="M338 528C356 452 400 388 468 342" stroke-width="2.2"/>
          <path class="${P("leaf")}" d="M338 528C296 490 240 466 176 458" stroke-width="2"/>
          <path class="${P("leaf")}" d="M338 528C368 496 418 476 486 470" stroke-width="1.9"/>
          <path class="${P("leaf")}" d="M338 528C326 460 300 404 268 362" stroke-width="1.5" opacity=".7"/>
        </g>
        <g id="lz-flowers" fill="#4a4a34" filter="url(#${P("brush")})" opacity=".85">
          <path d="M378 246c10-14 22-18 30-8-6 12-18 18-30 8Z"/>
          <path d="M372 262c-14-4-20-14-14-24 12 2 20 12 14 24Z"/>
          <path d="M300 372c8-12 20-16 26-6-6 12-16 16-26 6Z"/>
        </g>
        <g id="lz-verse" fill="#22271e" filter="url(#${P("brush")})">
          ${col(P("c1"), 528, "芝兰生于深谷", 166, 28, { size: 23 })}
          ${col(P("c2"), 494, "不以无人而不芳", 174, 28, { size: 23 })}
        </g>
        ${signSeal(P("sealA"), 550, 468, 44, "幽", "兰")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".92"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#6d7a5e" stroke-width="2.4" opacity=".34" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#4e5a44",
      lineW: 1.2,
      lineOpacity: .76,
      lineFilter: P("wob"),
      starFill: "#4a563f",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1b1f1a" : "#f6f2e2"}" stroke="#29301f" stroke-width=".5" stroke-opacity=".42"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".85"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        #board .${P("leaf")} { transform-box: fill-box; transform-origin: 50% 100%; animation: ${P("leaf")} 7.5s ease-in-out infinite; }
        #board .${P("leaf")}:nth-of-type(2) { animation-duration: 9s; animation-delay: -.8s }
        #board .${P("leaf")}:nth-of-type(3) { animation-duration: 8.4s; animation-delay: -2.2s }
        #board .${P("leaf")}:nth-of-type(4) { animation-duration: 10s; animation-delay: -3.5s }
        #board .${P("leaf")}:nth-of-type(5) { animation-duration: 8.8s; animation-delay: -1.4s }
        #board .${P("leaf")}:nth-of-type(6) { animation-duration: 11s; animation-delay: -4.6s }
        @keyframes ${P("leaf")} {
          0%,100% { transform: rotate(-1.6deg) }
          50%     { transform: rotate(2.2deg) }
        }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     04 · gu-shanshui  青绿山水 · 江帆
     淡青绿山水一路：绢本冷调纸 + 远近三段山（近浓远淡）+ 江面留白 + 帆影 + 远山朱印。
     ★动：三段薄雾横向缓移（像山间气）、灯烛光斑晃。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-shanshui");

    push({
      name: "古风 · 青绿山水江帆",
      swatch: "#6f8f86",
      pageBg: "#16201f",
      vars: {
        "--bd-bg": "#dfdcc4", "--bd-line": "#4a5a52", "--bd-star": "#44544a",
        "--st-black": "#1b2220", "--st-white": "#f7f5e8",
        "--ui-accent": "#5f8f84", "--bd-radius": "4px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".75" y2="1">
          <stop offset="0" stop-color="#e9e6d2"/><stop offset=".4" stop-color="#e2ded0"/>
          <stop offset=".74" stop-color="#d8d4c0"/><stop offset="1" stop-color="#cec9b0"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="44%" r="74%">
          <stop offset=".5" stop-color="#5a5a34" stop-opacity="0"/>
          <stop offset=".8" stop-color="#5a5a34" stop-opacity=".16"/>
          <stop offset="1" stop-color="#46461f" stop-opacity=".38"/>
        </radialGradient>
        <radialGradient id="${P("candle")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff0bc" stop-opacity=".42"/>
          <stop offset=".58" stop-color="#ffdc92" stop-opacity=".16"/>
          <stop offset="1" stop-color="#ffcf78" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("haze")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#f6f4e2" stop-opacity=".72"/>
          <stop offset=".6" stop-color="#f6f4e2" stop-opacity=".28"/>
          <stop offset="1" stop-color="#f6f4e2" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(4)">
          <path d="M0 0V12" stroke="#a9a888" stroke-width=".5" opacity=".3"/>
          <path d="M6 0V12" stroke="#fbfaec" stroke-width=".45" opacity=".36"/>
        </pattern>
        <pattern id="${P("wash")}" width="19" height="19" patternUnits="userSpaceOnUse" patternTransform="rotate(-84)">
          <path d="M0 0V19" stroke="#8fa396" stroke-width="1.6" opacity=".2"/>
          <path d="M9.5 0V19" stroke="#b9c6b4" stroke-width=".8" opacity=".16"/>
        </pattern>
        <pattern id="${P("mold")}" width="250" height="250" patternUnits="userSpaceOnUse">
          <circle cx="28" cy="44" r="1.5" fill="#5c5a30" opacity=".36"/>
          <circle cx="72" cy="22" r="1" fill="#3a3818" opacity=".3"/>
          <circle cx="168" cy="58" r="1.6" fill="#5c5a30" opacity=".32"/>
          <circle cx="204" cy="146" r="1.2" fill="#3a3818" opacity=".3"/>
          <circle cx="96" cy="192" r="1.7" fill="#5c5a30" opacity=".3"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="4" seed="53" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".15" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="61" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.7" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("mountain")}" x="-8%" y="-30%" width="116%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="4" seed="7" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="13" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("tree")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="3" seed="23" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("haze")}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="16"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("wash")})" opacity=".38"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g filter="url(#${P("mountain")})">
          <path d="M-30 300c56-46 96-104 146-116 40-10 66 12 92 40 26 28 50 40 84 26 40-16 62-58 96-70 40-14 76 8 112 40 30 26 62 34 108 22v190H-30Z" fill="#8fa89a" opacity=".28"/>
          <path d="M-30 356c60-52 104-96 154-96 46 0 72 34 104 62 30 26 62 30 96 8 36-24 66-54 106-50 44 4 76 40 116 62 30 16 62 18 96 8v150H-30Z" fill="#6f8f86" opacity=".38"/>
          <path d="M-30 420c64-40 112-64 172-56 54 8 84 44 130 52 50 8 92-26 142-26 52 0 96 34 148 40 26 4 56 0 88-10v120H-30Z" fill="#425f5c" opacity=".5"/>
        </g>
        <path d="M0 500c90-10 160-24 250-24 96 0 160 16 250 22 46 4 90 2 120-4v126H0Z" fill="#e6e4d2" opacity=".3"/>
        <g filter="url(#${P("tree")})" fill="#33423c" opacity=".55">
          <path d="M104 424l10-30 10 30Z"/><path d="M118 434l12-34 12 34Z"/>
          <path d="M150 428l8-24 8 24Z"/>
          <path d="M470 428l10-28 10 28Z"/><path d="M486 438l12-32 12 32Z"/>
          <path d="M430 434l8-22 8 22Z"/>
        </g>
        <g id="ss-boat" fill="#2f3a36" opacity=".8">
          <path d="M258 196h2v52h-2Z"/>
          <path d="M262 198c22 10 34 26 38 44-16-6-30-16-38-26Z" opacity=".9"/>
          <path d="M256 200c-14 12-20 26-22 40 10-8 18-18 22-28Z" opacity=".7"/>
          <path d="M244 250c14 8 34 8 48 0-8 10-40 10-48 0Z"/>
        </g>
        <ellipse class="${P("haze1")}" cx="150" cy="382" rx="250" ry="46" fill="url(#${P("haze")})" filter="url(#${P("haze")})"/>
        <ellipse class="${P("haze2")}" cx="470" cy="424" rx="240" ry="40" fill="url(#${P("haze")})" filter="url(#${P("haze")})"/>
        <path d="M40 546c46-8 86-6 116 4 22 8 30 18 20 26" fill="none" stroke="#4a5a52" stroke-width="1.6" opacity=".4" filter="url(#gu-wob-b)"/>
        <g id="ss-verse" fill="#26302c" filter="url(#${P("wob")})">
          ${col(P("c1"), 528, "山色空蒙雨亦奇", 176, 27, { size: 22 })}
          ${col(P("c2"), 496, "行到水穷处", 184, 27, { size: 22 })}
        </g>
        ${signSeal(P("sealA"), 550, 452, 42, "山", "水")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".92"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("candle")})" opacity=".2"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#6f8f86" stroke-width="2.6" opacity=".32" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#4a5a52",
      lineW: 1.15,
      lineOpacity: .74,
      lineFilter: P("wob"),
      starFill: "#44544a",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1b2220" : "#f7f5e8"}" stroke="#2a3630" stroke-width=".5" stroke-opacity=".4"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".8"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("haze1")} {
          0%   { transform: translateX(-90px); opacity: .5 }
          100% { transform: translateX(120px); opacity: .78 }
        }
        @keyframes ${P("haze2")} {
          0%   { transform: translateX(110px); opacity: .74 }
          100% { transform: translateX(-100px); opacity: .46 }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .16; transform: translate(0,0) }
          45%     { opacity: .32; transform: translate(8px,4px) }
          78%     { opacity: .22; transform: translate(-6px,-5px) }
        }
        #board .${P("haze1")} { animation: ${P("haze1")} 26s ease-in-out infinite alternate; }
        #board .${P("haze2")} { animation: ${P("haze2")} 33s ease-in-out infinite alternate; }
        #board .${P("candle")} { animation: ${P("candle")} 5.8s ease-in-out infinite; }
        #board #ss-boat { transform-box: fill-box; transform-origin: center; animation: ${P("boat")} 14s ease-in-out infinite alternate; }
        @keyframes ${P("boat")} {
          0%   { transform: translate(0,0) rotate(0deg) }
          100% { transform: translate(26px,10px) rotate(1.6deg) }
        }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     05 · gu-juanshu  仿古绢本 · 竹简
     仿古绢本：绢目织纹（双色方格密织）比纸更「绷」；棋盘带编绳竹简边。
     静版，最像博物馆里的旧装裱。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-juanshu");

    push({
      name: "古风 · 仿古绢本竹简",
      swatch: "#b09a5e",
      pageBg: "#221f14",
      vars: {
        "--bd-bg": "#d9c894", "--bd-line": "#5c4a26", "--bd-star": "#54421f",
        "--st-black": "#1c1810", "--st-white": "#f4ecd4",
        "--ui-accent": "#8f7a36", "--bd-radius": "3px",
      },
      defs: `
        <linearGradient id="${P("silk")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#e3d3a4"/><stop offset=".38" stop-color="#dccb98"/>
          <stop offset=".72" stop-color="#d2bf88"/><stop offset="1" stop-color="#c8b47c"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="46%" r="74%">
          <stop offset=".48" stop-color="#5f4c18" stop-opacity="0"/>
          <stop offset=".78" stop-color="#5f4c18" stop-opacity=".2"/>
          <stop offset="1" stop-color="#4a3a10" stop-opacity=".44"/>
        </radialGradient>
        <radialGradient id="${P("damp")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#9a7a28" stop-opacity=".26"/>
          <stop offset=".64" stop-color="#9a7a28" stop-opacity=".1"/>
          <stop offset="1" stop-color="#9a7a28" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("weave")}" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#dccb98"/>
          <path d="M0 1.5H6M0 4.5H6" stroke="#c2ae74" stroke-width=".9" opacity=".7"/>
          <path d="M1.5 0V6M4.5 0V6" stroke="#f0e2b8" stroke-width=".8" opacity=".6"/>
        </pattern>
        <pattern id="${P("weave2")}" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
          <path d="M0 0V24" stroke="#b9a468" stroke-width="2.4" opacity=".26"/>
        </pattern>
        <pattern id="${P("mold")}" width="240" height="240" patternUnits="userSpaceOnUse">
          <circle cx="30" cy="40" r="1.6" fill="#5c4818" opacity=".4"/>
          <circle cx="66" cy="20" r="1" fill="#3a2c0c" opacity=".34"/>
          <circle cx="162" cy="52" r="1.5" fill="#5c4818" opacity=".34"/>
          <circle cx="196" cy="142" r="1.3" fill="#3a2c0c" opacity=".32"/>
          <circle cx="92" cy="186" r="1.7" fill="#5c4818" opacity=".32"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="67" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".13" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="71" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".1" numOctaves="2" seed="19" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("weave")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("weave2")})" opacity=".4"/>
        <ellipse cx="152" cy="182" rx="160" ry="126" fill="url(#${P("damp")})"/>
        <ellipse cx="456" cy="452" rx="150" ry="112" fill="url(#${P("damp")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g id="js-slips" filter="url(#${P("wob")})">
          <rect x="0" y="0" width="36" height="620" fill="#cdb87e" opacity=".9"/>
          <rect x="584" y="0" width="36" height="620" fill="#cdb87e" opacity=".9"/>
          <path d="M36 0V620M584 0V620" stroke="#8f7638" stroke-width="1.4" opacity=".6"/>
          <path d="M4 0V620M20 0V620M600 0V620M616 0V620" stroke="#a48c4c" stroke-width=".9" opacity=".5"/>
          <path d="M0 92H36M0 300H36M0 508H36M584 92H620M584 300H620M584 508H620" stroke="#3f331a" stroke-width="4.6" opacity=".8"/>
          <path d="M0 96H36M0 304H36M0 512H36M584 96H620M584 304H620M584 512H620" stroke="#e8d9a8" stroke-width="1.1" opacity=".45"/>
        </g>
        <g filter="url(#${P("brush")})" fill="#4a3f22" opacity=".7">
          <path d="M96 500c40-8 84-4 118 6-40 6-82 4-118-6Z"/>
          <path d="M470 132c34-10 74-8 104 2-36 8-74 8-104-2Z"/>
        </g>
        <g id="js-verse" fill="#2a2416" filter="url(#${P("brush")})">
          ${col(P("c1"), 522, "简牍有尽意无穷", 172, 27, { size: 22 })}
          ${col(P("c2"), 490, "一枰黑白古今同", 180, 27, { size: 22 })}
        </g>
        ${signSeal(P("sealA"), 548, 470, 40, "古", "本")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="5" y="5" width="610" height="610" fill="none" stroke="#5c4a26" stroke-width="2" opacity=".42" filter="url(#${P("wob")})"/>
        <rect x="40" y="40" width="540" height="540" fill="none" stroke="#5c4a26" stroke-width="1" opacity=".22" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#5c4a26",
      lineW: 1.2,
      lineOpacity: .76,
      lineFilter: P("wob"),
      starFill: "#54421f",
      starR: 3.5,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1c1810" : "#f4ecd4"}" stroke="#33280f" stroke-width=".55" stroke-opacity=".45"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".82"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     06 · gu-songzhi  松风煮茶
     赭石暖调一路：暖褐茶纸 + 左上折枝松（浓淡两组针叶）+ 竖排茶诗 + 朱印。
     ★动：两组松针反向轻摇（近的幅度大、远的幅度小）、茶炉热气上升。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-songzhi");

    push({
      name: "古风 · 松风煮茶",
      swatch: "#8a6038",
      pageBg: "#241a12",
      vars: {
        "--bd-bg": "#d8b880", "--bd-line": "#54381c", "--bd-star": "#4a3016",
        "--st-black": "#191310", "--st-white": "#f2e6cc",
        "--ui-accent": "#8a6038", "--bd-radius": "4px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#e2c994"/><stop offset=".36" stop-color="#dcc088"/>
          <stop offset=".72" stop-color="#cfa870"/><stop offset="1" stop-color="#c39c60"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="48%" cy="44%" r="74%">
          <stop offset=".46" stop-color="#54350f" stop-opacity="0"/>
          <stop offset=".76" stop-color="#54350f" stop-opacity=".22"/>
          <stop offset="1" stop-color="#432a0a" stop-opacity=".48"/>
        </radialGradient>
        <radialGradient id="${P("candle")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff2c4" stop-opacity=".46"/>
          <stop offset=".56" stop-color="#ffe19c" stop-opacity=".18"/>
          <stop offset="1" stop-color="#ffcf78" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("steam")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff8e2" stop-opacity=".5"/>
          <stop offset=".6" stop-color="#fff8e2" stop-opacity=".16"/>
          <stop offset="1" stop-color="#fff8e2" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-5)">
          <path d="M0 0V11" stroke="#a87c38" stroke-width=".55" opacity=".3"/>
          <path d="M5.5 0V11" stroke="#f4dcae" stroke-width=".45" opacity=".3"/>
        </pattern>
        <pattern id="${P("straw")}" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(80)">
          <path d="M0 0V15" stroke="#b58a44" stroke-width="1.4" opacity=".2"/>
          <path d="M7.5 0V15" stroke="#8f6a2c" stroke-width=".7" opacity=".18"/>
        </pattern>
        <pattern id="${P("mold")}" width="270" height="270" patternUnits="userSpaceOnUse">
          <circle cx="32" cy="46" r="1.7" fill="#5c3c14" opacity=".42"/>
          <circle cx="70" cy="24" r="1.1" fill="#3a250a" opacity=".36"/>
          <circle cx="176" cy="60" r="1.5" fill="#5c3c14" opacity=".34"/>
          <circle cx="212" cy="152" r="1.3" fill="#3a250a" opacity=".34"/>
          <circle cx="100" cy="200" r="1.8" fill="#5c3c14" opacity=".32"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".54" numOctaves="4" seed="83" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".18" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".026" numOctaves="3" seed="89" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.9" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".13" numOctaves="2" seed="31" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("pine")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="3" seed="47" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("straw")})" opacity=".34"/>
        <ellipse cx="146" cy="200" rx="168" ry="132" fill="url(#${P("age")})" opacity=".3"/>
        <ellipse cx="470" cy="150" rx="110" ry="86" fill="url(#${P("age")})" opacity=".22"/>
        <ellipse cx="386" cy="470" rx="150" ry="110" fill="url(#${P("age")})" opacity=".26"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g class="${P("pineFar")}" filter="url(#${P("pine")})" fill="none" stroke="#4a3a2c" opacity=".45" stroke-linecap="round">
          <path d="M40 40C96 76 156 108 232 132" stroke-width="2.4"/>
          <g stroke-width="1.3">
            <path d="M96 74l-16 22"/><path d="M124 92l-18 24"/><path d="M158 110l-20 24"/>
            <path d="M186 122l-18 26"/><path d="M212 130l-14 24"/>
          </g>
        </g>
        <g id="sz-pine" filter="url(#${P("pine")})" stroke="#1f1a13" fill="none" stroke-linecap="round">
          <path d="M-10 196C60 168 126 126 178 66" stroke-width="7"/>
          <path d="M-10 200C58 178 118 148 166 104" stroke-width="3.4" opacity=".7"/>
          <path d="M96 130c-20-6-30-18-34-34" stroke-width="3.6"/>
          <path d="M136 96c-16-8-24-20-26-36" stroke-width="3.2"/>
          <path d="M170 68c-10-12-10-26-2-40" stroke-width="3"/>
          <path d="M60 152c-22 0-36-8-44-20" stroke-width="3.2"/>
          <path d="M20 178c-18 4-32 0-44-8" stroke-width="3"/>
          <g fill="#1f1a13" stroke="none">
            <path d="M40 152c-14-18-12-38 4-52 12 16 14 36-4 52Z"/>
            <path d="M40 152c18-12 38-8 50 8-16 10-36 8-50-8Z"/>
            <path d="M94 118c-12-20-8-40 8-52 10 18 10 38-8 52Z"/>
            <path d="M94 118c18-10 36-4 46 12-16 8-34 4-46-12Z"/>
            <path d="M138 84c-10-20-4-38 12-48 8 18 6 36-12 48Z"/>
            <path d="M138 84c18-8 34 0 42 16-16 6-32 0-42-16Z"/>
            <path d="M172 56c-6-18 0-34 14-42 6 16 2 32-14 42Z"/>
            <path d="M64 138c-16-6-26-20-26-36 14 8 24 22 26 36Z" opacity=".9"/>
            <path d="M22 168c-14 0-26-8-32-20 14 2 26 10 32 20Z" opacity=".85"/>
          </g>
        </g>
        <g id="sz-fire" filter="url(#${P("brush")})">
          <path d="M508 512c14-8 26-4 30 8 2 8-2 14-10 18-10 4-20 0-24-8-3-8 0-14 4-18Z" fill="#4a3a2c" opacity=".6"/>
          <path d="M516 506c4-8 12-12 18-8-2 8-8 14-18 8Z" fill="#6b4a2c" opacity=".45"/>
        </g>
        <path class="${P("steam1")}" d="M508 496c-8-16 6-26 0-42" fill="none" stroke="#fff4d8" stroke-width="5" stroke-linecap="round" opacity=".4" filter="url(#${P("wob")})"/>
        <path class="${P("steam2")}" d="M534 498c10-16-4-28 4-44" fill="none" stroke="#fff4d8" stroke-width="4" stroke-linecap="round" opacity=".34" filter="url(#${P("wob")})"/>
        <g id="sz-verse" fill="#261d13" filter="url(#${P("brush")})">
          ${col(P("c1"), 522, "松风吹解带", 172, 28, { size: 23 })}
          ${col(P("c2"), 490, "山月照弹琴", 180, 28, { size: 23 })}
        </g>
        ${signSeal(P("sealA"), 548, 452, 42, "松", "風")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".95"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("candle")})" opacity=".22"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".62" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#7a5427" stroke-width="3" opacity=".4" filter="url(#${P("wob")})"/>
        <rect x="13.5" y="13.5" width="593" height="593" fill="none" stroke="#5a3d18" stroke-width="1" opacity=".3" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#54381c",
      lineW: 1.3,
      lineOpacity: .78,
      lineFilter: P("wob"),
      starFill: "#4a3016",
      starR: 3.6,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#191310" : "#f2e6cc"}" stroke="#2e2314" stroke-width=".5" stroke-opacity=".45"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".85"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("swayA")} {
          0%,100% { transform: rotate(-1.1deg) }
          50%     { transform: rotate(1.5deg) }
        }
        @keyframes ${P("swayB")} {
          0%,100% { transform: rotate(.8deg) }
          50%     { transform: rotate(-1deg) }
        }
        @keyframes ${P("steam")} {
          0%   { transform: translateY(14px) scaleY(.6); opacity: 0 }
          30%  { opacity: .5 }
          100% { transform: translateY(-72px) scaleY(1.5); opacity: 0 }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .18; transform: translate(0,0) }
          40%     { opacity: .34; transform: translate(6px,-6px) }
          74%     { opacity: .24; transform: translate(-6px,5px) }
        }
        #board #sz-pine    { transform-box: fill-box; transform-origin: 0% 34%; animation: ${P("swayA")} 8s ease-in-out infinite; }
        #board .${P("pineFar")} { transform-box: fill-box; transform-origin: 0% 10%; animation: ${P("swayB")} 12s ease-in-out infinite; }
        #board .${P("steam1")} { animation: ${P("steam")} 5.6s ease-out infinite; }
        #board .${P("steam2")} { animation: ${P("steam")} 7.2s ease-out infinite; animation-delay: 2.4s }
        #board .${P("candle")} { animation: ${P("candle")} 5.2s ease-in-out infinite; }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     07 · gu-youlan  朱砂落款 · 生宣
     淡紫（茄花）一路：生宣吸水、墨痕外渗（每个字/每块色自带一圈淡紫晕）。
     满地朱印 + 大落款印，是 10 版里朱红分量最重的一版。
     ★动：朱印轻呼吸（像刚蘸了印泥还没干）、灯烛光斑晃。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-youlan");

    push({
      name: "古风 · 朱砂落款生宣",
      swatch: "#d9c8d4",
      pageBg: "#231c26",
      vars: {
        "--bd-bg": "#e7dfe0", "--bd-line": "#584064", "--bd-star": "#523a5c",
        "--st-black": "#1c1820", "--st-white": "#f7f1f4",
        "--ui-accent": "#a8488f", "--bd-radius": "5px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".78" y2="1">
          <stop offset="0" stop-color="#eee7e6"/><stop offset=".4" stop-color="#e8e0e0"/>
          <stop offset=".74" stop-color="#ded4d6"/><stop offset="1" stop-color="#d2c7ca"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="44%" r="74%">
          <stop offset=".5" stop-color="#60466a" stop-opacity="0"/>
          <stop offset=".8" stop-color="#60466a" stop-opacity=".16"/>
          <stop offset="1" stop-color="#4c3454" stop-opacity=".38"/>
        </radialGradient>
        <radialGradient id="${P("bleedw")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#8a5f86" stop-opacity=".24"/>
          <stop offset=".62" stop-color="#8a5f86" stop-opacity=".1"/>
          <stop offset="1" stop-color="#8a5f86" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("candle")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff0ce" stop-opacity=".38"/>
          <stop offset=".58" stop-color="#ffe6b0" stop-opacity=".14"/>
          <stop offset="1" stop-color="#ffd894" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
          <path d="M0 0V13" stroke="#b4a6b0" stroke-width=".55" opacity=".34"/>
          <path d="M6.5 0V13" stroke="#fbf6f8" stroke-width=".5" opacity=".4"/>
        </pattern>
        <pattern id="${P("wool")}" width="21" height="21" patternUnits="userSpaceOnUse">
          <path d="M0 6H21" stroke="#c4b4c0" stroke-width="1.5" opacity=".2"/>
          <path d="M0 15H21" stroke="#f0e8ee" stroke-width="1.2" opacity=".2"/>
        </pattern>
        <pattern id="${P("mold")}" width="245" height="245" patternUnits="userSpaceOnUse">
          <circle cx="30" cy="42" r="1.6" fill="#5c4462" opacity=".36"/>
          <circle cx="68" cy="22" r="1" fill="#3a2a42" opacity=".32"/>
          <circle cx="164" cy="56" r="1.5" fill="#5c4462" opacity=".32"/>
          <circle cx="200" cy="146" r="1.2" fill="#3a2a42" opacity=".32"/>
          <circle cx="94" cy="190" r="1.7" fill="#5c4462" opacity=".3"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".76" numOctaves="4" seed="97" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".13" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".026" numOctaves="3" seed="101" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.8" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("bleed")}" x="-45%" y="-45%" width="190%" height="190%">
          <feTurbulence type="fractalNoise" baseFrequency=".075" numOctaves="3" seed="37" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="4.2" xChannelSelector="R" yChannelSelector="G"/>
          <feGaussianBlur stdDeviation="1.7"/>
        </filter>
        <filter id="${P("brush")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="turbulence" baseFrequency=".17" numOctaves="2" seed="53" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${NB}
        ${WOBBLE}
        ${sealTile(Q("gems"), [
          [176, 208, 24, "朱", 0.5], [326, 172, 20, "砂", 0.44], [88, 318, 22, "印", 0.42],
          [262, 348, 27, "記", 0.5], [376, 302, 19, "生", 0.4], [144, 456, 22, "宣", 0.42],
          [312, 470, 20, "墨", 0.4], [36, 176, 20, "花", 0.38], [392, 408, 18, "香", 0.4],
        ])}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("wool")})" opacity=".32"/>
        ${blotch("gu-nb-b", "#8a5f86", [
          [206, 248, 62, ".1"], [176, 222, 40, ".09"], [256, 286, 34, ".08"],
          [420, 150, 40, ".08"], [390, 468, 52, ".09"], [430, 500, 30, ".07"],
        ])}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${Q("gems")})" opacity=".8"/>
        ${blotch("gu-nb-a", "#372a3c", [
          [148, 296, 30, ".13"], [430, 372, 36, ".11"], [256, 148, 22, ".12"],
        ])}
        <path class="${P("bleedk")}" d="M260 262a26 19 0 1 0 1 0Z" fill="#372a3c" opacity=".1" filter="url(#${P("bleed")})"/>
        <path class="${P("bleedk")}" d="M400 386a20 15 0 1 0 1 0Z" fill="#372a3c" opacity=".1" filter="url(#${P("bleed")})"/>
        <g id="yl-verse" filter="url(#${P("brush")})">
          <g fill="#c9bcd0" opacity=".5">
            ${col(P("g1"), 526, "闲敲棋子落灯花", 168, 28, { size: 23 })}
            ${col(P("g2"), 492, "夜半清谈共一枰", 176, 28, { size: 23 })}
          </g>
          <g fill="#2b2230">
            ${col(P("c1"), 524, "闲敲棋子落灯花", 170, 28, { size: 23 })}
            ${col(P("c2"), 490, "夜半清谈共一枰", 178, 28, { size: 23 })}
          </g>
        </g>
        ${signSeal(P("sealA"), 548, 456, 52, "朱", "記")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".92"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("candle")})" opacity=".2"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="6.5" y="6.5" width="607" height="607" fill="none" stroke="#8a5f86" stroke-width="2.4" opacity=".3" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#584064",
      lineW: 1.15,
      lineOpacity: .72,
      lineFilter: P("wob"),
      starFill: "#523a5c",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1c1820" : "#f7f1f4"}" stroke="#33283a" stroke-width=".5" stroke-opacity=".42"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.8" opacity=".9"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("breathe")} {
          0%,100% { opacity: .78 }
          50%     { opacity: .98 }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .16; transform: translate(0,0) }
          42%     { opacity: .32; transform: translate(-7px,6px) }
          76%     { opacity: .22; transform: translate(5px,-6px) }
        }
        #board .${P("bleedk")} { transform-box: fill-box; transform-origin: center; animation: ${P("ink")} 8s ease-out infinite; }
        @keyframes ${P("ink")} {
          0%   { transform: scale(.4); opacity: .9 }
          75%  { transform: scale(1.7); opacity: .12 }
          100% { transform: scale(2); opacity: 0 }
        }
        #board [fill="#b8352a"] { animation: ${P("breathe")} 5.6s ease-in-out infinite; }
        #board text[fill="#f2e2c4"] { animation: ${P("breathe")} 5.6s ease-in-out infinite; }
        #board .${P("candle")} { animation: ${P("candle")} 5s ease-in-out infinite; }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     08 · gu-tezhi  茶色皮纸
     深褐粗线棋盘 + 云子温润棋子（这版棋子有柔光和高光，与其他版素棋区分）。
     茶色皮纸底 + 粗褐双线格 + 淡墨树影。静版。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-tezhi");

    push({
      name: "古风 · 茶色皮纸云子",
      swatch: "#6b4a26",
      pageBg: "#241a10",
      vars: {
        "--bd-bg": "#cbb083", "--bd-line": "#4e3517", "--bd-star": "#463013",
        "--st-black": "#15120d", "--st-white": "#f3ead4",
        "--ui-accent": "#8a6230", "--bd-radius": "3px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".82" y2="1">
          <stop offset="0" stop-color="#d6bd92"/><stop offset=".36" stop-color="#cdb083"/>
          <stop offset=".72" stop-color="#bf9d6c"/><stop offset="1" stop-color="#b08e5c"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="46%" r="72%">
          <stop offset=".44" stop-color="#4e3110" stop-opacity="0"/>
          <stop offset=".74" stop-color="#4e3110" stop-opacity=".24"/>
          <stop offset="1" stop-color="#3d2608" stop-opacity=".5"/>
        </radialGradient>
        <pattern id="${P("hide")}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
          <rect width="16" height="16" fill="none"/>
          <path d="M0 0V16" stroke="#9a7748" stroke-width=".8" opacity=".26"/>
          <path d="M6 0V16" stroke="#e2caa0" stroke-width=".7" opacity=".24"/>
          <path d="M12 0V16" stroke="#8a683c" stroke-width=".5" opacity=".2"/>
        </pattern>
        <pattern id="${P("hide2")}" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M0 12H34M0 26H34" stroke="#96703c" stroke-width="1.6" opacity=".14"/>
          <path d="M18 0V34" stroke="#c0a06c" stroke-width="1.2" opacity=".12"/>
        </pattern>
        <pattern id="${P("mold")}" width="255" height="255" patternUnits="userSpaceOnUse">
          <circle cx="30" cy="42" r="1.8" fill="#4e3110" opacity=".42"/>
          <circle cx="70" cy="22" r="1.1" fill="#331f08" opacity=".36"/>
          <circle cx="170" cy="58" r="1.6" fill="#4e3110" opacity=".36"/>
          <circle cx="206" cy="148" r="1.3" fill="#331f08" opacity=".34"/>
          <circle cx="98" cy="194" r="1.8" fill="#4e3110" opacity=".34"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".42" numOctaves="4" seed="113" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".22" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="107" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("soft")}" x="-35%" y="-35%" width="170%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="127" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale=".8" xChannelSelector="R" yChannelSelector="G"/>
          <feGaussianBlur stdDeviation=".25"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".09" numOctaves="2" seed="59" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.8" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#5c5347"/><stop offset=".3" stop-color="#332c22"/>
          <stop offset=".7" stop-color="#1d1811"/><stop offset="1" stop-color="#0e0b07"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="26%" r="78%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f6efdc"/>
          <stop offset=".72" stop-color="#e2d5b6"/><stop offset="1" stop-color="#c2ad84"/>
        </radialGradient>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("hide")})" opacity=".55"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("hide2")})" opacity=".4"/>
        <ellipse cx="150" cy="196" rx="170" ry="136" fill="url(#${P("age")})" opacity=".3"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g filter="url(#${P("brush")})" fill="#3c2a15" opacity=".42">
          <path d="M-10 132c44-6 74-24 96-52 18 24 46 40 88 44-40 10-70 26-92 52-16-26-46-40-92-44Z"/>
          <path d="M400 74c34-4 58-18 76-40 14 18 36 30 68 34-30 8-54 20-72 40-12-20-36-32-72-34Z" opacity=".8"/>
          <path d="M92 530c30-2 52-14 68-32 12 16 32 26 60 28-26 8-46 18-62 34-10-16-32-28-66-30Z" opacity=".7"/>
        </g>
        <g id="tz-verse" fill="#241a0e" filter="url(#${P("brush")})">
          ${col(P("c1"), 524, "茶烟轻扬落花风", 172, 27, { size: 22 })}
          ${col(P("c2"), 492, "闲对楸枰倾一壶", 180, 27, { size: 22 })}
        </g>
        ${signSeal(P("sealA"), 548, 452, 42, "雲", "子")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".68" pointer-events="none"/>
      `,
      frame: `
        <rect x="5" y="5" width="610" height="610" fill="none" stroke="#3d2608" stroke-width="4.6" opacity=".62" filter="url(#${P("wob")})"/>
        <rect x="12" y="12" width="596" height="596" fill="none" stroke="#8a6230" stroke-width="1.4" opacity=".42" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#4e3517",
      lineW: 2,
      lineOpacity: .84,
      lineFilter: P("wob"),
      starFill: "#463013",
      starR: 4.1,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#3d2608" stroke-width="3.2" opacity=".8" filter="url(#${P("wob")})"/>
        <path d="M50 50H570V570H50Z" fill="none" stroke="#8a6230" stroke-width="1" opacity=".45" filter="url(#${P("wob")})"/>
      `,
      stone: ({ x, y, r, player, isLast }) => {
        const g = player === 1 ? Q("blk") : Q("wht");
        const hl = player === 1 ? ".34" : ".86";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" filter="url(#${P("soft")})"/>`
          + `<ellipse cx="${x - r * .32}" cy="${y - r * .38}" rx="${r * .34}" ry="${r * .21}" fill="#fffdf4" opacity="${hl}" transform="rotate(-34 ${x - r * .32} ${y - r * .38})"/>`
          + `<circle cx="${x - r * .5}" cy="${y - r * .52}" r="${r * .1}" fill="#fff" opacity="${player === 1 ? ".4" : ".92"}"/>`
          + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#231a0e" stroke-width="${r * .07}" opacity=".4"/>`
          + `<circle class="${P("core")}" cx="${x}" cy="${y}" r="${r * .82}" fill="none" stroke="${player === 1 ? "#5a5040" : "#c2ad84"}" stroke-width="${r * .07}" opacity=".3"/>`
          + `<circle cx="${x}" cy="${y}" r="${r + r * .05}" fill="none" stroke="#1c1408" stroke-width="${r * .04}" opacity=".34"/>`;
        if (isLast) s += `<circle cx="${x}" cy="${y}" r="${r + 3.4}" fill="none" stroke="#b8352a" stroke-width="1.7" opacity=".85"/>`;
        return s;
      },
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("glow")} {
          0%,100% { opacity: .12 }
          50%     { opacity: .42 }
        }
        /* 云子温润：内圈柔光极缓地明灭，像灯下的棋子反光 */
        #board .${P("core")} { transform-box: fill-box; transform-origin: center; animation: ${P("glow")} 5.5s ease-in-out infinite; }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     09 · gu-gupu  古谱残卷
     古谱一路：熟褐旧纸 + 棋盘格线带断线（lineW 大、opacity 低，配上断裂滤镜）
     + 盘面留旧谱字（圆点＋小字）、谱名大标题、右下角残破感。
     ★动：谱字位置淡入淡出（像翻旧谱时光照变了）、灯烛光斑晃。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-gupu");

    push({
      name: "古风 · 古谱残卷",
      swatch: "#9a7434",
      pageBg: "#211a0f",
      vars: {
        "--bd-bg": "#dcc79a", "--bd-line": "#57401c", "--bd-star": "#4d3816",
        "--st-black": "#1a150e", "--st-white": "#f4ebd6",
        "--ui-accent": "#94702c", "--bd-radius": "2px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#e6d3a8"/><stop offset=".34" stop-color="#dcc79a"/>
          <stop offset=".7" stop-color="#cdb482"/><stop offset="1" stop-color="#c0a56f"/>
        </linearGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="48%" r="72%">
          <stop offset=".4" stop-color="#4e3610" stop-opacity="0"/>
          <stop offset=".72" stop-color="#4e3610" stop-opacity=".24"/>
          <stop offset="1" stop-color="#3a2708" stop-opacity=".52"/>
        </radialGradient>
        <radialGradient id="${P("fox")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#8a5a18" stop-opacity=".3"/>
          <stop offset=".58" stop-color="#8a5a18" stop-opacity=".13"/>
          <stop offset="1" stop-color="#8a5a18" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("candle")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff0c0" stop-opacity=".4"/>
          <stop offset=".56" stop-color="#ffe096" stop-opacity=".15"/>
          <stop offset="1" stop-color="#ffcf78" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
          <path d="M0 0V14" stroke="#a8802c" stroke-width=".6" opacity=".3"/>
          <path d="M7 0V14" stroke="#f2dfae" stroke-width=".5" opacity=".3"/>
        </pattern>
        <pattern id="${P("frame")}" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#8a6a2c" opacity=".22"/>
          <path d="M0 0H3" stroke="#5a4218" stroke-width=".5" opacity=".4"/>
        </pattern>
        <pattern id="${P("mold")}" width="235" height="235" patternUnits="userSpaceOnUse">
          <circle cx="26" cy="38" r="1.7" fill="#4e3610" opacity=".44"/>
          <circle cx="64" cy="20" r="1.1" fill="#331f06" opacity=".38"/>
          <circle cx="160" cy="54" r="1.6" fill="#4e3610" opacity=".38"/>
          <circle cx="196" cy="142" r="1.3" fill="#331f06" opacity=".36"/>
          <circle cx="88" cy="184" r="1.8" fill="#4e3610" opacity=".36"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="4" seed="131" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".2" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".024" numOctaves="3" seed="137" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("broken")}" x="-9%" y="-9%" width="118%" height="118%">
          <feTurbulence type="turbulence" baseFrequency=".03" numOctaves="4" seed="149" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".1" numOctaves="2" seed="73" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".5"/>
        <ellipse cx="160" cy="206" rx="176" ry="140" fill="url(#${P("fox")})"/>
        <ellipse cx="452" cy="140" rx="120" ry="92" fill="url(#${P("fox")})" opacity=".8"/>
        <ellipse cx="410" cy="470" rx="156" ry="118" fill="url(#${P("fox")})" opacity=".9"/>
        <ellipse cx="120" cy="450" rx="90" ry="70" fill="url(#${P("fox")})" opacity=".7"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g id="gp-note" filter="url(#${P("brush")})" opacity=".5">
          <g fill="#3c2c14">
            <circle cx="176" cy="176" r="4.6"/><text x="176" y="152" font-size="13">一</text>
            <circle cx="300" cy="176" r="4.6"/><text x="300" y="152" font-size="13">二</text>
            <circle cx="424" cy="176" r="4.6"/><text x="424" y="152" font-size="13">三</text>
            <circle cx="176" cy="300" r="4.6"/><text x="176" y="276" font-size="13">四</text>
            <circle cx="424" cy="300" r="4.6"/><text x="424" y="276" font-size="13">五</text>
            <circle cx="176" cy="424" r="4.6"/><text x="176" y="400" font-size="13">六</text>
            <circle cx="300" cy="424" r="4.6"/><text x="300" y="400" font-size="13">七</text>
            <circle cx="424" cy="424" r="4.6"/><text x="424" y="400" font-size="13">八</text>
          </g>
        </g>
        <path d="M6 96c40 6 70-2 92-24" fill="none" stroke="#2a1c04" stroke-width="4" opacity=".5" filter="url(#gu-wob-c)"/>
        <path d="M40 566c48 4 88-6 118-30" fill="none" stroke="#2a1c04" stroke-width="3.4" opacity=".42" filter="url(#gu-wob-c)"/>
        <path d="M566 40c-40 4-72-4-96-26" fill="none" stroke="#2a1c04" stroke-width="3" opacity=".38" filter="url(#gu-wob-c)"/>
        <path d="M6 300c30 10 56 8 78-6" fill="none" stroke="#5a3c10" stroke-width="9" opacity=".2" filter="url(#gu-wob-b)"/>
        <g id="gp-title" fill="#241a0c" filter="url(#${P("brush")})">
          <text class="${P("t")}" x="120" y="452" font-size="30" opacity=".92">古</text>
          <text class="${P("t")}" x="120" y="488" font-size="30" opacity=".92">譜</text>
          <text class="${P("t")}" x="120" y="524" font-size="30" opacity=".92">殘</text>
          <text class="${P("t")}" x="120" y="560" font-size="30" opacity=".92">卷</text>
          <text class="${P("t")}" x="170" y="560" font-size="30" opacity=".92">第</text>
          <text class="${P("t")}" x="200" y="560" font-size="30" opacity=".92">三</text>
          <text class="${P("t")}" x="230" y="560" font-size="30" opacity=".92">局</text>
        </g>
        <g id="gp-verse" fill="#2a1f10" filter="url(#${P("brush")})">
          ${col(P("c1"), 522, "此局黑先如何取胜", 158, 26, { size: 20 })}
          ${col(P("c2"), 494, "谱载于甲子仲秋", 166, 26, { size: 20 })}
        </g>
        ${seal(P("s1"), 556, 452, 30, "谱")}
        ${signSeal(P("sealA"), 552, 508, 40, "殘", "卷")}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".96"/>
        <rect class="${P("candle")}" x="0" y="0" width="620" height="620" fill="url(#${P("candle")})" opacity=".18"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".7" pointer-events="none"/>
      `,
      frame: `
        <rect x="4.5" y="4.5" width="611" height="611" fill="none" stroke="#3a2708" stroke-width="5" opacity=".55"/>
        <rect x="11" y="11" width="598" height="598" fill="none" stroke="#3a2708" stroke-width="1.6" opacity=".45"/>
        <rect x="6" y="6" width="608" height="608" fill="none" stroke="#94702c" stroke-width=".9" opacity=".3" filter="url(#${P("broken")})"/>
      `,
      lineStroke: "#57401c",
      lineW: 1.5,
      lineOpacity: .52,
      lineFilter: P("broken"),
      starFill: "#4d3816",
      starR: 3.4,
      starOpacity: .75,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#4d3816" stroke-width="2" opacity=".5" filter="url(#${P("broken")})"/>
      `,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#1a150e" : "#f4ebd6"}" stroke="#2c2212" stroke-width=".5" stroke-opacity=".42"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#b8352a" stroke-width="1.6" opacity=".8"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("flick")} {
          0%,100% { opacity: .4 }
          46%     { opacity: .62 }
          74%     { opacity: .46 }
        }
        @keyframes ${P("candle")} {
          0%,100% { opacity: .14; transform: translate(0,0) }
          38%     { opacity: .3; transform: translate(-8px,-4px) }
          72%     { opacity: .2; transform: translate(6px,6px) }
        }
        #board .${P("t")} { animation: ${P("flick")} 6.4s ease-in-out infinite; }
        #board .${P("t")}:nth-of-type(2) { animation-delay: -1.1s }
        #board .${P("t")}:nth-of-type(3) { animation-delay: -2.3s }
        #board .${P("t")}:nth-of-type(4) { animation-delay: -3.4s }
        #board .${P("t")}:nth-of-type(5) { animation-delay: -4.6s }
        #board .${P("t")}:nth-of-type(6) { animation-delay: -5.2s }
        #board .${P("t")}:nth-of-type(7) { animation-delay: -2.9s }
        #board .${P("candle")} { animation: ${P("candle")} 4.4s ease-in-out infinite; }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     10 · gu-zhugui  瘦金朱印 · 熟宣
     熟宣（不吸水、纸面绷亮、墨线细挺）＋ 瘦金一路的细长笔画感：
     格线最细最黑、星位最小、题字笔画挺直；洒金点 + 朱印。
     ★动：极小（洒金点闪烁），主力还是纸的绷亮质感。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("gu-zhugui");

    push({
      name: "古风 · 瘦金洒金熟宣",
      swatch: "#a8842c",
      pageBg: "#1f1b10",
      vars: {
        "--bd-bg": "#e9dcb8", "--bd-line": "#3d3117", "--bd-star": "#33290f",
        "--st-black": "#14120c", "--st-white": "#faf4e2",
        "--ui-accent": "#a8842c", "--bd-radius": "2px",
      },
      defs: `
        <linearGradient id="${P("paper")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#f0e6c8"/><stop offset=".38" stop-color="#e9dcb8"/>
          <stop offset=".74" stop-color="#ddcda4"/><stop offset="1" stop-color="#d2c092"/>
        </linearGradient>
        <radialGradient id="${P("sheen")}" cx="38%" cy="30%" r="78%">
          <stop offset="0" stop-color="#fffbe8" stop-opacity=".5"/>
          <stop offset=".46" stop-color="#fff8dc" stop-opacity=".14"/>
          <stop offset="1" stop-color="#fff8dc" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("age")}" cx="50%" cy="46%" r="74%">
          <stop offset=".52" stop-color="#5c4a12" stop-opacity="0"/>
          <stop offset=".8" stop-color="#5c4a12" stop-opacity=".14"/>
          <stop offset="1" stop-color="#48380a" stop-opacity=".34"/>
        </radialGradient>
        <radialGradient id="${P("gold")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#c9a13c" stop-opacity=".9"/>
          <stop offset=".6" stop-color="#c9a13c" stop-opacity=".35"/>
          <stop offset="1" stop-color="#c9a13c" stop-opacity="0"/>
        </radialGradient>
        <pattern id="${P("fib")}" width="17" height="17" patternUnits="userSpaceOnUse" patternTransform="rotate(-2)">
          <path d="M0 0V17" stroke="#b09a5c" stroke-width=".45" opacity=".22"/>
          <path d="M8.5 0V17" stroke="#fffbee" stroke-width=".4" opacity=".3"/>
        </pattern>
        <pattern id="${P("silk")}" width="23" height="23" patternUnits="userSpaceOnUse">
          <path d="M0 11.5H23" stroke="#c0a86a" stroke-width=".8" opacity=".16"/>
          <path d="M11.5 0V23" stroke="#fffbe8" stroke-width=".7" opacity=".2"/>
        </pattern>
        <pattern id="${P("mold")}" width="265" height="265" patternUnits="userSpaceOnUse">
          <circle cx="32" cy="44" r="1.2" fill="#5c4a12" opacity=".3"/>
          <circle cx="70" cy="22" r=".8" fill="#3a2c06" opacity=".26"/>
          <circle cx="172" cy="58" r="1.1" fill="#5c4a12" opacity=".26"/>
          <circle cx="208" cy="150" r=".9" fill="#3a2c06" opacity=".26"/>
          <circle cx="98" cy="196" r="1.3" fill="#5c4a12" opacity=".26"/>
        </pattern>
        <pattern id="${P("golddust")}" width="120" height="120" patternUnits="userSpaceOnUse">
          <circle class="${P("g")}" cx="14" cy="22" r="2.6" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="58" cy="42" r="1.9" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="92" cy="18" r="2.2" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="34" cy="72" r="1.6" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="106" cy="76" r="2.4" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="76" cy="102" r="2" fill="url(#${P("gold")})"/>
          <circle class="${P("g")}" cx="18" cy="108" r="1.4" fill="url(#${P("gold")})"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves="3" seed="151" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".09" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="157" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale=".9" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("thin")}" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="turbulence" baseFrequency=".24" numOctaves="2" seed="83" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        ${WOBBLE}
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("fib")})" opacity=".45"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("silk")})" opacity=".4"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("sheen")})"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("golddust")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("mold")})"/>
        <g id="zg-verse" filter="url(#${P("thin")})" fill="#1f1a10">
          ${writeCol(P("c1"), 522, "天工开物一枰间", 164, 27, 23)}
          ${writeCol(P("c2"), 486, "瘦金题字小如蝇", 172, 27, 23)}
          ${writeCol(P("c3"), 450, "细线棋枰留白雪", 180, 27, 23)}
          ${writeCol(P("c4"), 414, "一灯如豆照残编", 188, 27, 23)}
        </g>
        ${signSeal(P("sealA"), 552, 450, 46, "金", "石")}
        ${seal(P("sealB"), 552, 506, 24, "雅", { radius: 12 })}
        <rect x="0" y="0" width="620" height="620" fill="url(#${P("age")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" filter="url(#${P("grain")})" opacity=".5" pointer-events="none"/>
      `,
      frame: `
        <rect x="4.5" y="4.5" width="611" height="611" fill="none" stroke="#3d3117" stroke-width="2.4" opacity=".62" filter="url(#${P("wob")})"/>
        <rect x="9.5" y="9.5" width="601" height="601" fill="none" stroke="#a8842c" stroke-width="1" opacity=".5" filter="url(#${P("wob")})"/>
        <rect x="14.5" y="14.5" width="591" height="591" fill="none" stroke="#3d3117" stroke-width=".6" opacity=".34" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#3d3117",
      lineW: .85,
      lineOpacity: .88,
      lineFilter: P("wob"),
      starFill: "#33290f",
      starR: 2.7,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#33290f" stroke-width="1.4" opacity=".85" filter="url(#${P("wob")})"/>
      `,
      stone: ({ x, y, r, player, isLast }) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${player === 1 ? "#14120c" : "#faf4e2"}" stroke="#2a2413" stroke-width=".45" stroke-opacity=".4"/>`
        + (isLast ? `<circle cx="${x}" cy="${y}" r="${r + 2.6}" fill="none" stroke="#b8352a" stroke-width="1.5" opacity=".85"/>` : ""),
      css: `${STAMP()}
        ${SETTLE(P("v"))}
        @keyframes ${P("shine")} {
          0%,100% { opacity: .45 }
          50%     { opacity: .95 }
        }
        #board .${P("g")} { animation: ${P("shine")} 4.2s ease-in-out infinite; }
        #board .${P("g")}:nth-of-type(2n) { animation-delay: -1.2s }
        #board .${P("g")}:nth-of-type(3n) { animation-delay: -2.4s }
        #board .${P("g")}:nth-of-type(5n) { animation-delay: -3.1s }
        #board #stones circle { animation: ${P("v")}-settle .22s cubic-bezier(.34,1.56,.64,1) both; }
      `,
    });
  }
})();
