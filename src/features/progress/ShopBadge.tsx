/**
 * 商店徽章（用户 2026-10-10：「还是在对弈界面去放个商店吧的图标入口吧，和棋魂按钮在一列」
 * ＋「商店的图标我不满意」）。
 *
 * ## 图标选择
 *
 * 第一版用的是一枚购物袋（`ShoppingBag`）—— 用户的原话是「我不满意」。
 * 换成 **`Store`（店铺门脸／市集摊位）**：那是游戏里"商店"最经典的形象
 * （顶棚 + 门面），比一个购物袋更明确地指"这里能买东西"，
 * 也和旁边的棋魂魂火（图形化）配成一套"图标"而不是"UI 符号"。
 *
 * ## 未解锁数
 *
 * 显示还有几项没解锁 —— 它是**入口**，要给人"点进去看看"的理由。
 * 全收齐了换成对勾，仍然可点（进去还能买道具）。
 */

import { Store, Check } from "lucide-react";

export interface ShopBadgeProps {
  /** 还没解锁的项数（`0` 表示全收齐了）。 */
  remaining: number;
  onClick: () => void;
}

export function ShopBadge({ remaining, onClick }: ShopBadgeProps) {
  const done = remaining <= 0;
  return <button
    type="button"
    className={`shop-badge${done ? " is-done" : ""}`}
    onClick={onClick}
    data-shop-badge=""
    aria-label={done ? "棋魂商店（已全部解锁）" : `棋魂商店（还有 ${remaining} 项没解锁）`}
    title={done ? "棋魂商店 · 已全部解锁" : `棋魂商店 · 还有 ${remaining} 项没解锁`}
  >
    <span className="shop-badge-icon" aria-hidden="true">
      {done ? <Check size={15}/> : <Store size={15}/>}
    </span>
    <b data-shop-badge-count="">{done ? "全" : remaining}</b>
  </button>;
}
