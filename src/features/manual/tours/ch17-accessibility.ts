import { Accessibility, Eye, Grid, Search, Settings, Sparkles, TabletSmartphone } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 17 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch17: TourStep[] = [
  { id: "display-search",
    title: "设置搜索",
    lead: "设置内容多，先记住顶部的搜索框。",
    tab: "settings",
    tips: [
      { sel: ".settings-search", name: "设置搜索", desc: "输入「字号」「手势」「平板」「布局」等关键词，相关分类会直接过滤出来。", icon: Search },
    ],
  },
  { id: "display-font",
    title: "字号档位",
    lead: "字号在「无障碍与反馈」区整档调整。",
    tab: "settings",
    tips: [
      { sel: ".font-scale-options", name: "界面字号", desc: "正常、大字、特大字分别是 100%、115%、130%；只放大界面文字与控件，不缩放棋盘。", icon: Accessibility },
    ],
  },
  { id: "display-feedback",
    title: "反馈与配色",
    lead: "动效、震动与色觉配色都在同一区。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-30", name: "无障碍与反馈", desc: "「界面动效」关闭落子、导航、胜线与界面过渡；「触觉反馈」打开后落子、导航、禁手与胜负各有很短的震动（仅安卓应用内生效）；「色觉友好配色」把最容易混的几对标注颜色沿明度拉开，并把最后一手标记与胜负线从红改成蓝。", icon: Accessibility },
    ],
  },
  { id: "display-board",
    title: "棋盘显示",
    lead: "手数、坐标、禁手辅助与最后一手标记各自独立。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-10", name: "棋盘显示", desc: "展开这一区可分别开关手数、坐标、禁手辅助和最后一手标记，并调整棋子大小（在自动大小上缩放，上限是相邻棋子相切）、棋子序号大小、画线粗细、坐标字号和棋盘侧边（侧边越窄，四边坐标空间越挤、棋盘本体越大）。最下面的「棋盘透明度」「棋子透明度」也在这一区（2026-10-08 从「外观与音效」搬来）。", icon: Eye },
    ],
  },
  { id: "display-gesture",
    title: "手势开关",
    lead: "双指缩放和双指滑动切手默认关闭。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-70", name: "可选增强功能", desc: "在「双指缩放棋盘」「双指滑动切手」里按需打开；棋谱树的单指拖动与双指缩放不受影响，始终可用。", icon: Sparkles },
    ],
  },
  { id: "display-device",
    title: "设备布局",
    lead: "横屏一律双栏（没有开关），功能区布局也在这一区。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-80", name: "设备布局", desc: "「按钮宽度溢出后」默认「横向滚动」（按钮多时不换行、省一行高度）；想让它按行换行、两侧不放箭头就选「自动换行」；横屏一律双栏（棋盘与操作区并排、导航收成右缘竖条），没有开关；「功能区布局」入口可分别调整打谱、读谱、做题界面的按钮位置与显示。", icon: TabletSmartphone },
    ],
  },
  { id: "display-layout",
    title: "功能区布局",
    lead: "打开快捷中心里的功能区布局，按界面分别重排按钮。",
    tab: "record",
    openQuickDrawer: true,
    tips: [
      { sel: ".quick-layout-entry", name: "功能区布局", desc: "可拖动按钮换位、隐藏单个按钮或整区隐藏，隐藏「首行功能区」或走棋区会收起对应那一行；改完点「应用」保存。", icon: Settings },
    ],
  },
  { id: "display-check",
    title: "回棋盘确认效果",
    lead: "设置即改即存，回棋盘看看实际效果。",
    tab: "record",
    tips: [
      { sel: ".renju-board", name: "棋盘", desc: "确认字号变大后手数与标记仍然清楚；用特大字建议横屏、竖屏都试一下。", icon: Grid },
    ],
    final: true,
  },
];
