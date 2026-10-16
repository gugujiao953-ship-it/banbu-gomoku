import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight, Gem, MousePointerClick, SlidersHorizontal } from "lucide-react";
import { SoulFlame } from "./SoulFlame";
import {
  applyEarnTuning,
  SOUL_EARN_NOTE,
  SOUL_EARN_RULES,
  SOUL_REASON_LABELS,
  SOUL_SPEND_NOTE,
  formatSoulAmount,
  formatSoulExact,
  isSoulAmountAbbreviated,
  recentSoulEntries,
  type SoulLedger,
  type SoulSummary,
  type SoulTuning,
} from "./soul";
// 解锁商店（2026-10-10）：「能花在哪」现在列真的商品了。
import { SOUL_UNLOCK_GROUPS, SOUL_UNLOCKS, soulUnlockStats } from "./soul-unlocks";
import { soulUnlockProgress } from "./soul-shop";
import { useSoulShop } from "./use-soul-shop";

/**
 * 棋魂说明页（用户 2026-10-09：「点击图案或者数字都可以进入棋魂的说明页，
 * 这个页面有棋魂的版面，具体怎么搞你可以自己试试，然后还有棋魂的说明，
 * 以及最近收支的棋魂记录（最近 50 条，2026-10-10 提到 100 条）」）。
 *
 * ## 版面怎么排的（自上而下）
 *
 *  1. **魂火版面**：一枚大的魂火 + 余额数字。这是这一页的"招牌"——用户进来第一眼
 *     要看到"我有多少棋魂"，所以余额是整页最大的字，而且**排在第一位**
 *     （2026-10-10 调版：把原先压在最顶上那条"点一下 +1"的说明框撤了，见下）；
 *  2. **点一下 +1 的提示**：贴在魂火正下方，与手指落点同处一屏 ——
 *     说明的是"这一块能点"，所以贴着能点的那一块，比远远地放在页顶更对得上；
 *  3. **累计 / 已用 两栏**：光有余额看不出"我攒过多少"，这两个数一起才完整；
 *  4. **版面切换（说明 / 明细）**：用户点名的位置——累计两格下面，上半共用；
 *  5. **说明版面**（是什么 / 怎么攒 / 能花在哪）或 **明细版面**（最近 50 条流水）。
 *
 * ## 2026-10-10 这一轮调版改了什么、为什么
 *
 * 用户原话：「你先优化一下那个棋魂界面的布局板块，目前感觉设计的不够好，有点乱这些位置，
 * 上面那个点击棋魂+1的里面的说明去掉，放到合适的位置」。
 *
 * 量出来的"乱"是三个具体毛病（不是感觉问题）：
 *  · **四层盒子连着堆**：说明框 → 魂火卡 → 两张累计卡 → 切换按钮，中间没有呼吸，
 *    正文要滑过一整屏才看得到；
 *  · **说明框抢了第一眼**：进来看到的是一段解释文字，而不是"我有多少棋魂"；
 *  · **余额写了三遍**：大字「101 棋魂」、下面「精确 101」、再下面「累计获得 101」——
 *    余额不满一万时 `formatSoulAmount` 返回的就是原数字，所以"精确"那行是**同义重复**
 *    （`formatSoulExact` 只有在过万/过亿时才有信息量）。
 *
 * 改法：说明框从页顶**撤掉**，内容拆成两处——主句变成一个贴着魂火的小胶囊提示
 * （+1 机制本身放在那里最自然），"可无限点/会翻面"那句收进下面第二行的副标题。
 * 「精确」那行改成**只在缩写时出现**（余额 ≥1 万才显示，那时它才真的补充信息）。
 *
 * ## 排版口径
 *
 * - 金额一律走 `formatSoulAmount`（过万 w / 过亿 e），**精确值放 `title`** 且
 *   过万时额外显示一行 —— 紧凑写法是为了扫得动，但不能让用户查不到真实数字。
 * - 流水里"期初结余"（carry）单独标出来：它是账本被裁剪过的痕迹，不是"赚到的"。
 */

/** 一屏里最多列多少条流水。
 *
 * 50 → **100**（用户 2026-10-10：「那个棋魂界面的那个明细说是最近 50 个，
 * 其实现在好像无限制，你限制到最近 100 个吧，50 个感觉少了」）。
 *
 * ⚠ 用户那句"好像无限制"背后是个**真实的观感问题**：明细页签上的角标
 * （`<small>{ledger.entries.length}</small>`）显示的是**账本总条数**（上限 1000），
 * 而列表只渲染 50 条 —— "角标 1000、列表 50 条"看起来就像列表没被限制。
 * 现在列表放到 100，且标题里如实写「最近 N 条（共 M 条记录）」，两个数各自是什么就清楚了。
 */
export const SOUL_RECENT_LIMIT = 100;

export interface SoulPanelProps {
  summary: SoulSummary;
  ledger: SoulLedger;
  /**
   * 当前生效的调度项。**必传**（不给默认值）：面板要把"实际能拿多少"算出来，
   * 而算它需要调度；给个默认值会让界面在调用方漏传时显示错误的数字——
   * 那比编译不过更糟。
   */
  tuning: SoulTuning;
  /**
   * 「点一下 +1」的回调（用户 10-09 第十轮：「点一下这个棋魂（面板里面的），
   * 就会获得1个棋魂，右上角会飘出一个＋1，同时这个棋魂的样子还会切换形态……
   * 这个点击是可以无限点击的，相当于免费的无尽能源」）。
   *
   * 由 App 传进来（它持有账本与 `earn`）。**不传就不显示这个机制**——
   * 这样面板在只读场景下也不会长出一个点不动的按钮。
   */
  onTapGain?: (amount: number) => void;
  /** 每点一次的数额。默认 1（用户点名"+1"）。 */
  tapAmount?: number;
}

/** 面板内"点一下 +1"的飘字：一次点击一颗，向上飘并淡出（约 0.9s）。 */
interface TapFloat { id: number; drift: number }

/** 时间戳 → 「MM-DD HH:mm」（流水条目要密集显示，不带年份）。 */
const formatStamp = (at: number): string => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * 把当前调度里**偏离默认**的项写成几句人话（说明页上的"调度生效中"那一条）。
 *
 * 只列偏离项：默认状态下列表为空、那一块整块不渲染——说明页不该出现
 * 一堆"×1 倍率"这种废话。这样用户调过什么，回来一眼就能看到。
 */
export const describeTuning = (tuning: SoulTuning): string[] => {
  const notes: string[] = [];
  if (tuning.earnMultiplier !== 1) notes.push(`获取 ×${tuning.earnMultiplier}`);
  if (tuning.achievementMultiplier !== 1) notes.push(`成就奖励 ×${tuning.achievementMultiplier}`);
  if (tuning.earnCapPerGrant > 0) notes.push(`单次最多 ${formatSoulAmount(tuning.earnCapPerGrant)}`);
  if (tuning.dailyEarnLimit > 0) notes.push(`每日获取上限 ${formatSoulAmount(tuning.dailyEarnLimit)}`);
  if (tuning.disabledReasons.length) {
    notes.push(`已停发：${tuning.disabledReasons.map((reason) => SOUL_REASON_LABELS[reason]).join("、")}`);
  }
  if (tuning.lossAmount > 0) notes.push(`负局 +${tuning.lossAmount}`);
  if (tuning.drawAmount > 0) notes.push(`和棋 +${tuning.drawAmount}`);
  if (tuning.tapAmount !== 1) notes.push(`连点 +${tuning.tapAmount}`);
  if (!tuning.tapCountsAsEarned) notes.push("连点不计入累计");
  if (tuning.spendMultiplier !== 1) notes.push(`消费 ×${tuning.spendMultiplier}`);
  if (tuning.minimumSpend !== 1) notes.push(`消费最低 ${tuning.minimumSpend}`);
  if (tuning.dailySpendLimit > 0) notes.push(`每日消费上限 ${formatSoulAmount(tuning.dailySpendLimit)}`);
  return notes;
};

export function SoulPanel({ summary, ledger, tuning, onTapGain, tapAmount = 1 }: SoulPanelProps) {
  const entries = recentSoulEntries(ledger, SOUL_RECENT_LIMIT);
  /**
   * 当前调度里"非默认"的项（说明页上要用一句人话说出来）。
   *
   * 调度项在界面上没有自己的设置页（它藏在工坊里），所以一旦有人调过，
   * **说明页必须留痕** —— 否则用户看到"赢一局 +80"会以为哪里坏了。
   */
  const dialNotes = describeTuning(tuning);
  /**
   * 商店状态（「能花在哪」那一块要显示"已解锁几项"）。
   *
   * 用 `useSoulShop` 而不是直接读盘：解锁状态是**会变的**（用户可能在另一个
   * sheet 里刚买完就切过来看）。订阅了才会跟着更新。
   */
  const shop = useSoulShop();
  const shopStats = soulUnlockStats();
  const unlockProgress = soulUnlockProgress(shop.unlocks);
  /**
   * 余额是不是**被缩写**了（过万 → `12w`、过亿 → `1.2e`）。
   * 只有缩写时下面才多显示一行「精确 …」—— 判据本身在 `soul.ts` 里（可单测）。
   */
  const abbreviated = isSoulAmountAbbreviated(summary.balance);

  /**
   * 「点一下 +1」的本地状态：形态（normal / burnt 来回翻）+ 飘字队列。
   *
   * **这两个都放本地、不进账本**：形态是纯视觉（不落盘，重开面板从 normal 起）；
   * 飘字是一次性的动效（0.9s 自己清掉）。
   * 连点十几下也不会积压——见 clearTimer 里那条兜底清理。
   */
  const [flameState, setFlameState] = useState<"normal" | "burnt">("normal");
  /**
   * 下半部分的两个版面（用户 10-09 第十二轮）。
   * `guide` = 说明（是什么 / 怎么攒 / 能花在哪）；`detail` = 明细（最近收支流水）。
   * **只放本地、不落盘**：它是"当下想看什么"，不是设置；重开面板从说明起也符合直觉。
   */
  const [tab, setTab] = useState<"guide" | "detail">("guide");
  const [floats, setFloats] = useState<TapFloat[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  // 卸载时清掉所有飘字的定时器，避免"面板关了定时器还在跑"。
  useEffect(() => () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const handleTap = useCallback(() => {
    onTapGain?.(tapAmount);
    // 翻面：每次都切，于是"点一下"既有数字反馈（+1 飘字）又有形态反馈。
    setFlameState((current) => (current === "normal" ? "burnt" : "normal"));
    const id = (seq.current += 1);
    // drift 按序号**轮流左右偏**（不是随机数）：连点时飘字不会叠成一条直线，
    // 而且序列固定 ⇒ 每次连点的观感一致、也便于门禁断言。
    // （这里刻意不用 Math.random：这纯粹是视觉扰动，用可预测的交替就够了。）
    const drift = [0, -20, 20, -12, 12][id % 5];
    setFloats((current) => [...current, { id, drift }]);
    const timer = window.setTimeout(() => {
      setFloats((current) => current.filter((item) => item.id !== id));
    }, 900);
    timers.current.push(timer);
  }, [onTapGain, tapAmount]);

  return (
    <div className="soul-panel" data-soul-panel="">
      {/* ── 1. 魂火版面（余额是整页最大的字，也是用户进来第一眼要看的东西）──
          2026-10-10 调版：原先排在最顶上那个"点一下 +1"的说明框撤了，
          主句变成下面这枚贴着魂火的胶囊提示（见 .soul-hero-tap）。 */}
      <section className="soul-hero" aria-label="棋魂余额">
        <button
          type="button"
          className="soul-hero-flame"
          onClick={onTapGain ? handleTap : undefined}
          disabled={!onTapGain}
          data-soul-tap={onTapGain ? "on" : undefined}
          aria-label={onTapGain ? `点一下获得 ${tapAmount} 枚棋魂，当前 ${formatSoulExact(summary.balance)}` : undefined}
          title={onTapGain ? `点一下 +${tapAmount} 棋魂（可无限点）` : undefined}
        >
          <SoulFlame size={92} state={flameState}/>
          {/* 飘字层：一次点击一颗 "+1"，向上飘并淡出。 */}
          {floats.map((float) => (
            <span
              key={float.id}
              className="soul-tap-float"
              style={{ "--tap-drift": `${float.drift}px` } as CSSProperties}
              aria-hidden="true"
            >
              +{tapAmount}
            </span>
          ))}
        </button>
        <div className="soul-hero-figure">
          <b data-soul-hero-balance="">{formatSoulAmount(summary.balance)}</b>
          <span>棋魂</span>
        </div>
        {/* 「精确」只在**缩写时**才有信息量：余额不满一万时 formatSoulAmount 返回原数字，
            再写一行「精确 101」就是把同一个数说了两遍（2026-10-10 量出来的第三处乱）。
            过万/过亿时紧凑写法才有损，那时它才是补充。 */}
        {abbreviated && <p className="soul-hero-exact" title="精确数值">
          精确 <b>{formatSoulExact(summary.balance)}</b>
        </p>}
        {/* 「点一下 +1」的说明（用户 2026-10-10：「放到合适的位置」，随后
            又：「可无限点 · 每点一下换一副模样 这个文本去掉，只留下前面那句话」）。
            所以这里只有主句一句 —— 副标题在 420/360px 上要和主句抢同一行、
            在 320px 上还要拆两行把胶囊撑高，而它说的（可无限点、会翻面）
            用户点一下就看得到，不值得一直占着一行。 */}
        {onTapGain && (
          <p className="soul-hero-tap" data-soul-tap-hint="">
            <MousePointerClick size={13} aria-hidden="true"/>
            <b>点魂火 +{tapAmount}</b>
          </p>
        )}
      </section>

      {/* ── 2. 累计 / 已用 ──────────────────────────────────────── */}
      <section className="soul-totals" aria-label="棋魂收支合计">
        <div className="soul-total">
          <span className="soul-total-icon up" aria-hidden="true"><ArrowUpRight size={14}/></span>
          <b data-soul-earned="">{formatSoulAmount(summary.earned)}</b>
          <small>累计获得</small>
        </div>
        <div className="soul-total">
          <span className="soul-total-icon down" aria-hidden="true"><ArrowDownRight size={14}/></span>
          <b>{formatSoulAmount(summary.spent)}</b>
          <small>累计消耗</small>
        </div>
      </section>

      {/* ── 3. 版面切换（用户 10-09 第十二轮：「搞成两个版面，一个是说明，一个是明细……
          这两个版面的切换按钮放在累计消耗，累计获得的下面，就是上面部分是共用，
          下面部分才分开放」）。
          放在累计卡**下面**是用户点名的位置：上面的魂火版面与累计数字**两个版面共用**，
          从这里往下才分开。 */}
      <div className="soul-tabs" role="tablist" aria-label="棋魂面板版面">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "guide"}
          aria-controls="soul-pane-guide"
          className={tab === "guide" ? "active" : ""}
          onClick={() => setTab("guide")}
          data-soul-tab="guide"
        >说明</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "detail"}
          aria-controls="soul-pane-detail"
          className={tab === "detail" ? "active" : ""}
          onClick={() => setTab("detail")}
          data-soul-tab="detail"
        >明细<small>{ledger.entries.length}</small></button>
      </div>

      {/* ── 4. 说明版面（棋魂是什么 / 怎么攒 / 能花在哪） ─────────── */}
      {tab === "guide" && <div id="soul-pane-guide" role="tabpanel" aria-label="说明" data-soul-pane="guide">
        <section className="soul-explain" aria-label="棋魂是什么">
          <h3>棋魂是什么</h3>
          {/* 首句是**定性**（用户 2026-10-10 要求"前面加一句：是增加趣味性与可玩度而出的积分系统，非氪金"；
              2026-10-12 用户亲自给定这句原话，逐字照抄，别自作聪明改写）。
              第二句只讲两件事：哪儿能攒、以及"它记的是做了多少不是有多强"。
              ⚠ 能攒的来源**必须与 `SOUL_EARN_RULES` 对齐**：复盘、导出备份在 10-11 已经从表里删掉、
              结算点也断开了（`soul-economy.ts` 顶部记着这段历史），上一版却还写着"复盘、打谱批注都会攒"
              —— 说明页承诺了不给，是最伤人的一类不一致。 */}
          <p className="soul-explain-lead">
            棋魂是一套<strong>增加趣味与可玩度</strong>的积分货币系统，可以在软件里面通过各种途径获取。
          </p>
          <p>
            赢棋、做题、解 VCF 挑战、每日一题、识谱导入、解锁成就都会攒。
            它记的是<strong>你做了多少</strong>，不是<strong>你有多强</strong>（强弱看等级分）。
          </p>
        </section>

        <section className="soul-earn" aria-label="怎么获得棋魂">
          <h3>怎么攒</h3>
          <ul>
            {SOUL_EARN_RULES.map((rule) => {
              // 显示**实际能拿到的数额**（过一遍当前调度），而不是表上的原价。
              // ⚠ 每日额度那一项**摘掉再看**：否则一天刷满之后整列都变成 +0，
              // 看起来像"这个来源没了"。额度是"今天用完"而不是"定价变了"，
              // 所以它单独写在下面那条调度摘要里（口径更准，也不吓人）。
              const shown = rule.amount > 0
                ? applyEarnTuning(ledger, rule.amount, rule.reason, { ...tuning, dailyEarnLimit: 0 })
                : 0;
              const changed = shown !== rule.amount;
              return <li key={`${rule.reason}-${rule.amount}`} data-soul-earn={rule.reason}>
                <span className="soul-earn-copy">
                  <b>{rule.title}</b>
                  <small>{rule.text}</small>
                </span>
                <em className={`soul-earn-amount${changed ? " tuned" : ""}${rule.amount > 0 && shown === 0 ? " off" : ""}`}>
                  {rule.amount === 0
                    ? "按成就"
                    : shown === 0
                      ? "已停发"
                      : <>
                          {changed && <s>{rule.amount}</s>}
                          +{shown}
                        </>}
                </em>
              </li>;
            })}
          </ul>
          <p className="soul-earn-note">{SOUL_EARN_NOTE}</p>
          {/* 调度摘要：只在**有偏离默认的项**时出现（默认状态下不占地方）。 */}
          {dialNotes.length > 0 && <p className="soul-dial-note" data-soul-dials="">
            <span aria-hidden="true"><SlidersHorizontal size={13}/></span>
            <span><b>当前调度</b>{dialNotes.join(" · ")}</span>
          </p>}
        </section>

        <section className="soul-spend" aria-label="棋魂的用途">
          <h3>
            能花在哪
            <small>共 {shopStats.count} 项 · 最便宜 {shopStats.cheapest} 起</small>
          </h3>
          {/* 2026-10-10 起这里不再是"暂未开放"：解锁商店上线了（用户：「外观那一块，
              除了默认棋盘默认棋子以外，都要棋魂解锁，主题也是」）。
              条目有 76 项，**按类分组**列 —— 平铺会滚很久（用户也不喜欢臃肿）。
              每一类只显示"有多少项、多少钱起"，具体在设置页里挑。 */}
          <ul className="soul-shop-groups">
            {SOUL_UNLOCK_GROUPS.map((group) => {
              const items = SOUL_UNLOCKS.filter((item) => item.kind === group.kind);
              if (!items.length) return null;
              const cheapest = items.reduce((min, item) => Math.min(min, item.cost), Number.POSITIVE_INFINITY);
              return <li key={group.kind} data-soul-shop-group={group.kind}>
                <span className="soul-shop-copy">
                  <b>{group.title}<em>{items.length}</em></b>
                  <small>{group.summary}</small>
                </span>
                <em className="soul-shop-price">{formatSoulAmount(cheapest)} 起</em>
              </li>;
            })}
          </ul>
          <p className="soul-spend-note">{SOUL_SPEND_NOTE}</p>
          {/* 已解锁进度：让人有"收集"的感觉（有终点的东西才有人去收） */}
          <p className="soul-shop-progress" data-soul-shop-progress="">
            <span aria-hidden="true"><Gem size={13}/></span>
            <span>已解锁 <b>{unlockProgress.done}</b> / {unlockProgress.total} 项（{unlockProgress.percent}%）</span>
          </p>
        </section>
      </div>}

      {/* ── 5. 明细版面（最近收支流水） ──────────────────────────── */}
      {/* ⚠ data-soul-history 挂在 section 上而不是 ul 上：空账本时渲染的是
          「还没有记录」那段文字，如果钩子挂在 ul 上，探针在空状态下就找不到这块
          （门禁实测踩过：要么改成"没记录也算有列表"，要么钩子挂外层——选后者）。 */}
      {tab === "detail" && <div id="soul-pane-detail" role="tabpanel" aria-label="明细">
        <section className="soul-history" aria-label="最近收支" data-soul-history="">
          <h3>
            最近收支
            <small>最近 {SOUL_RECENT_LIMIT} 条（共 {ledger.entries.length} 条记录）</small>
          </h3>
          {entries.length === 0
            ? <p className="soul-history-empty">还没有棋魂记录。下完一局、做一道题就会出现在这里。</p>
            : <ul data-soul-history-list="">
              {entries.map((entry) => {
                const isCarry = entry.reason === "carry";
                return <li key={entry.id} className={entry.amount > 0 ? "in" : "out"}>
                  <span className="soul-entry-icon" aria-hidden="true">
                    {entry.amount > 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>}
                  </span>
                  <span className="soul-entry-copy">
                    <b>{entry.detail}</b>
                    <small>
                      {formatStamp(entry.at)} · {isCarry ? "账本折叠" : SOUL_REASON_LABELS[entry.reason]}
                    </small>
                  </span>
                  <em className="soul-entry-amount" title={`精确 ${formatSoulExact(Math.abs(entry.amount))}`}>
                    {entry.amount > 0 ? "+" : "−"}{formatSoulAmount(Math.abs(entry.amount))}
                  </em>
                </li>;
              })}
            </ul>}
        </section>
      </div>}
    </div>
  );
}
