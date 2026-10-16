import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Flag, Home, Play, RotateCcw, TrendingUp, Trophy, Undo2, X } from "lucide-react";
import type { Player } from "../../types";
import "./game-screen.css";
import "./duel-stats.css";

/**
 * 专门的对弈界面（用户 09-28：「进入人机对弈后，是进入专门的对弈界面，而不是打谱界面」
 * 「我这个界面不准备有打谱读谱以及做题这种的，只为纯粹对弈准备」）。
 *
 * 结构上参考了五林对局界面的骨架（他们的节点树是 playerNode + aiNode(含 aiThinking)
 * + boardNode + 一组 btn* + msgScrollView），但**只挑我们本土化后要的那几件**：
 * 段位、等级分变化、提和、聊天与房间那一整套都不搬（用户 09-28：先不搞等级分、
 * 提和暂不加、联网暂不做）。
 *  - **双方信息格**：两格对称，轮到谁高亮谁。我方一格用时；对手一格**思考状态**——
 *    AI 那一格不放走动的钟：本站从 09-17 就定了「人机对局只给人计时、AI 不占钟」，
 *    五林同样只有一格用时（`lbTimeSpent`），两边口径一致。
 *  - **引擎过程信息**：只显示「第几层 / 节点 / 本手已用」这类**过程**读数，
 *    永远不显示推荐点与胜率（对局的竞技性优先；要看引擎怎么想，终局后复盘）。
 *  - **一手操作条**：回看 ‹ › + 回到本手 + 悔棋 + 认输 + 重开。**没有**提和（用户 09-28 定：暂不加）。
 *  - **最近几手**：取代打谱页那条手数滑轨（对弈界面不放打谱件）。
 *  - **独立终局面板**：结果 + 原因 + 手数 + 用时 + 出口（保存本局 / 回看 / 再来一局 / 完成）。
 *
 * 本组件**不含任何对局规则**：棋盘与开局决策条由 App 传进来（与打谱页同一份 JSX，
 * 一处渲染），所有动作都是回调。这样引擎、开局状态机、计时这些重资产一行都不用动。
 */

export interface DuelSideInfo {
  name: string;
  player: Player;
  /** 副标题：我方写「等级 / 累计用时」这类，对手那格写引擎与难度档。 */
  detail: string;
  /** 走棋方高亮。 */
  active: boolean;
  /** 时间文本；null 表示这一格不显示钟（AI 那格默认如此，只显示思考状态）。 */
  timeText: string | null;
  thinking: boolean;
}

export interface DuelRecentMove { turn: number; player: Player; label: string }

export interface DuelResultInfo {
  outcome: "won" | "lost" | "draw";
  title: string;
  reason: string;
  moves: number;
  humanTimeText: string;
  saved: boolean;
}

export interface GameScreenProps {
  titleText: string;
  /**
   * 状态 chips（规则 / 难度 / 引擎 / 时间制式）。
   *
   * 用户 09-28：「状态栏里面，感觉东西有点少，难度，引擎，时间什么的都没显示」——
   * 旧的标题行只写「规则 · 第 N 手」，难度挤在对手那一格的小字里，引擎与时间制式
   * 根本没露面（引擎只在思考时才有一行过程读数）。这一行把「这局是按什么条件下的」
   * 四件事一次摆出来，落子期间眼睛不用去找。
   */
  meta: Array<{ label: string; value: string }>;
  me: DuelSideInfo;
  opponent: DuelSideInfo;
  /**
   * 引擎过程信息（「rapfi 正在算这手棋 · 第 12-18 层 · 48k」）。
   *
   * **它不再单独占一行**（用户 2026-10-01：「那些状态会一直变，界面一会上蹿一会下跳，晃眼睛，
   * 把位置安排在其他地方」）：以前它是棋盘下面一条条件渲染的 `<p>`，每 ~100ms 换一次文字，
   * 长度在 1 行 ↔ 2 行之间来回翻，而棋盘靠 `margin-block:auto` 吃剩余空间 —— 于是每翻一次行，
   * 整块棋盘就上下平移一次（392×852 实测位移 12px）。现在把读数并进上面那排 chips 的
   * 「引擎」格：那里本来就是 `nowrap + text-overflow:ellipsis` 的固定高度槽位，
   * 读数怎么变都只会在格子里被截断，不会推动任何东西。
   */
  engineText: string;
  board: ReactNode;
  openingBanner: ReactNode;
  /**
   * 开局名浮字（用户 2026-10-09：「摆出这个开局后会出现弹窗的字……出现在棋盘中心的下面」）。
   *
   * 它是**绝对定位、pointer-events:none** 的一小块，挂 `.duel-board` 里而不是插进文档流——
   * 本应用的棋盘靠 `margin-block:auto` 吃剩余空间，在它附近新增正常流元素会让棋盘上下跳
   * （R110 实测过 12px 的位移）。所以这个槽位必须保持"零布局影响"。
   * 传 null 时不渲染任何东西。
   */
  openingReveal?: ReactNode;
  recent: DuelRecentMove[];
  canUndo: boolean;
  /** 悔棋按钮**为什么点不了**（只有"没有悔棋卡"这一种）。平时不给 title/读屏后缀：
      库存数在道具卡上就写着，把整句塞进 accessible name 只会让「悔棋」变成一长串。 */
  undoTitle?: string;
  /**
   * 自定义开局的**摆子阶段**（用户 2026-10-13）。这一步还没有对局，所以双方信息格
   * （我的用时 / AI 的思考状态）、最近几手、整局那排按钮（悔棋·认输·重开）全都没有意义 ——
   * 整段不渲染。
   * 摆子阶段这一屏的排法按用户 2026-10-14 的口径：**棋盘居中**，进度写在棋盘上面
   * （`openingBanner` 槽位），三颗摆子按钮写在**棋盘下面**（`setupActions`，与整局那排
   * 同一个位置）。先前是横幅（含按钮）压在棋盘上面、底下剩一堆空白，被判「体验很不好」。
   */
  setupPhase?: boolean;
  /** 摆子阶段底部那三颗按钮（撤销摆子 / 清空 / 开始对局），由 App 组好 JSX 递进来。 */
  setupActions?: ReactNode;
  canPrev: boolean;
  canNext: boolean;
  /** 是否停在最新一手（不在时给「回到本手」）。 */
  atLivePosition: boolean;
  result: DuelResultInfo | null;
  onPrev: () => void;
  onNext: () => void;
  onBackToLive: () => void;
  onUndo: () => void;
  /** 终局面板里的「悔棋继续下」（用户 2026-10-15：自定义开局"即便终局完成了也还是可以悔棋"）。
   *  终局面板是模态的、会盖住下面那条操作条，所以只放开 `canUndo` 等于点不到——
   *  这颗按钮要给在面板里。不传就不画（普通对局不画）。 */
  onUndoAfterEnd?: () => void;
  onResign: () => void;
  onRestart: () => void;
  onSave: () => void;
  /** 复盘这盘（切到打谱侧的分析面板）；不提供就不显示这个出口。 */
  onReview?: () => void;
  onClose: () => void;
  onNewGame: () => void;
  /** 右上角那枚小按钮：战绩与等级分面板（用户 10-02）。不给就不显示。 */
  onOpenStats?: () => void;
  /** 右上角那枚小按钮：成就与棋魂（用户 10-09）。不给就不显示。 */
  onOpenAchievements?: () => void;
}

const outcomeTitle = (outcome: DuelResultInfo["outcome"]) => outcome === "won" ? "你赢了" : outcome === "lost" ? "你输了" : "和棋";

/** 终局印章上的单字（设计稿定稿的「印」）。 */
const END_TAG: Record<DuelResultInfo["outcome"], string> = { won: "胜", lost: "负", draw: "和" };

/**
 * 终局题诗池：每次开弹窗随机取一句 —— **故意随机的**。
 *
 * 本仓库"随机必须确定性"那条规矩管的是棋盘/棋子的 SVG 形状（同一局面每次必须画得一样，
 * 见 parts.js 里的 rng）；文案每次换一句正是想要的效果，所以这里用 Math.random。
 * 文案来自设计稿定稿（design-lab/duel-endings-v2），按用户要求从每态 3 句扩到 8 句。
 */
const END_COPY: Record<DuelResultInfo["outcome"], ReadonlyArray<string>> = {
  won: ["一子落定乾坤朗", "五连如虹贯中天", "落子成局定山河", "连珠落定势已成",
    "半目不让成五连", "手筋既出局已定", "五子成行如落款", "算尽机关终得手"],
  lost: ["胜负兵家常有事", "一着之差天地远", "棋差半子未为输", "五连成处悔已迟",
    "算漏一着满盘输", "势去难回莫强争", "此局欠君一招棋", "输赢未足挂心怀"],
  draw: ["势均力敌两相持", "黑白相持未有期", "一局未分高下", "满盘皆子未成行",
    "我攻你守两不让", "棋到中盘势均分", "平分秋色各一方", "五连难成两不亏"],
};

/**
 * 「内置引擎（自带轻量网络） 正在算这手棋 · 第 12-18 层 · 48k」→「第 12-18 层 · 48k」。
 *
 * 「引擎」那一格本身就写着「引擎」，所以引擎名与口语连接词都是废话；去掉之后整串短到
 * 半屏宽（约 180px）放得下，不必为了塞下读数去把格子撑宽——一撑宽就是改高度，正是要避免的事。
 */
const compactEngineReading = (text: string) => text.replace(/^[^\s]* 正在算这手棋\s*·?\s*/, "").trim();

export function GameScreen(props: GameScreenProps) {
  // 认输与重开都要二次确认：这两个动作都会毁掉当前局面，且不可撤销。
  const [confirm, setConfirm] = useState<"none" | "resign" | "restart">("none");
  const result = props.result;
  // 终局题诗：在这局「结束后」固定住（依赖 outcome + 手数），不要每帧重算——
  // 每渲染一次换一句会看见字在闪。下一局手数不同，自然换一句。
  const poem = useMemo(
    () => END_COPY[result?.outcome ?? "draw"][Math.floor(Math.random() * END_COPY[result?.outcome ?? "draw"].length)],
    [result?.outcome, result?.moves],
  );
  const chars = [...poem];
  // 引擎过程读数并进「引擎」那一格（见 props.engineText 的注释：单独占一行会让棋盘上下跳）。
  // 压完全没剩东西可写时（刚点上思考、层数与节点还没出来）就照原样写着引擎名——
  // 那一格空着比"暂时看不到读数"更糟，用户会以为引擎掉了。
  const engineReading = compactEngineReading(props.engineText);
  const metaRows = engineReading
    ? props.meta.map((item) => (item.label === "引擎" ? { ...item, value: engineReading } : item))
    : props.meta;
  return <div className="duel-screen page-padding" data-duel-screen data-duel-setup-phase={props.setupPhase ? "true" : undefined}>
    <header className="duel-screen-head">
      <div className="duel-screen-title"><b>人机对局</b><small data-duel-title>{props.titleText}</small></div>
      <div className="duel-screen-head-actions">
        {props.onOpenStats && <button type="button" className="duel-stats-button" onClick={props.onOpenStats} data-duel-stats aria-label="战绩与等级分" title="战绩与等级分"><TrendingUp size={16}/></button>}
        {props.onOpenAchievements && <button type="button" className="duel-stats-button" onClick={props.onOpenAchievements} data-duel-achievements aria-label="成就与棋魂" title="成就与棋魂"><Trophy size={16}/></button>}
        <button type="button" className="duel-screen-close" onClick={props.onClose} data-duel-close aria-label="完成，离开对局界面"><X size={16}/></button>
      </div>
    </header>

    {metaRows.length > 0 && <dl className="duel-meta" data-duel-meta aria-label="本局设置">
      {metaRows.map((item) => <div key={item.label} className="duel-meta-item">
        <dt>{item.label}</dt><dd data-duel-meta-value={item.label}>{item.value}</dd>
      </div>)}
    </dl>}

    {!props.setupPhase && <div className="duel-sides" role="group" aria-label="双方信息">
      <article className={`duel-side duel-side-me${props.me.active ? " active" : ""}`} data-duel-side="me">
        <span className={`duel-side-stone ${props.me.player}`} aria-hidden="true"/>
        <span className="duel-side-copy"><b>{props.me.name}</b><small>{props.me.detail}</small></span>
        {props.me.timeText && <strong className="duel-side-time" data-duel-my-time>{props.me.timeText}</strong>}
      </article>
      <article className={`duel-side duel-side-ai${props.opponent.active ? " active" : ""}`} data-duel-side="ai">
        <span className={`duel-side-stone ${props.opponent.player}`} aria-hidden="true"/>
        <span className="duel-side-copy"><b>{props.opponent.name}</b><small>{props.opponent.detail}</small></span>
        {/* AI 那格是「思考中」，不是一个走动的钟（人机对局 AI 不占钟） */}
        {props.opponent.thinking
          ? <strong className="duel-side-thinking" data-duel-thinking aria-live="polite">思考中<i aria-hidden="true"/></strong>
          : props.opponent.timeText ? <strong className="duel-side-time">{props.opponent.timeText}</strong> : null}
      </article>
    </div>}

    {props.openingBanner}

    <div className="duel-board" data-duel-board>{props.board}{props.openingReveal}</div>

    {/* 这一行的容器**常驻**（不随第 1 手才挂载）：以前一挂载就把 auto 边距重新分一次，
        棋盘跟着挪一下（实测 12px，R110 那条红线）。2026-10-13 曾把三张道具卡并进来共行，
        同日按用户口径撤掉（对弈悔棋改成直接扣 10 棋魂），行结构留着不动。 */}
    {!props.setupPhase && <div className="duel-footrow" data-duel-footrow>
      <div className="duel-recent" data-duel-recent aria-label="最近几手">
        {props.recent.map((move) => <span key={move.turn} className={`duel-recent-item ${move.player}`}>
          <i aria-hidden="true"/>{move.turn}.{move.label}
        </span>)}
      </div>
    </div>}

    {props.setupPhase ? <div className="duel-setup-dock" data-duel-setup-dock>{props.setupActions}</div> : <div className="duel-actions">
      <button type="button" onClick={props.onPrev} disabled={!props.canPrev} aria-label="回看上一手" data-duel-prev><ChevronLeft size={16}/></button>
      <button type="button" onClick={props.onNext} disabled={!props.canNext} aria-label="回看下一手" data-duel-next><ChevronRight size={16}/></button>
      {!props.atLivePosition && <button type="button" onClick={props.onBackToLive} data-duel-back-live><Home size={14}/>回到本手</button>}
      <button type="button" onClick={props.onUndo} disabled={!props.canUndo} title={props.undoTitle} aria-label={props.undoTitle ? `悔棋（${props.undoTitle}）` : "悔棋"} data-duel-undo><Undo2 size={14}/>悔棋</button>
      <button type="button" onClick={() => setConfirm("resign")} disabled={Boolean(result)} data-duel-resign><Flag size={14}/>认输</button>
      <button type="button" onClick={() => setConfirm("restart")} data-duel-restart><RotateCcw size={14}/>重开</button>
    </div>}

    {confirm !== "none" && <><div className="duel-confirm-scrim" aria-hidden="true"/><div className="duel-confirm" role="dialog" aria-modal="true" aria-label="确认操作" data-duel-confirm>
      <span className="duel-confirm-mark" aria-hidden="true">{confirm === "resign" ? <Flag size={24}/> : <RotateCcw size={24}/>}</span>
      <b>{confirm === "resign" ? "确认认输？" : "确认重开一局？"}</b>
      <small>{confirm === "resign" ? "本局判负，确认后进入终局。" : "当前这盘（未保存的话）会被丢弃，用同样的规则与难度重新开始。"}</small>
      <div className="duel-confirm-actions">
        <button type="button" onClick={() => setConfirm("none")}>取消</button>
        <button type="button" className="danger" onClick={() => { const action = confirm; setConfirm("none"); if (action === "resign") props.onResign(); else props.onRestart(); }} data-duel-confirm-ok>
          {confirm === "resign" ? "认输" : "重开"}
        </button>
      </div>
    </div></>}

    {result && <div className="duel-result" role="dialog" aria-modal="true" aria-label="对局结束" data-duel-result>
      <div className={`duel-end duel-end--${result.outcome}`}>
        <div className="duel-end-halo" aria-hidden="true"><i/><i/><i/></div>
        <div className="duel-end-card">
          <div className="duel-end-flowclip" aria-hidden="true"><div className="duel-end-flow"/></div>
          {result.outcome === "won" && <div className="duel-end-dust" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>}
          <div className="duel-end-stampwrap" aria-hidden="true">
            <span className="duel-end-stamp">{END_TAG[result.outcome]}<i/></span>
          </div>
          <b className="duel-end-poem" data-duel-result-title>{chars.map((ch, i) => <i key={i} style={{ "--i": i } as React.CSSProperties}>{ch}</i>)}</b>
          <span className="duel-end-stroke" aria-hidden="true"/>
          <small className="duel-end-sub">{result.title || outcomeTitle(result.outcome)}</small>
          <div className="duel-end-stats">
            {[result.reason, `共 ${result.moves} 手`, `我方 ${result.humanTimeText}`].filter(Boolean).map((text) => <div key={text}>{text}</div>)}
          </div>
          <div className="duel-result-actions">
            <button type="button" onClick={props.onSave} disabled={result.saved} data-duel-save>
              {result.saved ? <><Check size={14}/>已存入棋谱库</> : <><Download size={14}/>保存本局</>}
            </button>
            {props.onReview && <button type="button" onClick={props.onReview} data-duel-review><Play size={14}/>复盘这局</button>}
            {props.onUndoAfterEnd && <button type="button" onClick={props.onUndoAfterEnd} disabled={!props.canUndo} title={props.undoTitle} data-duel-undo-after-end><Undo2 size={14}/>悔棋继续下</button>}
            <button type="button" onClick={props.onNewGame} data-duel-newgame><RotateCcw size={14}/>再来一局</button>
            <button type="button" className="primary" onClick={props.onClose} data-duel-result-close>完成</button>
          </div>
          <small className="duel-result-hint">用上面的 ‹ › 可以回看这盘棋；不保存就只留在这台设备的「上次对局」里。</small>
        </div>
      </div>
    </div>}
  </div>;
}
