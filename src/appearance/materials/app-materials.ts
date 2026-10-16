/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   软件本体材质移植 · 14 块棋盘 + 16 枚棋子
   ────────────────────────────────────────────────────────────────────────
   这批皮肤不是新画的风，而是**把 src/ 软件本体真正在用的那套材质**
   原样搬到预览页亮出来，让用户在「部件清单」里逐块挑掉不要的，
   留下的再由后续会话补动效。

   真源（只读参考，不改）：
     · 材质清单 + 中文名   src/features/settings/SettingsPage.tsx（VisualThemeSettings）
     · 枚举               src/app-shell-types.ts（BoardTheme / StoneTheme）
     · 白名单校验         src/App.tsx（isBoardTheme / isStoneTheme）
     · 视觉规则           src/styles.css（.board-X / .stones-X）
     · 共享 <defs>        src/App.tsx:1120（radialGradient / linearGradient / pattern / filter）
     · 棋子 SVG 挂载       src/App.tsx:1117（board-X stones-X）+ 1186–1244（notebook/terminal/kawaii/snow/jewel）

   搬运原则（本项目的红线）：
     1. **忠实**：颜色 / 渐变 / 描边 / pattern / 阴影参数一律照 styles.css 与 App.tsx 抄，
        不为了"丰富"自创装饰层。本体是纯色材质就纯色（如 walnut/circuit/jade 盘都是纯色 fill，
        本体里**没有**木纹/锈纹贴图，这里就不加）。
     2. **一套材质 = 一个皮肤对象**，board + stone 都有对应物的（jade/notebook/porcelain/
        blackgold/pale/kawaii/aurora）就把两半写进同一个对象；
        只有盘没有子的（wood/emerald/whitejade/walnut/frosted/circuit/minimal）**只给棋盘半边**；
        只有子没有盘的（classic/yun/ink/mono/snow/terminal/gold-diamond/gold/diamond）**只给棋子半边**。
        —— 本体那一侧没有对应物，就不编造。
     3. **所有 defs id 走 P(n)=>ID-n 前缀**，否则和现有 16 套串味（历史坑：滤镜/渐变糊到别的盘上）。
     4. 本轮 **boardMotions / stoneMotions 全部留空**（动效是后续会话的活）。

   ── SVG 等价物映射（哪些是原样、哪些是等价近似）──────────────────────────
     · 本体棋子是 <circle r=15.6 fill=url(#blackStone-X)> + .stone 描边 + 滤镜，
       这里一一对应：径向/线性渐变 → <radialGradient>/<linearGradient>，
       pattern → <pattern>，box-shadow/filter:drop-shadow → <feDropShadow>，
       background-image:linear-gradient(135deg…) → 对角 <linearGradient>（frosted 盘底）。
     · 本体棋子上的 CSS 类描边（.stones-X .stone{stroke…}）搬到 circle 的 stroke 属性上。
     · **无法 100% 等价的点**（已在各材质注释里标注，按本体观感取舍）：
         - star 点的描边（blackgold/kawaii 盘的星位有 stroke，预览外壳的星只吃 fill）→ 丢描边。
         - .board-scroller 的 box-shadow 投影（页面外框级，不属于盘本身材质）→ 不搬。
         - mono 子本体的"纯平涂"其实是两条同色 linearGradient（#000→#000 / #fff→#fff）→
           照抄成两条 solid gradient，保持"无光泽"的原意。
         - 渐变里带 CSS 动画的 stop（auroraBoard / whiteStone-aurora）→ 取初始静态色（动效后续补）。
     · 坐标/尺寸：preview 棋盘 viewBox 620、子半径 R≈15.84；本体 572、子 r 15.6。
       几何等价 → stone() 一律**用传入的 x/y/r**，特殊结构（勾叉/雪花/切面/卡哇伊）按 r 缩放。
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const N = 15;
  const PAD = 46;
  const GAP = (620 - PAD * 2) / (N - 1);

  /** 确定性伪随机。⚠ 不是密码学用途，只给 SVG 形状做确定性微扰；
   *  "可被预测"正是本意（同一颗子每次渲染必须一样）。安全扫描器报弱随机属误报。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  };

  /* ── defs 片段小工具（全部走前缀，避免串味）───────────────────────── */

  /** 径向渐变：stops=[[offset,color,op?],…] */
  const rg = (id, cx, cy, r, stops) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}"${r ? ` r="${r}"` : ""}>` +
    stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ""}/>`).join("") +
    `</radialGradient>`;

  /** 线性渐变 */
  const lg = (id, x1, y1, x2, y2, stops) =>
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ""}/>`).join("") +
    `</linearGradient>`;

  /** 本体标准落子投影：feDropShadow dx0 dy3 std2.5 op.38 */
  const shadowStd = (id) =>
    `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-opacity=".38"/></filter>`;

  /** 云子专用轻投影：dy1.1 std.85 op.28 */
  const shadowYun = (id) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="0" dy="1.1" stdDeviation=".85" flood-opacity=".28"/></filter>`;

  /** 单色投影（把 box-shadow / filter:drop-shadow 等价过来） */
  const shadowColor = (id, { dx = 0, dy = 0, std = 2, color = "#000", op = 1 }) =>
    `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${std}" flood-color="${color}" flood-opacity="${op}"/></filter>`;

  /* ── 材质登记表（id / 中文名 / 主色 / 页面底色）────────────────────── */
  /* 一套材质 = 一个皮肤对象。name 直接用材质自己的中文名，不加来源前缀
     （2026-10-02 用户要求「带有本体的都去掉本体这两个字」，盘和子一并改）。
     id 一律保持 app-* 不动 —— 存档、白名单校验、测试都认它。group 统一。 */
  const GROUP = "软件本体材质";
  const mk = (id) => ({
    id,
    P: (n) => `${id}-${n}`,
    push: (o) => SKINS.push(Object.assign({ id, group: GROUP }, o)),
  });

  /* ── 棋盘外框（本体 .board-bg 的 stroke 搬到 frame 上，预览外壳的 rect 只吃 fill）── */
  const boardFrame = (w, color, radius) =>
    `<rect x="${(w / 2).toFixed(1)}" y="${(w / 2).toFixed(1)}" width="${(620 - w).toFixed(1)}" height="${(620 - w).toFixed(1)}" ` +
    `rx="${radius}" fill="none" stroke="${color}" stroke-width="${w}"/>`;

  const STAR_R = 4.2; // 本体 .star r=4.2

  /* ══════════════════════════════════════════════════════════════════════
     一、纯棋盘材质（本体只有 .board-X，没有对应的 .stones-X）——只给棋盘半边
     ══════════════════════════════════════════════════════════════════════ */

  /* wood 原木棋盘 —— 本体默认盘：纯色 #d8ad69，描边 #b38343，网格 #594a36。
     本体**没有**木纹贴图，这里就纯色，不编造纹理。 */
  {
    const { P, push } = mk("app-wood");
    push({
      name: "原木棋盘",
      sub: "默认盘：暖黄木色 + 深棕网格",
      swatch: "#d8ad69", pageBg: "#141009", radius: 18,
      vars: { "--bd-bg": "#d8ad69", "--bd-line": "#594a36", "--bd-star": "#53432f", "--ui-accent": "#c8875a" },
      boardFill: "#d8ad69",
      frame: boardFrame(2, "#b38343", 18),
      lineStroke: "#594a36", lineW: 1.25, lineOpacity: 0.86,
      starFill: "#53432f", starR: STAR_R,
    });
  }

  /* emerald 翡翠棋盘 —— 深翠绿底 #1f604b + 金色网格 #e6c778 + 金描边。 */
  {
    const { P, push } = mk("app-emerald");
    push({
      name: "翡翠棋盘",
      sub: "深翠底 + 金色网格",
      swatch: "#1f604b", pageBg: "#0a1712", radius: 18,
      vars: { "--bd-bg": "#1f604b", "--bd-line": "#e6c778", "--bd-star": "#f3d68a", "--ui-accent": "#e6c778" },
      boardFill: "#1f604b",
      frame: boardFrame(2, "#b68a42", 18),
      lineStroke: "#e6c778", lineW: 1.25, lineOpacity: 0.78,
      starFill: "#f3d68a", starR: STAR_R,
    });
  }

  /* whitejade 白玉棋盘 —— 柔白玉色 #e7eee8，网格冷静灰绿 #567565。 */
  {
    const { P, push } = mk("app-whitejade");
    push({
      name: "白玉棋盘",
      sub: "柔白底 + 灰绿网格",
      swatch: "#e7eee8", pageBg: "#12160f", radius: 18,
      vars: { "--bd-bg": "#e7eee8", "--bd-line": "#567565", "--bd-star": "#6b8d76", "--ui-accent": "#8cae9a" },
      boardFill: "#e7eee8",
      frame: boardFrame(2, "#8cae9a", 18),
      lineStroke: "#567565", lineW: 1.25, lineOpacity: 0.76,
      starFill: "#6b8d76", starR: STAR_R,
    });
  }

  /* walnut 深胡桃木 —— 本体是纯色深棕 #68452f + 暖描边 #bd8754 + 暖金网格。
     本体**没有**木纹图案（styles.css 只给了 fill 色），忠实照搬纯色。 */
  {
    const { P, push } = mk("app-walnut");
    push({
      name: "深胡桃木",
      sub: "深棕木色 + 暖金网格",
      swatch: "#68452f", pageBg: "#120b06", radius: 18,
      vars: { "--bd-bg": "#68452f", "--bd-line": "#e5bd7a", "--bd-star": "#edcf8b", "--ui-accent": "#bd8754" },
      boardFill: "#68452f",
      frame: boardFrame(2, "#bd8754", 18),
      lineStroke: "#e5bd7a", lineW: 1.25, lineOpacity: 0.82,
      starFill: "#edcf8b", starR: STAR_R,
    });
  }

  /* frosted 磨砂玻璃 —— 本体：半透雾面 #edf5f3@.9 压在 135° 线性渐变底
     linear-gradient(135deg,#dceef0aa,#f9ffffcc) 之上。SVG 等价：把渐变做进 boardFill
     的 <linearGradient>（对角 x1y1→x2y2），再把雾面白按 .9 叠在 overlay 上，复现"半透"。 */
  {
    const { P, push } = mk("app-frosted");
    push({
      name: "磨砂玻璃",
      sub: "半透雾面，透出页面背景",
      swatch: "#cfe3e6", pageBg: "#0d1417", radius: 18,
      vars: { "--bd-bg": "#e2f0f1", "--bd-line": "#51777c", "--bd-star": "#628f91", "--ui-accent": "#8fb3b6" },
      defs: lg(P("bg"), "0", "0", "1", "1", [["0", "#dceef0"], ["1", "#f9ffff"]]),
      boardFill: `url(#${P("bg")})`,
      boardOverlay: `<rect x="0" y="0" width="620" height="620" rx="18" fill="#edf5f3" opacity=".5"/>`,
      frame: boardFrame(2, "#8fb3b6", 18),
      lineStroke: "#51777c", lineW: 1.25, lineOpacity: 0.7,
      starFill: "#628f91", starR: STAR_R,
    });
  }

  /* circuit 电路棋盘 —— 本体是纯色暗蓝 #101b2a + 青描边 #4ed3c2 + 青绿网格 + 金色星。
     "蓝绿发光线路"来自 .board-scroller 的外发光 box-shadow（页面级，不属于盘材质）→ 不搬。 */
  {
    const { P, push } = mk("app-circuit");
    push({
      name: "电路棋盘",
      sub: "暗蓝底 + 青色描边网格",
      swatch: "#101b2a", pageBg: "#05080d", radius: 18,
      vars: { "--bd-bg": "#101b2a", "--bd-line": "#47bfae", "--bd-star": "#f2c65e", "--ui-accent": "#4ed3c2" },
      boardFill: "#101b2a",
      frame: boardFrame(2, "#4ed3c2", 18),
      lineStroke: "#47bfae", lineW: 1.25, lineOpacity: 0.76,
      starFill: "#f2c65e", starR: STAR_R,
    });
  }

  /* minimal 极简棋盘 —— 纯色 #f4f4f1 + 浅描边 + 灰黑细网格(1.1)。 */
  {
    const { P, push } = mk("app-minimal");
    push({
      name: "极简棋盘",
      sub: "浅灰底 + 细灰网格",
      swatch: "#f4f4f1", pageBg: "#111110", radius: 18,
      vars: { "--bd-bg": "#f4f4f1", "--bd-line": "#30312f", "--bd-star": "#30312f", "--ui-accent": "#8a8a86" },
      boardFill: "#f4f4f1",
      frame: boardFrame(2, "#c8c8c3", 18),
      lineStroke: "#30312f", lineW: 1.1, lineOpacity: 0.78,
      starFill: "#30312f", starR: STAR_R,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     二、纯棋子材质（本体只有 .stones-X，没有对应的 .board-X）——只给棋子半边
     ══════════════════════════════════════════════════════════════════════ */

  /* classic 经典棋子 —— 本体默认子：径向渐变 blackStone/whiteStone + .stone 描边(#0003/.6) + stoneShadow。 */
  {
    const { P, push } = mk("app-classic");
    push({
      name: "经典棋子", swatch: "#3a3a3a", pageBg: "#141009",
      sub: "默认子：黑白云面 + 轻投影",
      vars: { "--st-black": "#242420", "--st-white": "#e8e2d5", "--ui-accent": "#c8875a" },
      defs:
        rg(P("kb"), "30%", "24%", null, [["0", "#5b5a55"], [".42", "#242420"], ["1", "#090a09"]]) +
        rg(P("kw"), "30%", "24%", null, [["0", "#fffef8"], [".6", "#e8e2d5"], ["1", "#aaa397"]]) +
        shadowStd(P("sh")),
      stone: ({ x, y, r, player }) =>
        `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="url(#${player === 1 ? P("kb") : P("kw")})" stroke="#000" stroke-opacity=".2" stroke-width=".6"/></g>`,
    });
  }

  /* VCF 挑战同款 · 琥珀木盘 —— 挑战页原来写死的那块盘（#e8c987 底 + #7a5a28 细格线），
     用户 2026-10-05：「这个棋盘棋子还是不错的，是群里经常用的那种，加进棋盘棋子里面」。
     来源就是 src/features/vcf-challenge/VcfChallengePage.tsx 里 BoardSvg 的硬编码值。 */
  {
    const { P, push } = mk("app-amberboard");
    push({
      name: "琥珀木盘", swatch: "#e8c987", pageBg: "#e8c987", radius: 12,
      sub: "暖琥珀盘 + 细棕格线（VCF 挑战同款）",
      vars: { "--bd-bg": "#e8c987", "--bd-line": "#7a5a28", "--bd-star": "#7a5a28", "--ui-accent": "#c8875a" },
      boardFill: "#e8c987",
      lineStroke: "#7a5a28", lineW: 1, lineOpacity: 1,
      starFill: "#7a5a28", starR: 3.2, starOpacity: 1,
    });
  }

  /* VCF 挑战同款 · 经典黑白子 —— 纯平涂黑白（无径向渐变、无投影），子上的手数最清楚。
     同样取自 BoardSvg：黑 #16161a/描边#000、白 #fdfdf8/描边#8a8a84，描边粗细照本体 .stone(.6)。 */
  {
    const { P, push } = mk("app-flatstone");
    push({
      name: "经典黑白", swatch: "#16161a", pageBg: "#141009",
      sub: "纯平涂黑白、不留高光（VCF 挑战同款）",
      vars: { "--st-black": "#16161a", "--st-white": "#fdfdf8", "--ui-accent": "#c8875a" },
      stone: ({ x, y, r, player }) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="${player === 1 ? "#16161a" : "#fdfdf8"}" stroke="${player === 1 ? "#000000" : "#8a8a84"}" stroke-width=".6"/>`,
    });
  }

  /* yun 云子棋子 —— 温润黑白云子，边缘回光（末停比中段亮），轻投影 yunStoneShadow。 */
  {
    const { P, push } = mk("app-yun");
    push({
      name: "云子棋子", swatch: "#3a4038", pageBg: "#12140f",
      sub: "温润黑白，边缘回光",
      vars: { "--st-black": "#272e29", "--st-white": "#efedde", "--ui-accent": "#8a9a86" },
      defs:
        rg(P("kb"), "43%", "38%", "65%", [["0", "#343a35"], [".46", "#272e29"], [".76", "#18221c"], [".9", "#111a14"], ["1", "#3c5140"]]) +
        rg(P("kw"), "43%", "38%", "65%", [["0", "#f6f4e7"], [".46", "#efedde"], [".76", "#e5e2cd"], [".9", "#d5d2bb"], ["1", "#aaa992"]]) +
        shadowYun(P("sh")),
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        const stroke = isB ? { c: "#46574a", w: 0.65 } : { c: "#a5a58f", w: 0.8 };
        return `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
          `fill="url(#${isB ? P("kb") : P("kw")})" stroke="${stroke.c}" stroke-width="${stroke.w}"/></g>`;
      },
    });
  }

  /* ink 墨蓝棋子 —— 练习本墨水质感，蓝黑/蓝白径向渐变 + 蓝描边。 */
  {
    const { P, push } = mk("app-ink");
    push({
      name: "墨蓝棋子", swatch: "#2b4870", pageBg: "#0d1219",
      sub: "蓝黑墨水色 + 蓝描边",
      vars: { "--st-black": "#173662", "--st-white": "#c5d5ee", "--ui-accent": "#4a6fa5" },
      defs:
        rg(P("kb"), "35%", "28%", "76%", [["0", "#6886b1"], [".24", "#355a8b"], [".56", "#173662"], [".84", "#0b203f"], ["1", "#06152b"]]) +
        rg(P("kw"), "35%", "28%", "76%", [["0", "#f9fcff"], [".3", "#e7effc"], [".6", "#c5d5ee"], [".84", "#9bb1d1"], ["1", "#637eab"]]) +
        shadowStd(P("sh")),
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        const stroke = isB ? { c: "#2b4870", w: 0.8 } : { c: "#6e89b0", w: 0.9 };
        return `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
          `fill="url(#${isB ? P("kb") : P("kw")})" stroke="${stroke.c}" stroke-width="${stroke.w}"/></g>`;
      },
    });
  }

  /* mono 黑白极简 —— 本体是两条"同色" linearGradient（#000→#000 / #fff→#fff）= 纯平涂、无光泽；
     且 filter:none（无落子投影），只靠一圈灰描边把子从盘里切出来。忠实：solid 渐变 + 无投影。 */
  {
    const { P, push } = mk("app-mono");
    push({
      name: "黑白极简", swatch: "#868a90", pageBg: "#101011",
      sub: "纯平涂，无高光无反射",
      vars: { "--st-black": "#000000", "--st-white": "#ffffff", "--ui-accent": "#868a90" },
      defs:
        lg(P("kb"), "0", "0", "0", "1", [["0", "#000"], ["1", "#000"]]) +
        lg(P("kw"), "0", "0", "0", "1", [["0", "#fff"], ["1", "#fff"]]),
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        const stroke = isB ? { c: "#868a90", w: 1.35 } : { c: "#434851", w: 1.65 };
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
          `fill="url(#${isB ? P("kb") : P("kw")})" stroke="${stroke.c}" stroke-width="${stroke.w}"/>`;
      },
    });
  }

  /* snow 雪晶棋子 —— 深冰晶/浅霜晶，八边形结冰切面 + 内部雪花 + 受光切块。
     本体 .snow-crystal-stone 有双色 drop-shadow（青辉光 + 深蓝落影）→ 用链式 feDropShadow 等价。 */
  {
    const { P, push } = mk("app-snow");
    push({
      name: "雪晶棋子", swatch: "#73d7ef", pageBg: "#0a1622",
      sub: "八边切面 + 内芯雪花",
      vars: { "--st-black": "#2479aa", "--st-white": "#e9fbff", "--ui-accent": "#8bdfff" },
      defs:
        rg(P("kb"), "25%", "18%", null, [["0", "#d9fbff"], [".2", "#73d7ef"], [".52", "#2479aa"], [".8", "#0d416c"], ["1", "#051c38"]]) +
        rg(P("kw"), "25%", "18%", null, [["0", "#fff"], [".25", "#e9fbff"], [".56", "#bfe7fa"], [".82", "#83b7da"], ["1", "#537da8"]]) +
        shadowStd(P("sh")) +
        `<filter id="${P("glow")}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="#8de7ff" flood-opacity="1"/>` +
        `<feDropShadow dx="0" dy="2" stdDeviation="1.2" flood-color="#174e74" flood-opacity=".67"/></filter>`,
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        const k = r / 15.8;
        const f = (n) => n.toFixed(2);
        const X = (o) => x + o * k, Y = (o) => y + o * k;
        const baseStroke = isB ? "#6ad4ff" : "#d9f8ff";
        const rimStroke = isB ? "#a9efff" : "#d9f9ff";
        const facet = { fill: isB ? "#e8fbff" : "#477fb3", fo: isB ? 0.14 : 0.12, stroke: isB ? "#f3fdff" : "#3978ad", so: isB ? 0.42 : 0.3 };
        const flake = { stroke: isB ? "#eafdff" : "#3977a8", op: isB ? 0.78 : 0.72 };
        const glint = { fill: isB ? "#fff" : "#f8ffff", op: isB ? 0.82 : 0.92 };
        return `<g filter="url(#${P("sh")})"><g filter="url(#${P("glow")})">` +
          `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${isB ? P("kb") : P("kw")})" stroke="${baseStroke}" stroke-width="1"/>` +
          `<path d="M ${f(X(0))} ${f(Y(-15))} L ${f(X(10.8))} ${f(Y(-10.8))} L ${f(X(15))} ${f(Y(0))} L ${f(X(10.2))} ${f(Y(11.2))} L ${f(X(0))} ${f(Y(15.4))} L ${f(X(-10.8))} ${f(Y(10.8))} L ${f(X(-15.2))} ${f(Y(0))} L ${f(X(-10.4))} ${f(Y(-11.1))} Z" fill="none" stroke="${rimStroke}" stroke-width="1.25" stroke-linejoin="round" opacity=".92"/>` +
          `<path d="M ${f(X(0))} ${f(Y(-14))} L ${f(X(-4.2))} ${f(Y(-2))} L ${f(X(-13))} ${f(Y(0))} L ${f(X(-3.5))} ${f(Y(3.2))} L ${f(X(0))} ${f(Y(14))} L ${f(X(3.8))} ${f(Y(3))} L ${f(X(13.4))} ${f(Y(0))} L ${f(X(3.6))} ${f(Y(-2.8))} Z" fill="${facet.fill}" fill-opacity="${facet.fo}" stroke="${facet.stroke}" stroke-opacity="${facet.so}" stroke-width=".55"/>` +
          `<path d="M ${f(X(0))} ${f(Y(-10))} V ${f(Y(10))} M ${f(X(-8.7))} ${f(Y(-5))} L ${f(X(8.7))} ${f(Y(5))} M ${f(X(8.7))} ${f(Y(-5))} L ${f(X(-8.7))} ${f(Y(5))}" fill="none" stroke="${flake.stroke}" stroke-width="1.05" stroke-linecap="round" opacity="${flake.op}"/>` +
          `<path d="M ${f(X(-9))} ${f(Y(-10))} L ${f(X(-4))} ${f(Y(-13.2))} L ${f(X(-1))} ${f(Y(-9.5))} L ${f(X(-5.5))} ${f(Y(-6.5))} Z" fill="${glint.fill}" opacity="${glint.op}"/>` +
          `</g></g>`;
      },
    });
  }

  /* terminal 终端字符棋子 —— 本体就是一枚描边发光的圆片（深色终端盘配荧光描边）：
     黑 #10151d/青描边 #5bd4c4，白 #e6f5f0/描边 #3a9f9a，加 stoneShadow。忠实：圆片 + 荧光描边。 */
  {
    const { P, push } = mk("app-terminal");
    push({
      name: "终端字符棋子", swatch: "#5bd4c4", pageBg: "#0b0f16",
      sub: "荧光描边圆片（终端配色）",
      vars: { "--st-black": "#10151d", "--st-white": "#e6f5f0", "--ui-accent": "#5bd4c4" },
      defs: shadowStd(P("sh")),
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        return `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
          `fill="${isB ? "#10151d" : "#e6f5f0"}" stroke="${isB ? "#5bd4c4" : "#3a9f9a"}" stroke-width="1.5"/></g>`;
      },
    });
  }

  /* gold 鎏金棋子 —— 黑棋鎏金纹理与暖金高光；本体是 jewel 结构：渐变圆 + 12 切面多边形 + 内环 + 两道锐利受光。 */
  /* diamond 钻石棋子 —— 黑白钻石切面与折射高光；同款 jewel，切面走冷色。 */
  /* gold-diamond 黑钻白金棋子 —— 黑=钻石材质、白=鎏金材质（本体按 player 分别取 material）。 */
  {
    const jewelDefs = (P) =>
      rg(P("goldB"), "28%", "22%", null, [["0", "#fff0a8"], [".42", "#d59a22"], ["1", "#6c3d08"]]) +
      rg(P("goldW"), "28%", "22%", null, [["0", "#fff9d7"], [".5", "#f1c95d"], ["1", "#a96813"]]) +
      rg(P("diaB"), "32%", "24%", "82%", [["0", "#c8dce8"], [".22", "#657b8b"], [".48", "#26313e"], [".76", "#0d1520"], ["1", "#02060b"]]) +
      rg(P("diaW"), "32%", "24%", "82%", [["0", "#ffffff"], [".3", "#f8fcff"], [".56", "#e2eaf1"], [".8", "#adbfce"], ["1", "#728c9e"]]) +
      shadowStd(P("sh"));

    /** jewel 棋子工厂：@param matB/matW 黑/白各用哪种材质('gold'|'diamond')；@param strokeB/W 描边。 */
    const jewel = (P, matB, matW, strokeB, strokeW) => ({ x, y, r, player }) => {
      const isB = player === 1;
      const mat = isB ? matB : matW;
      const g = mat === "gold" ? (isB ? P("goldB") : P("goldW")) : (isB ? P("diaB") : P("diaW"));
      const s = isB ? strokeB : strokeW;
      const dark = mat === "gold" ? "#71450c" : "#233344";
      const light = mat === "gold" ? "#fff0ad" : "#d9edfa";
      const ring = mat === "gold" ? "#fff2be" : "#fff";
      const k = r / 15.6;
      const f = (n) => n.toFixed(1);
      const pt = (ang, rad) => `${f(x + Math.cos(ang) * rad * k)} ${f(y + Math.sin(ang) * rad * k)}`;
      const OP = [0.48, 0.27, 0.16, 0.1, 0.3, 0.45, 0.22, 0.12, 0.4, 0.2, 0.12, 0.5];
      let facets = "";
      for (let i = 0; i < 12; i += 1) {
        const a = (i * Math.PI) / 6, b = ((i + 1) * Math.PI) / 6;
        const fill = i % 3 === 0 ? "#fff" : i % 3 === 1 ? dark : light;
        facets += `<polygon points="${pt(a, 14.6)} ${pt(b, 14.6)} ${pt(b, 7.5)} ${pt(a, 7.5)}" fill="${fill}" opacity="${OP[i]}"/>`;
      }
      const strokeAttrs = `stroke="${s.c}" stroke-width="1"${s.o != null ? ` stroke-opacity="${s.o}"` : ""}`;
      return `<g filter="url(#${P("sh")})">` +
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${g})" ${strokeAttrs}/>` +
        facets +
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(7.5 * k)}" fill="none" stroke="${ring}" stroke-width=".55" opacity=".3"/>` +
        `<path d="M ${f(x - 11 * k)} ${f(y - 8 * k)} L ${f(x - 5 * k)} ${f(y - 12 * k)} M ${f(x + 9 * k)} ${f(y + 7 * k)} L ${f(x + 6 * k)} ${f(y + 11 * k)}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".85"/>` +
        `</g>`;
    };

    const S_GOLD_B = { c: "#b9f0ff", o: 0.72 }, S_GOLD_W = { c: "#9b6817", o: 0.7 };
    const S_DIA_B = { c: "#a2b5c8", o: 0.72 }, S_DIA_W = { c: "#688595", o: 0.9 };


    (() => { const { P, push } = mk("app-diamond"); push({
      name: "钻石棋子", swatch: "#8fb8cc", pageBg: "#0c1219",
      sub: "冷色切面 + 折射高光",
      vars: { "--st-black": "#26313e", "--st-white": "#e2eaf1", "--ui-accent": "#6faec4" },
      defs: jewelDefs(P),
      stone: jewel(P, "diamond", "diamond", S_DIA_B, S_DIA_W),
    }); })();

    /* gold-diamond（黑钻白金）*/
    (() => { const { P, push } = mk("app-golddiamond"); push({
      name: "黑钻白金棋子", swatch: "#c8a24a", pageBg: "#0c1016",
      sub: "黑用钻石、白用鎏金",
      vars: { "--st-black": "#26313e", "--st-white": "#f1c95d", "--ui-accent": "#d8b45f" },
      defs: jewelDefs(P),
      stone: jewel(P, "diamond", "gold", S_DIA_B, S_GOLD_W),
    }); })();
  }

  /* ══════════════════════════════════════════════════════════════════════
     三、盘 + 子都有对应物的材质 —— 一个对象里同时给 boardXxx 与 stone()
     ══════════════════════════════════════════════════════════════════════ */

  /* jade 玉石/玉石 —— 盘：青玉底 #6e9d89 + 淡绿网格；子：青玉/白玉径向渐变。 */
  (() => {
    const { P, push } = mk("app-jade");
    push({
      name: "玉石", swatch: "#6e9d89", pageBg: "#0c1512", radius: 18,
      sub: "青玉盘 + 青白玉子",
      vars: { "--bd-bg": "#6e9d89", "--bd-line": "#d5e7d8", "--bd-star": "#e9d39a", "--st-black": "#1f5943", "--st-white": "#b8dfcd", "--ui-accent": "#8cae9a" },
      defs:
        rg(P("kb"), "30%", "24%", null, [["0", "#6ba98a"], [".45", "#1f5943"], ["1", "#0e2b22"]]) +
        rg(P("kw"), "30%", "24%", null, [["0", "#f8fffb"], [".55", "#b8dfcd"], ["1", "#6fa88d"]]) +
        shadowStd(P("sh")),
      boardFill: "#6e9d89",
      frame: boardFrame(2, "#416b59", 18),
      lineStroke: "#d5e7d8", lineW: 1.25, lineOpacity: 0.82,
      starFill: "#e9d39a", starR: STAR_R,
      stone: ({ x, y, r, player }) =>
        `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="url(#${player === 1 ? P("kb") : P("kw")})" stroke="#000" stroke-opacity=".2" stroke-width=".6"/></g>`,
    });
  })();

  /* notebook 练习本 —— 2026-10-01 用户把**盘**删了，只留子。
     子先按本体的 ✓/✗ 批改符号原样搬（中途改成过"拿笔画的圈"，用户看完要求恢复原状）。 */
  (() => {
    const { P, push } = mk("app-notebook");
    push({
      name: "练习本子", swatch: "#b92f39", pageBg: "#17140d",
      sub: "墨水色子，像写在练习本上",
      vars: { "--st-black": "#202832", "--st-white": "#b92f39", "--ui-accent": "#c96e70" },
      defs:
        /* 本体用 feTurbulence + feDisplacementMap 给勾叉做"毛笔边缘"，照抄。
           ⚠ 这是**静态位移**（源图形不变、滤镜结果可缓存），不是动画扫过滤镜区，
              所以不触发 README 坑 27 那类每帧重跑。 */
        `<filter id="${P("brush")}" x="-25%" y="-25%" width="150%" height="150%">` +
        `<feTurbulence type="fractalNoise" baseFrequency=".035 .12" numOctaves="2" seed="7" result="inkNoise"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="1.15" xChannelSelector="R" yChannelSelector="G"/></filter>` +
        shadowStd(P("sh")),
      stone: ({ x, y, r, player }) => {
        const col = Math.round((x - PAD) / GAP), row = Math.round((y - PAD) / GAP);
        const rot = ((row * 7 + col * 11) % 9) - 4; // 与本体同一确定性公式
        const k = (r / 15.6).toFixed(3);
        const color = player === 1 ? "#202832" : "#b92f39";
        const body = player === 1
          ? `<path d="M-14-10C-12-13-10-14-8-12C-1-5 6 3 14 10C16 12 14 15 11 14C3 8-5 1-13-7C-15-8-15-9-14-10Z"/>` +
            `<path d="M11-14C14-15 16-12 14-9C8-2 1 5-8 13C-10 15-14 13-13 10C-5 2 3-6 11-14Z"/>` +
            `<path d="M-11-9C-5-3 3 5 11 10M10-11C4-4-3 4-10 11" fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" opacity=".3"/>`
          : `<path d="M-15-2C-16-4-13-6-11-4L-2 5C3-3 8-12 13-17C15-19 18-17 16-13C11-4 6 7 1 14C0 16-3 16-5 13L-15 2C-16 1-16 0-15-2Z"/>` +
            `<path d="M-12-1C-8 3-4 8-1 11C4 2 9-8 14-15" fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" opacity=".3"/>`;
        return `<g filter="url(#${P("sh")})"><g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot}) scale(${k})" ` +
          `fill="${color}" filter="url(#${P("brush")})">${body}</g></g>`;
      },
    });
  })();

  /* porcelain 青花瓷 —— 2026-10-01 用户把**盘**删了，只留子（青白瓷釉 + 蓝描边）。 */
  (() => {
    const { P, push } = mk("app-porcelain");
    push({
      name: "青花瓷子", swatch: "#f7f3e9", pageBg: "#0d1418",
      sub: "青白瓷釉 + 蓝描边",
      vars: { "--st-black": "#123f73", "--st-white": "#f3f2ea", "--ui-accent": "#2e648f" },
      defs:
        rg(P("kb"), "28%", "22%", null, [["0", "#315f91"], [".48", "#123f73"], ["1", "#071b36"]]) +
        rg(P("kw"), "28%", "22%", null, [["0", "#fffdf8"], [".58", "#f3f2ea"], ["1", "#9fbaca"]]) +
        shadowStd(P("sh")),
      stone: ({ x, y, r, player }) =>
        `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="url(#${player === 1 ? P("kb") : P("kw")})" stroke="#7594a2" stroke-width=".7"/></g>`,
    });
  })();

  /* blackgold 尊贵黑金 —— 盘：黑曜石对角渐变 blackGoldBoard + 香槟金描边(2.4)/网格/星；
     子：黑玛瑙/鎏金珠光渐变；本体 piece 无投影、靠每色小 drop-shadow。 */
  (() => {
    const { P, push } = mk("app-blackgold");
    push({
      name: "尊贵黑金", swatch: "#14110c", pageBg: "#080705", radius: 18,
      sub: "黑曜渐变 + 香槟金网格",
      vars: { "--bd-bg": "#100e0b", "--bd-line": "#c7a653", "--bd-star": "#f0d27c", "--st-black": "#25231f", "--st-white": "#d8b45f", "--ui-accent": "#d1ae57" },
      defs:
        lg(P("bg"), "0", "0", "1", "1", [["0", "#1d1a16"], [".48", "#080807"], ["1", "#21190f"]]) +
        rg(P("kb"), "27%", "20%", null, [["0", "#6f6a5d"], [".25", "#25231f"], [".67", "#090909"], ["1", "#010101"]]) +
        rg(P("kw"), "30%", "24%", null, [["0", "#fff9d9"], [".24", "#f4df9a"], [".58", "#d8b45f"], [".84", "#bd8e35"], ["1", "#96651d"]]) +
        shadowColor(P("shB"), { dy: 2, std: 1.7, color: "#000", op: 0.667 }) +
        shadowColor(P("shW"), { dy: 1, std: 0.65, color: "#372204", op: 0.658 }) +
        /* 本体真源：html[data-theme=blackgold] .app-shell::before —— 两层背景
           ① radial-gradient(circle,#f2cf72 0 1px,transparent 1.7px) / 83px 91px  = 金点阵
           ② linear-gradient(112deg,…#f4d98032…) / 220% 100%                      = 斜向 lustre
           配 @keyframes blackgold-lustre：位置 0 0 → 24px -18px、整层 .22→.42→.26。
           ⚠ 本体把它挂在**页面外壳**上，盘本身（.board-blackgold .board-bg）是静止的。
              这里挪到盘面上，是一处有意的改写：用户点名"黑金一定要搞"，
              而这副材质自己的动效就是这道金漆光泽；不加第二层别的光。 */
        `<clipPath id="${P("clip")}"><rect x="0" y="0" width="620" height="620" rx="18"/></clipPath>` +
        rg(P("dot"), "50%", "50%", "50%", [["0.5", "#f2cf72"], ["1", "#f2cf72", 0]]) +
        `<pattern id="${P("dots")}" width="83" height="91" patternUnits="userSpaceOnUse">` +
        `<circle cx="1" cy="1" r="1.7" fill="url(#${P("dot")})"/></pattern>` +
        `<linearGradient id="${P("sheen")}" x1="0" y1=".16" x2="1" y2=".84">` +
        `<stop offset=".32" stop-color="#f4d980" stop-opacity="0"/>` +
        `<stop offset=".49" stop-color="#f4d980" stop-opacity=".196"/>` +
        `<stop offset=".66" stop-color="#f4d980" stop-opacity="0"/></linearGradient>`,
      boardFill: `url(#${P("bg")})`,
      /* 整组 opacity 属性上是 0：关动效 = 这层根本不存在，画面回到搬运过来的原样。
         开动效时由 CSS 的 breath 关键帧点亮（和本体 .34 + keyframes 覆盖同一套做法）。 */
      boardOverlay: `<g class="${P("lustre")}" clip-path="url(#${P("clip")})" opacity="0">` +
        `<rect class="${P("dots")}" x="-90" y="-90" width="800" height="800" fill="url(#${P("dots")})"/>` +
        `<rect class="${P("sheen")}" x="-620" y="0" width="1240" height="620" fill="url(#${P("sheen")})"/>` +
        `</g>`,
      frame: boardFrame(2.4, "#d1ae57", 18),
      lineStroke: "#c7a653", lineW: 1.25, lineOpacity: 0.78,
      starFill: "#f0d27c", starR: STAR_R,
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
          `fill="url(#${isB ? P("kb") : P("kw")})" stroke="${isB ? "#d5b35e" : "#efd481"}" stroke-width="${isB ? 0.9 : 0.75}" ` +
          `filter="url(#${isB ? P("shB") : P("shW")})"/>`;
      },
      /* 自带动效：搬本体 blackgold-lustre（8s ease-in-out）—— 金点阵漂 24/-18、
         斜向 lustre 从右扫到左、整层在 .22↔.42 之间呼吸。
         两处**有意**偏离本体，都是为了不出现"啪"地跳回：
           · 本体的 background-position 与 opacity 都是 0%→100% 硬循环（终点≠起点），
             挂在页面外壳上几乎看不出来，放到盘面上就是一次闪跳 → 点阵与呼吸改 alternate；
           · 扫光保持单向，但行程两端都在盘外（被 clipPath 剪掉），所以循环处天然无缝。
         只动 transform / opacity，没有新增任何发光层。 */
      boardMotions: [{
        id: "bmo-app-blackgold-lustre",
        name: "金漆流光",
        desc: "金点阵缓缓移位、一道斜向漆光从右扫到左，整层明度跟着呼吸",
        css: (id) => `
          @keyframes ${id}-breath{ 0%,12%{ opacity:.22 } 48%{ opacity:.42 } 82%,100%{ opacity:.26 } }
          @keyframes ${id}-dots{ from{ transform:translate(0,0) } to{ transform:translate(24px,-18px) } }
          @keyframes ${id}-sheen{ from{ transform:translateX(744px) } to{ transform:translateX(-744px) } }
          #board .${P("lustre")}{ animation: ${id}-breath 8s ease-in-out infinite alternate }
          #board .${P("dots")}{ animation: ${id}-dots 8s ease-in-out infinite alternate }
          #board .${P("sheen")}{ animation: ${id}-sheen 8s ease-in-out infinite }
          /* 减少动态效果：整层退回"不存在"，而不是冻住一道斜光在盘中间。 */
          @media (prefers-reduced-motion:reduce){
            #board .${P("lustre")},#board .${P("dots")},#board .${P("sheen")}{ animation:none }
            #board .${P("lustre")}{ opacity:0 }
          }
        `,
      }],
    });
  })();

  /* pale 苍白世界 —— 盘：月白矿石对角渐变 paleBoard + paleStrata 矿脉图案叠层 + 石墨灰线；
     子：石墨黑/银白珍珠六段渐变 + 灰描边。 */
  (() => {
    const { P, push } = mk("app-pale");
    push({
      name: "苍白世界", swatch: "#e9ecf1", pageBg: "#14161a", radius: 18,
      sub: "月白矿石 + 矿脉叠层",
      vars: { "--bd-bg": "#eef0f3", "--bd-line": "#46484c", "--bd-star": "#5f6266", "--st-black": "#41434b", "--st-white": "#eceae4", "--ui-accent": "#8f9296" },
      defs:
        lg(P("bg"), "0", "0", "1", "1", [["0", "#fff"], [".2", "#e9ecf1"], [".38", "#fafafa"], [".57", "#e5e3e6"], [".73", "#f4f3ef"], [".9", "#d6dce2"], ["1", "#f8f9fa"]]) +
        `<pattern id="${P("strata")}" width="620" height="142" patternUnits="userSpaceOnUse">` +
        `<path d="M0 30 Q152 8 310 38 T620 26 M0 34 Q152 12 310 42 T620 30" fill="none" stroke="#fff" stroke-width="2" opacity=".45"/>` +
        `<path d="M0 98 Q195 58 358 102 T620 94" fill="none" stroke="#7d8794" stroke-width=".65" opacity=".13"/></pattern>` +
        rg(P("kb"), "32%", "26%", "78%", [["0", "#bfc3c8"], [".2", "#777c86"], [".48", "#41434b"], [".7", "#555650"], [".86", "#292d34"], ["1", "#91969d"]]) +
        rg(P("kw"), "32%", "26%", "78%", [["0", "#fff"], [".28", "#f8f9fc"], [".52", "#e2e3e8"], [".7", "#eceae4"], [".86", "#adb4bd"], ["1", "#f5f6f8"]]) +
        shadowStd(P("sh")) +
        `<clipPath id="${P("clip")}"><rect x="0" y="0" width="620" height="620" rx="18"/></clipPath>`,
      boardFill: `url(#${P("bg")})`,
      /* 矿脉层放大到 -40~660 并用 clipPath 剪回盘面：静止时和原来一模一样，
         但漂移时不会在边上露出空白（pattern 跟着元素走，rect 一动纹样就一动）。 */
      boardOverlay: `<g clip-path="url(#${P("clip")})">` +
        `<rect class="${P("strata-l")}" x="-40" y="-40" width="700" height="700" fill="url(#${P("strata")})" pointer-events="none"/>` +
        `</g>`,
      frame: boardFrame(2, "#8f9296", 18),
      lineStroke: "#46484c", lineW: 1.25, lineOpacity: 0.72,
      starFill: "#5f6266", starR: STAR_R,
      stone: ({ x, y, r, player }) =>
        `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="url(#${player === 1 ? P("kb") : P("kw")})" stroke="#777a7e" stroke-width=".8"/></g>`,
      /* 自带动效：本体 pale-dust-drift 是 0% (-12,8) → 55% (8,-10) → 100% (20,5)，
         挂在页面外壳的灰尖层上，100% 回 0% 有一下 32px 的硬跳 —— 在细碎尘点上看不出来，
         但盘上这层是**连贯的矿脉线**，跳一下就是"山挪了一格"。所以把 100% 收到起点、
         闭环不跳，幅度与节奏照抄。动的是这层纹样本身，没有新增任何光。 */
      boardMotions: [{
        id: "bmo-app-pale-strata",
        name: "矿脉缓漂",
        desc: "盘上那层白色矿脉纹按本体的三点路径慢慢游走，回到起点不跳",
        css: (id) => `
          @keyframes ${id}-d{
            0%{ transform:translate(-12px,8px) }
            55%{ transform:translate(8px,-10px) }
            100%{ transform:translate(-12px,8px) }
          }
          #board .${P("strata-l")}{ animation: ${id}-d 26s ease-in-out infinite }
          @media (prefers-reduced-motion:reduce){
            #board .${P("strata-l")}{ animation:none; transform:none }
          }
        `,
      }],
    });
  })();

  /* kawaii 卡哇伊 —— 盘：奶油莓粉对角渐变 kawaiiBoard + 柔紫网格；
     子：草莓粉小猫(黑)/薄荷青搭档(白)——渐变圆 + 猫耳 + 眼 + 嘴 + 腮红 + 顶光。 */
  (() => {
    const { P, push } = mk("app-kawaii");
    push({
      name: "卡哇伊", swatch: "#f7dbe9", pageBg: "#180f16", radius: 18,
      sub: "奶油莓粉 + 柔紫网格",
      vars: { "--bd-bg": "#f7dbe9", "--bd-line": "#965a82", "--bd-star": "#b64e86", "--st-black": "#bc628e", "--st-white": "#e5faf1", "--ui-accent": "#bd7ca5" },
      defs:
        lg(P("bg"), "0", "0", "1", "1", [["0", "#fff8f2"], [".48", "#f7dbe9"], ["1", "#decdf0"]]) +
        rg(P("kb"), "35%", "28%", "75%", [["0", "#eeb0cf"], [".35", "#bc628e"], [".76", "#84345e"], ["1", "#652341"]]) +
        rg(P("kw"), "35%", "28%", "75%", [["0", "#fffefa"], [".4", "#e5faf1"], [".78", "#b5dfd2"], ["1", "#70aa9a"]]) +
        shadowStd(P("sh")),
      boardFill: `url(#${P("bg")})`,
      frame: boardFrame(2, "#bd7ca5", 18),
      lineStroke: "#965a82", lineW: 1.25, lineOpacity: 0.68,
      starFill: "#b64e86", starR: STAR_R,
      stone: ({ x, y, r, player }) => {
        const isB = player === 1;
        const k = r / 15.6, f = (n) => n.toFixed(1);
        const X = (o) => x + o * k, Y = (o) => y + o * k;
        const discStroke = isB ? "#6f2e50" : "#588b7d";
        const ear = isB ? { fill: "#d998b8", stroke: "#743454" } : { fill: "#f9dce5", stroke: "#78a995" };
        const eye = isB ? "#fff2f8" : "#164f54";
        const mouth = isB ? "#fff2f8" : "#195c60";
        const blush = isB ? "#ffccdb" : "#ffb4c9";
        return `<g filter="url(#${P("sh")})">` +
          `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${isB ? P("kb") : P("kw")})" stroke="${discStroke}" stroke-width="1"/>` +
          `<path d="M ${f(X(-11))} ${f(Y(-6))} Q ${f(X(-13))} ${f(Y(-16))} ${f(X(-8))} ${f(Y(-13))} L ${f(X(-4))} ${f(Y(-9))} M ${f(X(11))} ${f(Y(-6))} Q ${f(X(13))} ${f(Y(-16))} ${f(X(8))} ${f(Y(-13))} L ${f(X(4))} ${f(Y(-9))}" fill="${ear.fill}" stroke="${ear.stroke}" stroke-width="1" stroke-linejoin="round"/>` +
          `<ellipse cx="${f(X(-5.2))}" cy="${f(Y(-1.1))}" rx="${f(1.55 * k)}" ry="${f(2.15 * k)}" fill="${eye}"/>` +
          `<ellipse cx="${f(X(5.2))}" cy="${f(Y(-1.1))}" rx="${f(1.55 * k)}" ry="${f(2.15 * k)}" fill="${eye}"/>` +
          `<path d="M ${f(X(-3))} ${f(Y(3))} Q ${f(X(-1.5))} ${f(Y(6))} ${f(X(0))} ${f(Y(3.5))} Q ${f(X(1.5))} ${f(Y(6))} ${f(X(3))} ${f(Y(3))}" fill="none" stroke="${mouth}" stroke-width="1.15" stroke-linecap="round"/>` +
          `<ellipse cx="${f(X(-9))}" cy="${f(Y(4))}" rx="${f(2.6 * k)}" ry="${f(1.25 * k)}" fill="${blush}" opacity=".92"/>` +
          `<ellipse cx="${f(X(9))}" cy="${f(Y(4))}" rx="${f(2.6 * k)}" ry="${f(1.25 * k)}" fill="${blush}" opacity=".92"/>` +
          `<path d="M ${f(X(-6))} ${f(Y(-11))} Q ${f(X(0))} ${f(Y(-14))} ${f(X(5))} ${f(Y(-11))}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".65"/>` +
          `</g>`;
      },
    });
  })();

  /* aurora 极光 —— 盘：极夜玻璃对角渐变 auroraBoard + 流彩网格(本体带 stop 动画，取静态初值)；
     子：极夜深青 / 极光凝珠(whiteStone-aurora 带动画，取静态初值) + 青描边 + 青辉光。 */
  (() => {
    const { P, push } = mk("app-aurora");
    push({
      name: "极光", swatch: "#164e5b", pageBg: "#04080e", radius: 18,
      sub: "极夜玻璃 + 流彩网格",
      vars: { "--bd-bg": "#0d2632", "--bd-line": "#9ee7dc", "--bd-star": "#d9fff8", "--st-black": "#173f49", "--st-white": "#75ead3", "--ui-accent": "#73dcc8" },
      defs:
        /* 本体真源：App.tsx 的 <linearGradient id="auroraBoard">，
           后三个色标带 class，styles.css 里 .board-aurora .aurora-board-{cyan,green,violet}
           各挂一条 stop-color 的 alternate 动画（7s/9s/8s）。
           这是本体**自己就动在盘上**的唯一一处，所以照抄 class 名与时长，不另编。
           （lg() 不支持逐 stop 加 class，这一段只能手写。） */
        `<linearGradient id="${P("bg")}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#061928"/>` +
        `<stop class="${P("ac")}" offset=".36" stop-color="#164e5b"/>` +
        `<stop class="${P("ag")}" offset=".64" stop-color="#236458"/>` +
        `<stop class="${P("av")}" offset="1" stop-color="#322b62"/></linearGradient>` +
        rg(P("kb"), "27%", "20%", null, [["0", "#527d86"], [".28", "#173f49"], [".68", "#071e2b"], ["1", "#020914"]]) +
        /* 白子那三个色标在本体里带 class（App.tsx 的 auroraWhite），
           .stones-aurora .aurora-stone-{light,mid,edge} 各挂一条 stop-color 动画。 */
        `<radialGradient id="${P("kw")}" cx="27%" cy="24%">` +
        `<stop class="${P("sl")}" offset="0" stop-color="#f1ffff"/>` +
        `<stop class="${P("sm")}" offset=".44" stop-color="#75ead3"/>` +
        `<stop class="${P("se")}" offset=".76" stop-color="#6987e8"/>` +
        `<stop offset="1" stop-color="#443d91"/></radialGradient>` +
        shadowStd(P("sh")) +
        shadowColor(P("glow"), { std: 2, color: "#67dfca", op: 1 }),
      boardFill: `url(#${P("bg")})`,
      frame: boardFrame(2.2, "#73dcc8", 18),
      lineStroke: "#9ee7dc", lineW: 1.25, lineOpacity: 0.64,
      starFill: "#d9fff8", starR: STAR_R,
      stone: ({ x, y, r, player }) =>
        `<g filter="url(#${P("sh")})"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `fill="url(#${player === 1 ? P("kb") : P("kw")})" stroke="#8ff3df" stroke-width="1" filter="url(#${P("glow")})"/></g>`,
      /* 自带动效：极光在本体里就是**盘底渐变色标在缓慢互移**，
         时长/缓动/目标色全部照抄 styles.css 的 aurora-board-*（不是新加的辉光层）。
         ⚠ 动的是 <stop>，没有几何可量 —— .check-motion 的包络取样为此加了"色"这一通道。 */
      boardMotions: [{
        id: "bmo-app-aurora-shift",
        name: "极光换色",
        desc: "盘底那三个色标按本体的 7s/9s/8s 来回缓移（本体原样，非新增光层）",
        css: (id) => `
          @keyframes ${id}-c{ to{ stop-color:#2e7989 } }
          @keyframes ${id}-g{ to{ stop-color:#4367a6 } }
          @keyframes ${id}-v{ to{ stop-color:#553a79 } }
          #board .${P("ac")}{ animation: ${id}-c 7s ease-in-out infinite alternate }
          #board .${P("ag")}{ animation: ${id}-g 9s ease-in-out infinite alternate }
          #board .${P("av")}{ animation: ${id}-v 8s ease-in-out infinite alternate }
          @media (prefers-reduced-motion:reduce){
            #board .${P("ac")},#board .${P("ag")},#board .${P("av")}{ animation:none }
          }
        `,
      }],
      /* 本体还给白子挂了三条 stop-color 动画（.stones-aurora .aurora-stone-*，5s/7s/6s）。
         色标已经照抄进上面那个渐变（class 名也留着，就是本体的名字），**但动画没接**：
         每颗白子外面套着 glow 滤镜（shadowColor std:2），色标一变源图就变、
         滤镜就得重算 —— 900×900 满盘 60 颗实测 关 58.5 帧 / 开 44.4 帧（README 坑 27）。
         为一点 15px 上的色相漂移付 14 帧不值，所以只做盘面那三条。
         要接回来就在下面这个数组里补一条 stoneMotions，css 里给
         .${P("sl")}/.${P("sm")}/.${P("se")} 上 stop-color 动画即可。 */
      stoneMotions: [],
    });
  })();
})();
