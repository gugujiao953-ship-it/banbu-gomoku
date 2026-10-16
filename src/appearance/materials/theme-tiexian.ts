/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   主题「铁线白描」· 10 套方案
   ────────────────────────────────────────────────────────────────────────
   这是一个**主题样板**：验证「1 个主题 = 10 套方案」的交付形态。
   如果这个形态对了，其余 99 个主题照这个结构铺。

   主题 = 一种**画法**（这里是李公麟的铁线白描：等粗挺硬细钩，不渲染，纯线造型）
   方案 = 同一个画法下的 10 种**取舍**（换媒材 / 换墨色 / 换线性格 / 换棋子 / 换构图）

   ── 10 套方案的变体维度（互不重叠，每套只动 1–2 个维度）──────────────
     ① 媒材（底纸）：熟宣冷白 / 古绢暖金 / 麻纸粗黄 / 藏经纸深褐
     ② 墨色：浓墨 / 淡墨 / 朱砂线 / 赭石线
     ③ 线性格：挺硬 / 略柔 / 更细密 / 更疏阔
     ④ 棋子：圆子 / 方子 / 带棱
     ⑤ 构图：通格 / 加界格（外框）/ 双线格

   ── 技法要点（族 C 的公用工具，全族复用）───────────────────────────
     · brush()   变宽包络：SVG 的 stroke-width 等宽，做不出提按 → 算左右偏移合成填充 path
     · feibai()  飞白：feComposite operator="out" 把笔触抠出缝隙，纸透出来
     · inkGrid() 每根线单独一条 path（一条 path 画完 15 条会假）
     · 随机一律用确定性 hash + 坐标 seed（每落一子整盘重绘，Math.random 会跳）
     · defs id 一律走 P()，且 **必须与渲染器请求的字符串逐字一致**（含连字符）
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
     公用笔法工具
     ══════════════════════════════════════════════════════════════════ */

  /** 确定性伪随机。⚠ 不是密码学随机，只给 SVG 形状做确定性微扰；
   *  "可被预测"正是本意（同一棋子每次渲染必须一样）。安全扫描器报弱随机属误报。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };

  /** 变宽包络（东方族的命门）。
   *  中国画的线有粗细变化，SVG 的 stroke-width 做不到 →
   *  沿中心线采样、按压感曲线算每点半径、取左右法线偏移，合成一条填充 path。
   *  @param c "even" 等粗 | "taper" 由粗到细 | "swell" 两头尖中间饱 | "thin" 极细
   *  ⚠ 法线必须随切线转，否则弯笔画会像被压扁的管子。 */
  const brush = (pts, w0, w1, c = "even") => {
    const n = pts.length;
    const widthAt = (i) => {
      const t = n === 1 ? 0 : i / (n - 1);
      switch (c) {
        case "taper": return w0 + (w1 - w0) * t;
        case "swell": return w1 + (w0 - w1) * Math.pow(Math.sin(Math.PI * t), 0.7);
        case "thin":  return w0;
        default:      return w0;
      }
    };
    const L = [], R = [];
    for (let i = 0; i < n; i += 1) {
      const [x, y] = pts[i];
      const [px, py] = pts[Math.max(0, i - 1)];
      const [nx, ny] = pts[Math.min(n - 1, i + 1)];
      let dx = nx - px, dy = ny - py;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const rr = widthAt(i) / 2;
      L.push([x - dy * rr, y + dx * rr]);
      R.push([x + dy * rr, y - dx * rr]);
    }
    const fmt = (a) => a.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
    return `M${fmt(L)}L${fmt(R.reverse())}Z`;
  };

  /** 略带弧度的中心线（纸上的线不会笔直）。确定性。 */
  const inkPath = (x0, y0, x1, y1, seed, { bow = 2.4, steps = 6 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bowAmt = (rand() - 0.5) * bow * 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const jx = x0 + dx * t, jy = y0 + dy * t;
      pts.push([jx + nx * bowAmt * Math.sin(Math.PI * t) + (rand() - 0.5) * 1.1,
                jy + ny * bowAmt * Math.sin(Math.PI * t) + (rand() - 0.5) * 1.1]);
    }
    return pts;
  };

  /** 轻位移：笔画的"墨在纸上洇开"软边。⚠ x/y/width/height 必须显式写。 */
  const wobble = (id, { bf = ".018", oct = 2, seed = 7, scale = 1.8 } = {}) =>
    `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 无障碍：系统要求「减少动态效果」时把这条选择器上的动画掐掉。
   *  每个自带动效（boardMotions / stoneMotions）都必须带这条，
   *  .check-motion.mjs 会用 emulateMedia(reduce) 逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /** 纸纹。bf 越小颗粒越细（熟宣细、麻纸粗）。 */
  const paper = (P, { slope = ".10", seed = 5, bf = ".7" } = {}) => `
    <filter id="${P("paper")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="3" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 纸纤维（麻纸/古绢用）：细长条纹，跟颗粒是两回事。 */
  const fiber = (P, { seed = 21, op = .16, scale = 1 } = {}) => `
    <filter id="${P("fiber")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.006 * scale).toFixed(4)} ${(0.5 * scale).toFixed(2)}"
        numOctaves="2" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${op}"/></feComponentTransfer>
    </filter>`;

  /** 朱印：满朱底 + 白文。东方画里**印章是唯一的艳色**。 */
  const seal = (x, y, size, ch, { fill = "#b8352a", ink = "#f2e2c4", op = .88 } = {}) =>
    `<rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}"
       width="${size}" height="${size}" rx="1.6" fill="${fill}" opacity="${op}"/>
     <text x="${x.toFixed(1)}" y="${(y + size * 0.3).toFixed(1)}" font-size="${(size * 0.72).toFixed(1)}"
       fill="${ink}" opacity="${op}" text-anchor="middle">${ch}</text>`;

  /** 书画字体：**选择器必须是 #board**（皮肤 id 不落在 DOM 上）。
   *  写错会静默退化成 system-ui 黑体 —— 就是"一股电子汉字味"。 */
  const brushFont = () =>
    `#board text{font-family:"KaiTi","STKaiti","楷体","Kaiti SC","SimSun","Songti SC",serif;
      text-anchor:middle;dominant-baseline:central}`;

  /** 铁线网格：每根线单独一条 path，各自粗细/偏移。
   *  铁线的性格 = **等粗、挺硬**，所以 lineW 变化很小、jit 也小。
   *  @param wrap 给每条线套的外壳：(线字符串, 线序号) => 字符串。
   *         自带动效要用它挂 class + --i（见 tx-zhusha 的 boardMotions）——
   *         ⚠ 只能加**外壳**，绝不能把 class 直接写在线身上：线自己带着 wob
   *         滤镜，动画挂在带滤镜的元素上 = 每帧重跑噪声图（契约红线 1/2）。 */
  const ironGrid = (P, seedList, {
    stroke = "#1d1a14", jit = 1.2, w = 2.1, wVar = 0.35, op = 1, dens = 1, wrap = null,
  } = {}) => {
    let g = "";
    let n = 0;                     // 线的全局序号（横 15 + 竖 15），只服务相位差，不进几何
    for (const [seed, vertical] of [[seedList[0], false], [seedList[1], true]]) {
      const rand = rng(seed);
      for (let i = 0; i < N; i += 1) {
        const v = XY(i);
        const j = () => (rand() - 0.5) * jit;
        const x0 = vertical ? v + j() : PAD;
        const y0 = vertical ? PAD : v + j();
        const x1 = vertical ? v + j() : PAD + SPAN;
        const y1 = vertical ? PAD + SPAN : v + j();
        const pts = inkPath(x0, y0, x1, y1, seed + i * 37, { bow: 1.4, steps: 5 });
        // 铁线是等粗的 —— 只有极小的自然波动，不是刻意的粗细变化
        const lw = (w + (rand() - 0.5) * wVar).toFixed(2);
        const one = `<path d="${brush(pts, +lw, +lw, "even")}" fill="${stroke}"
                opacity="${(op * (0.88 + rand() * 0.12)).toFixed(2)}"
                filter="url(#${P("wob")})"/>`;
        g += wrap ? wrap(one, n) : one;
        n += 1;
      }
    }
    return g;
  };

  /** 棋子。铁线白描的棋子是**勾出来的**（有轮廓线），不是渲染出来的。
   *  @param shape "round" 圆子 | "square" 方子 | "facet" 带棱（多边折角）
   *  ⚠ 半径波动收窄到 0.93–1.07（用过 0.78–1.14，棋子大小差 2 倍像碎石）。 */
  const inkStone = ({ P, dark, light, ink, ring, shape = "round", seg = 13, edge = 0.14, sharp = false }) =>
    ({ x, y, r, player, isLast }) => {
      const rand = rng(Math.round(x * 13 + y * 7 + player * 211));
      let d = "";
      if (shape === "square") {
        // 方子：真正的方形轮廓（不是"略方的圆"）。
        // 尺寸也放大一点 —— 方子视觉上比圆子小，放大会显得更"方"。
        const k = r * 1.16;
        const pts = [[-k, -k], [k, -k], [k, k], [-k, k]].map(([ax, ay]) => [
          x + ax + (rand() - 0.5) * r * 0.1,
          y + ay + (rand() - 0.5) * r * 0.1,
        ]);
        d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` +
            pts.slice(1).map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join("") + "Z";
      } else if (shape === "facet") {
        // 棱子：六边形 + 每边中点外凸，做出明显的棱角（不是近圆多边形）
        const n2 = 6;
        const pts = [];
        for (let i = 0; i < n2; i += 1) {
          const a0 = (i / n2) * Math.PI * 2;
          pts.push([x + Math.cos(a0) * r * 1.1, y + Math.sin(a0) * r * 1.1]);      // 顶点
          const am = a0 + Math.PI / n2;
          pts.push([x + Math.cos(am) * r * 0.74, y + Math.sin(am) * r * 0.74]);    // 边中点内收
        }
        d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` +
            pts.slice(1).map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join("") + "Z";
      } else {
        const n2 = 13, pts = [];
        for (let i = 0; i < n2; i += 1) {
          const a = (i / n2) * Math.PI * 2;
          const rr = r * (0.93 + rand() * 0.14);
          pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
        }
        d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
        for (let i = 0; i < n2; i += 1) {
          const c = pts[(i + 1) % n2], nx = pts[(i + 2) % n2];
          d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
        }
        d += "Z";
      }
      const body = player === 1 ? dark : light;
      // 白描的棋子：**线是主角**，所以轮廓描得比一般重
      let s = `<path d="${d}" fill="${body}" stroke="${ink}"
                stroke-width="${(r * edge).toFixed(2)}"
                stroke-linejoin="${sharp ? "miter" : "round"}"
                filter="url(#${P("wob")})"/>`;
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}"
                fill="none" stroke="${ring}" stroke-width="1.9" opacity=".82"
                filter="url(#${P("wob")})"/>`;
      }
      return s;
    };

  /* ══════════════════════════════════════════════════════════════════
     10 套方案：同一个铁线白描画法，10 种取舍
     ══════════════════════════════════════════════════════════════════ */

  /** 一套方案的生成器。参数就是"变体维度"，改哪个维度一目了然。 */
  const makeTiexian = ({
    id, name, swatch, pageBg,
    /* ① 媒材 */
    base0, base1, paperSlope = ".045", paperBf = ".78", fiberKey, fiberOp = 0,
    /* ② 墨色 */
    inkColor, starColor,
    /* ③ 线性格 */
    lineW = 2.1, lineVar = 0.35, jit = 1.2, gridOp = 1,
    /* ④ 棋子 */
    shape = "round", seg = 13, edge = 0.14, sharp = false,
    stBlack, stWhite, stoneInk, ring, noStone = false,
    /* ⑤ 构图 */
    frame = false, doubleLine = false,
    /* 其他 */
    sealCh = "描", sealFill = "#b8352a", label, radius = "3px", fontInk,
    breathe = false,
  }) => {
    const { P, push } = mk(id);
    const overlay = `
      <rect width="620" height="620" fill="url(#${P("base")})"/>
      ${fiberOp ? `<rect width="620" height="620" filter="url(#${P(fiberKey)})" opacity="${fiberOp}"/>` : ""}
      <rect width="620" height="620" filter="url(#${P("paper")})" opacity=".5"/>
      ${frame ? `<g fill="none" stroke="${inkColor}" opacity=".5" filter="url(#${P("wob")})">
        <path d="M34 34H586V586H34Z" stroke-width="3.2"/>
        ${doubleLine ? `<path d="M44 44H576V576H44Z" stroke-width="1.2" opacity=".75"/>` : ""}
      </g>` : ""}
      <rect width="620" height="620" fill="url(#${P("vign")})"/>
    `;
    push({
      name,
      swatch, pageBg,
      vars: {
        "--bd-bg": base1, "--bd-line": inkColor, "--bd-star": starColor,
        "--st-black": stBlack, "--st-white": stWhite,
        "--ui-accent": sealFill, "--bd-radius": radius,
      },
      defs: `
        ${wobble(P("wob"), { bf: ".02", oct: 2, seed: 13, scale: 1.4 })}
        ${paper(P, { slope: paperSlope, seed: 9, bf: paperBf })}
        ${fiberOp ? fiber(P, { seed: 21, op: fiberOp, scale: 1 }) : ""}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="${base0}"/><stop offset="1" stop-color="${base1}"/>
        </linearGradient>
        <radialGradient id="${P("vign")}" cx="50%" cy="50%" r="76%">
          <stop offset=".66" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${inkColor}" stop-opacity=".09"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: overlay,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: starColor, starR: 4.4,
      /* ⚠ breathe 只给每条线套一层外壳 <g>，线本身的 d/粗细/透明度一个没改。
         这层外壳不是装饰，是必需的：每条铁线身上都挂着 wob 抖动滤镜（见 ironGrid），
         动画挂在带滤镜的元素上 = 每帧重跑整张噪声图（契约红线 1/2）。呼吸挂在外面
         这层没有滤镜的 <g> 上，滤镜早先算好的结果只被乘一道 alpha。 */
      gridExtra: ironGrid(P, [3101, 3102], {
        stroke: inkColor, jit, w: lineW, wVar: lineVar, op: gridOp,
        wrap: breathe ? (one, i) => `<g class="${P("line")}" style="--i:${i}">${one}</g>` : null,
      }) +
        `<text x="112" y="576" font-size="17" fill="${fontInk || inkColor}" opacity=".72">${label || "铁线白描"}</text>` +
        seal(556, 574, 30, sealCh, { fill: sealFill }),
      stone: noStone ? null : inkStone({ P, dark: stBlack, light: stWhite, ink: stoneInk, ring, shape, seg, edge, sharp }),
      css: brushFont(),
      /* ── 自带动效：朱砂线的呼吸（只有传了 breathe 的方案开，见 06 朱砂线）── */
      boardMotions: breathe ? [{
        id: "bmo-tx-zhusha",
        name: "朱砂呼吸",
        desc: "白描线按序号错相位，一呼一吸的墨色在纸上明灭",
        css: (id) => `
          /* 一根线都不许位移 —— 白描是一张网，错半像素网就散了。只让朱砂的浓淡
             起伏：序号按 ironGrid 的生成顺序走（横 15 条再竖 15 条），各差 -.35s，
             从第一条到最后一条约 10s，比 12s 的周期短一截 —— 于是一道淡入淡出的
             带子先自上而下过一遍横线、再自左而右过一遍竖线，接得上又不齐，
             看不出"整块板在闪"。
             呼吸走 opacity 而不是 stroke-opacity：这些线是 brush() 烘成**填充**
             path 的（白描要有提按，SVG 等粗描边做不出来），根本没有描边。 */
          @keyframes ${id}-breath{ 0%,100%{opacity:.55} 50%{opacity:.95} }
          #board .${P("line")}{
            animation: ${id}-breath 12s ease-in-out infinite;
            animation-delay: calc(var(--i) * -.35s);
          }
          ${RM(`#board .${P("line")}`)}
        `,
      }] : [],
    });
  };

  /* ── 01 · 素纸（标准方案：熟宣冷白 + 浓墨 + 圆子）──────────────── */
  makeTiexian({
    id: "tx-su", name: "铁线白描 · 素纸",
    swatch: "#2b2620", pageBg: "#c8ccd0",
    base0: "#fafaf4", base1: "#eaeae2",
    inkColor: "#2b2620", starColor: "#2b2620",
    stBlack: "#1d1a14", stWhite: "#fbf7ee", stoneInk: "#14110c", ring: "#8a6b3a",
  });

  /* ── 02 · 古绢（暖金绢本 + 织纹）─────────────────────────────── */
  makeTiexian({
    id: "tx-juan", name: "铁线白描 · 古绢",
    swatch: "#b89a5e", pageBg: "#3a2e1c",
    base0: "#e4d2a8", base1: "#d2bc8c",
    paperSlope: ".06", paperBf: ".55", fiberKey: "fiber", fiberOp: ".24",
    inkColor: "#3a3020", starColor: "#3a3020",
    stBlack: "#241c12", stWhite: "#fdf8ec", stoneInk: "#1a1408", ring: "#a8823e",
    sealCh: "绢", sealFill: "#a8541e", radius: "8px",
  });

  /* ── 03 · 麻纸（粗黄麻纸 + 明显纤维）─────────────────────────── */
  makeTiexian({
    id: "tx-ma", name: "铁线白描 · 麻纸",
    swatch: "#a89468", pageBg: "#3a3428",
    base0: "#ded0ac", base1: "#c6b48c",
    paperSlope: ".14", paperBf: ".42", fiberKey: "fiber", fiberOp: ".34",
    inkColor: "#3e3422", starColor: "#3e3422",
    lineW: 2.3, lineVar: 0.5, jit: 1.9,
    stBlack: "#241e12", stWhite: "#f8f0d8", stoneInk: "#1a160c", ring: "#8a7440",
    sealCh: "麻", radius: "6px",
  });

  /* ── 04 · 藏经纸（深褐藏经纸 + 沉墨）─────────────────────────── */
  makeTiexian({
    id: "tx-cangjing", name: "铁线白描 · 藏经纸",
    swatch: "#8a6a3e", pageBg: "#2a2016",
    base0: "#c9a870", base1: "#ab8a54",
    paperSlope: ".13", paperBf: ".5", fiberKey: "fiber", fiberOp: ".2",
    inkColor: "#2e2214", starColor: "#2e2214",
    lineW: 2.4, lineVar: 0.4,
    stBlack: "#1a1208", stWhite: "#f2e4c4", stoneInk: "#100a04", ring: "#c9a45e",
    sealCh: "经", sealFill: "#9c3a1e", radius: "6px",
  });

  /* ── 05 · 淡墨（墨色淡 + **减笔**：只保留主线，格线更疏）────── */
  makeTiexian({
    id: "tx-danmo", name: "铁线白描 · 淡墨",
    swatch: "#8a8880", pageBg: "#d0d4d8",
    base0: "#fdfcf8", base1: "#f2f0ea",
    inkColor: "#9a9890", starColor: "#9a9890",
    lineW: 1.6, lineVar: 0.22, jit: 1.0, gridOp: .62,
    stBlack: "#5a5852", stWhite: "#fefdfa", stoneInk: "#6a6860", ring: "#a8a69e",
    sealCh: "淡", sealFill: "#b06a54", radius: "3px",
    fontInk: "#7a786e", label: "淡墨减笔",
  });

  /* ── 06 · 朱砂线（朱砂勾线 —— 白描里的异体，红黑对撞）───────── */
  makeTiexian({
    id: "tx-zhusha", name: "铁线白描 · 朱砂线",
    swatch: "#b8352a", pageBg: "#d8d2c4",
    base0: "#faf6ec", base1: "#eee4d2",
    inkColor: "#a8321e", starColor: "#a8321e",
    lineW: 2.1, lineVar: 0.35,
    /* 2026-10-01 用户点名删掉这枚子（盘留着：朱砂呼吸还在用）。
       生成器造的子没有独立 stone 字段可删，所以走 noStone 声明位。 */
    stBlack: "#1d1a14", stWhite: "#fdfaf2", stoneInk: "#14110c", ring: "#b8352a",
    noStone: true,
    sealCh: "朱", sealFill: "#8a2418", radius: "3px",
    fontInk: "#a8321e", label: "朱砂线",
    // 整张网是朱砂勾的，浓淡一呼一吸最贴这块盘的气质（动效见 boardMotions）
    breathe: true,
  });

  /* ── 07 · 赭石线（赭石勾线，比朱砂沉稳）─────────────────────── */
  makeTiexian({
    id: "tx-zheshi", name: "铁线白描 · 赭石线",
    swatch: "#9c6a3a", pageBg: "#cdc4b0",
    base0: "#f6efe0", base1: "#e6dac4",
    inkColor: "#8a5a2e", starColor: "#8a5a2e",
    lineW: 2.2, lineVar: 0.4, jit: 1.5,
    stBlack: "#2a2016", stWhite: "#fdf8ec", stoneInk: "#1e160e", ring: "#9c6a3a",
    sealCh: "赭", sealFill: "#a8541e", radius: "4px",
    fontInk: "#8a5a2e", label: "赭石线",
  });

  /* ── 08 · 界格（重外框 + 双线 + 折角装饰 —— 构图维度）───────── */
  makeTiexian({
    id: "tx-jiege", name: "铁线白描 · 界格",
    swatch: "#6a5a3e", pageBg: "#a89c84",
    base0: "#f2ead6", base1: "#dfd2b4",
    paperSlope: ".08", paperBf: ".6",
    inkColor: "#332e26", starColor: "#332e26",
    lineW: 2.0, lineVar: 0.3,
    stBlack: "#1d1a14", stWhite: "#fdf9f0", stoneInk: "#14110c", ring: "#8a6b3a",
    frame: true, doubleLine: true,
    sealCh: "格", radius: "0px", label: "界格",
  });

  /* ── 09 · 方子（棋子改方 —— 造型维度）───────────────────────── */
  makeTiexian({
    id: "tx-fangzi", name: "铁线白描 · 方子",
    swatch: "#3a3630", pageBg: "#c0c4c0",
    base0: "#f7f7f1", base1: "#e8e8e0",
    inkColor: "#2e2a24", starColor: "#2e2a24",
    lineW: 2.1, lineVar: 0.35,
    shape: "square", sharp: true,
    stBlack: "#1d1a14", stWhite: "#fbf7ee", stoneInk: "#14110c", ring: "#8a6b3a",
    sealCh: "方", radius: "2px", label: "方子",
  });

  /* ── 10 · 棱子（棋子带棱 —— 造型维度的另一极）───────────────── */
  makeTiexian({
    id: "tx-lengzi", name: "铁线白描 · 棱子",
    swatch: "#4a5250", pageBg: "#b4bcbc",
    base0: "#f5f7f5", base1: "#e4e8e4",
    inkColor: "#2a3230", starColor: "#2a3230",
    lineW: 2.1, lineVar: 0.35,
    shape: "facet", seg: 12, sharp: true, edge: 0.13,
    stBlack: "#1a201e", stWhite: "#fafbf8", stoneInk: "#121816", ring: "#5a6a66",
    sealCh: "棱", radius: "2px", label: "棱子",
  });
})();
