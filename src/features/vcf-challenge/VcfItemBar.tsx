/**
 * VCF 挑战的**道具栏**（用户 2026-10-10：「我想搞几个 vcf 挑战的道具，加时卡，提示卡，悔棋卡。
 * 就这三种卡，你可以都做图标，下面是数量，有一个+号，可以知道价格以及用法」）。
 *
 * ## 形态（用户点名的样子）
 *
 * ```
 * ┌────┐ ┌────┐ ┌────┐
 * │⏱ 2 │ │💡 0│ │↺ 1 │  ← 上半：图标 + 数量（点它直接用）
 * ├────┤ ├────┤ ├────┤
 * │ ⊕  │ │ ⊕  │ │ ⊕  │  ← 下半：整条宽的「+」（点它问价与用法）
 * └────┘ └────┘ └────┘
 * ```
 *
 * 三张卡横排、每张 **46×52** —— 2026-10-12 用户第三轮：「那三个道具我觉得完全可以再大
 * 一点，目前感觉有点小，高度完全可以再高一点，那个+号也可以放下面……**不超过左边两个
 * 加起来的高度**（你执xx，x手=xx分）」。所以 52px 这个数是按左块两段实高
 * （「你执」块 + 「N 手 · ≈X 分」那行）之和取的；横向还从 58px 收到 46px，
 * 三颗共 146px，不会把棋盘挤出一屏。
 *
 * ## 买与用的分工（用户 2026-10-10 补充）
 *
 * 「还是在对弈界面去放个商店吧的图标入口吧，和棋魂按钮在一列，vcf 挑战哪里只放道具，
 * 不供购买，除非没有了，然后点击后出现购买弹窗这样的」
 *
 *  · **VCF 页只放道具**：有货时点一下就**直接用**（不弹框，用道具不该被对话框打断）；
 *  · **没货时点它**才弹购买框（用户原话「不供购买，除非没有了」）；
 *  · 「+」永远弹的是**说明 + 价格**（用户要"可以知道价格以及用法"），
 *    它是"想知道这是什么"的入口，不是"买"的入口。
 *
 * 这样三种意图各有各的落点：用（点图标）／问（点 +）／买（没货时点图标，或在商店里买）。
 */

import { useState } from "react";
import { Clock, Lightbulb, Plus, Undo2 } from "lucide-react";
import { SoulFlame } from "../progress/SoulFlame";
import { formatSoulAmount } from "../progress/soul";
import { VCF_ITEMS, countOf, type VcfInventory, type VcfItem, type VcfItemId } from "./items";
import { useSoulShop } from "../progress/use-soul-shop";
/* 样式由组件自带（不放页面 CSS）：这个组件的样式挂在 lazy 页面的 CSS 上就会拿到裸按钮
   （2026-10-13 实测过：对弈页只静态引组件、拿不到 `vcf-challenge.css` ⇒ 70×24 裸按钮）。
   对弈页那三颗卡当天按用户口径撤了（改成操作条直接扣 10 棋魂），但"样式跟组件走"留着。 */
import "./vcf-item-bar.css";

/** 每种道具的图标（`lucide-react`，与项目其它地方同一套）。 */
const ITEM_ICONS: Record<VcfItemId, typeof Clock> = {
  "extra-time": Clock,
  hint: Lightbulb,
  undo: Undo2,
};

export interface VcfItemBarProps {
  /**
   * 点了某个有货的道具。
   *
   * 页面先验证能否使用，再成功保存扣库存，最后执行效果。
   *
   * 第一版是"本组件先扣、再调 onUse"，结果实测出一个漏洞：没落子时点悔棋卡，
   * 调用方拒绝了（"没有可悔的一手"），**但道具已经扣掉了** —— 用户白损失一个。
   * 页面持有局面/手序/阶段，也负责调用 shop.useItem；本组件只转交使用意图。
   */
  onUse: (id: VcfItemId) => boolean;
  /**
   * 当前是否**能用**道具（对局中才为真）。
   *
   * ⚠ 它只控制"用"，**不控制"买"**：没货时不管在哪个阶段都必须能点开购买框
   * （用户：「vcf 挑战哪里只放道具，不供购买，**除非没有了**，然后点击后出现购买弹窗」）。
   * 第一版把 `disabled` 直接绑在这个开关上，结果"没货 + 待开始"时按钮是禁用的、
   * 点不动 —— 而那正是最需要买的时候（门禁抓到的第二个真问题）。
   */
  enabled?: boolean;
}

export function VcfItemBar({ onUse, enabled = true }: VcfItemBarProps) {
  const shop = useSoulShop();
  /**
   * 正在看的那一个（null = 没开）——**说明与购买合成一张卡**（2026-10-11 修）。
   *
   * 上一版是两个 state（`inspecting` / `buying`）→ 两张先后弹出的卡，
   * 于是"点「+」→ 点买一个"要两次点击才成交（用户报的冗余操作，详见下面按钮处的注释）。
   * 现在只剩这一个：它既是"这是什么、多少钱"，也是"买一个"的确认框。
   */
  const [opened, setOpened] = useState<VcfItem | null>(null);
  const [error, setError] = useState("");

  /** 点图标：有货就**直接用**，没货就弹购买。 */
  const handleTap = (item: VcfItem) => {
    const have = countOf(shop.items, item.id);
    if (have <= 0) {
      // **没货 → 永远能弹购买框**，与阶段无关（见 props 里 enabled 的注释）。
      setError("");
      setOpened(item);
      return;
    }
    // 有货：得在能用道具的阶段才给用（待开始/结算后用加时或悔棋没有意义）
    if (!enabled) return;
    onUse(item.id);
  };

  /**
   * 买一个（**当前这张卡上唯一的成交入口**）。
   *
   * 成功后**关掉卡片**：用户的意图已经完成，留着它只会让人怀疑"到底买了没有"。
   * 失败时**留着卡片并把原因写在卡里**（余额不足时他正好在看着价格，就地补钱最快）。
   */
  const buyThis = (item: VcfItem) => {
    const failure = shop.buyItem(item.id);
    if (failure) { setError(failure); return; }
    setError("");
    setOpened(null);
  };

  return <>
    {/* 形态：**一排竖排小卡**（上半图标+数量、下半整宽「+」）。
        体量口径见文件头：用户 2026-10-10 要"压在那一行的高度"，2026-10-12 再放宽到
        "不超过左边两段之和"，于是每颗 46×52（见 vcf-challenge.css 的 .vcfch-item）。

        ⚠ 结构上**不能**把整颗做成 `<button>`、再在里面嵌一个 `<span role="button">` 当加号：
        实测那样点加号时 React 的合成事件会被外层 button 的 onClick 吃掉
        （`elementFromPoint` 命中确实是加号、`stopPropagation` 也写了，但内层 handler 从不触发）。
        所以外层是 `<span>` 容器 + **两个各自独立的真按钮**：
        点上半（图标 + 数量）用道具，点下半（+）问价与用法。
        两个目标都有正确的无障碍语义（原来那套是伪按钮，读屏认不出）。 */}
    <div className="vcfch-items" role="toolbar" aria-label="道具" data-vcf-items="">
      {VCF_ITEMS.map((item) => {
        const Icon = ITEM_ICONS[item.id];
        const have = countOf(shop.items, item.id);
        return <span
          key={item.id}
          className={`vcfch-item${have > 0 ? "" : " is-empty"}`}
          data-vcf-item={item.id}
          data-vcf-item-count={have}
        >
          <button
            type="button"
            className="vcfch-item-use"
            onClick={() => handleTap(item)}
            // 只在"有货但当前不能用"时禁用；没货永远可点（点了弹购买框）
            disabled={have > 0 && !enabled}
            aria-label={have > 0 ? `使用${item.name}（剩 ${have} 个）` : `${item.name} 没有库存，点一下购买`}
            title={have > 0 ? `${item.name}：${item.text}` : `${item.name} 用完了 —— 点一下购买`}
          >
            <span className="vcfch-item-icon" aria-hidden="true"><Icon size={16}/></span>
            <b className={have > 0 ? "" : "empty"}>{have}</b>
          </button>
          {/* 「+」= 问价与用法（用户：「可以知道价格以及用法」）。
              点它进说明（不直接买 —— 买要走确认框）。 */}
          <button
            type="button"
            className="vcfch-item-info"
            aria-label={`${item.name}的价格与用法`}
            data-vcf-item-info={item.id}
            onClick={() => { setError(""); setOpened(item); }}
          ><Plus size={13}/></button>
        </span>;
      })}
    </div>

    {opened && <div className="vcfch-itemback" role="dialog" aria-modal="true" aria-label={`${opened.name} 的用法与购买`} onClick={() => setOpened(null)}>
      {/* 两个 data 属性都挂在这一张卡上（2026-10-11 合成一张之后）：
          · `data-vcf-item-card` —— 「点 + 看用法」那条路的锚点；
          · `data-vcf-item-purchase` —— 「没货 → 购买」那条路的锚点（门禁与既有脚本按它找购买框）。
          以前这是两张卡、两个属性各挂一张；现在只有一张卡，所以两个都挂上，
          让两条路径的调用方都不必改。 */}
      <div
        className="vcfch-itemcard"
        data-vcf-item-card={opened.id}
        data-vcf-item-purchase={opened.id}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="vcfch-itemcard-icon" aria-hidden="true">{(() => {
          const Icon = ITEM_ICONS[opened.id];
          return <Icon size={26}/>;
        })()}</span>
        <b className="vcfch-itemcard-name">{opened.name}</b>
        {/* 用法（用户点名要显示） */}
        <p className="vcfch-itemcard-text">{opened.text}</p>
        <span className="vcfch-itemcard-price">
          {/* 价格行不写「棋魂」：左边的图案就是单位（与 SoulBuyDialog 同一口径，
              见 SoulLockable.tsx 里那段注释）。读屏靠隐藏文本补全。 */}
          <SoulFlame size={17}/>
          <em>{formatSoulAmount(opened.cost)}</em>
          <span className="soul-sr-only">棋魂 / 个</span>
        </span>
        <span className="vcfch-itemcard-have">当前有 {countOf(shop.items, opened.id)} 个</span>
        {error && <p className="soul-buy-error" role="alert">{error}</p>}
        <div className="vcfch-itemcard-actions">
          <button type="button" className="soul-buy-cancel" onClick={() => setOpened(null)}>知道了</button>
          {/* ⚠ 这个按钮**直接买**（2026-10-11 修的一条冗余操作）。
              上一版它只是 `setBuying(inspecting); setInspecting(null)` ——
              也就是"关掉说明、换成购买框"，**并不买东西**；用户点完以为买了、
              结果看到第二个写着「用完了」的框，还得再点一次「买一个」才真的买到。
              用户原话：「点击道具购买时，会出现一个道具不足，然后这个时候还是要点一次，
              即便是有道具，也会出现道具不足的弹窗，然后一共需要点两次买一个才能买到」——
              "道具不足"这个说法就是第二个框那个写死的标题，它跟库存根本无关。
              现在两个框合一：说明与购买是同一张卡，按钮按下去就成交。
              两个 data 属性同样都挂（见卡片上那段注释）。 */}
          <button
            type="button"
            className="soul-buy-confirm"
            onClick={() => buyThis(opened)}
            data-vcf-item-buy=""
            data-vcf-item-confirm=""
          >买一个</button>
        </div>
      </div>
    </div>}
  </>;
}

export type { VcfInventory };
