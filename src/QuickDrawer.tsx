import { useEffect, useRef } from "react";
import { Bot, ChevronRight, Settings, X } from "lucide-react";
import "./quick-drawer.css";

const THEME_OPTIONS = [
  ["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"], ["eye", "护眼"],
  ["mono", "黑白极简"], ["rain", "雨幕"], ["bamboo", "水墨竹林"], ["snow", "雪落"],
  ["porcelain", "青花瓷影"], ["plum", "梅枝映雪"], ["jiangnan", "夜雨江南"],
  ["firefly", "萤火森林"], ["rice", "宣纸留白"], ["pixel", "像素街机"],
  ["cyber", "霓虹赛博"], ["custom", "自定义背景"],
] as const;

const BOARD_OPTIONS = [
  ["wood", "原木棋盘"], ["jade", "玉石棋盘"], ["notebook", "练习本"],
  ["emerald", "翡翠棋盘"], ["porcelain", "青花瓷棋盘"], ["whitejade", "白玉棋盘"],
  ["walnut", "深胡桃木"], ["frosted", "磨砂玻璃"], ["circuit", "电路棋盘"],
  ["minimal", "极简棋盘"],
] as const;

const STONE_OPTIONS = [
  ["classic", "经典棋子"], ["jade", "玉石棋子"], ["yun", "云子棋子"],
  ["ink", "墨蓝棋子"], ["mono", "黑白极简"], ["notebook", "勾叉棋子"],
  ["porcelain", "青花瓷棋子"], ["snow", "雪晶棋子"], ["terminal", "终端字符"],
  ["gold-diamond", "黑钻白金"],
] as const;

interface QuickDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  thinkPopup: boolean;
  onThinkPopupChange: (value: boolean) => void;
  thinkDirectMove: boolean;
  onThinkDirectMoveChange: (value: boolean) => void;
  thinkRunning: boolean;
  thinkResultLabel?: string;
  onThink: () => void;
  onOpenThinkResult: () => void;
  themePreference: string;
  onThemePreferenceChange: (value: string) => void;
  boardTheme: string;
  onBoardThemeChange: (value: string) => void;
  stoneTheme: string;
  onStoneThemeChange: (value: string) => void;
}

function ToggleRow({ title, text, checked, disabled = false, onChange }: {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className={`quick-drawer-toggle ${disabled ? "disabled" : ""}`}>
    <span><b>{title}</b><small>{text}</small></span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>
    <i aria-hidden="true"/>
  </label>;
}

function ChoiceRow({ title, text, value, options, onChange }: {
  title: string;
  text: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return <label className="quick-choice-row">
    <span><b>{title}</b><small>{text}</small></span>
    <select aria-label={`选择${title}`} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  </label>;
}

export function QuickDrawer({
  open, onClose, title, subtitle, thinkPopup, onThinkPopupChange,
  thinkDirectMove, onThinkDirectMoveChange, thinkRunning, thinkResultLabel,
  onThink, onOpenThinkResult, themePreference, onThemePreferenceChange,
  boardTheme, onBoardThemeChange, stoneTheme, onStoneThemeChange,
}: QuickDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") || []);
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return <div className="quick-drawer-layer">
    <button className="quick-drawer-scrim" type="button" onClick={onClose} aria-label="关闭快捷中心"/>
    <aside ref={panelRef} id="quick-drawer" className="quick-drawer-panel" role="dialog" aria-modal="true" aria-label="快捷中心">
      <header className="quick-drawer-head">
        <img src="./icon.svg" alt=""/>
        <div><b>快捷中心</b><small>思考与外观</small></div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭快捷中心"><X size={20}/></button>
      </header>

      <section className="quick-drawer-current">
        <span>当前</span>
        <b>{title}</b>
        <small>{subtitle}</small>
      </section>

      <section className="quick-drawer-section quick-think-card">
        <div className="quick-drawer-section-title"><span><Bot size={16}/></span><div><b>思考助手</b><small>{thinkDirectMove ? "完成后直接创建推荐落点" : "分析当前局面并给出推荐"}</small></div></div>
        <button className={`quick-think-action ${thinkRunning ? "running" : ""}`} type="button" onClick={onThink}>
          <span>{thinkRunning ? <X size={19}/> : <Bot size={19}/>}</span>
          <div><b>{thinkRunning ? "中断当前思考" : "立即思考当前局面"}</b><small>{thinkRunning ? "点击后立即停止，本次不会自动落子" : thinkDirectMove ? "完成后直接落子并形成修改" : thinkPopup ? "完成后展示详细结果面板" : "完成后只在棋盘标出推荐点"}</small></div>
          {!thinkRunning && <ChevronRight size={18}/>}
        </button>
        {thinkResultLabel && !thinkRunning && !thinkDirectMove && <button className="quick-think-result" type="button" onClick={onOpenThinkResult}><span>荐</span><div><b>查看上次结果</b><small>推荐落点 {thinkResultLabel}</small></div><ChevronRight size={18}/></button>}
        <ToggleRow title="思考后直接落子" text="跳过推荐确认，自动在当前棋谱创建落点" checked={thinkDirectMove} onChange={onThinkDirectMoveChange}/>
        <ToggleRow title="思考后弹出面板" text={thinkDirectMove ? "直接落子开启时暂不弹出" : "关闭后只在棋盘标出推荐点"} checked={thinkPopup} disabled={thinkDirectMove} onChange={onThinkPopupChange}/>
      </section>

      <section className="quick-drawer-section quick-visual-card">
        <div className="quick-drawer-section-title"><span><Settings size={16}/></span><div><b>外观选择</b><small>修改后立即生效并保存在本机</small></div></div>
        <div className="quick-choice-list">
          <ChoiceRow title="应用主题" text="页面颜色与氛围" value={themePreference} options={THEME_OPTIONS} onChange={onThemePreferenceChange}/>
          <ChoiceRow title="棋盘" text="棋盘材质与网格" value={boardTheme} options={BOARD_OPTIONS} onChange={onBoardThemeChange}/>
          <ChoiceRow title="棋子" text="黑白棋子的视觉样式" value={stoneTheme} options={STONE_OPTIONS} onChange={onStoneThemeChange}/>
        </div>
      </section>
    </aside>
  </div>;
}
