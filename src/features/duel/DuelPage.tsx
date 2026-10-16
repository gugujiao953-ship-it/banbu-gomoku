import { Bot, CalendarCheck, Play, RotateCcw, Swords, Timer, TrendingUp, Sparkles, Trophy } from "lucide-react";
import { SoulBadge } from "../progress/SoulBadge";
import { ShopBadge } from "../progress/ShopBadge";
import "./duel.css";
import "./duel-stats.css";

export type DuelDailyReason = "wrong" | "fresh";

export interface DuelDailySummary {
  title: string;
  collectionTitle: string;
  reason: DuelDailyReason;
  solved: boolean;
}

export interface DuelPageProps {
  /** 今天的题；题库为空（或全部做完）时为 null。 */
  daily: DuelDailySummary | null;
  aiGameRunning: boolean;
  onStartAiGame: () => void;
  onStartDaily: () => void;
  /** 打开线下比赛计时器（独立功能，与棋盘无关）。 */
  onOpenClock?: () => void;
  /** 右上角小按钮：战绩与等级分（不打棋也能翻账，用户 10-02）。 */
  onOpenStats?: () => void;
  /** 右上角小按钮：成就（用户 10-09；原「成就与棋魂」，棋魂已独立出去）。 */
  onOpenAchievements?: () => void;
  /** 棋魂余额（0 也要显示——余额为 0 时徽章照样在，它是入口）。不给就不渲染徽章。 */
  soul?: number;
  /** 点棋魂徽章（图案或数字都行）→ 打开棋魂说明页。 */
  onOpenSoul?: () => void;
  /**
   * 商店徽章的入口（用户 2026-10-10：「还是在对弈界面去放个商店吧的图标入口吧，
   * 和棋魂按钮在一列」）。
   *
   * `shopRemaining` = 还有几项外观没解锁（0 = 全收齐，徽章换成对勾）。
   * 不传这两个就不显示徽章 —— 只读场景（例如截图脚本）不该长出一个点不动的按钮。
   */
  shopRemaining?: number;
  onOpenShop?: () => void;
  onOpenGenerator?: () => void;
  /** VCF 挑战（用户 2026-10-04：和人机对弈同级的专门入口，在对弈页里）。 */
  onStartVcfChallenge?: () => void;
}

/**
 * 「对弈」页（用户 2026-09-17 钦定）：底部导航第四格的落地页，和打谱/棋谱库/设置同级。
 * 页面上只有两条入口：第一条 AI 对战（复用既有的人机对战设置浮层，不改对战流程），
 * 第二条每日一题。
 *
 * 2026-09-19 收窄：用户说打卡与错题重温「有点鸡肋，感觉花哨了」——这一页因此去掉了
 * 打卡卡（连续天数/七天格子）、错题重温入口与「今日重温 N 题」。**错题本本身照旧**
 * （做题没过的题自动收进题库的错题本，入口一直在题库快捷行里），只是不再做间隔排期。
 *
 * 2026-10-14 去介绍（用户：「对弈里面那些功能入口的介绍都去掉吧，人机对战、vcf 挑战什么的，
 * 下面有老长的说明文字了」）：五张卡只留「序号 + 图标 + 名字 + 那颗动作按钮」，
 * 每张下面那句解释性 `<small>` 全删 —— 功能说明在手册里（第 11/13/14 章），不占这一屏。
 * 只有两处文字留下：每日一题卡上那行**题名**（那是今天的内容，不是介绍），
 * 以及题库为空时那句"先去导入题"的指引（没有它这张卡就只剩一个点不动的标题）。
 */
export function DuelPage({ daily, aiGameRunning, onStartAiGame, onStartDaily, onOpenClock, onOpenStats, onOpenGenerator, onStartVcfChallenge, onOpenAchievements, soul, onOpenSoul, shopRemaining, onOpenShop }: DuelPageProps) {
  const vcfIndex = 2;
  const clockIndex = 3;
  const generatorIndex = 4;
  const dailyIndex = onOpenGenerator ? 5 : 4;
  return (
    <div className="duel-page page-padding" data-duel-page="">
      <div className="page-title duel-title">
        <h1>对弈</h1>
        {/* 徽章组：棋魂在**最左**，然后战绩、成就（用户 10-09 指定顺序）。
            用 flex 右对齐一块，而不是散在标题行两端——三个都是"我的进度"，
            挨在一起才好扫。 */}
        <div className="duel-title-badges">
          {/* ⚠ 判据必须用 `typeof soul === "number"`，不能写 `soul && ...`：
              余额为 0 时 `0 && <X/>` 求值成 0，React 会把字面量 0 渲染出来
              （实测页面里出现一个孤零零的 "0"，被 qa/soul-check.mjs 抓到）。
              棋魂为 0 也要显示徽章——它是入口，不是"有余额才给的功能"。 */}
          {typeof soul === "number" && onOpenSoul && <SoulBadge balance={soul} onClick={onOpenSoul}/>}
          {/* 商店紧挨着棋魂（用户点名的位置："和棋魂按钮在一列"）：
              先看到"我有多少钱"，紧跟着"能买什么"。 */}
          {typeof shopRemaining === "number" && onOpenShop && <ShopBadge remaining={shopRemaining} onClick={onOpenShop}/>}
          {onOpenStats && <button type="button" className="duel-stats-button" onClick={onOpenStats} data-duel-stats aria-label="战绩与等级分" title="战绩与等级分"><TrendingUp size={16}/></button>}
          {onOpenAchievements && <button type="button" className="duel-stats-button" onClick={onOpenAchievements} data-duel-achievements aria-label="成就" title="成就"><Trophy size={16}/></button>}
        </div>
      </div>

      <div className="duel-entries">
        <article className="duel-entry duel-entry--ai" data-duel-entry="ai">
          <span className="duel-entry-index" aria-hidden="true">01</span>
          <span className="duel-entry-icon" aria-hidden="true"><Bot size={20}/></span>
          <div className="duel-entry-copy">
            <b>AI 对战</b>
          </div>
          <button type="button" className="duel-entry-action" onClick={onStartAiGame} aria-label={aiGameRunning ? "继续 AI 对战" : "开始 AI 对战"}>
            {aiGameRunning ? <RotateCcw size={14}/> : <Play size={14}/>}
            <span>{aiGameRunning ? "继续对局" : "开始对局"}</span>
          </button>
        </article>

        {onStartVcfChallenge && (
          <article className="duel-entry duel-entry--vcf" data-duel-entry="vcf">
            <span className="duel-entry-index" aria-hidden="true">{String(vcfIndex).padStart(2, "0")}</span>
            <span className="duel-entry-icon" aria-hidden="true"><Swords size={20}/></span>
            <div className="duel-entry-copy">
              <b>VCF 挑战</b>
            </div>
            <button type="button" className="duel-entry-action" onClick={onStartVcfChallenge} aria-label="开始 VCF 挑战" data-duel-vcf-start="">
              <Play size={14}/>
              <span>开始挑战</span>
            </button>
          </article>
        )}

        {onOpenClock && (
          <article className="duel-entry duel-entry--clock" data-duel-entry="clock">
            <span className="duel-entry-index" aria-hidden="true">{String(clockIndex).padStart(2, "0")}</span>
            <span className="duel-entry-icon" aria-hidden="true"><Timer size={20}/></span>
            <div className="duel-entry-copy">
              <b>比赛计时器</b>
            </div>
            <button type="button" className="duel-entry-action" onClick={onOpenClock} aria-label="打开比赛计时器" data-duel-clock-start="">
              <Play size={14}/>
              <span>开始计时</span>
            </button>
          </article>
        )}

        {onOpenGenerator && <article className="duel-entry duel-entry--generator" data-duel-entry="generator">
          <span className="duel-entry-index" aria-hidden="true">{String(generatorIndex).padStart(2, "0")}</span>
          <span className="duel-entry-icon" aria-hidden="true"><Sparkles size={20}/></span>
          <div className="duel-entry-copy"><b>棋题生成器</b></div>
          <button type="button" className="duel-entry-action" onClick={onOpenGenerator} aria-label="打开棋题生成器"><Play size={14}/><span>进入生成器</span></button>
        </article>}
        <article className="duel-entry duel-entry--daily" data-duel-entry="daily">
          <span className="duel-entry-index" aria-hidden="true">{String(dailyIndex).padStart(2, "0")}</span>
          <span className="duel-entry-icon" aria-hidden="true"><CalendarCheck size={20}/></span>
          <div className="duel-entry-copy">
            <b>每日一题</b>
            {daily ? (
              <small className="duel-daily-name" data-duel-daily-name="">{daily.title}<span className="duel-daily-collection"> · {daily.collectionTitle}</span></small>
            ) : (
              <small>题库里暂时没有可练的题——先在棋谱库的「题库」分区导入或挑一道。</small>
            )}
          </div>
          {daily && (
            <button type="button" className="duel-entry-action" onClick={onStartDaily} aria-label={daily.solved ? "再做一遍今日一题" : "开始今日一题"} data-duel-daily-start="">
              {daily.solved ? <RotateCcw size={14}/> : <Play size={14}/>}
              <span>{daily.solved ? "再做一遍" : "开始做题"}</span>
            </button>
          )}
        </article>
      </div>
    </div>
  );
}
