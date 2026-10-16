/**
 * **用棋魂解锁的选项**（用户 2026-10-10：「外观那一块，除了默认棋盘默认棋子以外，
 * 都要棋魂解锁，主题也是，都要棋魂解锁这样的。具体的前端样子就是，这些个主题呀，
 * 棋盘棋子吗，重置等级分什么的，选项的右边有一个棋魂的图案，右边标好需要多少的棋魂
 * 可以解锁（不要整说明，点击后弹窗是否购买），不要搞的太臃肿了」）。
 *
 * ## 形态（用户点名的样子）
 *
 * 一个原本就有的选项（主题卡 / 材质卡），在**右侧**多出：
 *
 * ```
 * ┌────────────────────────────┐
 * │  [色块]  主题名      🔥 300 │  ← 锁着：卡片压暗、右边一枚魂火 + 价格
 * └────────────────────────────┘
 * ```
 *
 * 点一下 → **弹一个确认框**（"解锁「玉石棋盘」／300 棋魂／先不买 · 解锁"）→
 * 确认就扣钱、解锁、立刻切过去。**不写长说明**：用户原话「不要整说明」「不要搞的太臃肿了」。
 *
 * ## 状态归谁管（这里有个刻意的分工）
 *
 * 解锁集合与账本由**调用方持有**（React state），本组件只负责"显示锁 + 弹确认框"。
 * 理由：直接在这个组件里 `loadSoulUnlocks()` 读盘能让代码短十行，但**买了之后不会重渲染**
 * —— 界面停在"还锁着"，用户会以为钱白花了。所以买完必须由持有 state 的那一层广播。
 * 这也是本项目一贯的做法（见 `use-achievements.ts` 里 `commitLedger` 的注释）。
 *
 * ## 为什么是一个共享组件而不是在各处各写一份
 *
 * 主题、棋盘、棋子、将来的其它可解锁项，形态完全一样（只差内层预览块）。
 * 历史教训（见 `theme-options.ts` 的注释）：**同一个东西在五处各写一份清单**，
 * 迟早有一处忘了改。所以这里把"锁 + 价格 + 购买确认"收成一个组件，
 * 各调用方只提供自己的预览内容与自己的类名。
 */

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { SoulFlame } from "./SoulFlame";
import { formatSoulAmount } from "./soul";
import type { SoulUnlock } from "./soul-unlocks";

export interface SoulLockBadgeProps {
  /** 这个选项的解锁项。 */
  item: SoulUnlock;
  /** 是否已解锁。 */
  unlocked: boolean;
}

/**
 * 选项右侧那枚「魂火 + 价格」。**已解锁时返回 null**。
 *
 * ## 它是**可点的**（用户 2026-10-10：「棋盘棋子你可以让我们点击可以预览，
 * 点击右边那个地方才是购买」）
 *
 * 上一版它是个纯装饰的 `<span>`（"整张卡片一个点击目标"）。用户要求把两件事
 * **分开**：点卡片 = 预览、点右边价格 = 购买。所以它现在是一个真 `<button>`。
 *
 * 无障碍上这也更正确：两个动作、两个目标，读屏能分别念出来
 * （"×××，点击预览" 与 "××× 需要 N 棋魂，点击购买"）。
 *
 * `onBuy` 不传时退回不可点（有些地方只用来展示价格，没有购买入口）。
 */
export function SoulLockBadge({ item, unlocked, onBuy }: SoulLockBadgeProps & { onBuy?: () => void }) {
  if (unlocked) return null;
  const title = `需要 ${formatSoulAmount(item.cost)} 棋魂解锁`;
  if (!onBuy) {
    return <span className="soul-lock-badge" data-soul-lock={item.id} title={title}>
      <SoulFlame size={14}/>
      <em>{formatSoulAmount(item.cost)}</em>
    </span>;
  }
  return <button
    type="button"
    className="soul-lock-badge is-buy"
    data-soul-lock={item.id}
    title={`${title} —— 点这里购买`}
    aria-label={`解锁「${item.title}」，需要 ${formatSoulAmount(item.cost)} 棋魂`}
    onClick={(event) => { event.stopPropagation(); onBuy(); }}
  >
    <SoulFlame size={14}/>
    <em>{formatSoulAmount(item.cost)}</em>
  </button>;
}

export interface LockableOptionProps {
  /** 解锁项。`undefined` = 这本来就没上架（默认主题/默认棋盘那种），永远可用。 */
  item: SoulUnlock | undefined;
  /** 已解锁？（`item` 为 undefined 时这个值不影响结果） */
  unlocked: boolean;
  /** 选中的是这一个吗。 */
  selected?: boolean;
  /** 已解锁时点了做什么（调用方把选项切过去）。 */
  onPick: () => void;
  /**
   * **锁着时**点卡片做什么（用户 2026-10-10：「现在不交钱无法预览了，就很不好，
   * 棋盘棋子你可以让我们点击可以预览」）。
   *
   * 不传就退回旧行为（点卡片直接弹购买框）—— 那样没有预览的入口，
   * 而预览恰恰是"要不要买"的前提。所以**能预览的地方都该传它**。
   */
  onPreview?: () => void;
  /**
   * 确认购买。**由调用方执行真正的扣费**（它持有账本 state），
   * 返回失败原因字符串表示没买成（`""` = 成功）。
   *
   * 这样本组件完全不碰账本与 localStorage，只做"问一句、等回答"。
   */
  onBuy: (item: SoulUnlock) => string;
  /** 解锁成功后（调用方通常在这里把选项也切过去）。 */
  onUnlocked?: () => void;
  /** 卡片的预览内容（色块 / 棋盘缩略 / 棋子缩略）。 */
  children: ReactNode;
  /** 附加类名（各调用方原有的类要保留）。 */
  className?: string;
  /** 无障碍标签。传了才有 role="radio"（对齐各调用方原有的语义）。 */
  label?: string;
}

/**
 * 一个"可锁可选"的卡片。**已解锁时的行为与原来完全一致**（就是调 `onPick`）。
 *
 * ⚠ 刻意不做"点一下直接买"：购买是不可逆的支出，必须有一次确认
 * （用户 10-10：「点击后弹窗是否购买」）。
 */
export function LockableOption({
  item, unlocked, selected, onPick, onPreview, onBuy, onUnlocked, children, className = "", label,
}: LockableOptionProps) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const locked = Boolean(item) && !unlocked;

  /**
   * 点卡片：
   *  · 已解锁 ⇒ 切过去（原行为，一字不改）；
   *  · 锁着且有 `onPreview` ⇒ **预览**（用户要的"不买也能看"）；
   *  · 锁着且没有 `onPreview` ⇒ 旧行为，弹购买框。
   */
  const handleClick = () => {
    if (!locked) { onPick(); return; }
    if (onPreview) { onPreview(); return; }
    setError("");
    setAsking(true);
  };

  const confirmBuy = () => {
    if (!item) return;
    const failure = onBuy(item);
    if (failure) { setError(failure); return; }
    setAsking(false);
    onUnlocked?.();
  };

  /**
   * ⚠ 结构：**卡片与徽章是兄弟，不是父子**。
   *
   * 徽章现在是个真 `<button>`（点它才是购买），把它嵌在卡片的 `<button>` 里是
   * **非法 HTML**（button 不能嵌套 button）—— 实测表现就是"点了没反应"：
   * 浏览器会把内层按钮当成外层内容，React 的合成事件也被外层吃掉。
   *
   * 所以外面套一层 `<span class="soul-lockable">` 布局容器（flex 行 + 换行，
   * 见 soul-lockable.css），里面并排两个各自独立的按钮。
   * 外层容器用 `display: contents` 之类的技巧会让定位父级丢失，
   * 所以它就是一个普通的 inline-flex 盒子，宽度由内容决定。
   */
  return <>
    <span className="soul-lockable">
      <button
        type="button"
        className={`${className}${locked ? " is-soul-locked" : ""}${selected ? " selected" : ""}`.trim()}
        role={label ? "radio" : undefined}
        aria-checked={label ? Boolean(selected) : undefined}
        aria-label={locked && item
          ? `${item.title}（需 ${item.cost} 棋魂，点击可预览）`
          : label}
        onClick={handleClick}
      >
        {children}
      </button>
      {item && <SoulLockBadge
        item={item}
        unlocked={unlocked}
        onBuy={() => { setError(""); setAsking(true); }}
      />}
    </span>
    {asking && item && <SoulBuyDialog
      item={item}
      error={error}
      onCancel={() => setAsking(false)}
      onConfirm={confirmBuy}
    />}
  </>;
}

/**
 * 购买确认框。**只有三样东西**：是什么、多少钱、买/不买（用户：不要整说明）。
 *
 * ## 2026-10-10 第七轮改版（用户：「去掉里面的那个棋魂这两个字吧，把棋魂的图案稍微再放大一点，
 * 然后再适当排版一下」）
 *
 * 三处改动，都是"别重复说同一件事"：
 *  · **价格行不再写「棋魂」二字**：那枚魂火图案就在数字左边，它已经说明了单位 ——
 *    再写一遍是同一句话说两次（用户原话「你已经有了弹窗，还有了图标，那么我们就知道
 *    你这个是干啥的了」）。所以价格行只留「图案 + 数字」；
 *  · **魂火放大**：34 → 52（图案是主体，之前偏小、像是顺带放的）；
 *  · **排版**：标题与价格成组靠紧、价格做成"数字为主体"的胶囊，动作按钮与上面留出呼吸。
 *
 * 无障碍补偿：视觉上去掉了「棋魂」二字，但 `aria-label` 仍然读全
 * （「解锁 X，需要 N 棋魂」）—— 看得见图案的人不需要那两个词，读屏的人需要。
 */
export function SoulBuyDialog({
  item, error, onCancel, onConfirm,
}: { item: SoulUnlock; error?: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="soul-buy-backdrop" role="dialog" aria-modal="true" aria-label={`解锁 ${item.title}`}>
    <div className="soul-buy-card" data-soul-buy={item.id}>
      <button type="button" className="soul-buy-close" onClick={onCancel} aria-label="取消"><X size={15}/></button>
      {/* 魂火**不带 tone**：默认黑白那枚是"棋魂"的形象，和说明页同一套识别 */}
      <span className="soul-buy-flame" aria-hidden="true"><SoulFlame size={52}/></span>
      <b className="soul-buy-title">解锁「{item.title}」</b>
      {/* 单位不写字：左边的图案就是单位（见上面那段注释）。
          数字用隐藏文本补全语义，读屏时不会丢"棋魂"这个单位
          （SoulFlame 不传 title 时自带 aria-hidden，所以图案本身不会被念两次）。 */}
      <span className="soul-buy-price">
        <SoulFlame size={16}/>
        <em>{formatSoulAmount(item.cost)}</em>
        <span className="soul-sr-only">棋魂</span>
      </span>
      {error && <p className="soul-buy-error" role="alert">{error}</p>}
      <div className="soul-buy-actions">
        <button type="button" className="soul-buy-cancel" onClick={onCancel}>先不买</button>
        <button type="button" className="soul-buy-confirm" onClick={onConfirm} data-soul-buy-confirm="">解锁</button>
      </div>
    </div>
  </div>;
}
