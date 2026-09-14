import { Bot, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Download, FilePlus2, Gauge, Grid, Home, Library, ListTree, Lock, MessageSquareText, MoreHorizontal, PanelTop, Save, Search, Settings, Shield, SquarePen, Tag, Trash2, Undo2, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 「新手引导」步骤表（T32，09-09 按用户反馈改版）。引导是纯覆盖层：只按
// data-action-id / 结构类名锚定，不反向依赖 App 内部状态；目标找不到（用户
// 自定义过功能区布局等）时该孔自动熄灭，卡片文案仍完整呈现。
// 两条纪律：①tip 图标必须与真实按钮同图标（用户点名：图标对不上=白做）；
// ②文案只讲功能，不用比喻修辞。
export interface TourTip {
  sel: string;
  name: string;
  desc: string;
  icon: LucideIcon;
}
export interface TourStep {
  id: string;
  title: string;
  lead: string;
  tips: TourTip[];
  /** 进入该步前需要切换的底部标签（默认停在当前页不动）。 */
  tab?: "record" | "library" | "settings";
  /** 进入该步时由 App 打开快捷中心（该步的锚点在快捷中心面板内）。 */
  openQuickDrawer?: boolean;
  /** 进入该步时由 App 打开的功能面板（dock-panel，如分析/标注/编辑）。 */
  panel?: "analysis" | "annotation" | "notes" | "vcf" | "view";
  /** 进入该步时由 App 打开的底部弹窗（导入、AI 对战等；关闭会由宿主统一处理）。 */
  sheet?: "import" | "aiGame" | "export" | "tree" | "folder" | "dataSafety" | "trash" | "wrongbook";
  /** 进入该步时切换的工作模式（打谱/读谱/做题）。 */
  mode?: "record" | "review" | "puzzle";
  /** 最后一步用完成语义按钮。 */
  final?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "board",
    title: "界面总览",
    lead: "主界面分四块：棋盘、功能区、底部导航、顶栏。",
    tips: [
      { sel: ".renju-board", name: "棋盘", desc: "点交叉点落子，点已下的子回看那一步；长按空位可快速标注。", icon: Grid },
      { sel: ".top-actions", name: "顶栏", desc: "导出、保存两个快捷入口；导入在底部导航中间。", icon: PanelTop },
    ],
  },
  {
    id: "moves",
    title: "走棋导航",
    lead: "用这排按钮在着法序列里逐步查看。",
    tips: [
      { sel: '[data-action-id="navStart"]', name: "起点", desc: "跳到第一手。", icon: ChevronFirst },
      { sel: '[data-action-id="navPrev"]', name: "上一手", desc: "回退一步。", icon: ChevronLeft },
      { sel: '[data-action-id="navNext"]', name: "下一手", desc: "前进一步。", icon: ChevronRight },
      { sel: '[data-action-id="navEnd"]', name: "终点", desc: "跳到当前分支的最新手。", icon: ChevronLast },
      { sel: '[data-action-id="navUndo"]', name: "撤销 / 重做 / 放弃", desc: "打谱时反悔与恢复；读谱模式这里换成自动播放。", icon: Undo2 },
    ],
  },
  {
    id: "study",
    title: "分析、标注与分支",
    lead: "棋盘下方这一排是研究用工具。",
    tips: [
      { sel: '[data-action-id="analysis"]', name: "分析", desc: "打开 AI 分析面板：候选点、胜率、搜索深度实时更新；点候选可看变化预览。", icon: Gauge },
      { sel: '[data-action-id="annotation"]', name: "标注", desc: "进入标注模式，点选位置写圈点或文字。", icon: Tag },
      { sel: '[data-action-id="notes"]', name: "编辑", desc: "修改棋谱信息与节点属性。", icon: SquarePen },
      { sel: '[data-action-id="tree"]', name: "分支树", desc: "列出全部变化分支，点选跳转。", icon: ListTree },
      { sel: '[data-action-id="view"]', name: "更多", desc: "功能区布局编辑器与显示选项；按钮位置顺序可自己重排。", icon: MoreHorizontal },
    ],
  },
  {
    id: "manage",
    title: "棋谱操作",
    lead: "顶部常驻一排，负责棋谱的建档与保存。",
    tips: [
      { sel: '[data-action-id="comment"]', name: "注释框", desc: "给当前手写长评注，导出 SGF 会保留。", icon: MessageSquareText },
      { sel: '[data-action-id="save"]', name: "保存", desc: "存入棋谱库，可归文件夹、可排序。", icon: Save },
      { sel: '[data-action-id="new"]', name: "新建", desc: "开一份新谱，路数与规则可选。", icon: FilePlus2 },
      { sel: '[data-action-id="delete"]', name: "删除", desc: "删当前步及后续变化，回收站可找回。", icon: Trash2 },
      { sel: '[data-action-id="rule"]', name: "禁手规则", desc: "有禁手 / 无禁手一键切换。", icon: Shield },
      { sel: '[data-action-id="color"]', name: "落子颜色", desc: "指定下一子是黑是白，摆局面与研究变化时用。", icon: Lock },
    ],
  },
  {
    id: "quick",
    title: "快捷中心",
    lead: "左上角应用图标按钮，汇总高频开关。",
    tips: [
      { sel: ".brand-trigger", name: "快捷中心", desc: "分析模式与思考时限、AI 引擎（轻量随包 / 冠军网络包下载）、主题材质、声音动效，都在这里。", icon: Zap },
    ],
  },
  {
    id: "quick-layout",
    title: "快捷中心与功能区布局",
    lead: "点开快捷中心，看「功能区布局」入口。",
    openQuickDrawer: true,
    tips: [
      { sel: ".quick-layout-entry", name: "功能区布局", desc: "打谱/读谱/做题三个界面的按钮排布都能在这里自由重排、整区隐藏或恢复默认，改完立即生效。", icon: Settings },
      { sel: ".quick-drawer-section-toggle", name: "快捷中心分组", desc: "分析、自动演示、外观等按组收纳；右上角「自定义」可勾选要显示在快捷中心的项。", icon: Zap },
    ],
  },
  {
    id: "import",
    title: "导入",
    lead: "底部中间的导入按钮。",
    tips: [
      { sel: "nav.bottom-nav button:nth-child(3)", name: "导入", desc: "支持 SGF / RenLib(.lib) / DP / DB / JSON / POS 等格式，还有图片识谱：棋盘截图识别成棋谱，可逐子校订。", icon: Download },
    ],
  },
  {
    id: "library",
    title: "棋谱库与题库",
    lead: "本地资料库，棋谱和练习题分两个分区。",
    tab: "library",
    tips: [
      { sel: "nav.bottom-nav button:nth-child(2)", name: "棋谱库", desc: "收藏、文件夹归类、手动排序、回收站；题库分区可练 VCF/VCT，做错的题进错题本。", icon: Library },
      { sel: ".library-search", name: "搜索", desc: "按棋谱名、棋手或主题词检索，如「祁观」「寒星」。", icon: Search },
    ],
  },
  {
    id: "ai",
    title: "AI 对战与陪练",
    lead: "底部导航的 AI 按钮。",
    tips: [
      { sel: "nav.bottom-nav button:nth-child(4)", name: "AI", desc: "人机对战五档强度，开局规则含索索夫-8、山口、五手两打等职业规则；开局库开启后 AI 按谱秒应。", icon: Bot },
    ],
  },
  {
    id: "settings",
    title: "设置与收尾",
    lead: "最后是设置页入口。",
    final: true,
    tips: [
      { sel: "nav.bottom-nav button:nth-child(5)", name: "设置", desc: "外观、数据备份与恢复、使用手册；本引导可随时重播。", icon: Settings },
      { sel: ".bottom-nav", name: "底部导航", desc: "打谱 / 棋谱库 / 导入 / AI / 设置五个页面入口。", icon: Home },
    ],
  },
];
