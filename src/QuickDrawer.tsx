import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { SoundSettings } from "./audio-settings";
import type { SoundCue } from "./audio-engine";
import { Accessibility, ArchiveRestore, BookOpen, Check, ChevronDown, ChevronRight, Compass, DatabaseBackup, Download, Eye, Gauge, GripVertical, Info, Mail, MonitorPlay, Palette, Play, RotateCw, Save, Settings, SlidersHorizontal, Upload, X } from "lucide-react";
import type { BoardTheme, StoneTheme, ThemePreference } from "./app-shell-types";
import type { LatestRelease } from "./update-check";
import { fmtAnalysisMemory, getAnalysisMode, withAnalysisMode, type AnalysisCandidateMetric, type AnalysisMode, type EnhancementSettings } from "./enhancement-settings";
import type { FontScale } from "./accessibility";
import type { PlaybackBranchPolicy, PlaybackSpeed } from "./features/research/record-playback";
import { QUICK_DRAWER_ITEMS, QUICK_DRAWER_SECTIONS, isQuickDrawerItemVisible, loadQuickDrawerPrefs, moveQuickDrawerItem, moveQuickDrawerSection, orderQuickDrawerItems, orderQuickDrawerSections, saveQuickDrawerPrefs, toggleQuickDrawerItem, toggleQuickDrawerSection, quickDrawerSectionItemIds, type QuickDrawerPrefs, type QuickDrawerSectionId } from "./quick-drawer-customization";
import { useOverlayHistory } from "./ui/overlays/useOverlayHistory";
import "./quick-drawer.css";
import { APP_VERSION } from "./diagnostics";

type AiEngineChoice = "light" | "strong" | "tuned";

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
  onOpenLayout?: () => void;
  suspended?: boolean;
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  updateRelease: LatestRelease | null;
  onCheckUpdate?: () => Promise<LatestRelease | null>;
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
  // 声音与音效（用户 09-13）：快捷中心直接调开关/音量/试听，与设置页同源。
  soundSettings: SoundSettings;
  onSoundSettingsChange: (value: SoundSettings) => void;
  onPreviewSound: (cue: SoundCue) => void;
  enhancementSettings: EnhancementSettings;
  thinkingIndicatorPosition: "corner" | "below";
  onThinkingIndicatorPositionChange: (value: "corner" | "below") => void;
  onEnhancementSettingsChange: (value: EnhancementSettings) => boolean | void;
  aiEngineChoice: AiEngineChoice;
  enginePackReady: boolean;
  onAiEngineChoiceChange: (value: AiEngineChoice) => void;
  // 2026-09-10 复选 7：快捷中心扩到所有设置项（棋盘显示 / 无障碍 / 数据 / 手册入口）。
  showNumbers: boolean;
  onShowNumbersChange: (value: boolean) => void;
  showCoordinates: boolean;
  onShowCoordinatesChange: (value: boolean) => void;
  showForbidden: boolean;
  onShowForbiddenChange: (value: boolean) => void;
  showLastMove: boolean;
  onShowLastMoveChange: (value: boolean) => void;
  moveNumberScale: number;
  onMoveNumberScaleChange: (value: number) => void;
  gridLineWidth: number;
  onGridLineWidthChange: (value: number) => void;
  coordinateFontSize: number;
  onCoordinateFontSizeChange: (value: number) => void;
  fontScale: FontScale;
  onFontScaleChange: (value: FontScale) => void;
  restoreLastPosition: boolean;
  onRestoreLastPositionChange: (value: boolean) => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
  onBackup: () => void;
  onRestoreBackup: () => void;
  onOpenHelp: () => void;
  onOpenTour: () => void;
  onOpenManual: () => void;
  onOpenFeedback: () => void;
  onOpenAbout: () => void;
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
  open, onClose, title, subtitle, updateRelease, onCheckUpdate, themePreference, onThemePreferenceChange,
  playbackSpeed, onPlaybackSpeedChange, playbackBranchPolicy, onPlaybackBranchPolicyChange,
  playbackLoop, onPlaybackLoopChange, boardTheme, onBoardThemeChange, stoneTheme, onStoneThemeChange,
  defaultBoardSize, onDefaultBoardSizeChange, onOpenLayout, suspended = false,
  soundSettings, onSoundSettingsChange, onPreviewSound,
  enhancementSettings, onEnhancementSettingsChange,
  thinkingIndicatorPosition, onThinkingIndicatorPositionChange,
  aiEngineChoice, enginePackReady, onAiEngineChoiceChange,
  showNumbers, onShowNumbersChange, showCoordinates, onShowCoordinatesChange,
  showForbidden, onShowForbiddenChange, showLastMove, onShowLastMoveChange,
  moveNumberScale, onMoveNumberScaleChange, gridLineWidth, onGridLineWidthChange,
  coordinateFontSize, onCoordinateFontSizeChange,
  fontScale, onFontScaleChange, restoreLastPosition, onRestoreLastPositionChange,
  onOpenImport, onOpenExport, onBackup, onRestoreBackup, onOpenHelp,
  onOpenTour, onOpenManual, onOpenFeedback, onOpenAbout,
}: QuickDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // 左滑关闭（用户 09-14）：面板从右侧滑出，横向左滑超过阈值即关闭。
  // 手势只在「水平位移明显大于垂直」时接管，避免与面板内部纵向滚动打架。
  const swipe = useRef<{ id: number; startX: number; startY: number; dx: number; active: boolean; decided: boolean; startedAt: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeClosing, setSwipeClosing] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const drawerState = useRef({ open, suspended });
  // 自调内存输入框（非受控，读 DOM 提交；滑杆拖动用 ref 同步显示）。
  const memoryNumberRef = useRef<HTMLInputElement | null>(null);
  drawerState.current = { open, suspended };
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ playback: false, analysis: false, visual: false, board: false, accessibility: false, data: false, misc: false });
  // 底部「检查更新」（用户 09-13）：状态只在打开快捷中心期间存在，启动检查的结果
  // 通过 updateRelease 传入（有更新时按钮右上角冒红点）。
  const [updateCheckState, setUpdateCheckState] = useState<"idle" | "checking" | "latest" | "failed">("idle");
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null);
  const runManualUpdateCheck = async () => {
    if (!onCheckUpdate || updateCheckState === "checking") return;
    setUpdateCheckState("checking");
    const release = await onCheckUpdate();
    if (!release) { setUpdateCheckState("failed"); return; }
    setCheckedVersion(release.version);
    setUpdateCheckState("latest");
  };
  // 快捷中心自定义：本机持久化「隐藏了哪些项」，默认全部显示。
  const [drawerPrefs, setDrawerPrefs] = useState<QuickDrawerPrefs>(() => loadQuickDrawerPrefs());
  const [customizing, setCustomizing] = useState(false);
  // 自定义面板内的条目排序（用户 09-13）：拖动把手换序，同分类内生效，落盘到 prefs.order。
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [dropItem, setDropItem] = useState<string | null>(null);
  // 自定义面板内的主目录排序与分组展开（用户 09-13）
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  const [dropSection, setDropSection] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // 一键展开 / 收起全部分类（用户 09-13）：作用于「自定义」面板内的主目录折叠，
  // 与条目显隐（全部显示/隐藏）是两件事，互不影响。
  const setAllGroupsCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const section of QUICK_DRAWER_SECTIONS) next[section.id] = collapsed;
    setCollapsedGroups(next);
  };
  const reorderItem = (id: string, targetId: string, position: "before" | "after") => updateDrawerPrefs(moveQuickDrawerItem(drawerPrefs, id, targetId, position));
  // 长按拖拽（用户 09-13：兼容双指——一根手指按住把手时，另一根手指仍可滑动列表）。
  // 思路：把手 pointerdown 后先起 220ms 定时器；期间只要出现第二根手指（或手指移动
  // 超过阈值）就放弃拖拽，把滚动权交还给列表；长按成立才锁定拖拽。
  const dragHold = useRef<{ id: string; kind: "item" | "section"; timer: number; startX: number; startY: number } | null>(null);
  const beginHold = (event: React.PointerEvent, id: string, kind: "item" | "section") => {
    if (event.pointerType === "mouse") {
      // 鼠标无需长按，直接进入拖拽态
      if (kind === "item") setDraggingItem(id); else setDraggingSection(id);
      return;
    }
    const timer = window.setTimeout(() => { if (kind === "item") setDraggingItem(id); else setDraggingSection(id); }, 220);
    dragHold.current = { id, kind, timer, startX: event.clientX, startY: event.clientY };
  };
  const cancelHold = () => { if (dragHold.current) { window.clearTimeout(dragHold.current.timer); dragHold.current = null; } };
  const trackHold = (event: React.PointerEvent) => {
    const hold = dragHold.current;
    if (!hold) return;
    if (Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > 12) cancelHold();
  };

  const itemVisible = (id: string) => isQuickDrawerItemVisible(drawerPrefs, id);
  const sectionVisible = (section: string) => QUICK_DRAWER_ITEMS.some((item) => item.section === section && itemVisible(item.id));
  const sectionAllHidden = (section: QuickDrawerSectionId) => quickDrawerSectionItemIds(section).every((id) => !itemVisible(id));
  // 抽屉正文的渲染顺序（用户 09-13）：按用户自定义 order 给「可见条目」排名，
  // 各分区在 JSX 里保留自己的行，但同区内按该名次排——即自定义面板拖出的顺序
  // 会直接反映到快捷中心本体。
  const visibleRank = new Map(orderQuickDrawerItems(QUICK_DRAWER_ITEMS, drawerPrefs.order).map((item, index) => [item.id, index]));
  const rankOf = (id: string) => visibleRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const updateDrawerPrefs = (next: QuickDrawerPrefs) => { saveQuickDrawerPrefs(next); setDrawerPrefs(next); };
  const boardSizeOptions = Array.from({ length: 17 }, (_, index) => { const size = index + 5; return [String(size), `${size}路`] as const; });
  const toggleSection = (key: string) => setExpandedSections((value) => ({ ...value, [key]: !value[key] }));

  // System back closes the drawer first instead of exiting the app.
  useOverlayHistory(open, onClose);

  // 左滑关闭手势（用户 09-14）：拖动时面板实时跟手（位移上限为面板宽度），
  // 松手按「位移过半 / 甩动速度足够」决定关闭，否则回弹。触屏与鼠标拖动通用。
  const SWIPE_CLOSE_PX = 72;      // 至少滑这么远才可能触发关闭
  const SWIPE_FLICK_VELOCITY = 0.5; // px/ms，快速甩动即便位移不足也关闭
  const panelWidth = () => panelRef.current?.offsetWidth ?? 300;

  const onSwipeStart = (event: React.PointerEvent<HTMLElement>) => {
    if (suspended || swipeClosing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipe.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, active: false, decided: false, startedAt: performance.now() };
  };

  const onSwipeMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = swipe.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.decided) {
      // 先判定方向：水平意图（|dx| > |dy|）才接管，否则让给纵向滚动。
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      state.decided = true;
      state.active = Math.abs(dx) > Math.abs(dy) && dx < 0; // 只认向左滑
      if (state.active) event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (!state.active) return;
    // 只允许向左：右滑不跟手（面板本就在左侧，向右无意义）。
    state.dx = Math.min(0, dx);
    setSwipeOffset(state.dx);
  };

  const endSwipe = (event: React.PointerEvent<HTMLElement>) => {
    const state = swipe.current;
    if (!state || state.id !== event.pointerId) return;
    swipe.current = null;
    if (!state.active) { setSwipeOffset(0); return; }
    const elapsed = Math.max(1, performance.now() - state.startedAt);
    const velocity = Math.abs(state.dx) / elapsed;
    const passed = Math.abs(state.dx) >= Math.max(SWIPE_CLOSE_PX, panelWidth() / 2);
    if (passed || velocity >= SWIPE_FLICK_VELOCITY) {
      // 顺势滑出到屏幕外，再真正关闭，避免松手后弹回造成割裂感。
      setSwipeClosing(true);
      setSwipeOffset(-panelWidth() - 24);
      window.setTimeout(() => { setSwipeClosing(false); setSwipeOffset(0); onClose(); }, 180);
      return;
    }
    setSwipeOffset(0);
  };

  useEffect(() => {
    if (!open || suspended) return undefined;
    if (!previousFocus.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      if (!drawerState.current.open) {
        previousFocus.current?.focus({ preventScroll: true });
        previousFocus.current = null;
      }
    };
  }, [open, suspended]);

  if (!open) return null;

  return <div className="quick-drawer-layer" style={suspended ? { display: "none" } : undefined}>
    <button className="quick-drawer-scrim" type="button" onClick={onClose} aria-label="关闭快捷中心"/>
    <aside ref={panelRef} id="quick-drawer"
      className={`quick-drawer-panel${swipeClosing ? " swipe-closing" : ""}${swipeOffset !== 0 ? " swiping" : ""}`}
      style={swipeOffset !== 0 ? { transform: `translateX(${swipeOffset}px)`, animation: "none" } : undefined}
      onPointerDown={onSwipeStart} onPointerMove={onSwipeMove} onPointerUp={endSwipe}
      onPointerCancel={endSwipe} onLostPointerCapture={endSwipe}
      role="dialog" aria-modal="true" aria-label="快捷中心">
      <header className="quick-drawer-head">
        <span className="quick-drawer-logo"><img src="./icon.svg" alt=""/><small>v{APP_VERSION}</small></span>
        <div><b>{customizing ? "自定义" : "快捷中心"}</b><small>{customizing ? "勾选要出现在这里的项" : "分析、演示与外观"}</small></div>
        {updateRelease && !customizing && <a className="quick-drawer-update" href={updateRelease.url} target="_blank" rel="noreferrer" title={`前往下载 ${updateRelease.version}`}>新版本<span className="update-dot" aria-hidden="true"/></a>}
        <button type="button" className={`quick-drawer-customize ${customizing ? "on" : ""}`} onClick={() => setCustomizing((value) => !value)} aria-label={customizing ? "完成自定义快捷方式" : "自定义快捷方式"} aria-pressed={customizing} title={customizing ? "完成" : "自定义快捷方式"}>{customizing ? <Check size={18}/> : <SlidersHorizontal size={18}/>}</button>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭快捷中心"><X size={20}/></button>
      </header>

      <section className="quick-drawer-current">
        <span>当前</span>
        <b>{title}</b>
        <small>{subtitle}</small>
      </section>
      {customizing && <div className="quick-drawer-customize-list">
        <p className="quick-drawer-customize-note">勾选要出现在快捷中心的项，并可拖动左侧把手调整顺序。这些功能在「设置」里都有同一项；每个分类可一键「全部显示 / 全部隐藏」。</p>
        <div className="quick-drawer-customize-actions">
          <button type="button" onClick={() => updateDrawerPrefs({ hidden: [], v: 2 })}>全部显示</button>
          <button type="button" onClick={() => updateDrawerPrefs({ hidden: QUICK_DRAWER_ITEMS.map((item) => item.id), v: 2 })}>全部隐藏</button>
          <button type="button" onClick={() => setAllGroupsCollapsed(false)}>全部展开</button>
          <button type="button" onClick={() => setAllGroupsCollapsed(true)}>全部收起</button>
        </div>
        {orderQuickDrawerSections(QUICK_DRAWER_SECTIONS, drawerPrefs.sectionOrder).map((section) => {
          const items = orderQuickDrawerItems(QUICK_DRAWER_ITEMS.filter((item) => item.section === section.id), drawerPrefs.order);
          if (!items.length) return null;
          const allHidden = sectionAllHidden(section.id);
          return <section key={section.id} className={`quick-drawer-customize-group${allHidden ? " all-hidden" : ""}`}>
            <div className={`quick-drawer-customize-group-head${dropSection === section.id ? " drop-target" : ""}`}
              onDragOver={(event) => { if (!draggingSection || draggingSection === section.id) return; event.preventDefault(); setDropSection(section.id); }}
              onDrop={(event) => { event.preventDefault(); if (draggingSection && draggingSection !== section.id) updateDrawerPrefs(moveQuickDrawerSection(drawerPrefs, draggingSection as QuickDrawerSectionId, section.id)); setDraggingSection(null); setDropSection(null); }}
              onDragEnd={() => { setDraggingSection(null); setDropSection(null); }}>
              <span className={`quick-drawer-sort-grip section-grip${draggingSection === section.id ? " dragging" : ""}`} draggable title={`拖动调整「${section.title}」分类的顺序`} aria-label={`拖动调整「${section.title}」分类的顺序`} onDragStart={() => setDraggingSection(section.id)} onPointerDown={(event) => beginHold(event, section.id, "section")} onPointerMove={trackHold} onPointerUp={cancelHold} onPointerCancel={cancelHold}><GripVertical aria-hidden="true"/></span>
              <button type="button" className="quick-drawer-group-collapse" aria-expanded={!collapsedGroups[section.id]} aria-label={`${collapsedGroups[section.id] ? "展开" : "收起"}「${section.title}」`} title={collapsedGroups[section.id] ? "展开此分类" : "收起此分类"} onClick={() => setCollapsedGroups((value) => ({ ...value, [section.id]: !value[section.id] }))}>{collapsedGroups[section.id] ? <ChevronRight aria-hidden="true"/> : <ChevronDown aria-hidden="true"/>}</button>
              <h3>{section.title}</h3>
              <button type="button" className="quick-drawer-customize-section-toggle" onClick={() => updateDrawerPrefs(toggleQuickDrawerSection(drawerPrefs, section.id))} aria-pressed={!allHidden} title={allHidden ? "全部显示此分类" : "全部隐藏此分类"}>{allHidden ? "全部显示" : "全部隐藏"}</button>
            </div>
            {!collapsedGroups[section.id] && items.map((item) => <div key={item.id} className={`quick-drawer-sortable ${draggingItem === item.id ? "dragging" : ""} ${dropItem === item.id ? "drop-target" : ""}`}
              onDragOver={(event) => { if (!draggingItem || draggingItem === item.id) return; event.preventDefault(); setDropItem(item.id); }}
              onDrop={(event) => { event.preventDefault(); if (draggingItem && draggingItem !== item.id) reorderItem(draggingItem, item.id, "before"); setDraggingItem(null); setDropItem(null); }}
              onDragEnd={() => { setDraggingItem(null); setDropItem(null); }}>
              <span className="quick-drawer-sort-grip" draggable title={`按住拖动调整「${item.label}」的顺序`} aria-label={`按住拖动调整「${item.label}」的顺序`} onDragStart={() => setDraggingItem(item.id)} onPointerDown={(event) => beginHold(event, item.id, "item")} onPointerMove={trackHold} onPointerUp={cancelHold} onPointerCancel={cancelHold}><GripVertical aria-hidden="true"/></span>
              <ToggleRow title={item.label} text={item.hint} checked={itemVisible(item.id)} onChange={() => updateDrawerPrefs(toggleQuickDrawerItem(drawerPrefs, item.id))}/>
            </div>)}
          </section>;
        })}
      </div>}

      {!customizing && onOpenLayout && itemVisible("entry.layout") && <button type="button" className="quick-layout-entry" onClick={onOpenLayout} aria-label="功能区布局"><Settings size={16}/><b>功能区布局</b><ChevronRight/></button>}

      {!customizing && sectionVisible("playback") && <section className={`quick-drawer-section quick-playback-card ${expandedSections.playback ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("playback")} aria-expanded={expandedSections.playback}><span><MonitorPlay size={16}/></span><div><b>自动演示</b><small>主界面只保留播放按钮，这里调整演示方式</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.playback && <>
        <div className="quick-choice-list">
          {itemVisible("playback.speed") && <ChoiceRow title="播放速度" text="每步之间的等待时间" value={String(playbackSpeed)} options={PLAYBACK_SPEED_OPTIONS} onChange={(value) => onPlaybackSpeedChange(Number(value) as PlaybackSpeed)}/>}
          {itemVisible("playback.branch") && <ChoiceRow title="分支处理" text="遇到多个后续时的行为" value={playbackBranchPolicy} options={PLAYBACK_BRANCH_OPTIONS} onChange={(value) => onPlaybackBranchPolicyChange(value as PlaybackBranchPolicy)}/>}
        </div>
        {itemVisible("playback.loop") && <ToggleRow title="循环当前变化" text="到末尾后回到本次播放起点继续" checked={playbackLoop} onChange={onPlaybackLoopChange}/>}
        </>}</section>}

      {!customizing && sectionVisible("analysis") && <section className={`quick-drawer-section quick-analysis-card ${expandedSections.analysis ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("analysis")} aria-expanded={expandedSections.analysis}><span><Gauge size={16}/></span><div><b>分析</b><small>{getAnalysisMode(enhancementSettings) === "hint" ? "提示 · 点击即想即落" : getAnalysisMode(enhancementSettings) === "selfplay" ? "自对弈进行中" : enhancementSettings.analysisAuto ? `持续 · ${enhancementSettings.analysisCandidateCount} 个选点` : "持续 · 手动开启"}</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.analysis && <>
          {itemVisible("analysis.quickToggle") && <ToggleRow title="首行快捷滑动开关" text="首行功能区出现分析滑动开关（滑块即状态），点一下直接开关分析；位置可在功能区布局里调整" checked={enhancementSettings.analysisQuickToggle} onChange={(analysisQuickToggle) => onEnhancementSettingsChange({ ...enhancementSettings, analysisQuickToggle })}/>}
          {itemVisible("analysis.engine") && <ChoiceRow title="分析引擎" text={enginePackReady ? "轻量 / 强力 128MB 标准 / 自调内存自定义" : "强力与自调引擎需先下载引擎包"} value={aiEngineChoice} options={[["light", "轻量引擎"], ["strong", enginePackReady ? "强力引擎" : "强力（需下载）"], ["tuned", enginePackReady ? "自调引擎" : "自调（需下载）"]] as const} onChange={onAiEngineChoiceChange}/>}
          {itemVisible("analysis.mode") && <ChoiceRow title="分析模式" text={(() => { const mode = getAnalysisMode(enhancementSettings); return mode === "selfplay" ? "引擎双方按每步时限逐回合落子，直到五连或满盘" : mode === "hint" ? "点击分析后引擎直接落子；切换回持续分析可到快捷中心或分析面板" : "一直分析当前局面，越算越深；不会自动落子"; })()} value={getAnalysisMode(enhancementSettings)} options={[["continuous", "持续"], ["selfplay", "自对弈"], ["hint", "提示"]] as Array<readonly [AnalysisMode, string]>} onChange={(mode) => { onEnhancementSettingsChange(withAnalysisMode(enhancementSettings, mode)); }}/>}
          {itemVisible("analysis.candidates") && <ToggleRow title="棋盘显示实时选点" text="只显示在空位上，不会落子或写入棋谱" checked={enhancementSettings.analysisShowCandidates} onChange={(analysisShowCandidates) => onEnhancementSettingsChange({ ...enhancementSettings, analysisShowCandidates })}/>}
          {itemVisible("analysis.metric") && <ChoiceRow title="候选点显示内容" text="胜率、评估分、计算量或深度" value={enhancementSettings.analysisCandidateMetric} options={[["winRate", "胜率"], ["score", "评估分"], ["nodes", "计算量"], ["depth", "深度"]] as Array<readonly [AnalysisCandidateMetric, string]>} onChange={(analysisCandidateMetric) => onEnhancementSettingsChange({ ...enhancementSettings, analysisCandidateMetric })}/>}
          {itemVisible("analysis.count") && <label className="quick-think-slider"><span><b>候选点数量</b><small>默认只显示最佳点，最多显示 10 选</small></span><output>{enhancementSettings.analysisCandidateCount} 选</output><input aria-label="快捷中心候选点数量" type="range" min="1" max="10" step="1" value={enhancementSettings.analysisCandidateCount} onChange={(event) => onEnhancementSettingsChange({ ...enhancementSettings, analysisCandidateCount: Number(event.target.value) })}/></label>}
          {itemVisible("analysis.selfplayTime") && enhancementSettings.analysisSelfPlay && <label className="quick-think-slider"><span><b>自对弈每步时限</b><small>到点即落子；提前算出杀棋会立刻落下，五连或满盘自动结束</small></span><output>{(enhancementSettings.analysisSelfPlayTimeMs / 1000).toFixed(1)} 秒</output><input aria-label="自对弈每步时限" type="range" min="1000" max="10000" step="500" value={enhancementSettings.analysisSelfPlayTimeMs} onChange={(event) => onEnhancementSettingsChange({ ...enhancementSettings, analysisSelfPlayTimeMs: Number(event.target.value) })}/></label>}
          {itemVisible("analysis.memory") && aiEngineChoice === "tuned" && <label className="quick-think-slider"><span><b>分析内存</b><small>滑杆或输入 256-2048 MB；越高长分析越深（实验），分配失败先降 256MB 重试再回落轻量</small></span><output>{fmtAnalysisMemory(enhancementSettings.analysisMaxMemoryMb)}</output><input aria-label="分析内存滑杆" type="range" min="256" max="2048" step="32" value={enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(256, Number(event.target.value))); onEnhancementSettingsChange({ ...enhancementSettings, analysisMaxMemoryMb: v }); if (memoryNumberRef.current) memoryNumberRef.current.value = String(v); }}/><input ref={memoryNumberRef} aria-label="分析内存数值" type="number" min="256" max="2048" step="32" defaultValue={enhancementSettings.analysisMaxMemoryMb} onBlur={(event) => { const v = Math.min(2048, Math.max(256, Math.round(Number(event.target.value) || 256))); onEnhancementSettingsChange({ ...enhancementSettings, analysisMaxMemoryMb: v }); event.currentTarget.value = String(v); }} onKeyDown={(event) => { if (event.key === "Enter") { const target = event.currentTarget; const v = Math.min(2048, Math.max(256, Math.round(Number(target.value) || 256))); onEnhancementSettingsChange({ ...enhancementSettings, analysisMaxMemoryMb: v }); target.value = String(v); target.blur(); } }}/></label>}
          {itemVisible("analysis.indicator") && <ChoiceRow title="思考显示位置" text="统一显示做题、打谱和人机对战的后台计算状态" value={thinkingIndicatorPosition} options={[["corner", "棋盘右上角"], ["below", "棋盘下方"]] as const} onChange={onThinkingIndicatorPositionChange}/>}
        </>}
      </section>}

      {!customizing && sectionVisible("visual") && <section className={`quick-drawer-section quick-visual-card ${expandedSections.visual ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("visual")} aria-expanded={expandedSections.visual}><span><Palette size={16}/></span><div><b>外观与声音</b><small>主题、棋盘、棋子与音效，改后立即生效</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.visual && <>
        <div className="quick-choice-list">{([
          ["visual.theme", <ChoiceRow title="应用主题" text="页面颜色与氛围" value={themePreference} options={THEME_OPTIONS} onChange={onThemePreferenceChange}/>],
          ["visual.board", <ChoiceRow title="棋盘" text="棋盘材质与网格" value={boardTheme} options={BOARD_OPTIONS} onChange={onBoardThemeChange}/>],
          ["visual.stone", <ChoiceRow title="棋子" text="黑白棋子的视觉样式" value={stoneTheme} options={STONE_OPTIONS} onChange={onStoneThemeChange}/>],
          ["visual.boardSize", <ChoiceRow title="默认棋盘大小" text="新建棋谱时使用的路数（默认15路）" value={String(defaultBoardSize)} options={boardSizeOptions} onChange={(value) => onDefaultBoardSizeChange(Number(value))}/>],
          ["visual.sound", <>
            <ToggleRow title="声音与音效" text="关闭后不创建或唤醒音频上下文；与设置页同一开关" checked={soundSettings.enabled} onChange={(enabled) => onSoundSettingsChange({ ...soundSettings, enabled })}/>
            {soundSettings.enabled && <label className="quick-think-slider"><span><b>音量</b><small>只调整半步五子棋打谱的提示音与落子声，不改系统媒体音量</small></span><output>{Math.round(soundSettings.volume * 100)}%</output><input aria-label="快捷中心音量" type="range" min="0" max="100" step="1" value={Math.round(soundSettings.volume * 100)} onChange={(event) => onSoundSettingsChange({ ...soundSettings, volume: Number(event.target.value) / 100 })}/></label>}
            {soundSettings.enabled && <div className="sound-preview"><button type="button" onClick={() => onPreviewSound("move-black")}>试听落子</button><button type="button" onClick={() => onPreviewSound("success")}>试听胜利</button></div>}
          </>],
        ] as Array<[string, ReactNode]>).filter(([id]) => itemVisible(id)).sort((a, b) => rankOf(a[0]) - rankOf(b[0])).map(([id, node]) => <Fragment key={id}>{node}</Fragment>)}</div>
        </>}</section>}

      {!customizing && sectionVisible("board") && <section className={`quick-drawer-section quick-board-card ${expandedSections.board ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("board")} aria-expanded={expandedSections.board}><span><Eye size={16}/></span><div><b>棋盘显示</b><small>手数、坐标、禁手辅助与绘制细节</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.board && <>
          {itemVisible("board.numbers") && <ToggleRow title="显示手数" text="在棋子上显示落子序号" checked={showNumbers} onChange={onShowNumbersChange}/>}
          {itemVisible("board.coordinates") && <ToggleRow title="显示坐标" text="棋盘边缘显示 A–O / 1–15" checked={showCoordinates} onChange={onShowCoordinatesChange}/>}
          {itemVisible("board.forbidden") && <ToggleRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={showForbidden} onChange={onShowForbiddenChange}/>}
          {itemVisible("board.lastMove") && <ToggleRow title="最后一手标记" text="最新一手显示红点；开启手数时红色高亮序号" checked={showLastMove} onChange={onShowLastMoveChange}/>}
          {itemVisible("board.numberScale") && <label className="quick-think-slider"><span><b>棋子序号大小</b><small>缩放棋盘上的落子序号</small></span><output>{Math.round(moveNumberScale * 100)}%</output><input aria-label="快捷中心棋子序号大小" type="range" min="0.7" max="1.8" step="0.05" value={moveNumberScale} onChange={(event) => onMoveNumberScaleChange(Number(event.target.value))}/></label>}
          {itemVisible("board.gridWidth") && <label className="quick-think-slider"><span><b>棋盘画线粗细</b><small>网格线宽度</small></span><output>{gridLineWidth.toFixed(2)}px</output><input aria-label="快捷中心棋盘画线粗细" type="range" min="0.6" max="3" step="0.05" value={gridLineWidth} onChange={(event) => onGridLineWidthChange(Number(event.target.value))}/></label>}
          {itemVisible("board.coordFont") && <label className="quick-think-slider"><span><b>坐标字体大小</b><small>棋盘边缘坐标字号</small></span><output>{coordinateFontSize.toFixed(1)}px</output><input aria-label="快捷中心坐标字体大小" type="range" min="6" max="14" step="0.5" value={coordinateFontSize} onChange={(event) => onCoordinateFontSizeChange(Number(event.target.value))}/></label>}
        </>}</section>}

      {!customizing && sectionVisible("accessibility") && <section className={`quick-drawer-section quick-accessibility-card ${expandedSections.accessibility ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("accessibility")} aria-expanded={expandedSections.accessibility}><span><Accessibility size={16}/></span><div><b>无障碍</b><small>字号只放大界面文字与控件，不缩放棋盘</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.accessibility && itemVisible("accessibility.font") && <ChoiceRow title="界面字号" text="正常 / 大字 / 特大字" value={fontScale} options={[["normal", "正常"], ["large", "大字"], ["xlarge", "特大字"]] as const} onChange={onFontScaleChange}/>}
      </section>}

      {!customizing && sectionVisible("data") && <section className={`quick-drawer-section quick-data-card ${expandedSections.data ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("data")} aria-expanded={expandedSections.data}><span><DatabaseBackup size={16}/></span><div><b>数据</b><small>恢复局面、导入导出与备份</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.data && <div className="quick-link-list">
          {itemVisible("data.restore") && <ToggleRow title="退出后恢复上次局面" text="下次进入时恢复上次棋谱、节点和打谱/做题模式" checked={restoreLastPosition} onChange={onRestoreLastPositionChange}/>}
          {itemVisible("data.import") && <button type="button" className="quick-link-row" onClick={() => { onOpenImport(); onClose(); }}><Download size={16}/><span><b>导入棋谱</b><small>SGF / JSON / LIB / DP / DB</small></span><ChevronRight/></button>}
          {itemVisible("data.export") && <button type="button" className="quick-link-row" onClick={() => { onOpenExport(); onClose(); }}><Upload size={16}/><span><b>导出棋谱</b><small>原始格式或完整 SGF / JSON</small></span><ChevronRight/></button>}
          {itemVisible("data.backup") && <button type="button" className="quick-link-row" onClick={() => { onBackup(); onClose(); }}><Save size={16}/><span><b>一键备份</b><small>棋谱库、题库、进度、草稿与设置</small></span><ChevronRight/></button>}
          {itemVisible("data.restoreBackup") && <button type="button" className="quick-link-row" onClick={() => { onRestoreBackup(); onClose(); }}><RotateCw size={16}/><span><b>恢复备份</b><small>导入前完整校验，失败自动回滚</small></span><ChevronRight/></button>}
          {itemVisible("data.help") && <button type="button" className="quick-link-row" onClick={() => { onOpenHelp(); onClose(); }}><Info size={16}/><span><b>格式兼容说明</b><small>各格式的可写能力与保真范围</small></span><ChevronRight/></button>}
        </div>}</section>}

      {!customizing && sectionVisible("misc") && <section className={`quick-drawer-section quick-misc-card ${expandedSections.misc ? "expanded" : "collapsed"}`}>
        <button type="button" className="quick-drawer-section-title quick-drawer-section-toggle" onClick={() => toggleSection("misc")} aria-expanded={expandedSections.misc}><span><Info size={16}/></span><div><b>手册与其他</b><small>引导、手册、反馈与关于</small></div><ChevronRight className="quick-section-chevron"/></button>
        {expandedSections.misc && <div className="quick-link-list">
          {itemVisible("misc.tour") && <button type="button" className="quick-link-row" onClick={() => { onOpenTour(); onClose(); }}><Compass size={16}/><span><b>新手引导</b><small>spotlight 再走一遍核心功能</small></span><ChevronRight/></button>}
          {itemVisible("misc.manual") && <button type="button" className="quick-link-row" onClick={() => { onOpenManual(); onClose(); }}><BookOpen size={16}/><span><b>使用手册</b><small>逐项了解棋盘、棋谱库、题库与 AI</small></span><ChevronRight/></button>}
          {itemVisible("misc.feedback") && <button type="button" className="quick-link-row" onClick={() => { onOpenFeedback(); onClose(); }}><Mail size={16}/><span><b>反馈问题或建议</b><small>邮件或 GitHub Issue</small></span><ChevronRight/></button>}
          {itemVisible("misc.about") && <button type="button" className="quick-link-row" onClick={() => { onOpenAbout(); onClose(); }}><Info size={16}/><span><b>关于与更新</b><small>版本、检查更新与项目说明</small></span><ChevronRight/></button>}
        </div>}</section>}

      {!customizing && !QUICK_DRAWER_ITEMS.some((item) => itemVisible(item.id)) && <p className="quick-drawer-empty">快捷中心还没有任何项，点右上角「自定义」勾选需要的功能。</p>}

      {!customizing && <div className="quick-drawer-update-row">
        <button
          type="button"
          className={`quick-update-button${updateRelease ? " has-update" : ""}`}
          onClick={() => {
            if (updateRelease) window.open(updateRelease.url, "_blank", "noreferrer");
            else void runManualUpdateCheck();
          }}
          disabled={updateCheckState === "checking"}
          aria-label={updateRelease ? `发现新版本 ${updateRelease.version}，前往下载` : "检查更新"}
          title={updateRelease ? `前往下载 ${updateRelease.version}` : "检查是否有新版本"}
        >
          <RotateCw size={16} className={updateCheckState === "checking" ? "quick-update-spin" : ""} aria-hidden="true"/>
          <span>
            <b>{updateRelease ? `发现新版本 v${updateRelease.version}` : updateCheckState === "checking" ? "正在检查更新…" : "检查更新"}</b>
            <small>{updateRelease ? "点击前往下载"
              : updateCheckState === "checking" ? "正在连接更新源"
              : updateCheckState === "latest" ? `已是最新版本${checkedVersion ? ` v${checkedVersion}` : ""}`
              : updateCheckState === "failed" ? "检查失败，请稍后再试"
              : `当前版本 v${APP_VERSION}`}</small>
          </span>
          {updateRelease && <span className="update-dot" aria-hidden="true"/>}
        </button>
      </div>}
    </aside>
  </div>;
}
