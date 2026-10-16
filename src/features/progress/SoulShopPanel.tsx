/**
 * 棋魂商店面板（对弈页那枚店铺图标的落点，用户 2026-10-10）。
 *
 * ## 这一版重做了什么（用户原话）
 *
 * 「商店的图标我不满意，里面的样子我更不满意，里面太普通了，没见过哪个游戏是这样的，
 *  那三个道具就应该在同一行，点击购买时会出现一个弹窗以及这个东西的用法，
 *  而不是往下展开这样的。」
 *
 * 所以三处改动：
 *
 *  ① **三个道具在同一行**：原来是一列三行（每行一个图标 + 名字 + 用法 + 价格按钮），
 *     读起来像设置页的列表。现在做成**三张并排的卡**（图标在上、名字在下、角上一枚价格）——
 *     那是游戏里"道具栏"的样子；
 *  ② **点击才弹窗**：卡面上**不写用法**（用法与价格都进弹窗）。卡只负责"让你认出它、
 *     看到有几个、看到多少钱"，点开才展开细节；
 *  ③ 视觉上更"游戏"：卡片有独立的图标底衬与金色的价格角标，而不是一行行文字。
 *
 * ## 面板里还有什么
 *
 * 除道具外还有**外观总览**（只给"已解锁 N / 总数"，挑的地方仍在设置页的外观卡上 ——
 * 那里就地长着锁与价格，是最顺手的上下文）。用户说过"不要搞的太臃肿了"，
 * 所以外观那部分不做成第二个商店。
 */

import { useState } from "react";
import { Check, Clock, Lightbulb, Undo2, ExternalLink, Store } from "lucide-react";
import { SoulFlame } from "./SoulFlame";
import { formatSoulAmount } from "./soul";
import { SOUL_UNLOCK_GROUPS, SOUL_UNLOCKS, soulUnlockStats } from "./soul-unlocks";
import { describePurchaseFailure, soulUnlockProgress } from "./soul-shop";
import { useSoulShop } from "./use-soul-shop";
import { VCF_ITEMS, countOf, type VcfItem, type VcfItemId } from "../vcf-challenge/items";

const ITEM_ICONS: Record<VcfItemId, typeof Clock> = {
  "extra-time": Clock,
  hint: Lightbulb,
  undo: Undo2,
};

export interface SoulShopPanelProps {
  /** 「去设置里挑外观」的回调（不传就不显示那个入口）。 */
  onOpenAppearance?: () => void;
}

export function SoulShopPanel({ onOpenAppearance }: SoulShopPanelProps) {
  const shop = useSoulShop();
  const [error, setError] = useState("");
  /** 正在看的道具（点卡片开；null = 没开）。用法与价格都在这个弹窗里。 */
  const [opened, setOpened] = useState<VcfItem | null>(null);
  /**
   * **批量购买的勾选集合**（用户 2026-10-10：「商店里面目前还不能批量购买，
   * 只能一个个的买，你优化一下」）。
   *
   * 交互：**开启"多选"之后**列表项变成可勾选的；不开时点一行仍然是"去外观设置里挑"
   * （那是只读总览，点进去才是挑的地方）。这样两种意图不打架 ——
   * 平时这个面板是"看一下我还差什么"，想批量买时才切到选择态。
   */
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 批量结算后的**如实汇报**（null = 还没有过）。 */
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  /**
   * 道具弹窗里选了几份（用户 2026-10-11：「道具目前无法批量购买」）。
   *
   * 只在弹窗开着时有意义；每次开新弹窗都回到 1（`setOpened` 的地方一并重置），
   * 否则"上次选了 10 个"会带到下一个道具上 —— 而它的单价不同，
   * 用户看到的按钮数额和他预期的不一致。
   */
  const [amount, setAmount] = useState(1);
  const stats = soulUnlockStats();
  const progress = soulUnlockProgress(shop.unlocks);

  /**
   * 批量结算。
   *
   * 结果**逐条如实说**（"买到 N 件，M 件没买成：原因是…"）——
   * 只回一句"部分失败"用户没法行动（他不知道是哪几件、该先攒钱还是先换顺序）。
   * 这与 `purchaseSoulUnlocks` 的设计是一套：逐个买、不做事务。
   */
  const buySelected = () => {
    const ids = [...selected];
    if (!ids.length) return;
    const result = shop.buyMany(ids);
    setSelected(new Set(result.failed.map((entry) => entry.id)));   // 没买成的留在勾选里，方便他补钱再来
    const reasons = [...new Set(result.failed.map((entry) => describePurchaseFailure(entry.code, stats.cheapest)))];
    setNotice({
      text: result.failed.length
        ? `买到 ${result.bought.length} 件；${result.failed.length} 件没买成：${reasons.join("；")}（没买成的仍留在勾选里）`
        : `买到 ${result.bought.length} 件，共花 ${formatSoulAmount(ids.length * stats.cheapest)} 棋魂`,
      bad: result.failed.length > 0,
    });
    setError("");
  };

  /**
   * 买道具（**支持一次买多个**，用户 2026-10-11：「道具目前无法批量购买」）。
   *
   * 结果**如实说**：钱只够一部分时，已成交的留着、剩下的报出来
   * （同 `buySelected` 的口径：不做事务，因为"把能买的也退掉"更糟）。
   * 全买成才关框；否则留着框、把差额写在里面（他正好在看着价格，就地能决定减几个）。
   */
  const confirmBuy = () => {
    if (!opened) return;
    const { bought, failure } = shop.buyItems(opened.id, amount);
    if (bought < amount) {
      setError(failure ? (bought > 0 ? `买到 ${bought} 个；${failure}` : failure) : bought > 0
        ? `买到 ${bought} 个，另外 ${amount - bought} 个棋魂不够（每个 ${formatSoulAmount(opened.cost)}）。`
        : `棋魂不够：买 ${amount} 个需要 ${formatSoulAmount(amount * opened.cost)} 枚，现在有 ${formatSoulAmount(shop.balance)}。攒一攒（下棋、做题、点魂火都算）。`);
      return;
    }
    setError("");
    setOpened(null);
  };

  return <div className="shop-panel" data-shop-panel="">
    {/* 余额放在最上面：买之前先看钱够不够 */}
    <section className="shop-balance" aria-label="棋魂余额">
      <span className="shop-balance-flame" aria-hidden="true"><SoulFlame size={26}/></span>
      <span className="shop-balance-copy">
        <b data-shop-balance="">{formatSoulAmount(shop.balance)}</b>
        <small>棋魂 · 下棋、做题、点魂火都能攒</small>
      </span>
    </section>

    {/* ① 道具：**三张并排的卡**（用户：「那三个道具就应该在同一行」） */}
    <section className="shop-section" aria-label="挑战道具">
      {/* 这三张卡从 2026-10-13 起**两个场景共用**（VCF 挑战＋人机对弈），同一份库存、
          不同作用——逐张的两用说明写在各卡的 text 里（items.ts），这里不再只写"VCF 挑战里用"。 */}
      <h3><Store size={13} aria-hidden="true"/>棋局道具<small>VCF 挑战与人机对弈里用 · 点开看用法</small></h3>
      <ul className="shop-item-row">
        {VCF_ITEMS.map((item) => {
          const Icon = ITEM_ICONS[item.id];
          const have = countOf(shop.items, item.id);
          return <li key={item.id}>
            <button
              type="button"
              className={`shop-item-card${have > 0 ? "" : " is-empty"}`}
              data-shop-item={item.id}
              data-shop-item-count={have}
              onClick={() => { setError(""); setAmount(1); setOpened(item); }}
              aria-label={`${item.name}，有 ${have} 个，点击看用法与购买`}
            >
              {/* 价格角标（卡面只放价格，不放用法 —— 用法进弹窗） */}
              <span className="shop-item-cost">
                <SoulFlame size={11}/>
                <em>{formatSoulAmount(item.cost)}</em>
              </span>
              <span className="shop-item-badge" aria-hidden="true"><Icon size={22}/></span>
              <b>{item.name}</b>
              <span className="shop-item-count">×{have}</span>
            </button>
          </li>;
        })}
      </ul>
    </section>

    {/* ② 外观：总览 + **批量购买**（用户 2026-10-10：「商店里面目前还不能批量购买，
        只能一个个的买，你优化一下」）。
        平时是只读总览（点一行去设置里挑）；点「多选」才变成可勾选 + 底部结算条。 */}
    <section className="shop-section" aria-label="外观解锁">
      <h3>
        外观解锁
        <small>已解锁 {progress.done} / {progress.total} 项 · {formatSoulAmount(stats.cheapest)} / 件</small>
        <button
          type="button"
          className={`shop-pick-toggle${picking ? " on" : ""}`}
          data-shop-pick-toggle=""
          onClick={() => { setPicking((on) => !on); setSelected(new Set()); setNotice(null); }}
        >{picking ? "退出多选" : "多选"}</button>
      </h3>

      {!picking && <ul className="shop-groups">
        {SOUL_UNLOCK_GROUPS.filter((group) => group.kind !== "action").map((group) => {
          const items = SOUL_UNLOCKS.filter((unlock) => unlock.kind === group.kind);
          const owned = items.filter((unlock) => shop.isUnlocked(unlock)).length;
          return <li key={group.kind} data-shop-group={group.kind}>
            <span className="shop-group-copy">
              <b>{group.title}<em>{owned} / {items.length}</em></b>
              <small>{group.summary}</small>
            </span>
          </li>;
        })}
      </ul>}

      {/* 多选态：按类列出**还没解锁**的每一项，勾选后一键买 */}
      {picking && <div className="shop-pick" data-shop-pick="">
        {SOUL_UNLOCK_GROUPS.filter((group) => group.kind !== "action").map((group) => {
          const locked = SOUL_UNLOCKS.filter((unlock) => unlock.kind === group.kind && !shop.isUnlocked(unlock));
          if (!locked.length) return null;
          const allPicked = locked.every((unlock) => selected.has(unlock.id));
          return <div className="shop-pick-group" key={group.kind} data-shop-pick-group={group.kind}>
            <div className="shop-pick-head">
              <b>{group.title}</b>
              <button
                type="button"
                className="shop-pick-all"
                data-shop-pick-all={group.kind}
                onClick={() => setSelected((current) => {
                  const next = new Set(current);
                  if (allPicked) for (const unlock of locked) next.delete(unlock.id);
                  else for (const unlock of locked) next.add(unlock.id);
                  return next;
                })}
              >{allPicked ? "取消本类" : `全选本类（${locked.length}）`}</button>
            </div>
            <ul>
              {locked.map((unlock) => {
                const on = selected.has(unlock.id);
                return <li key={unlock.id}>
                  <button
                    type="button"
                    className={`shop-pick-row${on ? " on" : ""}`}
                    data-shop-pick-row={unlock.id}
                    aria-pressed={on}
                    onClick={() => setSelected((current) => {
                      const next = new Set(current);
                      if (on) next.delete(unlock.id); else next.add(unlock.id);
                      return next;
                    })}
                  >
                    <span className="shop-pick-check" aria-hidden="true">{on ? <Check size={12}/> : null}</span>
                    <span className="shop-pick-name">{unlock.title}</span>
                    <em>{formatSoulAmount(unlock.cost)}</em>
                  </button>
                </li>;
              })}
            </ul>
          </div>;
        })}
        {/* 结算条：**买得起几件就说几件**（逐个买、如实汇报，见 purchaseSoulUnlocks） */}
        <div className="shop-pick-foot">
          <span className="shop-pick-sum">
            已选 <b>{selected.size}</b> 件 · 共 {formatSoulAmount(selected.size * stats.cheapest)}
            <small>现有 {formatSoulAmount(shop.balance)}</small>
          </span>
          <button
            type="button"
            className="shop-pick-buy"
            data-shop-pick-buy=""
            disabled={selected.size === 0}
            onClick={buySelected}
          >批量解锁</button>
        </div>
        {notice && <p className={`shop-pick-notice${notice.bad ? " bad" : ""}`} role="status" data-shop-pick-notice="">{notice.text}</p>}
      </div>}

      <p className="shop-note">
        主题、棋盘、棋子在<strong>设置 → 外观</strong>里挑，每张卡右边就有价格，点一下就能买；
        也可以点上面的「多选」在这里一次挑好几件。
      </p>
      {onOpenAppearance && !picking && <button type="button" className="shop-go-appearance" onClick={onOpenAppearance} data-shop-open-appearance="">
        <ExternalLink size={14}/> 去外观设置里挑
      </button>}
    </section>

    {/* 道具弹窗：**用法 + 价格 + 买**（用户：「点击购买时会出现一个弹窗以及这个东西的用法」） */}
    {opened && <div className="vcfch-itemback" role="dialog" aria-modal="true" aria-label={`${opened.name} 的用法与购买`} onClick={() => setOpened(null)}>
      <div className="vcfch-itemcard" data-shop-buy={opened.id} onClick={(event) => event.stopPropagation()}>
        <span className="vcfch-itemcard-icon" aria-hidden="true">{(() => {
          const Icon = ITEM_ICONS[opened.id];
          return <Icon size={26}/>;
        })()}</span>
        <b className="vcfch-itemcard-name">{opened.name}</b>
        {/* 用法（用户点名要显示） */}
        <p className="vcfch-itemcard-text">{opened.text}</p>
        <span className="vcfch-itemcard-price">
          {/* 价格行不写「棋魂」：左边的图案就是单位（见 SoulLockable.tsx 里 SoulBuyDialog
              的注释）。视觉上省掉两个字，读屏时由隐藏文本补全。 */}
          <SoulFlame size={17}/>
          <em>{formatSoulAmount(opened.cost)}</em>
          <span className="soul-sr-only">棋魂 / 个</span>
        </span>
        <span className="vcfch-itemcard-have">当前有 {countOf(shop.items, opened.id)} 个</span>
        {error && <p className="soul-buy-error" role="alert">{error}</p>}
        {/* **份数**（用户 2026-10-11：「棋魂商店里面的道具目前无法批量购买」）。
            三个数字按钮而不是"加减 stepper"：这里最长的动作是"买 10 个"，
            点两下就够；stepper 要按十次。
            总价实时显示（单价 × 份数），钱不够时按钮直接禁用 —— 别让他点了才知道不够。 */}
        <div className="vcfch-itemcard-amounts" data-shop-buy-amounts="">
          {[1, 5, 10].map((count) => {
            const total = count * opened.cost;
            const affordable = total <= shop.balance;
            return <button
              key={count}
              type="button"
              className={`vcfch-amount${amount === count ? " on" : ""}`}
              data-shop-buy-amount={count}
              aria-pressed={amount === count}
              disabled={!affordable}
              title={affordable ? `花 ${formatSoulAmount(total)} 棋魂` : `需要 ${formatSoulAmount(total)} 棋魂，现在不够`}
              onClick={() => { setAmount(count); setError(""); }}
            >
              <b>×{count}</b>
              <small>{formatSoulAmount(total)}</small>
            </button>;
          })}
        </div>
        <div className="vcfch-itemcard-actions">
          <button type="button" className="soul-buy-cancel" onClick={() => setOpened(null)}>先不买</button>
          <button
            type="button"
            className="soul-buy-confirm"
            onClick={confirmBuy}
            data-shop-buy-confirm=""
          >买 {amount} 个（{formatSoulAmount(amount * opened.cost)}）</button>
        </div>
      </div>
    </div>}
  </div>;
}

/** 给对弈页徽章用：还有几项外观没解锁（`0` = 全收齐）。 */
export const shopRemainingCount = (unlocks: ReadonlySet<string>): number => {
  const ownable = SOUL_UNLOCKS.filter((item) => !item.consumable);
  return ownable.filter((item) => item.cost > 0 && !unlocks.has(item.id)).length;
};
