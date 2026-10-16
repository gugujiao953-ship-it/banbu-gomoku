import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Accessibility, ArchiveRestore, BookOpen, Bot, Check, ChevronDown, ChevronRight, Compass, Download, Eye, FileKey2, FlaskConical, FolderOpen, Globe, Info, Mail, Palette, PlayCircle, RotateCw, Save, Search, Settings2, SlidersHorizontal, Sparkles, TabletSmartphone, Upload, Volume2, X } from "lucide-react";
import type { FontScale } from "../../accessibility";
import type { BoardTheme, ResolvedTheme, StoneTheme, ThemePreference } from "../../app-shell-types";
import { THEME_OPTIONS as themeOptions } from "../../theme-options";
import { RETIRED_BOARD_THEMES, RETIRED_STONE_THEMES, materialBoards, materialStones } from "../../appearance/render";
import { DROP_EFFECTS, PLACE_EFFECTS } from "../../appearance/effects";
import { findDropEffect, findPlaceEffect, type MotionEffectsSettings } from "../../motion-effects-settings";
import { MotionEffectsPreview } from "./MotionEffectsPreview";
import { SettingChip, SettingChipGroup } from "./SettingChips";
// 问号浮层用（`LinkInfo` 与 `SettingChip` 同一套交互）。
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import { VisualOptionPager } from "./VisualOptionPager";
import { BoardChip, MaterialBoardCrop, StoneChip } from "../../appearance/preview";
import { AppearancePanes } from "./AppearancePanes";
// 棋魂解锁（用户 2026-10-10）：主题 / 棋盘 / 棋子卡右侧显示魂火 + 价格，
// 点了弹"是否购买"。这套东西的形态统一在 SoulLockable 里，这里只提供预览内容。
import { LockableOption, SoulBuyDialog } from "../progress/SoulLockable";
import { SoulFlame } from "../progress/SoulFlame";
import { SOUL_UNLOCKS, type SoulUnlock } from "../progress/soul-unlocks";
import { formatSoulAmount, saveVcfLevelPaid } from "../progress/soul";
import { clearDuelHistory } from "../duel/duel-history";
import { soulUnlockForTarget } from "../progress/soul-unlocks";
import { useSoulShop } from "../progress/use-soul-shop";
import type { SoundCue } from "../../audio-engine";
import type { SoundSettings } from "../../audio-settings";
import { APP_VERSION } from "../../diagnostics";
import { DEFAULT_COORDINATE_FONT_SIZE } from "./display-defaults";
import { ENHANCEMENT_SECTION_KEYS, countEnabledEnhancements } from "./enhancement-section";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "../../game";
import { DEFAULT_BOARD_MARGIN, boardMarginLabel, clampBoardMargin, minBoardMargin } from "./board-margin";
import { DEFAULT_STONE_SCALE, MAX_STONE_SCALE, MIN_STONE_SCALE, STONE_SCALE_STEP, clampStoneScale, stoneSizeLabel } from "./stone-size";
import { DEFAULT_MOVE_NUMBER_SCALE, MAX_MOVE_NUMBER_SCALE, MIN_MOVE_NUMBER_SCALE, MOVE_NUMBER_SCALE_STEP } from "./move-number-size";
import { engineThreadHint, engineThreadOptions } from "./engine-threads";
import { DEPTH_MAX_OPTIONS, DEPTH_MIN_OPTIONS, depthHint } from "./analysis-depth";
import { needsOnlineProxySetting } from "../online/online-http";

import { nativeEngineInfo, setNativeDotprod } from "../ai/native-engine";
import { KataTuning } from "../ai/KataTuning";
import { isAiVisionConfigured, normalizeAiVisionConfig, testAiVisionConnection, type AiVisionConfig, type AiVisionFormat } from "../record/move-order-ai";

/** 让用户能直接看到用的是哪份原生二进制——arm64 的 DotProd 加速只能在真机上验证。 */
const nativeEngineVariantLabel = (): string => {
  const variant = nativeEngineInfo()?.binaryVariant;
  if (variant === "dotprod") return "（已启用 NEON DotProd 加速）";
  if (variant === "baseline") return "（基线构建，CPU 无 DotProd 特性）";
  return "";
};
import { fmtAnalysisMemory, getAnalysisMode, withAnalysisMode, type AnalysisCandidateMetric, type AnalysisMode, type EnhancementSettings, DEFAULT_ENHANCEMENT_SETTINGS } from "../../enhancement-settings";
import { defaultNativeExportHandle, exportLocationLabel, isNativeDirectoryHandle, isSafDirectoryHandle, nativeExportDirectoryHandle, type ExportDirectoryHandle } from "../../file-destination";
import type { PlaybackBranchPolicy, PlaybackSpeed } from "../research/record-playback";
import { DEFAULT_BOARD_OPACITY, MIN_BOARD_OPACITY } from "../../board-opacity";
import { DEFAULT_STONE_OPACITY, MIN_STONE_OPACITY } from "../../stone-opacity";
import type { AnnotationHighlight } from "../../annotation-highlight";
import { EnginePackSection } from "../ai/EnginePackSection";

interface SettingsPageProps {
  onOpenLayout?: () => void;
  /** 顶部提示（App 的 setToast）。可选：设置页被独立渲染时（测试/门禁）没有它也不报错。 */
  onNotice?: (message: string) => void;
  /** 在线棋谱库：代理地址只在浏览器版需要（安卓原生走系统网络直连）。 */
  onOpenOnlineLibrary: () => void;
  onlineProxy: string;
  onOnlineProxyChange: (value: string) => void;
  /** AI 识图复原手序（实验）：用户自备 OpenAI 兼容端点/Key/模型。可选——设置页被独立渲染（测试）时没有它也不报错。 */
  aiVision?: AiVisionConfig;
  onAiVisionChange?: (config: AiVisionConfig) => void;
  // 分析引擎档位：快捷中心有这一项，设置页必须同步有（快捷中心自定义条目池的硬约束）。
  aiEngineChoice: "light" | "strong" | "tuned" | "kata" | "ikatago";
  /** rapfi 可用（wasm 引擎包已装，或本机原生引擎就绪）。 */
  enginePackReady: boolean;
  /** 安卓原生引擎是否就绪。就绪时强力/自调不需要下载 40MB 引擎包。 */
  nativeEngineReady?: boolean;
  onAiEngineChoiceChange: (value: "light" | "strong" | "tuned" | "kata" | "ikatago") => void;
  /** KataGo 旗舰引擎探测结果（仅安卓有插件时可能为 true）。 */
  kataEngineReady?: boolean;
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
  /** 「自定义背景」时界面用哪一套主题（用户 2026-10-12；背景归自定义、界面归它）。 */
  customUiTheme: ResolvedTheme;
  onCustomUiThemeChange: (value: ResolvedTheme) => void;
  onCustomBackgroundColorChange: (value: string) => void;
  onChooseBackgroundImage: () => void;
  onClearBackgroundImage: () => void;
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  boardOpacity: number;
  stoneOpacity: number;
  annotationHighlight: AnnotationHighlight;
  onBoardThemeChange: (value: BoardTheme) => void;
  /**
   * 外观**预览**（用户 2026-10-10：「现在不交钱无法预览了，就很不好……
   * 点击可以预览，点击右边那个地方才是购买」）。
   *
   * `onPreviewAppearance` 只把界面切过去（App 那边保证**不落盘**）；
   * `onPreviewEnd(commit)` 收尾：`false` = 没买 ⇒ 回到预览前那一套。
   * 不传就没有预览（退回"点卡片直接弹购买"的旧行为）。
   */
  onPreviewAppearance?: (patch: { theme?: ThemePreference; customUiTheme?: ResolvedTheme; board?: BoardTheme; stone?: StoneTheme }) => void;
  onPreviewEnd?: (commit: boolean) => void;
  /**
   * 数据被**棋魂一次性动作**改过（VCF 起始等级档位 —— 就是「重置等级分」那排五档）。
   *
   * 为什么需要这个回调而不是让 App 每次重新读盘：战绩账本是 App 的 state
   * （`duelHistory`），它不会因为 localStorage 被改了而自己更新 ——
   * 不通知的话，用户重置完等级分、回到对弈页看到的还是旧分数。
   */
  onDataReset?: (what: "duel" | "vcf") => void;
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
  boardMargin: number;
  onBoardMarginChange: (value: number) => void;
  stoneSize: number;
  onStoneSizeChange: (value: number) => void;
  onMotionEnabledChange: (value: boolean) => void;
  /** 主题动效独立开关（默认开）：老机型误报「减少动态效果」时靠它把主题装饰动画放出来。 */
  themeMotion: boolean;
  onThemeMotionChange: (value: boolean) => void;
  /** 公用效果（落子交互 / 棋子进场）：与材质无关，独立持久化。 */
  motionEffects: MotionEffectsSettings;
  onMotionEffectsChange: (value: MotionEffectsSettings) => void;
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
  /** 打开「本机凭证」面板（2026-10-11）。 */
  onOpenVault: () => void;
  onOpenHelp: () => void;
  onOpenAbout: () => void;
  onOpenManual: () => void;
  onOpenTour: () => void;
  onOpenFeedback: () => void;
  enhancementSettings: EnhancementSettings;
  onEnhancementSettingsChange: (value: EnhancementSettings) => void;
  /** 落子方式（用户 2026-10-13）：true＝点击确认落子（点一下出圈、再点才落）。
   *  单独走 `banbu-placement-confirm-v1` 一个标量键，不在 enhancementSettings 那个整份写回的 blob 里。 */
  placementConfirm: boolean;
  onPlacementConfirmChange: (value: boolean) => void;
  updateAutoCheck: boolean;
  onUpdateAutoCheckChange: (value: boolean) => void;
  // 语音报手（用户 09-23）：平台不支持时整项不渲染，所以可用性从外面传进来。
  speechAvailable: boolean;
  speechEnabled: boolean;
  speechRate: number;
  onSpeechEnabledChange: (value: boolean) => void;
  onSpeechRateChange: (value: number) => void;
}


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
  // 从常量推导，不要写死：这里原先写死 `length: 17`（5–21 路），而应用早已支持
  // 5–30 路（App.tsx 的 BOARD_SIZE_CHOICES 就是推导的），于是设置页的「默认棋盘大小」
  // 比实际能力少了 4 档。用户 09-23 报的「功能已经很多、标注还是旧的」正是这一类。
  const boardSizeOptions = Array.from({ length: MAX_BOARD_SIZE - MIN_BOARD_SIZE + 1 }, (_, index) => index + MIN_BOARD_SIZE);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const searchable = useMemo(() => (title: string, summary: string, keywords: string[] = []) => {
    if (!normalizedQuery) return true;
    return [title, summary, ...keywords].join(" ").toLowerCase().includes(normalizedQuery);
  }, [normalizedQuery]);
  // 引擎包分区（EnginePackSection）在原生（安卓）引擎就绪时整节不渲染——那一节里
  // 没有任何动作，只剩一份被用户认定为重复的引擎介绍（用户 2026-10-01 与 2026-10-02
  // 两次提，第二次明确「去掉那个外面的这个按钮」；详见 EnginePackSection 里 return null
  // 上方那段注释）。搜索索引必须和渲染共用这一个判据：否则搜「引擎」会数出一个根本
  // 不渲染、点了什么都不会发生的分类——「找到 N 个分类」与下面的分区都得认它。
  const enginePackSectionVisible = props.nativeEngineReady !== true;
  // 分区标题与关键词同样两处共用一份：索引里写的是分区真正的标题（网页面是「AI 引擎」），
  // 「强力」这个词靠关键词命中，不再靠把一个已经不存在的标题写进索引。
  const enginePackSectionTitle = "AI 引擎";
  const enginePackSectionSummary = "下载冠军级评估网络包";
  const enginePackSectionKeywords = ["强力", "引擎", "引擎包", "下载", "网络", "棋力", "AI", "冠军", "rapfi"];
  // 「分析」分区同一套判据两处共用：它带「强力」「引擎」这些词，是原生环境下搜
  // 「引擎 / 强力」时唯一还应该出现的入口（引擎包分区那时已经不渲染），索引里漏掉
  // 这些词就会出现「数到 0 个分类却仍显示分区」的自相矛盾（下面的「没有匹配的设置」）。
  const analysisSectionKeywords = ["AI", "引擎", "强力", "胜率", "评估", "深度", "节点", "选点", "小数", "连线", "变化", "开关", "快捷", "思考显示位置", "提示", "自对弈", "落子", "多线程", "线程", "跨源隔离", "棋力", "冠军", "网络包"];
  // 同理，「关于」的判据两处共用：引擎介绍唯一的入口就在关于里那页（原生环境的引擎包
  // 分区已经不再渲染，用户搜「引擎」要能一路走到「关于 → 引擎与模型介绍」，否则他会
  // 以为介绍被删掉了——2026-10-02 的原话是「之前早就放关于里面去了」）。
  const aboutSectionKeywords = ["版本", "GitHub", "更新", "引擎", "rapfi", "katago", "下载"];
  const visibleSectionCount = [
    searchable("外观与音效", "主题、棋盘、棋子与声音", ["颜色", "标注", "高亮", "白色", "金色", "蓝色", "音量", "外观", "音效", "主题"]),
    searchable("棋盘显示", "手数、坐标、禁手和最后一手标记", ["序号", "坐标", "禁手", "最后一手", "红点", "棋盘透明度", "棋子透明度", "背景透出", "透明度"]),
    searchable("无障碍与反馈", "字号、文字大小、动效、震动、配色、语音、键盘和屏幕阅读器", ["字号", "大字", "特大字", "无障碍", "动效", "震动", "振动", "触觉", "反馈", "键盘", "快捷键", "色觉", "色盲", "色弱", "对比", "语音", "朗读", "报手"]),
    searchable("自动演示", "播放速度、分支处理和循环", ["播放", "速度", "分支", "循环"]),
    searchable("分析", "持续分析、引擎和棋盘候选点", analysisSectionKeywords),
    enginePackSectionVisible && searchable(enginePackSectionTitle, enginePackSectionSummary, enginePackSectionKeywords),
    searchable("可选增强功能", "手势、最近导入、AI 提示和开局库", ["手势", "最近导入", "引导", "开局库", "打点簿", "开局", "人机", "识谱", "加速", "多核", "识谱加速", "题库", "在线", "在线棋谱库", "实验", "实验功能", "旋转", "滑轨", "长按", "环形菜单", "状态条", "键盘", "快捷键", "手感", "折叠", "顶栏", "落子", "确认落子", "两段式", "点击确认", "防手滑"]),
    searchable("文件与存储", "储存位置、导出文件夹与上次局面", ["恢复", "导出文件夹", "本机", "储存位置", "存储位置", "保存位置", "文件夹", "占用", "空间"]),
    searchable("数据与兼容", "导入、导出、备份与格式说明", ["导入", "导出", "备份", "格式", "AI", "识图", "大模型", "复原手序", "云端", "豆包", "千问", "凭证", "恢复码", "本机凭证", "换机", "加密"]),
    searchable("设备布局", "按钮宽度溢出后怎么办、横屏一律双栏", ["平板", "横屏", "双栏", "走棋", "文字", "功能栏", "图标", "功能区", "按钮", "排序"]),
    searchable("开发测试功能", "尚未成熟的实验开关，默认关闭", ["开发", "测试", "实验", "路数", "15路"]),
    searchable("使用手册与反馈", "操作说明与反馈", ["手册", "反馈"]),
    searchable("关于", "项目说明、维护计划与下载地址", aboutSectionKeywords),
  ].filter(Boolean).length;
  return <>
    <div className="settings-page page-padding">
      <div className="settings-command-header">
        <div className="settings-search-wrap">
          <label className="settings-search"><Search aria-hidden="true"/><input aria-label="搜索设置" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置，例如字号、棋盘、备份"/><button type="button" onClick={() => setQuery("")} aria-label="清除设置搜索" disabled={!query}><X/></button></label>
          {query && <span className="settings-search-count">找到 {visibleSectionCount} 个分类</span>}
        </div>
      </div>

      {searchable("外观与音效", "主题、棋盘、棋子、声音与动效", ["颜色", "标注", "高亮", "白色", "金色", "蓝色", "音量", "动效", "外观", "音效", "震动", "振动", "触觉", "落子交互", "棋子进场", "公用效果", "特效"]) && <SettingsSection icon={<Palette/>} order={0} search={normalizedQuery} title="外观与音效" summary={`${themeLabel(props.resolvedTheme)} · ${props.boardTheme === "porcelain" ? "青花瓷棋盘" : "主题、棋盘、棋子与音效"}`}>
        <div className="appearance-center-intro"><span><Sparkles/></span><div><b>统一调整视觉与反馈</b><small>主题、棋盘材质、音效和动效集中在这里，改动会即时预览；棋盘与棋子的透明度滑杆在「棋盘显示」一节，预览块仍跟着这里的材质走。</small></div></div>
        <AppearanceSubsection icon={<Palette/>} title="主题" summary={preferenceLabel(props.themePreference)} search={normalizedQuery} keywords={["应用主题", "背景", "颜色"]}>
          <VisualOptionPager label="应用主题" gridClassName="theme-preference" gridRole="radiogroup" gridLabel="外观主题" options={themeOptions.map(([value, label]) => <ThemeOptionButton key={value} value={value} label={label} current={props.themePreference} onSelect={props.onThemePreferenceChange} onPreview={props.onPreviewAppearance} onPreviewEnd={props.onPreviewEnd}/>)}/>
          <p className={`theme-motion-note ${props.motionEnabled ? "enabled" : "disabled"}`}><Sparkles aria-hidden="true"/><span><b>主题动效{props.motionEnabled ? "已开启" : "已关闭"}</b><small>{props.motionEnabled ? "动态光影、微尘与漂浮效果正在运行" : "请在下方“无障碍与反馈”中开启界面动效"}</small></span></p>
          {props.themePreference === "custom" && <div className="custom-background-controls">
            <label><span>背景颜色</span><input type="color" value={props.customBackgroundColor} onChange={(event) => props.onCustomBackgroundColorChange(event.target.value)}/></label>
            <button type="button" onClick={props.onChooseBackgroundImage}>选择本地背景图片</button>
            {props.customBackgroundImage && <button type="button" className="custom-background-clear" onClick={props.onClearBackgroundImage}>清除图片背景</button>}
            <p>图片只保存在本机，最大 2MB；使用深色半透明遮罩保证文字和棋盘控件可读。</p>
            {/* 界面主题（用户 2026-10-12：「自定义那里可以加入一个选择适配主题 ui 的选项
                （不过要记得，解锁了的主题才能用）」）。
                「自定义背景」原来只换背景、界面固定浅色；这里让用户再挑一套主题的
                **界面**（顶栏、面板、按钮、文字），背景仍是上面那张色 / 图。
                `system` / `custom` 不在列：前者是"跟随系统"（不是一种界面）、后者是它自己。
                可锁：锁着的那几套照旧点卡片预览、点右边魂火买（复用同一个 ThemeOptionButton）。 */}
            {/* 界面主题（用户 2026-10-12 两轮）：
                第一轮「自定义那里可以加入一个选择适配主题 ui 的选项（解锁了的主题才能用）」；
                第二轮「选 ui 时不必要全部都展示，搞一个框框，然后选就行了」——
                所以这里不再是第二份卡片网格，而是一个下拉框 + 一行未解锁的处理。 */}
            <CustomUiThemeSelect
              options={themeOptions.filter(([value]) => value !== "system" && value !== "custom")}
              current={props.customUiTheme}
              onSelect={(next) => props.onCustomUiThemeChange(next)}
              onPreview={props.onPreviewAppearance}
              onPreviewEnd={props.onPreviewEnd}/>
          </div>}
        </AppearanceSubsection>
        {/* 外观「三版面」（2026-10-09 重构）。用户：「把棋盘棋子、公用特效都整合吧，就是预览棋盘是用的同一个，
            我们现在搞成三个版面，切换到棋盘就调试棋盘，切换到棋子就调棋子，切换到特效就调特效。
            这三个可以切换的版面放在预览棋盘的下面，横向排列」。
            之前是三节各自独立展开、而材质预览只挂在「棋盘」那节 ⇒ 切到「棋子」时看不到任何棋盘棋子的样子
            （用户原话「棋盘界面有预览，棋子界面没有呀」）。现在共用一块预览 + 下面三个横向标签。 */}
        <AppearanceSubsection icon={<SlidersHorizontal/>} title="棋盘与棋子" summary="棋盘、棋子材质与落子特效，共用一块预览" search={normalizedQuery} keywords={["棋盘材质", "棋子材质", "标注", "高亮", "路数", "落子交互", "进场动画", "公用效果", "特效", "动效"]}>
          <AppearancePanes
            boardTheme={props.boardTheme} stoneTheme={props.stoneTheme}
            boardOpacity={props.boardOpacity} stoneOpacity={props.stoneOpacity}
            onBoardOpacityChange={props.onBoardOpacityChange} onStoneOpacityChange={props.onStoneOpacityChange}
            abovePreview={<AnnotationHighlightSetting value={props.annotationHighlight} onChange={props.onAnnotationHighlightChange}/>}
            boardPane={<>
              {/* 标注高亮已挪到预览上方（abovePreview），这里不再重复 */}
              <VisualThemeSettings only="board" boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onBoardThemeChange={props.onBoardThemeChange} onStoneThemeChange={props.onStoneThemeChange} onPreview={props.onPreviewAppearance} onPreviewEnd={props.onPreviewEnd}/>
              <details className="settings-subsection"><summary><span><b>默认棋盘大小</b><small>新建棋谱默认使用 {props.defaultBoardSize} 路</small></span><ChevronDown/></summary><label className="setting-choice-row"><span><b>棋盘路数</b><small>{`可选 ${MIN_BOARD_SIZE}–${MAX_BOARD_SIZE} 路，默认 15 路`}</small></span><select className="board-size-select" aria-label="默认棋盘路数" value={props.defaultBoardSize} onChange={(event) => props.onDefaultBoardSizeChange(Number(event.target.value))}>{boardSizeOptions.map((size) => <option key={size} value={size}>{size}路</option>)}</select></label></details>
            </>}
            stonePane={<VisualThemeSettings only="stone" boardTheme={props.boardTheme} stoneTheme={props.stoneTheme} onBoardThemeChange={props.onBoardThemeChange} onStoneThemeChange={props.onStoneThemeChange} onPreview={props.onPreviewAppearance} onPreviewEnd={props.onPreviewEnd}/>}
            motionProps={{
              place: props.motionEffects.placeOn ? findPlaceEffect(props.motionEffects.placeId) : null,
              drop: props.motionEffects.dropOn ? findDropEffect(props.motionEffects.dropId) : null,
              live: props.motionEnabled,
            }}
            motionPane={<MotionEffectsPanel settings={props.motionEffects} motionEnabled={props.motionEnabled} onChange={props.onMotionEffectsChange}/>}
          />
        </AppearanceSubsection>
        <AppearanceSubsection icon={<Volume2/>} title="声音与音效" summary={`${props.soundSettings.enabled ? `音量 ${Math.round(props.soundSettings.volume * 100)}%` : "音效已关闭"}`} search={normalizedQuery} keywords={["声音", "音效", "音量"]}>
          <SoundSettingsPanel settings={props.soundSettings} onChange={props.onSoundSettingsChange} onPreview={props.onPreviewSound}/>
        </AppearanceSubsection>
      </SettingsSection>}

      {/* ⚠ 「棋魂解锁」这一节**已删除**（用户 2026-10-11：「设置里面的棋魂系统那个设置你可以去了，
          就是里面卖重置分数什么的的那个」）。
          它原来只放几件一次性动作（重置人机等级分 / VCF 起始等级）。
          删掉**不会让人够不着这些动作**——它们各自还有更贴现场的入口：
            · VCF 起始等级五档（就是面板里那排「重置等级分」）→ VCF 挑战页的设置面板（已收费）；
            · 重置人机等级分 → 战绩与等级分面板的「清空本机战绩」（已收费）。
          所以这里不再列一遍；这也符合用户当初那句「不要搞的太臃肿了」。
          `SoulActionsPanel` 组件随之删除（没有别的调用点，留着就是死代码）。 */}

      {searchable("棋盘显示", "手数、坐标、禁手、最后一手与透明度", ["序号", "坐标", "禁手", "最后一手", "红点", "棋盘透明度", "棋子透明度", "背景透出", "透明度"]) && <SettingsSection icon={<Eye/>} order={10} search={normalizedQuery} title="棋盘显示" summary="手数、坐标、禁手辅助、透明度">
        <div className="board-display-preview"><BoardDisplayPreview showNumbers={props.showNumbers} showCoordinates={props.showCoordinates} showForbidden={props.showForbidden} showLastMove={props.showLastMove} moveNumberScale={props.moveNumberScale} gridLineWidth={props.gridLineWidth} coordinateFontSize={props.coordinateFontSize} boardMargin={props.boardMargin} stoneSize={props.stoneSize}/><small>预览随下方设置实时变化</small></div>
        <SettingRow title="显示手数" text="在棋子上显示落子序号" checked={props.showNumbers} onChange={props.onShowNumbersChange}/>
        <SettingRow title="显示坐标" text="棋盘边缘按当前路数显示列名与行号" checked={props.showCoordinates} onChange={props.onShowCoordinatesChange}/>
        <SettingRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={props.showForbidden} onChange={props.onShowForbiddenChange}/>
        <SettingRow title="最后一手标记" text="最新一手显示红点；开启手数时改为红色高亮序号" checked={props.showLastMove} onChange={props.onShowLastMoveChange}/>
        <div className="board-display-sliders">
          <label><span>棋子大小<small>在当前自动大小上缩放；上限是相邻棋子相切，不会压住旁边的棋子</small></span><div className="slider-line"><input aria-label="棋子大小" type="range" min={MIN_STONE_SCALE} max={MAX_STONE_SCALE} step={STONE_SCALE_STEP} value={clampStoneScale(props.stoneSize)} onChange={(event) => props.onStoneSizeChange(Number(event.target.value))}/><output>{stoneSizeLabel(props.stoneSize)}</output></div></label>
          <label><span>棋子序号大小<small>默认 150%，最大可拉到 200%</small></span><div className="slider-line"><input aria-label="棋子序号大小" type="range" min={MIN_MOVE_NUMBER_SCALE} max={MAX_MOVE_NUMBER_SCALE} step={MOVE_NUMBER_SCALE_STEP} value={props.moveNumberScale} onChange={(event) => props.onMoveNumberScaleChange(Number(event.target.value))}/><output>{Math.round(props.moveNumberScale * 100)}%</output></div></label>
          <label><span>棋盘画线粗细</span><div className="slider-line"><input aria-label="棋盘画线粗细" type="range" min="0.6" max="3" step="0.05" value={props.gridLineWidth} onChange={(event) => props.onGridLineWidthChange(Number(event.target.value))}/><output>{props.gridLineWidth.toFixed(2)}px</output></div></label>
          <label><span>坐标字体大小</span><div className="slider-line"><input aria-label="坐标字体大小" type="range" min="6" max="14" step="0.5" value={props.coordinateFontSize} onChange={(event) => props.onCoordinateFontSizeChange(Number(event.target.value))}/><output>{props.coordinateFontSize.toFixed(1)}px</output></div></label>
          <label><span>棋盘侧边</span><div className="slider-line"><input aria-label="棋盘侧边" type="range" min={minBoardMargin(props.coordinateFontSize)} max={DEFAULT_BOARD_MARGIN} step="1" value={clampBoardMargin(props.boardMargin, props.coordinateFontSize)} onChange={(event) => props.onBoardMarginChange(Number(event.target.value))}/><output>{boardMarginLabel(clampBoardMargin(props.boardMargin, props.coordinateFontSize), props.coordinateFontSize)}</output></div></label>
          {(props.moveNumberScale !== DEFAULT_MOVE_NUMBER_SCALE || props.gridLineWidth !== 1.25 || props.coordinateFontSize !== DEFAULT_COORDINATE_FONT_SIZE || props.boardMargin !== DEFAULT_BOARD_MARGIN || props.stoneSize !== DEFAULT_STONE_SCALE) && <button type="button" className="board-display-reset" onClick={() => { props.onMoveNumberScaleChange(DEFAULT_MOVE_NUMBER_SCALE); props.onGridLineWidthChange(1.25); props.onCoordinateFontSizeChange(DEFAULT_COORDINATE_FONT_SIZE); props.onBoardMarginChange(DEFAULT_BOARD_MARGIN); props.onStoneSizeChange(DEFAULT_STONE_SCALE); }}>恢复默认显示</button>}
        </div>
        {/* 透明度两项从「外观与音效」挪到这里（用户 10-08），**只挪滑杆**（用户 10-09：「把棋盘还回去，
            放在外观 → 棋盘那个原有的地方，你只是要把透明度的调度放到棋盘显示那」）：材质预览块
            不在这一节画，它在「外观 → 棋盘」；两处读同一批状态，所以拖这里的滑杆，那边的预览照变。 */}
        <BoardOpacitySetting value={props.boardOpacity} onChange={props.onBoardOpacityChange}/>
        <StoneOpacitySetting value={props.stoneOpacity} onChange={props.onStoneOpacityChange}/>
      </SettingsSection>}

      {searchable("无障碍与反馈", "调整字号与文字大小、动效、震动、配色与语音，改善键盘与屏幕阅读器使用体验", ["字号", "大字", "特大字", "无障碍", "动效", "动画", "震动", "振动", "触觉", "反馈", "键盘", "快捷键", "色觉", "色盲", "色弱", "对比", "语音", "朗读", "报手"]) && <SettingsSection icon={<Accessibility/>} order={30} search={normalizedQuery} title="无障碍与反馈" summary={`字号、动效、触觉${props.enhancementSettings.colorVisionFriendly ? "、配色" : ""}${props.speechEnabled ? "、语音" : ""}${props.enhancementSettings.keyboardShortcuts ? "与键盘" : ""}`}>
        <div className="font-scale-options" role="radiogroup" aria-label="界面字号">
          {([[
            "normal", "正常",
          ], ["large", "大字"], ["xlarge", "特大字"]] as const).map(([value, label]) => <button key={value} type="button" className={props.fontScale === value ? "selected" : ""} role="radio" aria-checked={props.fontScale === value} onClick={() => props.onFontScaleChange(value)}><b>{label}</b><small>{value === "normal" ? "100%" : value === "large" ? "115%" : "130%"}</small></button>)}
        </div>
        <p className="helper">字号只放大界面文字与控件，不整体缩放棋盘，避免棋盘布局变形。</p>
        <SettingRow title="界面动效" text="关闭落子、导航、胜线与界面过渡；功能仍然完整可用" checked={props.motionEnabled} onChange={props.onMotionEnabledChange}/>
        {/* 主题动效独立开关（用户 2026-10-09 反馈 K20 上「主题只有颜色、没有动效」）：
            老 Android WebView 常年把系统的「减少动态效果」误报为开启，于是主题装饰动画被整体停掉。
            主题动画是纯背景装饰、不承载操作反馈，所以单独给一个闸门，默认开。 */}
        <SettingRow title="主题动效" text="花瓣飘落、黄昏骑行、极光流动这类背景装饰动画；关掉后主题只保留画面。老机型误报「减少动态效果」时，这个开关能把它放出来" checked={props.themeMotion} onChange={props.onThemeMotionChange}/>
        <SettingRow title="触觉反馈" text="落子、导航、禁手与胜负时轻微震动，拖动列表排序也会轻震一下；仅安卓应用内生效，默认关闭" checked={props.enhancementSettings.haptics} onChange={(value) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, haptics: value })}/>
        <SettingRow title="色觉友好配色" text="把标注里最容易混的几对颜色（朱红/松绿、金/棕、莓红/紫）沿明度拉开，并把最后一手标记与胜负线从红改成蓝，红绿色觉异常下也能一眼分清。只影响显示，不改动棋谱里已存的颜色" checked={props.enhancementSettings.colorVisionFriendly} onChange={(value) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, colorVisionFriendly: value })}/>
        {props.speechAvailable && <>
          <SettingRow title="语音报手" text="读谱自动演示时念出每一步，例如「黑 7 · H8」，用来听谱；手动前后翻页不念。当前环境不支持语音合成时这一项不出现" checked={props.speechEnabled} onChange={props.onSpeechEnabledChange}/>
          {props.speechEnabled && <SettingChoiceRow title="语速" text="慢一点更容易跟上；读谱播放本身的速度仍在「自动演示」里控制" value={String(props.speechRate)} options={[["0.8", "慢"], ["1", "正常"], ["1.2", "快"]]} onChange={(value) => props.onSpeechRateChange(Number(value))}/>}
        </>}
      </SettingsSection>}

      {searchable("自动演示", "播放速度、分支处理和循环", ["播放", "速度", "分支", "循环"]) && <SettingsSection icon={<PlayCircle/>} order={15} search={normalizedQuery} title="自动演示" summary={`${props.playbackSpeed}× · ${props.playbackBranchPolicy === "pause" ? "遇分支暂停" : "沿主线继续"} · ${props.playbackLoop ? "循环" : "不循环"}`}>
        <SettingChoiceRow title="播放速度" text="控制自动前进到下一手的等待时间" value={String(props.playbackSpeed)} options={[["0.5", "0.5×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"]]} onChange={(value) => props.onPlaybackSpeedChange(Number(value) as PlaybackSpeed)}/>
        <SettingChoiceRow title="分支处理" text="当前局面出现多个后续时如何继续" value={props.playbackBranchPolicy} options={[["pause", "遇分支暂停"], ["mainline", "沿主线继续"]]} onChange={(value) => props.onPlaybackBranchPolicyChange(value as PlaybackBranchPolicy)}/>
        <SettingRow title="循环当前变化" text="到末尾后回到本次播放起点继续演示" checked={props.playbackLoop} onChange={props.onPlaybackLoopChange}/>
      </SettingsSection>}

      {searchable("分析", "持续分析、引擎和棋盘候选点", analysisSectionKeywords) && <SettingsSection icon={<Bot/>} order={65} search={normalizedQuery} title="分析" summary={props.enhancementSettings.analysisSelfPlay ? "自对弈进行中" : props.enhancementSettings.analysisHintMode ? "提示 · 点击分析直接落子" : props.enhancementSettings.analysisAuto ? `持续 · ${props.enhancementSettings.analysisCandidateCount} 个选点` : "持续已关闭"}>
        <SettingChoiceRow title="分析引擎" text={props.aiEngineChoice === "kata" && props.kataEngineReady ? "katago（作者网）已就绪：分析更快更强、也更耗电；线程与缓存在下方调，设置对所有页面生效" : props.aiEngineChoice === "kata" ? "已选 katago，但网络包还没加载好（手机上冷加载 10~30 秒）——这段时间分析与做题提示先用 rapfi 顶上，就绪后自动回到 katago，不用再回来点一次" : props.nativeEngineReady ? `本机原生引擎已就绪${nativeEngineVariantLabel()}：速度约为网页版的数倍，内存与线程在下方调` : props.enginePackReady ? "rapfi 已就绪：内存自调与线程数在下方调" : "内置引擎（自带轻量网络）：分析与对弈都能用，下载冠军网络包可提升棋力"} value={props.aiEngineChoice === "kata" ? "katago" : "rapfi"} options={(props.kataEngineReady || props.aiEngineChoice === "kata" ? [["rapfi", "rapfi"], ["katago", "katago"]] : [["rapfi", "rapfi"]]) as readonly (readonly [string, string])[]} onChange={(value) => props.onAiEngineChoiceChange((value === "katago" ? "kata" : "strong") as "kata" | "strong")}/>
        {props.aiEngineChoice === "kata" && props.kataEngineReady ? (
          <KataTuning onNotice={props.onNotice}/>
        ) : <>
        {props.nativeEngineReady && nativeEngineInfo()?.dotprodPreference !== undefined && (() => {
          const info = nativeEngineInfo(); const capable = info?.dotprodCapable === true;
          const on = (info?.dotprodPreference ?? "auto") !== "off" && capable;
          return <SettingRow title="NEON DotProd 加速" text={capable ? "本机 CPU 支持 armv8.2 的 DotProd 指令，NNUE 的 int8 点积走硬件加速（实测二进制含 416 条 sdot/udot，基线为 0 条）。切换后引擎会重启，下一轮搜索生效" : "本机 CPU 不具备 DotProd 能力（需要 armv8.2+），无法开启"} checked={on} onChange={() => { void setNativeDotprod(on ? "off" : "auto").then((ok) => { if (!ok) { props.onNotice?.("切换失败：本机原生引擎不支持该开关"); return; } props.onNotice?.(on ? "已关闭 NEON DotProd，引擎已重启" : "已启用 NEON DotProd，引擎已重启"); }); }}/>;
        })()}
        {true && (
          <div className="tuned-engine-block">
            <div className="tuned-engine-head">
              <span className="tuned-engine-label">分析内存</span>
              <output className="tuned-engine-value">{fmtAnalysisMemory(props.enhancementSettings.analysisMaxMemoryMb)}</output>
              <button type="button" className={`tuned-mini-toggle ${props.enhancementSettings.engineMultiThread ? "on" : ""}`} aria-pressed={props.enhancementSettings.engineMultiThread} title="多线程：开了才用多核（线程数在下方）。网页版多线程 wasm 需要跨源隔离；安卓原生引擎用真线程" onClick={() => props.onEnhancementSettingsChange({ ...props.enhancementSettings, engineMultiThread: !props.enhancementSettings.engineMultiThread })}>多线程<b>{props.enhancementSettings.engineMultiThread ? "开" : "关"}</b></button>
            </div>
            <input aria-label="分析内存滑杆" type="range" min="64" max="2048" step="32" value={props.enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(64, Number(event.target.value))); props.onEnhancementSettingsChange({ ...props.enhancementSettings, analysisMaxMemoryMb: v }); }}/>
            {props.enhancementSettings.engineMultiThread && <label className="tuned-engine-threads"><span>线程数</span><select aria-label="引擎线程数" value={String(props.enhancementSettings.engineThreads)} onChange={(event) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, engineThreads: Number(event.target.value) })}>{engineThreadOptions(undefined, nativeEngineInfo()?.bigCores).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          </div>
        )}
        </>}
        <SettingChoiceRow title="思考显示位置" text="统一显示做题、打谱和人机对战的后台计算状态" value={props.thinkingIndicatorPosition} options={[["corner", "棋盘右上角"], ["below", "棋盘下方"]] as const} onChange={(value) => props.onThinkingIndicatorPositionChange(value as "corner" | "below")}/>


        <AnalysisSettingsPanel settings={props.enhancementSettings} onChange={props.onEnhancementSettingsChange}/>
      </SettingsSection>}

      {/* 判据与上面的搜索索引共用 `enginePackSectionVisible`：原生引擎就绪时分区自己不渲染，
          索引也不能再列它，否则搜「引擎」会数出一个点不开的分类（用户 2026-10-02 的原始
          诉求就是这个介绍副本；上一轮只删分区内文案、索引照旧，bug 因此复发）。 */}
      {enginePackSectionVisible && searchable(enginePackSectionTitle, enginePackSectionSummary, enginePackSectionKeywords) && <EnginePackSection order={66} search={normalizedQuery} nativeReady={props.nativeEngineReady === true} kataReady={props.kataEngineReady === true} kataSelected={props.aiEngineChoice === "kata"}/>}

      {searchable("可选增强功能", "手势、最近导入、AI 提示和开局库", ["手势", "最近导入", "引导", "开局库", "打点簿", "开局", "人机", "识谱", "加速", "多核", "识谱加速", "题库", "在线", "在线棋谱库", "实验", "实验功能", "旋转", "滑轨", "长按", "环形菜单", "状态条", "键盘", "快捷键", "手感", "折叠", "顶栏", "提示", "开局名", "页签", "落子", "确认落子", "两段式", "点击确认", "防手滑"]) && <SettingsSection icon={<Sparkles/>} order={70} search={normalizedQuery} title="可选增强功能" summary={`按类别分块 · ${countEnabledEnhancements(props.enhancementSettings)} / ${ENHANCEMENT_SECTION_KEYS.length} 项已开启（出厂默认 ${countEnabledEnhancements(DEFAULT_ENHANCEMENT_SETTINGS)} 项）`}>
        <EnhancementSettingsPanel settings={props.enhancementSettings} onChange={props.onEnhancementSettingsChange} placementConfirm={props.placementConfirm} onPlacementConfirmChange={props.onPlacementConfirmChange}/>
      </SettingsSection>}

      {searchable("文件与存储", "储存位置、导出文件夹与上次局面", ["恢复", "导出文件夹", "本机", "储存位置", "存储位置", "保存位置", "文件夹", "占用", "空间"]) && <SettingsSection icon={<FolderOpen/>} order={50} search={normalizedQuery} title="文件与存储" summary="储存位置、导出文件夹与上次局面">
        <SettingRow title="退出后恢复上次局面" text="关掉后下次进入直接开一份空白新谱，不回到上次那份（保存过的都还在「棋谱库」里）；默认开启" checked={props.restoreLastPosition} onChange={props.onRestoreLastPositionChange}/>
        <StorageSettings defaultDirectory={props.defaultDirectory} directorySupported={props.directorySupported} nativeDirectorySupported={props.nativeDirectorySupported} onChoose={props.onChooseDefaultDirectory} onClear={props.onClearDefaultDirectory}/>
      </SettingsSection>}

      {searchable("数据与兼容", "导入、导出、备份、在线棋谱与格式说明", ["导入", "导出", "备份", "格式", "在线", "棋谱库", "联网", "代理", "AI", "识图", "大模型", "复原手序", "云端", "豆包", "千问", "Mimo", "mimo", "凭证", "恢复码", "本机凭证", "换机", "加密"]) && <SettingsSection icon={<ArchiveRestore/>} order={60} search={normalizedQuery} title="数据与兼容" summary="导入、导出、备份与格式说明">
        {/* ── 这一节的排序（用户 2026-10-11：「并很好排序一下」）──────────────
            按**数据的流向**排，而不是按实现模块：进得来 → 出得去 → 保得住 → 接得上。
            原来九项是"导入 / 在线 / 代理 / AI 识图 / 导出 / 备份 / 恢复 / 凭证 / 格式"
            混着排 —— 两个**配置表单**（代理、AI 识图）夹在几个**动作入口**中间，
            视觉上最刺眼的就是这里：拖动表单的输入框会让人以为整节都是"填表"。
            现在分四组：
              ① 导入（把外面的东西拿进来）
              ② 导出（把东西送出去）
              ③ 备份与恢复（保住数据；一键备份 / 恢复 / 本机凭证三条是同一件事的三种形态）
              ④ 在线服务（要先配置才能用的：在线棋谱库 + 代理 + AI 识图）
            组的顺序就是"日常用得最多的在前"：导入导出天天用，在线服务配一次就不再动。
            ⚠ 每一组内的长说明也一并按上面的口径过了一遍（短说明留行内、长说明进问号）。 */}
        <p className="settings-group-label">导入</p>
        <SettingsLink icon={<Download/>} title="导入棋谱" text="SGF / JSON / LIB / DP / DB" onClick={props.onImportRecord}/>
        <LinkInfo icon={<Upload/>} title="导出棋谱" text="导出为原始格式或 SGF / JSON"
          info="「识别原始格式直接导出」保留原文件的结构与原生注释；「转换为完整 SGF / JSON」会把整棵变化树导成通用格式（跨软件可读，但原生特有能力会丢）。棋谱页的「当前变化 / 当前局面」是分享用的轻量导出，不含整棵树。"
          onClick={props.onOpenExport}/>

        <p className="settings-group-label">备份与恢复</p>
        <LinkInfo icon={<Save/>} title={props.backupBusy ? "正在处理备份…" : "一键备份"} text="整包导出棋谱库、题库、进度与设置" disabled={props.backupBusy}
          info="生成一个版本化 ZIP：内含完整备份 JSON（带损坏校验）与一份说明文件。覆盖棋谱库、草稿、题库与进度、文件夹归属、分支书签、回收站、大型棋谱索引，以及外观、声音、分析、无障碍等本机设置；还包含成就与棋魂。恢复时能整份还原。"
          onClick={props.onExportBackup}/>
        <LinkInfo icon={<RotateCw/>} title="恢复备份" text="导入前完整校验，失败自动回滚" disabled={props.backupBusy}
          info="选一份之前导出的备份（JSON 或 ZIP）导入本机。导入前会完整校验版本与数据结构，校验不过直接拒绝；恢复时会先把当前数据整份留底，中途出错就回滚到恢复前的状态。导出文件夹的授权不受影响。恢复成功后页面会自动重新加载。"
          onClick={props.onRestoreBackup}/>
        {/* 本机凭证（2026-10-11）。它与上面两条的分工要说清：
            上面两条是**手动**导出/导入一份文件；这一条是**加密**的一份数据包，
            可多份、可命名，卸载或换机后凭恢复码恢复到之前的状态。 */}
        <LinkInfo icon={<FileKey2/>} title="本机凭证" text="加密数据包，可导出换机，凭恢复码还原" 
          info="凭证是一份加密的小文件，导出后由你保管（存网盘、发给自己、拷到新机都行）。可以建多份、各自命名。导出范围两种：只含数值（棋魂 / 成就 / 战绩 / 进度 / 设置，导入时不动你的棋谱）或连棋谱一起（导入时整份替换，换机后和之前一模一样）。导入要凭恢复码，所以也能用别人给的凭证。"
          onClick={props.onOpenVault}/>

        <p className="settings-group-label">在线服务</p>
        {props.enhancementSettings.libraryOnlineEntry && <LinkInfo icon={<Globe/>} title="在线棋谱库" text="按棋手 / 赛事查对局，并汇总习题站"
          info="在应用内列出棋手与赛事，点某一条才以新标签打开来源网站（不把第三方内容取回本机）。同一页还汇总了五子棋习题站，全部是点了才跳的外链。入口也常驻在「棋谱库 → 在线」。"
          onClick={props.onOpenOnlineLibrary}/>}
        {/* 代理输入框只在网页版出现：安卓端走系统网络直连、用不上它（用户 2026-10-05：
            「这些代理位置直接去掉就是了」）；网页版没有它就读不了励精连珠教室。 */}
        {needsOnlineProxySetting() && <OnlineProxySetting value={props.onlineProxy} onChange={props.onOnlineProxyChange}/>}
        {props.onAiVisionChange && <AiVisionSetting value={props.aiVision} onChange={props.onAiVisionChange}/>}

        <p className="settings-group-label">格式说明</p>
        <LinkInfo icon={<Info/>} title="格式兼容说明" text="各格式的可写能力与保真范围"
          info="逐个格式列清：能写哪些字段、哪些信息在转换时会丢、LIB / DP / DB 这类数据库文件的边界在哪。要判断「导出去别的软件还能不能读」时看这一页。"
          onClick={props.onOpenHelp}/>
      </SettingsSection>}

      {searchable("设备布局", "按钮宽度溢出后怎么办、横屏一律双栏", ["平板", "横屏", "双栏", "走棋", "文字", "功能栏", "边界栏", "滑动", "滚动", "滑页", "换行", "折行", "wrap", "scroll", "溢出", "挤", "图标", "功能区", "按钮", "排序"]) && <SettingsSection icon={<TabletSmartphone/>} order={80} search={normalizedQuery} title="设备布局" summary={`横屏一律双栏 · ${props.enhancementSettings.buttonOverflow === "scroll" ? "按钮溢出后横向滚动" : "按钮溢出后自动换行"}`}>
        {props.onOpenLayout && <SettingsLink icon={<Settings2/>} title="功能区布局" text="打谱 · 读谱 · 做题" onClick={props.onOpenLayout}/>}
        <SettingChoiceRow title="按钮宽度溢出后" text="" value={props.enhancementSettings.buttonOverflow} options={[["wrap", "自动换行"], ["scroll", "横向滚动"]] as const} onChange={(value) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, buttonOverflow: value === "scroll" ? "scroll" : "wrap" })}/>
        {/* 「棋谱库显示在线页签」已搬到「可选增强功能 → 界面与提示」（用户 10-09：把适合的开关归到一起、按类别分块）。
            它管的是"界面上多不多出一个页签"，与「顶栏折叠开关」同类，比放在"设备布局"（讲按钮怎么排）更贴题。 */}
      </SettingsSection>}

      {searchable("开发测试功能", "尚未成熟的实验开关，默认关闭", ["开发", "测试", "实验", "路数", "15路", "不限"]) && <SettingsSection icon={<FlaskConical/>} order={72} search={normalizedQuery} title="开发测试功能" summary={props.enhancementSettings.devBoardSizeDetect ? "实验开关已开启" : "实验开关 · 默认关闭"}>
        <p className="settings-feature-note">这里的开关用于试用尚未打磨成熟的新功能，行为与界面可能随时调整；不使用时保持关闭即可。</p>
        <SettingRow title="图片识谱「不限 15 路」" text="" checked={props.enhancementSettings.devBoardSizeDetect} onChange={(devBoardSizeDetect) => props.onEnhancementSettingsChange({ ...props.enhancementSettings, devBoardSizeDetect })}/>
      </SettingsSection>}

      {searchable("使用手册与反馈", "先看操作说明，再反馈问题或建议", ["手册", "反馈", "引导", "新手"]) && <SettingsSection icon={<BookOpen/>} order={90} search={normalizedQuery} title="使用手册与反馈" summary="先看操作说明，再反馈问题或建议">
        <SettingsLink icon={<Compass/>} title="新手引导" text="高亮 spotlight 再走一遍核心功能，约 1 分钟" onClick={props.onOpenTour}/>
        <SettingsLink className="manual-entry-link" icon={<BookOpen/>} title="使用手册" text="逐项了解棋盘、棋谱库、题库、AI、导入导出和设置" onClick={props.onOpenManual}/>
        <SettingsLink icon={<Mail/>} title="反馈问题或建议" text="通过邮件或 GitHub Issue 发送，内容不会自动上传" onClick={props.onOpenFeedback}/>
      </SettingsSection>}

      {searchable("关于", "项目说明、维护计划与下载地址", aboutSectionKeywords) && <SettingsSection icon={<Info/>} order={100} search={normalizedQuery} title="关于" summary="项目说明、维护计划与下载地址">
        <SettingRow title="启动时自动检查新版本" text="联网查询 GitHub 的最新正式版本；发现新版本会在快捷中心提示。关闭后仍可在关于页手动检查" checked={props.updateAutoCheck} onChange={props.onUpdateAutoCheckChange}/>
        {/* 这里原来有一块「两个 AI 引擎，都不用额外下载」的介绍（两段）。
            用户 2026-10-01 指出：引擎介绍已经单独成页（关于 → 引擎与模型介绍），
            这里再留一份就是第三处副本，而且它漏了 iKataGo 云端、口径也和介绍页不一致。
            现在介绍只有一处，这一分区只留指路。 */}
        <SettingsLink icon={<Info/>} title="关于半步五子棋打谱" text="版本、检查更新、引擎与模型介绍、本版本更新内容、GitHub 下载" onClick={props.onOpenAbout}/>
      </SettingsSection>}

      {query && visibleSectionCount === 0 && <div className="settings-search-empty"><Search/><b>没有匹配的设置</b><small>试试搜索“棋盘”“字号”“导入”或“AI”。</small><button type="button" onClick={() => setQuery("")}>清除搜索</button></div>}
      <div className="version-note">半步五子棋打谱 {APP_VERSION} · Web / PWA / Android</div>
    </div>
  </>;
}

function BoardDisplayPreview({ showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize, boardMargin, stoneSize }: { showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean; showLastMove: boolean; moveNumberScale: number; gridLineWidth: number; coordinateFontSize: number; boardMargin: number; stoneSize: number }) {
  const gap = 26;
  const cols = 7;
  const rows = 5;
  // 侧边（坐标缝）按真实设置等比缩放：默认 34 → 预览里的 36/28，最小档压到刚好
  // 放得下坐标，让「棋盘变大、坐标变挤」这件事在预览里直接看得出来。
  const marginScale = clampBoardMargin(boardMargin, coordinateFontSize) / DEFAULT_BOARD_MARGIN;
  const originX = Math.round(36 * marginScale + 12 * (1 - marginScale));
  const originY = Math.round(28 * marginScale + 11 * (1 - marginScale));
  const px = (col: number) => originX + col * gap;
  const py = (row: number) => originY + row * gap;
  const width = originX * 2 + (cols - 1) * gap;
  const height = originY * 2 + (rows - 1) * gap;
  // 棋子大小按同一档位缩放，并同样被预览自己的相切线兜住（gap/2），
  // 这样「拖到最大时相邻棋子刚好接触」在预览里和真实棋盘上表现一致。
  const stoneRadius = Math.min(gap / 2, 10.5 * clampStoneScale(stoneSize));
  // 坐标文字压在各自缝隙的中线上：侧边越窄，文字越靠里，预览里能直接看出挤压效果。
  const letterBaseline = (6 + originY) / 2 + coordinateFontSize * 0.35;
  const numberAnchorX = (6 + originX) / 2;
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
      {showCoordinates && Array.from({ length: cols }, (_, col) => <text key={`t${col}`} style={{ fontSize: coordinateFontSize }} className="board-preview-coord" x={px(col)} y={letterBaseline}>{String.fromCharCode(65 + col)}</text>)}
      {showCoordinates && Array.from({ length: rows }, (_, row) => <text key={`n${row}`} style={{ fontSize: coordinateFontSize }} className="board-preview-coord" x={numberAnchorX} y={py(row) + coordinateFontSize / 3}>{rows - row}</text>)}
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

/**
 * 一行「做什么」+ 一枚**问号**（说明挤进浮层）—— 用户 2026-10-11：
 * 「把我们数据与兼容的那个设置页面整理一下，里面目前看起来有点乱。文字太多了，
 *  你可以用问号代替，有问题点问号。并很好排序一下」。
 *
 * ## 与 `SettingsLink` 的分工
 *
 * 两者都是"点整行去做一件事"的入口（都渲染 `settings-link` 这层壳，所以既有门禁的
 * `.settings-link` 选择器照旧命中）。区别只在**说明放哪**：
 *  · `SettingsLink` —— 说明短（一行以内）且是**当下决策要看的信息**（如"导入棋谱"支持哪些格式）。
 *    留在行内，扫一眼就知道要不要点。
 *  · `LinkInfo` —— 说明长（两三行以上）或属于**疑问才需要**的补充（如"代理地址怎么填"、
 *    "AI 识图要什么样的模型"）。行内只留一句话标题，长说明收进 ⓘ 浮层。
 *
 * ## 判据是"用户需不需要一直看见"
 *
 * 这一节原来九项里塞了六段长说明（AI 识图一项就有三段），于是**每一项都被挤成三行**、
 * 整节要滚很久才能看完 —— 而其中大部分文字是"第一次配置时才需要读"的。
 * 现在按上面那条分工过一遍：日常要用的信息留在行内，配置说明进问号。
 *
 * ## 无障碍（照 `SettingChip` 的既有约定，别改）
 *
 * ⚠ ⓘ 的 `aria-label` **不能含这一项的标题**：否则 `getByLabel("在线棋谱库")` 会同时命中
 * 入口按钮与问号两个元素，Playwright 报 strict mode violation 让整条门禁挂掉
 * （`qa/opening-name-toggle-check.mjs:326` 专门断言了这件事）。所以固定写「查看这一项的说明」，
 * 具体是哪一项由浮层标题表达。
 */
function LinkInfo({ icon, title, text, info, onClick, disabled = false }: {
  icon: ReactNode; title: string; text: string;
  /** 长说明（点问号才看）。不传则不渲染问号。 */
  info?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  return <>
    <span className={`settings-link settings-link-with-info${disabled ? " disabled" : ""}`}>
      <button type="button" className="settings-link-main" disabled={disabled} onClick={onClick}>
        <span>{icon}<b>{title}</b><small>{text}</small></span><ChevronRight/>
      </button>
      {info && <button
        type="button"
        className="setting-chip-info settings-link-info"
        data-link-info={title}
        aria-label="查看这一项的说明"
        title="查看这一项的说明"
        onClick={() => setNoteOpen(true)}
      ><Info size={13} aria-hidden="true"/></button>}
    </span>
    {noteOpen && info && <BottomSheet title={title} manageHistory onClose={() => setNoteOpen(false)}>
      <div className="sheet-body chip-note-sheet">
        <p className="chip-note-text">{info}</p>
        <button type="button" className="primary-button" onClick={() => { setNoteOpen(false); onClick(); }}>打开</button>
        <button type="button" className="secondary-button" onClick={() => setNoteOpen(false)}>知道了</button>
      </div>
    </BottomSheet>}
  </>;
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

function EnhancementSettingsPanel({ settings, onChange, placementConfirm, onPlacementConfirmChange }: { settings: EnhancementSettings; onChange: (value: EnhancementSettings) => void; placementConfirm: boolean; onPlacementConfirmChange: (value: boolean) => void }) {
  const update = (patch: Partial<EnhancementSettings>) => onChange({ ...settings, ...patch });
  /**
   * 分板块的横向芯片（用户 2026-10-09：「整理一下我们那个放很多开关的设置页地方，
   * 看看有没有其他地方的设置也适合放进来的，整理好后你再搞成几个板块，是横向排布的按钮，分好类别」）。
   *
   * 原来这里是**十几行竖直大开关**（每行 66px、说明很长），同类项混在一起、找一项要逐行读。
   * 现在按「这项改的是什么」分成四个板块，每块内是横向芯片。
   *
   * 分块的依据是**用户的使用场景**，不是实现模块：
   *   · 手势与手感 —— 手指怎么摸棋盘（缩放 / 滑动 / 旋转 / 滑轨 / 环形菜单 / 点棋子回退 / 键盘）
   *   · 界面与提示 —— 界面上多出什么（顶栏折叠 / 引导卡片 / 开局名提示 / 在线页签）
   *   · 对弈与分析 —— 人机对局与分析相关的开关（开局库 / AI 提示点 / 结果沉淀 / 终局存档）
   *   · 其他 —— 剩下不成规模的（识谱加速 / 最近导入）
   *
   * ⚠ 「其他」是用户要求的兜底（原话：「如果分组内比较少，那就整合到"其他"分组里面吧」）：
   *   原来「识谱与性能」「数据与内容」各只有一枚芯片，各自占一个板块标题太碎。
   *   以后新增单项也先放这里；**攒到 2–3 枚**再考虑单独成组，别再出现"一枚一个板块"。
   *
   * 每枚芯片的说明文字：芯片内视觉隐藏（读屏与跨门禁都读得到），名字右侧的 ⓘ 点开可读全文——
   * 第一版只藏在读屏里，用户实测「长按的说明我咋没看到」，所以补了 ⓘ（详见 SettingChips.tsx 头注）。
   */
  return <div className="enhancement-settings">
    <p className="settings-feature-note">下面按类别分组。默认开启的是「多数人都会用上」的那些（手势、识谱加速、开局名提示等），其余默认关闭，需要时点一下打开即可。点芯片即切换；想细看某一项是干什么的，点它右边的 ⓘ。</p>

    <SettingChipGroup title="手势与手感" summary="手指怎么摸棋盘">
      <SettingChip title="双指缩放棋盘" text="默认开启。用两根手指放大或缩小棋盘（最大 6 倍），适合平板复盘；电脑上按住 Ctrl 或 ⌘ 滚动鼠标/触摸板同样能缩放，放大后单指拖动可平移，右上角按钮复位" checked={settings.pinchZoom} onChange={(pinchZoom) => update({ pinchZoom })}/>
      <SettingChip title="双指滑动切手" text="双指左右滑动切换上一手或下一手" checked={settings.gestureSwipe} onChange={(gestureSwipe) => update({ gestureSwipe })}/>
      {/* 手感增强组（用户 09-17 第二批）：都只改「手怎么摸」，不改任何棋谱数据；默认开启。 */}
      <SettingChip title="双指旋转棋盘" text="双指在棋盘上拧一下即旋转 90°（顺时针拧顺时针转），要再转就抬手重拧一次。与双指缩放、双指切手互斥识别，不会互相抢" checked={settings.boardRotateGesture} onChange={(boardRotateGesture) => update({ boardRotateGesture })}/>
      <SettingChip title="棋盘手数滑轨" text="棋盘下方、首行功能区之上的一条手数条：按住左右拖动可连续跳手，点一下朝点的方向走一手；轨道里直接显示「当前手数 / 总手数」，不用再去看状态条（主线为空时不出现）" checked={settings.moveRail} onChange={(moveRail) => update({ moveRail })}/>
      <SettingChip title="长按环形菜单" text="长按棋盘上已有的棋子呼出两层菜单（电脑上按住不放同样呼出；右键已改为「回退一步」，见下一项）：内环三格切页——通用 / 分支 / 编辑，点一格或沿环滑过去都切页，切页不会关掉菜单；外环是这一页的按钮，六槽位置固定、切页不跳方向。通用页：去子（只删你按住的那一颗，不进入去子状态）、加书签（这一手之后的面局收进棋谱树的分支书签，已收过的显示「取消书签」）、复制局面（主线纯坐标串，一手一行 H8 / I8 / H9，可粘回导入还原主线）、跳到此手、打标（好棋→坏棋→疑问手→清除三档循环，标上的那手在子右上角画角标，导出 SGF 写成 TE / BM / DO）。分支页：设为主分支 / 复制分支 / 粘贴到这里 / 跳到此手 / 删除这一手及之后（先弹确认，保存前可撤销）。编辑页：位移 / 旋转 / 镜像 / 撤销 / 重做。标注不在菜单里：底部标注栏的可选面是 6 个文字组 × 12 种样式 × 12 种颜色，一圈六个按钮镜像不过来；长按空位仍然是直接加标注" checked={settings.radialMenu} onChange={(radialMenu) => update({ radialMenu })}/>
      <SettingChip title="点棋子回退一步" text="默认关闭，打开后生效。打谱、读谱时点棋盘上任意一颗已下的子就退回一手，连着点连着退；电脑上右键同样回退（右键优先做回退，环形菜单改用长按呼出）。人机与双人对局、做题时都不生效——那两种局面下点棋子仍是原来的行为" checked={settings.tapStonePrev} onChange={(tapStonePrev) => update({ tapStonePrev })}/>
      {/* 落子方式（用户 2026-10-13：「五林和其他比较专业的软件都是点击后要再次确认才能落子」）。
          它改的是"手指怎么摸棋盘"、不碰棋谱数据，所以放这一组；
          ⚠ 但值**不在** `settings` 那份整写回的 blob 里，走独立标量键（见 placement-confirm.ts 头注）。 */}
      <SettingChip title="点击确认落子" text="默认关闭。打开后点空位先在落点画一个圈，再点同一格才真正落子；点别的空位是把圈挪过去，不是落子。打谱、读谱、人机与双人对局、做题与摆棋、每日一题、VCF 挑战都吃这一条；点已有棋子、长按标注、右键回退都不受影响。唯一的例外是题目生成器里的「试走」——那是出题时快速试手用的，保持点一下就落" checked={placementConfirm} onChange={onPlacementConfirmChange}/>
      <SettingChip title="全屏模式" text="默认关闭。打开后应用占满整屏：内容顶到屏幕最上方，并隐藏手机自带的状态栏（时间、电量那一行）。与摄像头挖孔错开的那条留白按系统当次汇报的实际高度来，不按机型写死；关闭时由系统自己给状态栏留位，最上面一排按钮完整可见、点得到。" checked={settings.fullScreenMode} onChange={(next) => onChange({ ...settings, fullScreenMode: next })}/>
      <SettingChip title="键盘快捷键" text="外接键盘时：方向键前后一手（原有）、数字键跳到第 N 手（连按两位即第 12 手）、读谱下空格播放或暂停、Delete 删除当前这一手；焦点在输入框时不响应" checked={settings.keyboardShortcuts} onChange={(keyboardShortcuts) => update({ keyboardShortcuts })}/>
    </SettingChipGroup>

    <SettingChipGroup title="界面与提示" summary="界面上多出什么">
      <SettingChip title="顶栏折叠开关" text="顶栏左侧「快捷中心」旁的折叠按钮：点一下把顶栏、状态栏和底部导航一起收起、空间让给棋盘，再点一下恢复。收起后顶栏压成一条紧凑工具条——「快捷中心」变成文字按钮、打谱/读谱/做题只留图标、导出与保存缩小，功能都还在。默认开启；关闭后按钮从顶栏消失，已折叠的界面会自动展开，随时可以回这里再打开" checked={settings.chromeCollapseToggle} onChange={(chromeCollapseToggle) => update({ chromeCollapseToggle })}/>
      <SettingChip title="操作引导卡片" text="在记录、棋谱库和设置页显示轻量使用提示" checked={settings.coachMarks} onChange={(coachMarks) => update({ coachMarks })}/>
      {/* 用户 2026-10-09：「这个功能你搞一个开关，开启后就显示，不开启就没有」。 */}
      <SettingChip title="开局名提示" text="人机对局摆出 26 个标准开局（花月、雨月这类）时，在棋盘中心下方飘一方宣纸题签，2.6 秒自散、不挡点击。默认开启；不喜欢可以关掉，关掉后完全不显示" checked={settings.openingNameHint} onChange={(openingNameHint) => update({ openingNameHint })}/>
      {/* 从「设备布局」搬来（用户 10-09：把适合的开关归到一起）。原来那节的说明是
          「按钮怎么排」，而这一项管的是「界面上多不多一个页签」，与顶栏折叠同类。 */}
      <SettingChip title="棋谱库显示「在线」页签" text="关掉后棋谱库只剩「棋谱 / 题库」两栏，在线棋谱库的入口一并隐藏；已经导入本机的棋谱不受影响。不需要它的棋友可以关掉，省一格位置。" checked={settings.libraryOnlineEntry} onChange={(libraryOnlineEntry) => update({ libraryOnlineEntry })}/>
      {/* 奖励弹窗的两个总开关（用户 2026-10-11：「加入两个开关，一个是成就弹窗的开关，
          一个是棋魂弹窗的开关，这个关闭了就不会显示弹窗了」）。
          分开两个是因为体量与频率差很多（成就=稀有大卡，棋魂=每赢一局都有的紧凑条）。
          ⚠ 说明里必须写清"关掉只是不弹，解锁与入账照常" —— 否则用户会以为
          关掉之后成就就不算了。 */}
      <SettingChip title="成就弹窗" text="解锁成就时在顶部弹出的庆祝大卡。关掉只是不弹，成就照样解锁、奖励照样入账，随时可以在对弈页的「成就」面板里回看。默认开启。" checked={settings.achievementPopup} onChange={(achievementPopup) => update({ achievementPopup })}/>
      <SettingChip title="棋魂弹窗" text="获得棋魂时在右上角弹出的提示条（如「战胜大师档 +60」）。它每赢一局都会出现，嫌吵可以关掉。关掉只是不弹，棋魂照样入账。默认开启。" checked={settings.soulPopup} onChange={(soulPopup) => update({ soulPopup })}/>
    </SettingChipGroup>

    <SettingChipGroup title="对弈与分析" summary="人机对局与研究相关">
      <SettingChip title="开局库（打点簿）" text="人机对局优先查内置开局打点簿（索索夫 / 山口五手两打，按开局规则自动选簿）：命中开局线时按最强打点秒落，未命中回落引擎。关闭时零占用" checked={settings.openingBook} onChange={(openingBook) => update({ openingBook })}/>
      <SettingChip title="AI 棋盘提示点" text="在棋盘上显示 AI 推荐落点和开局候选编号" checked={settings.aiBoardHints} onChange={(aiBoardHints) => update({ aiBoardHints })}/>
      <SettingChip title="分析结果沉淀" text="每次分析跑完把评估、深度与候选点存进本机缓存；同一局面再打开时，分析面板可一键「载入上次结果」。默认开启；关闭后不再写入也不显示缓存行" checked={settings.analysisCache} onChange={(analysisCache) => update({ analysisCache })}/>
      <SettingChip title="终局自动存档" text="人机对战分出胜负（含超时）后，自动把对局连同结果与时限元数据存进棋谱库。默认关闭（用户 09-28：不主动保存就不该进库）：关闭时终局面板有「保存本局」，复盘也照常能跑；没保存的那局会留在「上次对局」里，下次点「人机对战」会问你要不要回去。" checked={settings.aiGameAutoSave} onChange={(aiGameAutoSave) => update({ aiGameAutoSave })}/>
    </SettingChipGroup>

    {/* 「识谱与性能」「数据与内容」各只有一枚芯片，按用户 2026-10-09 的要求并成「其他」：
        「如果分组内比较少，那就整合到"其他"分组里面吧」。
        并组不并语义：两枚芯片的说明一个字没改，只是不再各占一个板块标题。 */}
    <SettingChipGroup title="其他" summary="性能与内容记忆">
      <SettingChip title="识谱多核加速" text="图片识谱按手机的处理器核心数与可用内存自动开多个线程并行计算网格与棋子，识别更快、导入时界面不卡；识别结果与单线程逐位相同。关闭后回落单线程" checked={settings.fastRecognition} onChange={(fastRecognition) => update({ fastRecognition })}/>
      <SettingChip title="最近导入" text="导入过的棋谱与题库会留在导入面板顶部（最多 8 个，单份 48MB 以内），下次直接点开，不用重新选文件" checked={settings.importShelf} onChange={(importShelf) => update({ importShelf })}/>
      {/* 「在线棋谱库」「在线题库（自建题源）」两行开关已删除（用户 09-26）：在线面常驻，
          棋谱与题库两个页签都在，不再需要先在实验功能里打开。 */}
    </SettingChipGroup>
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
    <SettingChoiceRow title="选点小数位数" text="胜率与评估分显示到小数点后几位（0–5）；深度和计算量是计数，不受影响" value={String(settings.analysisCandidateDecimals)} options={[["0", "0 位（整数）"], ["1", "1 位"], ["2", "2 位"], ["3", "3 位"], ["4", "4 位"], ["5", "5 位"]]} onChange={(analysisCandidateDecimals) => update({ analysisCandidateDecimals: Number(analysisCandidateDecimals) })}/>
    <SettingRow title="变化预览连线" text="点击候选点后，在棋盘预览变化图时画出各手之间的连线；默认关闭，带序号的预览棋子已足够看清变化。预览期间候选点上的胜率等指标会暂时隐藏，避免互相干扰" checked={settings.analysisPreviewGuide} onChange={(analysisPreviewGuide) => update({ analysisPreviewGuide })}/>
    <SettingChoiceRow title="最小深度" text={depthHint(settings.analysisDepthMin, settings.analysisDepthMax, 96)} value={String(settings.analysisDepthMin)} options={DEPTH_MIN_OPTIONS} onChange={(value) => update({ analysisDepthMin: Number(value) })}/>
    <SettingChoiceRow title="最大深度" text="引擎最多迭代到第几层。自动会沿用各路径原本的取值：持续分析 512、单次分析 96、落子型回合 64" value={String(settings.analysisDepthMax)} options={DEPTH_MAX_OPTIONS} onChange={(value) => update({ analysisDepthMax: Number(value) })}/>
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

/**
 * 主题卡（可锁）。用户 2026-10-10：「主题也是，都要棋魂解锁这样的……
 * 选项的右边有一个棋魂的图案，右边标好需要多少的棋魂可以解锁」。
 *
 * 免费的三套（跟随系统 / 浅色 / 深色）与 `custom` 走 `soulUnlockForTarget` 返回
 * `undefined` 那条路 —— 那时这个组件的行为与改前**逐字一样**（只是一个普通按钮），
 * 不渲染任何锁标记。这一点是刻意的：默认项永远不能被锁（见 soul-unlocks 的口径）。
 *
 * ## 2026-10-12：两处复用同一个组件
 *
 * 「应用主题」那张清单与「自定义背景 → 界面主题」那张清单**卡片长得一模一样**
 * （色块 + 名字 + 锁徽章 + 购买框），只有两处不同：
 *  · 选中值不同（一个是 `themePreference`、一个是 `customUiTheme`）；
 *  · 点了之后改的是哪个设置（`onSelect` 由调用方给），以及**预览时改哪个**
 *    （`previewKey`：主题清单预览=切整套主题，界面主题清单预览=只换界面）。
 * 所以把差异收成参数，**不复制一份卡片**（复制一份的下场见 theme-options.ts 的历史教训：
 * 同一个东西在多处各写一份，迟早有一处忘了改）。
 */
function ThemeOptionButton({ value, label, current, onSelect, previewKey = "theme", onPreview, onPreviewEnd }: {
  value: ThemePreference; label: string; current: ThemePreference;
  onSelect: (value: ThemePreference) => void;
  /** 锁着时点卡片的预览写到哪个设置上（默认整套主题；自定义背景的界面主题清单传 `customUiTheme`）。 */
  previewKey?: "theme" | "customUiTheme";
  onPreview?: (patch: { theme?: ThemePreference; customUiTheme?: ResolvedTheme }) => void;
  onPreviewEnd?: (commit: boolean) => void;
}) {
  const shop = useSoulShop();
  const item = soulUnlockForTarget("theme", value);
  return <LockableOption
    item={item}
    unlocked={shop.isUnlocked(item)}
    selected={current === value}
    onPick={() => onSelect(value)}
    // 锁着时点卡片 = **预览**（用户：「主题也是可以预览，但是不买就回到自己使用的那个」）。
    // ⚠ 界面主题清单里的预览要落在 `customUiTheme` 上：那时 `themePreference` 是 `custom`，
    //   预览整份主题会**离开自定义背景**（背景瞬间变回主题自带的那张），看不出"这套 UI 配我的背景"。
    onPreview={onPreview
      ? () => onPreview(previewKey === "customUiTheme" ? { customUiTheme: value as ResolvedTheme } : { theme: value })
      : undefined}
    onBuy={(target) => shop.buy(target)}
    onUnlocked={() => { onSelect(value); onPreviewEnd?.(true); }}
    label={label}
  >
    <span className={`theme-swatch ${value}`} aria-hidden="true"/>
    <span><b>{label}</b></span>
    <Check className="theme-check" aria-hidden="true"/>
  </LockableOption>;
}

/**
 * 「自定义背景」下面的**界面主题下拉框**（用户 2026-10-12 第二轮：「选 UI 时不必要全部都展示，
 * 搞一个框框，然后选就行了，优化一下这个自定义主题下面的选项排版」）。
 *
 * 原来这里嵌了第二份 `VisualOptionPager`：与上面「应用主题」同规格的卡片网格（十几套、还要分页），
 * 挂在自定义背景那三行控件下面，整块看着都在重复。现在收成一个框：
 *  · **已解锁的**：选它就换上（含出厂免费的浅色/深色，它们没有解锁项）；
 *  · **未解锁的**：仍然列出来（标「未解锁 · N 魂」），但**选它不改界面** —— 下拉框是受控的，
 *    值仍然是当前这套，所以它会自己弹回去，只在框下面长出一行「试看 / 买并换上 / 先不用」。
 * 预览与购买的口径和原来那排卡片**完全一致**（点着预览、不买就回到自己那套），只是不再占一整屏。
 */
function CustomUiThemeSelect({ options, current, onSelect, onPreview, onPreviewEnd }: {
  options: ReadonlyArray<[ThemePreference, string]>;
  current: ThemePreference;
  onSelect: (value: ResolvedTheme) => void;
  onPreview?: (patch: { theme?: ThemePreference; customUiTheme?: ResolvedTheme; board?: BoardTheme; stone?: StoneTheme }) => void;
  onPreviewEnd?: (commit: boolean) => void;
}) {
  const shop = useSoulShop();
  /** 选中了但还没解锁的那一套（null = 没有待处理项）。 */
  const [pending, setPending] = useState<{ value: ThemePreference; label: string } | null>(null);
  const [error, setError] = useState("");
  const itemOf = (value: ThemePreference) => soulUnlockForTarget("theme", value);
  /** 没有解锁项的就是出厂免费（`DEFAULT_FREE_THEMES` 那几套在定价表里根本不出现）。 */
  const unlockedOf = (value: ThemePreference) => { const item = itemOf(value); return !item || shop.isUnlocked(item); };
  const pick = (value: ThemePreference) => {
    setError("");
    if (unlockedOf(value)) { setPending(null); onSelect(value as ResolvedTheme); return; }
    // 未解锁：**不动界面**，只把这一行问价条放出来（下拉框受控，它自己会弹回当前值）
    setPending({ value, label: options.find(([v]) => v === value)?.[1] ?? value });
  };
  const pendingItem = pending ? itemOf(pending.value) : undefined;
  const cancel = () => { onPreviewEnd?.(false); setPending(null); setError(""); };
  return <div className="custom-ui-theme">
    <div className="custom-ui-theme-heading"><b>界面主题</b><small>背景用你的，界面（顶栏、面板、按钮、文字）用这套主题</small></div>
    <div className="custom-ui-theme-pick">
      <span className={`theme-swatch ${current}`} aria-hidden="true"/>
      <select aria-label="自定义背景的界面主题" value={current} onChange={(event) => pick(event.target.value as ThemePreference)}>
        {options.map(([value, label]) => <option key={value} value={value}>
          {/* 锁的写法与快捷中心那三个外观下拉**同一格式**（`🔒 名字 · N 棋魂`，见 QuickDrawer 的 ChoiceRow）：
              原生 option 里放不了图标元素，两处要长成一个样。 */}
          {unlockedOf(value) ? label : `🔒 ${label} · ${itemOf(value)?.cost ?? 0} 棋魂`}
        </option>)}
      </select>
    </div>
    {pending && <div className="custom-ui-theme-buy" data-custom-ui-pending={pending.value}>
      <p><b>{pending.label}</b>还没解锁{pendingItem ? ` · 要 ${pendingItem.cost} 棋魂（现有 ${shop.balance}）` : ""}</p>
      <div className="custom-ui-theme-buy-actions">
        <button type="button" onClick={() => onPreview?.({ customUiTheme: pending.value as ResolvedTheme })}>试看</button>
        <button type="button" data-custom-ui-buy="" onClick={() => {
          if (!pendingItem) return;
          const failure = shop.buy(pendingItem);
          // 钱不够：不扣钱、不换界面，把原因写在条里（与商店、道具卡那两处同一口径）
          if (failure) { setError(failure); return; }
          onPreviewEnd?.(false);          // 丢掉"试看"的临时态，避免两份来源叠在一起
          onSelect(pending.value as ResolvedTheme);
          setPending(null);
        }}>买并换上</button>
        <button type="button" onClick={cancel}>先不用</button>
      </div>
      {error && <p className="soul-buy-error" role="alert">{error}</p>}
    </div>}
  </div>;
}

/**
 * 棋盘 / 棋子材质卡（可锁）。与 `ThemeOptionButton` 同一套，只换了预览内容。
 *
 * 棋盘与棋子共用一个组件（差别只在 `kind` 与预览块），因为它们的卡片结构、
 * 锁的位置、购买流程完全一致 —— 写两份迟早会有一处忘了改。
 */
function MaterialOptionButton({ kind, value, label, text, current, sameTheme, onChange, onPreview, onPreviewEnd }: {
  kind: "board" | "stone";
  value: string; label: string; text: string; current: string;
  sameTheme: (current: string, value: string) => boolean;
  onChange: (value: never) => void;
  onPreview?: (patch: { board?: BoardTheme; stone?: StoneTheme }) => void;
  onPreviewEnd?: (commit: boolean) => void;
}) {
  const shop = useSoulShop();
  const item = soulUnlockForTarget(kind, value);
  return <LockableOption
    item={item}
    unlocked={shop.isUnlocked(item)}
    selected={sameTheme(current, value)}
    onPick={() => onChange(value as never)}
    // 锁着时点卡片 = 预览（用户：「棋盘棋子你可以让我们点击可以预览」）
    onPreview={onPreview
      ? () => onPreview(kind === "board" ? { board: value as BoardTheme } : { stone: value as StoneTheme })
      : undefined}
    onBuy={(target) => shop.buy(target)}
    onUnlocked={() => { onChange(value as never); onPreviewEnd?.(true); }}
  >
    {kind === "board" ? <BoardChip theme={value as BoardTheme}/> : <StoneChip theme={value as StoneTheme}/>}
    <span><b>{label}</b><small>{text}</small></span>
  </LockableOption>;
}

function VisualThemeSettings({ boardTheme, stoneTheme, onBoardThemeChange, onStoneThemeChange, only = "both", onPreview, onPreviewEnd }: { boardTheme: BoardTheme; stoneTheme: StoneTheme; onBoardThemeChange: (value: BoardTheme) => void; onStoneThemeChange: (value: StoneTheme) => void; only?: "board" | "stone" | "both"; onPreview?: (patch: { board?: BoardTheme; stone?: StoneTheme }) => void; onPreviewEnd?: (commit: boolean) => void }) {
  /* 材质列表**全部由材质数据生成** —— 含从本体材质移植进来的 `app-*` 那批。
     以前这里是一份 14/16 条硬编码的旧名字（wood/jade/…），并把 `app-*` 显式过滤掉
     （当时的理由是"它们是本体材质的参考副本"）。后果是同一批设计有两个入口：
     旧名字走 `.board-X` 老 CSS（**没有自带动效**）、`app-*` 走新材质路（带动效）却选不到。
     2026-10-02 按用户要求「把外观加进软件里」统一到材质那套：一套材质一个入口，
     动效跟着材质走（`BoardChip` 本来就会画真材质，不用改）。
     ⚠ 已退役的设计不复活：`RETIRED_*` 那三个（notebook/porcelain/frosted）对应的
       `app-notebook`/`app-porcelain` 一并挡掉，否则"用户点名删掉的主题"会从新列表里爬回来。
     ⚠ 旧存档里的老名字（wood/jade…）**仍能渲染**（老 CSS 路还在），列表里由 sameTheme()
       认成同一项并高亮；用户点一下才真正切到材质那套（那时才带上自带动效）。 */
  const retiredApp = (retired: Record<string, string>) =>
    new Set(Object.keys(retired).map((k) => `app-${k}`));
  const skipBoards = retiredApp(RETIRED_BOARD_THEMES);
  const skipStones = retiredApp(RETIRED_STONE_THEMES);
  /** 副标题优先报"自带动效" —— 那正是用户最想知道的（这块盘会不会动）。 */
  const motionText = (m: { motions: { name: string }[]; sub?: string; group?: string }) =>
    (m.motions.length ? `自带动效 · ${m.motions[0].name}` : (m.sub || m.group || "材质"));
  const boards: Array<[BoardTheme, string, string]> = materialBoards()
    .filter((m) => !skipBoards.has(m.src))
    .map((m) => [m.src as BoardTheme, m.name, motionText(m)]);
  const stones: Array<[StoneTheme, string, string]> = materialStones()
    .filter((m) => !skipStones.has(m.src))
    .map((m) => [m.src as StoneTheme, m.name, motionText(m)]);
  /** 旧名字（wood/jade…）与材质名（app-wood/app-jade…）是同一项的两个写法：
   *  存档里可能还留着老值，而列表只列材质那套 —— 高亮得认得出是同一个，
   *  否则老用户进来会看到"一个都没选中"。
   *  ⚠ 去连字符再比，是为了 `gold-diamond` ↔ `app-golddiamond` 这种改写。 */
  const sameTheme = (current: string, value: string) => {
    const norm = (s: string) => String(s).replace(/-/g, "");
    return current === value || norm(`app-${current}`) === norm(value) || norm(current) === norm(`app-${value}`);
  };
  /* 用户 2026-10-09 要求把「棋盘材质」「棋子材质」两个小标题、以及末尾那段
     「建议关闭显示手数…」的说明都删掉，让上下更紧凑（版面标签已经是"棋盘 / 棋子"，重复了）。
     页签本身带 aria-label，读屏仍能知道这一组是什么。 */
  return <div className="visual-theme-settings">
    {only !== "stone" && <div><VisualOptionPager label="棋盘材质" options={boards.map(([value, label, text]) => <MaterialOptionButton key={value} kind="board" value={value} label={label} text={text} current={boardTheme} sameTheme={sameTheme} onChange={onBoardThemeChange} onPreview={onPreview} onPreviewEnd={onPreviewEnd}/>)}/></div>}
    {only !== "board" && <div><VisualOptionPager label="棋子材质" options={stones.map(([value, label, text]) => <MaterialOptionButton key={value} kind="stone" value={value} label={label} text={text} current={stoneTheme} sameTheme={sameTheme} onChange={onStoneThemeChange} onPreview={onPreview} onPreviewEnd={onPreviewEnd}/>)}/></div>}
  </div>;
}

function AnnotationHighlightSetting({ value, onChange }: { value: AnnotationHighlight; onChange: (value: AnnotationHighlight) => void }) {
  const options: Array<[AnnotationHighlight, string]> = [["none", "无"], ["white", "白色"], ["gold", "金色"], ["blue", "蓝色"]];
  /* 上下原本各有一行字（标题下"为棋盘上的文字、圈线与形状增加轮廓光" + 底部"棋盘颜色过深会影响
     标注字体，可选择打开标注高亮"）。用户 2026-10-09：「上下都各有一行字，你把下面的字精简一点，
     替换上面那个说明」—— 合并成标题右侧一行短的，底部那行删掉。 */
  return <div className="annotation-highlight-setting">
    <div className="annotation-highlight-heading"><b>标注高亮</b><small>棋盘越深越需要</small></div>
    <div className="annotation-highlight-options" role="radiogroup" aria-label="标注高亮颜色">
      {options.map(([option, label]) => <button key={option} type="button" className={`${value === option ? "selected" : ""} highlight-${option}`} role="radio" aria-checked={value === option} onClick={() => onChange(option)}><i aria-hidden="true"/><span>{label}</span></button>)}
    </div>
  </div>;
}

interface MaterialLivePreviewProps {
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  boardOpacity: number;
  stoneOpacity: number;
  label: string;
}

/** 预览框的边长（CSS 里 `.material-live-preview` 也是这个尺寸，两边要一致） */
const CROP_SIZE = 196;

function MaterialLivePreview({ boardTheme, stoneTheme, boardOpacity, stoneOpacity, label }: MaterialLivePreviewProps) {
  /* 预览 = **真实棋盘 + 真棋子的局部截取**（MaterialBoardCrop），不再是色块 + 假网格。
     用户 2026-10-02：「我要的是真实棋盘棋子的预览，不是颜色预览、缩略框预览这种的，
     之前我们的不就是真实棋盘截取的一部分的预览吗」。
     ⚠ 透明度两项仍挂在**整块预览**上 —— 它调的是用户设的显示透明度，
       预览要如实反映"调完会是什么样"，所以不能只套在内层元素上。
     ⚠ 10-09 定稿：这块预览由「外观 → 棋盘」渲染（10-08 曾跟着透明度滑杆搬去「棋盘显示」，用户要求
      把棋盘还回来，只留滑杆在那一节）。它读同一份 boardOpacity/stoneOpacity，所以在「棋盘显示」
      拖滑杆时这里即时跟着变。 */
  return <div className={`material-live-preview board-${boardTheme} stones-${stoneTheme}`} aria-label={label}>
    <span className="material-preview-crop" style={{ opacity: boardOpacity }} aria-hidden="true"><MaterialBoardCrop boardTheme={boardTheme} stoneTheme={stoneTheme} size={CROP_SIZE} part="board"/></span>
    <span className="material-preview-crop" style={{ opacity: stoneOpacity }} aria-hidden="true"><MaterialBoardCrop boardTheme={boardTheme} stoneTheme={stoneTheme} size={CROP_SIZE} part="stones"/></span>
  </div>;
}

/* 透明度两项**只是滑杆**（用户 2026-10-09：「把棋盘还回去…你只是要把透明度的调度放到棋盘显示那」）。
   材质预览 `MaterialLivePreview` 不在这里画，它回到「外观 → 棋盘」原来的位置（滑杆改动会即时反映在那块预览上，
   两处的值都来自 App 的同一份状态）。 */
function BoardOpacitySetting({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  /* 只留「标题 + 滑杆 + 读数」。用户 2026-10-09：「那些什么说明啥的都去掉吧」——
     原来每条下面压着两行说明（"只改变棋面底色和边框…" / "最低 35%…"），和同页其它设置项比太啰嗦。 */
  return <div className="board-opacity-setting">
    <div className="board-opacity-heading"><b>棋盘透明度</b><output>{percent}%</output></div>
    <input aria-label="棋盘透明度" type="range" min={Math.round(MIN_BOARD_OPACITY * 100)} max="100" step="1" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)}/>
  </div>;
}

function StoneOpacitySetting({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  return <div className="stone-opacity-setting">
    <div className="stone-opacity-heading"><b>棋子透明度</b><output>{percent}%</output></div>
    <input aria-label="棋子透明度" type="range" min={Math.round(MIN_STONE_OPACITY * 100)} max="100" step="1" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)}/>
  </div>;
}

/** The browser build cannot read a site that sends no CORS header, so the online
 *  sources offer a user-supplied proxy. Native builds use the OS HTTP stack and
 *  leave this empty. */
/** 公用效果面板：落子交互（落点炸开）+ 棋子进场（刚落那枚子自己的动画）。
 *  每组 = 总开关（SettingRow 的开关样式）+ 方案下拉（setting-choice-row 样式）；
 *  关掉总开关时下拉 disabled，说明小字显示当前方案的 desc。 */
function MotionEffectsPanel({ settings, motionEnabled, onChange }: { settings: MotionEffectsSettings; motionEnabled: boolean; onChange: (value: MotionEffectsSettings) => void }) {
  const update = (patch: Partial<MotionEffectsSettings>) => onChange({ ...settings, ...patch });
  const place = findPlaceEffect(settings.placeId);
  const drop = findDropEffect(settings.dropId);
  return <div className="motion-effects-settings">
    {/* ⚠ 2026-10-09：这里**不再自带预览舞台**。用户：「公用特效那里还是一块新棋盘，上面一个下面一个的，
        我们要用那一套预览」—— 落子动效改由 AppearancePanes 插进**外观那块共用预览**
        （MotionEffectsPreview 的 inline 模式，且预览里只留一枚演出棋子）。
        本组件只负责两个开关 + 两个方案下拉。 */}
    <SettingRow title="落子交互" text="每次落子时在落点炸开一下；公用效果，与棋子、棋盘材质无关" checked={settings.placeOn} onChange={(placeOn) => update({ placeOn })}/>
    <label className="setting-choice-row">
      <span><b>落子交互方案</b><small>{place.desc}</small></span>
      <select aria-label="落子交互方案" value={settings.placeId} disabled={!settings.placeOn} onChange={(event) => update({ placeId: event.target.value })}>
        {PLACE_EFFECTS.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
      </select>
    </label>
    <SettingRow title="棋子进场" text="刚落下的那枚棋子自己的进场动画；公用效果，与棋子、棋盘材质无关" checked={settings.dropOn} onChange={(dropOn) => update({ dropOn })}/>
    <label className="setting-choice-row">
      <span><b>棋子进场方案</b><small>{drop.desc}</small></span>
      <select aria-label="棋子进场方案" value={settings.dropId} disabled={!settings.dropOn} onChange={(event) => update({ dropId: event.target.value })}>
        {DROP_EFFECTS.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
      </select>
    </label>
    <p className="helper">这两组是公用效果：换任何棋盘、棋子材质都不受影响。关闭「无障碍与反馈」里的「界面动效」后，它们也一并停止。</p>
  </div>;
}

function OnlineProxySetting({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const trimmed = draft.trim();
  const invalid = trimmed.length > 0 && !/^https?:\/\//i.test(trimmed);
  const commit = () => { if (!invalid && trimmed !== value) onChange(trimmed); };
  return <div className="online-proxy-setting">
    <span className="online-proxy-head">
      <b>在线棋谱代理地址</b>
      {/* ⚠ 长说明挪进问号（用户 2026-10-11：「文字太多了，你可以用问号代替，有问题点问号」）。
          这一项原来压着两行半配置说明，而它是**配一次就不再动**的东西 ——
          日常不需要一直看见。行内只留一句短的，示例与占位符规则进浮层。
          行内那句必须保留「安卓不用填」：否则安卓用户会以为这里空着是坏了。 */}
      <small>安卓端不用填；浏览器版读取不允许跨域的站点时才需要</small>
      <button type="button" className="setting-chip-info online-proxy-info" data-proxy-info=""
        aria-label="查看这一项的说明" title="查看这一项的说明" onClick={() => setNoteOpen(true)}><Info size={13} aria-hidden="true"/></button>
    </span>
    <input
      aria-label="在线棋谱代理地址"
      data-setting-online-proxy=""
      value={draft}
      placeholder="留空 = 直连"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
    />
    {invalid && <small className="online-proxy-error" role="alert">代理地址必须以 http:// 或 https:// 开头</small>}
    {noteOpen && <BottomSheet title="在线棋谱代理地址" manageHistory onClose={() => setNoteOpen(false)}>
      <div className="sheet-body chip-note-sheet">
        <p className="chip-note-text">浏览器版读取「不开放跨域访问」的棋谱站点时使用；安卓应用内走系统网络直连，不需要填写。</p>
        <p className="chip-note-text">示例：<code>https://你的代理/?url=&#123;url&#125;</code> —— 其中 <code>&#123;url&#125;</code> 会替换成目标地址；如果你的代理不接受占位符，就把目标地址直接追加在末尾。</p>
        <button type="button" className="secondary-button" onClick={() => setNoteOpen(false)}>知道了</button>
      </div>
    </BottomSheet>}
  </div>;
}

/**
 * AI 识图服务配置（开发测试功能 · 用户 09-28 拍板接入大模型复原手序）。
 * 端点/Key/模型三件套走 OpenAI 兼容格式；Key 由用户自己向服务商申请、
 * 只存本机不进备份（与在线代理同一套「用户自备来源」的边界）。
 * 预设只填端点与模型，切换预设不动已填的 Key。
 */
function AiVisionSetting({ value, onChange }: { value?: AiVisionConfig; onChange: (config: AiVisionConfig) => void }) {
  const stored = normalizeAiVisionConfig(value);
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl);
  const [apiKey, setApiKey] = useState(stored.apiKey);
  const [model, setModel] = useState(stored.model);
  const [format, setFormat] = useState<AiVisionFormat>(stored.format);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => { setBaseUrl(stored.baseUrl); setApiKey(stored.apiKey); setModel(stored.model); setFormat(stored.format); }, [stored.baseUrl, stored.apiKey, stored.model, stored.format]);
  const commit = (nextBaseUrl: string, nextApiKey: string, nextModel: string, nextFormat: AiVisionFormat = format) => onChange({ baseUrl: nextBaseUrl, apiKey: nextApiKey, model: nextModel, format: nextFormat });
  const runTest = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const reply = await testAiVisionConnection({ baseUrl, apiKey, model, format });
      setTestResult(`连接成功，模型回复「${reply}」`);
    } catch (error) {
      setTestResult(`连接失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setTesting(false);
    }
  };
  return <div className="ai-vision-setting" data-setting-ai-vision="">
    <span className="ai-vision-head">
      <b>AI 识图服务（复原手序-云端）</b>
      {/* ⚠ 长说明挪进问号（用户 2026-10-11：「文字太多了，你可以用问号代替，有问题点问号」）。
          这一项原来压着**三段**说明（做什么 / 要什么模型 / Key 怎么存），
          而它是"配一次就不用再管"的 —— 日常不需要一直看见。
          ⚠ 行内这句**必须同时含「识图」与「手序」两个词**：`qa/ai-move-order-check.mjs`
          的 S1c 断言 `[data-setting-ai-vision] small` 里要出现这两个词
          （那条断言的意图是"说明要让用户知道这是识图 + 只对带手序的图有用"）。
          把长说明整段搬走会让它读不到，所以这两个词留在行内这句里。 */}
      <small>让支持识图的大模型读出手序：识谱核对屏点「复原手序-云端」时使用</small>
      <button type="button" className="setting-chip-info ai-vision-info" data-ai-vision-info=""
        aria-label="查看这一项的说明" title="查看这一项的说明" onClick={() => setNoteOpen(true)}><Info size={13} aria-hidden="true"/></button>
    </span>
    <label className="ai-vision-format">
      <span>接口格式</span>
      <select aria-label="AI 接口格式" data-setting-ai-vision-format="" value={format} onChange={(event) => { const next = event.target.value as AiVisionFormat; setFormat(next); commit(baseUrl, apiKey, model, next); }}>
        <option value="chat">OpenAI 兼容（Chat Completions）</option>
        <option value="claude">Claude（Anthropic Messages）</option>
        <option value="responses">OpenAI Responses</option>
      </select>
    </label>
    <input aria-label="AI 接口地址" data-setting-ai-vision-base="" placeholder="接口地址，如 https://ark.cn-beijing.volces.com/api/v3" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} onBlur={() => commit(baseUrl.trim(), apiKey, model)}/>
    <input aria-label="AI API Key" data-setting-ai-vision-key="" type="password" placeholder="API Key（自建无鉴权服务可留空）" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onBlur={() => commit(baseUrl, apiKey.trim(), model)}/>
    <input aria-label="AI 模型名" data-setting-ai-vision-model="" placeholder="模型名（要选带视觉识图的款）" value={model} onChange={(event) => setModel(event.target.value)} onBlur={() => commit(baseUrl, apiKey, model.trim())}/>
    <div className="ai-vision-test">
      <button type="button" onClick={runTest} disabled={testing || !isAiVisionConfigured({ baseUrl, apiKey, model })}>{testing ? "正在测试…" : "测试连接"}</button>
      {isAiVisionConfigured({ baseUrl, apiKey, model }) && !testing && !testResult && <small>将按所选接口格式向上述地址发一条最小测试请求（不涉及棋谱数据）</small>}
    </div>
    {testResult && <small className={testResult.startsWith("连接成功") ? "ai-vision-ok" : "ai-vision-error"} role="status">{testResult}</small>}
    {noteOpen && <BottomSheet title="AI 识图服务（复原手序-云端）" manageHistory onClose={() => setNoteOpen(false)}>
      <div className="sheet-body chip-note-sheet">
        <p className="chip-note-text">识谱核对屏点「复原手序-云端」时，把整张图发到这里配置的大模型，由它读出每颗棋子上的序号、恢复落子顺序。<b>只有图上棋子印有手序数字的才能复原</b>。</p>
        <p className="chip-note-text"><b>必须是支持识图（视觉）的大模型</b>：豆包、通义千问、Kimi、智谱、Claude、Gemini 等，提供 OpenAI 兼容接口即可（下拉里另有 Claude 官方与 Responses 两种格式）。</p>
        <p className="chip-note-text">Key 只存在本机，不会进备份文件。</p>
        <button type="button" className="secondary-button" onClick={() => setNoteOpen(false)}>知道了</button>
      </div>
    </BottomSheet>}
  </div>;
}
