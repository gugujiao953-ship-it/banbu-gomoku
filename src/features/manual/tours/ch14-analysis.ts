import { Bot, ChevronDown, Database, Gauge, GitBranch, ListChecks } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 14 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch14: TourStep[] = [
  { id: "analysis-open",
    title: "打开分析面板",
    lead: "点功能区首行的「分析」按钮，展开分析面板。",
    panel: "analysis",
    tips: [
      { sel: ".ai-analysis-panel", name: "分析面板", desc: "首行「分析」只负责展开／收起面板；思考只针对启动时的当前节点，局面一改变，旧结果自动滚动更新到新局面。", icon: Gauge },
      { sel: ".ai-analysis-panel .analysis-toggle", name: "分析总开关", desc: "面板头部左侧的滑动开关才是开始／停止分析的总开关，打开它才会持续思考。", icon: Gauge },
    ],
  },
  { id: "analysis-modes",
    title: "分析模式与引擎档位",
    lead: "面板头部第二项是模式切换，旁边是引擎档位徽标。",
    tips: [
      { sel: ".panel-select-trigger[aria-label=\"分析模式\"]", name: "分析模式", desc: "持续：一轮接一轮加深当前局面；自对弈：替黑白双方按每步时限落子；提示：点一下想一手并直接落子。", icon: ChevronDown },
      { sel: ".ai-engine-badge", name: "引擎档位", desc: "点一下在轻量→强力→自调间轮换。强力与自调需要引擎包，未下载时会提示并开始下载；设置 →「强力 AI 引擎」里可下载、重新下载或删除。", icon: Bot },
    ],
  },
  { id: "analysis-count",
    title: "选点数量与小数位",
    lead: "候选点显示多少、数值保留几位，都在这排下拉里。",
    tips: [
      { sel: ".panel-select-trigger[aria-label=\"选点数量\"]", name: "选点数量", desc: "1–10 选，棋盘上同步标出的候选点数随之变化。", icon: ChevronDown },
      { sel: ".panel-select-trigger[aria-label=\"选点小数位数\"]", name: "小数位数", desc: "0–2 位，只影响胜率和评估分的显示。", icon: ChevronDown },
    ],
  },
  { id: "analysis-metric",
    title: "候选点显示指标",
    lead: "候选点旁显示哪个指标，可以自己选。",
    tips: [
      { sel: ".panel-select-trigger[aria-label=\"选点显示内容\"]", name: "显示指标", desc: "胜率、评估分、深度或计算量，任选其一；人机对战界面不显示胜率。", icon: ChevronDown },
    ],
  },
  { id: "analysis-stats",
    title: "实时统计区",
    lead: "面板中部是思考的实时统计。",
    tips: [
      { sel: ".ai-analysis-stats", name: "统计区", desc: "显示搜索深度、评估分、黑方胜率与节点数；人机对战界面不显示胜率。", icon: Database },
    ],
  },
  { id: "analysis-candidates",
    title: "候选点列表",
    lead: "面板下半部分按指标列出候选点。",
    tips: [
      { sel: ".ai-analysis-panel", name: "候选点列表", desc: "开启分析、引擎算出一批候选点后，面板下半部分会按当前指标列出候选点；点候选可在棋盘预览它预判的变化，再点一次取消，变化连线默认关闭（可在设置 →「分析」里打开）。候选点是研究提示，不等于每个都已经得到完整证明。", icon: ListChecks },
    ],
  },
  { id: "analysis-position",
    title: "跨谱查找相同局面",
    lead: "同一局面可能出现在别的棋谱里，可以在「更多」面板里横向比较。",
    panel: "view",
    tips: [
      { sel: ".dock-panel-view", name: "更多面板", desc: "点「跨谱查找」会在本地棋谱的主线和全部变化里找相同局面，勾选「包含旋转与镜像」可把不同朝向也算作同一局面。", icon: GitBranch },
    ],
    final: true,
  },
];
