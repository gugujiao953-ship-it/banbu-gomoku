/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   彩铅 10 版 —— 参考《洛克王国世界》美术：厚涂彩铅 + 卡通描边 + 明快叠色 + 圆润造型。

   识别特征三件套（每版至少用上两件）：
     ① 纸的颗粒      feTurbulence 噪点 + 纸纹 pattern
     ② 笔触的排线叠色  多层 rotate 不同的 hatch pattern + 色块边缘的锯齿笔触
     ③ 手绘勾边      lineFilter 抖动滤镜 + 棋子/格线的描边

   10 版方向各不相同：
     pencil-forest   森林厚涂（牛皮纸底 / 蜡笔厚涂 / 粗黑卡通描边）      ★动
     pencil-berry    甜点奶油（米色绘图纸 / 圆形排线 / 草莓粉彩描边）
     pencil-mint     薄荷花园（灰卡纸 / 细线硬彩铅 / 双线描边）
     pencil-sky      晴空叠涂（粗纹水彩纸 / 混色叠涂 / 彩色描边）        ★动
     pencil-candy    糖果糖球（细纹素描纸 / 硬彩铅细线 / 糖球高光）      ★动
     pencil-stationer文具彩铅（细纹素描纸 / 单色淡彩 + 局部重色 / 双层底框）
     pencil-dusk     暮色纸浆（灰卡纸 / 混色暗调 / 深紫描边）
     pencil-kraft    牛皮单色（牛皮纸 / 单色淡彩 + 局部重色 / 无描边靠色块）
     pencil-ocean    海盐清透（米色绘图纸 / 淡彩排线 / 白色美术描边）    ★动
     pencil-night    夜色蜡笔（黑卡纸 / 蜡笔厚涂 / 荧光叠色）            ★动

   ⚠ 所有 defs id 一律走 P()/Q() 加皮肤前缀：8 个皮肤文件同载入一个文档，
     id 撞了会互相串味（历史上踩过：一个纸纹滤镜糊到所有棋盘上）。
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  /* ── 小工具 ─────────────────────────────────────────────────────────
     P(n)  本皮肤自己的 defs id（主色纸/笔触）
     Q(n)  同皮肤内的次套 id（渐变、滤镜）
     两者都用宿主皮肤 id 当前缀，保证全局唯一。 */
  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    Q: (n) => `${ID}--${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  const GRID_STARS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];

  /* 无障碍：系统要求「减少动态效果」时掐掉这条选择器上的动画。
     每条自带动效（boardMotions / stoneMotions）都要带。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* ═══════════════════════════════════════════════════════════════════
     01 · pencil-forest  森林厚涂
     牛皮纸 + 蜡笔厚涂 + 粗黑卡通描边；靠边缘波浪的厚色块撑出手感。
     ★动：纸面光斑缓慢横扫 + 当前手棋子脉冲光环。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-forest");

    push({
      name: "彩铅 · 森林厚涂",
      swatch: "#6f9b4e",
      pageBg: "#20241a",
      vars: {
        "--bd-bg": "#d9c49a", "--bd-line": "#3f3423", "--bd-star": "#3a3020",
        "--st-black": "#2f3226", "--st-white": "#f3ead6",
        "--ui-accent": "#6f9b4e", "--bd-radius": "18px",
      },
      defs: `
        <pattern id="${P("kraft")}" width="34" height="34" patternUnits="userSpaceOnUse">
          <rect width="34" height="34" fill="#d9c49a"/>
          <path d="M0 11H34M0 25H34" stroke="#bfa476" stroke-width=".7" opacity=".55"/>
          <path d="M9 0V34M23 0V34" stroke="#e3d0a8" stroke-width=".5" opacity=".45"/>
          <path d="M2 4h5M20 30h6" stroke="#b1935f" stroke-width="1" opacity=".3"/>
        </pattern>
        <pattern id="${P("hatchA")}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
          <path d="M0 0V9" stroke="#6f9b4e" stroke-width="3" opacity=".34"/>
        </pattern>
        <pattern id="${P("hatchB")}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(17)">
          <path d="M0 0V10" stroke="#c8892f" stroke-width="2.4" opacity=".26"/>
        </pattern>
        <pattern id="${P("hatchC")}" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(-63)">
          <path d="M0 0V13" stroke="#4f7f3c" stroke-width="2" opacity=".2"/>
        </pattern>
        <pattern id="${P("hatchD")}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(9)">
          <path d="M0 0V16" stroke="#8b6f3e" stroke-width="1.2" opacity=".18"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="3" seed="7" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".16" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="13" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.1" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("edge")}" x="-14%" y="-14%" width="128%" height="128%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="4" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="5.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("crayon")}" x="-35%" y="-35%" width="170%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="31" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="3" result="g"/>
          <feColorMatrix in="g" type="saturate" values="0" result="gg"/>
          <feComponentTransfer in="gg" result="ga"><feFuncA type="linear" slope=".34" intercept=".72"/></feComponentTransfer>
          <feComposite in="d" in2="ga" operator="in"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="78%">
          <stop offset="0" stop-color="#7d8272"/><stop offset=".3" stop-color="#4b5044"/>
          <stop offset=".68" stop-color="#31362b"/><stop offset="1" stop-color="#1d2018"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="78%">
          <stop offset="0" stop-color="#fffdf4"/><stop offset=".32" stop-color="#f6efd9"/>
          <stop offset=".68" stop-color="#ddceac"/><stop offset="1" stop-color="#b0a07c"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("kraft")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("hatchA")})" opacity=".72"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("hatchB")})" opacity=".6"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("hatchC")})" opacity=".55"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("hatchD")})" opacity=".5"/>
        <ellipse class="${P("glow")}" cx="170" cy="200" rx="300" ry="240" fill="#fff3c4" opacity=".2"/>
        <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="15" fill="none" stroke="#6b5738" stroke-width="5.5" filter="url(#${P("edge")})" opacity=".95"/>
        <rect x="14" y="14" width="592" height="592" rx="11" fill="none" stroke="#f2e4bf" stroke-width="2" filter="url(#${P("wob")})" opacity=".7"/>
      `,
      lineStroke: "#3f3423",
      lineW: 1.9,
      lineOpacity: .8,
      lineFilter: P("wob"),
      starFill: "#3a3020",
      starR: 4.1,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#2f2717" stroke-width="3.4" filter="url(#${P("wob")})" opacity=".85"/>
        <path d="M46 46H574V574H46Z" fill="none" stroke="#f6e9c6" stroke-width="1.1" filter="url(#${P("wob")})" opacity=".55"/>
      `,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const line = player === 1 ? "#241f16" : "#9c8b64";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "hatchC" : "hatchB")})" opacity=".3"/>`
              + `<path d="M${x - r * .62} ${y - r * .5}A${r * .92} ${r * .92} 0 0 1 ${x + r * .2} ${y - r * .78}" fill="none" stroke="#fff6dc" stroke-width="${r * .17}" stroke-linecap="round" opacity="${player === 1 ? ".42" : ".72"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${line}" stroke-width="${r * .13}" filter="url(#${P("crayon")})"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .78}" fill="none" stroke="#ffcf4d" stroke-width="${r * .17}"/>`;
        return s;
      },
      /* 原来一整块 css 按「谁在动」拆成两堆，参数一字未改（见 _TEMPLATE.js 的契约）：
           boardMotions → 纸面那团光晕（跟着棋盘走，可单独关）
           stoneMotions → 当前手的脉冲环（跟着棋子走） */
      css: "",
      boardMotions: [{
        id: "bmo-pencil-forest",
        name: "光晕漂移",
        desc: "一团透过树冠的光在纸面上缓慢游走",
        css: () => `
        @keyframes ${P("glowmove")} {
          0%   { transform: translate(-150px, 90px) }
          100% { transform: translate(430px, -40px) }
        }
        #board .${P("glow")} { animation: ${P("glowmove")} 15s ease-in-out infinite alternate; }
        ${RM(`#board .${P("glow")}`)}
      `,
      }],
      stoneMotions: [{
        id: "smo-pencil-forest",
        name: "当前手蜡笔脉冲",
        desc: "最后一手外圈一圈蜡笔色反复胀开（常驻）",
        css: () => `
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.66); opacity: .9 }
          70%  { transform: scale(1.75); opacity: 0 }
          100% { transform: scale(1.75); opacity: 0 }
        }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
        ${RM(`#board #stones .${P("pulse")}`)}
      `,
      }],
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     02 · pencil-berry  甜点奶油
     米色绘图纸 + 圆形（环状）排线 + 草莓粉彩描边；松饼色蕾丝外框。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-berry");

    push({
      name: "彩铅 · 甜点奶油",
      swatch: "#e08aa0",
      pageBg: "#2c2124",
      vars: {
        "--bd-bg": "#fbeedd", "--bd-line": "#a9765f", "--bd-star": "#c9808f",
        "--st-black": "#5a3f45", "--st-white": "#fffaf0",
        "--ui-accent": "#e08aa0", "--bd-radius": "20px",
      },
      defs: `
        <pattern id="${P("paper")}" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#fbeedd"/>
          <path d="M0 7H24M0 18H24" stroke="#e8d3b8" stroke-width=".5" opacity=".5"/>
          <path d="M12 0V24" stroke="#f1e0c8" stroke-width=".45" opacity=".45"/>
        </pattern>
        <pattern id="${P("ring")}" width="19" height="19" patternUnits="userSpaceOnUse">
          <path d="M9.5 2.5a3 3 0 1 0 .001 0M9.5 7.2a2 2 0 1 0 .001 0" fill="none" stroke="#e894aa" stroke-width="3" opacity=".34"/>
        </pattern>
        <pattern id="${P("swirl")}" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M3 21c0-8 4-12 9-12s9 4 9 12" fill="none" stroke="#a8cbe0" stroke-width="3" opacity=".28"/>
        </pattern>
        <pattern id="${P("hatch")}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <path d="M0 0V9" stroke="#dd9db0" stroke-width="2.6" opacity=".2"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="19" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".1" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="9" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.7" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("soft")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="23" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("lace")}" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="turbulence" baseFrequency=".12" numOctaves="2" seed="6" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="33%" cy="24%" r="80%">
          <stop offset="0" stop-color="#9c7a78"/><stop offset=".3" stop-color="#6d4f52"/>
          <stop offset=".7" stop-color="#543b41"/><stop offset="1" stop-color="#3a2830"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="33%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#fff6ef"/>
          <stop offset=".72" stop-color="#f4dddc"/><stop offset="1" stop-color="#d9b7b8"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("paper")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("ring")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("swirl")})" opacity=".7"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("hatch")})" opacity=".6"/>
        <circle class="${P("berry")}" style="--i:0" cx="120" cy="120" r="9" fill="#f2a9b8" opacity=".45"/>
        <circle class="${P("berry")}" style="--i:1" cx="500" cy="150" r="7" fill="#a8cbe0" opacity=".45"/>
        <circle class="${P("berry")}" style="--i:2" cx="140" cy="500" r="8" fill="#f5cf94" opacity=".45"/>
        <circle class="${P("berry")}" style="--i:3" cx="510" cy="500" r="6" fill="#b7dca6" opacity=".45"/>
        <rect x="0" y="0" width="620" height="620" rx="20" filter="url(#${P("grain")})" opacity=".55" pointer-events="none"/>
      `,
      frame: `
        <rect x="9" y="9" width="602" height="602" rx="16" fill="none" stroke="#e08aa0" stroke-width="5" filter="url(#${P("lace")})" opacity=".9" stroke-dasharray="9 4"/>
        <rect x="15" y="15" width="590" height="590" rx="13" fill="none" stroke="#b8768a" stroke-width="1.6" filter="url(#${P("wob")})" opacity=".7"/>
      `,
      lineStroke: "#b07e66",
      lineW: 1.15,
      lineOpacity: .66,
      lineFilter: P("wob"),
      starFill: "#c9808f",
      starR: 3.6,
      gridExtra: GRID_STARS.map(([r, c]) => {
        const x = 46 + c * ((620 - 92) / 14), y = 46 + r * ((620 - 92) / 14);
        return `<circle cx="${x}" cy="${y}" r="8.2" fill="none" stroke="#e6a7b6" stroke-width="1.2" opacity=".55"/>`;
      }).join(""),
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#4a3237" : "#c08e97";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("soft")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r * .74}" fill="url(#${P("ring")})" opacity="${player === 1 ? ".22" : ".4"}"/>`
              + `<ellipse cx="${x - r * .34}" cy="${y - r * .36}" rx="${r * .3}" ry="${r * .21}" fill="#fff" opacity="${player === 1 ? ".3" : ".85"}" transform="rotate(-32 ${x - r * .34} ${y - r * .36})"/>`
              + `<circle cx="${x - r * .52}" cy="${y - r * .52}" r="${r * .1}" fill="#fff" opacity="${player === 1 ? ".45" : ".95"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${edge}" stroke-width="${r * .1}" opacity=".8"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .82}" fill="none" stroke="#ff9fb6" stroke-width="${r * .16}" stroke-dasharray="${r * .5} ${r * .3}"/>`;
        return s;
      },
      css: "",
      boardMotions: [{
        id: "bmo-pencil-berry",
        name: "糖粒浮动",
        desc: "四颗糖珠各自缓慢浮游，按索引错开相位",
        css: () => `
        /* 四颗各走各的：同步平移会一眼看成"整块板在动"。
           位移收到 5px 以内、周期 14s —— 背景级的动，不抢棋。 */
        @keyframes ${P("float")} {
          0%,100% { transform: translate(0,0) }
          25%     { transform: translate(3px,-4px) }
          50%     { transform: translate(5px,1px) }
          75%     { transform: translate(2px,4px) }
        }
        #board .${P("berry")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("float")} 14s ease-in-out infinite;
          animation-delay: calc(var(--i) * -3.7s);
        }
        ${RM(`#board .${P("berry")}`)}
      `,
      }],
      stoneMotions: [{
        id: "smo-pencil-berry",
        name: "当前手糖霜脉冲 · 自转",
        desc: "最后一手的虚线圈一边胀开一边转（常驻）",
        css: () => `
        @keyframes ${P("spin")} { to { transform: rotate(360deg) } }
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.7); opacity: .95 }
          100% { transform: scale(1.9); opacity: 0 }
        }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.6s ease-out infinite, ${P("spin")} 5s linear infinite;
        }
        ${RM(`#board #stones .${P("pulse")}`)}
      `,
      }],
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     03 · pencil-mint  薄荷花园
     灰卡纸 + 细硬彩铅排线 + 双线描边（深绿外线 / 白内线）；藤蔓小叶子外框。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-mint");

    push({
      name: "彩铅 · 薄荷花园",
      swatch: "#5fa98a",
      pageBg: "#1e2823",
      vars: {
        "--bd-bg": "#dfe4d6", "--bd-line": "#4b6553", "--bd-star": "#3f6b52",
        "--st-black": "#31463c", "--st-white": "#f7f7ee",
        "--ui-accent": "#5fa98a", "--bd-radius": "16px",
      },
      defs: `
        <pattern id="${P("card")}" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#dfe4d6"/>
          <path d="M0 14H28" stroke="#c8d0bc" stroke-width=".6" opacity=".5"/>
          <path d="M14 0V28" stroke="#eef1e6" stroke-width=".5" opacity=".5"/>
          <path d="M3 24h4M21 5h4" stroke="#b9c2ae" stroke-width=".9" opacity=".4"/>
        </pattern>
        <pattern id="${P("fineA")}" width="5.5" height="5.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-36)">
          <path d="M0 0V5.5" stroke="#5fa98a" stroke-width="1.1" opacity=".38"/>
        </pattern>
        <pattern id="${P("fineB")}" width="6.5" height="6.5" patternUnits="userSpaceOnUse" patternTransform="rotate(31)">
          <path d="M0 0V6.5" stroke="#8ba86a" stroke-width="1" opacity=".3"/>
        </pattern>
        <pattern id="${P("fineC")}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(84)">
          <path d="M0 0V12" stroke="#3f6b52" stroke-width=".9" opacity=".2"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.05" numOctaves="3" seed="27" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".12" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="17" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("pencil")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="41" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="25%" r="78%">
          <stop offset="0" stop-color="#77907f"/><stop offset=".32" stop-color="#4b6455"/>
          <stop offset=".7" stop-color="#33473c"/><stop offset="1" stop-color="#22322a"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="25%" r="78%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f7f8ee"/>
          <stop offset=".7" stop-color="#e0e5d4"/><stop offset="1" stop-color="#bcc4ab"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("card")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("fineA")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("fineB")})" opacity=".75"/>
        <rect x="0" y="0" width="620" height="620" rx="16" fill="url(#${P("fineC")})" opacity=".6"/>
        <path d="M96 96c0-30 30-30 30 0s-30 30-30 0Z" fill="none" stroke="#7fae7a" stroke-width="1.3" opacity=".5"/>
        <path d="M494 96c0-30 30-30 30 0s-30 30-30 0Z" fill="none" stroke="#7fae7a" stroke-width="1.3" opacity=".5"/>
        <path d="M96 494c0-30 30-30 30 0s-30 30-30 0Z" fill="none" stroke="#7fae7a" stroke-width="1.3" opacity=".5"/>
        <path d="M494 494c0-30 30-30 30 0s-30 30-30 0Z" fill="none" stroke="#7fae7a" stroke-width="1.3" opacity=".5"/>
        <path d="M310 84c22-14 40-6 44 10-18 8-36 4-44-10Z" fill="#8fc188" opacity=".45"/>
        <path d="M310 536c22 14 40 6 44-10-18-8-36-4-44 10Z" fill="#8fc188" opacity=".45"/>
        <rect x="0" y="0" width="620" height="620" rx="16" filter="url(#${P("grain")})" opacity=".55" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="11" fill="none" stroke="#3f6b52" stroke-width="4.6" filter="url(#${P("wob")})"/>
        <rect x="14.5" y="14.5" width="591" height="591" rx="8" fill="none" stroke="#f4f7ea" stroke-width="2" filter="url(#${P("wob")})" opacity=".85"/>
        <rect x="19" y="19" width="582" height="582" rx="6" fill="none" stroke="#6f9a7c" stroke-width="1" filter="url(#${P("wob")})" opacity=".6"/>
      `,
      lineStroke: "#4b6553",
      lineW: 1,
      lineOpacity: .72,
      lineFilter: P("wob"),
      starFill: "#3f6b52",
      starR: 3.1,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#2f5340" stroke-width="2.6" filter="url(#${P("wob")})" opacity=".9"/>
        <path d="M51 51H569V569H51Z" fill="none" stroke="#ffffff" stroke-width="1" filter="url(#${P("wob")})" opacity=".7"/>
      `,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#1e2c24" : "#7d8a6b";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("pencil")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r * .8}" fill="url(#${P(player === 1 ? "fineA" : "fineB")})" opacity=".55"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="none"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#24382c" stroke-width="${r * .1}" filter="url(#${P("pencil")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r - r * .16}" fill="none" stroke="#ffffff" stroke-width="${r * .035}" opacity="${player === 1 ? ".55" : ".9"}"/>`
              + `<path d="M${x - r * .5} ${y - r * .58}q${r * .5} -${r * .34} ${r * .95} 0" fill="none" stroke="#fff" stroke-width="${r * .1}" stroke-linecap="round" opacity="${player === 1 ? ".35" : ".8"}"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#8fe0b4" stroke-width="${r * .14}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.75); opacity: .95 }
          100% { transform: scale(1.85); opacity: 0 }
        }
        @keyframes ${P("line")} { to { stroke-dashoffset: -${2 * (3.14159 * 46)} } }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     04 · pencil-sky  晴空叠涂
     粗纹水彩纸 + 蓝/白/黄三色混色叠涂 + 彩色（群青）描边；云朵外框。
     ★动：云影在纸面上缓慢飘移 + 淡云从棋盘上掠过。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-sky");

    push({
      name: "彩铅 · 晴空叠涂",
      swatch: "#5b93d6",
      pageBg: "#1b2436",
      vars: {
        "--bd-bg": "#e8eef7", "--bd-line": "#3f5f92", "--bd-star": "#3f6fb5",
        "--st-black": "#2f4a70", "--st-white": "#fbfcff",
        "--ui-accent": "#5b93d6", "--bd-radius": "22px",
      },
      defs: `
        <pattern id="${P("wc")}" width="30" height="30" patternUnits="userSpaceOnUse">
          <rect width="30" height="30" fill="#e8eef7"/>
          <path d="M0 15H30" stroke="#cfdaeb" stroke-width=".8" opacity=".55"/>
          <path d="M15 0V30" stroke="#f4f8ff" stroke-width=".7" opacity=".55"/>
          <path d="M4 25a3 3 0 0 1 4-4" fill="none" stroke="#c2cfe4" stroke-width="1" opacity=".5"/>
        </pattern>
        <pattern id="${P("lay1")}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
          <ellipse cx="7" cy="7" rx="6" ry="9" fill="#5b93d6" opacity=".16"/>
        </pattern>
        <pattern id="${P("lay2")}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(47)">
          <ellipse cx="9" cy="9" rx="8" ry="6" fill="#8fc0ea" opacity=".2"/>
        </pattern>
        <pattern id="${P("lay3")}" width="26" height="26" patternUnits="userSpaceOnUse">
          <ellipse cx="13" cy="13" rx="11" ry="8" fill="#ffd97a" opacity=".13"/>
        </pattern>
        <pattern id="${P("hatch")}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(62)">
          <path d="M0 0V7" stroke="#4a7fc4" stroke-width="1.6" opacity=".22"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".4" numOctaves="4" seed="5" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".14" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="29" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("mix")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="3" seed="11" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("cloud")}" x="-60%" y="-60%" width="220%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency=".016" numOctaves="3" seed="8" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="42" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feGaussianBlur in="d" stdDeviation="13" result="b"/>
          <feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="3" seed="15" result="m"/>
          <feColorMatrix in="m" type="saturate" values="0" result="mm"/>
          <feComponentTransfer in="mm" result="ma"><feFuncA type="linear" slope=".55" intercept=".5"/></feComponentTransfer>
          <feComposite in="b" in2="ma" operator="in"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#6f8cb8"/><stop offset=".32" stop-color="#456596"/>
          <stop offset=".7" stop-color="#2f4a74"/><stop offset="1" stop-color="#20334f"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#f9fbff"/>
          <stop offset=".72" stop-color="#dfe8f7"/><stop offset="1" stop-color="#b6c6e0"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("wc")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("lay1")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("lay2")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("lay3")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("hatch")})" opacity=".55"/>
        <path class="${P("cloud")}" d="M60 190c26-30 70-26 84-4 16-22 58-20 68 6 20-8 44 10 38 30-8 22-52 24-96 18-52-6-108-20-94-50Z" fill="#ffffff" opacity=".85" filter="url(#${P("cloud")})"/>
        <path class="${P("cloud")}" d="M300 130c22-26 60-22 72-3 14-19 50-17 58 5 17-7 38 8 33 26-7 19-45 21-83 16-45-5-92-17-80-44Z" fill="#eef5ff" opacity=".8" filter="url(#${P("cloud")})"/>
        <path class="${P("cloud2")}" d="M320 430c24-28 66-24 78-4 15-20 54-18 64 6 18-8 40 9 35 28-8 20-48 22-90 17-48-6-100-19-87-47Z" fill="#ffffff" opacity=".7" filter="url(#${P("cloud")})"/>
        <path class="${P("cloud2")}" d="M40 470c22-26 58-22 70-3 13-18 48-16 56 5 16-7 36 8 31 25-7 18-43 20-80 15-43-5-88-16-77-42Z" fill="#eef5ff" opacity=".65" filter="url(#${P("cloud")})"/>
        <rect x="0" y="0" width="620" height="620" rx="22" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="18" fill="none" stroke="#3f6fb5" stroke-width="5" filter="url(#${P("wob")})" opacity=".92"/>
        <path d="M20 46c14-16 34-14 42-2 10-12 30-10 34 4" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
        <path d="M520 590c14-16 34-14 42-2" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
      `,
      lineStroke: "#3f5f92",
      lineW: 1.35,
      lineOpacity: .7,
      lineFilter: P("wob"),
      starFill: "#3f6fb5",
      starR: 3.3,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#1f3350" : "#7f95b8";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("mix")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "lay2" : "lay3")})" opacity=".8"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P("hatch")})" opacity=".5"/>`
              + `<ellipse cx="${x - r * .3}" cy="${y - r * .32}" rx="${r * .34}" ry="${r * .2}" fill="#fff" opacity="${player === 1 ? ".35" : ".9"}" transform="rotate(-35 ${x - r * .3} ${y - r * .32})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#2f6fc4" stroke-width="${r * .12}" filter="url(#${P("mix")})" opacity=".9"/>`
              + `<circle cx="${x}" cy="${y}" r="${r * .84}" fill="none" stroke="#ffffff" stroke-width="${r * .04}" opacity=".5"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#3f86e0" stroke-width="${r * .16}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("drift")} {
          0%   { transform: translate(-120px, 40px) }
          100% { transform: translate(420px, -30px) }
        }
        @keyframes ${P("drift2")} {
          0%   { transform: translate(140px, -60px) }
          100% { transform: translate(-360px, 50px) }
        }
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.72); opacity: .95 }
          100% { transform: scale(1.8); opacity: 0 }
        }
        #board .${P("cloud")}  { animation: ${P("drift")} 21s ease-in-out infinite alternate; }
        #board .${P("cloud2")} { animation: ${P("drift2")} 27s ease-in-out infinite alternate; }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     05 · pencil-candy  糖果糖球
     细纹素描纸 + 硬彩铅细线 + 糖球高光点；糖针外框。
     ★动：糖果色光带在纸上缓慢流转 + 当前手糖球脉冲。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-candy");

    push({
      name: "彩铅 · 糖果糖球",
      swatch: "#f2879f",
      pageBg: "#2a1f2b",
      vars: {
        "--bd-bg": "#fdf6f0", "--bd-line": "#9a6b7e", "--bd-star": "#e0748f",
        "--st-black": "#5d3a58", "--st-white": "#fff8fb",
        "--ui-accent": "#f2879f", "--bd-radius": "22px",
      },
      defs: `
        <pattern id="${P("pad")}" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#fdf6f0"/>
          <path d="M0 10H20" stroke="#efe0d6" stroke-width=".45" opacity=".55"/>
          <path d="M10 0V20" stroke="#f6eae2" stroke-width=".4" opacity=".5"/>
        </pattern>
        <pattern id="${P("candy1")}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <circle cx="4" cy="4" r="3" fill="#f24f7a" opacity=".3"/>
          <circle cx="11" cy="11" r="2.4" fill="#ffb02e" opacity=".3"/>
        </pattern>
        <pattern id="${P("candy2")}" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="3.4" fill="#3fc1b6" opacity=".26"/>
          <circle cx="16" cy="15" r="2.6" fill="#9b6fe0" opacity=".26"/>
          <circle cx="3" cy="17" r="2" fill="#ffd94a" opacity=".3"/>
        </pattern>
        <pattern id="${P("fine")}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <path d="M0 0V5" stroke="#e093ab" stroke-width=".9" opacity=".3"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="37" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".09" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="3" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("sugar")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="2" seed="47" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <linearGradient id="${Q("sheen")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffd9e6" stop-opacity=".75"/>
          <stop offset=".5" stop-color="#fffbe8" stop-opacity=".25"/>
          <stop offset="1" stop-color="#a8e4f0" stop-opacity=".6"/>
        </linearGradient>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#b07ea4"/><stop offset=".3" stop-color="#835076"/>
          <stop offset=".7" stop-color="#613a58"/><stop offset="1" stop-color="#432840"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".32" stop-color="#fff6fa"/>
          <stop offset=".7" stop-color="#f7dbec"/><stop offset="1" stop-color="#d5aec7"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("pad")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("candy1")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("candy2")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="22" fill="url(#${P("fine")})" opacity=".7"/>
        <ellipse class="${P("sheen")}" cx="150" cy="200" rx="300" ry="230" fill="url(#${Q("sheen")})" opacity=".35"/>
        <rect x="0" y="0" width="620" height="620" rx="22" filter="url(#${P("grain")})" opacity=".5" pointer-events="none"/>
      `,
      frame: `
        <rect x="9" y="9" width="602" height="602" rx="18" fill="none" stroke="#f2879f" stroke-width="5.4" filter="url(#${P("wob")})"/>
        <rect x="15.5" y="15.5" width="589" height="589" rx="14" fill="none" stroke="#ffd94a" stroke-width="2.2" filter="url(#${P("wob")})" opacity=".85"/>
        <circle cx="34" cy="34" r="4" fill="#3fc1b6" opacity=".7"/>
        <circle cx="586" cy="34" r="4" fill="#9b6fe0" opacity=".7"/>
        <circle cx="34" cy="586" r="4" fill="#ffb02e" opacity=".7"/>
        <circle cx="586" cy="586" r="4" fill="#f24f7a" opacity=".7"/>
      `,
      lineStroke: "#9a6b7e",
      lineW: 1.05,
      lineOpacity: .68,
      lineFilter: P("wob"),
      starFill: "#e0748f",
      starR: 3.5,
      gridExtra: GRID_STARS.map(([r, c]) => {
        const x = 46 + c * ((620 - 92) / 14), y = 46 + r * ((620 - 92) / 14);
        return `<path d="M${x} ${y - 7.5}L${x + 2.2} ${y - 2.2}L${x + 7.5} ${y}L${x + 2.2} ${y + 2.2}L${x} ${y + 7.5}L${x - 2.2} ${y + 2.2}L${x - 7.5} ${y}L${x - 2.2} ${y - 2.2}Z" fill="#e0748f" opacity=".5"/>`;
      }).join(""),
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#3f2440" : "#c07fa2";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("sugar")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "candy2" : "candy1")})" opacity=".5"/>`
              + `<ellipse cx="${x - r * .34}" cy="${y - r * .34}" rx="${r * .3}" ry="${r * .2}" fill="#fff" opacity="${player === 1 ? ".42" : ".95"}" transform="rotate(-38 ${x - r * .34} ${y - r * .34})"/>`
              + `<circle cx="${x - r * .56}" cy="${y - r * .54}" r="${r * .09}" fill="#fff" opacity="${player === 1 ? ".55" : ".95"}"/>`
              + `<circle cx="${x + r * .4}" cy="${y + r * .46}" r="${r * .065}" fill="#fff" opacity=".5"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${edge}" stroke-width="${r * .1}" filter="url(#${P("sugar")})"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#ff7ea6" stroke-width="${r * .15}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("sheenmove")} {
          0%   { transform: translate(-160px, 60px) scale(1) }
          100% { transform: translate(400px, -40px) scale(1.15) }
        }
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.7); opacity: 1 }
          100% { transform: scale(1.9); opacity: 0 }
        }
        #board .${P("sheen")} { animation: ${P("sheenmove")} 13s ease-in-out infinite alternate; }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.4s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     06 · pencil-stationer  文具彩铅
     细纹素描纸 + 单色淡彩 + 局部重色（角上压深、中央留白）+ 双层底框；
     副色是格尺蓝，整体像作业本上的铅笔草图。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-stationer");

    push({
      name: "彩铅 · 文具手账",
      swatch: "#4f6fd0",
      pageBg: "#20222b",
      vars: {
        "--bd-bg": "#eff2f7", "--bd-line": "#54617e", "--bd-star": "#3f5390",
        "--st-black": "#333c52", "--st-white": "#fafbff",
        "--ui-accent": "#4f6fd0", "--bd-radius": "12px",
      },
      defs: `
        <pattern id="${P("note")}" width="22" height="22" patternUnits="userSpaceOnUse">
          <rect width="22" height="22" fill="#eff2f7"/>
          <path d="M0 7H22M0 16H22" stroke="#ccd6e6" stroke-width=".5" opacity=".55"/>
          <path d="M8 0V22M19 0V22" stroke="#e4eaf4" stroke-width=".4" opacity=".5"/>
        </pattern>
        <pattern id="${P("pale")}" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-42)">
          <path d="M0 0V11" stroke="#4f6fd0" stroke-width="2.4" opacity=".16"/>
        </pattern>
        <pattern id="${P("pale2")}" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(41)">
          <path d="M0 0V13" stroke="#7a8fbf" stroke-width="1.8" opacity=".16"/>
        </pattern>
        <linearGradient id="${P("vign")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3d4a72" stop-opacity=".26"/>
          <stop offset=".38" stop-color="#3d4a72" stop-opacity="0"/>
          <stop offset=".62" stop-color="#3d4a72" stop-opacity="0"/>
          <stop offset="1" stop-color="#3d4a72" stop-opacity=".3"/>
        </linearGradient>
        <linearGradient id="${P("vign2")}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#3d4a72" stop-opacity=".22"/>
          <stop offset=".32" stop-color="#3d4a72" stop-opacity="0"/>
          <stop offset=".68" stop-color="#3d4a72" stop-opacity="0"/>
          <stop offset="1" stop-color="#3d4a72" stop-opacity=".26"/>
        </linearGradient>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="2" seed="53" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".1" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".038" numOctaves="2" seed="21" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("hard")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="2" seed="59" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.15" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#7b87a5"/><stop offset=".32" stop-color="#4d5871"/>
          <stop offset=".7" stop-color="#374158"/><stop offset="1" stop-color="#252c3d"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#f8faff"/>
          <stop offset=".72" stop-color="#e2e8f4"/><stop offset="1" stop-color="#b9c3d8"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("note")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("pale")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("pale2")})" opacity=".75"/>
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("vign")})"/>
        <rect x="0" y="0" width="620" height="620" rx="12" fill="url(#${P("vign2")})"/>
        <rect x="0" y="0" width="620" height="620" rx="12" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="8" fill="none" stroke="#3f5390" stroke-width="3.6" filter="url(#${P("wob")})"/>
        <rect x="15" y="15" width="590" height="590" rx="6" fill="none" stroke="#8d9dc4" stroke-width="1.4" filter="url(#${P("wob")})" opacity=".8"/>
        <path d="M52 32h64M52 588h64M452 32h64M452 588h64" stroke="#4f6fd0" stroke-width="1.6" opacity=".35" filter="url(#${P("wob")})"/>
      `,
      lineStroke: "#54617e",
      lineW: 1.05,
      lineOpacity: .72,
      lineFilter: P("wob"),
      starFill: "#3f5390",
      starR: 3.2,
      gridExtra: `
        <path d="M46 46H574V574H46Z" fill="none" stroke="#3b4a78" stroke-width="2.2" filter="url(#${P("wob")})" opacity=".85"/>
        <path d="M49 49H571V571H49Z" fill="none" stroke="#a9b6d6" stroke-width=".9" filter="url(#${P("wob")})" opacity=".7"/>
      `,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#2b3348" : "#8794b3";
        const inner = P(player === 1 ? "pale" : "pale2");
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("hard")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${inner})" opacity=".7"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#1f2740" stroke-width="${r * .11}" filter="url(#${P("hard")})" opacity="${player === 1 ? ".95" : ".55"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r - r * .18}" fill="none" stroke="#c9d3ea" stroke-width="${r * .03}" opacity="${player === 1 ? ".5" : ".85"}"/>`
              + `<path d="M${x - r * .48} ${y - r * .6}a${r * .72} ${r * .72} 0 0 1 ${r * .9} -.1" fill="none" stroke="#fff" stroke-width="${r * .08}" stroke-linecap="round" opacity="${player === 1 ? ".3" : ".75"}"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#6f8fe8" stroke-width="${r * .14}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.74); opacity: .9 }
          100% { transform: scale(1.8); opacity: 0 }
        }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     07 · pencil-dusk  暮色纸浆
     灰卡纸 + 混色暗调（紫/棕/蓝三色叠涂）+ 深紫描边；冷调暮色，最暗的一版。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-dusk");

    push({
      name: "彩铅 · 暮色混色",
      swatch: "#7d6fb0",
      pageBg: "#1c1a26",
      vars: {
        "--bd-bg": "#cec8d6", "--bd-line": "#4a4360", "--bd-star": "#453a63",
        "--st-black": "#2b2740", "--st-white": "#efeaf5",
        "--ui-accent": "#7d6fb0", "--bd-radius": "18px",
      },
      defs: `
        <pattern id="${P("pulp")}" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="#cec8d6"/>
          <path d="M0 13H26" stroke="#b8b1c6" stroke-width=".7" opacity=".5"/>
          <path d="M13 0V26" stroke="#ddd8e6" stroke-width=".6" opacity=".5"/>
          <path d="M3 21h6M17 4h5" stroke="#a49cba" stroke-width="1" opacity=".35"/>
        </pattern>
        <pattern id="${P("mixA")}" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <ellipse cx="7.5" cy="7.5" rx="6" ry="10" fill="#7d6fb0" opacity=".2"/>
        </pattern>
        <pattern id="${P("mixB")}" width="19" height="19" patternUnits="userSpaceOnUse" patternTransform="rotate(52)">
          <ellipse cx="9.5" cy="9.5" rx="8" ry="6" fill="#b0705f" opacity=".18"/>
        </pattern>
        <pattern id="${P("mixC")}" width="23" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(-70)">
          <path d="M0 0V23" stroke="#5f6fa8" stroke-width="5" opacity=".16"/>
        </pattern>
        <pattern id="${P("hatch")}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(34)">
          <path d="M0 0V8" stroke="#5b4f80" stroke-width="1.5" opacity=".24"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="61" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".16" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".025" numOctaves="3" seed="33" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.8" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("blend")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1" numOctaves="3" seed="67" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.9" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="33%" cy="24%" r="80%">
          <stop offset="0" stop-color="#6d6488"/><stop offset=".32" stop-color="#443d5f"/>
          <stop offset=".7" stop-color="#302b46"/><stop offset="1" stop-color="#201d30"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="33%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#f1ecf7"/>
          <stop offset=".72" stop-color="#d5cde0"/><stop offset="1" stop-color="#a89fbb"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("pulp")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("mixA")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("mixB")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("mixC")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("hatch")})" opacity=".6"/>
        <ellipse cx="450" cy="160" rx="220" ry="170" fill="#e5b96a" opacity=".16"/>
        <ellipse cx="140" cy="470" rx="230" ry="180" fill="#5f6fa8" opacity=".16"/>
        <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("grain")})" opacity=".6" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="13" fill="none" stroke="#453a63" stroke-width="5.2" filter="url(#${P("wob")})" opacity=".95"/>
        <rect x="15" y="15" width="590" height="590" rx="10" fill="none" stroke="#e0d4f0" stroke-width="1.5" filter="url(#${P("wob")})" opacity=".6"/>
      `,
      lineStroke: "#4a4360",
      lineW: 1.3,
      lineOpacity: .68,
      lineFilter: P("wob"),
      starFill: "#453a63",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const edge = player === 1 ? "#1a1728" : "#8a80a5";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("blend")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "mixC" : "mixB")})" opacity=".85"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P("hatch")})" opacity=".6"/>`
              + `<path d="M${x - r * .6} ${y - r * .46}A${r * .9} ${r * .9} 0 0 1 ${x + r * .12} ${y - r * .8}" fill="none" stroke="#efe6ff" stroke-width="${r * .14}" stroke-linecap="round" opacity="${player === 1 ? ".45" : ".8"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#2a2440" stroke-width="${r * .13}" filter="url(#${P("blend")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r * .82}" fill="none" stroke="#d9cdf0" stroke-width="${r * .035}" opacity=".5"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#ffd270" stroke-width="${r * .15}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.72); opacity: .9 }
          100% { transform: scale(1.85); opacity: 0 }
        }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.6s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     08 · pencil-kraft  牛皮单色
     牛皮纸 + 单色（棕）淡彩 + 局部重色（四角深棕码口）+ 无描边靠色块分界；
     棋子是手撕纸块质感，最朴素、最像真的画在牛皮纸上。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-kraft");

    push({
      name: "彩铅 · 牛皮单色",
      swatch: "#9a7443",
      pageBg: "#241d14",
      vars: {
        "--bd-bg": "#c8a476", "--bd-line": "#5f4a2c", "--bd-star": "#4d3c22",
        "--st-black": "#33291c", "--st-white": "#efe2c8",
        "--ui-accent": "#9a7443", "--bd-radius": "10px",
      },
      defs: `
        <pattern id="${P("kraft")}" width="30" height="30" patternUnits="userSpaceOnUse">
          <rect width="30" height="30" fill="#c8a476"/>
          <path d="M0 9H30M0 22H30" stroke="#b08f61" stroke-width=".8" opacity=".5"/>
          <path d="M8 0V30M22 0V30" stroke="#d6b98e" stroke-width=".6" opacity=".45"/>
          <path d="M2 3h7M21 27h7" stroke="#a07d4e" stroke-width="1.2" opacity=".35"/>
        </pattern>
        <pattern id="${P("paleA")}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
          <path d="M0 0V12" stroke="#8a6a3c" stroke-width="3.4" opacity=".22"/>
        </pattern>
        <pattern id="${P("paleB")}" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(44)">
          <path d="M0 0V15" stroke="#6b5228" stroke-width="2" opacity=".18"/>
        </pattern>
        <pattern id="${P("hair")}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 0V6" stroke="#7a5c2e" stroke-width=".8" opacity=".28"/>
        </pattern>
        <radialGradient id="${P("corner")}" cx="50%" cy="50%" r="72%">
          <stop offset="0" stop-color="#4d3a1c" stop-opacity="0"/>
          <stop offset=".52" stop-color="#4d3a1c" stop-opacity="0"/>
          <stop offset="1" stop-color="#4d3a1c" stop-opacity=".42"/>
        </radialGradient>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".48" numOctaves="4" seed="71" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".2" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="43" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("rip")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="3" seed="77" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <radialGradient id="${Q("dark")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#6b5a42"/><stop offset=".34" stop-color="#4b3d29"/>
          <stop offset=".72" stop-color="#382d1d"/><stop offset="1" stop-color="#251d12"/>
        </radialGradient>
        <radialGradient id="${Q("lamp")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#fff6e0"/><stop offset=".36" stop-color="#f2e2c4"/>
          <stop offset=".74" stop-color="#dfc79c"/><stop offset="1" stop-color="#b99a6b"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("kraft")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("paleA")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("paleB")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("hair")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" rx="10" fill="url(#${P("corner")})"/>
        <rect x="0" y="0" width="620" height="620" rx="10" filter="url(#${P("grain")})" opacity=".65" pointer-events="none"/>
      `,
      frame: `
        <rect x="9" y="9" width="602" height="602" rx="8" fill="none" stroke="#5a462a" stroke-width="2.6" filter="url(#${P("wob")})" opacity=".7" stroke-dasharray="26 5 12 5"/>
      `,
      lineStroke: "#5f4a2c",
      lineW: 1.45,
      lineOpacity: .62,
      lineFilter: P("wob"),
      starFill: "#4d3c22",
      starR: 3.6,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "dark" : "lamp")})`;
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "paleB" : "paleA")})" opacity=".55"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P("hair")})" opacity=".7"/>`
              + `<path d="M${x - r * .58} ${y - r * .5}A${r * .92} ${r * .92} 0 0 1 ${x + r * .16} ${y - r * .8}" fill="none" stroke="#fff2d6" stroke-width="${r * .13}" stroke-linecap="round" opacity="${player === 1 ? ".35" : ".7"}"/>`
              + `<path d="M${x - r * .66} ${y + r * .52}a${r} ${r} 0 0 0 ${r * 1.32} 0" fill="none" stroke="#2a2014" stroke-width="${r * .16}" stroke-linecap="round" opacity="${player === 1 ? ".5" : ".28"}" filter="url(#${P("rip")})"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .78}" fill="none" stroke="#ffca5c" stroke-width="${r * .16}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.72); opacity: .95 }
          100% { transform: scale(1.85); opacity: 0 }
        }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     09 · pencil-ocean  海盐清透
     米色绘图纸 + 淡彩排线 + 白色美术描边（最明亮干净的一版）；细浪外框。
     ★动：水面光带斜向缓慢扫过 + 当前手白圈脉冲。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-ocean");

    push({
      name: "彩铅 · 海盐清透",
      swatch: "#3fa8a0",
      pageBg: "#17282a",
      vars: {
        "--bd-bg": "#eaf5f6", "--bd-line": "#4b8a92", "--bd-star": "#2f8a86",
        "--st-black": "#2b5560", "--st-white": "#fbfefe",
        "--ui-accent": "#3fa8a0", "--bd-radius": "20px",
      },
      defs: `
        <pattern id="${P("draw")}" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#eaf5f6"/>
          <path d="M0 12H24" stroke="#d3e8ea" stroke-width=".55" opacity=".55"/>
          <path d="M12 0V24" stroke="#f4fbfc" stroke-width=".5" opacity=".55"/>
        </pattern>
        <pattern id="${P("waveA")}" width="34" height="17" patternUnits="userSpaceOnUse">
          <path d="M0 13c4-7 12-7 17 0s13 7 17 0" fill="none" stroke="#3fa8a0" stroke-width="2" opacity=".26"/>
        </pattern>
        <pattern id="${P("waveB")}" width="46" height="23" patternUnits="userSpaceOnUse" patternTransform="translate(12 5)">
          <path d="M0 17c6-9 16-9 23 0s17 9 23 0" fill="none" stroke="#6fc9d6" stroke-width="2.6" opacity=".22"/>
        </pattern>
        <pattern id="${P("hatch")}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)">
          <path d="M0 0V8" stroke="#3fa8a0" stroke-width="1.5" opacity=".24"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".78" numOctaves="3" seed="83" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".1" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".034" numOctaves="2" seed="57" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="1.8" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("wet")}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.35" numOctaves="2" seed="91" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("sheen")}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="9"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#6f9bab"/><stop offset=".32" stop-color="#3f6d7c"/>
          <stop offset=".7" stop-color="#2d5462"/><stop offset="1" stop-color="#1e3c47"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#f8feff"/>
          <stop offset=".76" stop-color="#e0f1f4"/><stop offset="1" stop-color="#b8d6dc"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("draw")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("waveA")})" opacity=".95"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("waveB")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="20" fill="url(#${P("hatch")})" opacity=".75"/>
        <rect class="${P("sheen")}" x="-160" y="-160" width="220" height="940" fill="#ffffff" opacity=".4" filter="url(#${P("sheen")})"/>
        <rect x="0" y="0" width="620" height="620" rx="20" filter="url(#${P("grain")})" opacity=".55" pointer-events="none"/>
      `,
      frame: `
        <rect x="9" y="9" width="602" height="602" rx="16" fill="none" stroke="#ffffff" stroke-width="5" filter="url(#${P("wob")})" opacity=".95"/>
        <rect x="15" y="15" width="590" height="590" rx="13" fill="none" stroke="#3fa8a0" stroke-width="1.8" filter="url(#${P("wob")})" opacity=".75"/>
        <path d="M40 620c26-22 60-22 86 0M494 620c26-22 60-22 86 0" fill="none" stroke="#7fd0d8" stroke-width="2.4" opacity=".5"/>
      `,
      lineStroke: "#4b8a92",
      lineW: 1.2,
      lineOpacity: .62,
      lineFilter: P("wob"),
      starFill: "#2f8a86",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}" filter="url(#${P("wet")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P("hatch")})" opacity="${player === 1 ? ".5" : ".35"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r * .74}" fill="none" stroke="#ffffff" stroke-width="${r * .07}" opacity="${player === 1 ? ".4" : ".7"}"/>`
              + `<ellipse cx="${x - r * .32}" cy="${y - r * .34}" rx="${r * .32}" ry="${r * .19}" fill="#fff" opacity="${player === 1 ? ".4" : ".92"}" transform="rotate(-36 ${x - r * .32} ${y - r * .34})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#ffffff" stroke-width="${r * .13}" filter="url(#${P("wet")})"/>`
              + `<circle cx="${x}" cy="${y}" r="${r + r * .09}" fill="none" stroke="#2d7d86" stroke-width="${r * .03}" opacity=".55"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#2fd0c6" stroke-width="${r * .16}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("sweep")} {
          0%   { transform: translateX(0) }
          100% { transform: translateX(760px) }
        }
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.72); opacity: .95 }
          100% { transform: scale(1.85); opacity: 0 }
        }
        #board .${P("sheen")} { animation: ${P("sweep")} 16s linear infinite; }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
      `,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     10 · pencil-night  夜色蜡笔
     黑卡纸 + 蜡笔厚涂 + 荧光叠色（青/紫/黄在黑纸上"发光"）；
     网格用浅色描边，整版是最有戏剧感的一版。
     ★动：极光斜向漂移 + 网格描边呼吸 + 当前手荧光脉冲。
     ═══════════════════════════════════════════════════════════════════ */
  {
    const { P, Q, push } = mk("pencil-night");

    push({
      name: "彩铅 · 夜色蜡笔",
      swatch: "#4fd6c8",
      pageBg: "#0c1116",
      vars: {
        "--bd-bg": "#1a2230", "--bd-line": "#7fb8c8", "--bd-star": "#c8e8f0",
        "--st-black": "#0b1018", "--st-white": "#e8f8ff",
        "--ui-accent": "#4fd6c8", "--bd-radius": "18px",
      },
      defs: `
        <pattern id="${P("ink")}" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#1a2230"/>
          <path d="M0 14H28" stroke="#141b27" stroke-width=".9" opacity=".7"/>
          <path d="M14 0V28" stroke="#243044" stroke-width=".7" opacity=".7"/>
          <path d="M4 6h6M19 23h6" stroke="#2c3a50" stroke-width="1.1" opacity=".6"/>
        </pattern>
        <pattern id="${P("crayA")}" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-26)">
          <path d="M0 0V11" stroke="#4fd6c8" stroke-width="3.6" opacity=".28"/>
        </pattern>
        <pattern id="${P("crayB")}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <path d="M0 0V14" stroke="#9b7bea" stroke-width="3.2" opacity=".3"/>
        </pattern>
        <pattern id="${P("crayC")}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-64)">
          <path d="M0 0V18" stroke="#ffd05c" stroke-width="2.6" opacity=".24"/>
        </pattern>
        <pattern id="${P("crayD")}" width="23" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
          <path d="M0 0V23" stroke="#4f8ce0" stroke-width="2" opacity=".2"/>
        </pattern>
        <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="97" result="n"/>
          <feColorMatrix in="n" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".24" intercept="0"/></feComponentTransfer>
        </filter>
        <filter id="${P("wob")}" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".026" numOctaves="3" seed="73" result="w"/>
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="${P("chalk")}" x="-35%" y="-35%" width="170%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="89" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.8" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="2" seed="7" result="g"/>
          <feColorMatrix in="g" type="saturate" values="0" result="gg"/>
          <feComponentTransfer in="gg" result="ga"><feFuncA type="linear" slope=".4" intercept=".68"/></feComponentTransfer>
          <feComposite in="d" in2="ga" operator="in"/>
        </filter>
        <radialGradient id="${Q("blk")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#3a4a63"/><stop offset=".32" stop-color="#22304a"/>
          <stop offset=".7" stop-color="#141d2e"/><stop offset="1" stop-color="#080c14"/>
        </radialGradient>
        <radialGradient id="${Q("wht")}" cx="34%" cy="24%" r="80%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#e6f7ff"/>
          <stop offset=".72" stop-color="#a9dcea"/><stop offset="1" stop-color="#5f93a8"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("ink")})`,
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("crayA")})" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("crayB")})" opacity=".85"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("crayC")})" opacity=".8"/>
        <rect x="0" y="0" width="620" height="620" rx="18" fill="url(#${P("crayD")})" opacity=".8"/>
        <path class="${P("aurora")}" d="M-140 500C40 300 220 560 400 320 520 160 640 260 760 120" fill="none" stroke="#4fd6c8" stroke-width="70" stroke-linecap="round" opacity=".2" filter="url(#${P("wob")})"/>
        <path class="${P("aurora2")}" d="M-140 380C60 220 240 470 420 240 540 90 660 180 780 60" fill="none" stroke="#9b7bea" stroke-width="52" stroke-linecap="round" opacity=".18" filter="url(#${P("wob")})"/>
        <circle class="${P("twinkle")}" cx="120" cy="140" r="2" fill="#fff8dc" opacity=".9"/>
        <circle cx="512" cy="104" r="1.8" fill="#fff8dc" opacity=".75"/>
        <circle cx="180" cy="486" r="1.9" fill="#fff8dc" opacity=".75"/>
        <circle class="${P("twinkle")}" cx="524" cy="498" r="2.2" fill="#fff8dc" opacity=".9"/>
        <rect x="0" y="0" width="620" height="620" rx="18" filter="url(#${P("grain")})" opacity=".7" pointer-events="none"/>
      `,
      frame: `
        <rect x="8.5" y="8.5" width="603" height="603" rx="13" fill="none" stroke="#7fe6da" stroke-width="4" filter="url(#${P("wob")})" opacity=".85"/>
        <rect x="15" y="15" width="590" height="590" rx="10" fill="none" stroke="#ffd05c" stroke-width="1.4" filter="url(#${P("wob")})" opacity=".5"/>
      `,
      lineStroke: "#8fc4d4",
      lineW: 1.3,
      lineOpacity: .58,
      lineFilter: P("wob"),
      starFill: "#cfecf6",
      starR: 3.4,
      stone: ({ x, y, r, player, isLast }) => {
        const body = `url(#${Q(player === 1 ? "blk" : "wht")})`;
        const halo = player === 1 ? "#4f8ce0" : "#7fe6da";
        let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P(player === 1 ? "crayD" : "crayA")})" opacity=".75"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${P("crayB")})" opacity=".35"/>`
              + `<path d="M${x - r * .6} ${y - r * .5}A${r * .92} ${r * .92} 0 0 1 ${x + r * .14} ${y - r * .8}" fill="none" stroke="#fffdec" stroke-width="${r * .16}" stroke-linecap="round" opacity="${player === 1 ? ".5" : ".85"}"/>`
              + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${halo}" stroke-width="${r * .14}" filter="url(#${P("chalk")})" opacity=".9"/>`
              + `<circle cx="${x}" cy="${y}" r="${r + r * .22}" fill="none" stroke="${halo}" stroke-width="${r * .07}" opacity=".4"/>`;
        if (isLast) s += `<circle class="${P("pulse")}" cx="${x}" cy="${y}" r="${r * .8}" fill="none" stroke="#8cffe8" stroke-width="${r * .18}"/>`;
        return s;
      },
      css: `
        @keyframes ${P("aurora")} {
          0%   { transform: translate(-90px, 60px) scaleY(1) }
          50%  { transform: translate(60px, -40px) scaleY(1.25) }
          100% { transform: translate(190px, 30px) scaleY(.9) }
        }
        @keyframes ${P("aurora2")} {
          0%   { transform: translate(120px, -50px) scaleY(1.1) }
          100% { transform: translate(-160px, 50px) scaleY(.85) }
        }
        @keyframes ${P("breathe")} {
          0%,100% { opacity: .58 }
          50%     { opacity: .34 }
        }
        @keyframes ${P("pulse")} {
          0%   { transform: scale(.7); opacity: 1 }
          100% { transform: scale(1.95); opacity: 0 }
        }
        @keyframes ${P("pulse2")} {
          0%   { transform: scale(1); opacity: .9 }
          35%  { transform: scale(2.6); opacity: 0 }
          100% { transform: scale(2.6); opacity: 0 }
        }
        #board .${P("aurora")}  { animation: ${P("aurora")} 19s ease-in-out infinite alternate; }
        #board .${P("aurora2")} { animation: ${P("aurora2")} 24s ease-in-out infinite alternate; }
        #board .${P("twinkle")} { animation: ${P("pulse2")} 1.5s ease-out infinite; }
        #board path[stroke="#8fc4d4"] { animation: ${P("breathe")} 6.5s ease-in-out infinite; }
        #board #stones .${P("pulse")} {
          transform-box: fill-box; transform-origin: center;
          animation: ${P("pulse")} 1.5s ease-out infinite;
        }
        #board .${P("twinkle")} { transform-box: fill-box; transform-origin: center; }
      `,
    });
  }
})();
