/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

export const SKINS: Skin[] = [];
/* ════════════════════════════════════════════════════════════════════════
   棋魂 · 黑白水墨（对标燕云十六声的对弈画面）

   ## 参考口径（两轮实拍取色，别凭感觉改）

     背景   #0b0d10              ← 近黑（几乎是黑场）
     棋盘   #3c3d3f ~ #56575b    ← **中炭灰**，比背景亮出三四档
     网格   #5c5e5f              ← 比棋盘再亮一点的冷灰线

   结构是：**黑场中间浮着一块中灰的盘**。盘是"灰"的 —— 既不暖（木色）、
   也不白（刺眼）、更不是黑。暗的是环境，亮的是棋盘。

   ## 2026-10-12 这一轮改了三件事（用户原话 → 改法）

   ①「主题的那些雾气块感太重」
     → 雾层原来每层只画 **2 团大椭圆**（62%×26%）＋ `transparent 72%` 的硬收边，
       于是屏上就是"两坨亮斑在飘"。现在改成 **6 缕细长湿雾**分散在
       `.ts-mid / .ts-near / .ts-sway` 三层里，各自速度/相位不同，
       每缕都是多档 stop 渐隐（边缘化开，没有边界）。
       见 styles.css 的 soul-mist-* —— 这一半改在 CSS，不在本文件。

   ②「棋盘的也是感觉不够通透」
     → 上一版的"通透"被两样东西吃掉了：**四角暗角 .46**（把盘压成一坨死灰）
       和**只有一层的中央提亮**。现在：
         · 暗角 .46 → .26，且起步从 .56 开始（只在最外圈压一点）
         · 盘面改成**四档渐变**＋更冷的墨青，亮部提一档、暗部收窄
         · 加**顶部透光**（上缘一层自上而下的冷白渐变）——"光从上面来"才有体积
         · 加**一层会飘的湿雾**（boardMotions 的「墨雾流动」，78s 横移 ±10px）
         · 保留两团极淡的湿墨晕（.11 有效不透明度），给石头一点"呼吸"
     → 网格顺手亮半档（#9aa2a8 → #a4acb3），但线更细（1 → 1.05），
       在更亮的盘上仍然读得清，不会变成"刻线"。

   ③「手序不在棋魂的中心」
     → 这是几何问题，不是配色问题。焰形子的**视觉中心**是焰身那颗圆
       （圆心 path y=16.1、半径 7.4），而 `stone()` 原来按**包心**
       （bbox 中心 path y=13.05）摆位 ⇒ 焰身比子心低 3.05 个 path 单位。
       手数文字由 App 画在 `y + stoneRadius*.28`（正圆那套光学居中），
       换算下来数字中心落在 **子心下方 0.056r**，而焰身中心在 **0.286r**
       ⇒ 号浮在焰腰上面 0.23r，就是"不在中心"。
     → 修法（两步，都不动焰的外形，d 那一版是用户认可的）：
         a. **内火重新定位**：缩放中心从 (16.3,19.6)/.58×.66 改成
            **焰身中心对齐**（CORE 让内火的焰身圆心也落在 path y=16.1），
            比例收到 .44×.50 —— 隔离距离更大（用户⑤要的那条黑边更清楚），
            同时内火正好成为"数字后面那枚焰心"，号写在焰心上读得通。
         b. **手数下移 0.36em**（styles.css 的 `.stones-soul-inkflame .move-number`）：
            字号是 0.64r，0.36em = 0.23r，正好把号从子心挪到焰身中心。
            用 em 而不是 px，是因为它会随「手数大小」那根滑杆一起缩放。

   ## 棋子的形状（2026-10-11 定稿，这一轮**外形一字未改**）

     外轮廓 = `FLAME_D`（长宽比照抄棋魂 UI）；内火 = 绕焰身下半重心的非等比缩。
     ⚠ 别改回"绕包心等比缩"：FLAME_D 两根焰苗之间有条 V 形缺口切到子心附近，
       这条路径不是星形的，绕包心缩放必然在焰苗处顶穿（实测穿出 6×7 px）。

   ## 墨阶（唯一的颜色体系）

     焦墨  #0a0d0e   重墨  #1e252a   中墨  #39424a
     板灰  #3a4046 ~ #5b6167（盘面，取自参考图）  淡墨  #7d8a94
     清墨  #b3bfc7   素白  #f7fafc
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";


  const mk = (ID) => ({
    ID,
    P: (n) => `${ID}-${n}`,
    Q: (n) => `${ID}--${n}`,
    push: (o) => { o.id = ID; SKINS.push(o); },
  });

  /* 15 路、viewBox 620、PAD 46（与 playable.html 一致） */
  const X0 = 46;
  const X1 = 574;

  /* 无障碍兜底：系统要求「减少动态效果」时掐掉动画 */
  const RM = (sel) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;

  /* ═══════════════════════════════════════════════════════════════════
     棋魂 · 墨青石盘（盘 + 子，纯墨阶）
     ═══════════════════════════════════════════════════════════════════ */
  (() => {
    const ID = "soul-inkflame";

    /* 墨焰轮廓（32×32 坐标系，与 SoulFlame 的 FLAME_PATH 同一句几何）。
       黑子白子都由它派生 —— 换掉这一句，棋盘上的子和界面上的魂火同时变。 */
    const FLAME_D = "M16.4 2.6c.5 3.2 2.3 5.4 4.2 7.2 1.9 1.8 3.1 3.9 3.1 6.3a7.4 7.4 0 0 1-14.8 0c0-1.6.6-3 1.5-4.2.7 1.5 2.1 2.3 3.4 2.2.5 0 .8-.4.7-.9-.6-3.4-1.1-5.8.5-7.9.2 2.1 1 3.7 2.3 4.9-.4-2.6-.6-5.1-.9-7.6Z";
    /* 焰身那颗圆的圆心（path 坐标）。外焰 bbox 中心是 13.05，但**视觉中心**
       是这颗圆 —— 手数、光环、判定都该以它为准（见文件头 ③）。 */
    const BODY_CY = 16.1;
    const BODY_CX = 16.3;
    /* 当前手那圈光的 class：带皮肤前缀，多份皮肤同文档时不会互相选到对方 */
    const PULSE_CLASS = `${ID}-pulse`;
    /* 盘面那层会飘的湿雾：只有这个 class 被动效选中（transform，不动滤镜） */
    const MIST_CLASS = `${ID}-mist`;

    const { P, push } = mk(ID);
    push({
      name: "棋魂 · 黑白水墨",
      sub: "墨青石盘 + 湿雾流动 + 魂火双子",
      group: "随画风",
      swatch: "#4a5157",
      pageBg: "#0b0e11",
      radius: 14,
      vars: {
        "--bd-bg": "#444a50",
        "--bd-line": "#a4acb3",
        "--bd-line2": "#6f7880",
        "--bd-star": "#cdd6dd",
        "--bd-frame": "#848d95",
        "--st-black": "#0a0d0e",
        "--st-white": "#f7fafc",
        "--ui-accent": "#9aa7b0",
        "--ui-bg": "#12161a",
        "--ui-ink": "#e9eef2",
        "--ui-muted": "#9aa7b0",
        "--ui-line": "#2f3941",
        "--bd-radius": "14px",
      },
      defs: `
        <!-- 盘面：墨青石（四档渐变）。比上一版亮半档、冷半档 —— 参考图里
             盘就是"比背景亮三四档的中性灰"，压暗它等于把主体埋进墨里。 -->
        <linearGradient id="${P("board")}" x1="0" y1="0" x2=".72" y2="1">
          <stop offset="0" stop-color="#5b6167"/><stop offset=".38" stop-color="#4d535a"/>
          <stop offset=".74" stop-color="#41474d"/><stop offset="1" stop-color="#383e44"/>
        </linearGradient>
        <!-- 中央气眼：**多档渐隐**（上一版只有两档，边缘有一圈看得见的界，
             就是"不通透"的来源之一）。 -->
        <radialGradient id="${P("spot")}" cx="50%" cy="44%" r="66%">
          <stop offset="0" stop-color="#8d99a3" stop-opacity=".30"/>
          <stop offset=".42" stop-color="#6f7981" stop-opacity=".16"/>
          <stop offset=".72" stop-color="#545b62" stop-opacity=".06"/>
          <stop offset="1" stop-color="#2b2f34" stop-opacity="0"/>
        </radialGradient>
        <!-- 湿雾：飘在盘面上那一层的填充。极淡（中心 .18），只在掠过时看得见。 -->
        <radialGradient id="${P("mist")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#e8eff5" stop-opacity=".18"/>
          <stop offset=".48" stop-color="#dbe4ec" stop-opacity=".095"/>
          <stop offset="1" stop-color="#cfd9e2" stop-opacity="0"/>
        </radialGradient>
        <!-- 顶部透光：光从上面来才有体积感 —— 只压在盘的上缘 130px 内。 -->
        <linearGradient id="${P("rim")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#cdd6de" stop-opacity=".14"/>
          <stop offset=".55" stop-color="#b9c3cc" stop-opacity=".05"/>
          <stop offset="1" stop-color="#aab4bd" stop-opacity="0"/>
        </linearGradient>
        <!-- 湿墨晕：两团极淡的墨，让石头不是一块均匀的塑料板 -->
        <radialGradient id="${P("wash")}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#0d1114" stop-opacity=".22"/>
          <stop offset=".55" stop-color="#0d1114" stop-opacity=".10"/>
          <stop offset="1" stop-color="#0d1114" stop-opacity="0"/>
        </radialGradient>
        <!-- 盘面石纹：横向长弧，像石头上的水痕。压得极淡。 -->
        <pattern id="${P("grain")}" width="180" height="150" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#b3bfc7" stroke-linecap="round">
            <path d="M6 34c46-13 92-11 138 3" stroke-width="1.5" opacity=".055"/>
            <path d="M20 88c52-16 96-9 146 6" stroke-width="1.1" opacity=".038"/>
            <path d="M2 128c40-10 82-12 122 1" stroke-width="1.3" opacity=".034"/>
            <path d="M96 16c30-6 58-4 84 6" stroke-width=".9" opacity=".042"/>
            <path d="M64 62c34-11 66-7 96 4" stroke-width="1.2" opacity=".03"/>
          </g>
        </pattern>
        <!-- 四角暗角：这一版**大幅收手**（.46 → .26，起步 .56）。
             上一版靠它"收视线"，代价是整块盘被压成一坨死灰 —— 那正是
             用户说的"不够通透"。现在只留最外一圈。 -->
        <radialGradient id="${P("vign")}" cx="50%" cy="46%" r="78%">
          <stop offset=".56" stop-color="#101418" stop-opacity="0"/>
          <stop offset=".82" stop-color="#0e1216" stop-opacity=".10"/>
          <stop offset="1" stop-color="#0a0d10" stop-opacity=".26"/>
        </radialGradient>
        <!-- 黑子：近黑（在灰盘上边界清楚）。留一点冷灰的高光，
             否则整枚子是一块死黑、没有"子是圆的"的体积感。 -->
        <radialGradient id="${P("ink")}" cx="34%" cy="28%" r="82%">
          <stop offset="0" stop-color="#3d464d"/><stop offset=".3" stop-color="#1a2025"/>
          <stop offset=".72" stop-color="#0b0e11"/><stop offset="1" stop-color="#06080a"/>
        </radialGradient>
        <!-- 黑子里的**内火**：实心 + 硬边。
             ⚠ 别改回"淡到边缘透明度归零"的写法 —— 那样边界糊掉，
             肉眼读到的就是"内火和外轮廓连在一起"（用户原话「没有一段隔离的距离」）。
             所有 stop 都不带 stop-opacity，最后一档也必须是不透明的。
             ⚠ 这一版把中心从纯白压到 #f2f7fb：手数（#f2f6f9 + 墨色描边）
             正好压在它上面，纯白底会把手数的描边吃掉一圈。 -->
        <radialGradient id="${P("inkCore")}" cx="44%" cy="30%" r="74%">
          <stop offset="0" stop-color="#f2f7fb"/><stop offset=".52" stop-color="#e6edf3"/>
          <stop offset="1" stop-color="#bcc7d1"/>
        </radialGradient>
        <!-- 白子：素白 + 一圈外发光（参考图里白子明显"亮出来"，比黑子抢眼）。 -->
        <radialGradient id="${P("core")}" cx="34%" cy="28%" r="84%">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".46" stop-color="#f8fbfd"/>
          <stop offset=".84" stop-color="#e6ecf0"/><stop offset="1" stop-color="#c9d3da"/>
        </radialGradient>
        <!-- 白子的外发光（画在子底下的一圈柔光）。
             ⚠ 用户 10-12「周围的光不用太多了」：实测焰边上的有效不透明度
             顶 .25 / 侧 .21，白子在灰盘上像在"发光"而不是"亮"。
             收成 .40/.17 并把椭圆从 0.87r×1.18r 收到 0.82r×1.10r 之后，
             焰边只剩 .10/.14 —— 约减一半，仍留一圈能看出的边光。 -->
        <radialGradient id="${P("coreGlow")}" cx="50%" cy="50%" r="50%">
          <stop offset=".62" stop-color="#eef4f8" stop-opacity=".4"/>
          <stop offset=".82" stop-color="#dfe8ee" stop-opacity=".17"/>
          <stop offset="1" stop-color="#c9d3da" stop-opacity="0"/>
        </radialGradient>
        <!-- 白子里的**内火**：同一朵焰的墨面（"黑白子是同一朵魂火的正负片"的另一半）。
             ⚠ 中心从 #454f58 提到 #5c6772：手数是 #232b32 的深墨字，
             压在近黑的内火上两个方向都读不出，提亮到中墨后靠白色描边分家。 -->
        <radialGradient id="${P("coreInk")}" cx="44%" cy="32%" r="74%">
          <stop offset="0" stop-color="#5c6772"/><stop offset=".52" stop-color="#28313a"/>
          <stop offset="1" stop-color="#0b1014"/>
        </radialGradient>
        <!-- 当前手的光环：浓墨（浅盘上用暗环） -->
        <linearGradient id="${P("halo")}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#39424a"/><stop offset=".5" stop-color="#0a0d0e"/>
          <stop offset="1" stop-color="#5c6871"/>
        </linearGradient>
      `,
      boardFill: `url(#${P("board")})`,
      /* 叠放次序 = 由里到外：气眼 → 湿雾（会飘）→ 石纹 → 湿墨晕 → 顶部透光
         → 暗角 → 盘沿。湿雾在石纹**下面**，雾掠过时只是把纹路稍微糊掉一点，
         不会在石头纹理上再盖一层白（那种做法看着就是"屏幕脏了"）。 */
      boardOverlay: `
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("spot")})"/>
        <g class="${MIST_CLASS}">
          <ellipse cx="168" cy="206" rx="238" ry="104" fill="url(#${P("mist")})"/>
          <ellipse cx="470" cy="352" rx="196" ry="86" fill="url(#${P("mist")})" opacity=".8"/>
          <ellipse cx="286" cy="524" rx="262" ry="98" fill="url(#${P("mist")})" opacity=".62"/>
        </g>
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("grain")})"/>
        <ellipse cx="118" cy="132" rx="228" ry="168" fill="url(#${P("wash")})" opacity=".5"/>
        <ellipse cx="524" cy="486" rx="252" ry="196" fill="url(#${P("wash")})" opacity=".42"/>
        <rect x="0" y="0" width="620" height="130" rx="14" fill="url(#${P("rim")})"/>
        <rect x="0" y="0" width="620" height="620" rx="14" fill="url(#${P("vign")})"/>
        <rect x="3.5" y="3.5" width="613" height="613" rx="13" fill="none" stroke="#b6c0c9" stroke-width="1.2" opacity=".13"/>`,
      /* 网格：**冷灰亮线**压在墨青盘上。线更细（1.05）但更亮（#a4acb3），
         盘亮了半档之后，原来的 #9aa2a8 会开始"陷进"盘里。 */
      lineStroke: "#a4acb3", lineW: 1.05, lineOpacity: .56,
      starFill: "#cdd6dd", starR: 3.1, starOpacity: .78,
      /* 外框 + **中央十字**（参考图最显眼的特征之一：天元那两条线明显更亮）。 */
      gridExtra: `<path d="M${X0} ${X0}H${X1}M${X0} ${X1}H${X1}M${X0} ${X0}V${X1}M${X1} ${X0}V${X1}" fill="none" stroke="#8f979e" stroke-width="1.6" opacity=".44"/>`
        + `<path d="M310 ${X0}V${X1}M${X0} 310H${X1}" fill="none" stroke="#c9d2d9" stroke-width="1.7" opacity=".30"/>`,
      /* ═══ 棋子 · 火焰形（外形 2026-10-11 定稿，本轮只动内火与摆位基准）════════
         用户三句原话，逐条对应下面三行实现，别再改回去：

           ⑥「其实 d 是非常顺眼的，但是形状不是火焰」
             → 外轮廓 = `FLAME_D`，**不是** `blob()` 那个圆
               （圆那一版就是打了"不及格"的候选 A）。
           ⑤「里面的内火又超过了外轮廓，内火和外火没有一段隔离的距离」
             → 内火**不能**用「绕包心等比缩」。我第一版就是那么写的，
               实测**真穿出去 6×7 像素**（`.tmp-flame-verify.mjs` 可复现）。
               根因是 FLAME_D 两根焰苗之间有条 V 形缺口一路切到子心附近，
               这条路径**不是星形的** —— 从包心出发的射线会先穿出再穿回。
             → 本轮在内火之外再加一条：内火的焰身圆心与外焰的焰身圆心
               **对齐**（CORE 里的 ty 由这个条件反解），比例收到 .44×.50，
               隔离距离比 .58×.66 那版更大。
           ④「照着我们的棋魂图案做」
             → 黑子 = 焰身 + **白色内火**，白子 = 焰身 + **墨色内火**，
               一朵焰的正负片（与 UI 那枚魂火同源）。 */
      stone: ({ x, y, r, player, isLast, isWin }) => {
        const isBlack = player === 1;
        /* FLAME_D 的包心与高（bbox 8.9..23.7 / 2.6..23.5，高 20.9）。
           ⚠ 摆位基准仍是**包心**：外焰的轮廓保持上下对称（那是用户认可的 d），
           手数那 0.23r 的偏差改由 styles.css 的 translateY 补（见文件头 ③）。 */
        const FCY = 13.05;
        /* 焰高 = 0.98 × 子径：比正圆略收，上下各留 1% 子径，
           再叠上格距本身的缝隙（半径上限 0.43 格距），邻子碰不到。 */
        const S = (r * 2 * 0.98) / 20.9;
        /* 内火变换：绕 (BODY_CX, ty) 缩，**让内火自己的焰身圆心
           也落到 BODY_CY**。反解：ty + sy*(BODY_CY - 20) = BODY_CY
           ⇒ ty = BODY_CY + (20 - BODY_CY) * sy ... 注意符号：
             p ↦ ty + sy*(p - 20)，要 p=BODY_CY 时结果 = BODY_CY
             ⇒ ty = BODY_CY + sy*(20 - BODY_CY) = 16.1 + .50*3.9 = 18.05

           ⚠ sx 必须**等于** sy（用户 10-12：「再改一下这个内火的样子」）。
             上一版 sx=.44 / sy=.50，横向比纵向多收 12% —— 内火的长宽比被压成
             0.619，而外焰是 0.706，于是内火不再是"同一朵焰的缩小版"，
             读起来像一颗被捏窄的水滴、焰尖也变钝。等比之后内外同形。
             代价是左右隔离从 4.99px 收到 4.47px（r=12.86 实测），仍在 4px 之上。 */
        const SY = 0.5, SX = 0.5;
        const TY = (BODY_CY + SY * (20 - BODY_CY)).toFixed(3);
        const CORE = `translate(${BODY_CX} ${TY}) scale(${SX} ${SY}) translate(-16.3 -20)`;
        /* 摆位：把 32 系的火焰包心挪到子心并按 S 缩放；芯在这之后再套自己的变换 */
        const at = (inner) => `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${S.toFixed(5)}) translate(${(-16.3).toFixed(2)} ${(-FCY).toFixed(2)})${inner ? ` ${inner}` : ""}`;
        /* 描边按 0.6px 折回路径系 —— transform 里的 scale 会把 stroke-width 一起放大 */
        const rim = (0.6 / S).toFixed(3);
        const flame = (fill, stroke, inner) =>
          `<path d="${FLAME_D}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${rim}"` : ""} transform="${at(inner)}"/>`;
        /* 地影交给 App 统一的 `filter="url(#stoneShadow)"`（feDropShadow dy=3）：
           它按 alpha 形状生成投影，焰形子自动得到焰形的影，自己再画一个圆椭圆反而会串味。 */
        let out = "";
        if (isBlack) {
          out += flame(`url(#${P("ink")})`, "#05070a", "");
          out += flame(`url(#${P("inkCore")})`, "", CORE);
        } else {
          /* 白子的柔光：长椭圆贴着焰形（焰的半宽 0.69r、半高 0.98r，
             椭圆各放 1.18/1.12 倍 —— 以前是正圆 r×1.5，左右会露出两团没东西的光，
             像子长了耳朵；10-12 又按「周围的光不用太多了」从 1.25/1.2 收到这里，
             水墨里白子是"亮"不是"发光"。 */
          out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.82).toFixed(2)}" ry="${(r * 1.1).toFixed(2)}" fill="url(#${P("coreGlow")})"/>`;
          out += flame(`url(#${P("core")})`, "#8d99a1", "");
          out += flame(`url(#${P("coreInk")})`, "", CORE);
        }
        /* 胜利子：贴焰形的冷白柔光（正圆环会和焰尖、焰腰各脱开一大截）。
           10-12 同步收一档（.34 → .24）：「周围的光不用太多了」这条也管它。 */
        if (isWin) out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.94).toFixed(2)}" ry="${(r * 1.22).toFixed(2)}" fill="none" stroke="#e8f0f5" stroke-width="${(r * 0.16).toFixed(2)}" opacity=".24"/>`;
        /* 当前手：贴焰形的光环（带 class 供呼吸动画选；形状是 ellipse，
           所以下面 stoneMotions 的选择器也是 ellipse —— 两边必须同时改）。 */
        if (isLast) out += `<ellipse class="${PULSE_CLASS}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.9).toFixed(2)}" ry="${(r * 1.16).toFixed(2)}" fill="none" stroke="url(#${P("halo")})" stroke-width="${Math.max(1.3, r * 0.13).toFixed(2)}" opacity=".8"/>`;
        return out;
      },
      /* 盘面湿雾（常驻）。只动 transform，且它里面只有三个椭圆 + 一个纯色渐变，
         没有 filter、没有 pattern —— 低端机也扛得住（红线见 _TEMPLATE.js）。
         ⚠ 周期必须长（78s）、位移必须小（±10px）：这是下棋的背景，抢戏就废了。 */
      boardMotions: [{
        id: "bmo-soul-inkflame",
        name: "墨雾流动",
        desc: "盘面上有一层极淡的湿雾缓缓横移，像山气掠过石面",
        css: (n) => `
  @keyframes ${n}{0%{transform:translateX(-10px)}50%{transform:translateX(10px)}100%{transform:translateX(-10px)}}
  #board g.${MIST_CLASS}{animation:${n} 78s ease-in-out infinite}
  ${RM(`#board g.${MIST_CLASS}`)}`,
      }],
      /* 当前手的呼吸（常驻）。只动 opacity + transform，且只作用在一枚小椭圆上。
         ⚠ 选择器必须带 #board #stones 限定，否则会漏到界面上别的 SVG。 */
      stoneMotions: [{
        id: "smo-soul-inkflame",
        name: "魂火微光",
        desc: "当前手外面那圈光轻轻明灭，像魂火在盘上亮着",
        css: (n) => `
  @keyframes ${n}{0%,100%{opacity:.88;transform:scale(1)}50%{opacity:.42;transform:scale(1.1)}}
  #board #stones ellipse.${PULSE_CLASS}{animation:${n} 3.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  ${RM(`#board #stones ellipse.${PULSE_CLASS}`)}`,
      }],
      css: "",
    });
  })();
})();
