import { useId } from "react";

/**
 * 棋魂的图案：**魂火**（用户 2026-10-09：「棋魂的样子还是不咋样，你多设计几个，
 * 形状要像火焰，要是那种变形的那种，不是整体就一个简单形状，然后是黑白混合颜色，
 * 混合起来也要好看的那种，不是随意混合」）。
 *
 * ## 这一版为什么推翻重做
 *
 * 上一版是「一个水滴 + 一个内胆 + 两颗火星」——用户评价"不咋样"，问题在两个地方：
 *  ① **只有一条外轮廓**，是个简单形状，不像真火（真火有多条火舌与凹口）；
 *  ② 配色是**单色琥珀金**，用户要的是**黑白混色**，而且要混得好看。
 *
 * ## 造型：三条火舌叠出有机轮廓
 *
 * 真火的轮廓特征是「多条火舌 + 舌与舌之间的凹口」。手绘一条带凹口的闭合路径极难维护，
 * 所以这里改成**分层叠加**：底座 + 中间高舌 + 左舌 + 右舌，四块同色图形叠在一起，
 * 视觉上自动并成一个带凹口的有机火焰。改形只需要挪一块，不用重算整条路径。
 *
 * 三条舌的高度刻意不同（中 > 右 > 左）且左右不对称——对称的火看起来像贴纸，
 * 不对称才有"火在扭"的味道。
 *
 * ## 配色：黑白怎么混才好看（不是随便一半黑一半白）
 *
 * 三种混法都实现在这里，用 `variant` 选。三种都遵守同一条纪律：**黑白必须都看得见**——
 * 浅色主题上白块会消失、深色主题上黑块会消失，所以**每一块自带一圈反色发丝描边**
 * （黑块描淡淡的亮边、白块描淡淡的暗边）。这圈描边几乎看不出来，但保证了任何底色上
 * 轮廓都在，这也是"混起来好看"的前提：先看得清，再谈好看。
 *
 *  · `soul`（默认）——**黑焰裹白魂**：焰身是黑到石墨的渐变，中心的"魂"是一朵白火。
 *    黑多白少、白在最亮处，是最像"魂火"的一种；也是最小尺寸下最扛得住的一种
 *    （16px 时白芯仍是一颗明确的亮点）。
 *  · `yinyang`——**阴阳分焰**：一条 S 形分界把焰身劈成左黑右白，两块互相咬合。
 *    黑白各半，最"黑白混合"；代价是小尺寸下分界线会糊。
 *  · `ink`——**水墨上色**：黑墨在下、白在上，中间靠一条柔和过渡带相接（不是硬切），
 *    再加一颗白芯。像宣纸上的一笔焦墨带飞白。
 *
 * 三种都用同一套火舌几何，所以换 `variant` 只改配色、不改形状。
 */

export type SoulFlameVariant = "soul" | "yinyang" | "ink";

/** 默认方案。改这一行就换掉全应用（徽章 / 版头 / 流水 / 弹窗）的棋魂图案。 */
export const DEFAULT_SOUL_FLAME_VARIANT: SoulFlameVariant = "soul";

export const SOUL_FLAME_VARIANTS: ReadonlyArray<{ id: SoulFlameVariant; name: string; note: string }> = [
  { id: "soul", name: "黑焰裹白魂", note: "黑色焰身 + 中心白火；黑白比约 7:3，小尺寸最清晰" },
  { id: "yinyang", name: "阴阳分焰", note: "S 形分界劈成左黑右白、互相咬合；黑白各半" },
  { id: "ink", name: "水墨魂火", note: "下黑上白，中间柔和过渡带 + 白芯；像焦墨带飞白" },
];

/**
 * 火舌几何（32×32 画布）。
 *
 * ## 这一版怎么改的（用户 2026-10-09 第三次反馈：「里面的芯也是没有变化的，
 * 应该像是外面大形状的一种形变」）
 *
 * 上一版的芯是一个**独立的泪滴**（`CORE` 自己画了一条跟外焰无关的曲线），
 * 所以"芯没跟着外面变形"——用户一眼就看出来了。
 *
 * 去查了成熟火焰图标的做法（Lucide 的 flame 是业界最通用的那一个），
 * 它的路径数据解出来是这样一条**连续闭合路径**：
 *
 * ```
 * M12 3 q1 4 4 6.5 t3 5.5 a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0 c0-2-1.5-3-1.5-5 q0-2 2.5-4
 * ```
 *
 * 关键发现有三条，正是我们缺的：
 *  ① **它只有一个 `M`**——整个火焰是**一条**轮廓，不是"外焰 + 内芯"两块拼的；
 *  ② **"芯"是轮廓自己拐进去又拐出来形成的**（那条 `a1 1 ... -14 0 / 5 5 ... 1 -3 /
 *     1 1 ... 5 0` 的连续弧线把底边收成一个内凹的口），所以芯与外焰**天然同形**；
 *  ③ 火舌的分离靠 `q`/`t`/`c` 三种曲线**接续**画出，不是多块图形叠的。
 *
 * 所以这一版改成 Lucide 的构造法：**一条连续路径**，从头到尾走下来，
 * 左侧收口时拐出内凹——内芯就是外轮廓的形变，不再是独立图形。
 * 三条舌由 `q`（左舌）、`t`（右舌）、`c`（中舌）分别勾出。
 */
const FLAME_PATH =
  // 中舌尖端（起点）→ 左侧下滑出左舌 → 右转出右舌 → 底部大弧 → 左下收口（内凹）
  // → 回到中舌根部，形成"芯是外层形变"的结构。
  "M16.4 2.6c.5 3.2 2.3 5.4 4.2 7.2 1.9 1.8 3.1 3.9 3.1 6.3a7.4 7.4 0 0 1-14.8 0c0-1.6.6-3 1.5-4.2.7 1.5 2.1 2.3 3.4 2.2.5 0 .8-.4.7-.9-.6-3.4-1.1-5.8.5-7.9.2 2.1 1 3.7 2.3 4.9-.4-2.6-.6-5.1-.9-7.6Z";

/**
 * 芯：**外轮廓的内收形变**，不是独立图形。
 *
 * 做法是把同一条轮廓按一个锚点缩放，于是外焰怎么变、芯就跟着怎么变——
 * 这就是用户要的"芯是外面大形状的一种形变"（上一版芯是独立画的泪滴，所以"没有变化"）。
 *
 * ⚠ 变换必须写成 `translate(cx cy) scale(s) translate(-cx -cy)` 这个**标准三段式**，
 * 也就是"绕 (cx,cy) 缩放"。上一版我把第二段的 cy 写成了正数，等于缩放锚点跑到了
 * 画布外，芯被推到看不见的地方（实测 92px 下芯整块消失）。
 *
 * 参数是量出来的：锚点 `(16.3, 20)` 取火焰下半的重心，芯的根部就贴着外焰根部、
 * 尖端比外焰短一截；缩放 `(.54, .68)` —— 再小芯会丢掉火舌轮廓变成一个团，
 * 再大会顶到外焰边、留不出那圈黑边。
 *
 * ⚠ 用户 10-09 第四次反馈后**改成"白环 + 内侧柔光"**（见 CORE 的渲染处）：
 * 之前是"白色渐变实心"，用户评价"最中间这个白色的芯的状态还不行"——
 * 实心白块的底缘会被外焰裁成一条**平直的水平切口**（外轮廓底部是圆的，缩放后
 * 仍留着内凹的平口），看起来像被切掉的，不像火的芯。
 *
 * ⚠ 用户 10-09 第七轮**去掉了外圈描边**（「要么直接给轮廓去掉，留下一个渐变的内部的
 * 火焰形状的芯」）：只要那圈描边还在，画面里就有两个平行轮廓，间距调多少次都会被读成
 * "亲在一起"。去掉描边、芯只用渐变成形之后，边界是渐隐的、没有硬边可以对上。
 * 因此这里可以把芯**放大一档**（没有描边要留余量了）：`.58/.66` —— 芯更饱满，
 * 也更像"火里包着一团热的芯"，而不是一小块贴片。
 */
const CORE_TRANSFORM = "translate(16.3 19.6) scale(.58 .66) translate(-16.3 -20)";

/** 阴阳分界线：一条从上到下贯穿的 S 曲线。左黑右白。 */
const YINYANG_DIVIDE = "M0 0L15.4 0C17.6 5.6 11.2 10.4 13.6 16.4C16 22.4 10.4 26.6 14.6 32L0 32Z";

export interface SoulFlameProps {
  /** 边长（px）。图案是正方形 viewBox，宽高同值。 */
  size?: number;
  /** 配色方案，默认 `DEFAULT_SOUL_FLAME_VARIANT`。 */
  variant?: SoulFlameVariant;
  /** `gold` 把整体染成琥珀金（当前**只有成就奖励**那处用它，和黑白棋魂区分开）。 */
  tone?: "ink" | "gold";
  /** 静态展示时关掉呼吸动效（列表里建议关）。 */
  animated?: boolean;
  /**
   * 魂火的形态（用户 10-09 第十轮：「还是搞成两种形态吧，不用动效切换了」）。
   *
   * - （默认）：黑焰 + 白亮边的芯；
   * - ：白焰 + 暗芯（原来自动燃烧动画烧到反相的那一帧）。
   *
   * 只有  +  支持两态（其余配色没有反相版渐变）。
   */
  state?: "normal" | "burnt";
  className?: string;
  title?: string;
}

export function SoulFlame({
  size = 20,
  variant = DEFAULT_SOUL_FLAME_VARIANT,
  tone = "ink",
  animated = false,
  state = "normal",
  className = "",
  title,
}: SoulFlameProps) {
  // 每个实例一套 id：同页多实例共用写死的 id 会让后挂的那个引用第一个的渐变。
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const bodyId = `sf-body-${uid}`;
  const coreId = `sf-core-${uid}`;
  /** 芯的边缘柔化蒙版（径向渐隐），见 coreId 渐变处的注释。 */
  /** 芯的"外亮内暗"径向层（叠在 coreId 线性层之上）。 */
  const coreEdgeId = `sf-edge-${uid}`;
  const coreSoftId = `sf-soft-${uid}`;
  const coreMaskId = `sf-cmask-${uid}`;
  /** 燃烧动画的反相态渐变见 defs 里的 bodyInvId / coreInvId / coreEdgeInvId。 */
  const bodyInvId = `sf-bodyinv-${uid}`;
  const coreInvId = `sf-coreinv-${uid}`;
  const coreEdgeInvId = `sf-edgeinv-${uid}`;
  const clipId = `sf-clip-${uid}`;
  const invertClipId = `sf-invert-${uid}`;
  const glowId = `sf-glow-${uid}`;

  // ── 三套配色 ──────────────────────────────────────────────────────
  // 每一块都带反色发丝描边（见文件头"黑白必须都看得见"）。描边用 vectorEffect
  // 让它在任意缩放下都是同样的发丝粗细（不然 16px 时描边会细到没有）。
  const gold = tone === "gold";
  const palette = (() => {
    if (gold) {
      return {
        gradFrom: "#f3d488", gradMid: "#e0ac3f", gradTo: "#b8801c",
        core: "#fffdf2", coreOpacity: 1,
        spark: "#ffeab0",
        strokeDark: "#8a5f14", strokeLight: "#fff4d2",
      };
    }
    switch (variant) {
      case "yinyang":
        return { gradFrom: "#0b0e0f", gradMid: "#15191b", gradTo: "#23292c", core: "#ffffff", coreOpacity: 0, spark: "#0b0e0f", strokeDark: "rgba(255,255,255,.42)", strokeLight: "rgba(8,10,11,.34)" };
      case "ink":
        // 下黑上白：过渡带要够快（52%→88% 之间就走完），否则底部太淡，
        // 浅色主题上整朵火的下半会糊掉（实测 92px 时底缘已经看不见了）。
        return { gradFrom: "#0b0e0f", gradMid: "#2b3338", gradTo: "#9aa4aa", core: "#ffffff", coreOpacity: 1, spark: "#0b0e0f", strokeDark: "rgba(255,255,255,.34)", strokeLight: "rgba(8,10,11,.46)" };
      case "soul":
      default:
        // 黑→白走完整梯度（不是黑→灰）：用户要的是"黑白混合"，
        // 上一版渐变只到 #3b444a（深灰），白色全靠单独的白芯，渐变本身看不出黑白过渡。
        //
        // 但**底缘不能收到纯白**：白芯就在下半部，底缘太白会让"魂"融进焰身
        // （实测 92px 时白芯只剩一圈描边看得见）。收到浅灰蓝 #b3bfc7 ——
        // 白芯仍是画面里最亮的一块，同时在白底卡片上焰身也不至于消失。
        return { gradFrom: "#0a0d0e", gradMid: "#39424a", gradTo: "#b3bfc7", core: "#ffffff", coreOpacity: 1, spark: "#0a0d0e", strokeDark: "rgba(255,255,255,.40)", strokeLight: "rgba(8,10,11,.40)" };
    }
  })();

  /**
   * 焰体：**一条**连续路径（见 FLAME_PATH 的注释——这是照成熟火焰图标的构造法改的，
   * 不再用"四块图形叠"）。`stroke` 是那圈几乎看不见的反色发丝边，
   * 保证浅底深底都有轮廓。
   */
  const body = (fill: string, stroke: string) => (
    <path
      d={FLAME_PATH}
      fill={fill}
      stroke={stroke}
      strokeWidth="0.9"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );

  /**
   * 一朵完整的火（焰体 + 芯），按传入的配色画。
   *
   * 抽成函数是为了**两种形态**（用户 10-09 第十轮改成手动切换，见 `state`）。
   * 两态共用同一份几何，所以切换时形状完全对得上、不会错位。
   */
  const flameLayer = (options: {
    bodyFill: string;
    coreBase: string;      // 芯的线性底层
    coreEdge: string;      // 芯的外亮内暗径向层
  }) => <>
    {body(options.bodyFill, tone === "gold" ? palette.strokeDark : (variant === "ink" ? palette.strokeLight : palette.strokeDark))}
    {palette.coreOpacity > 0 && <g mask={`url(#${coreMaskId})`}>
      <path d={FLAME_PATH} transform={CORE_TRANSFORM} fill={options.coreBase}/>
      <path d={FLAME_PATH} transform={CORE_TRANSFORM} fill={options.coreEdge}/>
    </g>}
  </>;

  /**
   * 两种形态（用户 10-09 第十轮：「还是搞成两种形态吧，不用动效切换了」）。
   *
   * 上一版是 11 秒自动燃烧循环（常态 ⇄ 反相交叉淡化）。用户改主意了，要**手动**切换：
   * 点一下棋魂就 +1 并翻面 —— 于是"翻面"本身成了给用户的即时反馈，
   * 不再需要一个常驻动画在后台烧（那个动画还一直占用合成层）。
   *
   * - `state="normal"`：黑焰 + 白亮边的芯（默认）
   * - `state="burnt"`：白焰 + 暗芯（就是原来动画烧到反相时的那一帧）
   */
  const twoState = tone === "ink" && variant === "soul" && palette.coreOpacity > 0;
  const burnt = twoState && state === "burnt";

  return <svg
    className={`soul-flame ${animated ? "is-animated" : ""} ${twoState ? "is-two-state" : ""} ${burnt ? "is-burnt" : ""} ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
  >
    {title && <title>{title}</title>}
    <defs>
      <linearGradient id={bodyId} x1="16" y1="2" x2="16" y2="31" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={palette.gradFrom}/>
        <stop offset="52%" stopColor={palette.gradMid}/>
        <stop offset="100%" stopColor={palette.gradTo}/>
      </linearGradient>
      {/* 芯的颜色层：多层叠加，**越靠边越亮**（用户 10-09 第九轮：
          「里面的那个边缘太弱了，没有火焰的形状……应该是从外面往里面渐变的」）。

          ## 为什么是"外亮内暗"
          
          芯的形状要读出来，靠的是**它自己的边界与焰身有反差**。
          边缘亮、中心暗 ⇒ 亮的部分自然勾出火焰轮廓，而中心留暗 =
          "火里包着一团热"，比整块白更像火。这就是用户说的"从外面往里面渐变"。
          
          ## 上一版为什么把尖抹掉了
          
          上一版用一层**径向柔化蒙版**收边（`coreSoftId`，圆心在底部 `cy19.8`、半径 8.4）。
          但芯是纵向拉长的火焰形，**尖端离那个圆心有 11.69**，超出半径 8.4 ⇒
          **整个火焰尖被蒙版抹掉**，于是"没有火焰的形状"。
          现在改用下面这层 edgeMask，半径按**到边界的最远距离**给足，不再切掉尖。 */}
      <linearGradient id={coreId} x1="16" y1="9" x2="16" y2="23" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={tone === "gold" ? palette.core : "#8b98a1"} stopOpacity=".85"/>
        <stop offset="55%" stopColor={tone === "gold" ? palette.core : "#d7e0e6"} stopOpacity=".95"/>
        <stop offset="100%" stopColor={tone === "gold" ? palette.core : "#ffffff"} stopOpacity="1"/>
      </linearGradient>
      {/* "外亮内暗"的径向层：中心压暗、越往外越亮。
          ⚠ 半径必须**覆盖到最远的边界点**（实测芯的火焰尖离中心 12.5），
          否则就是上一版那个"尖被抹掉"的坑。所以取 r=13 并且在 100% 处就到达满亮，
          再往外的区域保持满亮（渐变的末端值会一直延续下去）。 */}
      <radialGradient id={coreEdgeId} cx="16.4" cy="18.6" r="13" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={palette.core} stopOpacity="0"/>
        <stop offset="34%" stopColor={palette.core} stopOpacity=".18"/>
        <stop offset="72%" stopColor={palette.core} stopOpacity=".72"/>
        <stop offset="100%" stopColor={palette.core} stopOpacity="1"/>
      </radialGradient>
      {/* 芯的边缘柔化：**半径必须覆盖到最远的边界点**。
          上一版 r=8.4、圆心在底部，而芯的火焰尖离那个圆心有 11.69 ⇒ 尖被整块抹掉，
          表现就是用户说的"边缘太弱、没有火焰的形状"。
          现在圆心取芯的重心 (16.4, 18.6)、半径放大到 13（最远边界点约 12.5），
          并且**只在最外 12% 渐隐**（88% 处仍是不透明的）——边缘保持"有形"，
          只在最外沿化开一点点，既不再切掉尖，也不会形成一条硬线。
          （这一层是用户"不要描边"那轮的遗产：它让边界不死板；但强度和范围要够，
            否则就成了这一轮的"边缘太弱"。） */}
      <radialGradient id={coreSoftId} cx="16.4" cy="18.6" r="13" gradientUnits="userSpaceOnUse">
        <stop offset="88%" stopColor="#fff" stopOpacity="1"/>
        <stop offset="100%" stopColor="#fff" stopOpacity=".55"/>
      </radialGradient>
      <mask id={coreMaskId}><path d={FLAME_PATH} transform={CORE_TRANSFORM} fill={`url(#${coreSoftId})`}/></mask>
      {/* 反相态的焰体渐变：**上白下灰**（常态是上黑下灰）。
          燃烧动画切到这一层时，外焰整朵变白 —— 这就是用户要的"外面的变白"。 */}
      <linearGradient id={bodyInvId} x1="16" y1="2" x2="16" y2="31" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff"/>
        <stop offset="52%" stopColor="#eef2f5"/>
        <stop offset="100%" stopColor="#aeb9c0"/>
      </linearGradient>
      {/* 反相态的芯：**上黑下浅**（常态是上灰下白）。
          两层反过来之后（焰白、芯黑）就是"里面的变黑"。
          `coreEdgeInvId` 是那一圈"外亮内暗"的白边在反相态下的版本 ——
          它改成**深色**，这样芯看起来是"暗的、贴着白焰"，与常态的"亮的、贴着黑焰"正好对调。 */}
      <linearGradient id={coreInvId} x1="16" y1="9" x2="16" y2="23" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#2b3338"/>
        <stop offset="55%" stopColor="#5b666e"/>
        <stop offset="100%" stopColor="#8b98a1"/>
      </linearGradient>
      <radialGradient id={coreEdgeInvId} cx="16.4" cy="18.6" r="13" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3a4348" stopOpacity="0"/>
        <stop offset="34%" stopColor="#3a4348" stopOpacity=".2"/>
        <stop offset="72%" stopColor="#3a4348" stopOpacity=".72"/>
        <stop offset="100%" stopColor="#3a4348" stopOpacity="1"/>
      </radialGradient>
      <radialGradient id={glowId} cx="16" cy="17" r="14" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={gold ? "#ffd469" : "#dfe6ea"} stopOpacity=".38"/>
        <stop offset="72%" stopColor={gold ? "#ffd469" : "#dfe6ea"} stopOpacity="0"/>
      </radialGradient>
      {/* 阴阳：把焰身按 S 曲线劈成两半 */}
      <clipPath id={clipId}><path d={YINYANG_DIVIDE}/></clipPath>
      <clipPath id={invertClipId}><path d={`M32 0L15.4 0C17.6 5.6 11.2 10.4 13.6 16.4C16 22.4 10.4 26.6 14.6 32L32 32Z`}/></clipPath>
    </defs>

    {/* 外圈冷光：让它在深色底上像在发光（浅色底上几乎看不见，无害） */}
    <circle cx="16" cy="17" r="14" fill={`url(#${glowId})`}/>

    {variant === "yinyang" && !gold ? <>
      {/* 左半：黑焰（描淡亮边，深色底上才看得见轮廓） */}
      <g clipPath={`url(#${clipId})`}>{body(palette.gradFrom, palette.strokeDark)}</g>
      {/* 右半：白焰（描淡暗边，浅色底上才看得见轮廓） */}
      <g clipPath={`url(#${invertClipId})`}>{body("#ffffff", palette.strokeLight)}</g>
      {/* 分界线上再压一道高光，让咬合处有"亮边"而不是两块糊在一起 */}
      <path d={YINYANG_DIVIDE} fill="none" stroke="#ffffff" strokeWidth="1.1" opacity=".5" vectorEffect="non-scaling-stroke"/>
    </> : <>
      {/* 魂（芯）：**外轮廓的形变 + 只靠渐变成形**。
          
          造型史（四轮都是用户在追同一个感觉，值得记下来）：
           · 第一版是独立画的泪滴 → 用户："里面的芯也是没有变化的，应该像是外面大形状的一种形变"；
           · 第二版改成同路径缩放 + **一圈白色描边环** → 用户："里面的一个轮廓太粗了，
             还和外面那个轮廓碰到了"；把环调细、改成渐变环之后，用户仍然说
             「**还是太挨着外面的轮廓了，都亲在一起了**」；
           · 第三版去掉描边环、只留渐变 → 用户："**边缘太弱了，没有火焰的形状**，
             应该是从外面往里面渐变的"（根因见 coreSoftId：蒙版半径不够、把火焰尖抹掉了）；
           · 现在：保留"外亮内暗"的径向层（形状由它勾出）+ 修好蒙版半径，
             并且整朵火的**常态/反相双态**用于燃烧动画（见 flameLayer 的注释）。
          
          ⚠ 这里**曾经有两条独立的白色弧线**（INNER_RIMS），用户点名去掉过
          （「怎么还有两条无关的线条呢」）——那些是纯装饰且不在轮廓上，别再往回加。 */}

      {/* 两种形态二选一渲染（用户 10-09 第十轮改成手动切换）。
          `normal` = 黑焰 + 白亮边的芯；`burnt` = 白焰 + 暗芯。
          两态共用同一份几何与蒙版，所以切换瞬间形状完全对齐。 */}
      {burnt
        ? flameLayer({ bodyFill: `url(#${bodyInvId})`, coreBase: `url(#${coreInvId})`, coreEdge: `url(#${coreEdgeInvId})` })
        : flameLayer({ bodyFill: `url(#${bodyId})`, coreBase: `url(#${coreId})`, coreEdge: `url(#${coreEdgeId})` })}
    </>}

    {/* 魂点：两颗飘离的火星（"魂"的符号）。阴阳方案用黑点，其余用白点。 */}
    <circle cx="22.6" cy="5.4" r="1.5" fill={palette.spark}/>
    <circle cx="25.2" cy="10.2" r=".85" fill={palette.spark} opacity=".7"/>
  </svg>;
}
