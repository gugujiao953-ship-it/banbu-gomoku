import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Accessibility, ArchiveRestore, BookOpen, Bot, Check, ChevronDown, ChevronRight, Compass, Download, Eye, FlaskConical, FolderOpen, Info, Mail, Palette, PlayCircle, RotateCw, Save, Search, Settings2, SlidersHorizontal, Sparkles, TabletSmartphone, Upload, Volume2, X } from "lucide-react";
import type { FontScale } from "../../accessibility";
import type { BoardTheme, ResolvedTheme, StoneTheme, ThemePreference } from "../../app-shell-types";
import type { SoundCue } from "../../audio-engine";
import type { SoundSettings } from "../../audio-settings";
import { APP_VERSION } from "../../diagnostics";
import { DEFAULT_COORDINATE_FONT_SIZE } from "./display-defaults";
import { fmtAnalysisMemory, getAnalysisMode, withAnalysisMode, type AnalysisCandidateMetric, type AnalysisMode, type EnhancementSettings } from "../../enhancement-settings";
import { defaultNativeExportHandle, exportLocationLabel, isNativeDirectoryHandle, isSafDirectoryHandle, nativeExportDirectoryHandle, type ExportDirectoryHandle } from "../../file-destination";
import type { PlaybackBranchPolicy, PlaybackSpeed } from "../research/record-playback";
import { DEFAULT_BOARD_OPACITY, MIN_BOARD_OPACITY } from "../../board-opacity";
import { DEFAULT_STONE_OPACITY, MIN_STONE_OPACITY } from "../../stone-opacity";
import type { AnnotationHighlight } from "../../annotation-highlight";
import { EnginePackSection } from "../ai/EnginePackSection";

interface SettingsPageProps {
  onOpenLayout?: () => void;
  // 分析引擎档位：快捷中心有这一项，设置页必须同步有（快捷中心自定义条目池的硬约束）。
  aiEngineChoice: "light" | "strong" | "tuned";
  enginePackReady: boolean;
  onAiEngineChoiceChange: (value: "light" | "strong" | "tuned") => void;
  thinkingIndicatorPosition: "corner" | "below";
  onThinkingIndicatorPositionChange: (value: "corner" | "below") => void;
  playbackSpeed: PlaybackSpeed;
  onPlaybackSpeedChange: (value: PlaybackSpeed) => void;
  playbackBranchPolicy: PlaybackBranchPolicy;
  onPlaybackBranchPolicyChange: (value: PlaybackBranchPolicy) => void;
  playbackLoop: boolean;
  onPlaybackLoopChange: (value: boolean) => void;
  fontScale: FontScale;
  onFontScaleChange: (value: FontScale) => void;
  resolvedTheme: ResolvedTheme;
  themePreference: ThemePreference;
  onThemePreferenceChange: (value: ThemePreference) => void;
  customBackgroundColor: string;
  customBackgroundImage: string;
  onCustomBackgroundColorChange: (value: string) => void;
  onChooseBackgroundImage: () => void;
  onClearBackgroundImage: () => void;
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  boardOpacity: number;
  stoneOpacity: number;
  annotationHighlight: AnnotationHighlight;
  onBoardThemeChange: (value: BoardTheme) => void;
  onStoneThemeChange: (value: StoneTheme) => void;
  onBoardOpacityChange: (value: number) => void;
  onStoneOpacityChange: (value: number) => void;
  onAnnotationHighlightChange: (value: AnnotationHighlight) => void;
  defaultBoardSize: number;
  onDefaultBoardSizeChange: (value: number) => void;
  soundSettings: SoundSettings;
  onSoundSettingsChange: (value: SoundSettings) => void;
  onPreviewSound: (cue: SoundCue) => void;
  showNumbers: boolean;
  showCoordinates: boolean;
  showForbidden: boolean;
  showLastMove: boolean;
  moveNumberScale: number;
  gridLineWidth: number;
  coordinateFontSize: number;
  motionEnabled: boolean;
  restoreLastPosition: boolean;
  onShowNumbersChange: (value: boolean) => void;
  onShowCoordinatesChange: (value: boolean) => void;
  onShowForbiddenChange: (value: boolean) => void;
  onShowLastMoveChange: (value: boolean) => void;
  onMoveNumberScaleChange: (value: number) => void;
  onGridLineWidthChange: (value: number) => void;
  onCoordinateFontSizeChange: (value: number) => void;
  onMotionEnabledChange: (value: boolean) => void;
  onRestoreLastPositionChange: (value: boolean) => void;
  defaultDirectory: ExportDirectoryHandle | null;
  directorySupported: boolean;
  nativeDirectorySupported: boolean;
  onChooseDefaultDirectory: () => void;
  onClearDefaultDirectory: () => void;
  backupBusy: boolean;
  onImportRecord: () => void;
  onOpenExport: () => void;
  onExportBackup: () => void;
  onRestoreBackup: () => void;
  onOpenHelp: () => void;
  onOpenAbout: () => void;
  onOpenManual: () => void;
  onOpenTour: () => void;
  onOpenFeedback: () => void;
  enhancementSettings: EnhancementSettings;
  onEnhancementSettingsChange: (value: EnhancementSettings) => void;
  updateAutoCheck: boolean;
  onUpdateAutoCheckChange: (value: boolean) => void;
}

const themeOptions: Array<[ThemePreference, string, string]> = [
  ["system", "跟随系统", "根据设备外观自动切换"],
  ["light", "浅色", "保持明亮纸张风格"],
  ["dark", "深色", "降低夜间屏幕亮度"],
  ["eye", "护眼", "降低蓝光感，适合长时间复盘"],
  ["mono", "黑白极简", "低彩度、清晰专注"],
  ["rain", "雨幕", "缓慢雨丝，适合夜间复盘"],
  ["bamboo", "水墨竹林", "青绿竹影与竹叶缓慢飘落"],
  ["snow", "雪落", "冷色雪花安静飘落"],
  ["porcelain", "青花瓷影", "温润瓷白、钴蓝纹样与藏青交互"],
  ["plum", "梅枝映雪", "梅枝、雪点与冷色宣纸"],
  ["jiangnan", "夜雨江南", "屋檐雨丝与远处灯火"],
  ["firefly", "萤火森林", "深林暗色与微弱萤火"],
  ["rice", "宣纸留白", "极简宣纸与淡墨晕染"],
  ["pixel", "像素街机", "低分辨率像素与复古色块"],
  ["cyber", "霓虹赛博", "蓝紫霓虹与电路光"],
  ["blackgold", "尊贵黑金", "曜石黑与香槟金，克制而尊贵"],
  ["pale", "苍白世界", "高级灰留白，微尘明灭漂浮"],
  ["kawaii", "卡哇伊", "奶油粉、莓果紫与轻盈星光"],
  ["aurora", "极光", "极夜青蓝中流动的极光天幕"],
  ["deepsea", "深海幽蓝", "低饱和深海与缓慢流动的波光"],
  ["baroque", "巴洛克", "古金、羊皮纸与华美装饰线条"],
  ["custom", "自定义背景", "支持静态图和 GIF 动图"],
];

const themeLabel = (theme: ResolvedTheme) => theme === "custom"
  ? "自定义"
  : themeOptions.find(([value]) => value === theme)?.[1] || "浅色";
const preferenceLabel = (theme: ThemePreference) => theme === "system"
  ? "跟随系统"
  : theme === "light"
    ? "手动浅色"
    : theme === "dark"
      ? "手动深色"
      : theme === "custom"
        ? "自定义背景"
        : themeLabel(theme);

export function SettingsPage(props: SettingsPageProps) {
  // 自调内存输入框（非受控，读 DOM 提交；滑杆拖动用 ref 同步显示）。
  const memoryNumberRef = useRef<HTMLInputElement | null>(null);
  const boardSizeOptions = Array.from({ length: 17 }, (_, index) => index + 5);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const searchable = useMemo(() => (title: string, summary: string, keywords: string[] = []) => {
    if (!normalizedQuery) return true;
    return [title, summary, ...keywords].join(" ").toLowerCase().includes(normalizedQuery);
  }, [normalizedQuery]);
  const visibleSectionCount = [
    searchable("外观与音效", "主题、棋盘、棋子、声音与动效", ["颜色", "棋盘透明度", "棋子透明度", "背景透出", "透明度", "标注", "高亮", "白色", "金色", "蓝色", "音量", "动效", "外观"]),
    searchable("棋盘显示", "手数、坐标、禁手和最后一手标记", ["序号", "坐标", "禁手", "最后一手", "红点"]),
    searchable("无障碍与字号", "文字大小、键盘和屏幕阅读器", ["大字", "特大字", "无障碍"]),
    searchable("自动演示", "播放速度、分支处理和循环", ["播放", "速度", "分支", "循环"]),
    searchable("分析", "自动分析、引擎和棋盘候选点", ["AI", "引擎", "胜率", "评估", "深度", "节点", "选点"]),
    searchable("强力 AI 引擎", "下载冠军级评估网络包", ["引擎", "引擎包", "下载", "网络", "棋力", "AI"]),
    searchable("可选增强功能", "手势、最近导入、AI 提示和开局库", ["手势", "最近导入", "引导", "开局库", "打点簿", "开局", "人机", "识谱", "加速", "多核", "识谱加速"]),
    searchable("文件与存储", "储存位置、导出文件夹与上次局面", ["恢复", "导出文件夹", "本机", "储存位置", "存储位置", "保存位置", "文件夹", "占用", "空间"]),
    searchable("数据与兼容", "导入、导出、备份与格式说明", ["导入", "导出", "备份", "格式"]),
    searchable("设备布局", "平板横屏双栏", ["平板", "横屏", "双栏", "走棋", "文字", "功能栏", "图标", "功能区", "按钮", "排序"]),
    searchable("开发测试功能", "尚未成熟的实验开关，默认关闭", ["开发", "测试", "实验", "复原手序", "识谱"]),
    searchable("使用手册与反馈", "操作说明与反馈", ["手册", "反馈"]),
    searchable("关于", "项目说明和下载地址", ["版本", "GitHub", "更新"]),
  ].filter(Boolean).length;
  return <>
    <div className="settings-page page-padding">
      <div className="settings-command-header">
        <div className="settings-command-copy"><span>偏好中心</span><b>调整你的棋谱工作区</b><small>开关和参数会立即保存到本机</small></div>
        <div className="settings-search-wrap">
          <label className="settings-search"><Search aria-hidden="true"/><input aria-label="搜索设置" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置，例如字号、棋盘、备份"/><button type="button" onClick={() => setQuery("")} aria-label="清除设置搜索" disabled={!query}><X/></button></label>
          {query && <span className="settings-search-count">找到 {visibleSectionCount} 个分类</span>}
        </div>
      </div>
      <div className="settings-overview"><span className="settings-overview-icon"><Settings2 aria-hidden="true"/></span><div><b>按优先级整理</b><small>外观与音效在这里集中调整主题、棋盘、棋子、音效和动效；其他功能按使用场景分组。</small></div><span className="settings-overview-total">{visibleSectionCount}<small>分类</small></span></div>

      {searchable("外观与音效", "主题、棋盘、棋子、声音与动效", ["颜色", "棋盘透明度", "棋子透明度", "背景透出", "透明度", "标注", "高亮", "白色", "金色", "蓝色", "音量", "动效", "外观"]) && <SettingsSection icon={<Palette/>} order={0} search={normalizedQuery} title="外观与音效" summary={`${themeLabel(props.resolvedTheme)} · ${props.boardTheme === "porcelain" ? "青花瓷棋盘" : "主题、棋盘、棋子与音效"}`}>
        <div className="appearance-center-intro"><span><Sparkles/></span><div><b>统一调整视觉与反馈</b><small>主题、棋盘材质、棋盘与棋子透明度、音效和动效集中在这里，改动会即时预览。</small></div></div>
        <AppearanceSubsection icon={<Palette/>} title="主题" summary={preferenceLabel(props.themePreference)} search={normalizedQuery} keywords={["应用主题", "背景", "颜色"]}>
          <div className="theme-preference" role="radiogroup" aria-label="外观主题">
            {themeOptions.map(([value, label, text]) => <button key={value} type="button" className={props.themePreference === value ? "selected" : ""} role="radio" aria-checked={props.themePreference === value} title={`${label} · ${text}`} onClick={() => props.onThemePreferenceChange(value)}><span className={`theme-swatch ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="theme-check" aria-hidden="true"/></button>)}
          </div>
          <p className={`theme-motion-note ${props.motionEnabled ? "enabled" : "disabled"}`}><Sparkles aria-hidden="true"/><span><b>主题动效{props.motionEnabled ? "已开启" : "已关闭"}</b><small>{props.motionEnabled ? "动态光影、微尘与漂浮效果正在运行" : "请在下方“声音与音效”中开启界面动效"}</small></span></p>
          {props.themePreference === "custom" && <div className="custom-background-controls">
            <label><span>背景颜色</span><input type="color" value={props.customBackgroundColor} onChange={(event) => props.onCustomBackgroundColorChange(event.target.value)}/></label>
            <button type="button" onClick={props.onChooseBackgroundImage}>选择本地背景图片</button>
            {props.customBackgroundImage && <button type="button" className="custom-background-clear" onClick={props.onClearBackgroundImage}>清除图片背景</button>}
            <p>图片只保存在本机，最大 2MB；使用深色半透明遮罩保证文字和棋盘控件可读。</p>
          </div>}
        </AppearanceSubsection>
        <AppearanceSubsection icon={<SlidersHorizontal/>} title="棋盘" summary="棋盘材质、标注高亮、透明度和新建路数" search={normalizedQuery} keywords={["棋盘材质", "棋盘透明度", "背景透出", "标注", "高亮", "白色", "金色", "蓝色", "路数"]}>
          <AnnotationHighlightSetting value={props.annotationHighlight} onChange={props.onAnnotationHighlightChange}/>
          <VisualThemeSettings only="board" boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onBoardThemeChange={props.onBoardThemeChange} onStoneThemeChange={props.onStoneThemeChange}/>
          <BoardOpacitySetting value={props.boardOpacity} stoneOpacity={props.stoneOpacity} boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onChange={props.onBoardOpacityChange}/>
          <details className="settings-subsection"><summary><span><b>默认棋盘大小</b><small>新建棋谱默认使用 {props.defaultBoardSize} 路</small></span><ChevronDown/></summary><label className="setting-choice-row"><span><b>棋盘路数</b><small>可选 5–21 路，默认 15 路</small></span><select className="board-size-select" aria-label="默认棋盘路数" value={props.defaultBoardSize} onChange={(event) => props.onDefaultBoardSizeChange(Number(event.target.value))}>{boardSizeOptions.map((size) => <option key={size} value={size}>{size}路</option>)}</select></label></details>
        </AppearanceSubsection>
        <AppearanceSubsection icon={<Sparkles/>} title="棋子" summary="棋子材质和透明度" search={normalizedQuery} keywords={["棋子材质", "棋子透明度", "材质"]}>
          <VisualThemeSettings only="stone" boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onBoardThemeChange={props.onBoardThemeChange} onStoneThemeChange={props.onStoneThemeChange}/>
          <StoneOpacitySetting value={props.stoneOpacity} boardOpacity={props.boardOpacity} boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onChange={props.onStoneOpacityChange}/>
        </AppearanceSubsection>
        <AppearanceSubsection icon={<Volume2/>} title="声音与音效" summary={`${props.soundSettings.enabled ? `音量 ${Math.round(props.soundSettings.volume * 100)}%` : "音效已关闭"} · 动效${props.motionEnabled ? "开启" : "关闭"}`} search={normalizedQuery} keywords={["声音", "音效", "音量", "动效", "动画"]}>
          <SoundSettingsPanel settings={props.soundSettings} onChange={props.onSoundSettingsChange} onPreview={props.onPreviewSound}/>
          <SettingRow title="界面动效" text="关闭落子、导航、胜线与界面过渡；功能仍然完整可用" checked={props.motionEnabled} onChange={props.onMotionEnabledChange}/>
        </AppearanceSubsection>
      </SettingsSection>}

      {searchable("棋盘显示", "显示、坐标、禁手辅助", ["序号", "坐标", "禁手", "最后一手", "红点"]) && <SettingsSection icon={<Eye/>} order={10} search={normalizedQuery} title="棋盘显示" summary={`手数、坐标、禁手辅助 · 动效已移入外观中心`}>
        <div className="board-display-preview"><BoardDisplayPreview showNumbers={props.showNumbers} showCoordinates={props.showCoordinates} showForbidden={props.showForbidden} showLastMove={props.showLastMove} moveNumberScale={props.moveNumberScale} gridLineWidth={props.gridLineWidth} coordinateFontSize={props.coordinateFontSize}/><small>预览随下方设置实时变化</small></div>
        <SettingRow title="显示手数" text="在棋子上显示落子序号" checked={props.showNumbers} onChange={props.onShowNumbersChange}/>
        <SettingRow title="显示坐标" text="棋盘边缘显示 A–O / 1–15" checked={props.showCoordinates} onChange={props.onShowCoordinatesChange}/>
        <SettingRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={props.showForbidden} onChange={props.onShowForbiddenChange}/>
        <SettingRow title="最后一手标记" text="最新一手显示红点；开启手数时改为红色高亮序号" checked={props.showLastMove} onChange={props.onShowLastMoveChange}/>
        <div className="board-display-sliders">
          <label><span>棋子序号大小</span><div className="slider-line"><input aria-label="棋子序号大小" type="range" min="0.7" max="1.8" step="0.05" value={props.moveNumberScale} onChange={(event) => props.onMoveNumberScaleChange(Number(event.target.value))}/><output>{Math.round(props.moveNumberScale * 100)}%</output></div></label>
          <label><span>棋盘画线粗细</span><div className="slider-line"><input aria-label="棋盘画线粗细" type="range" min="0.6" max="3" step="0.05" value={props.gridLineWidth} onChange={(event) => props.onGridLineWidthChange(Number(event.target.value))}/><output>{props.gridLineWidth.toFixed(2)}px</output></div></label>
          <label><span>坐标字体大小</span><div className="slider-line"><input aria-label="坐标字体大小" type="range" min="6" max="14" step="0.5" value={props.coordinateFontSize} onChange={(event) => props.onCoordinateFontSizeChange(Number(event.target.value))}/><output>{props.coordinateFontSize.toFixed(1)}px</output></div></label>
          {(props.moveNumberScale !== 1 || props.gridLineWidth !== 1.25 || props.coordinateFontSize !== DEFAULT_COORDINATE_FONT_SIZE) && <button type="button" className="board-display-reset" onClick={() => { props.onMoveNumberScaleChange(1); props.onGridLineWidthChange(1.25); props.onCoordinateFontSizeChange(DEFAULT_COORDINATE_FONT_SIZE); }}>恢复默认显示</button>}
        </div>
      </SettingsSection>}

      {searchable("无障碍与字号", "调整文字大小，改善键盘与屏幕阅读器使用体验", ["大字", "特大字", "无障碍"]) && <SettingsSection icon={<Accessibility/>} order={30} search={normalizedQuery} title="无障碍与字号" summary="文字大小、焦点和屏幕阅读器支持">
        <div className="font-scale-options" role="radiogroup" aria-label="界面字号">
          {([[
            "normal", "正常",
          ], ["large", "大字"], ["xlarge", "特大字"]] as const).map(([value, label]) => <button key={value} type="button" className={props.fontScale === value ? "selected" : ""} role="radio" aria-checked={props.fontScale === value} onClick={() => props.onFontScaleChange(value)}><b>{label}</b><small>{value === "normal" ? "100%" : value === "large" ? "115%" : "130%"}</small></button>)}
        </div>
        <p className="helper">字号只放大界面文字与控件，不整体缩放棋盘，避免棋盘布局变形。</p>
      </SettingsSection>}

      {searchable("自动演示", "播放速度、分支处理和循环", ["播放", "速度", "分支", "循环"]) && <SettingsSection icon={<PlayCircle/>} order={15} search={normalizedQuery} title="自动演示" summary={`${props.playbackSpeed}× · ${props.playbackBranchPolicy === "pause" ? "遇分支暂停" : "沿主线继续"} · ${props.playbackLoop ? "循环" : "不循环"}`}>
        <SettingChoiceRow title="播放速度" text="控制自动前进到下一手的等待时间" value={String(props.playbackSpeed)} options={[["0.5", "0.5×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"]]} onChange={(value) => props.onPlaybackSpeedChange(Number(value) as PlaybackSpeed)}/>
        <SettingChoiceRow title="分支处理" text="当前局面出现多个后续时如何继续" value={props.playbackBranchPolicy} options={[["pause", "遇分支暂停"], ["mainline", "沿主线继续"]]} onChange={(value) => props.onPlaybackBranchPolicyChange(value as PlaybackBranchPolicy)}/>
        <SettingRow title="循环当前变化" text="到末尾后回到本次播放起点继续演示" checked={props.playbackLoop} onChange={props.onPlaybackLoopChange}/>
      </SettingsSection>}

      {searchable("分析", "持续分析、引擎和棋盘候选点", ["AI", "引擎", "轻量", "强力", "胜率", "评估", "深度", "节点", "选点", "小数", "连线", "变化", "开关", "快捷", "思考显示位置", "提示", "自对弈", "落子"]) && <SettingsSection icon={<Bot/>} order={65} search={normalizedQuery} title="分析" summary={props.enhancementSettings.analysisSelfPlay ? "自对弈进行中" : props.enhancementSettings.analysisHintMode ? "提示 · 点击分析直接落子" : props.enhancementSettings.analysisAuto ? `持续 · ${props.enhancementSettings.analysisCandidateCount} 个选点` : "持续已关闭"}>
        <SettingChoiceRow title="分析引擎" text={props.enginePackReady ? "轻量随包 / 强力 128MB 标准 / 自调内存可自定义" : "强力与自调引擎需先在下方「强力 AI 引擎」下载引擎包"} value={props.aiEngineChoice} options={[["light", "轻量引擎"], ["strong", props.enginePackReady ? "强力引擎" : "强力（需下载）"], ["tuned", props.enginePackReady ? "自调引擎" : "自调（需下载）"]] as const} onChange={(value) => props.onAiEngineChoiceChange(value as "light" | "strong" | "tuned")}/>
        {props.aiEngineChoice === "tuned" && <label className="think-search-row"><span><b>分析内存</b><small>128-2048MB 自调（实验）；分配失败先降 256MB 重试再回落轻量。强力档固定 128MB 标准</small></span><output>{fmtAnalysisMemory(props.enhancementSettings.analysisMaxMemoryMb)}</output><input aria-label="分析内存滑杆" type="range" min="256" max="2048" step="32" value={props.enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(256, Number(event.target.value))); props.onEnhancementSettingsChange({ ...props.enhancementSettings, analysisMaxMemoryMb: v }); if (memoryNumberRef.current) memoryNumberRef.current.value = String(v); }}/><input ref={memoryNumberRef} aria-label="分析内存数值" type="number" min="256" max="2048" step="32" defaultValue={props.enhancementSettings.analysisMaxMemoryMb} onBlur={(event) => { const v = Math.min(2048, Math.max(256, Math.round(Number(event.target.value) || 256))); props.onEnhancementSettingsChange({ ...props.enhancementSettings, analysisMaxMemoryMb: v }); event.currentTarget.value = String(v); }} onKeyDown={(event) => { if (event.key === "Enter") { const target = event.currentTarget; const v = Math.min(2048, Math.max(256, Math.round(Number(target.value) || 256))); props.onEnhancementSettingsChange({ ...props.enhancementSettings, analysisMaxMemoryMb: v }); target.value = String(v); target.blur(); } }}/></label>}
        <SettingChoiceRow title="思考显示位置" text="统一显示做题、打谱和人机对战的后台计算状态" value={props.thinkingIndicatorPosition} options={[["corner", "棋盘右上角"], ["below", "棋盘下方"]] as const} onChange={(value) => props.onThinkingIndicatorPositionChange(value as "corner" | "below")}/>
        <AnalysisSettingsPanel settings={props.enhancementSettings} onChange={props.onEnhancementSettingsChange}/>
      </SettingsSection>}

      {searchable("强力 AI 引擎", "下载冠军级评估网络包", ["引擎", "引擎包", "下载", "网络", "棋力", "AI"]) && <EnginePackSection order={66} search={normalizedQuery}/>}

      {searchable("可选增强功能", "手势、最近导入、AI 提示和开局库", ["手势", "最近导入", "引导", "开局库", "打点簿", "开局", "人机", "识谱", "加速", "多核", "识谱加速"]) && <SettingsSection icon={<Sparkles/>} order={70} search={normalizedQuery} title="可选增强功能" summary={`${Object.entries(props.enhancementSettings).filter(([key, value]) => value === true && key !== "devMoveOrderRestore").length} 项已开启 · 除识谱加速外默认关闭`}>
        <EnhancementSettingsPanel settings={props.enhancementSettings} onChange={props.onEnhancementSettingsChange}/>
      </SettingsSection>}

      {searchable("文件与存储", "储存位置、导出文件夹与上次局面", ["恢复", "导出文件夹", "本机", "储存位置", "存储位置", "保存位置", "文件夹", "占用", "空间"]) && <SettingsSection icon={<FolderOpen/>} order={50} search={normalizedQuery} title="文件与存储" summary="储存位置、导出文件夹与上次局面">
        <SettingRow title="退出后恢复上次局面" text="下次进入时恢复上次棋谱、节点和打谱/做题模式" checked={props.restoreLastPosition} onChange={props.onRestoreLastPositionChange}/>
        <StorageSettings defaultDirectory={props.defaultDirectory} directorySupported={props.directorySupported} nativeDirectorySupported={props.nativeDirectorySupported} onChoose={props.onChooseDefaultDirectory} onClear={props.onClearDefaultDirectory}/>
      </SettingsSection>}

      {searchable("数据与兼容", "导入、导出、备份与格式说明", ["导入", "导出", "备份", "格式"]) && <SettingsSection icon={<ArchiveRestore/>} order={60} search={normalizedQuery} title="数据与兼容" summary="导入、导出、备份与格式说明">
        <SettingsLink icon={<Download/>} title="导入棋谱" text="SGF / JSON / LIB / DP / DB，以及 SGF 同族扩展名" onClick={props.onImportRecord}/>
        <SettingsLink icon={<Upload/>} title="导出棋谱" text="识别原始格式直接导出，或转换为完整 SGF / JSON" onClick={props.onOpenExport}/>
        <SettingsLink icon={<Save/>} title={props.backupBusy ? "正在处理备份…" : "一键备份"} text="棋谱库、题库、进度、草稿、设置与大型索引清单" disabled={props.backupBusy} onClick={props.onExportBackup}/>
        <SettingsLink icon={<RotateCw/>} title="恢复备份" text="导入前完整校验，失败自动回滚，不覆盖目录授权" disabled={props.backupBusy} onClick={props.onRestoreBackup}/>
        <SettingsLink icon={<Info/>} title="格式兼容说明" text="各格式的可写能力、保真范围与数据库边界" onClick={props.onOpenHelp}/>
      </SettingsSection>}

      {searchable("设备布局", "平板横屏双栏", ["平板", "横屏", "双栏", "走棋", "文字", "功能栏", "图标", "功能区", "按钮", "排序"]) && <SettingsSection icon={<TabletSmartphone/>} order={80} search={normalizedQuery} title="设备布局" summary={props.enhancementSettings.tabletSplit ? "平板横屏双栏已开启" : "默认单栏 · 双栏默认关闭"}>
        {props.onOpenLayout && <SettingsLink icon={<Settings2/>} title="功能区布局" text="打谱 · 读谱 · 做题" onClick={props.onOpenLayout}/>}
        <SettingRow title="平板横屏双栏" text="在平板或横屏设备上将棋盘与操作区并排显示" checked={props.enhancementSettings.tabletSplit} onChange={(tabletSplit) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, tabletSplit })}/>
      </SettingsSection>}

      {searchable("开发测试功能", "尚未成熟的实验开关，默认关闭", ["开发", "测试", "实验", "复原手序", "识谱"]) && <SettingsSection icon={<FlaskConical/>} order={72} search={normalizedQuery} title="开发测试功能" summary={props.enhancementSettings.devMoveOrderRestore ? "复原手序（实验）已开启" : "实验开关 · 默认关闭"}>
        <p className="settings-feature-note">这里的开关用于试用尚未打磨成熟的新功能，行为与界面可能随时调整；不使用时保持关闭即可。</p>
        <SettingRow title="图片识谱「复原手序」" text="实验功能：导入带落子序号的截图时，尝试按序号重建落子顺序；开启后导入流程中出现对应开关。真实截图成功率仍在改进，默认关闭" checked={props.enhancementSettings.devMoveOrderRestore} onChange={(devMoveOrderRestore) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, devMoveOrderRestore })}/>
      </SettingsSection>}

      {searchable("使用手册与反馈", "先看操作说明，再反馈问题或建议", ["手册", "反馈", "引导", "新手"]) && <SettingsSection icon={<BookOpen/>} order={90} search={normalizedQuery} title="使用手册与反馈" summary="先看操作说明，再反馈问题或建议">
        <SettingsLink icon={<Compass/>} title="新手引导" text="高亮 spotlight 再走一遍核心功能，约 1 分钟" onClick={props.onOpenTour}/>
        <SettingsLink className="manual-entry-link" icon={<BookOpen/>} title="使用手册" text="逐项了解棋盘、棋谱库、题库、AI、导入导出和设置" onClick={props.onOpenManual}/>
        <SettingsLink icon={<Mail/>} title="反馈问题或建议" text="通过邮件或 GitHub Issue 发送，内容不会自动上传" onClick={props.onOpenFeedback}/>
      </SettingsSection>}

      {searchable("关于", "项目说明、维护计划与下载地址", ["版本", "GitHub", "更新"]) && <SettingsSection icon={<Info/>} order={100} search={normalizedQuery} title="关于" summary="项目说明、维护计划与下载地址">
        <SettingRow title="启动时自动检查新版本" text="联网查询 GitHub 的最新正式版本；发现新版本会在快捷中心提示。关闭后仍可在关于页手动检查" checked={props.updateAutoCheck} onChange={props.onUpdateAutoCheckChange}/>
        <SettingsLink icon={<Info/>} title="关于半步五子棋打谱" text="版本、检查更新、项目说明与 GitHub 下载" onClick={props.onOpenAbout}/>
      </SettingsSection>}

      {query && visibleSectionCount === 0 && <div className="settings-search-empty"><Search/><b>没有匹配的设置</b><small>试试搜索“棋盘”“字号”“导入”或“AI”。</small><button type="button" onClick={() => setQuery("")}>清除搜索</button></div>}
      <div className="version-note">半步五子棋打谱 {APP_VERSION} · Web / PWA / Android</div>
    </div>
  </>;
}

function BoardDisplayPreview({ showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize }: { showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean; showLastMove: boolean; moveNumberScale: number; gridLineWidth: number; coordinateFontSize: number }) {
  const gap = 26;
  const originX = 36;
  const originY = 28;
  const cols = 7;
  const rows = 5;
  const px = (col: number) => originX + col * gap;
  const py = (row: number) => originY + row * gap;
  const width = originX * 2 + (cols - 1) * gap;
  const height = originY * 2 + (rows - 1) * gap;
  const stoneRadius = 10.5;
  // 黑棋左三右二、中间留一个长连禁手点（黑下在此处即为六连）；白棋上二下三，末手白10 带标记。
  const stones = [
    { col: 0, row: 2, player: "black", number: 1, last: false },
    { col: 2, row: 0, player: "white", number: 2, last: false },
    { col: 1, row: 2, player: "black", number: 3, last: false },
    { col: 5, row: 0, player: "white", number: 4, last: false },
    { col: 2, row: 2, player: "black", number: 5, last: false },
    { col: 1, row: 3, player: "white", number: 6, last: false },
    { col: 4, row: 2, player: "black", number: 7, last: false },
    { col: 3, row: 3, player: "white", number: 8, last: false },
    { col: 5, row: 2, player: "black", number: 9, last: false },
    { col: 4, row: 3, player: "white", number: 10, last: true },
  ];
  const numberFontSize = Math.max(7, stoneRadius * 0.64) * moveNumberScale;
  return (
    <svg className="board-display-preview-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="棋盘显示实时预览">
      <rect x="6" y="6" width={width - 12} height={height - 12} rx="10" className="board-preview-bg"/>
      {Array.from({ length: cols }, (_, col) => <g key={`v${col}`} style={{ strokeWidth: gridLineWidth }}><line x1={px(col)} y1={py(0)} x2={px(col)} y2={py(rows - 1)}/></g>)}
      {Array.from({ length: rows }, (_, row) => <g key={`h${row}`} style={{ strokeWidth: gridLineWidth }}><line x1={px(0)} y1={py(row)} x2={px(cols - 1)} y2={py(row)}/></g>)}
      <circle cx={px(3)} cy={py(2)} r="2.4" className="board-preview-star"/>
      {showCoordinates && Array.from({ length: cols }, (_, col) => <text key={`t${col}`} style={{ fontSize: coordinateFontSize }} className="board-preview-coord" x={px(col)} y={originY - 12}>{String.fromCharCode(65 + col)}</text>)}
      {showCoordinates && Array.from({ length: rows }, (_, row) => <text key={`n${row}`} style={{ fontSize: coordinateFontSize }} className="board-preview-coord" x={originX - 16} y={py(row) + coordinateFontSize / 3}>{rows - row}</text>)}
      {showForbidden && <g pointerEvents="none"><circle cx={px(3)} cy={py(2)} r={stoneRadius * 0.66} className="forbidden-point" fill="none"/><text x={px(3)} y={py(2) + stoneRadius * 0.2} textAnchor="middle" className="forbidden-point-label" style={{ fontSize: `${Math.max(9, stoneRadius * 0.5)}px`, fill: "var(--red)", fontWeight: 700 }} stroke="none">长</text></g>}
      {stones.map((stone) => (
        <g key={stone.number}>
          <circle cx={px(stone.col)} cy={py(stone.row)} r={stoneRadius} className={`board-preview-stone ${stone.player}`}/>
          {showNumbers && <text x={px(stone.col)} y={py(stone.row) + stoneRadius * 0.28} className={`move-number ${stone.player}${stone.last && showLastMove ? " last-move-number" : ""}`} style={{ fontSize: `${numberFontSize}px` }}>{stone.number}</text>}
          {stone.last && showLastMove && !showNumbers && <circle cx={px(stone.col)} cy={py(stone.row)} r={Math.max(3, stoneRadius * 0.25)} className="last-dot"/>}
        </g>
      ))}
    </svg>
  );
}

export function SettingsLink({ icon, title, text, onClick, disabled = false, className = "" }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button className={`settings-link ${className}`.trim()} disabled={disabled} onClick={onClick}><span>{icon}<b>{title}</b><small>{text}</small></span><ChevronRight/></button>;
}

function AppearanceSubsection({ icon, title, summary, search = "", keywords = [], children }: { icon: ReactNode; title: string; summary: string; search?: string; keywords?: string[]; children: ReactNode }) {
  const normalizedSearch = search.trim().toLowerCase();
  const matches = !normalizedSearch || [title, summary, ...keywords].join(" ").toLowerCase().includes(normalizedSearch);
  return <details className="appearance-center-subsection" open={Boolean(normalizedSearch && matches)}>
    <summary><span className="appearance-center-label"><span className="appearance-center-icon" aria-hidden="true">{icon}</span><span><b>{title}</b><small>{summary}</small></span></span><ChevronDown aria-hidden="true"/></summary>
    <div className="appearance-center-subsection-body">{children}</div>
  </details>;
}

export function SettingsSection({ title, summary, open = false, icon, order, search = "", children }: { title: string; summary: string; open?: boolean; icon?: ReactNode; order?: number; search?: string; children: ReactNode }) {
  return <details className={`settings-group settings-collapsible${order === undefined ? "" : ` settings-order-${order}`}`} open={open || Boolean(search)}><summary className="settings-section-toggle"><span className="settings-section-icon" aria-hidden="true">{icon || <Settings2/>}</span><span className="settings-section-title"><b>{title}</b><small>{summary}</small></span><ChevronDown/></summary><div className="settings-section-content">{children}</div></details>;
}

const formatStorageSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const readStorageUsage = async () => {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return typeof estimate?.usage === "number" ? formatStorageSize(estimate.usage) : null;
  } catch {
    return null;
  }
};

function StorageSettings({ defaultDirectory, directorySupported, nativeDirectorySupported, onChoose, onClear }: { defaultDirectory: ExportDirectoryHandle | null; directorySupported: boolean; nativeDirectorySupported: boolean; onChoose: () => void; onClear: () => void }) {
  const [usage, setUsage] = useState<string | null>(null);
  // 默认位置是「下载」还是退回「文档」要看设备能力（公共下载目录 API 29+ 才可
  // 免权限写入），所以先按文档兜底渲染，探测回来再改成实际位置。
  const [fallbackLocation, setFallbackLocation] = useState<string | null>(() => exportLocationLabel(nativeExportDirectoryHandle()));

  useEffect(() => {
    let active = true;
    void readStorageUsage().then((value) => { if (active) setUsage(value); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!nativeDirectorySupported) return undefined;
    let active = true;
    void defaultNativeExportHandle().then((handle) => { if (active) setFallbackLocation(exportLocationLabel(handle)); });
    return () => { active = false; };
  }, [nativeDirectorySupported]);

  // Android shows the system document picker (SAF) instead of a path field, so
  // "chosen" is any stored native/SAF folder; the web build stores a directory
  // handle. Until a folder is chosen, exports use the default location.
  const pickedFolder = defaultDirectory && (isSafDirectoryHandle(defaultDirectory) || isNativeDirectoryHandle(defaultDirectory)) ? defaultDirectory : null;
  const webDirectory = defaultDirectory && !pickedFolder ? defaultDirectory : null;
  return <div className="storage-settings-body">
    <div className="storage-summary"><span className="storage-icon"><Save size={18}/></span><div><div className="storage-summary-heading"><b>应用内数据</b><em>本机</em></div><p>棋谱库、题库、回收站、草稿和设置都放在系统给 App 的内部空间里，不需要你选文件夹；卸载或清除数据会一起消失，想留档请用“数据与兼容”里的一键备份。</p>{usage && <span className="storage-usage">已用 {usage}</span>}</div></div>
    <div className="storage-divider"/>
    <div className="storage-destination"><span className={`storage-icon folder ${defaultDirectory ? "ready" : ""}`}><FolderOpen size={18}/></span><div className="storage-destination-copy"><div className="storage-summary-heading"><b>导出位置</b>{pickedFolder ? <em className="ready">已设置</em> : <em>默认</em>}</div>{nativeDirectorySupported ? <p>{pickedFolder ? `导出的棋谱和 PNG 会写入“${exportLocationLabel(pickedFolder) ?? pickedFolder.name}”` : "还没选文件夹。点右侧按钮会打开系统的文件管理，选一个文件夹长期使用；不选就先用下面的默认位置。"}</p> : <p>{webDirectory ? `导出文件会直接写入“${exportLocationLabel(webDirectory) ?? webDirectory.name}”` : directorySupported ? "尚未设置，导出会进入浏览器默认下载目录。" : "当前环境不支持选择文件夹，导出会进入默认下载目录。"}</p>}{nativeDirectorySupported && <code className="storage-path">{pickedFolder ? `当前文件夹：${exportLocationLabel(pickedFolder) ?? pickedFolder.name}` : `默认位置：${fallbackLocation ?? "文档"}`}</code>}</div><button type="button" className="storage-action" onClick={onChoose}>{nativeDirectorySupported ? (pickedFolder ? "更换文件夹" : "选择文件夹") : defaultDirectory ? "更换" : "选择"}</button></div>
    {pickedFolder && <button type="button" className="storage-remove" onClick={onClear}><X size={14}/>恢复默认位置</button>}
    {webDirectory && <button type="button" className="storage-remove" onClick={onClear}><X size={14}/>取消默认位置</button>}
    <div className="storage-tip"><Info size={14}/><span>{nativeDirectorySupported ? "手机端会打开系统文件夹选择器，选中的文件夹长期有效，不需要额外的存储权限；想换回默认位置随时可以恢复。" : directorySupported ? "网页只会记住文件夹授权和名称，不会读取系统完整路径；可随时更换。" : "可在支持目录权限的浏览器中选择文件夹；当前环境会继续使用默认下载目录。"}</span></div>
  </div>;
}

function SettingRow({ title, text, checked, disabled = false, onChange }: { title: string; text: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`setting-row ${disabled ? "disabled" : ""}`}><span><b>{title}</b><small>{text}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/><i/></label>;
}

function SettingChoiceRow({ title, text, value, options, onChange }: {
  title: string;
  text: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return <label className="setting-choice-row"><span><b>{title}</b><small>{text}</small></span><select aria-label={title} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select></label>;
}

function EnhancementSettingsPanel({ settings, onChange }: { settings: EnhancementSettings; onChange: (value: EnhancementSettings) => void }) {
  const update = (patch: Partial<EnhancementSettings>) => onChange({ ...settings, ...patch });
  return <div className="enhancement-settings">
    <p className="settings-feature-note">下面这些功能会增加界面提示或触摸处理；除识谱多核加速（出厂默认开启）外都默认关闭，需要时逐项打开即可。</p>
    <SettingRow title="识谱多核加速" text="图片识谱按手机的处理器核心数与可用内存自动开多个线程并行计算网格与棋子，识别更快、导入时界面不卡；识别结果与单线程逐位相同。关闭后回落单线程" checked={settings.fastRecognition} onChange={(fastRecognition) => update({ fastRecognition })}/>
    <SettingRow title="双指缩放棋盘" text="用两根手指放大或缩小棋盘，适合平板复盘" checked={settings.gestureZoom} onChange={(gestureZoom) => update({ gestureZoom })}/>
    <SettingRow title="双指滑动切手" text="双指左右滑动切换上一手或下一手" checked={settings.gestureSwipe} onChange={(gestureSwipe) => update({ gestureSwipe })}/>
    <SettingRow title="最近导入列表" text="在导入面板保留最近 5 个可快速重开的文件" checked={settings.recentImports} onChange={(recentImports) => update({ recentImports })}/>
    <SettingRow title="AI 棋盘提示点" text="在棋盘上显示 AI 推荐落点和开局候选编号" checked={settings.aiBoardHints} onChange={(aiBoardHints) => update({ aiBoardHints })}/>
    <SettingRow title="开局库（打点簿）" text="人机对局优先查内置开局打点簿（索索夫 / 山口五手两打，按开局规则自动选簿）：命中开局线时按最强打点秒落，未命中回落引擎。关闭时零占用" checked={settings.openingBook} onChange={(openingBook) => update({ openingBook })}/>
    <SettingRow title="操作引导卡片" text="在记录、棋谱库和设置页显示轻量使用提示" checked={settings.coachMarks} onChange={(coachMarks) => update({ coachMarks })}/>
  </div>;
}

function AnalysisSettingsPanel({ settings, onChange }: { settings: EnhancementSettings; onChange: (value: EnhancementSettings) => boolean | void }) {
  const update = (patch: Partial<EnhancementSettings>) => onChange({ ...settings, ...patch });
  const metrics: Array<[AnalysisCandidateMetric, string]> = [["winRate", "胜率"], ["score", "评估分"], ["nodes", "计算量"], ["depth", "深度"]];
  return <div className="analysis-settings-panel">
    <SettingRow title="首行快捷滑动开关" text="开启后首行功能区出现分析滑动开关（滑块即状态，默认在「分析」左侧，可在功能区布局里移动或隐藏），点一下直接开关分析" checked={settings.analysisQuickToggle} onChange={(analysisQuickToggle) => update({ analysisQuickToggle })}/>
    <SettingRow title={settings.analysisSelfPlay ? "自对弈" : "持续"} text={settings.analysisSelfPlay ? "开启后引擎双方逐回合落子，直到五连或满盘；关闭立即停手" : "开启后持续加深当前局面；落子或切换局面后自动重启，不会自动落子"} checked={settings.analysisAuto} onChange={(analysisAuto) => update({ analysisAuto })}/>
    <SettingChoiceRow title="分析模式" value={getAnalysisMode(settings)} text="持续：分析按钮展开面板，一直分析当前局面、越算越深；自对弈：双方交给引擎按每步时限逐回合落子，五连或满盘自动结束；提示：分析按钮不展开面板，点一下想一手直接落子" options={[["continuous", "持续"], ["selfplay", "自对弈"], ["hint", "提示"]]} onChange={(mode) => { onChange(withAnalysisMode(settings, mode as AnalysisMode)); }}/>
    {settings.analysisSelfPlay && <label className="think-search-row"><span><b>自对弈每步时限</b><small>到点即落子；引擎提前算出杀棋会立刻落下不占满时限</small></span><output>{(settings.analysisSelfPlayTimeMs / 1000).toFixed(1)} 秒</output><input aria-label="自对弈每步时限" type="range" min="1000" max="10000" step="500" value={settings.analysisSelfPlayTimeMs} onChange={(event) => update({ analysisSelfPlayTimeMs: Number(event.target.value) })}/></label>}
    <SettingRow title="棋盘显示实时选点" text="将引擎候选点显示在棋盘空位上；这些提示不会落子，也不会写入棋谱" checked={settings.analysisShowCandidates} onChange={(analysisShowCandidates) => update({ analysisShowCandidates })}/>
    <SettingChoiceRow title="候选点显示内容" text="候选点圆标中的数值和分析面板候选列表使用同一指标" value={settings.analysisCandidateMetric} options={metrics} onChange={(analysisCandidateMetric) => update({ analysisCandidateMetric: analysisCandidateMetric as AnalysisCandidateMetric })}/>
    <label className="think-search-row"><span><b>候选点数量</b><small>默认只显示当前最佳点，最多同时显示 10 个引擎选点</small></span><output>{settings.analysisCandidateCount} 选</output><input aria-label="候选点数量" type="range" min="1" max="10" step="1" value={settings.analysisCandidateCount} onChange={(event) => update({ analysisCandidateCount: Number(event.target.value) })}/></label>
    <SettingChoiceRow title="选点小数位数" text="胜率与评估分显示到小数点后几位，最多两位；深度和计算量不受影响" value={String(settings.analysisCandidateDecimals)} options={[["0", "0 位（整数）"], ["1", "1 位"], ["2", "2 位"]]} onChange={(analysisCandidateDecimals) => update({ analysisCandidateDecimals: Number(analysisCandidateDecimals) })}/>
    <SettingRow title="变化预览连线" text="点击候选点后，在棋盘预览变化图时画出各手之间的连线；默认关闭，带序号的预览棋子已足够看清变化。预览期间候选点上的胜率等指标会暂时隐藏，避免互相干扰" checked={settings.analysisPreviewGuide} onChange={(analysisPreviewGuide) => update({ analysisPreviewGuide })}/>
  </div>;
}

function SoundSettingsPanel({ settings, onChange, onPreview }: { settings: SoundSettings; onChange: (value: SoundSettings) => void; onPreview: (cue: SoundCue) => void }) {
  const update = (patch: Partial<SoundSettings>) => onChange({ ...settings, ...patch });
  return <div className="sound-settings">
    <SettingRow title="启用音效" text="关闭后不会创建或唤醒音频上下文" checked={settings.enabled} onChange={(enabled) => update({ enabled })}/>
    <SettingRow title="摆棋时音效" text="下一手、上一手等摆棋操作播放轻提示，落子声跟随总开关" checked={settings.navigateEnabled} onChange={(navigateEnabled) => update({ navigateEnabled })}/>
    <SettingRow title="结果与警告音" text="胜利、禁手、非法操作与错误反馈" checked={settings.feedbackEnabled} onChange={(feedbackEnabled) => update({ feedbackEnabled })}/>
    <div className="sound-profile"><span><b>落子音色</b><small>只改变黑白落子的质感，导航与提示音保持清晰</small></span><div role="radiogroup" aria-label="落子音色">{([["classic", "经典", "均衡、熟悉"], ["wood", "木石", "低沉、短促"], ["crystal", "清响", "明亮、轻柔"], ["real", "实录", "真实棋子敲击录音，随机微变"]] as const).map(([profile, label, text]) => <button key={profile} type="button" className={settings.profile === profile ? "selected" : ""} role="radio" aria-checked={settings.profile === profile} onClick={() => update({ profile })}><b>{label}</b><small>{text}</small><Check aria-hidden="true"/></button>)}</div></div>
    <label className={`sound-volume ${!settings.enabled ? "disabled" : ""}`}><span><b>音量</b><small>只调整半步五子棋打谱，不改变系统媒体音量</small></span><output>{Math.round(settings.volume * 100)}%</output><input aria-label="音效音量" type="range" min="0" max="100" step="1" value={Math.round(settings.volume * 100)} disabled={!settings.enabled} onChange={(event) => update({ volume: Number(event.target.value) / 100 })}/></label>
    <div className="sound-preview" aria-label="试听音效"><button type="button" disabled={!settings.enabled} onClick={() => onPreview("move-black")}>试听落子</button><button type="button" disabled={!settings.enabled || !settings.feedbackEnabled} onClick={() => onPreview("success")}>试听完成</button><button type="button" disabled={!settings.enabled || !settings.feedbackEnabled} onClick={() => onPreview("warning")}>试听警告</button></div>
    <p className="sound-budget-note">音色除「实录」外由 Web Audio 实时合成；实录播放应用内置的短录音，均不联网。首次试听或落子后才会启用浏览器音频。</p>
  </div>;
}

function VisualThemeSettings({ boardTheme, stoneTheme, onBoardThemeChange, onStoneThemeChange, only = "both" }: { boardTheme: BoardTheme; stoneTheme: StoneTheme; onBoardThemeChange: (value: BoardTheme) => void; onStoneThemeChange: (value: StoneTheme) => void; only?: "board" | "stone" | "both" }) {
  const boards: Array<[BoardTheme, string, string]> = [["wood", "原木棋盘", "温暖木色，默认风格"], ["jade", "玉石棋盘", "青玉底色，柔和对比"], ["notebook", "练习本", "纸张横线与红色边线"], ["emerald", "翡翠棋盘", "深翠绿与金色网格"], ["porcelain", "青花瓷棋盘", "暖瓷白棋面与深钴蓝网格"], ["whitejade", "白玉棋盘", "柔白玉色，冷静通透"], ["walnut", "深胡桃木", "深棕木纹与暖色边框"], ["frosted", "磨砂玻璃", "半透明雾面与柔和网格"], ["circuit", "电路棋盘", "暗色底与蓝绿发光线路"], ["minimal", "极简棋盘", "纯色棋面与清晰灰黑网格"], ["blackgold", "尊贵黑金棋盘", "黑曜石漆面与香槟金线"], ["pale", "苍白世界棋盘", "月白矿石与石墨灰线"], ["kawaii", "卡哇伊棋盘", "奶油莓粉与柔紫网格"], ["aurora", "极光棋盘", "极夜玻璃与流彩极光"]];
  const stones: Array<[StoneTheme, string, string]> = [["classic", "经典棋子", "黑白高光"], ["jade", "玉石棋子", "青玉与白玉"], ["yun", "云子棋子", "温润黑白云子"], ["ink", "墨蓝棋子", "练习本墨水质感"], ["mono", "黑白极简", "纯黑纯白，无光泽"], ["notebook", "勾叉棋子", "黑叉与红勾手绘笔迹"], ["porcelain", "青花瓷棋子", "青白瓷釉与蓝色纹样"], ["snow", "雪晶棋子", "深冰晶与浅霜晶，带结冰切面"], ["terminal", "终端字符棋子", "深色终端盘配荧光描边"], ["gold-diamond", "黑钻白金棋子", "黑棋钻石质感，白棋黄金质感"], ["gold", "鎏金棋子", "黑棋鎏金纹理与暖金高光"], ["diamond", "钻石棋子", "黑白钻石切面与折射高光"], ["blackgold", "尊贵黑金棋子", "黑玛瑙与鎏金珠光"], ["pale", "苍白世界棋子", "石墨黑与银白珍珠"], ["kawaii", "卡哇伊棋子", "草莓粉小猫与薄荷青搭档"], ["aurora", "极光棋子", "极夜深青与极光凝珠"]];
  return <div className="visual-theme-settings">
    {only !== "stone" && <div><b className="visual-theme-label">棋盘材质</b><div className="visual-option-grid">{boards.map(([value, label, text]) => <button key={value} type="button" className={boardTheme === value ? "selected" : ""} onClick={() => onBoardThemeChange(value)}><i className={`board-preview ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="visual-check" aria-hidden="true"/></button>)}</div></div>}
    {only !== "board" && <div><b className="visual-theme-label">棋子材质</b><div className="visual-option-grid">{stones.map(([value, label, text]) => <button key={value} type="button" className={stoneTheme === value ? "selected" : ""} onClick={() => onStoneThemeChange(value)}><i className={`stone-preview ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="visual-check" aria-hidden="true"/></button>)}</div></div>}
    {only === "both" && <p className="visual-theme-note"><b>建议关闭显示手数。</b> 手绘勾叉需要保持笔触完整；禁手叉号、AI 推荐点、胜负光效和落子编号会自动使用适合当前材质的对比色，动画也会尊重系统的减少动态效果设置。</p>}
  </div>;
}

function AnnotationHighlightSetting({ value, onChange }: { value: AnnotationHighlight; onChange: (value: AnnotationHighlight) => void }) {
  const options: Array<[AnnotationHighlight, string]> = [["none", "无"], ["white", "白色"], ["gold", "金色"], ["blue", "蓝色"]];
  return <div className="annotation-highlight-setting">
    <div className="annotation-highlight-heading"><b>标注高亮</b><small>为棋盘上的文字、圈线与形状增加轮廓光</small></div>
    <div className="annotation-highlight-options" role="radiogroup" aria-label="标注高亮颜色">
      {options.map(([option, label]) => <button key={option} type="button" className={`${value === option ? "selected" : ""} highlight-${option}`} role="radio" aria-checked={value === option} onClick={() => onChange(option)}><i aria-hidden="true"/><span>{label}</span></button>)}
    </div>
    <p>棋盘颜色过深会影响标注字体，可选择打开标注高亮</p>
  </div>;
}

interface MaterialLivePreviewProps {
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  boardOpacity: number;
  stoneOpacity: number;
  label: string;
}

function MaterialLivePreview({ boardTheme, stoneTheme, boardOpacity, stoneOpacity, label }: MaterialLivePreviewProps) {
  return <div className={`material-live-preview board-${boardTheme} stones-${stoneTheme}`} aria-label={label}>
    <span className="material-preview-wallpaper" aria-hidden="true"/>
    <span className={`material-preview-board board-preview ${boardTheme}`} style={{ opacity: boardOpacity }} aria-hidden="true"/>
    <span className="material-preview-grid" aria-hidden="true"/>
    <i className={`material-preview-stone black stone-preview ${stoneTheme}`} style={{ opacity: stoneOpacity }} aria-hidden="true"/>
    <i className={`material-preview-stone white stone-preview ${stoneTheme}`} style={{ opacity: stoneOpacity }} aria-hidden="true"/>
    <b aria-hidden="true">12</b><em aria-hidden="true">荐</em>
  </div>;
}

function BoardOpacitySetting({ value, stoneOpacity, boardTheme, stoneTheme, onChange }: { value: number; stoneOpacity: number; boardTheme: BoardTheme; stoneTheme: StoneTheme; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  return <div className="board-opacity-setting">
    <div className="board-opacity-heading"><span><b>棋盘透明度</b><small>只改变棋面底色和边框，让页面背景主题透出；网格、坐标与提示保持清晰</small></span><output>{percent}%</output></div>
    <MaterialLivePreview boardTheme={boardTheme} stoneTheme={stoneTheme} boardOpacity={value} stoneOpacity={stoneOpacity} label={`当前棋盘与棋子材质预览，棋盘透明度 ${percent}%`}/>
    <input aria-label="棋盘透明度" type="range" min={Math.round(MIN_BOARD_OPACITY * 100)} max="100" step="1" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)}/>
    <div className="board-opacity-footer"><small>最低 {Math.round(MIN_BOARD_OPACITY * 100)}%，保证网格与棋面仍有足够层次</small><button type="button" disabled={value === DEFAULT_BOARD_OPACITY} onClick={() => onChange(DEFAULT_BOARD_OPACITY)}>恢复默认</button></div>
  </div>;
}

function StoneOpacitySetting({ value, boardOpacity, boardTheme, stoneTheme, onChange }: { value: number; boardOpacity: number; boardTheme: BoardTheme; stoneTheme: StoneTheme; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  return <div className="stone-opacity-setting">
    <div className="stone-opacity-heading"><span><b>棋子透明度</b><small>只改变黑白棋子本体；手数、最后一手、禁手和候选点保持清晰</small></span><output>{percent}%</output></div>
    <MaterialLivePreview boardTheme={boardTheme} stoneTheme={stoneTheme} boardOpacity={boardOpacity} stoneOpacity={value} label={`当前棋盘与棋子材质预览，棋子透明度 ${percent}%`}/>
    <input aria-label="棋子透明度" type="range" min={Math.round(MIN_STONE_OPACITY * 100)} max="100" step="1" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)}/>
    <div className="stone-opacity-footer"><small>最低 {Math.round(MIN_STONE_OPACITY * 100)}%，避免棋子在壁纸或深浅棋盘上消失</small><button type="button" disabled={value === DEFAULT_STONE_OPACITY} onClick={() => onChange(DEFAULT_STONE_OPACITY)}>恢复默认</button></div>
  </div>;
}
