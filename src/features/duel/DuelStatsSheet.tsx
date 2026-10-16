import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { formatClockMs } from "../clock/duel-clock";
import { ENGINE_LABELS, OUTCOME_LABELS, RATING_START, TIER_EXPECTED_WIN, TIER_GAP, formatWinRate, summarizeDuelHistory, type DuelHistoryEntry, type DuelSummary, type RatingPoint } from "./duel-history";
import { loadState as loadVcfChallengeState, levelOf, levelProgress, levelSpanOf, type VcfChallengeState } from "../vcf-challenge/rating";
// 清空战绩要花棋魂（2026-10-11）：与设置页那件「重置人机等级分」共用同一个动作项与扣费实现。
import { soulUnlockById } from "../progress/soul-unlocks";
import { useSoulShop } from "../progress/use-soul-shop";
// 本地日期键：共享一处（2026-10-11 收敛，见 local-date.ts 的说明）。
import { localDateKey } from "../../local-date";
import "./duel-stats.css";

/**
 * 对弈右上角那枚小按钮点开的**战绩与等级分**面板（用户 10-02）。
 *
 * 两个标签：「人机对弈」与「VCF 挑战」都接了真账——各自从本机账本现算，不放任何假数字。
 *
 * 面板是**固定骨架**（用户 10-02 第二轮：「给我一个固定的面板，现在没有对弈就是空白，
 * 我不是要这种的」）：一局没打时也照样是"等级分卡 + 六格概览 + 分档表 + 最近对局 + 口径说明"，
 * 缺的那格显示 0 或「—」并说明为什么是 0，而不是整块塌成一张空态卡。
 *
 * 所有数字都从 `banbu-duel-history-v1` 现算（`summarizeDuelHistory`），面板不持有统计状态。
 */

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)}`;
const dayLabel = (at: number) => new Date(at).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** 等级分折线。纵轴刻意**不**从 0 起（分数是相对量），上下各留 30 分余量，
 *  免得 ±8 分的抖动被拉成满屏过山车——刻度放大本身就是假信号。
 *  一局没打时仍然画：一条起始基线 + 同一套刻度，好让这块的位置和高度永远不变。 */
function RatingCurve({ track }: { track: RatingPoint[] }) {
  const values = [RATING_START, ...track.map((point) => point.rating)];
  const low = Math.min(...values) - 30;
  const high = Math.max(...values) + 30;
  const span = Math.max(60, high - low);
  const mid = (low + high) / 2;
  const y = (value: number) => 100 - ((value - (mid - span / 2)) / span) * 100;
  const x = (index: number) => (index / Math.max(1, values.length - 1)) * 100;
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return <div className="duel-stats-curve">
    <div className="ai-curve-axis" aria-hidden="true">
      <span>{Math.round(mid + span / 2)}</span><span>{Math.round(mid)}</span><span>{Math.round(mid - span / 2)}</span>
    </div>
    <div className="ai-curve-plot duel-stats-curve-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
        aria-label={track.length
          ? `等级分从 ${RATING_START} 起，共 ${track.length} 局，最高 ${Math.max(...values)}、最低 ${Math.min(...values)}，当前 ${values[values.length - 1]}`
          : `等级分曲线：还没有对局，刻度停在起始的 ${RATING_START} 分`}>
        <line x1="0" y1={y(RATING_START)} x2="100" y2={y(RATING_START)} className="duel-stats-baseline" aria-hidden="true"/>
        <polyline points={line} className="duel-stats-curve-line" aria-hidden="true"/>
        {track.map((point, index) => <circle key={index} cx={x(index + 1)} cy={y(point.rating)} r="2" className="duel-stats-curve-dot" aria-hidden="true"><title>{`${signed(point.delta)} 分 → ${point.rating}`}</title></circle>)}
      </svg>
      {!track.length && <span className="duel-stats-curve-hint">打完第一局就有曲线</span>}
    </div>
  </div>;
}

const Cell = ({ label, value, hint }: { label: string; value: string; hint?: string }) =>
  <div className="duel-stats-cell"><small>{label}</small><b>{value}</b>{hint && <span>{hint}</span>}</div>;

const anchorNote = `初级 AI = ${RATING_START} 分（新档案也从这一分起，也就是先假定你跟最弱档一样强），往上每高一档 +${TIER_GAP} 分（≈ 对低一档 ${Math.round(TIER_EXPECTED_WIN * 100)}% 期望胜率）`;

/** 人机对弈那一页。0 局时也走同一条渲染路径：分数=起始分、六格是 0/「—」、表体一行说明。 */
function AiStats({ summary, entries, onClear, clearCost, shopBalance }: {
  summary: DuelSummary; entries: DuelHistoryEntry[]; onClear: () => void;
  /** 清空战绩的价钱（= 商店里「重置人机等级分」的 `cost`，由调用方从商品表取）。 */
  clearCost: number;
  /** 当前棋魂余额（让用户点之前就知道够不够）。 */
  shopBalance: number;
}) {
  const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 10);
  const streakText = summary.streak.type === "none" ? "—" : `${summary.streak.count} 连${OUTCOME_LABELS[summary.streak.type]}`;
  const none = summary.games === 0;
  return <>
    <section className="duel-stats-rating" aria-label="等级分">
      <div className="duel-stats-rating-head">
        <b className="duel-stats-score" data-duel-stats-score>{summary.rating.current}</b>
        <span className="duel-stats-rating-meta">
          <em>{summary.rating.band}</em>
          <small>{none ? "还没开始定级（0 局）" : summary.rating.provisional ? `定级中（${summary.rating.games} 局）· 约 ±${summary.rating.uncertainty}` : `${summary.rating.games} 局 · 约 ±${summary.rating.uncertainty}`}</small>
          <small>近 10 局 {signed(summary.rating.recentDelta)} · 距起始 {signed(summary.rating.delta)}</small>
        </span>
      </div>
      <RatingCurve track={summary.rating.track}/>
    </section>

    <div className="duel-stats-grid" role="group" aria-label="战绩总览">
      <Cell label="场次" value={String(summary.games)} hint={summary.lastAt ? `最近 ${dayLabel(summary.lastAt)}` : "打完一局才计一场"}/>
      <Cell label="胜 / 负 / 和" value={`${summary.won} / ${summary.lost} / ${summary.draw}`}/>
      <Cell label="胜率（和算半分）" value={formatWinRate(summary.winRate)} hint={none ? "没有对局时不是 0%" : `${summary.won + summary.draw / 2} / ${summary.games}`}/>
      <Cell label="当前连串" value={streakText} hint={`最长连赢 ${summary.bestWinStreak} · 最长连负 ${summary.worstLossStreak}`}/>
      <Cell label="平均手数" value={summary.avgMoves === undefined ? "—" : `${summary.avgMoves} 手`} hint={`累计 ${summary.totalMoves} 手`}/>
      <Cell label="我方累计用时" value={formatClockMs(summary.totalHumanMs)} hint={none ? "只计已结算的局" : `平均每局 ${formatClockMs(Math.round(summary.totalHumanMs / summary.games))}`}/>
    </div>

    <h3>按难度与引擎</h3>
    <table className="duel-stats-table">
      <thead><tr><th>难度</th><th>引擎</th><th>场</th><th>胜</th><th>负</th><th>和</th><th>胜率</th><th>对手分</th></tr></thead>
      <tbody>
        {summary.tiers.length ? summary.tiers.map((row) => <tr key={row.key}>
          <td>{row.strength}</td><td>{ENGINE_LABELS[row.engine]}</td><td>{row.games}</td><td>{row.won}</td><td>{row.lost}</td><td>{row.draw}</td>
          <td>{formatWinRate(row.winRate)}</td><td>{row.opponent}</td>
        </tr>) : <tr className="duel-stats-blank"><td colSpan={8}>还没有已结算的对局——打完一局（你赢、你输、判和都算）这里就出现第一行。</td></tr>}
      </tbody>
    </table>
    {summary.engines.length > 1 && <p className="section-note">同一难度换引擎，实际棋力是不一样的（KataGo 明显强于内置轻量网络），所以这张表按「难度 × 引擎」拆开列，不合并成一个胜率。</p>}

    <h3>最近对局</h3>
    <ul className="duel-stats-recent">
      {recent.length ? recent.map((entry) => <li key={entry.id} data-duel-stats-row={entry.outcome}>
        <b className={`duel-stats-result ${entry.outcome}`}>{OUTCOME_LABELS[entry.outcome]}</b>
        <span className="duel-stats-when">{dayLabel(entry.at)}</span>
        <span className="duel-stats-vs">{entry.strength} · {ENGINE_LABELS[entry.engine]}{entry.forbidden ? " · 有禁手" : " · 无禁手"}</span>
        <span className="duel-stats-detail">{entry.moves} 手 · {formatClockMs(entry.humanElapsedMs)}{entry.timeLimitMs ? ` / 时限 ${Math.round(entry.timeLimitMs / 60000)} 分` : " / 不限时"}</span>
        {entry.reason && <small className="duel-stats-reason">{entry.reason}</small>}
      </li>) : <li className="duel-stats-blank">还没有对局记录。</li>}
    </ul>

    <h3>这些数是怎么来的</h3>
    <p className="mark-studio-note">
      每打完一局（分出胜负或判和）就在本机追加一条记录，面板上的所有数字都从这份账本现算。
      等级分用 Elo：前 20 局 K=40、之后 K=24，胜 1 / 和 0.5 / 负 0；对手分直接锚在 AI 难度档上
      （{anchorNote}，「自由」档按你设的思考时间在锚点间插值）。
      所以「{summary.rating.current} 分」的可读含义是「你大致落在 {summary.rating.band}」。
      两点如实说明：<b>①</b> 这个间距是<b>假设不是实测</b>——我们只测过引擎解题的正确率，
      没测过档与档互搏的胜负，将来跑一轮互搏基准就把这个数换成实测值（分数从每局结果现推，历史不用迁移）；
      <b>②</b> 这是本机内部尺度，<b>不与中国棋院等级分、弈客、五林等任何外部等级分可比</b>。
    </p>
    <button type="button" className="secondary-button danger-button" onClick={onClear} disabled={none} data-duel-clear>
      {none ? "清空本机战绩（还没有记录）" : `清空本机战绩（${summary.games} 局）`}
    </button>
    {/* ⚠ 这里必须写明**要花棋魂**：同一个动作在「设置 → 棋魂解锁」里叫「重置人机等级分」，
        是明码标价的一次性商品。2026-10-11 之前这个按钮是**免费**的，
        于是商店里那件商品形同虚设（用户报的就是这类旁路）。
        价格从商品表现取，不在这里抄数字。 */}
    {!none && <small className="duel-stats-clear-note" data-duel-clear-note>
      清空会一并把等级分放回起点 · 需 {clearCost} 棋魂（当前 {shopBalance}）
    </small>}
  </>;
}

/** VCF 挑战那一页：真账。数据来自挑战页自己落盘的账本（vcfch-state-v1）。 */
function VcfStats() {
  const vcf = useMemo(() => loadVcfChallengeState(), []);
  const history = vcf.history;
  const total = vcf.solved + vcf.failed;
  const winRate = total > 0 ? `${Math.round((vcf.solved / total) * 100)}%` : "—";
  const avgSec = history.length ? Math.round(history.reduce((sum, h) => sum + h.seconds, 0) / history.length) : null;
  const day = (() => {
    // 日期键走共享的 `localDateKey`（2026-10-11 收敛，原来是就地手写的）。
    const key = localDateKey();
    return vcf.daily[key] ?? { solved: 0, failed: 0 };
  })();
  const bands: Array<[string, number, number]> = [["4–6 手", 4, 6], ["7–10 手", 7, 10], ["11–15 手", 11, 15], ["16–24 手", 16, 24], ["25 手以上", 25, 99]];
  const rows = bands.map(([label, lo, hi]) => {
    const items = history.filter((h) => h.depth >= lo && h.depth <= hi);
    const win = items.filter((h) => h.win).length;
    return {
      label, n: items.length, win, lose: items.length - win,
      rate: items.length ? `${Math.round((win / items.length) * 100)}%` : "—",
      sec: items.length ? Math.round(items.reduce((s, h) => s + h.seconds, 0) / items.length) : null,
    };
  });
  const deepShare = history.length ? `${Math.round((history.filter((h) => h.depth >= 11).length / history.length) * 100)}%` : "—";
  const hardest = history.length ? Math.max(...history.map((h) => h.depth)) : null;
  const recentFails = history.slice(0, 20).filter((h) => !h.win).length;

  return <>
    <section className="duel-stats-rating" aria-label="VCF 等级分">
      <div className="duel-stats-rating-head">
        <b className={`duel-stats-score${total ? "" : " pending"}`} data-duel-stats-score>{total ? vcf.rating : "—"}</b>
        <span className="duel-stats-rating-meta">
          <em>等级分（本机内部尺度）</em>
          <small>等级 {levelOf(vcf.rating)}（本级共 {levelSpanOf(levelOf(vcf.rating))} 分，已走 {Math.round(levelProgress(vcf.rating) * 100)}%）</small>
          <small>今日 {day.solved} 对 / {day.failed} 错 · 连胜 {vcf.streak}（最高 {vcf.bestStreak}）</small>
          <small>等级每级 300 分（最高 {levelOf(9999)} 级）：答对越难的题涨得越多</small>
        </span>
      </div>
      <VcfRatingCurve history={history} current={vcf.rating}/>
      <p className="section-note duel-stats-curve-empty">
        {history.length ? `已记 ${history.length} 道（最多留 ${VCF_HISTORY_LIMIT} 道，超出自动滚出）。` : "还没有做题记录——去「对弈 → VCF 挑战」打几道，这里就按记录现算。"}
      </p>
    </section>

    <div className="duel-stats-grid" role="group" aria-label="VCF 概览">
      <Cell label="做题数" value={`${total}`} hint={total ? `${vcf.solved} 对 / ${vcf.failed} 错` : "还没做过"}/>
      <Cell label="正确率" value={winRate} hint="按已结算的题算"/>
      <Cell label="平均用时" value={avgSec === null ? "—" : `${avgSec}s`} hint="时限随等级（手数）伸缩：1–3 级 30/35/40s 起，13 级后每 2 级加一次，最高级封顶 120/210/300s"/>
      <Cell label="当前连对" value={`${vcf.streak}`} hint={`最高 ${vcf.bestStreak}`}/>
      <Cell label="11 手以上占比" value={deepShare} hint={hardest ? `做过最深的 ${hardest} 手` : "—"}/>
      <Cell label="最近 20 题失误" value={`${recentFails}`} hint="含超时与认输"/>
    </div>

    <h3>按难度（手数）</h3>
    <table className="duel-stats-table">
      <thead><tr><th>难度</th><th>题数</th><th>对</th><th>错</th><th>正确率</th><th>平均用时</th></tr></thead>
      <tbody>
        {rows.some((r) => r.n > 0)
          ? rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td><td>{r.n || "—"}</td><td>{r.win || "—"}</td><td>{r.lose || "—"}</td>
              <td>{r.n ? r.rate : "—"}</td><td>{r.sec === null ? "—" : `${r.sec}s`}</td>
            </tr>))
          : <tr className="duel-stats-blank"><td colSpan={6}>还没有记录：打完第一道题，这张表就有数了。</td></tr>}
      </tbody>
    </table>

    <h3>这些数是怎么来的</h3>
    <p className="mark-studio-note">
      每做完一道 VCF 挑战题（解出 / 超时判负 / 认输）就在本机追加一条记录，最多留 {VCF_HISTORY_LIMIT} 条，
      上面所有数字都从这份账本现算。加减分按<b>等级差表</b>算：<b>题目等级就是手数</b>（1 级 1 手、13 级 13 手，
      再往上由生成器即时出题），题目等级 − 你的等级 = 差值查表：
      同等级题答对 +10、答错 −10；答对按<b>「10 + 4×越的级数」</b>一路涨（高一级 +14、高十级 +50），
      式子顶在 <b>+150</b>，再乘难度档 ⇒ 默认档单次最高 <b>+300</b>；答错按<b>「10 + 3×低的级数」</b>越输弱题扣得越狠
      （低一级 −13、低十级 −40），最多 <b>−100</b>，
      <b>扣分不乘难度倍数</b>、下限为 0。状态行上写的是「N 手 · 同级／高 1 级／低 1 级」——那个「级」与下面这张表
      <b>同一套算法</b>，看到的就是结算用的（旧版那里写「≈X 分」，是一条与等级分不同尺度的题分曲线，
      容易误读成「这题比我高一级」，2026-10-12 已整条删除）。
      计时难度三档（默认 ×2 / 充裕 ×1 / 休闲 ×0.5），时限随等级伸缩（1–3 级 30 / 35 / 40 秒起，
      在 4 / 6 / 9 / 11 / 12 / 13 级各加一次 +5 / +10 / +20 秒，<b>13 级后每 2 级加一次</b>，
      最高级收在三档上限 <b>120 / 210 / 300 秒</b>——不够在这一档补满、超了也不越过）：
      挑快的档加分翻倍。<b>每一级 300 分</b>（加分式子顶在 150，默认档 ×2 ⇒ 单次最多 +300＝正好一级宽；扣分最多 −100；一次胜负不会越过一级），
      等级分限制在 <b>0–9999</b>（0 分再输不扣）；匹配最高锚在 <b>9900 = 34 级</b>，挑战最多排到 35 手，生成器本体可继续生成更深题，
      到 9999 之后赢不再加分、输照常扣。
      如实说明两点：<b>①</b> 这是<b>本机内部尺度</b>，不与中国棋院等级分、弈客、五林等任何外部等级分可比；
      <b>②</b> 与人机对弈的等级分<b>分开记录、不合并</b>——两者量纲不同，硬凑成一个数没有意义。
    </p>
  </>;
}

const VCF_HISTORY_LIMIT = 200;

/** VCF 等级分浮动图（与人机那页同一套骨架/类名）：由最近一条记录往回推算每次结算后的分数。
 *  history 最新在前；累减 delta 得到"记录之前的分"，也就是曲线起点。 */
function VcfRatingCurve({ history, current }: { history: VcfChallengeState["history"]; current: number }) {
  const points: number[] = [];   // 旧→新：每条结算之后的分数
  let cursor = current;
  for (const h of history) {
    points.unshift(cursor);
    cursor -= h.delta;
  }
  const startValue = cursor;
  const values = [startValue, ...points];
  const low = Math.min(...values) - 40;
  const high = Math.max(...values) + 40;
  const span = Math.max(80, high - low);
  const mid = (low + high) / 2;
  const y = (value: number) => 100 - ((value - (mid - span / 2)) / span) * 100;
  const x = (index: number) => (index / Math.max(1, values.length - 1)) * 100;
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return <div className="duel-stats-curve">
    <div className="ai-curve-axis" aria-hidden="true">
      <span>{Math.round(mid + span / 2)}</span><span>{Math.round(mid)}</span><span>{Math.round(mid - span / 2)}</span>
    </div>
    <div className="ai-curve-plot duel-stats-curve-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
        aria-label={points.length
          ? `VCF 等级分从 ${startValue} 起，共 ${points.length} 题，最高 ${Math.max(...values)}、最低 ${Math.min(...values)}，当前 ${current}`
          : `VCF 等级分曲线：还没有做题，刻度停在起点 ${startValue} 分`}>
        <line x1="0" y1={y(startValue)} x2="100" y2={y(startValue)} className="duel-stats-baseline" aria-hidden="true"/>
        <polyline points={line} className="duel-stats-curve-line" aria-hidden="true"/>
        {points.map((value, index) => {
          const h = history[points.length - 1 - index];
          return <circle key={index} cx={x(index + 1)} cy={y(value)} r="2" className="duel-stats-curve-dot" aria-hidden="true">
            <title>{`${h.depth} 手 ${h.win ? "胜" : "负"} · ${signed(h.delta)} → ${value}`}</title>
          </circle>;
        })}
      </svg>
      {!points.length && <span className="duel-stats-curve-hint">做完第一道题就有曲线</span>}
    </div>
  </div>;
}

/**
 * 战绩面板（对弈页右上角那枚小按钮）。
 *
 * ## 清空战绩**要花钱**（2026-10-11 修的一条旁路）
 *
 * 这里原来有个免费的「清空本机战绩」按钮，而「设置 → 棋魂解锁」里
 * 同一件事是明码标价的一次性商品（`action-reset-duel-rating`，300 魂）。
 * 两条路一条免费 ⇒ 商店那件商品形同虚设（用户报的正是这类"其他通道可以免费"）。
 *
 * 现在：**钱由本组件收**（它离按钮最近，能就地显示失败原因与价格），
 * 扣费走 `useSoulShop().spend`（与设置页共用同一个动作项与同一份定价）。
 * 清空本身仍然由 App 执行（`onClear`）—— 因为战绩是 App 持有的 state，
 * 而且 `duelHistory` 变了 App 才能重新渲染等级分曲线。
 *
 * ⚠ 顺序：**先扣钱、成功才清**（`spend` 内部就是这么做的：扣款成功才调 `run`）。
 * 反过来会在余额不足时把记录清了却收不到钱。
 * 用户取消确认框时**不扣钱**（确认框在 `onClear` 里，所以那条路先问、后扣）。
 */
export function DuelStatsSheet({ entries, onClear }: { entries: DuelHistoryEntry[]; onClear: () => void }) {
  const [tab, setTab] = useState<"ai" | "vcf">("ai");
  const summary = summarizeDuelHistory(entries);
  const vcfTotal = useMemo(() => { const s = loadVcfChallengeState(); return s.solved + s.failed; }, []);
  const shop = useSoulShop();
  /** 清空战绩的商品（= 设置页那件「重置人机等级分」）与它的价钱。
   *  从 `SOUL_UNLOCKS` 按 id 取，不另抄价格（改价只有一处）。 */
  const clearItem = soulUnlockById("action-reset-duel-rating");
  const clearCost = clearItem?.cost ?? 0;
  /**
   * 先弹确认（用户原来的行为：误触清空是不可逆的），**确认了才扣钱、扣成功才清**。
   *
   * 确认框里把这笔钱说清楚 —— 它已经不是一个纯破坏性按钮了，是一次**消费**。
   */
  const requestClear = () => {
    if (!clearItem) return;   // 取不到商品就不放行（fail closed，绝不能免费清）
    if (!window.confirm(`清空本机人机战绩？会用掉 ${clearCost} 棋魂（现有 ${shop.balance}）。\n\n这会删掉 ${summary.games} 局记录，等级分随之回到起点；棋谱库里的棋谱不受影响。`)) return;
    const failure = shop.spend(clearItem, onClear, "清空本机人机战绩");
    if (failure) window.alert(failure);
  };
  return <div className="sheet-body duel-stats-sheet">
    <div className="duel-stats-tabs" role="tablist" aria-label="战绩分类">
      <button type="button" role="tab" aria-selected={tab === "ai"} data-duel-stats-tab="ai" className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
        <TrendingUp size={14}/><span>人机对弈</span><small>{summary.games} 局</small>
      </button>
      <button type="button" role="tab" aria-selected={tab === "vcf"} data-duel-stats-tab="vcf" className={tab === "vcf" ? "active" : ""} onClick={() => setTab("vcf")}>
        <span>VCF 挑战</span><small>{vcfTotal} 题</small>
      </button>
    </div>
    {tab === "ai"
      ? <AiStats summary={summary} entries={entries} onClear={requestClear} clearCost={clearCost} shopBalance={shop.balance}/>
      : <VcfStats/>}
  </div>;
}
