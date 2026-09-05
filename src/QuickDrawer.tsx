import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, Play, Settings, X } from "lucide-react";
import type { BoardTheme, StoneTheme, ThemePreference } from "./app-shell-types";
import type { PlaybackBranchPolicy, PlaybackSpeed } from "./features/research/record-playback";
import { useOverlayHistory } from "./ui/overlays/useOverlayHistory";
import "./quick-drawer.css";

const THEME_OPTIONS = [
  ["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"], ["eye", "护眼"],
  ["mono", "黑白极简"], ["rain", "雨幕"], ["bamboo", "水墨竹林"], ["snow", "雪落"],
  ["porcelain", "青花瓷影"], ["plum", "梅枝映雪"], ["jiangnan", "夜雨江南"],
  ["firefly", "萤火森林"], ["rice", "宣纸留白"], ["pixel", "像素街机"],
  ["cyber", "霓虹赛博"], ["custom", "自定义背景"],
  ["blackgold", "尊贵黑金"], ["pale", "苍白世界"], ["kawaii", "卡哇伊"],
  ["aurora", "极光"], ["deepsea", "深海幽蓝"], ["baroque", "巴洛克"],
] as const;

const BOARD_OPTIONS = [
  ["wood", "原木棋盘"], ["jade", "玉石棋盘"], ["notebook", "练习本"],
  ["emerald", "翡翠棋盘"], ["porcelain", "青花瓷棋盘"], ["whitejade", "白玉棋盘"],
  ["walnut", "深胡桃木"], ["frosted", "磨砂玻璃"], ["circuit", "电路棋盘"],
  ["minimal", "极简棋盘"],
  ["blackgold", "尊贵黑金棋盘"], ["pale", "苍白世界棋盘"],
  ["kawaii", "卡哇伊棋盘"], ["aurora", "极光棋盘"],
] as const;

const STONE_OPTIONS = [
  ["classic", "经典棋子"], ["jade", "玉石棋子"], ["yun", "云子棋子"],
  ["ink", "墨蓝棋子"], ["mono", "黑白极简"], ["notebook", "勾叉棋子"],
  ["porcelain", "青花瓷棋子"], ["snow", "雪晶棋子"], ["terminal", "终端字符"],
  ["gold-diamond", "黑钻白金"],
  ["gold", "鎏金棋子"], ["diamond", "钻石棋子"],
  ["blackgold", "尊贵黑金棋子"], ["pale", "苍白世界棋子"],
  ["kawaii", "卡哇伊棋子"], ["aurora", "极光棋子"],
] as const;

const PLAYBACK_SPEED_OPTIONS = [
  ["0.5", "0.5×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"],
] as const;

const PLAYBACK_BRANCH_OPTIONS = [
  ["pause", "遇分支暂停"], ["mainline", "沿主线继续"],
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
  playbackSpeed: PlaybackSpeed;
  onPlaybackSpeedChange: (value: PlaybackSpeed) => void;
  playbackBranchPolicy: PlaybackBranchPolicy;
  onPlaybackBranchPolicyChange: (value: PlaybackBranchPolicy) => void;
  playbackLoop: boolean;
  onPlaybackLoopChange: (value: boolean) => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (value: ThemePreference) => void;
  boardTheme: BoardTheme;
  onBoardThemeChange: (value: BoardTheme) => void;
  stoneTheme: StoneTheme;
  onStoneThemeChange: (value: StoneTheme) => void;
  defaultBoardSize: number;
  onDefaultBoardSizeChange: (value: number) => void;
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

function ChoiceRow<T extends string>({ title, text, value, options, onChange }: {
  title: string;
  text: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return <label className="quick-choice-row">
    <span><b>{title}</b><small>{text}</small></span>
    <select className={title === "默认棋盘大小" ? "board-size-select" : undefined} aria-label={`选择${title}`} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  </label>;
}

export function QuickDrawer({
  open, onClose, title, subtitle, thinkPopup, onThinkPopupChange,
  thinkDirectMove, onThinkDirectMoveChange, thinkRunning, thinkResultLabel,
  onThink, onOpenThinkResult, themePreference, onThemePreferenceChange,
  playbackSpeed, onPlaybackSpeedChange, playbackBranchPolicy, onPlaybackBranchPolicyChange,
  playbackLoop, onPlaybackLoopChange, boardTheme, onBoardThemeChange, stoneTheme, onStoneThemeChange,
  defaultBoardSize, onDefaultBoardSizeChange,
}: QuickDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ playback: false, think: false, visual: true });
  const boardSizeOptions = Array.from({ length: 17 }, (_, index) => { const size = index + 5; return [String(size), `${size}路`] as const; });
  const toggleSection = (key: string) => setExpandedSections((value) => ({ ...value, [key]: !value[key] }));

  // System back closes the drawer first instead of exiting the app.
  useOverlayHistory(open, onClose);

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
        <div><b>快捷中心</b><small>思考、演示与外观</small></div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭快捷中心"><X size={20}/></button>
      </header>

      <section className="quick-drawer-current">
        <span>当前</span>
        <b>{title}</b>
        <small>{subtitle}</small>
      </section>

      <section className={`quick-drawer-section quick-playback-card ${expandedSections.playback ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("playback")} aria-expanded={expandedSections.playback}><span><Play size={16}/></span><div><b>自动演示</b><small>主界面只保留播放按钮，这里调整演示方式</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.playback && <>
        <div className="quick-choice-list">
          <ChoiceRow title="播放速度" text="每步之间的等待时间" value={String(playbackSpeed)} options={PLAYBACK_SPEED_OPTIONS} onChange={(value) => onPlaybackSpeedChange(Number(value) as PlaybackSpeed)}/>
          <ChoiceRow title="分支处理" text="遇到多个后续时的行为" value={playbackBranchPolicy} options={PLAYBACK_BRANCH_OPTIONS} onChange={(value) => onPlaybackBranchPolicyChange(value as PlaybackBranchPolicy)}/>
        </div>
        <ToggleRow title="循环当前变化" text="到末尾后回到本次播放起点继续" checked={playbackLoop} onChange={onPlaybackLoopChange}/>
        </>}</section>

      <section className={`quick-drawer-section quick-think-card ${expandedSections.think ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("think")} aria-expanded={expandedSections.think}><span><Bot size={16}/></span><div><b>思考助手</b><small>{thinkDirectMove ? "完成后直接创建推荐落点" : "分析当前局面并给出推荐"}</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.think && <>
        <button className={`quick-think-action ${thinkRunning ? "running" : ""}`} type="button" onClick={onThink}>
          <span>{thinkRunning ? <X size={19}/> : <Bot size={19}/>}</span>
          <div><b>{thinkRunning ? "中断当前思考" : "立即思考当前局面"}</b><small>{thinkRunning ? "点击后立即停止，本次不会自动落子" : thinkDirectMove ? "完成后直接落子并形成修改" : thinkPopup ? "完成后展示详细结果面板" : "完成后只在棋盘标出推荐点"}</small></div>
          {!thinkRunning && <ChevronRight size={18}/>}
        </button>
        {thinkResultLabel && !thinkRunning && !thinkDirectMove && <button className="quick-think-result" type="button" onClick={onOpenThinkResult}><span>荐</span><div><b>查看上次结果</b><small>推荐落点 {thinkResultLabel}</small></div><ChevronRight size={18}/></button>}
        <ToggleRow title="思考后直接落子" text="跳过推荐确认，自动在当前棋谱创建落点" checked={thinkDirectMove} onChange={onThinkDirectMoveChange}/>
        <ToggleRow title="思考后弹出面板" text={thinkDirectMove ? "直接落子开启时暂不弹出" : "关闭后只在棋盘标出推荐点"} checked={thinkPopup} disabled={thinkDirectMove} onChange={onThinkPopupChange}/>
        </>}</section>

      <section className={`quick-drawer-section quick-visual-card ${expandedSections.visual ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("visual")} aria-expanded={expandedSections.visual}><span><Settings size={16}/></span><div><b>外观选择</b><small>修改后立即生效并保存在本机</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.visual && <>
        <div className="quick-choice-list">
          <ChoiceRow title="应用主题" text="页面颜色与氛围" value={themePreference} options={THEME_OPTIONS} onChange={onThemePreferenceChange}/>
          <ChoiceRow title="棋盘" text="棋盘材质与网格" value={boardTheme} options={BOARD_OPTIONS} onChange={onBoardThemeChange}/>
          <ChoiceRow title="棋子" text="黑白棋子的视觉样式" value={stoneTheme} options={STONE_OPTIONS} onChange={onStoneThemeChange}/>
          <ChoiceRow title="默认棋盘大小" text="新建棋谱时使用的路数（默认15路）" value={String(defaultBoardSize)} options={boardSizeOptions} onChange={(value) => onDefaultBoardSizeChange(Number(value))}/>
        </div>
        </>}</section>
    </aside>
  </div>;
}
