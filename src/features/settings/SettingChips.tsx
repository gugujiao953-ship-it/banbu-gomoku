import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import "./setting-chips.css";

/**
 * 横向开关条（用户 2026-10-09：「整理一下那个放很多开关的设置页地方…搞成几个板块，
 * 是横向排布的按钮，分好类别」）。
 *
 * ## 为什么需要它
 *
 * 「可选增强功能」分区原来是一串**竖直罗列的大开关行**（每行 66px 高、左边标题右边拨杆、
 * 说明还很长），十几项连下来要滚好几屏，同类项之间也没有分组。现在做成**分类板块 + 横向芯片**：
 *   · 板块（`SettingChipGroup`）：一个小标题 + 一行或几行横向芯片；
 *   · 芯片（`SettingChip`）：点一下切开关，选中态用主色描边 + 浅底。
 *
 * ## 说明文字怎么给（2026-10-09 第二轮，用户实测反馈）
 *
 * 第一版把每枚芯片的长说明**只留给屏幕阅读器**（视觉隐藏）——用户的原话是
 * 「长按的说明我咋没看到」。那是**真问题**：说明里写的正是这类功能的用法
 * （比如「长按已有棋子呼出菜单，电脑上按住不放同样呼出」），藏起来等于没写。
 *
 * 现在改成**名字右侧一枚 ⓘ**：点它弹一个小浮层显示这条的完整说明。
 * 平时不占高度（芯片仍是一行 34px，一屏能看完），要读的时候点一下就有。
 *
 * ⚠ 两个必须保住的结构约定（写错了会红门禁，理由都在下面）：
 *
 * 1. **外壳带 `.setting-row`、内含真 `input[type=checkbox]`**：
 *    `qa/recognition-parallel-parity.mjs` 的选择器是
 *    `.enhancement-settings .setting-row:has-text("识谱多核加速")` 再取 `input[type=checkbox]`。
 *    所以外壳保留 `setting-row` 类名、checkbox 仍在外壳内部，只是版式换成了药丸。
 *
 * 2. **说明 `<small>` 不能 `display:none`**：同一条门禁要 `row.locator("small").first().innerText()`
 *    并断言长度 ≥12；实测 `display:none` 会让 `innerText` 读不到它。所以它仍是**视觉隐藏**
 *    （`position:absolute` + 1px + `clip`），`textContent`/`innerText` 照读，屏幕阅读器也照念——
 *    ⓘ 浮层只是把同一段文字**又显式显示一遍**给人看。
 *
 * ## 为什么 ⓘ 放在 label **外面**
 *
 * `<label>` 里嵌 `<button>` 是非法 HTML（label 只该包它标注的那个控件）。实测 Chromium
 * 能用（点按钮不会顺带切换开关），但既然有合法写法就没必要赌——所以结构是
 * 「外壳(药丸) > [ label(标题+说明+checkbox) , ⓘ按钮 ]」，两件事互不干扰，
 * 门禁要的 `input` 与 `small` 也都还在这个外壳里。
 *
 * ## 无障碍
 *
 * label 包着真 checkbox：键盘 Tab 能聚焦、空格能切换、屏幕阅读器念「标题 + 说明 + 已选中」；
 * ⓘ 是独立的 `<button>` 带 `aria-label`，Tab 可达、回车/空格可开。
 */

/** 一个分类板块：小标题 + 一句话说明 + 芯片们。 */
export function SettingChipGroup({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  return (
    <section className="setting-chip-group">
      <header className="setting-chip-group-head">
        <b>{title}</b>
        {summary && <small>{summary}</small>}
      </header>
      <div className="setting-chip-row">{children}</div>
    </section>
  );
}

/**
 * 单枚芯片开关。`title` 是设置页里的完整标题（跨门禁按它核对，别截断），
 * `text` 是这条开关做什么的完整说明（芯片内视觉隐藏、点 ⓘ 弹出显示）。
 */
export function SettingChip({ title, text, checked, disabled = false, onChange }: {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <>
      <span className={`setting-row setting-chip${checked ? " on" : ""}${disabled ? " disabled" : ""}`}>
        <label className="setting-chip-main">
          {/* 标题整串留在 DOM；说明走视觉隐藏（见文件头注 2）。 */}
          <b className="setting-chip-title">{title}</b>
          <small className="setting-chip-note">{text}</small>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>
          <i className="setting-chip-mark" aria-hidden="true"/>
        </label>
        <button
          type="button"
          className="setting-chip-info"
          data-chip-info={title}
          /**
           * ⚠ aria-label 里**不要再写这项的标题**：门禁用 `getByLabel("AI 棋盘提示点")`
           * 找那一行的复选框，若 ⓘ 的 aria-label 也含这串文字，Playwright 会判
           * 「strict mode violation: resolved to 2 elements」而让整条门禁挂掉（实测踩到）。
           * 所以这里只写「查看说明」，具体是哪一项由浮层标题与 `data-chip-info` 表达。
           */
          aria-label="查看这一项的说明"
          title="查看这一项的说明"
          onClick={() => setNoteOpen(true)}
        >
          <Info size={13} aria-hidden="true"/>
        </button>
      </span>
      {noteOpen && <BottomSheet title={title} manageHistory onClose={() => setNoteOpen(false)}>
        <div className="sheet-body chip-note-sheet">
          <p className="chip-note-text">{text}</p>
          <p className="chip-note-state">当前状态：<b>{checked ? "已开启" : "已关闭"}</b></p>
          <button type="button" className="primary-button" onClick={() => { onChange(!checked); setNoteOpen(false); }}>
            {checked ? "关闭这一项" : "开启这一项"}
          </button>
          <button type="button" className="secondary-button" onClick={() => setNoteOpen(false)}>知道了</button>
        </div>
      </BottomSheet>}
    </>
  );
}
