/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   胡桃木棋墩（walnut）—— 一张实打实的木质棋墩。

   视觉配方（对照参考图 06-胡桃木棋墩.png）：
     盘底   暖棕胡桃木 #a06038 一带，中心略亮、边缘压暗
     木纹   垂直长条木纤维：feTurbulence baseFreq x 低 y 高（0.005 0.1），
            噪声被拉成竖条，像一条条深浅相间的木纤维
     格线   深棕凹槽线 #4a2810（比盘底深，像刻进去的，不是描金），细线笔直
     星位   深棕小点 #3a1f0c
     棋子   黑子墨蓝灰/深炭带柔和左上高光；白子暖白/象牙带柔和高光；
            棋子有明显投影（偏移深色圆 + 高斯模糊），像浮在棋盘上的立体圆子
     边框   双层木框：外圈宽边（稍深木色）+ 内圈细线凹槽

   硬约束自查：
     · defs id 全部走 P() 加 "walnut-" 前缀
     · 不用 Math.random()（木纹由 feTurbulence seed 确定性生成）
     · 黑子 L≈25、白子 L≈230，ΔL≈205（≥70）；黑子 vs 盘底 L 差 ≈35（≥25）
     · 装饰层 opacity 0.3~0.5，不抢棋子
     · feTurbulence 滤镜 2 个（grain / pore），≤6
     · stone() 用传入的 x/y/r
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const ID = "walnut";
  const P = (n) => `${ID}-${n}`;   // 统一前缀，多皮肤同载不串味

  SKINS.push({
    id: ID,
    name: "胡桃木棋墩 · 温润实木",
    swatch: "#a06038",
    pageBg: "#2a1a0e",

    vars: {
      "--bd-bg": "#a06038",
      "--bd-line": "#4a2810",
      "--bd-star": "#3a1f0c",
      "--st-black": "#1a1d24",
      "--st-white": "#f0e8d8",
      "--ui-accent": "#8b5a2b",
      "--bd-radius": "14px",
    },

    defs: `
      <!-- 盘底主渐变：中心略亮（木面受光）→ 边缘深（棋墩侧边阴影） -->
      <radialGradient id="${P("base")}" cx="50%" cy="46%" r="75%">
        <stop offset="0" stop-color="#b07040"/>
        <stop offset=".5" stop-color="#a06038"/>
        <stop offset="1" stop-color="#7a4420"/>
      </radialGradient>

      <!-- 边缘压暗：棋墩四周自然阴影 -->
      <radialGradient id="${P("edge")}" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset=".8" stop-color="#2a1408" stop-opacity="0"/>
        <stop offset="1" stop-color="#1a0c04" stop-opacity=".5"/>
      </radialGradient>

      <!-- 木纹主层：垂直长条木纤维。
           baseFreq x=0.005（横向变化极慢 → 长条竖纹），y=0.1（纵向有节奏 → 木纤维纹理）。
           映射成深棕半透明色块，叠在暖底上形成深浅相间的木纹。 -->
      <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.005 0.1" numOctaves="4" seed="12" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.22
          0 0 0 0 0.10
          0 0 0 0 0.03
          0 0 0 0.75 0"/>
      </filter>

      <!-- 细孔层：更细的木纹孔隙，低透明度增加质感 -->
      <filter id="${P("pore")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.22" numOctaves="2" seed="5" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.18
          0 0 0 0 0.08
          0 0 0 0 0.02
          0 0 0 0.4 0"/>
      </filter>

      <!-- 黑子：墨蓝灰/深炭，左上柔和高光（不是死黑） -->
      <radialGradient id="${P("blackStone")}" cx="35%" cy="30%" r="75%">
        <stop offset="0" stop-color="#5a6272"/>
        <stop offset=".2" stop-color="#3a4050"/>
        <stop offset=".5" stop-color="#222630"/>
        <stop offset=".8" stop-color="#14161c"/>
        <stop offset="1" stop-color="#0c0e12"/>
      </radialGradient>

      <!-- 白子：暖白/象牙白，左上柔和高光，边缘微暖 -->
      <radialGradient id="${P("whiteStone")}" cx="35%" cy="30%" r="75%">
        <stop offset="0" stop-color="#fffdf5"/>
        <stop offset=".25" stop-color="#f8f2e4"/>
        <stop offset=".6" stop-color="#e8dcc4"/>
        <stop offset="1" stop-color="#c8b898"/>
      </radialGradient>

      <!-- 棋子投影：高斯模糊柔边 -->
      <filter id="${P("shadow")}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2"/>
      </filter>
    `,

    boardFill: `url(#${P("base")})`,

    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="14" filter="url(#${P("grain")})" opacity=".55" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="14" filter="url(#${P("pore")})" opacity=".35" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("edge")})" pointer-events="none"/>
    `,

    frame: `
      <!-- 外圈宽边：稍深木色，模拟棋墩边缘 -->
      <rect x="1" y="1" width="618" height="618" rx="14" fill="none" stroke="#5a2e10" stroke-width="8" opacity=".5"/>
      <!-- 内圈细线凹槽 -->
      <rect x="20" y="20" width="580" height="580" rx="8" fill="none" stroke="#3a1f0c" stroke-width="1.2" opacity=".45"/>
    `,

    gridExtra: `
      <!-- 棋盘区域内边框：凹槽线围住整个 15 路 -->
      <rect x="46" y="46" width="528" height="528" fill="none" stroke="#3a1f0c" stroke-width="1.2" opacity=".5"/>
    `,

    lineStroke: "#4a2810",
    lineW: 1.1,
    lineOpacity: .75,
    starFill: "#3a1f0c",
    starR: 3.2,

    stone: ({ x, y, r, player, isLast, isWin }) => {
      const g = player === 1 ? P("blackStone") : P("whiteStone");
      const edge = player === 1 ? "#0a0c10" : "#a89878";
      // 投影：偏移右下，深色半透明，高斯模糊 → 棋子浮在棋盘上
      let s = `<circle cx="${x + 2.2}" cy="${y + 3}" r="${r}" fill="#1a0a00" opacity=".4" filter="url(#${P("shadow")})"/>`;
      // 棋子本体
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${edge}" stroke-width="0.6" stroke-opacity=".5"/>`;
      if (isLast) s += `<circle cx="${x}" cy="${y}" r="${r + 1.5}" fill="none" stroke="#d4a060" stroke-width="1" opacity=".5"/>`;
      if (isWin) s += `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#e8b870" stroke-width="1.5" opacity=".9"/>`;
      return s;
    },
  });
})();
