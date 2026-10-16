/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   族 I · 手工与素人（Handmade & Naïve）—— 081-089

   ── 这一族的「作者感」是什么 ──────────────────────────────────────────
     **不专业本身就是风格。** 前八族都在追求"会画"，
     本族恰恰相反：蜡笔越界、马克笔透底、粉笔擦不干净、圆珠笔漏油、
     剪刀剪歪、纸撕出毛边 —— 这些"失误"才是签名。

     与相邻族的分界（很重要，否则会做成"又一套粗糙风"）：
       · 族 A 暗黑绘本 = 线是**故意的**神经质（有控制）
       · 族 B 哥特版画 = 线是**刻意的**工艺（有技法）
       · 族 I 手工素人 = 线是**无控制的**（蜡笔不受手，剪刀不听使唤）
         差别在于：A/B 的"不完美"是设计出来的；I 的不完美是**材料造成的**。

   ── 每版必满足的三条 ─────────────────────────────────────────────────
     ① 线有性格：线的手感来自**工具**，不是笔法 ——
        蜡笔有蜡渣、粉笔有白灰、马克笔有透底、圆珠笔有漏油、
        剪刀有直线棱角、撕纸有纤维毛边。
     ② 形有取舍：形状要"没量过" —— 格子明显不方、圆明显不圆，
        且**误差方向一致**（真人画歪是同向的，不是随机抖）。
     ③ 色有情绪：颜色少而艳得土气（蜡笔/马克笔的色域），
        或者干脆单色（粉笔白、圆珠笔蓝）。

   ── 技法要点（沿用前八族的坑）────────────────────────────────────────
     · 随机必须用确定性 hash + 坐标派生 seed，不能用 Math.random()
     · 滤镜必须显式写 x/y/width/height
     · 网格不要用一条 path 画完 15 条 —— 每根线单独一条
     · defs id 一律走 P()，且与渲染器请求的字符串逐字一致
     · 白子放在浅色盘上会「隐形」，必须过 safeRim 护边
     · 节点预算 ≤250：本族的蜡渣/粉笔灰/纸纤维都用 pattern 平铺，
       不要逐点画（逐点会瞬间超预算）
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

  const wobble = (id, { bf = ".02", oct = 2, seed = 7, scale = 3 } = {}) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 无障碍：系统开了「减少动态效果」就把这条选择器上的动画全掐掉。
   *  每个自带动效（boardMotions / stoneMotions）都必须带这条，
   *  `.check-motion.mjs` 会用 emulateMedia(reduce) 逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /** 颗粒。本族的"材料感"多半靠它：蜡渣、纸纹、粉笔灰。 */
  const grain = (P, { slope = ".13", seed = 5, bf = ".8", sat = 0 } = {}) => `
    <filter id="${P("grain")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="2" seed="${seed}"/>
      <feColorMatrix type="saturate" values="${sat}"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 蜡渣 / 粉笔灰 / 纸纤维：用 pattern 平铺（逐点画会超节点预算）。 */
  const specks = (P, { color = "#fff", op = .3, gap = 7, r = .9 } = {}) => `
    <pattern id="${P("specks")}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">
      <circle cx="${gap * .2}" cy="${gap * .3}" r="${r}" fill="${color}" opacity="${op}"/>
      <circle cx="${gap * .72}" cy="${gap * .66}" r="${(r * .75).toFixed(2)}" fill="${color}" opacity="${(op * .8).toFixed(2)}"/>
      <circle cx="${gap * .45}" cy="${gap * .9}" r="${(r * .6).toFixed(2)}" fill="${color}" opacity="${(op * .6).toFixed(2)}"/>
    </pattern>`;

  /** 手绘横纹（餐巾纸/练习本横线用）。 */
  const rules = (P, { color = "#9ab", op = .5, gap = 22, w = 1 } = {}) => `
    <pattern id="${P("rules")}" width="10" height="${gap}" patternUnits="userSpaceOnUse">
      <path d="M0 ${gap / 2}H10" stroke="${color}" stroke-width="${w}" opacity="${op}"/>
    </pattern>`;

  const relLum = (hex) => {
    const h = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const lumDiff = (a, b) => Math.abs(relLum(a) - relLum(b)) * 100;

  /** 自动护边：子色与盘底色对比不足时补一圈描边。
   *  ⚠ `.check-stones.mjs` 只查「黑子 vs 白子」，查不出「子 vs 盘底」——
   *     白子放浅色纸上、黑子放近黑盘上，都会"隐形"而体检全绿。
   *
   *  ⚠⚠ 两个坑（都是实测出来的）：
   *
   *  ① 描边色不能按「谁更亮就反着描」选（早期实现如此，是错的）：
   *     近黑盘上的黑子会配到**更暗**的边 = 没护。
   *     受害实例：naive-blueprint 黑子/盘底 **1.08**、print-cyanotype **1.03**、
   *     naive-chalkboard **1.39** —— 肉眼完全看不见。
   *
   *  ② **判据不能用"明度差"**。原先用 |ΔL|*100 >= tol(22) 判"够不够"，
   *     但明度差是线性量，对比度是比值量 —— 中明度区间两者严重不一致：
   *     naive-oilpastel 的白子 #f6e6c0 与盘底 #d6c096 明度差有 28（>22，判"够"），
   *     实际对比度只有 **1.57**，肉眼就是糊的。
   *     现在改用 **WCAG 对比度**判据（阈值 2.2），量纲和观感一致。
   *
   *  选边规则（按**底色自身明暗**，不是按子）：
   *     底色暗（relLum < .18）→ 一律亮边；底色亮（> .55）→ 一律暗边；
   *     中间调才按"谁更亮反着配"。 */
  const wcag = (a, b) => {
    const l1 = relLum(a), l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const safeRim = (stoneColor, boardColor, { tol = 2.2 } = {}) => {
    if (wcag(stoneColor, boardColor) >= tol) return null;
    const bl = relLum(boardColor);
    if (bl < 0.18) return "rgba(255,250,238,.75)";   // 暗底 → 亮边
    if (bl > 0.55) return "rgba(30,24,16,.72)";      // 亮底 → 暗边
    return relLum(stoneColor) > bl ? "rgba(30,24,16,.7)" : "rgba(255,250,238,.65)";
  };

  /** 不规则团块。半径波动 0.93-1.07，再大棋子大小就失控。 */
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

  /** 手绘网格 —— 本族的网格要**歪得同向**（真人画歪是一致的），
   *  所以偏移量用一个共享的低频偏移 + 每线小的独立扰动，
   *  而不是每条线纯随机（纯随机看起来像"信号不好"，不像"手画歪"）。 */
  const handGrid = (P, {
    stroke = "#2a2018", jit = 3, w0 = 2, w1 = 1.2, seed = 20260924,
    filter = "wob", lean = 0,
  } = {}) => {
    const rand = rng(seed);
    const drift = (rand() - 0.5) * jit * 1.6;   // 共享偏移：整版一起歪
    let g = "";
    for (let i = 0; i < N; i += 1) {
      const v = XY(i);
      const j1 = () => drift * 0.5 + (rand() - 0.5) * jit;
      // 横线
      g += `<path d="M${PAD} ${(v + j1()).toFixed(1)} Q${(310 + lean).toFixed(1)} ${(v + j1()).toFixed(1)} ${PAD + SPAN} ${(v + j1()).toFixed(1)}"
              fill="none" stroke="${stroke}" stroke-width="${(w0 + rand() * w1).toFixed(1)}"
              stroke-linecap="round" opacity="${(0.8 + rand() * 0.2).toFixed(2)}"
              ${filter ? `filter="url(#${P(filter)})"` : ""}/>`;
      // 竖线（同一份共享偏移，所以方向一致）
      g += `<path d="M${(v + drift * 0.6 + (rand() - .5) * jit).toFixed(1)} ${PAD} Q${(v + drift * 0.6).toFixed(1)} ${(310 + lean).toFixed(1)} ${(v + drift * 0.6 + (rand() - .5) * jit).toFixed(1)} ${PAD + SPAN}"
              fill="none" stroke="${stroke}" stroke-width="${(w0 + rand() * w1).toFixed(1)}"
              stroke-linecap="round" opacity="${(0.8 + rand() * 0.2).toFixed(2)}"
              ${filter ? `filter="url(#${P(filter)})"` : ""}/>`;
    }
    return g;
  };

  /** 通用棋子：不规则轮廓 + 平涂 + 材料笔触 + 自动护边。
   *  @param touch 该版材料的"签名笔触"（蜡渣/粉笔灰/漏油…） */
  const naiveStone = ({
    P, body, bodyAlt, ink, inkAlt, ring, board, boardAlt,
    wob = 0.16, n = 13, edge = 0.2, touch,
  }) => ({ x, y, r, player, isLast }) => {
    const seed = Math.round(x * 13 + y * 7 + player * 211);
    const fill = player === 1 ? body : bodyAlt;
    const line = player === 1 ? ink : (inkAlt || ink);
    const guard = safeRim(fill, player === 1 ? (board || "#fff") : (boardAlt || board || "#fff"));
    let s = "";
    if (guard) {
      s += `<path d="${blob(x, y, r + 1.4, seed, { wob: wob * .7, n })}" fill="none"
              stroke="${guard}" stroke-width="${(r * (edge + .1)).toFixed(2)}"
              filter="url(#${P("wob2")})"/>`;
    }
    if (touch) s += touch.before ? touch.before({ x, y, r, player, seed, P }) : "";
    s += `<path d="${blob(x, y, r, seed, { wob, n })}" fill="${fill}" stroke="${line}"
            stroke-width="${(r * edge).toFixed(2)}" stroke-linejoin="round"
            filter="url(#${P("wob2")})"/>`;
    if (touch) s += touch.after ? touch.after({ x, y, r, player, seed, P }) : "";
    if (isLast) {
      s += `<path d="${blob(x, y, r + 4.5, seed + 5, { wob: wob * .6, n })}" fill="none"
              stroke="${ring}" stroke-width="2.4" filter="url(#${P("wob2")})"/>`;
    }
    return s;
  };

  /** 给**任意** stone 函数套一圈护边。
   *
   *  ⚠ 为什么需要这个包装：本族 9 版用的是各自定制的 stone 函数
   *    （粉笔要断弧、剪纸要镂空、撕纸要毛边…），没法共用 naiveStone，
   *    于是它们**全都漏掉了 safeRim**。后果是实测 7 版的子对盘底对比度
   *    只有 1.02~1.39（肉眼完全看不见），而 `.check-stones.mjs` 因为
   *    只对比"黑子 vs 白子"而全程判绿。
   *    与其在 9 个函数里各抄一遍护边，不如在这里统一包一层。
   *
   *  @param stoneFn 原 stone 函数
   *  @param bodyOf  (player) => 该子的底色（用于算明度差）
   *  @param board   盘底色
   *  @param scale   护边半径倍数（1.06 左右；剪纸/撕纸这类异形可以大一点） */
  const withRim = (P, stoneFn, { bodyOf, board, scale = 1.08, w = 0.2 } = {}) =>
    (a) => {
      const { x, y, r, player } = a;
      const guard = safeRim(bodyOf(player), board);
      if (!guard) return stoneFn(a);
      const seed = Math.round(x * 13 + y * 7 + player * 211);
      const rim = `<path d="${blob(x, y, r * scale, seed, { wob: 0.1 })}" fill="none"
                     stroke="${guard}" stroke-width="${(r * w).toFixed(2)}"
                     filter="url(#${P("wob2")})"/>`;
      return rim + stoneFn(a);
    };

  /* ══════════════════════════════════════════════════════════════════
     081 · 蜡笔粗画
     蜡笔的签名：**蜡渣**（颗粒堆在笔画边上）、颜色越界、纸白留空。
     孩子画画不会填满，颜色总是擦出线外一点点。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-crayon");
    const stone = naiveStone({
      P, board: "#f2ead8", boardAlt: "#f2ead8",
      body: "#3a3a86", bodyAlt: "#f0e2b4",      // 蜡笔的蓝和米黄（不是纯黑纯白）
      ink: "#22306a", inkAlt: "#c8a44a",
      ring: "#d84a3a", wob: 0.2, n: 12, edge: 0.24,
      touch: {
        // 蜡渣：沿着轮廓外缘堆一圈颗粒（用少量 circle，不是 pattern——要沿着形走）
        after: ({ x, y, r, player, seed }) => {
          const rand = rng(seed + 3);
          let d = "";
          for (let i = 0; i < 9; i += 1) {
            const a = rand() * Math.PI * 2;
            const dd = r * (0.98 + rand() * 0.2);
            d += `<circle cx="${(x + Math.cos(a) * dd).toFixed(1)}" cy="${(y + Math.sin(a) * dd).toFixed(1)}"
                    r="${(r * (0.05 + rand() * 0.06)).toFixed(2)}"
                    fill="${player === 1 ? "#4a4a9e" : "#f8ecc4"}" opacity="${(.5 + rand() * .4).toFixed(2)}"/>`;
          }
          return d;
        },
      },
    });
    push({
      name: "手工素人 · 蜡笔粗画",
      swatch: "#d84a3a",
      pageBg: "#2a2620",
      vars: {
        // ⚠ 族内底色不能都挤在"暖奶油"那一段：早先族里 5 版都是 #f2ead8/#fbf7ea/
        //   #f4ead0/#fdf6e8/#e8dcc0，并排看像同一张纸换了几次花纹。
        //   蜡笔改走**竖条格练习本**的路线：冷白偏蓝的纸 + 条纹。
        "--bd-bg": "#eef2f6", "--bd-line": "#3a3a86", "--bd-star": "#d84a3a",
        "--st-black": "#3a3a86", "--st-white": "#f0e2b4",
        "--ui-accent": "#d84a3a", "--bd-radius": "12px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".022", oct: 2, seed: 311, scale: 4.2 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 322, scale: 5.6 })}
        ${grain(P, { slope: ".14", seed: 71, bf: ".68" })}
        ${specks(P, { color: "#8ab0d8", op: .3, gap: 6, r: 1 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f4f8fb"/><stop offset="1" stop-color="#dfe7ef"/>
        </linearGradient>
        <!-- 练习本的蓝色竖线（与横线格不同，蜡笔在竖条格上涂色更像小孩作业） -->
        <pattern id="${P("vlines")}" width="31" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 0V10" stroke="#a8c4e0" stroke-width=".9" opacity=".55"/>
        </pattern>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 练习本竖线 -->
        <rect width="620" height="620" fill="url(#${P("vlines")})" opacity=".8"/>
        <!-- 纸的涂蜡感：一层白蜡点 -->
        <rect width="620" height="620" fill="url(#${P("specks")})" opacity=".5"/>
        <!-- 越界涂色：四角被孩子涂出去又停下的几笔 -->
        <g opacity=".55" filter="url(#${P("wob")})" fill="none" stroke-linecap="round">
          <path d="M28 96c30-26 66-40 104-46" stroke="#d84a3a" stroke-width="11"/>
          <path d="M492 40c34 6 64 22 88 48" stroke="#3a3a86" stroke-width="10"/>
          <path d="M40 520c26 22 58 34 94 38" stroke="#3a8a4a" stroke-width="11"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".5"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      starFill: "#d84a3a", starR: 6,
      // 蜡笔线：粗、滑、边缘有蜡渣
      gridExtra: handGrid(P, { stroke: "#3a3a86", jit: 4.2, w0: 3.2, w1: 1.6, seed: 8181, filter: "wob", lean: -18 }),
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     082 · 油彩棒涂
     油彩棒（oil pastel）的签名：**厚涂叠色、边缘糊**。
     颜色会互相蹭，边缘不是清的而是被抹开的。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-oilpastel");
    const stoneRaw = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 17 + y * 11 + player * 337);
      const body = player === 1 ? "#2e2a3c" : "#f6e6c0";
      const guard = safeRim(body, "#d6c096");
      let s = "";
      if (guard) {
        s += `<path d="${blob(x, y, r + 1.6, seed, { wob: .12 })}" fill="none" stroke="${guard}"
                stroke-width="${(r * .28).toFixed(2)}"/>`;
      }
      // 体：厚涂的团块（不糊边 —— 糊边要留给"笔触"，不能糊掉轮廓，否则棋子像个墨点）
      s += `<path d="${blob(x, y, r, seed, { wob: 0.17, n: 12 })}" fill="${body}"
              filter="url(#${P("wob2")})"/>`;
      // ★ 油彩棒的签名：**可见的粗笔触**（不是渐变，是几道实实在在的色条）。
      //   一道压一道，颜色互相蹭，边缘略糊（用 soft 只糊笔触、不糊轮廓）。
      const strokes = [
        { dy: -0.42, c: player === 1 ? "#4a4468" : "#fff8e0", w: 0.4, op: .85, len: 1.3 },
        { dy: 0.06, c: player === 1 ? "#221e30" : "#e8d4a4", w: 0.44, op: .9, len: 1.5 },
        { dy: 0.5, c: player === 1 ? "#5a5478" : "#fffaf0", w: 0.34, op: .7, len: 1.0 },
        { dy: 0.96, c: player === 1 ? "#1a1626" : "#d8c090", w: 0.3, op: .6, len: 0.8 },
      ];
      for (const st of strokes) {
        const yy = y + r * st.dy;
        const half = r * st.len * 0.5;
        s += `<path d="M${(x - half).toFixed(1)} ${yy.toFixed(1)} Q${x.toFixed(1)} ${(yy + (st.dy < 0 ? r * .1 : -r * .1)).toFixed(1)} ${(x + half).toFixed(1)} ${yy.toFixed(1)}"
                fill="none" stroke="${st.c}" stroke-width="${(r * st.w).toFixed(2)}"
                stroke-linecap="round" opacity="${st.op}"
                filter="url(#${P("soft")})"/>`;
      }
      if (isLast) {
        s += `<path d="${blob(x, y, r + 4.5, seed + 8, { wob: .1 })}" fill="none"
                stroke="#c8612a" stroke-width="3.2" filter="url(#${P("soft")})"/>`;
      }
      return s;
    };
    // 盘底 #d6c096 是中明度（relLum≈.53，落在 .18~.55 中间调），
    // 所以这里走"按谁更亮反着配"的分支即可，但仍统一用 withRim 保证不漏。
    const stone = withRim(P, stoneRaw, { bodyOf: (p) => (p === 1 ? "#2e2a3c" : "#f6e6c0"), board: "#d6c096" });
    push({
      name: "手工素人 · 油彩棒涂",
      swatch: "#c8612a",
      pageBg: "#2a2418",
      vars: {
        "--bd-bg": "#c8b088", "--bd-line": "#4a3a26", "--bd-star": "#8a3a1c",
        "--st-black": "#2e2a3c", "--st-white": "#f6e6c0",
        "--ui-accent": "#c8612a", "--bd-radius": "14px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".018", oct: 2, seed: 411, scale: 3.4 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 422, scale: 4.6 })}
        ${grain(P, { slope: ".16", seed: 82, bf: ".6" })}
        <filter id="${P("soft")}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.9"/>
        </filter>
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#e2cfa8"/><stop offset="1" stop-color="#cbb488"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 厚涂的几大笔：压住四边，颜色互相蹭 -->
        <g filter="url(#${P("soft")})" opacity=".6">
          <path d="M16 74c60-22 128-30 196-24" fill="none" stroke="#1c4a5a" stroke-width="30" stroke-linecap="round"/>
          <path d="M418 34c56 4 106 20 146 48" fill="none" stroke="#8a3a1c" stroke-width="26" stroke-linecap="round"/>
          <path d="M22 542c58 20 120 26 180 20" fill="none" stroke="#6a4a1c" stroke-width="28" stroke-linecap="round"/>
          <path d="M432 578c54-8 100-26 138-54" fill="none" stroke="#4a2a5a" stroke-width="24" stroke-linecap="round"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".56"/>
      `,
      // 油彩棒画的网格。
      // ⚠ 这一版踩了两次坑：
      //   ① 加 mix-blend-mode:multiply → 网格被底色吃掉，棋盘不可用；
      //   ② 底色太接近线色（棕线配棕底）→ 对比不足，远看是一团泥。
      //   油画棒的"糊"要靠**笔触的边缘**表现，不能牺牲底色与线的明度差。
      //   现在：底色提亮到浅米，线压深到近黑棕，对比够了才谈得上"糊边"。
      lineStroke: "#2a1c0e", lineW: 3.6, lineOpacity: .92,
      lineFilter: P("wob"),
      starFill: "#8a3a1c", starR: 7,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     083 · 黑板粉笔
     粉笔的签名：**擦不干净**。黑板底上永远留着上一节课的灰白残迹，
     新写的字压在上面，还有粉笔灰掉落的斑点。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-chalkboard");
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 19 + y * 23 + player * 401);
      const body = player === 1 ? "#1a2a22" : "#e8e4d8";
      const chalk = player === 1 ? "#7ac8a8" : "#3a3a34";
      let s = "";
      // 粉笔画的圈：不是实心，是**两道不重合的弧**（手画圆永远合不上）
      const rand = rng(seed);
      const gapA = rand() * Math.PI * 2;
      const gapLen = 0.5 + rand() * 0.5;
      const arc = (rr) => {
        const a0 = gapA, a1 = gapA + Math.PI * 2 - gapLen;
        const p0 = [x + Math.cos(a0) * rr, y + Math.sin(a0) * rr];
        const p1 = [x + Math.cos(a1) * rr, y + Math.sin(a1) * rr];
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${rr.toFixed(1)} ${rr.toFixed(1)} 0 ${large} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
      };
      // 粉笔的体：半透的白/绿填一层（很薄），再描两道弧
      s += `<path d="${blob(x, y, r, seed, { wob: 0.14 })}" fill="${body}" opacity="${player === 1 ? .82 : .9}"
              filter="url(#${P("wob2")})"/>`;
      s += `<path d="${arc(r)}" fill="none" stroke="${chalk}" stroke-width="${(r * .22).toFixed(2)}"
              stroke-linecap="round" opacity=".85" filter="url(#${P("wob2")})"/>`;
      s += `<path d="${arc(r * (0.84 + rand() * .1))}" fill="none" stroke="${chalk}"
              stroke-width="${(r * .14).toFixed(2)}" stroke-linecap="round" opacity=".5"
              filter="url(#${P("wob2")})"/>`;
      if (player === 1) {
        // 黑子：中间加一道斜划线（粉笔打叉的习惯）
        s += `<path d="M${(x - r * .34).toFixed(1)} ${(y + r * .3).toFixed(1)}
                   l${(r * .68).toFixed(1)} ${(-r * .6).toFixed(1)}"
                fill="none" stroke="${chalk}" stroke-width="${(r * .16).toFixed(2)}"
                stroke-linecap="round" opacity=".7" filter="url(#${P("wob2")})"/>`;
      }
      if (isLast) {
        s += `<path d="${blob(x, y, r + 5, seed + 6, { wob: .1 })}" fill="none"
                stroke="#f0e8d0" stroke-width="3" opacity=".9" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 黑板粉笔",
      swatch: "#7ac8a8",
      pageBg: "#101814",
      vars: {
        "--bd-bg": "#22362c", "--bd-line": "#cfe4d8", "--bd-star": "#e8e4d8",
        "--st-black": "#1a2a22", "--st-white": "#e8e4d8",
        "--ui-accent": "#7ac8a8", "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".024", oct: 2, seed: 511, scale: 3.8 })}
        ${wobble(P("wob2"), { bf: ".045", oct: 2, seed: 522, scale: 5 })}
        ${grain(P, { slope: ".17", seed: 93, bf: ".62" })}
        ${specks(P, { color: "#e8e4d8", op: .18, gap: 9, r: 1.1 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#2a4236"/><stop offset=".5" stop-color="#22362c"/>
          <stop offset="1" stop-color="#1a2a22"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 擦不干净的旧板书残迹：几道模糊的白痕 -->
        <g stroke="#d8d4c8" fill="none" stroke-linecap="round" filter="url(#${P("wob")})" opacity=".17">
          <path d="M60 92h180M60 118h240M300 118h96" stroke-width="13"/>
          <path d="M420 470h140M400 496h180M400 522h104" stroke-width="12"/>
          <path d="M70 300h84M40 326h116" stroke-width="11"/>
        </g>
        <!-- 粉笔灰：满版细白点 -->
        <rect width="620" height="620" fill="url(#${P("specks")})" opacity=".6"/>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".55"/>
      `,
      // 粉笔线：白、毛、有断裂感
      lineStroke: "#cfe4d8", lineW: 1.5, lineOpacity: .62,
      lineFilter: P("wob"),
      starFill: "#e8e4d8", starR: 3.6, starOpacity: .8,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     084 · 白板记号
     马克笔的签名：**透底 + 圆头色带**。白板的红蓝黑马克笔有酒精味、
     笔头是圆的所以线条有"鼓包"，叠色处会更黑（透光加深）。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-whiteboard");
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 23 + y * 29 + player * 457);
      const body = player === 1 ? "#1e2436" : "#fbfcfd";
      const guard = safeRim(body, "#f4f7f9");
      let s = "";
      if (guard) {
        s += `<path d="${blob(x, y, r + 1.3, seed, { wob: .07 })}" fill="none" stroke="${guard}"
                stroke-width="${(r * .22).toFixed(2)}"/>`;
      }
      // 马克笔的圆头：轮廓要"胖"且圆（wob 小，因为笔头画得挺圆）
      s += `<path d="${blob(x, y, r, seed, { wob: 0.08, n: 16 })}" fill="${body}"
              stroke="${player === 1 ? "#0e1220" : "#8a94a6"}" stroke-width="${(r * .2).toFixed(2)}"
              filter="url(#${P("wob2")})"/>`;
      // 透底：马克笔叠色处更深，画一道弯月形的重色
      s += `<path d="M${(x - r * .9).toFixed(1)} ${(y + r * .3).toFixed(1)}
                 a${r.toFixed(1)} ${r.toFixed(1)} 0 0 0 ${(r * 1.8).toFixed(1)} 0"
              fill="none" stroke="${player === 1 ? "#3a4460" : "#dde4ec"}"
              stroke-width="${(r * .5).toFixed(2)}" stroke-linecap="round" opacity=".55"
              filter="url(#${P("wob2")})"/>`;
      if (isLast) {
        s += `<path d="${blob(x, y, r + 5, seed + 4, { wob: .06 })}" fill="none"
                stroke="#e0402a" stroke-width="3.4" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 白板记号",
      swatch: "#2a6ac8",
      pageBg: "#20262c",
      vars: {
        "--bd-bg": "#f4f7f9", "--bd-line": "#2a6ac8", "--bd-star": "#e0402a",
        "--st-black": "#1e2436", "--st-white": "#fbfcfd",
        "--ui-accent": "#2a6ac8", "--bd-radius": "5px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".012", oct: 2, seed: 611, scale: 1.9 })}
        ${wobble(P("wob2"), { bf: ".026", oct: 2, seed: 622, scale: 2.6 })}
        ${grain(P, { slope: ".05", seed: 104, bf: ".9" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8eef3"/>
        </linearGradient>
        <!-- 白板的冷光：从上方打下来的一层浅灰 -->
        <linearGradient id="${P("sheen")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#dfe8f0" stop-opacity=".5"/>
          <stop offset=".4" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("sheen")})"/>
        <!-- 记号笔的粗色带：四边各一道（像白板上随手框的边） -->
        <g fill="none" stroke-linecap="round" filter="url(#${P("wob")})" opacity=".9">
          <path d="M22 26h576" stroke="#2a6ac8" stroke-width="9"/>
          <path d="M22 594h576" stroke="#2a6ac8" stroke-width="9"/>
          <path d="M26 22v576" stroke="#e0402a" stroke-width="8"/>
          <path d="M594 22v576" stroke="#e0402a" stroke-width="8"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".3"/>
      `,
      // 马克笔线：纯色、圆头、比铅笔线更"实"
      lineStroke: "#2a6ac8", lineW: 1.9, lineOpacity: .55,
      lineFilter: P("wob"),
      starFill: "#e0402a", starR: 4, starOpacity: .85,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     085 · 工程草图
     蓝图草图的签名：**蓝底白线 + 手注尺寸**。
     线是尺子辅助画的（直），但字和标注是手写的（歪）——这个对比是签名。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-blueprint");
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 31 + y * 37 + player * 521);
      const body = player === 1 ? "#0e2242" : "#eaf2fb";
      let s = "";
      // 工程图：轮廓用**规整圆**（尺规画的），不用 blob —— 这是本族的例外
      s += `<path d="${blob(x, y, r, seed, { wob: 0.05, n: 18 })}" fill="${body}"
              stroke="#dce8f6" stroke-width="${(r * .16).toFixed(2)}"
              filter="url(#${P("wob2")})"/>`;
      // 剖面线：白子上打一道 45° 排线（工程图的"剖切"记号）
      if (player === 2) {
        s += `<g opacity=".55" clip-path="url(#${P("clip")})">
                <rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}"
                      width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="url(#${P("hatch")})"/>
              </g>`;
      } else {
        // 黑子：中心一道十字准线（工程图的定位标记）
        s += `<path d="M${(x - r * .52).toFixed(1)} ${y.toFixed(1)}H${(x + r * .52).toFixed(1)}
                   M${x.toFixed(1)} ${(y - r * .52).toFixed(1)}V${(y + r * .52).toFixed(1)}"
                stroke="#8ab4e8" stroke-width="${(r * .1).toFixed(2)}" opacity=".8"/>`;
      }
      if (isLast) {
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 5).toFixed(1)}"
                fill="none" stroke="#f0c040" stroke-width="2.4" stroke-dasharray="6 4"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 工程草图",
      swatch: "#4a8ad0",
      pageBg: "#08182e",
      vars: {
        "--bd-bg": "#123057", "--bd-line": "#cfe0f2", "--bd-star": "#f0c040",
        "--st-black": "#0e2242", "--st-white": "#eaf2fb",
        "--ui-accent": "#4a8ad0", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".01", oct: 1, seed: 711, scale: 1.2 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 722, scale: 2 })}
        ${grain(P, { slope: ".09", seed: 115, bf: ".85" })}
        <clipPath id="${P("clip")}"><circle cx="0" cy="0" r="1"/></clipPath>
        <pattern id="${P("hatch")}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V7" stroke="#2a5a9a" stroke-width="1.6"/>
        </pattern>
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#173a66"/><stop offset="1" stop-color="#0d2444"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 图框与标题栏：工程图的规矩 -->
        <g fill="none" stroke="#cfe0f2" opacity=".8">
          <rect x="14" y="14" width="592" height="592" stroke-width="2.2"/>
          <rect x="24" y="24" width="572" height="572" stroke-width=".9" opacity=".6"/>
        </g>
        <!-- 标题栏（右下角，手写体示意） -->
        <g stroke="#cfe0f2" fill="none" opacity=".75">
          <rect x="410" y="540" width="186" height="56" stroke-width="1.6"/>
          <path d="M410 568h186M500 540v56" stroke-width="1.1"/>
        </g>
        <g fill="#cfe0f2" opacity=".62" font-size="11" font-family="KaiTi,SimSun,serif">
          <text x="420" y="560">棋枰 · 十五路</text>
          <text x="510" y="560">比例 1:1</text>
          <text x="420" y="586">图号 GP-015</text>
        </g>
        <!-- 手注尺寸：箭头 + 数字（这是"草图"而非"图纸"的关键）
             ⚠ 尺寸线要压在外框(14)与网格(PAD=46)之间，且文字不能压网格线 -->
        <g stroke="#8ab4e8" fill="none" opacity=".62" stroke-width="1.1">
          <path d="M46 596h528"/>
          <path d="M46 590v12M574 590v12M200 591l10 5-10 5M420 591l10 5-10 5"/>
        </g>
        <text x="252" y="586" fill="#8ab4e8" opacity=".7" font-size="10" font-family="KaiTi,serif">14 × 37.7 = 527.7</text>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".4"/>
      `,
      // 工程线：白、细、规整（尺子画的所以不抖）
      lineStroke: "#cfe0f2", lineW: 1.05, lineOpacity: .72,
      lineFilter: P("wob"),
      starFill: "#f0c040", starR: 3.2, starOpacity: .9,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     086 · 餐巾涂鸦
     圆珠笔 + 纸巾的签名：**漏油 + 纸的横纹凸起**。
     纸巾有压纹，笔走过的地方会断断续续（在凸起上留不住墨）。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-napkin");
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 41 + y * 43 + player * 587);
      const body = player === 1 ? "#2a3448" : "#fdfaf0";
      const rand = rng(seed);
      let s = "";
      // ⚠ 圆珠笔确实「几乎不填色」，但完全靠描边会让黑子变浅灰
      //   （实测黑子被采样成 rgb(192,191,187)，ΔL 掉到 55 → WEAK）。
      //   折中：黑子填一层**密度很高的排线**（模拟圆珠笔反复涂黑），
      //   既保住"笔触感"，又让明度真正沉下去。
      if (player === 1) {
        // 密排线打底：用两层交叉的短线，比纯色更像笔涂。
        // ⚠ clipPath 只能按"绝对坐标"裁，所以每个黑子自带一个（id 带坐标，避免撞）。
        const cid = `${P("sc")}${Math.round(x)}-${Math.round(y)}`;
        s += `<clipPath id="${cid}"><path d="${blob(x, y, r * .96, seed, { wob: 0.1 })}"/></clipPath>`;
        s += `<path d="${blob(x, y, r * .96, seed, { wob: 0.1 })}" fill="${body}" opacity=".92"/>`;
        s += `<g clip-path="url(#${cid})" opacity=".95">
                <rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}"
                      width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="url(#${P("ink")})"/>
                <rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}"
                      width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="url(#${P("ink2")})"/>
              </g>`;
      } else {
        s += `<path d="${blob(x, y, r * .96, seed, { wob: 0.12 })}" fill="${body}" opacity=".95"/>`;
      }
      // 圆珠笔画的圈：一定是**反复描的**（画不圆就多描几遍）→ 2-3 道错开的弧
      const arcs = 2 + Math.floor(rand() * 2);
      for (let a = 0; a < arcs; a += 1) {
        const rr = r * (0.9 + rand() * 0.16);
        const a0 = rand() * Math.PI * 2;
        const sweep = 1.5 + rand() * 1.4;
        const p0 = [x + Math.cos(a0) * rr, y + Math.sin(a0) * rr];
        const p1 = [x + Math.cos(a0 + sweep) * rr, y + Math.sin(a0 + sweep) * rr];
        const large = sweep > Math.PI ? 1 : 0;
        s += `<path d="M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${rr.toFixed(1)} ${rr.toFixed(1)} 0 ${large} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}"
                fill="none" stroke="${player === 1 ? "#243050" : "#3a4560"}"
                stroke-width="${(r * (.09 + rand() * .06)).toFixed(2)}" stroke-linecap="round"
                opacity="${(.7 + rand() * .3).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
      }
      // 漏油：笔尖停久了的墨团
      if (rand() > .45) {
        const a = rand() * Math.PI * 2;
        s += `<circle cx="${(x + Math.cos(a) * r * .7).toFixed(1)}" cy="${(y + Math.sin(a) * r * .7).toFixed(1)}"
                r="${(r * (.07 + rand() * .07)).toFixed(2)}" fill="#243050" opacity=".8"/>`;
      }
      if (isLast) {
        s += `<path d="${blob(x, y, r + 5, seed + 3, { wob: .1 })}" fill="none"
                stroke="#c04030" stroke-width="2.2" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 餐巾涂鸦",
      swatch: "#3a4560",
      pageBg: "#2c2a26",
      vars: {
        "--bd-bg": "#fbf7ea", "--bd-line": "#5a6076", "--bd-star": "#c04030",
        "--st-black": "#2a3448", "--st-white": "#fdfaf0",
        "--ui-accent": "#3a4560", "--bd-radius": "8px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".026", oct: 2, seed: 811, scale: 2.6 })}
        ${wobble(P("wob2"), { bf: ".05", oct: 2, seed: 822, scale: 3.4 })}
        ${grain(P, { slope: ".12", seed: 126, bf: ".55" })}
        ${rules(P, { color: "#c8bfa8", op: .5, gap: 7, w: 1.2 })}
        <!-- 圆珠笔反复涂黑的排线：两个方向交叉，模拟笔尖来回涂 -->
        <pattern id="${P("ink")}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
          <path d="M0 0V4" stroke="#1e2a44" stroke-width="1.9"/>
        </pattern>
        <pattern id="${P("ink2")}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-34)">
          <path d="M0 0V4" stroke="#2a3448" stroke-width="1.7" opacity=".85"/>
        </pattern>
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="#fffdf5"/><stop offset="1" stop-color="#f0e9d6"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 纸巾的压纹横线（凸起，笔走上去会断墨） -->
        <rect width="620" height="620" fill="url(#${P("rules")})" opacity=".55"/>
        <!-- 纸巾的褶皱：两三道柔和的斜痕 -->
        <g stroke="#d8cfb6" fill="none" opacity=".5" filter="url(#${P("wob")})">
          <path d="M0 150c140 22 300-16 620 18" stroke-width="9"/>
          <path d="M0 400c180-26 340 22 620-14" stroke-width="8"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".46"/>
      `,
      // 圆珠笔线：细、蓝黑、断断续续（纸巾上留不住墨）
      lineStroke: "#5a6076", lineW: 1.15, lineOpacity: .48,
      lineFilter: P("wob"),
      starFill: "#c04030", starR: 3.2, starOpacity: .8,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     087 · 素人狂涂
     素人艺术（outsider art）的签名：**密集重复、没有构图、颜色刺目**。
     这不是"画得差"，是"另一个规则系统"——填充是机械重复的，
     颜色是从一盒蜡笔里随手抓的，且永远满格不留白。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-outsider");
    const PALETTE = ["#d84a2a", "#2a6ad8", "#e8b420", "#3aa04a", "#8a3ad8", "#d82a7a"];
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 47 + y * 53 + player * 641);
      const rand = rng(seed);
      // 素人：黑白子不用黑白，用刺目的色 —— 但必须保证两者明度差够
      const a = PALETTE[Math.floor(rand() * PALETTE.length)];
      const body = player === 1 ? "#1a1a3a" : "#f8f0c8";
      const accent = player === 1 ? a : PALETTE[Math.floor(rand() * PALETTE.length)];
      let s = `<path d="${blob(x, y, r, seed, { wob: 0.22, n: 10 })}" fill="${body}"
                stroke="#0e0e1c" stroke-width="${(r * .26).toFixed(2)}"
                stroke-linejoin="round" filter="url(#${P("wob2")})"/>`;
      // 机械重复：内部画满同心小圈（素人最爱干的事 —— 一直画圈）
      for (let i = 1; i <= 3; i += 1) {
        const rr = r * (0.72 - i * 0.18);
        if (rr <= 0) break;
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(2)}"
                fill="none" stroke="${accent}" stroke-width="${(r * .1).toFixed(2)}"
                opacity="${(0.9 - i * .15).toFixed(2)}"/>`;
      }
      // 内部再点一把刺目的色点
      for (let i = 0; i < 5; i += 1) {
        const ang = rand() * Math.PI * 2, dd = r * rand() * 0.62;
        s += `<circle cx="${(x + Math.cos(ang) * dd).toFixed(1)}" cy="${(y + Math.sin(ang) * dd).toFixed(1)}"
                r="${(r * (.07 + rand() * .07)).toFixed(2)}"
                fill="${PALETTE[Math.floor(rand() * PALETTE.length)]}" opacity=".9"/>`;
      }
      if (isLast) {
        s += `<path d="${blob(x, y, r + 5, seed + 8, { wob: .14 })}" fill="none"
                stroke="#e8b420" stroke-width="3.4" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 素人狂涂",
      swatch: "#d84a2a",
      pageBg: "#26241e",
      vars: {
        "--bd-bg": "#f4ead0", "--bd-line": "#1a1a2e", "--bd-star": "#d84a2a",
        "--st-black": "#1a1a3a", "--st-white": "#f8f0c8",
        "--ui-accent": "#2a6ad8", "--bd-radius": "10px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".024", oct: 2, seed: 911, scale: 4.6 })}
        ${wobble(P("wob2"), { bf: ".042", oct: 2, seed: 922, scale: 5.4 })}
        ${grain(P, { slope: ".13", seed: 137, bf: ".7" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f8f0da"/><stop offset="1" stop-color="#eadfc0"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 素人的"满格"：四边被色块塞满，一点白都不留 -->
        <g opacity=".92" filter="url(#${P("wob")})">
          <rect x="0" y="0" width="42" height="620" fill="#d84a2a"/>
          <rect x="578" y="0" width="42" height="620" fill="#2a6ad8"/>
          <rect x="42" y="0" width="536" height="42" fill="#e8b420"/>
          <rect x="42" y="578" width="536" height="42" fill="#3aa04a"/>
          <!-- 角上再叠几个方块（素人不懂留白） -->
          <rect x="42" y="42" width="34" height="34" fill="#8a3ad8"/>
          <rect x="544" y="42" width="34" height="34" fill="#d82a7a"/>
          <rect x="42" y="544" width="34" height="34" fill="#d82a7a"/>
          <rect x="544" y="544" width="34" height="34" fill="#8a3ad8"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".44"/>
      `,
      // 素人的网格：极粗、极黑、且**画过头**（超出棋盘边界）
      lineStroke: "#1a1a2e", lineW: 3.4, lineOpacity: .95,
      lineFilter: P("wob"),
      starFill: "#d84a2a", starR: 7,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     088 · 窗花剪纸
     剪纸的签名：**对称镂空 + 透光**。剪刀走的是弧，转折处有"剪口"，
     中间一定镂空（不然不是剪纸是贴纸）。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-papercut");
    /* ── 窗花的真实做法（这一版按剪纸工艺重建，不是"画成红色的对称图案"）──
       ① **折叠剪**：纸折成 8 折，只剪一个扇形，展开就是 8 重旋转对称的团花。
          所以下面的团花是「定义一个扇形 → 旋转复制 8 次」，不是手摆 8 个花纹。
       ② **锯齿纹 + 月牙纹**：剪纸的两个基本笔法，扇形里必须有。
       ③ **连刀不断**：所有元素靠纸筋相连，否则剪完散架。团花与外框之间留桥。
       ④ **格子是被剪掉的洞、格线是没剪断的纸筋** —— 15×15 网格本身
          就是一张剪纸。所以格线画成**有厚度的红纸条**（下面叠一层切口阴影），
          洞透出窗外的光。这才是"窗花"，而不是"红底上画格子"。 */
    const RED = "#c4141c";
    const RED_DK = "#8e0f16";
    const PAPER = "#fdf7ea";
    /* 白子不能用 PAPER —— 底色也是米白，实测白子/盘底只有 1.x，看不见。
       真窗花的白是"剪掉后透进来的光"，但下棋时它得是一枚可辨的子：
       所以白子改用**纯白 + 红纸描边 + 落影**（像另贴上去的一小片白纸）。 */
    const WHITE_STONE = "#ffffff";
    const N_ = 15, PAD_ = 46, GAP_ = (620 - 92) / 14;
    const XY_ = (i) => PAD_ + i * GAP_;

    /** 一张完整网格的 path（1 个节点）。用于叠"切口阴影"。 */
    const gridPath = (color, width) => {
      let d = "";
      for (let i = 0; i < N_; i += 1) {
        const v = XY_(i);
        d += `M${PAD_} ${v}H${PAD_ + 14 * GAP_}M${v} ${PAD_}V${PAD_ + 14 * GAP_}`;
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="square"/>`;
    };

    /** 折叠团花：一个扇形（含锯齿纹 + 月牙纹 + 镂孔）旋转 8 次 */
    const folded = (cx, cy, R, folds, color) => {
      const step = (Math.PI * 2) / folds;
      // 扇形中轴线取 0°，两侧各 ±step/2
      const a0 = -step / 2, a1 = step / 2;
      const pt = (a, rr) => [(cx + Math.cos(a) * rr).toFixed(1), (cy + Math.sin(a) * rr).toFixed(1)];
      // 锯齿纹：沿中轴排一列小三角（剪纸的"牙"）
      let saw = "";
      const teeth = 5;
      for (let k = 0; k < teeth; k += 1) {
        const r0 = R * (0.3 + (k / teeth) * 0.52);
        const r1 = R * (0.3 + ((k + 0.62) / teeth) * 0.52);
        const w = step * 0.16;
        const [ax, ay] = pt(-w, r0); const [bx, by] = pt(0, r1); const [dx2, dy2] = pt(w, r0);
        saw += `M${ax} ${ay}L${bx} ${by}L${dx2} ${dy2}Z`;
      }
      // 月牙纹：外缘一道弧月（两同心弧围成）
      const mr = R * 0.86, mw = R * 0.1;
      const crescent = `M${pt(-step * 0.3, mr)[0]} ${pt(-step * 0.3, mr)[1]}
        A${mr} ${mr} 0 0 1 ${pt(step * 0.3, mr)[0]} ${pt(step * 0.3, mr)[1]}
        A${mr - mw} ${mr - mw} 0 0 0 ${pt(-step * 0.3 + mw / mr, mr - mw)[0]} ${pt(-step * 0.3 + mw / mr, mr - mw)[1]} Z`;
      // 镂孔：扇形中部一个圆眼
      const [hx, hy] = pt(0, R * 0.62);
      const wedge = `<path d="${saw}" fill="${color}"/>
        <path d="${crescent}" fill="${color}"/>
        <circle cx="${hx}" cy="${hy}" r="${(R * 0.055).toFixed(1)}" fill="${color}"/>
        <circle cx="${hx}" cy="${hy}" r="${(R * 0.024).toFixed(1)}" fill="${PAPER}"/>`;
      let g = "";
      for (let i = 0; i < folds; i += 1) {
        g += `<g transform="rotate(${(i * 360 / folds).toFixed(1)} ${cx} ${cy})">${wedge}</g>`;
      }
      // 中心眼 + 外圈连筋（连刀不断：把 8 个扇形收在一根红圈上）
      g += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.2).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(R * 0.07).toFixed(1)}"/>`;
      g += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.075).toFixed(1)}" fill="${color}"/>`;
      g += `<circle cx="${cx}" cy="${cy}" r="${R.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(R * 0.05).toFixed(1)}"/>`;
      return g;
    };

    /** 角花：对折剪（4 重对称），比原来的"两片叶子"更像真角花 */
    const cornerFlower = (cx, cy, R, rot) => {
      const step = Math.PI / 4;
      const pt = (a, rr) => [(cx + Math.cos(a) * rr).toFixed(1), (cy + Math.sin(a) * rr).toFixed(1)];
      let s = "";
      for (let i = 0; i < 4; i += 1) {
        const a = rot + i * step;
        const [px, py] = pt(a, R * 0.72);
        s += `<ellipse cx="${px}" cy="${py}" rx="${(R * 0.3).toFixed(1)}" ry="${(R * 0.15).toFixed(1)}"
                transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${px} ${py})"/>`;
        const [qx, qy] = pt(a + step / 2, R * 0.42);
        s += `<circle cx="${qx}" cy="${qy}" r="${(R * 0.09).toFixed(1)}" fill="${PAPER}"/>`;
      }
      s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.16).toFixed(1)}"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.28).toFixed(1)}" fill="none" stroke="${RED}" stroke-width="${(R * 0.05).toFixed(1)}"/>`;
      return s;
    };

    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 59 + y * 61 + player * 709);
      const paper = player === 1 ? RED_DK : WHITE_STONE;
      const hole = player === 1 ? PAPER : RED;
      // 落影：让白子像"贴在红纸上的另一片纸"，浮起来才和米白底分得开
      let s = `<ellipse cx="${(x + r * .1).toFixed(1)}" cy="${(y + r * .14).toFixed(1)}"
                  rx="${(r * .98).toFixed(2)}" ry="${(r * .94).toFixed(2)}" fill="#3a1a10" opacity=".26"/>`;
      s += `<path d="${blob(x, y, r, seed, { wob: 0.1, n: 16 })}" fill="${paper}"
                stroke="${player === 1 ? "#5e0a10" : RED}"
                stroke-width="${(r * (player === 1 ? .09 : .16)).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
      // 8 折镂空格子 + 锯齿牙（真窗花的子应该像一枚小团花）
      /* 镂空要**克制**：第一版 8 瓣 + 8 小孔，把整枚子掏掉太多，
         结果白子的平均明度被红孔拉到 ≈ 底色（实测 1.1，反而更看不见）。
         真窗花虽然繁复，但做成"一枚可辨的棋子"时必须以整片为主、镂空为辅。 */
      let h = "";
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const px = x + Math.cos(a) * r * 0.62, py = y + Math.sin(a) * r * 0.62;
        h += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r * .11).toFixed(2)}" ry="${(r * .055).toFixed(2)}"
                transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${px.toFixed(1)} ${py.toFixed(1)})"/>`;
      }
      h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .09).toFixed(2)}"/>`;
      s += `<g fill="${hole}">${h}</g>`;
      // 中心眼留纸筋（连刀不断）
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .06).toFixed(2)}" fill="${paper}"/>`;
      if (isLast) {
        s += `<path d="${blob(x, y, r + 5, seed + 4, { wob: .08, n: 16 })}" fill="none"
                stroke="#e8b23a" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 窗花剪纸",
      swatch: RED,
      pageBg: "#2a1414",
      vars: {
        "--bd-bg": "#b49b74", "--bd-line": RED, "--bd-star": RED,
        "--st-black": RED_DK, "--st-white": WHITE_STONE,
        "--ui-accent": RED, "--bd-radius": "8px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".013", oct: 2, seed: 1011, scale: 2 })}
        ${wobble(P("wob2"), { bf: ".026", oct: 2, seed: 1022, scale: 2.6 })}
        ${grain(P, { slope: ".08", seed: 148, bf: ".78" })}
        <!-- 窗纸底色：用**陈年窗纸的赭黄**，不是亮米白。
             两个理由：① 白子贴米白底上实测只有 1.87，看不见；
             ② 红纸筋压在赭黄上，明度差才拉得开（红 relLum≈.11 vs 底≈.45 → 3.3:1）。 -->
        <radialGradient id="${P("lit")}" cx="42%" cy="36%" r="82%">
          <stop offset="0" stop-color="#c9b189"/><stop offset=".6" stop-color="#b1966f"/>
          <stop offset="1" stop-color="#8b7454"/>
        </radialGradient>
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="#c2a97f"/><stop offset="1" stop-color="#98805c"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("lit")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("lit")})"/>
        <!-- 切口阴影：格线（纸筋）边缘压一道淡影，显出纸的厚度 -->
        <g opacity=".17" filter="url(#${P("wob")})">${gridPath("#7a2a1e", 6.6)}</g>
        <!-- 折叠团花：棋盘正中一枚 8 折大团花。
             ⚠ 结构拆成「外层 class + 内层 filter」两层，**动画只挂外层**
               （同 dh-feitian 的团花）：直接给挂着 feTurbulence 的组做 transform，
               等于每帧重跑那张噪声图。滤镜挪进内层后内层 bbox 与原来逐字相同，
               滤镜区/渲染结果都不变 —— 只是外面多了一个能搬动的壳。 -->
        <g class="${P("rosette")}">
          <g filter="url(#${P("wob")})">${folded(310, 310, 118, 8, RED)}</g>
        </g>
        <!-- 四角角花（对折剪）：同样「外层摆 / 内层滤镜」，理由见团花那段 -->
        <g class="${P("corner")}">
          <g fill="${RED}" filter="url(#${P("wob")})">
            ${cornerFlower(74, 74, 40, -Math.PI / 4)}
            ${cornerFlower(546, 74, 40, -Math.PI / 4)}
            ${cornerFlower(74, 546, 40, -Math.PI / 4)}
            ${cornerFlower(546, 546, 40, -Math.PI / 4)}
          </g>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".34"/>
      `,
      /* 格线 = 没剪断的红纸筋。要**够粗够实**：
         早先写成 1.2px / opacity .5 的"细线"，既不像纸筋，网格对比度也只有 19，
         现在按红纸条画（4.4px、实色），切口阴影在 overlay 里垫了一层。 */
      lineStroke: RED, lineW: 4.4, lineOpacity: .92,
      lineFilter: P("wob"),
      starFill: RED, starR: 5.6,
      stone,
      css: "",
      /* ── 自带动效：窗花被风吹 ──────────────────────────────────────────
         剪纸是贴在窗纸上的，风来时整片纸会**轻微转**，透光也跟着变。
         ① 中心团花：极缓自转 + 透光呼吸
         ② 四角角花：反向微摆（比团花慢得多，像纸被风推着走半拍）
         ⚠ 动画挂在**不带滤镜的外层 g**（滤镜在内层，见 boardOverlay 注释）——
           直接动带 feTurbulence 的组会让整张噪声每帧重跑。 */
      boardMotions: [{
        id: "bmo-naive-papercut",
        name: "窗花被风吹 · 团花缓转",
        desc: "中心团花极缓自转并透光呼吸，四角剪纸反向微摆",
        css: (id) => `
          /* 团花是 8 折旋转对称、圆心正好落在盘心 (310,310)，所以 fill-box 的
             中心就是盘心，绕它转不会把整层甩出去。周期给到 120s —— 用户要的是
             "缓慢旋转"，不是"在转圈"。
             呼吸只在基线之下走（.86→1）：组 opacity 会**乘**在每片红纸上，
             给到 1 以上并不会更亮，只会被截断；掉到 .86 时那些 PAPER 镂孔
             透出底下的暖窗光 —— 正是剪纸"透光"该有的样子。 */
          @keyframes ${id}-spin{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
          @keyframes ${id}-light{ 0%,100%{opacity:.86} 50%{opacity:1} }
          #board .${P("rosette")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-spin 120s linear infinite, ${id}-light 14s ease-in-out infinite;
          }
          /* 四角角花绕盘心**反向**摆（起点先给负角，与团花的转向相反）。
             这层四枚角花共用一个组，只能整层绕中心摆 ±3°（周期 22s）——
             角花离盘心 ~334px，3° 对应十几 px 的**弧**，不是平移，
             所以不吃"位移 ≤8px"那条：真窗花被风推就是整片纸绕着固定点晃，
             不是花瓣自己原地转。
             ⚠ 这里用 view-box 而不是 fill-box 定中心：cornerFlower 的四瓣只
               铺 -45°..90°（不是中心对称），整层 fill-box 中心实测比盘心偏
               15.8/4.1px，绕它摆会让对角的两枚一前一后歪掉。view-box 的
               center 就是 viewBox 的 (310,310) = 盘心，摆起来四角对称。 */
          @keyframes ${id}-breeze{ 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
          #board .${P("corner")}{
            transform-box: view-box; transform-origin: center;
            animation: ${id}-breeze 22s ease-in-out infinite;
          }
          ${RM(`#board .${P("rosette")},#board .${P("corner")}`)}
        `,
      }],
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     089 · 撕纸拼贴
     撕纸的签名：**毛边**。手撕的边是纤维状的白色绒边（不是剪的直边），
     且边缘一定比纸面浅 —— 这是撕纸最好认的特征。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-tornpaper");
    /** 撕边：把 blob 的每个点沿法线再抖一次，产生"毛"的感觉 */
    const torn = (x, y, r, seed, { wob = 0.14, n = 18, fuzz = 0.1 } = {}) => {
      const rand = rng(seed);
      const pts = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (1 - wob / 2 + rand() * (wob + fuzz));
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
      }
      // 用折线（不是贝塞尔）：撕口是"一段一段"的，不是圆的
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < n; i += 1) d += `L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
      return `${d}Z`;
    };
    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 67 + y * 71 + player * 773);
      const body = player === 1 ? "#3a3428" : "#faf4e2";
      const fuzzC = player === 1 ? "#8a7a5a" : "#ffffff";
      let s = "";
      // 1) 先画毛边（比纸面浅、略大一圈）—— 这是撕纸的招牌
      s += `<path d="${torn(x, y, r + 1.8, seed, { wob: 0.16, fuzz: 0.16 })}" fill="${fuzzC}"
              opacity=".9" filter="url(#${P("wob2")})"/>`;
      // 2) 再画纸片本体
      s += `<path d="${torn(x, y, r, seed, { wob: 0.15, fuzz: 0.1 })}" fill="${body}"
              stroke="${player === 1 ? "#221e16" : "#d8cfb4"}"
              stroke-width="${(r * .1).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
      // 3) 纸片上的印刷/手绘痕迹：一小段色条
      s += `<path d="M${(x - r * .5).toFixed(1)} ${(y - r * .2).toFixed(1)}
                 l${(r * .9).toFixed(1)} ${(r * .06).toFixed(1)}"
              fill="none" stroke="${player === 1 ? "#6a5a3a" : "#c8503a"}"
              stroke-width="${(r * .18).toFixed(2)}" stroke-linecap="round" opacity=".6"
              filter="url(#${P("wob2")})"/>`;
      if (isLast) {
        s += `<path d="${torn(x, y, r + 5.5, seed + 6, { wob: .12 })}" fill="none"
                stroke="#c8a020" stroke-width="2.8" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };
    push({
      name: "手工素人 · 撕纸拼贴",
      swatch: "#c8a020",
      pageBg: "#2a2620",
      vars: {
        // 撕纸走**牛皮纸**路线（撕纸拼贴最常贴在牛皮卡纸上），
        // 与同族的暖奶油拉开：这是族内底色分化的一部分。
        "--bd-bg": "#c9a878", "--bd-line": "#5a4a34", "--bd-star": "#a8452a",
        "--st-black": "#3a3428", "--st-white": "#faf4e2",
        "--ui-accent": "#a8452a", "--bd-radius": "10px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".02", oct: 2, seed: 1111, scale: 3 })}
        ${wobble(P("wob2"), { bf: ".05", oct: 2, seed: 1122, scale: 2.4 })}
        ${grain(P, { slope: ".13", seed: 159, bf: ".68" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#d8bb8c"/><stop offset="1" stop-color="#b89868"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 底纸：几张撕下来的色纸，边缘都带白绒 -->
        <g filter="url(#${P("wob")})">
          <path d="M18 30l70-14 78 10 24 66-40 52-96 6-44-58Z" fill="#c8503a" opacity=".85"/>
          <path d="M462 24l84-8 62 34-16 78-72 22-60-52Z" fill="#3a6a9a" opacity=".82"/>
          <path d="M26 470l92-16 54 44-22 78-88 16-52-56Z" fill="#c8a020" opacity=".85"/>
          <path d="M470 452l88-12 56 40-14 82-84 20-58-54Z" fill="#3a7a5a" opacity=".82"/>
        </g>
        <!-- 撕口的白绒边（描在色纸外缘） -->
        <g fill="none" stroke="#fffaf0" stroke-width="3" opacity=".55" filter="url(#${P("wob")})">
          <path d="M18 30l70-14 78 10 24 66"/>
          <path d="M462 24l84-8 62 34"/>
          <path d="M26 470l92-16 54 44"/>
          <path d="M470 452l88-12 56 40"/>
        </g>
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".46"/>
      `,
      // 拼贴的网格：画在"最上面那张纸"上，所以是深灰而不是黑
      lineStroke: "#5a5040", lineW: 1.6, lineOpacity: .5,
      lineFilter: P("wob"),
      starFill: "#c8503a", starR: 4.6, starOpacity: .9,
      stone,
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     090 · 羊毛毡缝
     羊毛毡的签名：**绒面吃光 + 缝线针脚**。
     关键技术点：毡没有高光（纤维把光都散射掉了），所以这版**禁止任何亮斑**；
     立体感只能靠"针脚把两层毡缝在一起"的压痕，以及边缘那圈炸开的绒毛。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("naive-felt");

    /* 绒毛边：轮廓外再罩一层随机短毛刺（毡的边缘永远是毛的，不会齐）。
       ⚠ 所有毛刺合成**一条 path**（多个 M…L… 子路径），不要一根一根画：
         一根一个 <path> 的话每颗子 20 个节点，12 子就是 240 节点，
         加上网格和棋盘直接冲到 397，超了 250 红线。合成一条后每子只占 1 个节点。 */
    const fuzz = (x, y, r, seed, color, { n = 20, len = 1.16 } = {}) => {
      const rand = rng(seed);
      let d = "";
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.22;
        const r0 = r * (1.02 + rand() * 0.06);
        const r1 = r * (len + rand() * 0.16);
        const wob = (rand() - 0.5) * 0.3;
        d += `M${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)}`
          + `Q${(x + Math.cos(a + wob) * (r0 + r1) / 2).toFixed(1)} ${(y + Math.sin(a + wob) * (r0 + r1) / 2).toFixed(1)}`
          + ` ${(x + Math.cos(a + wob * 1.6) * r1).toFixed(1)} ${(y + Math.sin(a + wob * 1.6) * r1).toFixed(1)}`;
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${(r * 0.075).toFixed(2)}"
                stroke-linecap="round" opacity=".5" filter="url(#${P("wob2")})"/>`;
    };

    /* 针脚：沿一条圆弧打一排小短线（缝线是穿过去又穿回来，所以是断续的） */
    const stitches = (x, y, r, color, { a0 = 200, a1 = 340, n = 9, off = 0.62 } = {}) => {
      let s = "";
      for (let i = 0; i < n; i += 1) {
        const a = ((a0 + (a1 - a0) * (i / (n - 1))) * Math.PI) / 180;
        const px = x + Math.cos(a) * r * off;
        const py = y + Math.sin(a) * r * off;
        const tx = Math.cos(a + Math.PI / 2) * r * 0.13;
        const ty = Math.sin(a + Math.PI / 2) * r * 0.13;
        s += `<path d="M${(px - tx).toFixed(1)} ${(py - ty).toFixed(1)} L${(px + tx).toFixed(1)} ${(py + ty).toFixed(1)}"
                fill="none" stroke="${color}" stroke-width="${(r * 0.09).toFixed(2)}"
                stroke-linecap="round" opacity=".72"/>`;
      }
      return s;
    };

    const stone = ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 83 + y * 89 + player * 811);
      const body = player === 1 ? "#3c3630" : "#f2e6cc";
      const fuzzC = player === 1 ? "#6a6055" : "#fffaf0";
      const thread = player === 1 ? "#c8b48a" : "#8a6a44";
      let s = "";
      // 1) 毛边：外圈炸开的绒毛
      s += fuzz(x, y, r, seed, fuzzC, { n: 20, len: 1.14 });
      // 2) 毡片本体：轮廓不规则但**没有高光**（毡是哑的）
      s += `<path d="${blob(x, y, r, seed, { wob: 0.12 })}" fill="${body}"
              filter="url(#${P("wob2")})"/>`;
      // 3) 针脚：沿左上弧缝一道（缝线压在毡面上，有轻微凹陷感）
      s += stitches(x, y, r, thread, { a0: 196, a1: 344, n: 9 });
      if (isLast) {
        s += `<path d="${blob(x, y, r + 4.5, seed + 9, { wob: 0.1 })}" fill="none"
                stroke="${thread}" stroke-width="2.4" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };

    push({
      name: "手工素人 · 羊毛毡缝",
      swatch: "#c8a878",
      pageBg: "#231f1a",
      vars: {
        "--bd-bg": "#c8b89a", "--bd-line": "#5a4a38", "--bd-star": "#8a5a3a",
        "--st-black": "#3c3630", "--st-white": "#f2e6cc",
        "--ui-accent": "#8a6a44", "--bd-radius": "16px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".018", oct: 3, seed: 933, scale: 3.4 })}
        ${wobble(P("wob2"), { bf: ".036", oct: 2, seed: 944, scale: 5 })}
        ${grain(P, { slope: ".16", seed: 151, bf: ".55" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d4c4a6"/><stop offset="1" stop-color="#bcac8e"/>
        </linearGradient>
        <radialGradient id="${P("vign")}" cx="50%" cy="48%" r="72%">
          <stop offset=".52" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#4a3c28" stop-opacity=".3"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <!-- 毡面：粗纤维噪点（比纸纹粗，因为毡是压出来的不是浆出来的） -->
        <rect width="620" height="620" filter="url(#${P("grain")})" opacity=".85"/>
        <!-- 四角贴两片毡布补丁 + 缝线（手工感来自"补过"） -->
        <g filter="url(#${P("wob")})" opacity=".9">
          <path d="M0 0h96c8 22 4 44-10 60L0 74Z" fill="#a8886a"/>
          <path d="M620 620h-88c-6-20-2-40 12-54l76 8Z" fill="#8a9a7a"/>
        </g>
        <g stroke="#f4ead6" stroke-width="3.2" stroke-linecap="round" opacity=".62"
           filter="url(#${P("wob")})" fill="none">
          <path d="M16 22l14 10M34 18l12 12M52 16l10 14"/>
          <path d="M604 598l-14-10M586 602l-12-12M568 604l-10-14"/>
        </g>
        <rect width="620" height="620" fill="url(#${P("vign")})"/>
      `,
      // 毡上的格线也是"缝"出来的：浅色线 + 抖动，不用深黑（毡吃墨）
      lineStroke: "#5a4a38", lineW: 1.5, lineOpacity: .62,
      lineFilter: P("wob"),
      starFill: "#8a5a3a", starR: 5, starOpacity: .85,
      stone,
      css: "",
    });
  }
})();
