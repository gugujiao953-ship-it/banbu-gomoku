/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   族 H · 版画与印刷（Printmaking & Poster）—— 071-079

   ⚠ 本文件负责 071-079；080 蓝晒素描在 illustrated-print-extra.js（另一个文件）。
     两文件合起来才是族 H 的完整 10 版。

   ── 这一族的「作者感」────────────────────────────────────────────────
     版画与印刷的风格**不在题材，在工艺留下的痕迹**：
       · 木口木刻 = 白线在黑底上排（刀在版上"挑"出来的）
       · 木板年画 = 五色套印，粗线压色，艳而不亮
       · 连环画   = 单线白描 + 淡墨，纸的旧黄
       · 丝网印   = 大块纯色硬边，边缘那一点错位
       · 孔版     = 两三色错位叠印，颗粒可见
       · 苏联海报 = 红黑斜切，粗字压图
       · Saul Bass= 剪影几何符号，单色平涂
       · 墨流     = 墨滴沉水的同心细丝
       · 糊染     = 稠糊刷出的宽条痕与点刮

     判断做得对不对：**不看题材，看"印"的痕迹在不在**。
     把套印错位、刀痕、网点、刷痕去掉，就退化成普通平涂了。

   ── 与相邻族的区分 ──────────────────────────────────────────────────
     · 族 B 哥特版画 = 线造明暗（排线），凹版
     · 族 H 本文件   = **凸版/孔版/平版**，靠"色块 + 错位 + 刀痕"，不是排线
     · 080 蓝晒      = 只有蓝 + 白影，没有色块
     · 族 J 单色     = 靠明度分层，不靠工艺痕迹

   ── 技法要点（沿用前八族的坑）─────────────────────────────────────────
     · 随机必须用确定性 hash + 坐标派生 seed，不能用 Math.random()
       （渲染器每落一子整盘重绘，Math.random 会让形状跳变）
     · 滤镜必须显式写 x/y/width/height（默认 -10%/120% 会裁掉位移）
     · 网格不要用一条 path 画完 15 条 —— 每根线单独一条
     · defs id 一律走 P()
     · **白子放在浅色盘上会「隐形」**，必须过 safeRim 护边
       —— .check-stones.mjs 只查「黑 vs 白」，查不出「子 vs 盘底」
     · 节点预算 ≲250，feTurbulence ≲6；pattern 平铺优于逐条画
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
     本族共用工具
     ══════════════════════════════════════════════════════════════════ */

  /** 确定性伪随机。
   *  ⚠ 不是密码学随机，也不该是：它只给 SVG 形状做**确定性**微扰，
   *     "可被预测"正是本意（同一颗棋子每次渲染必须一模一样）。
   *     安全扫描器可能报成弱随机，属误报，勿改。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };

  const wobble = (id, { bf = ".016", oct = 2, seed = 7, scale = 2.4 } = {}) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 无障碍：系统开了「减少动态效果」就把这条选择器上的动画全掐掉。
   *  每个自带动效（boardMotions / stoneMotions）都必须带这条，
   *  `.check-motion.mjs` 会用 emulateMedia(reduce) 逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /** 纸纹（印刷族的纸都不干净：手工纸有颗粒、涂层不匀）。 */
  const grain = (P, { slope = ".14", seed = 5, bf = ".8" } = {}) => `
    <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="2" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 印刷网点（riso / 报纸用）：疏密造中间调。
   *  ⚠ 用 pattern 平铺，不要逐点画（节点会炸）。 */
  const dots = (id, { color = "#2a2a3a", gap = 7, r = 1.5, op = .5, fill = "circle" } = {}) => `
    <pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">
      ${fill === "circle"
        ? `<circle cx="${gap / 2}" cy="${gap / 2}" r="${r}" fill="${color}" opacity="${op}"/>`
        : `<rect x="0" y="0" width="${gap / 2}" height="${gap / 2}" fill="${color}" opacity="${op}"/>`}
    </pattern>`;

  /** 排线（木刻 / 铜版风）：一个角度一层，叠两层就出体积。 */
  const hatch = (P, { stroke = "#0d0d10", w = 1.1, op = .5, gap = 6, angle = 38, n = "hatch" } = {}) => `
    <pattern id="${P(n)}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
      <path d="M0 0V${gap}" stroke="${stroke}" stroke-width="${w}" opacity="${op}"/>
    </pattern>`;

  /** 刀痕（木口木刻/年画用）：短促的平行短划，模拟刀在版上挑/刻。
   *  与 hatch 的区别：刀痕是**断的、长度不齐**的，不是连续线。 */
  const knifeMarks = (P, { color = "#f2efe6", w = 1.4, op = .55, gap = 9, len = 5, seed = 17 } = {}) => {
    const rand = rng(seed);
    let body = "";
    // 一个小 tile 里放几道长短不一的短划
    for (let i = 0; i < 5; i += 1) {
      const x = rand() * gap;
      const y = rand() * gap;
      const l = len * (0.5 + rand());
      body += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}h${l.toFixed(1)}" stroke="${color}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`;
    }
    return `<pattern id="${P("knife")}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  };

  /** 套印错位（丝网/孔版/年画用）：把同一形状画两遍、第二遍偏 1-3px
   *  且换色 —— 这是"套印没对准"的签名，印刷族最像的一笔。 */
  const misprint = (P, { dx = 2.2, dy = -1.6 } = {}) => ({ path, color, color2, w }) => `
    <g>
      <path d="${path}" fill="${color2}" opacity=".72" transform="translate(${dx} ${dy})"/>
      <path d="${path}" fill="${color}" ${w ? `stroke="${color}" stroke-width="${w}"` : ""}/>
    </g>`;

  /** 相对亮度 / 明度差（护边用） */
  const relLum = (hex) => {
    const h = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const lumDiff = (a, b) => Math.abs(relLum(a) - relLum(b)) * 100;

  /** 自动护边：子色与盘底色太接近时补一圈对比描边。
   *  ⚠ `.check-stones.mjs` 只查「黑子 vs 白子」，查不出「子 vs 盘底」——
   *    浅色盘上的白子、深色盘上的黑子，都可能糊住而检查通过。 */
  const safeRim = (stoneColor, boardColor, { tol = 24 } = {}) => {
    if (lumDiff(stoneColor, boardColor) >= tol) return null;
    return relLum(stoneColor) > relLum(boardColor) ? "rgba(18,20,26,.78)" : "rgba(240,238,230,.76)";
  };

  /** 不规则团块（棋子轮廓）。半径波动收窄在 0.93-1.07，否则棋子大小失控。 */
  const blob = (x, y, r, seed, { wob = 0.14, n = 14 } = {}) => {
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

  /** 同心细丝环（墨流用）：一圈略微不规则的闭合曲线。
   *  半径递增、线宽递减 —— 墨在水面扩散就是这个样子。 */
  const ring = (cx, cy, r, seed, wob = 0.16, n = 22) => {
    const rand = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - wob / 2 + rand() * wob);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i += 1) {
      const c = pts[(i + 1) % n];
      const nx = pts[(i + 2) % n];
      d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
    }
    return `${d}Z`;
  };

  /** 宽刷痕（糊染用）：一条两端尖、中间宽的填充笔路。
   *  SVG 的 stroke-width 是等宽的，画不出"提按"，所以改用**填充包络**。 */
  const brushStroke = (x0, y0, x1, y1, w, seed, { taper = 0.7 } = {}) => {
    const rand = rng(seed);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;          // 法向
    const n = 14;
    const L = [], R = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      // 两端收窄（提按），中段饱满；再加一点手抖
      const ww = w * (0.25 + 0.75 * Math.sin(Math.PI * t) ** taper) * (0.85 + rand() * 0.3);
      const px = x0 + dx * t, py = y0 + dy * t;
      const jx = (rand() - 0.5) * 2.4, jy = (rand() - 0.5) * 2.4;
      L.push([px + nx * ww + jx, py + ny * ww + jy]);
      R.push([px - nx * ww + jx, py - ny * ww + jy]);
    }
    let d = `M${L[0][0].toFixed(1)} ${L[0][1].toFixed(1)}`;
    for (let i = 1; i <= n; i += 1) d += `L${L[i][0].toFixed(1)} ${L[i][1].toFixed(1)}`;
    for (let i = n; i >= 0; i -= 1) d += `L${R[i][0].toFixed(1)} ${R[i][1].toFixed(1)}`;
    return `${d}Z`;
  };

  /** 手绘网格（每根线单独一条 path，各自偏移/粗细）—— 与族 A 同一思路，
   *  但印刷族的线**更匀**（印出来的线本来就比手画匀），所以抖动调小。 */
  /** 网格：每根线都朝盘心弯一点（c1/c2 都锚在 310 附近）——
   *  30 根这样互相绕着的线叠起来，就是"等高线/拓扑图"的那个观感。
   *  @param tag  给每条线加属性的钩子，签名 (n, o) => 附加字符串（n = 序号，用来错相位；
   *              o = 这条线自己的浓淡，动效要按它算，见下）。不传就一个字节都不加。
   *  @param over 再压若干层"重墨"（数组）：同一条 d、各自加粗一点、走满不透明，
   *              用 dash 各覆盖一段 —— **底层那条线始终是连续的**，所以看着是
   *              "墨的轻重在沿轨道走"，不是"线断了"。叠多层是为了把亮段的**两端
   *              做出渐强渐弱**：一层亮段是硬边，眼睛会读成"忽亮忽暗 = 断了"。 */
  const printGrid = (seedList = [70117, 90221], { stroke = "#22222a", jit = 1.2, w0 = 1.5, w1 = 0.7, tag = null, over = null } = {}) => {
    const [seedH, seedV] = seedList;
    let g = "";
    let n = 0;
    for (const [seed, vertical] of [[seedH, false], [seedV, true]]) {
      const rand = rng(seed);
      const j = () => (rand() - 0.5) * jit;
      for (let i = 0; i < N; i += 1) {
        const v = XY(i);
        const a = vertical ? PAD : v + j();
        const b = vertical ? v + j() : PAD;
        const c1 = vertical ? 310 + j() : 310;
        const c2 = vertical ? v + j() : 310 + j();
        const ex = vertical ? v + j() : PAD + SPAN;
        const ey = vertical ? PAD + SPAN : v + j();
        // ⚠ 两个 rand() 的取值顺序不能变，否则所有线的粗细/浓淡都会整体错位
        const w = w0 + rand() * w1;
        const o = 0.82 + rand() * 0.18;
        const d = `M${a.toFixed(1)} ${b.toFixed(1)} Q${c1.toFixed(1)} ${c2.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        g += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w.toFixed(2)}"
                stroke-linecap="round" opacity="${o.toFixed(2)}"${tag ? tag(n, o) : ""}/>`;
        for (const L of over || []) {
          g += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${(w + L.w).toFixed(2)}"
                  stroke-linecap="round" opacity="${L.op}"${L.tag(n)}/>`;
        }
        n += 1;
      }
    }
    return g;
  };

  /* ══════════════════════════════════════════════════════════════════
     071 · 木口木刻（wood engraving）
     极细密白线在黑底上排 —— 注意是**白线黑底**，因为木口木刻是在
     黑色油墨印出的底子上用刀挑出白线（"白线法"，与木面木刻相反）。

     这版的核心：密度。白线极细（0.8-1.3px）且互相平行，
     靠线的**疏密**造出明暗，不是靠色块。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-woodengrave");
    const INK = "#0e0e12";      // 版上滚的黑墨
    const PAPER = "#d8d2c4";    // 印在泛黄纸上
    const WHITE = "#ece7dc";    // 刀挑出的白线

    push({
      name: "版画印刷 · 木口木刻",
      swatch: "#1a1a22",
      pageBg: "#141418",
      vars: {
        "--bd-bg": INK, "--bd-line": WHITE, "--bd-star": WHITE,
        "--st-black": "#05050a", "--st-white": "#f2ede2",
        "--ui-accent": "#8a8478", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".022", oct: 2, seed: 411, scale: 1.6 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 433, scale: 2.6 })}
        ${grain(P, { slope: ".12", seed: 71, bf: ".7" })}
        ${knifeMarks(P, { color: WHITE, w: 1.1, op: .5, gap: 8, len: 5, seed: 19 })}
        ${hatch(P, { stroke: WHITE, w: 1.0, op: .42, gap: 5, angle: 30, n: "fine" })}
        <!-- 白线密度：三层不同疏密，叠出明暗层次 -->
        <pattern id="${P("densA")}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <path d="M0 0V4" stroke="${WHITE}" stroke-width="0.8" opacity=".34"/>
        </pattern>
        <pattern id="${P("densB")}" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <path d="M0 0V2.6" stroke="${WHITE}" stroke-width="0.75" opacity=".42"/>
        </pattern>
        <pattern id="${P("densC")}" width="1.8" height="1.8" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <path d="M0 0V1.8" stroke="${WHITE}" stroke-width="0.7" opacity=".5"/>
        </pattern>
        <radialGradient id="${P("vig")}" cx="48%" cy="46%" r="76%">
          <stop offset=".4" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".55"/>
        </radialGradient>
      `,
      boardFill: INK,
      boardOverlay: `
        <rect width="620" height="620" fill="${INK}"/>
        <!-- 四边留白：木口木刻常留一条纸边，压住整块的"闷" -->
        <rect x="14" y="14" width="592" height="592" fill="none" stroke="${PAPER}" stroke-width="1.2" opacity=".22"/>
        <!-- 白线排布：外圈疏、中圈密、内圈更密 —— 造出向心的明暗 -->
        <rect x="30" y="30" width="560" height="560" fill="url(#${P("densA")})"/>
        <rect x="70" y="70" width="480" height="480" fill="url(#${P("densB")})"/>
        <!-- ⚠ plateFine：套色动效要搬它，故必须是**不带 filter** 的一层（见 boardMotions） -->
        <rect class="${P("plateFine")}" x="120" y="120" width="380" height="380" fill="url(#${P("densC")})" opacity=".7"/>
        <!-- 刀痕：不均匀的短白划，打破 pattern 的规整感 -->
        <rect class="${P("plateKnife")}" x="30" y="30" width="560" height="560" fill="url(#${P("knife")})" opacity=".5"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
      `,
      lineStroke: WHITE, lineW: 0.95, lineOpacity: .58, lineFilter: P("wob"),
      starFill: WHITE, starR: 2.6, starOpacity: .72,
      frame: `<rect x="8" y="8" width="604" height="604" fill="none" stroke="${PAPER}" stroke-width="2.4" opacity=".3"/>`,
      gridExtra: printGrid([7011, 9023], {
        stroke: WHITE, jit: 1.0, w0: 0.9, w1: 0.5,
        tag: (n, o) => ` class="${P("contour")}" style="--i:${n};--o:${o.toFixed(2)}"`,
        /* op:0 —— 重墨层平时**不存在于画面上**，只由动效把它点亮：
           关掉「棋盘动效」或选「无」时，这块盘必须和没做过动效时一模一样。 */
        /* 三层同心亮段（长 120 / 190 / 250，周期都是 300）叠出一个软边凸起：
           最外层淡而长 → 中间 → 核心短而实。硬边只有一层时看着像断口。 */
        over: [
          { w: 0.70, op: 0, tag: (n) => ` class="${P("inkrun")}" style="--i:${n}"` },
          { w: 0.45, op: 0, tag: (n) => ` class="${P("inkrun2")}" style="--i:${n}"` },
          { w: 0.28, op: 0, tag: (n) => ` class="${P("inkrun3")}" style="--i:${n}"` },
        ],
      }),
      /* 2026-10-01 用户点名删掉这枚子（盘留着：「重墨缓走」还在用）。
         stone() 整段仍在文件里但不再被派生 —— 想复活把 noStone 去掉即可。 */
      noStone: true,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        // 轮廓只认格子：把 player 掺进 seed 会让黑白各抽一套随机半径，
        // 落在盘上就是"黑子比白子大一号"（实测差 5%）。内部刀痕仍用 seed。
        const geo = Math.round(x * 13 + y * 7);
        const body = player === 1 ? "#05050a" : "#f2ede2";
        const guard = safeRim(body, INK, { tol: 26 });
        let s = "";
        // 白线法：黑子上不描边（它本来就够黑），白子必须护边
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.2, geo, { wob: 0.08 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.2).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        s += `<path d="${blob(x, y, r, geo, { wob: 0.1 })}" fill="${body}"
                stroke="${player === 1 ? "rgba(236,231,220,.55)" : "rgba(58,44,30,.4)"}"
                stroke-width="${(r * 0.14).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 白子上的白线排：它是"刀挑出来的白"，所以子内侧也有细线
        if (player === 2) {
          s += `<path d="${blob(x, y, r * 0.88, seed + 11, { wob: 0.14 })}" fill="url(#${P("densC")})" opacity=".3"/>`;
        } else {
          // 黑子：几道挑出的弧线白痕，交代它是"刻出来的"。
          // ⚠ 只画在**左侧外缘**，不能横穿子心 —— 早期版本让白痕过中心，
          //    实测把黑子饱和度拉到 87%，看着像颗红斑，黑白语义全没了。
          for (let i = 0; i < 3; i += 1) {
            const rr = r * (0.3 + i * 0.2);
            s += `<path d="M${(x - rr).toFixed(1)} ${(y - rr * 0.35).toFixed(1)}
                       a${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${(rr * 0.5).toFixed(1)} ${(-rr * 0.72).toFixed(1)}"
                    fill="none" stroke="${WHITE}" stroke-width="${(r * 0.07).toFixed(2)}"
                    opacity=".34" stroke-linecap="round" filter="url(#${P("wob2")})"/>`;
          }
        }
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.1 })}" fill="none"
                  stroke="${PAPER}" stroke-width="2.1" opacity=".9" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
      /* ── 自带动效 ①：重墨沿等高线缓走（线不断） ──────────────────────────
         这块盘的 30 根线每根都朝盘心弯（printGrid 把控制点锚在 310 附近），
         互相绕着排开，看着就是张地形/拓扑图。用户要的是"线在自己的轨道上缓缓流动"。

         ⚠ 难点：一条**连续且均匀**的线沿自身方向平移，映回它自己 = 完全看不出在动。
           要让人感知到"在流"，线上就必须有个会走的东西。
           第一版给线开了真断口（dasharray 110/40），用户说看得见但"断口太大"——
           刻线不该像虚线。所以改成**两层**：
             底层 30 条线照旧**完整不断**（一笔都没改，粗细浓淡的随机取值顺序也没动）；
             上层同一条 d、加粗 0.7px、走满不透明，用 dash 让它只覆盖 170px 一段；
             同时把底层轨道压到各线自身浓淡的 62% —— 轨道压淡才有对比，脉冲才看得见。
           于是走的是"一截下得更重更实的墨"，不是缺口 —— 没有断口、也没有任何光效。
           （两相位对照图见 验证图-本轮/木刻-重墨缓走-两相位.png）
         dasharray 170 实 + 130 空 = 周期 300，dashoffset 走完一整周期 → 无缝不跳帧。
         速度 300px / 18s ≈ 16.7px/s。
         ⚠ 别拿"每秒有多少像素在变"跨手法比大小 —— 那个数只数面积、不看对比度：
           敦煌飘带是低对比大面积挪（2.66%），木刻脉冲是高对比小面积翻（1.1%），
           两者不可比。这一版是**看两相位对照图**定的，不是看那个百分比定的。
         相位：30 条各差 -0.6s，正好铺满一个周期，于是一片里看不出齐步走。
         ⚠ 这 30 条 path 身上没有 filter（线滤镜在引擎那张网格上，不在这儿），
           所以动它们不会每帧重跑噪声图（红线 1/2）。实测帧率 开 60 / 关 60。 */
      boardMotions: [{
        id: "bmo-print-woodengrave-flow",
        name: "重墨缓走（线不断）",
        desc: "30 条拓扑线保持连贯，只有一截下得更重的墨沿各自轨道爬过",
        css: (id) => `
          /* 轨道压淡到各线自身浓淡的 72%（--o 是 printGrid 逐条给的随机值，
             所以淡得均匀，不会把原来浓的线淡得比淡的线还淡）。
             只有这一档动效开着才生效：关掉/选「无」时这条规则不存在，画面回到原值。
             72% 而不是更狠的 62%：对比留小一点，轨道本身就不容易被看成断口。 */
          #board .${P("contour")}{ opacity: calc(var(--o) * .72) }
          /* 三层同心亮段，周期都是 300，所以速度一致、永远叠在一起。
             dashoffset 的**起点各差半个身位**（-身长/2），三层的中点才对得齐：
               核心 120 长 → 从 -60 起；中层 190 → -95；外层 250 → -125。
             对不齐的话三层一头对齐，凸起就是斜的，看着还是硬边。
             叠出来的强度剖面：250px 范围 +22% → 190px +45% → 120px 满，
             两端是渐强渐弱，不是一刀切 —— 这才是"墨的轻重在走"。 */
          @keyframes ${id}-run1{ from{stroke-dashoffset:-60}  to{stroke-dashoffset:-360} }
          @keyframes ${id}-run2{ from{stroke-dashoffset:-95}  to{stroke-dashoffset:-395} }
          @keyframes ${id}-run3{ from{stroke-dashoffset:-125} to{stroke-dashoffset:-425} }
          #board .${P("inkrun")},#board .${P("inkrun2")},#board .${P("inkrun3")}{
            opacity: 1;   /* 属性上是 0，靠这条点亮 —— 关动效就退回"没有这层" */
          }
          #board .${P("inkrun")} { stroke-dasharray: 120 180; animation: ${id}-run1 18s linear infinite; animation-delay: calc(var(--i) * -0.6s) }
          #board .${P("inkrun2")}{ stroke-dasharray: 190 110; animation: ${id}-run2 18s linear infinite; animation-delay: calc(var(--i) * -0.6s) }
          #board .${P("inkrun3")}{ stroke-dasharray: 250 50;  animation: ${id}-run3 18s linear infinite; animation-delay: calc(var(--i) * -0.6s) }
          /* 减少动态效果：撤掉三层亮段、轨道还原成原浓淡。
             ⚠ 不能只写 animation:none —— 那会留下三截冻住的粗墨，比不动更难看。 */
          @media (prefers-reduced-motion:reduce){
            #board .${P("inkrun")},#board .${P("inkrun2")},#board .${P("inkrun3")}{animation:none;opacity:0}
            #board .${P("contour")}{opacity:var(--o)}
          }
        `,
      }, {
      /* ── 自带动效 ②：套色微错位 ──────────────────────────────────────
         木口木刻印出来是"版上的刀痕"压在同一张纸上，套准永远差一点点，
         而且差值在印刷机的震动里来回飘。所以搬动的是两层**色版**：
         刀痕层（白划）与最密的白线层，各走一条极缓的 translate。
         周期故意错开（9s / 11s）—— 同相位就成了"整块板在平移"，
         只有对不齐才像"两版各自呼吸"。
         ⚠ 挑的都是 overlay 里不带 filter 的 rect：最后一块是 grain
           （feTurbulence 颗粒），动它等于每帧重跑整张噪声图（红线 2）。
           暗角 rect 也没选 —— 它是整幅的光照，搬动会露出底边。 */
        id: "bmo-print-woodengrave",
        name: "套色微错位 · 呼吸",
        desc: "刀痕与细白线两版各自极缓漂移，像印刷套准在呼吸",
        css: (id) => `
          @keyframes ${id}-regKnife{
            0%,100% { transform: translate(0,0) }
            32%     { transform: translate(1.2px,-0.8px) }
            66%     { transform: translate(-1.1px,0.9px) }
          }
          @keyframes ${id}-regFine{
            0%,100% { transform: translate(0,0) }
            38%     { transform: translate(-0.9px,0.6px) }
            72%     { transform: translate(0.8px,-0.5px) }
          }
          #board .${P("plateKnife")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-regKnife 9s ease-in-out infinite;
          }
          #board .${P("plateFine")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-regFine 11s ease-in-out infinite;
          }
          ${RM(`#board .${P("plateKnife")},#board .${P("plateFine")}`)}
        `,
      }],
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     072 · 木板年画（folk new-year woodblock print）
     五色套印、粗黑线压色、吉祥纹样。
     签名是：**先印色块，再压粗墨线"开脸"** —— 所以线一定在色上面，
     而且线的边缘和色块边缘**不完全重合**（套印必然有偏差）。

     艳而不亮：年画用矿物色（品红/藤黄/靛/松绿），饱和度不低但**明度压着**，
     靠粗黑线把颜色隔开，所以远看热闹、近看不刺眼。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-nianhua");
    const PAPER = "#f0e2c4";     // 年画的粉连纸（偏暖）
    const INK = "#1c1a16";
    const RED = "#c8322a";       // 品红
    const YELLOW = "#e8b033";    // 藤黄
    const GREEN = "#2f7a5a";     // 松绿
    const BLUE = "#2a5a9a";      // 靛

    push({
      name: "版画印刷 · 木板年画",
      swatch: "#c8322a",
      pageBg: "#2a1e16",
      vars: {
        "--bd-bg": PAPER, "--bd-line": INK, "--bd-star": RED,
        "--st-black": "#241c14", "--st-white": "#fbf3e2",
        "--ui-accent": "#c8322a", "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".018", oct: 2, seed: 511, scale: 2.0 })}
        ${wobble(P("wob2"), { bf: ".035", oct: 2, seed: 533, scale: 3.0 })}
        ${grain(P, { slope: ".15", seed: 81, bf: ".68" })}
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="74%">
          <stop offset=".45" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#3a2a18" stop-opacity=".42"/>
        </radialGradient>
      `,
      boardFill: PAPER,
      boardOverlay: `
        <rect width="620" height="620" fill="${PAPER}"/>
        <!-- 色块套印：四角吉祥色块。刻意偏移 2px 模拟"套印没对准" -->
        <g opacity=".92">
          <rect x="28" y="28" width="150" height="86" fill="${RED}" transform="translate(1.8 -1.4)"/>
          <rect x="442" y="28" width="150" height="86" fill="${GREEN}" transform="translate(-2.2 1.6)"/>
          <rect x="28" y="506" width="150" height="86" fill="${BLUE}" transform="translate(-1.6 -1.8)"/>
          <rect x="442" y="506" width="150" height="86" fill="${YELLOW}" transform="translate(2.0 1.4)"/>
        </g>
        <!-- 吉祥纹：云纹与回纹，用粗线勾（年画的"开脸"线） -->
        <g fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" filter="url(#${P("wob")})">
          <!-- 左上云纹 -->
          <path d="M52 96c10-16 30-18 38-6 6-12 24-12 30 0 8-10 26-6 26 8"/>
          <path d="M52 112c14 10 34 10 48 2"/>
          <!-- 右上回纹 -->
          <path d="M470 60h84v40h-64v-20h44"/>
          <!-- 左下水纹 -->
          <path d="M48 552c12-12 28-12 40 0s28 12 40 0 28-12 40 0"/>
          <!-- 右下缠枝 -->
          <path d="M470 552c14-16 36-16 50 0M520 552c0-16 12-26 28-26"/>
        </g>
        <!-- 粗黑外框：年画的版框 -->
        <rect x="20" y="20" width="580" height="580" fill="none" stroke="${INK}" stroke-width="5.5" filter="url(#${P("wob")})"/>
        <rect x="32" y="32" width="556" height="556" fill="none" stroke="${INK}" stroke-width="2" opacity=".8" filter="url(#${P("wob")})"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      // 网格：粗墨线（年画的格子本身就是版上的粗线）
      lineStroke: INK, lineW: 2.6, lineOpacity: .9, lineFilter: P("wob"),
      starFill: RED, starR: 5.5,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#241c14" : "#fbf3e2";
        const accent = player === 1 ? RED : GREEN;   // 黑子配红、白子配绿（年画配色）
        const guard = safeRim(body, PAPER, { tol: 24 });
        let s = "";
        // 套印错位的色底：先印一个偏移的色片
        s += `<path d="${blob(x, y, r * 1.06, seed + 3, { wob: 0.16 })}" fill="${accent}"
                opacity=".72" transform="translate(2.2 -1.8)"/>`;
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.2, seed, { wob: 0.08 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.2).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 体：主体 + 粗黑"开脸"线（线压在色上）
        s += `<path d="${blob(x, y, r, seed, { wob: 0.11 })}" fill="${body}"
                stroke="${INK}" stroke-width="${(r * 0.26).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // "开脸"：年画娃娃脸的那道弧 —— 只贴**下缘**一小段，不进子心。
        // ⚠ 早期版本用大弧横穿子心，把黑子染成赭红（饱和度 45%），黑白分不清了。
        s += `<path d="M${(x - r * 0.38).toFixed(1)} ${(y + r * 0.46).toFixed(1)}
                   q${(r * 0.38).toFixed(1)} ${(r * 0.24).toFixed(1)} ${(r * 0.76).toFixed(1)} 0"
                fill="none" stroke="${accent}"
                stroke-width="${(r * 0.17).toFixed(2)}" stroke-linecap="round"
                opacity=".9" filter="url(#${P("wob2")})"/>`;
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.5, seed + 5, { wob: 0.1 })}" fill="none"
                  stroke="${RED}" stroke-width="2.8" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     073 · 连环画册（Chinese lianhuanhua / 小人书）
     单线白描 + 淡墨渲染，纸是旧黄的，页角有编号。
     签名：**线极匀、极细**（铁线描的印刷版），墨色只有淡淡几层，
     整体发黄发灰 —— 是"翻旧了的书页"，不是"精致的画"。

     与族 C 东方绘卷的区别：族 C 是**毛笔**画的（有提按飞白），
     073 是**印出来的线**（匀、无浓淡），且带书页的旧黄和页码。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-lianhuanhua");
    const PAPER = "#e8dcc0";
    const INK = "#3a342a";

    push({
      name: "版画印刷 · 连环画册",
      swatch: "#8a7a5a",
      pageBg: "#241f18",
      vars: {
        "--bd-bg": PAPER, "--bd-line": INK, "--bd-star": "#5a4a32",
        "--st-black": "#2a241c", "--st-white": "#faf4e6",
        "--ui-accent": "#7a6a4a", "--bd-radius": "3px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".014", oct: 2, seed: 611, scale: 1.5 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 633, scale: 2.2 })}
        ${grain(P, { slope: ".17", seed: 91, bf: ".62" })}
        <!-- 旧纸的斑：淡褐圆斑，模拟纸受潮 -->
        <radialGradient id="${P("foxing")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#a08050" stop-opacity=".22"/>
          <stop offset="1" stop-color="#a08050" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${P("wash")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#f2e8d0"/><stop offset=".55" stop-color="${PAPER}"/>
          <stop offset="1" stop-color="#d8c8a4"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="76%">
          <stop offset=".45" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#4a3a22" stop-opacity=".38"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("wash")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("wash")})"/>
        <!-- 纸受潮的"霉斑"：三块不规则淡褐 -->
        <ellipse cx="120" cy="150" rx="70" ry="52" fill="url(#${P("foxing")})"/>
        <ellipse cx="510" cy="470" rx="86" ry="60" fill="url(#${P("foxing")})"/>
        <ellipse cx="320" cy="560" rx="58" ry="38" fill="url(#${P("foxing")})" opacity=".7"/>
        <!-- 淡墨渲染：几笔远山似的淡影，只压在边角，不侵入落子区 -->
        <g fill="none" stroke="#7a6a4a" stroke-width="2.2" opacity=".2" filter="url(#${P("wob")})">
          <path d="M40 470c26-30 54-46 84-48 24 22 40 44 48 66"/>
          <path d="M470 96c22 24 34 48 36 72-24 6-48 4-72-6"/>
        </g>
        <!-- 页角编号：小人书右下角都有页码，这是它的签名之一 -->
        <g opacity=".5">
          <rect x="524" y="524" width="64" height="26" rx="2" fill="none" stroke="${INK}" stroke-width="1.4"/>
          <text x="556" y="542" text-anchor="middle" font-size="15"
                font-family="Georgia,serif" fill="${INK}">17</text>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".55"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: INK, lineW: 1.0, lineOpacity: .62, lineFilter: P("wob"),
      starFill: "#5a4a32", starR: 3.0, starOpacity: .8,
      frame: `
        <rect x="10" y="10" width="600" height="600" fill="none" stroke="${INK}" stroke-width="1.6" opacity=".42"/>
      `,
      gridExtra: printGrid([7301, 9407], { stroke: INK, jit: 1.4, w0: 1.0, w1: 0.6 }),
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#2a241c" : "#faf4e6";
        const guard = safeRim(body, PAPER, { tol: 24 });
        let s = "";
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.1, seed, { wob: 0.08 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.19).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 体：白描的匀线（比族 A 细、匀）
        s += `<path d="${blob(x, y, r, seed, { wob: 0.09 })}" fill="${body}"
                stroke="${INK}" stroke-width="${(r * 0.16).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 淡墨一道：小人书用淡墨交代体积，只有一层，很轻
        s += `<path d="M${(x - r * 0.52).toFixed(1)} ${(y + r * 0.42).toFixed(1)}
                   q${(r * 0.5).toFixed(1)} ${(r * 0.22).toFixed(1)} ${(r * 0.96).toFixed(1)} ${(-r * 0.12).toFixed(1)}"
                fill="none" stroke="${player === 1 ? "#8a7a5a" : "#b0a084"}"
                stroke-width="${(r * 0.14).toFixed(2)}" stroke-linecap="round"
                opacity=".38" filter="url(#${P("wob2")})"/>`;
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.1 })}" fill="none"
                  stroke="#9a3a2a" stroke-width="2.2" opacity=".85" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     074 · 丝网平色（screenprint）
     大块纯色、硬边、**边缘微错**。
     签名就是那点错位：丝网的每个色版单独刮，对不准是常态，
     所以色块之间会露出 1-3px 的背景色缝。

     这版刻意**不做纹理**（丝网是平色），靠色块的形状和错位说话。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-screenprint");
    const PAPER = "#eeeae0";
    const C1 = "#e2483a";   // 朱红
    const C2 = "#1f3f8a";   // 群青
    const C3 = "#e8b93a";   // 芥黄

    push({
      name: "版画印刷 · 丝网平色",
      swatch: "#e2483a",
      pageBg: "#1a1a1e",
      vars: {
        "--bd-bg": PAPER, "--bd-line": "#22222a", "--bd-star": C2,
        "--st-black": "#16161c", "--st-white": "#faf7f0",
        "--ui-accent": "#e2483a", "--bd-radius": "2px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".026", oct: 2, seed: 711, scale: 1.4 })}
        ${wobble(P("wob2"), { bf: ".045", oct: 2, seed: 733, scale: 2.0 })}
        ${grain(P, { slope: ".08", seed: 101, bf: ".85" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="#f4f1e8"/><stop offset="1" stop-color="#e6e1d4"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 大块纯色几何：丝网海报就是几个色版叠出来的。
             每块都偏移 2-3px —— 这就是"套印没对准"的签名。 -->
        <g>
          <path d="M0 0h620v150L0 96Z" fill="${C1}" transform="translate(2.4 -1.8)"/>
          <path d="M0 620V470l180 46v104Z" fill="${C2}" transform="translate(-2.8 2.2)"/>
          <path d="M620 620H430l52-130h138Z" fill="${C3}" transform="translate(1.8 2.6)"/>
        </g>
        <!-- 色块硬边上的一线"漏印"：留白缝，是丝网最常见的瑕疵 -->
        <path d="M0 96L620 150" fill="none" stroke="${PAPER}" stroke-width="2.4"/>
        <path d="M180 516L0 470" fill="none" stroke="${PAPER}" stroke-width="2.2"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".3"/>
      `,
      lineStroke: "#22222a", lineW: 1.3, lineOpacity: .78, lineFilter: P("wob"),
      starFill: C2, starR: 4.4,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#16161c" : "#faf7f0";
        const plate = player === 1 ? C1 : C2;   // 每个子配一个"色版"
        const guard = safeRim(body, PAPER, { tol: 22 });
        let s = "";
        // 色版偏移：先印一块偏移的纯色，再压主体 —— 丝网的错位
        s += `<path d="${blob(x, y, r * 1.05, seed + 2, { wob: 0.12 })}" fill="${plate}"
                transform="translate(2.6 -2.0)" opacity=".9"/>`;
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.0, seed, { wob: 0.07 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.18).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 主体：平色硬边，**没有渐变**（丝网印不出渐变）
        s += `<path d="${blob(x, y, r, seed, { wob: 0.08 })}" fill="${body}"
                stroke="${body === "#16161c" ? "rgba(238,234,224,.4)" : "rgba(22,22,28,.5)"}"
                stroke-width="${(r * 0.1).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 一个纯色几何形：丝网海报的图形语言（圆/方/三角）。
        // ⚠ 放在**右下角偏外**，形状小 —— 早期版本画在子心且尺寸大，
        //    黑子被染成亮黄/朱红，玩家分不清哪颗是黑子。
        if (player === 1) {
          s += `<circle cx="${(x + r * 0.44).toFixed(1)}" cy="${(y + r * 0.4).toFixed(1)}"
                  r="${(r * 0.2).toFixed(2)}"
                  fill="${C3}" transform="translate(1.4 -1.2)"/>`;
        } else {
          s += `<path d="M${(x + r * 0.44).toFixed(1)} ${(y + r * 0.22).toFixed(1)}
                     L${(x + r * 0.66).toFixed(1)} ${(y + r * 0.6).toFixed(1)}
                     L${(x + r * 0.22).toFixed(1)} ${(y + r * 0.6).toFixed(1)}Z"
                  fill="${C1}" transform="translate(-1.4 1.2)"/>`;
        }
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.09 })}" fill="none"
                  stroke="${C3}" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     075 · 孔版噪点（risograph）
     Riso 的签名有三条，缺一条就不像：
       ① 只有两三个色，且色是**叠印**出来的（红+蓝=紫，靠 multiply 混）
       ② 色块有**颗粒**（油墨没完全覆盖）
       ③ 套版**错位**（比丝网更明显，因为 Riso 是低速机）
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-risograph");
    const PAPER = "#f4f1e6";
    const FLUORO = "#ff5a4a";   // 荧光红（riso 标志色）
    const BLUE = "#2a5aa0";     // 中蓝
    const GREEN = "#3a9a6a";    // 绿

    push({
      name: "版画印刷 · 孔版噪点",
      swatch: "#ff5a4a",
      pageBg: "#1e1e22",
      vars: {
        "--bd-bg": PAPER, "--bd-line": "#3a3a48", "--bd-star": BLUE,
        "--st-black": "#1c1c26", "--st-white": "#fbf8f0",
        "--ui-accent": "#ff5a4a", "--bd-radius": "3px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".02", oct: 2, seed: 811, scale: 1.8 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 833, scale: 2.8 })}
        ${grain(P, { slope: ".2", seed: 111, bf: ".9" })}
        <!-- 油墨颗粒：riso 的墨是"点"上去的，不是平的 -->
        ${dots(P("inkDot"), { color: "#3a3a48", gap: 4, r: 0.75, op: .3 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="#f8f5ec"/><stop offset="1" stop-color="#ece7da"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 两色叠印：红块与蓝块交叠处变紫（用 multiply 模拟叠印混色） -->
        <g style="mix-blend-mode:multiply">
          <ellipse cx="130" cy="130" rx="150" ry="130" fill="${FLUORO}" opacity=".8" transform="translate(3 -2)"/>
          <ellipse cx="150" cy="140" rx="130" ry="112" fill="${BLUE}" opacity=".62" transform="translate(-3 2)"/>
          <ellipse cx="500" cy="500" rx="160" ry="140" fill="${BLUE}" opacity=".68" transform="translate(-2.5 -2)"/>
          <ellipse cx="486" cy="512" rx="138" ry="120" fill="${GREEN}" opacity=".6" transform="translate(2.5 2)"/>
        </g>
        <!-- 颗粒：整版点一层油墨颗粒 -->
        <rect width="620" height="620" fill="url(#${P("inkDot")})" opacity=".7"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
      `,
      lineStroke: "#3a3a48", lineW: 1.35, lineOpacity: .72, lineFilter: P("wob"),
      starFill: BLUE, starR: 4.2,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#1c1c26" : "#fbf8f0";
        const plate = player === 1 ? FLUORO : BLUE;
        const guard = safeRim(body, PAPER, { tol: 22 });
        let s = "";
        // 错位的色版（比丝网偏得多 —— riso 低速机对不准是常态）
        s += `<path d="${blob(x, y, r * 1.08, seed + 2, { wob: 0.14 })}" fill="${plate}"
                opacity=".78" transform="translate(3.4 -2.8)" style="mix-blend-mode:multiply"/>`;
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.1, seed, { wob: 0.07 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.18).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        s += `<path d="${blob(x, y, r, seed, { wob: 0.1 })}" fill="${body}"
                stroke="${body === "#1c1c26" ? "rgba(244,241,230,.36)" : "rgba(28,28,38,.46)"}"
                stroke-width="${(r * 0.11).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 墨点颗粒：子身上也有（riso 的墨压不实）
        s += `<path d="${blob(x, y, r * 0.92, seed + 7, { wob: 0.1 })}" fill="url(#${P("inkDot")})"
                opacity="${player === 1 ? ".34" : ".22"}"/>`;
        // 叠印的第二色：一枚偏移的小色块，位置靠**右下外缘**。
        // ⚠ 早先放在子心且透明度高，叠印混色把黑子染成紫蓝（饱和度 32%）。
        s += `<circle cx="${(x + r * 0.46).toFixed(1)}" cy="${(y + r * 0.42).toFixed(1)}"
                r="${(r * 0.19).toFixed(2)}" fill="${player === 1 ? BLUE : FLUORO}"
                opacity=".42" transform="translate(2 -1.6)" style="mix-blend-mode:multiply"/>`;
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.09 })}" fill="none"
                  stroke="${GREEN}" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     076 · 苏构红黑（Soviet constructivism）
     红黑斜切 + 粗无衬线字压图 + 摄影拼贴感。
     签名是**斜对角线**：构成主义海报的画面几乎总有一条 30-45° 的斜轴，
     所有元素沿斜轴排布，配上红黑两极色，力量感就出来了。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-constructivism");
    const PAPER = "#e6dfd0";
    const RED = "#c81e1e";
    const BLACK = "#141416";

    push({
      name: "版画印刷 · 苏构红黑",
      swatch: "#c81e1e",
      pageBg: "#17171a",
      vars: {
        "--bd-bg": PAPER, "--bd-line": BLACK, "--bd-star": RED,
        "--st-black": "#141416", "--st-white": "#f4efe4",
        "--ui-accent": "#c81e1e", "--bd-radius": "2px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".02", oct: 2, seed: 911, scale: 1.3 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 933, scale: 2.2 })}
        ${grain(P, { slope: ".12", seed: 121, bf: ".75" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stop-color="#f0eade"/><stop offset="1" stop-color="#ddd5c2"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 斜切：构成主义的命脉。一条粗红斜带贯穿画面 -->
        <path d="M0 430L330 0h130L0 560Z" fill="${RED}" opacity=".92" transform="translate(2 -1.6)"/>
        <!-- 黑斜块压住一角，制造重量 -->
        <path d="M620 0v210L360 0Z" fill="${BLACK}"/>
        <path d="M620 620H330l290-250Z" fill="${BLACK}" opacity=".9" transform="translate(-1.6 1.8)"/>
        <!-- 圆：构成主义爱用的几何对位 -->
        <circle cx="470" cy="392" r="72" fill="${BLACK}" opacity=".88"/>
        <circle cx="470" cy="392" r="46" fill="${PAPER}" opacity=".9"/>
        <!-- 粗无衬线"字"：用几何块拼，不依赖字体
             （渲染器不保证有 condensed sans，画成块最稳） -->
        <g fill="${BLACK}" opacity=".9">
          <rect x="52" y="52" width="70" height="13"/>
          <rect x="52" y="72" width="44" height="13"/>
          <rect x="52" y="92" width="58" height="13"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
      `,
      lineStroke: BLACK, lineW: 1.5, lineOpacity: .8, lineFilter: P("wob"),
      starFill: RED, starR: 5,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#141416" : "#f4efe4";
        const guard = safeRim(body, PAPER, { tol: 22 });
        let s = "";
        // 构成主义：子也是几何的（不用 blob，用略方的圆）
        const bodyPath = blob(x, y, r, seed, { wob: 0.06, n: 8 });
        // 红斜切：**一条细斜条**贴在下缘，不是把子涂红。
        // ⚠ 早期版本让红带横跨全子、opacity .85，结果每颗子都成了红的
        //   （黑子饱和度 45%，黑白完全分不出来）。现在只占下缘一条窄带。
        const clipId = `${P("clip")}${seed}`;
        s += `<clipPath id="${clipId}"><path d="${bodyPath}"/></clipPath>`;
        s += `<g clip-path="url(#${clipId})">`;
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.1, seed, { wob: 0.07 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.19).toFixed(2)}"/>`;
        }
        s += `<path d="${bodyPath}" fill="${body}"/>`;
        // 细斜条：只在下缘内侧
        s += `<path d="M${(x - r).toFixed(1)} ${(y + r * 0.72).toFixed(1)}
                   L${(x + r).toFixed(1)} ${(y + r * 0.3).toFixed(1)}
                   L${(x + r).toFixed(1)} ${(y + r * 0.52).toFixed(1)}
                   L${(x - r).toFixed(1)} ${(y + r * 0.94).toFixed(1)}Z"
                fill="${RED}" opacity="${player === 1 ? ".7" : ".55"}"/>`;
        s += `</g>`;
        // 轮廓线画在最外层，保证边缘干净
        s += `<path d="${bodyPath}" fill="none"
                stroke="${player === 1 ? "rgba(230,223,208,.42)" : BLACK}"
                stroke-width="${(r * 0.16).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.08 })}" fill="none"
                  stroke="${RED}" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     077 · 巴萨几何（Saul Bass）
     剪纸式几何剪影 + 单色平涂 + 大留白。
     签名：**形状被简化到只剩轮廓，且形状边缘是"剪"出来的硬边**，
     每个形状单独一个纯色，形状之间不叠、不渐变、不加纹理。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-saulbass");
    const PAPER = "#eae4d6";
    const ORANGE = "#e2622a";
    const TEAL = "#1f6a72";
    const BLACK = "#17171a";

    push({
      name: "版画印刷 · 巴萨几何",
      swatch: "#e2622a",
      pageBg: "#191919",
      vars: {
        "--bd-bg": PAPER, "--bd-line": "#17171a", "--bd-star": ORANGE,
        "--st-black": "#17171a", "--st-white": "#f6f1e6",
        "--ui-accent": "#e2622a", "--bd-radius": "2px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".03", oct: 2, seed: 1011, scale: 1.1 })}
        ${wobble(P("wob2"), { bf: ".05", oct: 2, seed: 1033, scale: 1.6 })}
        ${grain(P, { slope: ".09", seed: 131, bf: ".8" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="#f0ebdf"/><stop offset="1" stop-color="#e2dbca"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 剪纸式剪影：每个形状一个纯色，硬边，彼此不叠 -->
        <path d="M62 62h96l-16 46H78Z" fill="${ORANGE}"/>
        <path d="M556 62c-30 8-52 30-58 60 30-6 54-26 64-52Z" fill="${TEAL}"/>
        <circle cx="104" cy="540" r="42" fill="${BLACK}"/>
        <path d="M420 578c22-30 56-44 92-40-16 32-50 52-92 54Z" fill="${ORANGE}"/>
        <!-- 几道硬边短线，Bass 片头常见的"动作线" -->
        <g stroke="${BLACK}" stroke-width="5" stroke-linecap="butt" opacity=".9">
          <path d="M300 44h96M300 56h64"/>
          <path d="M404 576h84M404 588h56"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".35"/>
      `,
      lineStroke: "#17171a", lineW: 1.1, lineOpacity: .62, lineFilter: P("wob"),
      starFill: ORANGE, starR: 4.4,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#17171a" : "#f6f1e6";
        const guard = safeRim(body, PAPER, { tol: 22 });
        let s = "";
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.0, seed, { wob: 0.06 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.18).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 剪影式：形状硬边、无渐变（Bass 的形状都是"剪"出来的）
        s += `<path d="${blob(x, y, r, seed, { wob: 0.05, n: 7 })}" fill="${body}"
                stroke="${player === 1 ? "rgba(234,228,214,.35)" : "rgba(23,23,26,.55)"}"
                stroke-width="${(r * 0.1).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 一个剪纸式符号：放在**右下外缘**且很小。
        // ⚠ 早期版本画在子心、尺寸 r*0.4 以上，黑子被染成橙（饱和度 32%）。
        if (player === 1) {
          s += `<path d="M${(x + r * 0.28).toFixed(1)} ${(y + r * 0.62).toFixed(1)}
                     L${(x + r * 0.66).toFixed(1)} ${(y + r * 0.32).toFixed(1)}
                     L${(x + r * 0.6).toFixed(1)} ${(y + r * 0.66).toFixed(1)}Z" fill="${ORANGE}"/>`;
        } else {
          s += `<path d="M${(x + r * 0.2).toFixed(1)} ${(y + r * 0.52).toFixed(1)}
                     A${(r * 0.3).toFixed(2)} ${(r * 0.3).toFixed(2)} 0 0 1 ${(x + r * 0.62).toFixed(1)} ${(y + r * 0.24).toFixed(1)}"
                  fill="none" stroke="${TEAL}" stroke-width="${(r * 0.15).toFixed(2)}" stroke-linecap="butt"/>`;
        }
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.0, seed + 5, { wob: 0.08 })}" fill="none"
                  stroke="${ORANGE}" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     078 · 墨流细纹（suminagashi）
     墨滴在水面扩散成同心细丝 —— 木版水印里最"活"的一种。
     ⚠ 规划里标为「难」（怕几百条曲线糊掉）。**已实测可行**：
       用 ring() 生成同心闭合曲线，半径递增、线宽递减，
       两个墨心各 22 圈 = 44 条 path，60 FPS / 111 节点。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-suminagashi");
    const PAPER = "#f0e9da";
    const INK_B = "#2f4a66";    // 墨心一：靛
    const INK_R = "#5a3f52";    // 墨心二：紫檀

    const marbling = () => {
      let s = "";
      for (const [cx, cy, tint, seedBase] of [[196, 208, INK_B, 7801], [428, 418, INK_R, 7802]]) {
        for (let i = 1; i <= 22; i += 1) {
          const rr = i * 8.4 + 3;
          const w = Math.max(0.5, 2.2 - i * 0.075);
          const op = Math.max(0.13, 0.58 - i * 0.018);
          s += `<path d="${ring(cx, cy, rr, seedBase + i * 97)}" fill="none"
                  stroke="${tint}" stroke-width="${w.toFixed(2)}" opacity="${op.toFixed(2)}"/>`;
        }
        s += `<path d="${ring(cx, cy, 8, seedBase, 0.42)}" fill="${tint}" opacity=".72"/>`;
      }
      return s;
    };

    push({
      name: "版画印刷 · 墨流细纹",
      swatch: "#2f4a66",
      pageBg: "#22201c",
      vars: {
        "--bd-bg": PAPER, "--bd-line": "#2a3a4a", "--bd-star": INK_B,
        "--st-black": "#1a2430", "--st-white": "#fbf7ee",
        "--ui-accent": "#3a5a7a", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".01", oct: 2, seed: 781, scale: 6 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 783, scale: 3 })}
        ${grain(P, { slope: ".14", seed: 141, bf: ".78" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#f4eee0"/><stop offset="1" stop-color="#e6dcc8"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 墨流：两团同心细丝。每圈半径略不规则，所以看着"活着" -->
        <g filter="url(#${P("wob")})">${marbling()}</g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".55"/>
      `,
      // 网格：墨流的格线很淡（纸本身的花纹比格线抢眼）
      lineStroke: "#2a3a4a", lineW: 1.05, lineOpacity: .48, lineFilter: P("wob"),
      starFill: INK_B, starR: 3.2, starOpacity: .7,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#1a2430" : "#fbf7ee";
        const guard = safeRim(body, PAPER, { tol: 26 });
        let s = "";
        // ⚠ 白子 vs 浅色墨流纸 明度差只有 ~11，必须护边（实测数据）
        if (guard) {
          s += `<path d="${ring(x, y, r + 1.3, seed, 0.08)}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.2).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 体：略带不规则（墨流的子也像墨滴）
        s += `<path d="${ring(x, y, r, seed, 0.1)}" fill="${body}"
                stroke="${player === 1 ? "rgba(150,180,210,.42)" : "rgba(42,58,74,.5)"}"
                stroke-width="${(r * 0.14).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 墨滴的同心纹：子内侧一圈细丝，呼应纸上的墨流
        s += `<path d="${ring(x, y, r * 0.58, seed + 13, 0.24)}" fill="none"
                stroke="${player === 1 ? "#5a7a9a" : "#9aa8b4"}"
                stroke-width="${(r * 0.1).toFixed(2)}" opacity=".42"
                filter="url(#${P("wob2")})"/>`;
        if (player === 1) {
          s += `<path d="${ring(x, y, r * 0.78, seed + 29, 0.3)}" fill="none"
                  stroke="#4a6a8a" stroke-width="${(r * 0.07).toFixed(2)}" opacity=".3"
                  filter="url(#${P("wob2")})"/>`;
        }
        if (isLast) {
          s += `<path d="${ring(x, y, r + 4.5, seed + 5, 0.1)}" fill="none"
                  stroke="#a8842a" stroke-width="2.3" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     079 · 糊染刷纹（paste paper）
     稠糊刷出的宽条痕 + 刮点。
     签名：**宽刷痕是"刮"出来的**，所以条痕两端是钝的、边缘是糙的，
     条痕之间还留着手工刮的平行间距（不是随机的）。

     与 078 的区别：078 是**同心细丝**（墨滴扩散），
     079 是**平行宽带**（刷子刮过），方向感完全不同。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("print-pastepaper");
    const PAPER = "#e9e0c8";
    const BLUE = "#3f6a8a";
    const RUST = "#a05a3a";

    // 平行宽带：用 brushStroke 画，间距略不等（手工刮的）
    const pasteStrokes = () => {
      const rand = rng(8801);
      let s = "";
      // 斜向一组
      for (let i = 0; i < 7; i += 1) {
        const t = i / 7;
        const y0 = 40 + t * 540 + (rand() - 0.5) * 26;
        const y1 = y0 - 150 + (rand() - 0.5) * 40;
        const w = 7 + rand() * 5;
        s += `<path d="${brushStroke(-20, y0, 640, y1, w, 9000 + i * 137)}"
                fill="${BLUE}" opacity="${(0.2 + rand() * 0.14).toFixed(2)}"/>`;
      }
      // 另一组反斜向，颜色换锈红
      for (let i = 0; i < 5; i += 1) {
        const t = i / 5;
        const y0 = 80 + t * 520 + (rand() - 0.5) * 30;
        const y1 = y0 + 120 + (rand() - 0.5) * 46;
        const w = 6 + rand() * 6;
        s += `<path d="${brushStroke(640, y0, -20, y1, w, 9500 + i * 211)}"
                fill="${RUST}" opacity="${(0.16 + rand() * 0.13).toFixed(2)}"/>`;
      }
      // 刮点：刷完用硬物刮出的短划
      for (let i = 0; i < 26; i += 1) {
        const x = 30 + rand() * 560, y = 30 + rand() * 560;
        const l = 10 + rand() * 26;
        s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${l.toFixed(1)} ${(rand() * 8 - 4).toFixed(1)}"
                stroke="${rand() > 0.5 ? BLUE : RUST}" stroke-width="${(1 + rand() * 1.6).toFixed(1)}"
                opacity="${(0.22 + rand() * 0.2).toFixed(2)}" stroke-linecap="round"/>`;
      }
      return s;
    };

    push({
      name: "版画印刷 · 糊染刷纹",
      swatch: "#3f6a8a",
      pageBg: "#221f1a",
      vars: {
        "--bd-bg": PAPER, "--bd-line": "#4a4238", "--bd-star": BLUE,
        "--st-black": "#26221c", "--st-white": "#faf5e8",
        "--ui-accent": "#3f6a8a", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".012", oct: 2, seed: 881, scale: 3.4 })}
        ${wobble(P("wob2"), { bf: ".035", oct: 2, seed: 883, scale: 3.0 })}
        ${grain(P, { slope: ".16", seed: 151, bf: ".72" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#efe7d2"/><stop offset="1" stop-color="#ded4b8"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="76%">
          <stop offset=".45" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#3a3428" stop-opacity=".36"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <g filter="url(#${P("wob")})">${pasteStrokes()}</g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".55"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "#4a4238", lineW: 1.15, lineOpacity: .55, lineFilter: P("wob"),
      starFill: "#5a5244", starR: 3.2, starOpacity: .8,
      stone: ({ x, y, r, player, isLast }) => {
        const seed = Math.round(x * 13 + y * 7 + player * 211);
        const body = player === 1 ? "#26221c" : "#faf5e8";
        const guard = safeRim(body, PAPER, { tol: 24 });
        let s = "";
        if (guard) {
          s += `<path d="${blob(x, y, r + 1.1, seed, { wob: 0.08 })}" fill="none"
                  stroke="${guard}" stroke-width="${(r * 0.19).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
        }
        // 体：糊染的子是"刷"出来的，所以轮廓糙一点
        s += `<path d="${blob(x, y, r, seed, { wob: 0.18 })}" fill="${body}"
                stroke="${player === 1 ? "rgba(233,224,200,.34)" : "rgba(38,34,28,.5)"}"
                stroke-width="${(r * 0.13).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
        // 一道宽刷痕贴在下缘（糊染的签名笔路）。
        // ⚠ 早先横穿子心、宽度 r*0.16、透明度 .42，黑子被染蓝（饱和度 27%）；
        //    现在压到边缘外圈且更窄更淡，只在子身上留一点"刷过的痕迹"。
        s += `<path d="${brushStroke(x - r * 0.5, y + r * 0.52, x + r * 0.5, y + r * 0.34,
                  r * 0.1, seed + 31)}"
                fill="${BLUE}" opacity=".34"/>`;
        if (player === 2) {
          s += `<path d="${brushStroke(x - r * 0.46, y + r * 0.66, x + r * 0.42, y + r * 0.56,
                    r * 0.07, seed + 47)}"
                  fill="${RUST}" opacity=".24"/>`;
        }
        if (isLast) {
          s += `<path d="${blob(x, y, r + 4.2, seed + 5, { wob: 0.09 })}" fill="none"
                  stroke="${RUST}" stroke-width="2.5" filter="url(#${P("wob2")})"/>`;
        }
        return s;
      },
      css: "",
    });
  }
})();
