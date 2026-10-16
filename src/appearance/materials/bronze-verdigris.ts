/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   青铜锈绿（verdigris）—— 一面出土的青铜镜 / 青铜器棋盘。

   视觉配方（对照参考图 04-青铜锈绿.png）：
     盘底   深铜绿 #2a4a3f 一带，中心略亮、边缘压暗（古铜镜磨损）
     锈斑   两层 feTurbulence 斑驳：青绿 verdigris + 棕褐锈色，opacity 低
     格线   暗黄铜 #8a7a3a（做旧，不是亮金），笔直规整（铸造感，不手绘抖）
     星位   小金点 #b89a4a，比格线略亮
     棋子   径向渐变模拟金属高光：黑子深铁黑带冷灰高光；白子米白象牙带暖边
     边框   双层描边：外圈深褐近黑、内圈暗金细线

   硬约束自查：
     · defs id 全部走 P() 加 "bronze-" 前缀
     · 不用 Math.random()（锈斑由 feTurbulence seed 确定性生成）
     · 黑子 L≈20、白子 L≈214，ΔL≈194（≥70）；黑子 vs 盘底 L 差 ≈46（≥25）
     · 装饰层 opacity 0.18~0.3，不抢棋子
     · feTurbulence 滤镜 3 个（patina / rust / grain），≤6
     · stone() 用传入的 x/y/r
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const ID = "bronze";
  const P = (n) => `${ID}-${n}`;   // 统一前缀，多皮肤同载不串味

  SKINS.push({
    id: ID,
    name: "青铜锈绿 · 出土铜镜",
    swatch: "#2a4a3f",
    pageBg: "#141f1b",

    vars: {
      "--bd-bg": "#2a4a3f",
      "--bd-line": "#8a7a3a",
      "--bd-star": "#b89a4a",
      "--st-black": "#14141a",
      "--st-white": "#ece3cc",
      "--ui-accent": "#8a7a3a",
      "--bd-radius": "14px",
    },

    defs: `
      <!-- 盘底主渐变：中心略亮（青铜镜磨亮区）→ 边缘深绿暗 -->
      <radialGradient id="${P("base")}" cx="50%" cy="46%" r="72%">
        <stop offset="0" stop-color="#33584a"/>
        <stop offset=".55" stop-color="#2a4a3f"/>
        <stop offset="1" stop-color="#1c352d"/>
      </radialGradient>

      <!-- 边缘压暗：古铜镜四周磨损氧化更深 -->
      <radialGradient id="${P("edge")}" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset=".78" stop-color="#0a1a14" stop-opacity="0"/>
        <stop offset="1" stop-color="#081410" stop-opacity=".55"/>
      </radialGradient>

      <!-- 青绿锈斑（verdigris）：feTurbulence 噪声 → 固定青绿半透明色块 -->
      <filter id="${P("patina")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="4" seed="7" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.30
          0 0 0 0 0.52
          0 0 0 0 0.44
          0 0 0 0.85 0"/>
      </filter>

      <!-- 棕褐锈斑：另一组噪声 seed，铁锈色 -->
      <filter id="${P("rust")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="3" seed="21" result="n"/>
        <feColorMatrix in="n" type="matrix" values="
          0 0 0 0 0.45
          0 0 0 0 0.30
          0 0 0 0 0.16
          0 0 0 0.7 0"/>
      </filter>

      <!-- 细颗粒：铜器表面磨砂质感，低透明度 -->
      <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
        <feColorMatrix in="n" type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope=".09" intercept="0"/></feComponentTransfer>
      </filter>

      <!-- 黑子：深铁黑带冷灰金属高光（左上光源） -->
      <radialGradient id="${P("blackStone")}" cx="35%" cy="28%" r="75%">
        <stop offset="0" stop-color="#4a4a55"/>
        <stop offset=".18" stop-color="#30303a"/>
        <stop offset=".42" stop-color="#1a1a22"/>
        <stop offset=".75" stop-color="#0e0e14"/>
        <stop offset="1" stop-color="#06060a"/>
      </radialGradient>

      <!-- 白子：米白象牙，边缘做旧暖黄（像旧白玉/骨白棋子） -->
      <radialGradient id="${P("whiteStone")}" cx="35%" cy="28%" r="75%">
        <stop offset="0" stop-color="#fdf8e8"/>
        <stop offset=".3" stop-color="#f0e6cc"/>
        <stop offset=".65" stop-color="#d8c8a0"/>
        <stop offset="1" stop-color="#a89060"/>
      </radialGradient>
    `,

    boardFill: `url(#${P("base")})`,

    boardOverlay: `
      <rect x="0" y="0" width="620" height="620" rx="14" filter="url(#${P("patina")})" opacity=".5" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="14" filter="url(#${P("rust")})" opacity=".42" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="14" filter="url(#${P("grain")})" opacity=".45" pointer-events="none"/>
      <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("edge")})" pointer-events="none"/>
    `,

    frame: `
      <rect x="3" y="3" width="614" height="614" rx="14" fill="none" stroke="#1a1410" stroke-width="4" opacity=".7"/>
      <rect x="9" y="9" width="602" height="602" rx="10" fill="none" stroke="#8a7a3a" stroke-width="1.2" opacity=".55"/>
    `,

    gridExtra: `
      <rect x="46" y="46" width="528" height="528" fill="none" stroke="#6b5d2e" stroke-width="1.3" opacity=".65"/>
    `,

    lineStroke: "#8a7a3a",
    lineW: 1.3,
    lineOpacity: .78,
    starFill: "#b89a4a",
    starR: 3.2,

    stone: ({ x, y, r, player, isLast, isWin }) => {
      const g = player === 1 ? P("blackStone") : P("whiteStone");
      const edge = player === 1 ? "#08080c" : "#8a7442";
      let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${edge}" stroke-width="0.8" stroke-opacity=".7"/>`;
      if (isLast) s += `<circle cx="${x}" cy="${y}" r="${r + 1.8}" fill="none" stroke="#d4af5a" stroke-width="1" opacity=".6"/>`;
      if (isWin) s += `<circle cx="${x}" cy="${y}" r="${r + 3.2}" fill="none" stroke="#e8c870" stroke-width="1.6" opacity=".95"/>`;
      return s;
    },
  });
})();
