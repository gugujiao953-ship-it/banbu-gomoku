import { ChevronLeft, ChevronRight, Gauge, Grid, Home, PanelTop, PenTool, Save, SlidersHorizontal } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 01 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch01: TourStep[] = [
  { id: "intro-board",
    title: "认识棋盘",
    lead: "先看棋盘：落子、回看和标注都在这里完成。",
    tab: "record",
    mode: "record",
    tips: [
      { sel: ".renju-board", name: "棋盘", desc: "点交叉点落子；长按空位（或点鼠标右键）可以加标注，读谱里这类标注只存在本机。", icon: Grid },
    ],
  },
  { id: "intro-top",
    title: "顶部状态区",
    lead: "棋盘上方告诉你「现在在做什么」。",
    tips: [
      { sel: ".workspace-current", name: "当前棋谱", desc: "显示棋谱或棋题名、第几手、轮到哪一方和保存状态；点它会打开切换面板。", icon: PanelTop },
    ],
  },
  { id: "intro-modes",
    title: "三种工作模式",
    lead: "打谱、读谱、做题共用一块棋盘，可用按钮不同。",
    tab: "record",
    tips: [
      { sel: ".topbar-mode-toggle", name: "模式切换", desc: "打谱=编辑棋谱；读谱=只读浏览；做题=答题。切错模式时点这里换回来。", icon: PenTool },
    ],
  },
  { id: "intro-workspace",
    title: "功能区块",
    lead: "棋盘下方的按钮按用途分成三排。",
    tips: [
      { sel: ".action-bottom-row", name: "首行功能区", desc: "分析、标注、编辑、分支树、更多——研究用工具都在这一排。", icon: Gauge },
      { sel: ".action-top-row", name: "常驻操作区", desc: "注释、保存、新建、删除、禁手规则和落子颜色。", icon: Save },
      { sel: ".moves-row", name: "走棋功能区", desc: "起点、上一手、下一手、终点；打谱还有撤销、重做、放弃，读谱这里换成播放。", icon: ChevronRight },
    ],
  },
  { id: "intro-quick",
    title: "快捷中心",
    lead: "点左上角应用图标打开快捷中心，常用开关都在这。",
    tab: "record",
    openQuickDrawer: true,
    tips: [
      { sel: ".quick-drawer-customize", name: "自定义", desc: "点右上角这个按钮勾选要显示的项；改动保存在本机，取消勾选只是不在快捷中心显示。", icon: SlidersHorizontal },
    ],
  },
  { id: "intro-bottomnav",
    title: "底部导航",
    lead: "五个页面入口：打谱、棋谱库、导入、AI、设置。",
    tips: [
      { sel: ".bottom-nav", name: "底部导航", desc: "打谱（答题时显示为「做题」）、棋谱库、导入、AI、设置都在页面下方；导入按钮在中间凸起。", icon: Home },
    ],
  },
  { id: "intro-done",
    title: "准备开始",
    lead: "先在棋盘上落一手，再用「上一手」返回，找找感觉。",
    tips: [
      { sel: "[data-action-id=\"navPrev\"]", name: "上一手", desc: "接下来就去试试落子与回退吧。", icon: ChevronLeft },
    ],
    final: true,
  },
];
