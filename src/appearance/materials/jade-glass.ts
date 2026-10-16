/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   翡翠琉璃（jade glass）—— 一整块淡翡翠绿琉璃棋盘。

   视觉配方（对照参考图 03-翡翠琉璃.png）：
     盘底   淡翡翠绿 #b8d8c0 一带，中心略亮、边缘微压（琉璃温润感）
     云絮   两层 feTurbulence：奶白云絮 + 深绿丝絮脉络，opacity 低（半透明内部纹理）
     格线   深翡翠绿 #2e6b42 细线，笔直规整（不是手绘抖）
     星位   深绿小点 #24583a
     棋子   黑白圆子，穹顶曲面 + 落地投影（琉璃上浮起感）：
              黑子 = 墨玉黑翡翠（深墨绿近黑，左上暖褐高光面，柔焦玻璃光泽）
              白子 = 珍珠象牙（暖米白，穹顶柔光，边缘暖棕过渡）
     边框   双层：外圈深绿粗线 + 内圈浅绿细线，大圆角

   硬约束自查：
     · defs id 全部走 P() 加 "jade-" 前缀
     · 不用 Math.random()（云絮/脉络由 feTurbulence seed 确定性生成）
     · 黑子 L*≈15、白子 L*≈90，ΔL≈75（≥70）；黑子 vs 盘底 L* 差 ≈65（≥25）
     · 白子 vs 浅盘底靠暖棕描边 + 落地投影分离（第 6.12 条）
     · 装饰层 opacity 0.3~0.4，且在格线/棋子之下，不抢子
     · feTurbulence 滤镜 3 个（cloud / vein / grain），≤6
     · stone() 用传入的 x/y/r
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const ID = "jade";
  const P = (n) => `${ID}-${n}`;   // 统一前缀，多皮肤同载不串味

  SKINS.push({
    id: ID,
    name: "翡翠琉璃 · 淡翠云絮",
    swatch: "#7fb894",
    pageBg: "#24382e",

    vars: {
      "--bd-bg": "#b8d8c0",
      "--bd-line": "#2e6b42",
      "--bd-star": "#24583a",
      "--st-black": "#1a1814",
      "--st-white": "#f2ebd8",
      "--ui-accent": "#3a8a5c",
      "--bd-radius": "18px",
    },

    defs: `
      <!-- 盘底主渐变：中心亮翠 → 边缘稍深（琉璃温润） -->
      <radialGradient id="${P("base")}" cx="50%" cy="46%" r="74%">
        <stop offset="0" stop-color="#cfe6d4"/>
        <stop offset=".55" stop-color="#b8d8c0"/>
        <stop offset="1" stop-color="#9cc2aa"/>
      </radialGradient>

      <!-- 顶部釉面反光：玻璃质感的一抹柔光 -->
      <linearGradient id="${P("sheen")}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".2"/>
        <stop offset=".32" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>

      <!-- 边缘压暗：琉璃板四周略深，增加厚度感 -->
      <radialGradient id="${P("edge")}" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#0a2a18" stop-opacity="0"/>
        <stop offset=".8" stop-color="#0a2a18" stop-opacity="0"/>
        <stop offset="1" stop-color="#0a2a18" stop-opacity=".3"/>
      </radialGradient>

      <!-- 奶白云絮：低频噪声 → 半透奶白，像翡翠内部的棉絮 -->
      <filter id="${P("cloud")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.011 0.019" numOctaves="4" seed="11" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.96
          0 0 0 0 1.00
          0 0 0 0 0.97
          0 0 0 0.75 0"/>
      </filter>

      <!-- 深绿丝絮脉络：稍高频、略拉伸的噪声 → 暗绿丝絮纹理 -->
      <filter id="${P("vein")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="turbulence" baseFrequency="0.016 0.032" numOctaves="3" seed="5" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.08
          0 0 0 0 0.30
          0 0 0 0 0.16
          0 0 0 0.8 0"/>
      </filter>

      <!-- 细颗粒：琉璃表面微磨砂，极低透明度 -->
      <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
        <feColorMatrix in="n" type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope=".06" intercept="0"/></feComponentTransfer>
      </filter>

      <!-- 棋子落地投影：稍大偏移 + 柔模糊，让子"浮"在盘上 -->
      <filter id="${P("drop")}" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.8"/>
      </filter>

      <!-- 黑子：墨玉/黑翡翠，深墨绿近黑，穹顶曲面，左上宽柔高光 -->
      <!-- 0% 点在左上 1/3，形成穹顶亮面；边缘压近黑交代圆柱侧壁厚度 -->
      <radialGradient id="${P("blackStone")}" cx="36%" cy="30%" r="80%">
        <stop offset="0" stop-color="#5a4d3e"/>
        <stop offset=".12" stop-color="#332b22"/>
        <stop offset=".32" stop-color="#181512"/>
        <stop offset=".6" stop-color="#0a0908"/>
        <stop offset=".88" stop-color="#050505"/>
        <stop offset="1" stop-color="#000000"/>
      </radialGradient>

      <!-- 白子：珍珠/白瓷/象牙，暖米白，穹顶曲面，边缘暖棕过渡 -->
      <radialGradient id="${P("whiteStone")}" cx="36%" cy="30%" r="80%">
        <stop offset="0" stop-color="#fffdf4"/>
        <stop offset=".18" stop-color="#fbf1d8"/>
        <stop offset=".45" stop-color="#ecd9b4"/>
        <stop offset=".75" stop-color="#d2b98a"/>
        <stop offset=".93" stop-color="#b39a68"/>
        <stop offset="1" stop-color="#8f7848"/>
      </radialGradient>

      <!-- 子面柔光高光：白→透明径向渐变，叠在左上，形成玻璃/珍珠光泽 -->
      <radialGradient id="${P("spec")}" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
        <stop offset=".4" stop-color="#ffffff" stop-opacity=".35"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    `,

    boardFill: `url(#${P("base")})`,

    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("cloud")})" opacity=".55" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("vein")})" opacity=".5" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("grain")})" opacity=".45" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("sheen")})" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("edge")})" pointer-events="none"/>
    `,

    frame: `
      <rect x="2" y="2" width="616" height="616" rx="18" fill="none" stroke="#2e5a3a" stroke-width="2.5" opacity=".55"/>
      <rect x="7" y="7" width="606" height="606" rx="14" fill="none" stroke="#5a8a6c" stroke-width="1" opacity=".5"/>
    `,

    gridExtra: `
      <rect x="46" y="46" width="528" height="528" fill="none" stroke="#2e6b42" stroke-width="1.6" opacity=".8"/>
    `,

    lineStroke: "#2e6b42",
    lineW: 1.2,
    lineOpacity: .72,
    starFill: "#24583a",
    starR: 3.2,

    stone: ({ x, y, r, player, isLast, isWin }) => {
      const g = player === 1 ? P("blackStone") : P("whiteStone");
      const rim = player === 1 ? "#000000" : "#7a6538";
      const shadowFill = "#0a1a10";
      const shadowOp = player === 1 ? .42 : .34;
      const specOp = player === 1 ? .5 : .28;
      // 落地投影：右下偏移，柔模糊
      let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${shadowFill}" opacity="${shadowOp}" filter="url(#${P("drop")})" transform="translate(2.2, 3.4)"/>`;
      // 子体：穹顶渐变 + 极细边缘描边交代厚度
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${rim}" stroke-width="0.7" stroke-opacity=".6"/>`;
      // 柔光高光：左上 1/3 处椭圆，径向渐变白→透明，柔和不刺眼
      s += `<ellipse cx="${x - r * 0.26}" cy="${y - r * 0.32}" rx="${r * 0.34}" ry="${r * 0.22}" fill="url(#${P("spec")})" opacity="${specOp}"/>`;
      if (isLast) s += `<circle cx="${x}" cy="${y}" r="${r + 1.8}" fill="none" stroke="#3a8a5c" stroke-width="1" opacity=".7"/>`;
      if (isWin) s += `<circle cx="${x}" cy="${y}" r="${r + 3.2}" fill="none" stroke="#5cb87e" stroke-width="1.6" opacity=".95"/>`;
      return s;
    },
  });
})();
