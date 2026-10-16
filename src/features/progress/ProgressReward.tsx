import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { SoulFlame } from "./SoulFlame";
import { ACHIEVEMENT_TIER_META, tierOf, type AchievementDefinition } from "./achievement-catalog";
import { formatSoulAmount } from "./soul";
import { SOUL_MIST_FILTER, SOUL_MIST_GRADIENT, SOUL_MIST_INK, SOUL_MIST_SIZE, SOUL_MIST_STOPS, soulMistPath } from "./soul-gain-shape";

/**
 * 进度奖励的弹出提示（用户 2026-10-09）。
 *
 * ## 两类奖励，两个体量（这是"放哪里合适"的答案）
 *
 * 用户要求「成就解锁弹窗」与「棋魂获得」都用动效弹窗显示，并让我定位置。定法是
 * **按事件的分量分两档，但共用同一个锚点**：
 *
 *  · **成就解锁**——稀有、值得庆祝 → **大卡片**（勋章 + 光晕 + 旋转光芒，停留 3.6s）；
 *  · **棋魂获得**——高频（每赢一局、每解一题都会发生）→ **紧凑条**（魂火 + 数额，
 *    停留 2.2s，从同一条滑入轨道飘进来）。
 *
 * 为什么不给棋魂也用大卡片：VCF 挑战连赢十题会弹十次大卡片，那不是奖励是骚扰。
 * 为什么两者共用锚点（顶栏下沿）：这样全应用只有**一个**"奖励区域"，
 * 用户学会一次就知道所有奖励都从那儿来；散在四角会让人每次都重新找。
 *
 * 位置本身沿用成就弹窗那一版量出来的结论（顶部滑入、无遮罩、不拦操作）——
 * 顶栏是 sticky 且固定 68px，从它下面滑出天然不压棋盘中心，也不与底部
 * 的 AppToast/CoachMark 抢地盘。理由详见该组件的历史注释。
 *
 * ## 不阻塞
 *
 * 两类都**没有遮罩**、卡片之外 pointer-events 透传、到点自动走。
 * 棋魂条更激进：它连关闭按钮都不给（2.2 秒就没了，给按钮反而引诱人去点）。
 */

/**
 * 成就卡停留时长（队列短时）。
 *
 * 2026-10-10 起**按级别分档**（用户：「不同层次设计的成就弹窗，有些过了四个层次
 * 也最多第四个等级」）：低级别是日常会反复遇到的小成就，停太久是骚扰；
 * 高级别少见、值得多看一眼。见 `dwellOf`。
 */
const ACHIEVEMENT_DWELL_MS = 3600;
/** 一批解锁很多条时压缩停留（首次兑现历史数据可能一次六七条）。 */
const ACHIEVEMENT_MANY_MS = 2100;
const MANY_THRESHOLD = 4;
/**
 * 各级别成就的停留时长。
 *
 * 口径：**级别越高越少见，所以停得越久**（4 级 4.4 秒、1 级 2.4 秒）。
 * 一级成就（"初次交手"这类）是用户刚上手时会连着遇到一串的，
 * 停太久会变成"关弹窗模拟器"——而 4 级成就可能几十小时才遇到一个，
 * 多给两秒让它被看清楚是应该的。
 */
const TIER_DWELL_MS: Record<1 | 2 | 3 | 4, number> = { 1: 2400, 2: 3200, 3: 3800, 4: 4400 };

/** 棋魂条停留时长：短，因为它是高频事件。 */
const SOUL_DWELL_MS = 2200;
/** 一次最多播多久。 */
const MAX_TOTAL_MS = 9000;
/** 进出场动画时长，与 CSS keyframes 对齐。 */
const EXIT_MS = 260;

/** 队列里的一项：成就（大卡）或棋魂（紧凑条）。 */
export type RewardItem =
  | { kind: "achievement"; definition: AchievementDefinition }
  | { kind: "soul"; amount: number; label: string; balance: number };

export interface ProgressRewardQueueProps {
  queue: readonly RewardItem[];
  onDrained: () => void;
  /**
   * 两类奖励各自的开关（用户 2026-10-11：「加入两个开关，一个是成就弹窗的开关，
   * 一个是棋魂弹窗的开关，这个关闭了就不会显示弹窗了」）。
   *
   * ⚠ **关掉只是不弹，不影响解锁与入账** —— 那两件事发生在 `useProgress`
   * 的判定/记账里，与本组件无关。这里只是"要不要显示"。
   *
   * 分成两个而不是一个总开关：体量与频率差很多（成就=稀有大卡，
   * 棋魂=每赢一局都有的紧凑条），用户完全可能想留一个关一个。
   */
  showAchievements?: boolean;
  showSoul?: boolean;
}

export function ProgressRewardQueue({ queue, onDrained, showAchievements = true, showSoul = true }: ProgressRewardQueueProps) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startedAt = useRef(0);

  /**
   * 过滤掉被关掉的那一类。
   *
   * ⚠ **过滤之后必须保证队列仍会被排掉**（见下面那个 effect）——
   * 否则被关掉的那些项会永远留在 App 的 `queue` 里，
   * 后续同类的弹窗排在其后**永远轮不到**（看起来就是"关掉再打开也不弹了"）。
   */
  const visible = useMemo(
    () => queue.filter((item) => (item.kind === "achievement" ? showAchievements : showSoul)),
    [queue, showAchievements, showSoul],
  );
  useEffect(() => {
    // 整批都被关掉 ⇒ 直接排空（不显示，但也不能积压）。
    if (queue.length > 0 && visible.length === 0) onDrained();
  }, [queue.length, visible.length, onDrained]);

  // 新一批进来时重置游标。用「长度 + 首项标识」当 key：同一批里换元素不重启动画。
  const first = visible[0];
  const batchKey = visible.length ? `${visible.length}:${first?.kind === "achievement" ? first.definition.id : `soul:${first?.amount}`}` : "";
  useEffect(() => {
    setIndex(0);
    setLeaving(false);
    startedAt.current = Date.now();
  }, [batchKey]);

  useEffect(() => {
    // ⚠ 这里全程走 `visible` 而不是 `queue` —— 被关掉的那一类**不参与播放**，
    // 但它已经由上面那个 effect 负责排空，所以不会积压。
    if (!visible.length) return;
    const current = visible[index];
    if (!current) { onDrained(); return; }
    const overtime = Date.now() - startedAt.current > MAX_TOTAL_MS;
    const hold = current.kind === "soul"
      ? (overtime ? 1000 : SOUL_DWELL_MS)
      : overtime ? 1000
        : visible.length >= MANY_THRESHOLD ? ACHIEVEMENT_MANY_MS
          // 高级别的成就多停一会儿（少见、值得看）；一级的成就快到不打断手上的事。
          : TIER_DWELL_MS[tierOf(current.definition)];
    const dwell = window.setTimeout(() => setLeaving(true), hold);
    const advance = window.setTimeout(() => {
      setLeaving(false);
      if (index + 1 >= visible.length) onDrained();
      else setIndex((value) => value + 1);
    }, hold + EXIT_MS);
    return () => { window.clearTimeout(dwell); window.clearTimeout(advance); };
  }, [visible, index, onDrained]);

  /**
   * 云雾衬底的路径（必须在 `if (!current) return null` **之前**算 —— 钩子不能有条件）。
   *
   * 种子取「数额」而不是随机数：同一个数额每次长得一样，换数额就换一张脸。
   * 用 `Math.random()` 会让每次重渲染都变形，读起来像"在抖"而不是"是一团烟"。
   */
  const current = visible[index];
  const mistSeed = current && current.kind === "soul" ? 1 + (Math.abs(current.amount) % 97) : 1;
  const mistPath = useMemo(() => soulMistPath(mistSeed), [mistSeed]);
  const mistUid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!current) return null;

  const skip = () => {
    setLeaving(false);
    // 队列里还有多条时「×」= 跳过整批（逐条点六次很烦，而它本来就不阻塞）。
    if (visible.length > 1) onDrained();
    else if (index + 1 >= queue.length) onDrained();
    else setIndex((value) => value + 1);
  };

  if (current.kind === "soul") {
    /**
     * 棋魂获得提示（用户 2026-10-10：「我们的那些获得棋魂的弹窗要改一下，改成像游戏一样的，
     * 右上角一个棋魂的图案，然后右边是加多少的数字，总之很多游戏都有这样的」）。
     *
     * 形态：**图标在左、数字在右**的一枚横向胶囊（游戏里捡到东西就是这种）：
     * ```
     * ┌────────────────────────┐
     * │ 🔥  +12   战胜大师档 · 共 480 │
     * └────────────────────────┘
     * ```
     * 数字用**大一号 + 金色**，是整个提示里最重的元素 —— 用户扫一眼要看到的就是它。
     *
     * ## 2026-10-10 第八轮：去掉数字后面那个「棋魂」（用户：「目前是图标-数字-棋魂-说明，
     * 这四个，你把棋魂这个字去了呀」）
     *
     * 那枚魂火图案就是单位，紧跟数字站着 —— 再补两个字是**同一句话说两遍**，
     * 而且它把"图标 + 数字"这个整体撑散了。去掉之后剩三段：
     * **图标 → 数字 → 说明**，读起来是"🔥 +12 ← 战胜大师档 AI（共 480）"。
     *
     * ⚠ 无障碍不跟着省：`aria-label` 里仍然念全（"+12 棋魂，战胜大师档 AI，共 480"），
     * 读屏用户听到的与看得见的人理解到的完全一致。
     */
    return <div
      className={`soul-gain${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-soul-gain={current.amount}
      aria-label={`+${formatSoulAmount(current.amount)} 棋魂，${current.label}，共 ${formatSoulAmount(current.balance)}`}
    >
      {/* 云雾衬底：一条轮廓当形状也当暗底（替掉原来那圈规则椭圆柔光）。
          `preserveAspectRatio="none"` 是按标称盒生成、拉伸到实际盒：
          竖向恒定（盒高就是 40），横向随文案伸缩 —— 这样形状不依赖实测尺寸，
          jsdom 单测里 `getBoundingClientRect` 全 0 也不会画空。 */}
      <svg
        className="soul-gain-mist"
        viewBox={`0 0 ${SOUL_MIST_SIZE.W} ${SOUL_MIST_SIZE.H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter id={`sgm-f-${mistUid}`} x="-20%" y="-45%" width="140%" height="190%">
            <feTurbulence type="fractalNoise" baseFrequency={SOUL_MIST_FILTER.baseFrequency} numOctaves={SOUL_MIST_FILTER.octaves} seed={mistSeed} result="t"/>
            <feDisplacementMap in="SourceGraphic" in2={"t"} scale={SOUL_MIST_FILTER.scale} xChannelSelector="R" yChannelSelector="G"/>
            <feGaussianBlur stdDeviation={SOUL_MIST_FILTER.blur}/>
          </filter>
          <radialGradient id={`sgm-g-${mistUid}`} cx={`${SOUL_MIST_GRADIENT.cx}%`} cy={`${SOUL_MIST_GRADIENT.cy}%`} r={`${SOUL_MIST_GRADIENT.r}%`}>
            {SOUL_MIST_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={SOUL_MIST_INK} stopOpacity={stop.opacity}/>
            ))}
          </radialGradient>
        </defs>
        <path d={mistPath} fill={`url(#sgm-g-${mistUid})`} filter={`url(#sgm-f-${mistUid})`}/>
      </svg>
      <span className="soul-gain-flame" aria-hidden="true"><SoulFlame size={34}/></span>
      <span className="soul-gain-gain">
        <b data-soul-gain-amount="">+{formatSoulAmount(current.amount)}</b>
      </span>
      <span className="soul-gain-copy">
        <small>{current.label}</small>
        <small className="soul-gain-total">共 {formatSoulAmount(current.balance)}</small>
      </span>
    </div>;
  }

  const item = current.definition;
  /**
   * 级别（1–4）决定三种"排场"（用户 2026-10-10：「不同层次设计的成就弹窗」）：
   *  · **光晕与光芒的强度**（低级别几乎看不到光芒，4 级才有完整的一圈）；
   *  · **勋章上的魂火大小**（4 级最大）；
   *  · **级别标签**（"初见/小成/精进/登峰"，让用户一眼知道这条的份量）。
   * 这些全走 CSS 的 `is-tier-N` 类，不在 JS 里算样式 —— 门禁可以直接断言类名。
   */
  const tier = tierOf(item);
  const tierMeta = ACHIEVEMENT_TIER_META[tier];
  return <div
    className={`achievement-unlock is-tier-${tier}${leaving ? " is-leaving" : ""}`}
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-achievement-unlock={item.id}
    data-achievement-tier={tier}
  >
    <span className="achievement-unlock-glow" aria-hidden="true"/>
    <span className="achievement-unlock-rays" aria-hidden="true"/>
    <span className="achievement-unlock-medal" aria-hidden="true">
      {/* 成就用金调魂火：棋魂是黑白，成就是金色奖励，两者一眼分得开。 */}
      <SoulFlame size={tier >= 4 ? 24 : tier >= 3 ? 21 : 19} tone="gold"/>
    </span>
    {/* 内容压到**两行**（用户 2026-10-10：「成就弹窗的话，也要缩减一下空间，
        现在是太高了，里面的字最多两行就顶天了，得多考虑手机的大小啊」）。
        改法：级别标签 + 奖励那两枚小徽章**挪到标题行右侧**（原来另起一行，白白多占 22px + 间距）。
        于是结构变成：
          第 1 行：成就解锁 · 标题            ［级别］［+N 棋魂］
          第 2 行：说明（Clamp 两行封顶）
        高度从 91px 降到 ~62px。 */}
    <div className="achievement-unlock-copy">
      <span className="achievement-unlock-head">
        <b>成就解锁 · {item.title}</b>
        <span className="achievement-unlock-meta">
          {/* 级别标签：四级各有名字（见 ACHIEVEMENT_TIER_META），比裸数字友好 */}
          <span className="achievement-unlock-tier" data-achievement-tier-label={tier}>
            {tierMeta.label}
          </span>
          <span className="achievement-unlock-soul">
            {/* 徽章里也不写「棋魂」二字（用户 2026-10-10 第八轮：「你把棋魂这个字去了呀」）：
                魂火图案 + 数字就是完整的意思，多写两个字只是把徽章撑宽。
                读屏靠隐藏文本补全（看得见的人不需要那两个字）。
                ⚠ 用 `span.soul-sr-only` 而**不是** `i.soul-sr-only`：
                对比度门禁把 `.achievement-unlock-soul i` 当作"弹窗余额"去量，
                塞一个 1px 的元素进去会让那条探针量到一个看不见的东西。 */}
            <SoulFlame size={12}/>
            <em>+{item.soul}</em>
            <span className="soul-sr-only">棋魂</span>
          </span>
        </span>
      </span>
      <small className="achievement-unlock-text">{item.text}</small>
    </div>
    <button type="button" className="achievement-unlock-close" onClick={skip} aria-label={queue.length > 1 ? "跳过全部" : "关闭"} title={queue.length > 1 ? "跳过全部" : "关闭"}>
      <X size={14}/>
    </button>
    {queue.length > 1 && (
      <span className="achievement-unlock-count" aria-hidden="true">{index + 1}/{queue.length}</span>
    )}
  </div>;
}

/** 供说明页与结算弹窗复用的小徽章：魂火 + `+N 棋魂`。 */
export function SoulGainTag({ amount, suffix, className = "" }: { amount: number; suffix?: string; className?: string }) {
  return <span className={`soul-gain-tag ${className}`.trim()}>
    <SoulFlame size={14}/>
    <b>+{formatSoulAmount(amount)}</b>
    <small>棋魂{suffix ? ` · ${suffix}` : ""}</small>
  </span>;
}

void Sparkles;
