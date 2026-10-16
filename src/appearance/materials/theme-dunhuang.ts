/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   族 N1 · 敦煌土红地（Dunhuang mural）—— 1 主题 × 10 套方案

   参考：莫高窟壁画色彩体系。核心配方（色彩研究实证）是
     **「主色垄断 + 小面积补色撞」**：一个洞窟只有一个统一主色调，
     黑/白/灰中性色占大比重做调和，善用土红×石绿、淡紫×土红的补色对比。
   时代差异也拿来做变体轴：北魏浓郁厚重（暖土红+黑）→ 盛唐华丽高雅（金线+石青大面积）。

   ── 为什么这 10 套不是换色 ───────────────────────────────────────────
   按「真画风 vs 换色」判据，10 套在**结构轴**上各自不同（色相不算轴）：
     线性格：铁线描等宽 / 兰叶描粗细起伏 / 剥落断续线 / 泥金无骨线
     边缘：墙皮颗粒 / 虫洞露泥底 / 描金残破 / 石膏起甲
     明度结构：暗调压底 / 中调厚涂 / 高调（铅白底+小面积土红）
     边框：藻井同心收缩 / 联珠纹 / 素边双线 / 破损无框
     母题：团花 / 飞天飘带 / 莲花 / 忍冬卷草 / 联珠圈 / 无（纯壁画底）
   ⚠ 刻意避开 Claude 默认区（官方 frontend-design skill 点名的
     「米黄 #F4F1EA + 陶土 #D97757」）：敦煌的直觉确实容易滑向那里，
     所以本族主调走**沉土红/石青/墨黑**，铅白只作线与高光，不做整片米色底。

   ── 技术红线（本轮实测踩出来的，别重犯）──────────────────────────────
     · 位移量一律**绝对像素**，绝不乘 SPAN（jp 家族 100 套因此网格甩成交叉乱麻）
     · 「基准点 + 法向偏移」要分开写，不能 `jx + (bx - jx)`（guohua 10 套因此塌成点）
     · 对比方向由**底色明暗**决定：暗底配亮线，亮底配暗线
       （mono 32 套因深底用更深的线而网格不可见）
     · 随机用确定性 hash，不用 Math.random（每落一子整盘重绘，会跳）
     · 滤镜显式写 x/y/width/height
     · 真实棋具规格：线宽/线距 ≈ 1:19。格距 37.7px → 线宽 ≈ 2.0
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  /* ── 棋盘几何（与 playable.html 一致：15 路 / viewBox 620 / PAD 46）── */
  const N = 15;
  const PAD = 46;
  const SPAN = 620 - PAD * 2;
  const GAP = SPAN / (N - 1);          // 37.71
  const XY = (i) => PAD + i * GAP;
  const LW = GAP / 19;                 // 真实棋具线宽比 ≈1:19 → 1.98px

  /* ── 敦煌矿物色板 ───────────────────────────────────────────────────
     土红/朱砂/石青/石绿/铅白/泥金/赭石/紫（铅白日久返铅的陈旧色） */
  const C = {
    tuRed: "#8f3a28",     // 土红（北魏主调）
    tuRedHi: "#a8492f",   // 土红亮处
    cinnabar: "#c2492f",  // 朱砂
    azurite: "#2c5f8a",   // 石青
    azuriteHi: "#3d7ba8",
    malachite: "#2e7d5a", // 石绿
    malachiteHi: "#4f9d69",
    chalk: "#ece4d2",     // 铅白/石膏（线、高光）
    chalkDim: "#d8ceb8",
    ochre: "#8a5a38",     // 赭石
    gold: "#e0ac46",      // 泥金
    goldHi: "#ffd97a",
    ink: "#1f1a14",       // 墨
    umber: "#2b2118",     // 黑褐（北魏暗部）
    purple: "#7c4258",    // 绛紫（氧化陈旧）
    clay: "#6b4a30",      // 泥底（剥落露出的胎）
  };

  /* ── 工具 ─────────────────────────────────────────────────────────── */

  /** 确定性伪随机。⚠ 不是密码学用途，只给 SVG 形状做确定性微扰；
   *  "可被预测"正是本意（同一棋子每次渲染必须一样）。安全扫描器报弱随机属误报。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  };

  /** 抖动滤镜。⚠ x/y/width/height 必须显式写，否则位移被裁。
   *  @param m 滤镜区外扩百分比。默认 30 是给**细长网格线**留的：那些 path 的
   *           bbox 高只有几 px，外扩少了抖动会被裁成直线。团花这种大块头用 6 就够
   *           （滤镜区越大越贵：动画时每一帧都要重刷这一块）。 */
  const wobble = (id, { bf = ".018", oct = 2, seed = 7, scale = 2.2, m = 30 } = {}) =>
    `<filter id="${id}" x="-${m}%" y="-${m}%" width="${100 + m * 2}%" height="${100 + m * 2}%">
       <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="${oct}" seed="${seed}" result="w"/>
       <feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     </filter>`;

  /** 无障碍：系统开了「减少动态效果」就把这条选择器上的动画全掐掉。
   *  每个自带动效（boardMotions / stoneMotions）都必须带这条，
   *  `.check-motion.mjs` 会用 emulateMedia(reduce) 逐块盘验。 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /** 墙皮颗粒（壁画胎体的砂质感）。 */
  const wall = (P, { slope = ".2", seed = 5, bf = ".7" } = {}) => `
    <filter id="${P("wall")}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="3" seed="${seed}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`;

  /** 泥底（剥落处露出的胎体）：粗糙深色块。 */
  const clayPat = (P, { color = C.clay, op = .55 } = {}) => `
    <pattern id="${P("clay")}" width="9" height="9" patternUnits="userSpaceOnUse">
      <rect width="9" height="9" fill="${color}"/>
      <circle cx="2.4" cy="3.1" r="1.1" fill="#000" opacity="${op * .5}"/>
      <circle cx="6.6" cy="6.4" r="1.3" fill="#fff" opacity="${op * .18}"/>
      <circle cx="7.2" cy="1.8" r=".8" fill="#000" opacity="${op * .4}"/>
    </pattern>`;

  /** 网格线：每根线单独一条 path（各自偏移/粗细/透明度），各自挂 wob 滤镜。
   *  ⚠ 偏移与弧度都是**绝对像素**：jit/bow 直接给 px。
   *  ⚠ 性能口径（做过实验，别再试第二种写法）：敦煌盘上有东西要动时，
   *    网格的滤镜实例会被连带重刷 ——
   *      每条 path 各挂 wob（现在这样）：动效开 40 FPS
   *      整组挂一个 wob（试过，已回退）：动效开 24 FPS，因为一个 686×686 的
   *                                        低频 turbulence 每帧重跑比 174 个
   *                                        细长小区更贵
   *      网格不挂滤镜：60 FPS
   *    也就是说这块盘的动效预算，全花在"动的那块东西扫过多少滤镜区"上。
   *    飘带因此改成把抖动烘进几何（见 handLine），不再挂滤镜。
   *  @param dark  底色是否偏暗 → true 用亮线，false 用暗线（对比方向由底色定）
   *  @param taper 兰叶描：线宽沿线起伏（true）；铁线描：等宽（false）
   *  @param broken 剥落感：随机把部分线切成几段 */
  const grid = (P, {
    stroke, seed = 20260928, jit = 1.4, bow = 2.6, w = LW, wJit = .5,
    op = .9, taper = false, broken = 0, filter = "wob",
  } = {}) => {
    let g = "";
    for (const [s, vertical] of [[seed, false], [seed + 137, true]]) {
      const rand = rng(s);
      for (let i = 0; i < N; i += 1) {
        const v = XY(i);
        const j = () => (rand() - 0.5) * jit;
        const x0 = vertical ? v + j() : PAD, y0 = vertical ? PAD : v + j();
        const x1 = vertical ? v + j() : PAD + SPAN, y1 = vertical ? PAD + SPAN : v + j();
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        const off = (rand() - 0.5) * bow * 2;      // 绝对像素
        const w1 = w + (rand() - 0.5) * wJit;
        // 兰叶描：中段加粗。用两段二次曲线近似粗细变化（SVG 无 per-vertex 线宽）
        if (taper) {
          const steps = 6;
          let d = "";
          for (let k = 0; k < steps; k += 1) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            const px0 = x0 + (x1 - x0) * t0, py0 = y0 + (y1 - y0) * t0;
            const px1 = x0 + (x1 - x0) * t1, py1 = y0 + (y1 - y0) * t1;
            const om = Math.sin(Math.PI * (t0 + t1) / 2);
            const cxm = (px0 + px1) / 2 + nx * off * om, cym = (py0 + py1) / 2 + ny * off * om;
            d += `<path d="M${px0.toFixed(1)} ${py0.toFixed(1)}Q${cxm.toFixed(1)} ${cym.toFixed(1)} ${px1.toFixed(1)} ${py1.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${(w1 * (0.72 + om * 0.62)).toFixed(2)}" stroke-linecap="round" opacity="${op}"/>`;
          }
          g += d;
          continue;
        }
        const cx = mx + nx * off, cy = my + ny * off;
        if (broken > 0 && rand() < broken) {
          // 剥落：把这条线切成 2–3 段，段间留缺口
          const cuts = 2 + Math.floor(rand() * 2);
          let prev = 0;
          for (let k = 1; k <= cuts; k += 1) {
            const t = k === cuts ? 1 : prev + (0.5 + rand() * 0.45) / cuts;
            if (t - prev > 0.12) {
              const ax = x0 + (x1 - x0) * prev, ay = y0 + (y1 - y0) * prev;
              const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t;
              const cm = (prev + t) / 2;
              g += `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)}Q${(mx + nx * off * Math.sin(Math.PI * cm)).toFixed(1)} ${(my + ny * off * Math.sin(Math.PI * cm)).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${w1.toFixed(2)}" stroke-linecap="round" opacity="${(op * 0.94).toFixed(2)}"/>`;
            }
            prev = t + 0.05;
          }
          continue;
        }
        g += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${w1.toFixed(2)}" stroke-linecap="round" opacity="${op}"/>`;
      }
    }
    // 滤镜按**整层一次**算，不给每条线各挂一个：原来 30 条线 ×2 向 + 剥落切段 = 约 190 个元素
    // 各带一个 feTurbulence 位移滤镜，落一子就要重栅格化 190 次（桌面实测摘掉滤镜落子 10ms→4ms，手机更贵）。
    // 合并成一个 <g filter> 之后手抖还在、反而像一整张纸上画的，代价从 190 次降到 1 次。
    return filter ? `<g filter="url(#${P(filter)})">${g}</g>` : g;
  };

  /** 藻井：同心方框逐层收缩（敦煌天花的签名结构），做棋盘外框。
   *  @param inset 最内层整体再往里让多少 px（叠第二遍藻井时用，别用字符串 replace） */
  const zaojing = (P, { stroke = C.gold, layers = 4, gap = 7, op = .8, w = 2.2, inset = 5 } = {}) => {
    let s = "";
    for (let i = 0; i < layers; i += 1) {
      const o = inset + i * gap;
      s += `<rect x="${o}" y="${o}" width="${620 - o * 2}" height="${620 - o * 2}" rx="${Math.max(2, 10 - i * 2)}"
              fill="none" stroke="${stroke}" stroke-width="${(w * (1 - i * 0.12)).toFixed(2)}"
              opacity="${(op * (1 - i * 0.13)).toFixed(2)}" filter="url(#${P("wob")})"/>`;
    }
    return s;
  };

  /** 联珠圈：西域/敦煌边饰（一圈小珠夹一个大珠）。 */
  const pearlBorder = (P, { color = C.gold, op = .72, step = 26 } = {}) => {
    let s = "";
    const edge = 12;
    for (let v = edge + step / 2; v < 620 - edge; v += step) {
      s += `<circle cx="${v.toFixed(1)}" cy="${edge}" r="3.4" fill="none" stroke="${color}" stroke-width="1.5" opacity="${op}"/>`;
      s += `<circle cx="${v.toFixed(1)}" cy="${(620 - edge).toFixed(1)}" r="3.4" fill="none" stroke="${color}" stroke-width="1.5" opacity="${op}"/>`;
      s += `<circle cx="${edge}" cy="${v.toFixed(1)}" r="3.4" fill="none" stroke="${color}" stroke-width="1.5" opacity="${op}"/>`;
      s += `<circle cx="${(620 - edge).toFixed(1)}" cy="${v.toFixed(1)}" r="3.4" fill="none" stroke="${color}" stroke-width="1.5" opacity="${op}"/>`;
    }
    return `<g filter="url(#${P("wob")})">${s}</g>`;
  };

  /** 手抖线：把「滤镜抖出来的笔触」直接烘进几何，不再挂 feTurbulence。
   *
   *  沿曲线取若干点，每点按**低频确定性噪声**沿法向偏移，再平滑连成一条 path。
   *  为什么要烘而不挂滤镜：这条带子要被动画带着走。挂在滤镜组里的 transform
   *  会让浏览器每帧重刷那张噪声图（飘带的滤镜区约 1000×800 px），
   *  实测 60 → 49 FPS（900×900 视口、headless 软件光栅，是最悲观的口径）；
   *  烘进几何只在生成时算一次，之后动画怎么错峰都不再碰滤镜。
   *  ⚠ 用 rng(seed) 不用 Math.random —— 每次重绘必须一模一样（README 红线）。
   *  @param steps 每段贝塞尔的采样点数（越大越贴原曲线，path 字符串也越长）
   *  @param amp   法向偏移幅度（绝对 px）。平滑连线会吃掉约一半，
   *               2.4 ≈ 视觉 ±1.2px，与原来 wobble({scale:3}) 的 ±1.5px 同一量级。 */
  const handLine = (segs, { seed = 1, amp = 2.4, steps = 8 } = {}) => {
    const rand = rng(seed);
    // 先给 K 个「波节」随机值，波节之间余弦插值 —— 要的是缓慢起伏，不是锯齿
    const K = 5;
    const kv = Array.from({ length: K + 1 }, () => rand() * 2 - 1);
    const wave = (u) => {
      const f = u * K, i = Math.min(K - 1, Math.floor(f)), t = f - i;
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return kv[i] * (1 - s) + kv[i + 1] * s;
    };
    const pts = [];
    segs.forEach(([x0, y0, ax, ay, bx, by, x1, y1], si) => {
      for (let k = si === 0 ? 0 : 1; k <= steps; k += 1) {      // 段间接点重合，跳过重复
        const t = k / steps, mt = 1 - t;
        const X = mt ** 3 * x0 + 3 * mt * mt * t * ax + 3 * mt * t * t * bx + t ** 3 * x1;
        const Y = mt ** 3 * y0 + 3 * mt * mt * t * ay + 3 * mt * t * t * by + t ** 3 * y1;
        const dx = 3 * mt * mt * (ax - x0) + 6 * mt * t * (bx - ax) + 3 * t * t * (x1 - bx);
        const dy = 3 * mt * mt * (ay - y0) + 6 * mt * t * (by - ay) + 3 * t * t * (y1 - by);
        const len = Math.hypot(dx, dy) || 1;
        const w = wave((si + t) / segs.length) * amp;
        pts.push([X - (dy / len) * w, Y + (dx / len) * w]);
      }
    });
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i += 1) {
      d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1)} ${((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    return `${d}L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  };

  /** 团花：中心放射花瓣（藻井心）。
   *  ⚠ 结构是「外层 class + 内层 filter」两层：**动画只挂外层**。
   *    直接给带 feTurbulence 的组做 transform，等于每帧重跑那张噪声图
   *    （README 红线：绝不动滤镜的输入）。外层拆出来之后动画只搬图层。
   *  @param wob 抖动用哪条滤镜。会被动画转动的块头要给一条**外扩小的**
   *             （滤镜区越大越贵；wob 的 160% 是给细长网格线留的，团花用不上） */
  const rosette = (P, { cx = 310, cy = 310, r = 96, color = C.gold, op = .5, petals = 8, wob = "wob" } = {}) => {
    let s = `<circle cx="${cx}" cy="${cy}" r="${(r * 0.2).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" opacity="${op}"/>`;
    for (let i = 0; i < petals; i += 1) {
      const a = (i / petals) * Math.PI * 2;
      const px = cx + Math.cos(a) * r * 0.62, py = cy + Math.sin(a) * r * 0.62;
      s += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r * 0.26).toFixed(1)}" ry="${(r * 0.13).toFixed(1)}"
              fill="none" stroke="${color}" stroke-width="1.8" opacity="${op}"
              transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${px.toFixed(1)} ${py.toFixed(1)})"/>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.4" opacity="${op * 0.8}"/>`;
    return `<g class="${P("rosette")}"><g filter="url(#${P(wob)})">${s}</g></g>`;
  };

  /** 飞天飘带：穿越盘面的连续长弧（只压边角，不挡落子区中心）。
   *
   *  曲线用 handLine 烘成手抖线，**这条带上不挂滤镜** —— 四条要各自错开相位起伏，
   *  那才是"飞天飘带各自飘"，而不是"整块板在平移"。
   *  （这里曾经还叠过一层沿带流动的泥金虚线，用户看过实物后要求去掉：
   *    上下两条带各有一小段亮线横穿，抢了飘带本身的走势。动效见 boardMotions。） */
  const RIBBON_SEGS = [
    [[18, 150, 120, 96, 210, 178, 300, 120], [300, 120, 390, 62, 470, 40, 604, 118]],
    [[16, 178, 126, 128, 214, 206, 306, 148], [306, 148, 398, 90, 478, 70, 606, 146]],
    [[18, 470, 118, 528, 224, 452, 320, 508], [320, 508, 416, 564, 486, 586, 604, 502]],
    [[20, 496, 124, 552, 226, 478, 322, 532], [322, 532, 418, 586, 488, 606, 602, 528]],
  ];
  const RIBBON_W = [7, 3.2, 6.4, 3];
  const ribbons = (P, { color = C.chalk, op = .3, seed = 4701 } = {}) => {
    const ds = RIBBON_SEGS.map((segs, i) => handLine(segs, { seed: seed + i * 137 }));
    return `
    <g class="${P("ribbon")}" fill="none" stroke="${color}" stroke-linecap="round" opacity="${op}">
      ${ds.map((d, i) => `<path class="${P("ribbon-p")}" style="--i:${i}" d="${d}" stroke-width="${RIBBON_W[i]}"/>`).join("")}
    </g>`;
  };

  /** 虫洞剥落：露出泥底的破洞（壁画的岁月证据）。 */
  const peeling = (P, { seed = 991, n = 9, color = "clay", op = .85 } = {}) => {
    const rand = rng(seed);
    let s = "";
    for (let i = 0; i < n; i += 1) {
      // 主要分布在边角，避开中央落子密集区
      const edge = rand();
      const cx = edge < 0.5 ? 30 + rand() * 120 : 470 + rand() * 120;
      const cy = 40 + rand() * 540;
      const r = 6 + rand() * 17;
      s += `<path d="${blobPath(cx, cy, r, Math.round(cx * 7 + cy * 3), { wob: 0.34, n: 9 })}"
              fill="url(#${P(color)})" opacity="${(op * (0.6 + rand() * 0.4)).toFixed(2)}"
              stroke="#00000030" stroke-width=".8"/>`;
    }
    return `<g filter="url(#${P("wob")})">${s}</g>`;
  };

  /** 不规则团块（剥洞、棋子轮廓共用）。半径波动 0.93–1.07。 */
  const blobPath = (x, y, r, seed, { wob = 0.14, n = 14 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - wob / 2 + rand() * wob);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i += 1) {
      const c = pts[(i + 1) % n], nx = pts[(i + 2) % n];
      d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
    }
    return `${d}Z`;
  };

  /** 敦煌棋子：不规则轮廓 + 平涂 + 贴边一道受光弧。
   *
   *  ⚠ 对比方向由**底色明暗**决定，不是由"棋子是什么颜色"决定。
   *    第一版把黑子的描边配成比土红底更深的 #0f0603 —— 暗底上等于没描边，
   *    `.check-contrast.mjs` 实测 10 套全 FAIL（黑子/盘底 1.01~1.07）。
   *    这跟 mono 家族「深底用更深的线」是同一个错误。
   *    正确做法：暗底 → 一律亮描边；亮底 → 一律暗描边；且描边要**压在半径上**
   *    （一半在子内），否则量不到、也看不出。 */
  const relLum = (hex) => {
    const h = String(hex).replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const wcag = (a, b) => {
    const l1 = relLum(a), l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  /** 描边方向：底色暗 → 亮边；底色亮 → 暗边。
   *  ⚠ 一律描边，不做"够对比就不描"的条件判断。
   *    两个原因：① 判断用的 boardLum 是手写的，而实际盘面有渐变+暗角，
   *    估偏就会跳过描边（第一版正是这样，黑子 1.4~2.1 全部不合格）；
   *    ② **铁线描本来就是敦煌壁画的定义特征**——画里所有形象都有轮廓线，
   *    棋子带一圈轮廓不但为了可见性，也符合画种本身。 */
  const rimFor = (board, boardLum) =>
    ((board ? relLum(board) : boardLum) < 0.4)
      ? "rgba(246,238,218,.95)"   // 暗底 → 石膏亮边
      : "rgba(28,15,6,.9)";       // 亮底 → 墨暗边

  const dhStone = ({ P, body, bodyAlt, glow, glowAlt, ring, board, boardLum }) =>
    ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 13 + y * 7 + player * 211);
      const fill = player === 1 ? body : bodyAlt;
      const bright = player === 1 ? glow : glowAlt;
      const rim = rimFor(board, boardLum);
      let s = "";
      // ① 子体（先画，避免被后面的轮廓盖住内半）
      s += `<path d="${blobPath(x, y, r, seed, { wob: .15, n: 12 })}" fill="${fill}"
                stroke="${player === 1 ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.25)"}"
                stroke-width="${(r * .1).toFixed(2)}" stroke-linejoin="round"
                filter="url(#${P("wob2")})"/>`;
      // ② 铁线描轮廓**压在子体之上**，环带取 0.80R~1.06R。
      //    ⚠ 顺序很关键：早先轮廓画在子体前面，被 body 的填充盖掉内半，
      //    只剩 1.05R 以外可见 —— 于是"加了描边但数值没变"（实测黑子仍 1.4~2.1）。
      s += `<path d="${blobPath(x, y, r * 0.93, seed, { wob: .15, n: 12 })}" fill="none"
              stroke="${rim}" stroke-width="${(r * 0.26).toFixed(2)}" filter="url(#${P("wob2")})"/>`;
      // 贴左上边缘的受光弧
      s += `<path d="M${(x - r * .68).toFixed(1)} ${(y + r * .12).toFixed(1)}
                 A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(x + r * .1).toFixed(1)} ${(y - r * .66).toFixed(1)}"
              fill="none" stroke="${bright}" stroke-width="${(r * .14).toFixed(2)}"
              stroke-linecap="round" opacity=".6" filter="url(#${P("wob2")})"/>`;
      if (isLast) {
        s += `<path d="${blobPath(x, y, r + 4.5, seed + 5, { wob: .1 })}" fill="none"
                stroke="${ring}" stroke-width="2.6" filter="url(#${P("wob2")})"/>`;
      }
      return s;
    };

  /** 星位：像手按上去的（不完美圆、略偏心）。 */
  const dhStars = (P, { color, r = 4.2, seed = 313 }) => {
    const rand = rng(seed);
    return [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]].map(([rr, cc]) => {
      const x = XY(cc) + (rand() - .5) * 1.6, y = XY(rr) + (rand() - .5) * 1.6;
      return `<path d="${blobPath(x, y, r * (0.9 + rand() * 0.2), Math.round(x * 5 + y), { wob: .18, n: 9 })}"
              fill="${color}" filter="url(#${P("wob2")})"/>`;
    }).join("");
  };

  /* ══════════════════════════════════════════════════════════════════
     01 · 敦煌土红地 ★基准版
     北魏浓郁厚重：土红压底 + 铅白铁线描网格 + 藻井同心框 + 团花中心。
     明度结构=暗调；线性格=等宽铁线；边框=藻井；母题=团花。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-tured");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 土红地",
      swatch: C.tuRed,
      pageBg: "#1a0e0a",
      vars: {
        "--bd-bg": C.tuRed, "--bd-line": C.chalk, "--bd-star": C.chalk,
        "--st-black": "#241009", "--st-white": C.chalk,
        "--ui-accent": C.gold, "--bd-radius": "8px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".016", oct: 2, seed: 21, scale: 2.4 })}
        ${wobble(P("wob2"), { bf: ".034", oct: 2, seed: 33, scale: 4.6 })}
        ${wall(P, { slope: ".22", seed: 7, bf: ".66" })}
        ${clayPat(P)}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#9c4229"/><stop offset=".55" stop-color="${C.tuRed}"/>
          <stop offset="1" stop-color="#6f2c1d"/>
        </linearGradient>
        <radialGradient id="${P("lit")}" cx="42%" cy="34%" r="62%">
          <stop offset="0" stop-color="${C.tuRedHi}" stop-opacity=".5"/>
          <stop offset="1" stop-color="#4a1c12" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="48%" r="76%">
          <stop offset=".42" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#2a0f08" stop-opacity=".66"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("lit")})"/>
        ${peeling(P, { seed: 771, n: 8 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".62"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // ⚠ 团花已按要求移到「飞天飘带」，土红地这里留空，
      //   只留藻井金框 + 石膏白网格 —— 两版因此不再撞脸。
      gridExtra: grid(P, { stroke: C.chalk, seed: 20260928, op: .88, taper: false })
        + `<g>${dhStars(P, { color: C.chalk })}</g>`,
      frame: zaojing(P, { stroke: C.gold, layers: 4, op: .8 })
        + `<rect x="34" y="34" width="552" height="552" fill="none" stroke="${C.chalk}" stroke-width="1.2" opacity=".34" filter="url(#${P("wob")})"/>`,
      starFill: C.chalk, starR: 0,
      stone: dhStone({
        P, body: "#241009", bodyAlt: C.chalk,
        line: "#0f0603", lineAlt: "#5a2a1a",
        glow: "#8a5a3a", glowAlt: "#c2b49a",
        ring: C.goldHi, boardLum: 0.13,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     02 · 石青地
     盛唐华丽：石青大面积压底（冷暗调），泥金无骨线画格 —— 与 01 的
     「暖底+白线」在**明度结构 + 线性格 + 边框**三轴同时不同。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-azurite");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 石青地",
      swatch: C.azurite,
      pageBg: "#08111c",
      vars: {
        "--bd-bg": C.azurite, "--bd-line": C.gold, "--bd-star": C.goldHi,
        "--st-black": "#0a1826", "--st-white": "#f2ead6",
        "--ui-accent": C.gold, "--bd-radius": "8px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".014", oct: 2, seed: 41, scale: 2.2 })}
        ${wobble(P("wob2"), { bf: ".03", oct: 2, seed: 53, scale: 4.2 })}
        ${wall(P, { slope: ".18", seed: 11, bf: ".72" })}
        ${clayPat(P, { color: "#1a2f45" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#3a729f"/><stop offset=".5" stop-color="${C.azurite}"/>
          <stop offset="1" stop-color="#1a3d5c"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="46%" r="74%">
          <stop offset=".44" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#060f1a" stop-opacity=".62"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${peeling(P, { seed: 883, n: 7 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".54"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // 泥金无骨线：略粗、等宽、不抖太多
      gridExtra: grid(P, { stroke: C.gold, seed: 40506, op: .9, w: LW * 1.15, wJit: .3, jit: 1.0 })
        + `<g>${dhStars(P, { color: C.goldHi, seed: 707 })}</g>`,
      frame: zaojing(P, { stroke: C.goldHi, layers: 3, gap: 8, op: .72 })
        + pearlBorder(P, { color: C.gold, op: .6 }),
      starFill: C.goldHi, starR: 0,
      stone: dhStone({
        P, body: "#0a1826", bodyAlt: "#f2ead6",
        line: "#040a12", lineAlt: "#8a7a52",
        glow: "#4a7ba8", glowAlt: "#c8bfa4",
        ring: C.goldHi, boardLum: 0.12,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     03 · 飞天飘带
     结构轴差异：**兰叶描**（线宽沿线起伏）+ 飘带母题穿越盘面 + 中调。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-feitian");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 飞天飘带",
      swatch: C.cinnabar,
      pageBg: "#1c0f0c",
      vars: {
        "--bd-bg": "#9a4630", "--bd-line": C.chalk, "--bd-star": C.goldHi,
        "--st-black": "#2a1208", "--st-white": "#f4ecda",
        "--ui-accent": C.gold, "--bd-radius": "10px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".018", oct: 3, seed: 61, scale: 3.0 })}
        ${wobble(P("wobR"), { bf: ".018", oct: 2, seed: 61, scale: 3.0, m: 6 })}
        ${wobble(P("wob2"), { bf: ".036", oct: 2, seed: 73, scale: 5.0 })}
        ${wall(P, { slope: ".2", seed: 13, bf: ".68" })}
        ${clayPat(P, { color: "#5e2a18" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2=".8">
          <stop offset="0" stop-color="#a8543a"/><stop offset=".5" stop-color="#94402a"/>
          <stop offset="1" stop-color="#6e2a1a"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="50%" r="74%">
          <stop offset=".46" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#2c1008" stop-opacity=".58"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${ribbons(P, { color: C.chalk, op: .26 })}
        ${peeling(P, { seed: 991, n: 6 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".58"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // 团花从「土红地」移过来了：飘带绕着团花走，这版变成完整的一幅经变画构图
      // ⚠ wobR 是给团花单独开的滤镜（外扩只有 6%，见 wobble 注释）——
      //   团花要绕盘心慢转，滤镜区每大一分，每帧要重刷的噪声面积就按平方涨。
      gridExtra: rosette(P, { color: C.gold, op: .46, r: 104, wob: "wobR" })
        + grid(P, { stroke: C.chalk, seed: 70809, op: .86, taper: true, jit: 1.6, bow: 3.4 })
        + `<g>${dhStars(P, { color: C.goldHi, seed: 808 })}</g>`,
      frame: `<rect x="8" y="8" width="604" height="604" rx="10" fill="none" stroke="${C.gold}" stroke-width="3" opacity=".7" filter="url(#${P("wob")})"/>`
        + `<rect x="17" y="17" width="586" height="586" rx="6" fill="none" stroke="${C.chalk}" stroke-width="1.1" opacity=".32" filter="url(#${P("wob")})"/>`,
      starFill: C.goldHi, starR: 0,
      stone: dhStone({
        P, body: "#2a1208", bodyAlt: "#f4ecda",
        line: "#120702", lineAlt: "#6a3a22",
        glow: "#9a6a44", glowAlt: "#cfc4a8",
        ring: C.goldHi, boardLum: 0.14,
      }),
      css: "",
      /* ── 自带动效（样板）：这块盘的画面里有两样东西该动 ──────────────
         ① 飞天飘带（overlay）—— 四条各自错相位、随风起伏
         ② 中心团花（gridExtra）—— 极缓自转 + 明暗呼吸
         契约：css(id) 只返回这个方案要的 @keyframes + 规则，选择器一律 #board 打头，
         类名一律用 P() 生成（自带皮肤前缀，不会和别的棋盘撞）。 */
      boardMotions: [{
        id: "bmo-dh-feitian",
        name: "飘带起伏 · 团花缓转",
        desc: "四条飘带各自错相位随风起伏，团花极缓自转",
        css: (id) => `
          /* 四条飘带各自起伏，--i 给相位差。同步平移会一眼看出是"整块板在动"。
             ⚠ 动画挂在**没有滤镜**的 path 上（飘带的手抖已烘进几何，见 ribbons()）。 */
          @keyframes ${id}-sway{
            0%,100% { transform: translate(0,0)        rotate(0deg) }
            40%     { transform: translate(-4px,-5px)  rotate(-.45deg) }
            75%     { transform: translate(3px,3px)    rotate(.3deg) }
          }
          #board .${P("ribbon-p")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-sway 13s ease-in-out infinite;
            animation-delay: calc(var(--i) * -3.1s);
          }
          /* 团花：盘心对称，fill-box 中心就是盘心，绕它转正好。
             周期给到 120s —— 用户要的是"缓慢旋转"，不是"在转圈"。
             呼吸只在基线之下走（.8→1）：组 opacity 会**乘**在每根线的 opacity 上，
             给到 1 以上并不会更亮，只会被截断。 */
          @keyframes ${id}-spin{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
          @keyframes ${id}-breath{ 0%,100%{opacity:.8} 50%{opacity:1} }
          #board .${P("rosette")}{
            transform-box: fill-box; transform-origin: center;
            animation: ${id}-spin 120s linear infinite, ${id}-breath 18s ease-in-out infinite;
          }
          ${RM(`#board .${P("ribbon-p")},#board .${P("rosette")}`)}
        `,
      }],
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     04 · 藻井叠框
     结构轴差异：**边框即主角**（8 层同心收缩铺满边缘）+ 高调（浅底）。
     明度结构与前几版反向 —— 铅白地 + 土红细线。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-zaojing");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 藻井叠框",
      swatch: C.chalkDim,
      pageBg: "#241a12",
      vars: {
        "--bd-bg": "#e8dcc4", "--bd-line": C.tuRed, "--bd-star": C.azurite,
        "--st-black": "#3a2010", "--st-white": "#fbf6ea",
        "--ui-accent": C.cinnabar, "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".015", oct: 2, seed: 81, scale: 2.0 })}
        ${wobble(P("wob2"), { bf: ".032", oct: 2, seed: 93, scale: 4.0 })}
        ${wall(P, { slope: ".14", seed: 17, bf: ".78" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stop-color="#f2e8d4"/><stop offset="1" stop-color="#ddd0b4"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".5"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // 亮底 → 暗线（对比方向跟着底色走）
      gridExtra: grid(P, { stroke: C.tuRed, seed: 11213, op: .8, w: LW * .95 })
        + rosette(P, { color: C.azurite, op: .3, r: 132, petals: 12 })
        + `<g>${dhStars(P, { color: C.cinnabar, seed: 909 })}</g>`,
      // 8 层同心：这一版的签名（外圈土红粗框 + 内圈泥金细框）
      frame: zaojing(P, { stroke: C.tuRed, layers: 8, gap: 4.2, op: .82, w: 2.6, inset: 5 })
        + zaojing(P, { stroke: C.gold, layers: 3, gap: 4.2, op: .5, inset: 42 }),
      starFill: C.cinnabar, starR: 0,
      stone: dhStone({
        P, body: "#3a2010", bodyAlt: "#fbf6ea",
        line: "#1c0e04", lineAlt: "#8a6a44",
        glow: "#8a6248", glowAlt: "#e8e0cc",
        ring: C.cinnabar, boardLum: 0.74,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     05 · 虫洞剥落
     结构轴差异：**剥落断续线**（网格随机断口）+ 大量露胎 + 破损无整框。
     时间感最重的一版。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-peel");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 虫洞剥落",
      swatch: C.ochre,
      pageBg: "#181208",
      vars: {
        "--bd-bg": "#7a5236", "--bd-line": "#e4d8bc", "--bd-star": "#e4d8bc",
        "--st-black": "#241608", "--st-white": "#efe4c8",
        "--ui-accent": "#b06a34", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".02", oct: 3, seed: 101, scale: 3.4 })}
        ${wobble(P("wob2"), { bf: ".04", oct: 2, seed: 113, scale: 5.4 })}
        ${wall(P, { slope: ".26", seed: 19, bf: ".6" })}
        ${clayPat(P, { color: "#3f2c18", op: .7 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#8a5f3c"/><stop offset=".55" stop-color="#6f4a2c"/>
          <stop offset="1" stop-color="#4e3320"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="46%" cy="44%" r="72%">
          <stop offset=".4" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#1c1008" stop-opacity=".68"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${peeling(P, { seed: 1201, n: 16 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".72"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // broken=0.55：过半的线有断口
      gridExtra: grid(P, { stroke: "#e4d8bc", seed: 13141, op: .82, broken: 0.55, jit: 1.8, bow: 3.0, w: LW * 1.05 })
        + `<g>${dhStars(P, { color: "#e4d8bc", seed: 1515 })}</g>`,
      // 破损边框：只画两段残墙，不做完整框
      frame: `
        <path d="M10 10h236M10 10v214" fill="none" stroke="#c9a870" stroke-width="4" opacity=".6" stroke-linecap="round" filter="url(#${P("wob")})"/>
        <path d="M610 610H398M610 610V402" fill="none" stroke="#c9a870" stroke-width="4" opacity=".52" stroke-linecap="round" filter="url(#${P("wob")})"/>
      `,
      starFill: "#e4d8bc", starR: 0,
      stone: dhStone({
        P, body: "#241608", bodyAlt: "#efe4c8",
        line: "#100a04", lineAlt: "#6a4a28",
        glow: "#8a6a44", glowAlt: "#d4c8ac",
        ring: "#e0ac46", boardLum: 0.11,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     06 · 石绿浅绛
     结构轴差异：石绿主调（冷中调）+ 忍冬卷草母题 + 联珠边框。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-malachite");
    const honeysuckle = (color, op) => {
      const rand = rng(2468);
      let s = "";
      for (let i = 0; i < 7; i += 1) {
        const x = 40 + i * 90 + (rand() - .5) * 20;
        s += `<path d="M${x.toFixed(1)} 30c14 16 6 34-8 40 16 4 26-8 26-24"
                fill="none" stroke="${color}" stroke-width="2.6" opacity="${op}" stroke-linecap="round"/>`;
        s += `<path d="M${(x + 12).toFixed(1)} 590c-14-16-6-34 8-40-16-4-26 8-26 24"
                fill="none" stroke="${color}" stroke-width="2.6" opacity="${op}" stroke-linecap="round"/>`;
      }
      return `<g filter="url(#${P("wob")})">${s}</g>`;
    };
    push({
      group: "敦煌土红地",
      name: "敦煌 · 石绿浅绛",
      swatch: C.malachite,
      pageBg: "#0c1814",
      vars: {
        "--bd-bg": C.malachite, "--bd-line": "#f0ead4", "--bd-star": C.goldHi,
        "--st-black": "#0e2018", "--st-white": "#f4f0dc",
        "--ui-accent": C.gold, "--bd-radius": "10px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".017", oct: 2, seed: 121, scale: 2.6 })}
        ${wobble(P("wob2"), { bf: ".033", oct: 2, seed: 133, scale: 4.4 })}
        ${wall(P, { slope: ".19", seed: 23, bf: ".7" })}
        ${clayPat(P, { color: "#1d3a2c" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stop-color="#3f9070"/><stop offset=".5" stop-color="${C.malachite}"/>
          <stop offset="1" stop-color="#1c5540"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="46%" r="74%">
          <stop offset=".44" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#08201a" stop-opacity=".6"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${peeling(P, { seed: 1403, n: 6 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".56"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      gridExtra: grid(P, { stroke: "#f0ead4", seed: 16171, op: .85, taper: true, jit: 1.5, bow: 2.8 })
        + honeysuckle(C.gold, .5)
        + `<g>${dhStars(P, { color: C.goldHi, seed: 1717 })}</g>`,
      frame: pearlBorder(P, { color: C.gold, op: .66, step: 24 })
        + `<rect x="20" y="20" width="580" height="580" rx="8" fill="none" stroke="${C.chalk}" stroke-width="1.2" opacity=".3" filter="url(#${P("wob")})"/>`,
      starFill: C.goldHi, starR: 0,
      stone: dhStone({
        P, body: "#0e2018", bodyAlt: "#f4f0dc",
        line: "#04100a", lineAlt: "#3a6a52",
        glow: "#4a8a6c", glowAlt: "#c8c0a4",
        ring: C.goldHi, boardLum: 0.19,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     07 · 经变白地
     结构轴差异：**高调**（大面积石膏白）+ 土红只作小面积点睛 + 素边。
     与 01 的暗调压底完全反向，灰度测试一眼可分。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-sutra");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 经变白地",
      swatch: "#e6dcc2",
      pageBg: "#2a2418",
      vars: {
        "--bd-bg": "#eae1cb", "--bd-line": "#7a4028", "--bd-star": C.cinnabar,
        "--st-black": "#33200f", "--st-white": "#fdfaf0",
        "--ui-accent": C.cinnabar, "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".013", oct: 2, seed: 141, scale: 2.0 })}
        ${wobble(P("wob2"), { bf: ".028", oct: 2, seed: 153, scale: 3.6 })}
        ${wall(P, { slope: ".12", seed: 29, bf: ".8" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stop-color="#f4ecd8"/><stop offset="1" stop-color="#e0d4b8"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".46"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      gridExtra: grid(P, { stroke: "#7a4028", seed: 18192, op: .74, w: LW * .9, jit: 1.2 })
        + rosette(P, { color: C.cinnabar, op: .22, r: 88, petals: 6 })
        + `<g>${dhStars(P, { color: C.azurite, r: 3.8, seed: 1919 })}</g>`,
      frame: `<rect x="12" y="12" width="596" height="596" rx="6" fill="none" stroke="#7a4028" stroke-width="2.4" opacity=".62" filter="url(#${P("wob")})"/>`
        + `<rect x="19" y="19" width="582" height="582" rx="4" fill="none" stroke="#7a4028" stroke-width=".9" opacity=".3" filter="url(#${P("wob")})"/>`,
      starFill: C.azurite, starR: 0,
      stone: dhStone({
        P, body: "#33200f", bodyAlt: "#fdfaf0",
        line: "#180d04", lineAlt: "#8a5a38",
        glow: "#7a5a3c", glowAlt: "#d8ccb0",
        ring: C.cinnabar, boardLum: 0.71,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     08 · 北魏浓重
     结构轴差异：**近黑底**（黑褐压底）+ 赭石线 + 无装饰纯壁面。
     明度结构最暗的一版；星点用石膏白做唯一亮点。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-wei");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 北魏浓重",
      swatch: C.umber,
      pageBg: "#0a0806",
      vars: {
        "--bd-bg": "#2b2118", "--bd-line": "#a8703c", "--bd-star": "#e8dcc0",
        "--st-black": "#100c08", "--st-white": "#e8dcc0",
        "--ui-accent": "#a8703c", "--bd-radius": "4px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".019", oct: 3, seed: 161, scale: 3.2 })}
        ${wobble(P("wob2"), { bf: ".037", oct: 2, seed: 173, scale: 5.2 })}
        ${wall(P, { slope: ".24", seed: 31, bf: ".62" })}
        ${clayPat(P, { color: "#1a1410", op: .8 })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".9" y2="1">
          <stop offset="0" stop-color="#3a2c1e"/><stop offset=".5" stop-color="${C.umber}"/>
          <stop offset="1" stop-color="#181008"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="44%" r="70%">
          <stop offset=".36" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".74"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${peeling(P, { seed: 2021, n: 10 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".7"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      gridExtra: grid(P, { stroke: "#a8703c", seed: 22232, op: .9, w: LW * 1.2, jit: 1.6, bow: 2.8 })
        + `<g>${dhStars(P, { color: "#e8dcc0", r: 4.6, seed: 2323 })}</g>`,
      frame: `<rect x="9" y="9" width="602" height="602" rx="4" fill="none" stroke="#6a4a28" stroke-width="5" opacity=".72" filter="url(#${P("wob")})"/>`,
      starFill: "#e8dcc0", starR: 0,
      stone: dhStone({
        P, body: "#100c08", bodyAlt: "#e8dcc0",
        line: "#000000", lineAlt: "#4a3420",
        glow: "#6a4a2c", glowAlt: "#c0b494",
        ring: "#d99a4a", boardLum: 0.055,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     09 · 绛紫氧化
     结构轴差异：铅白返铅变黑的**陈旧紫**主调 + 联珠圈母题 + 中偏暗。
     用「颜料老化」这个壁画专属现象做结构，不是调色。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-purple");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 绛紫氧化",
      swatch: C.purple,
      pageBg: "#140a10",
      vars: {
        "--bd-bg": C.purple, "--bd-line": "#efe4d0", "--bd-star": C.goldHi,
        "--st-black": "#20101c", "--st-white": "#f2e8d8",
        "--ui-accent": C.gold, "--bd-radius": "12px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".016", oct: 2, seed: 181, scale: 2.6 })}
        ${wobble(P("wob2"), { bf: ".031", oct: 2, seed: 193, scale: 4.4 })}
        ${wall(P, { slope: ".2", seed: 37, bf: ".68" })}
        ${clayPat(P, { color: "#3a1e2c" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stop-color="#8e5068"/><stop offset=".5" stop-color="${C.purple}"/>
          <stop offset="1" stop-color="#52283a"/>
        </linearGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="48%" r="72%">
          <stop offset=".44" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#1a0a14" stop-opacity=".62"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        ${peeling(P, { seed: 2425, n: 8 })}
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".58"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      gridExtra: grid(P, { stroke: "#efe4d0", seed: 26272, op: .84, taper: true, jit: 1.4, bow: 2.6 })
        + rosette(P, { color: C.gold, op: .34, r: 112, petals: 10 })
        + `<g>${dhStars(P, { color: C.goldHi, seed: 2727 })}</g>`,
      frame: pearlBorder(P, { color: C.chalk, op: .5, step: 30 })
        + zaojing(P, { stroke: C.gold, layers: 2, gap: 9, op: .55 }),
      starFill: C.goldHi, starR: 0,
      stone: dhStone({
        P, body: "#20101c", bodyAlt: "#f2e8d8",
        line: "#0c0408", lineAlt: "#5a3048",
        glow: "#8a5a78", glowAlt: "#c8bc9e",
        ring: C.goldHi, boardLum: 0.1,
      }),
      css: "",
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     10 · 泥金联珠
     结构轴差异：**暗金底 + 金线**（无骨发光感）+ 联珠圈铺满四边 + 最高调性反差。
     线性格：不抖（泥金描线是规整的），与前几版的毛笔抖线形成对照。
     ══════════════════════════════════════════════════════════════════ */
  {
    const { P, push } = mk("dh-gold");
    push({
      group: "敦煌土红地",
      name: "敦煌 · 泥金联珠",
      swatch: C.gold,
      pageBg: "#14100a",
      vars: {
        "--bd-bg": "#3d2f18", "--bd-line": C.goldHi, "--bd-star": C.goldHi,
        "--st-black": "#191207", "--st-white": "#f6eac4",
        "--ui-accent": C.goldHi, "--bd-radius": "6px",
      },
      defs: `
        ${wobble(P("wob"), { bf: ".01", oct: 1, seed: 201, scale: 1.2 })}
        ${wobble(P("wob2"), { bf: ".026", oct: 2, seed: 213, scale: 3.2 })}
        ${wall(P, { slope: ".16", seed: 41, bf: ".74" })}
        <linearGradient id="${P("base")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#54401f"/><stop offset=".5" stop-color="#3d2f18"/>
          <stop offset="1" stop-color="#241a0c"/>
        </linearGradient>
        <radialGradient id="${P("sheen")}" cx="34%" cy="26%" r="64%">
          <stop offset="0" stop-color="${C.goldHi}" stop-opacity=".26"/>
          <stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${P("vig")}" cx="50%" cy="46%" r="72%">
          <stop offset=".42" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#100a04" stop-opacity=".7"/>
        </radialGradient>
      `,
      boardFill: `url(#${P("base")})`,
      boardOverlay: `
        <rect width="620" height="620" fill="url(#${P("base")})"/>
        <rect width="620" height="620" fill="url(#${P("sheen")})"/>
        <rect width="620" height="620" filter="url(#${P("wall")})" opacity=".5"/>
        <rect width="620" height="620" fill="url(#${P("vig")})"/>
      `,
      lineStroke: "none", lineW: 0, lineOpacity: 0,
      // 泥金：几乎不抖（jit/bow 很小），线更规整
      gridExtra: grid(P, { stroke: C.goldHi, seed: 28293, op: .88, w: LW * 1.1, jit: 0.7, bow: 1.1, wJit: 0.25 })
        + rosette(P, { color: C.gold, op: .4, r: 92, petals: 8 })
        + `<g>${dhStars(P, { color: C.goldHi, seed: 2929 })}</g>`,
      frame: pearlBorder(P, { color: C.goldHi, op: .8, step: 22 })
        + zaojing(P, { stroke: C.gold, layers: 3, gap: 6, op: .7, w: 2.6 }),
      starFill: C.goldHi, starR: 0,
      stone: dhStone({
        P, body: "#191207", bodyAlt: "#f6eac4",
        line: "#060402", lineAlt: "#7a5a24",
        glow: "#8a6a34", glowAlt: "#d8c894",
        ring: "#fff0b0", boardLum: 0.06,
      }),
      css: "",
    });
  }
})();
