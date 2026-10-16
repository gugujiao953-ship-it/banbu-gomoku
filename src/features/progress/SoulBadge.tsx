import { SoulFlame } from "./SoulFlame";
import { formatSoulAmount } from "./soul";

/**
 * 棋魂徽章（用户 2026-10-09：「显示形态是一个图案加上数量。如果过万了，那么就用 w 省略，
 * 过亿了就用 e 代替，然后点击图案或者数字都可以进入棋魂的说明页」）。
 *
 * ## 位置
 *
 * 放在「对弈」页标题行，**和「战绩与等级分」「成就」同一行、更靠左**（用户明确要求）。
 * 所以这个组件的宽度要可预期：图案 16px + 数字，不换行。
 *
 * ## 为什么整个徽章是一个 button
 *
 * 用户要求「点图案或者数字都可以进入」——最省事也最不容易做错的做法就是**做成一个按钮**：
 * 图案和数字都在按钮里，点哪儿都进得去，不用给两块分别绑事件（那样还会漏掉点图案与数字
 * 之间的空隙）。无障碍上也更干净：一个按钮一个 label。
 *
 * ## 数字怎么写
 *
 * 走 `formatSoulAmount`（过万 w / 过亿 e）。**精确值放在 title 里**：
 * 紧凑写法是为了在标题行里站得住，但不能让人查不到真实数字。
 */

export interface SoulBadgeProps {
  balance: number;
  onClick: () => void;
}

export function SoulBadge({ balance, onClick }: SoulBadgeProps) {
  const compact = formatSoulAmount(balance);
  const exact = Math.round(balance).toLocaleString("zh-CN");
  return <button
    type="button"
    className="soul-badge"
    onClick={onClick}
    data-soul-badge=""
    data-soul-balance={balance}
    aria-label={`棋魂 ${exact}，查看棋魂说明`}
    title={`棋魂 ${exact} · 查看说明`}
  >
    <SoulFlame size={16}/>
    <b data-soul-badge-count="">{compact}</b>
  </button>;
}
