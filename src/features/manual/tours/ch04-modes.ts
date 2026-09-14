import { BookOpen, Gauge, PenTool, Play, RotateCw, Save } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 04 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch04: TourStep[] = [
  { id: "diff-toggle",
    title: "三种工作模式",
    lead: "模式切换在页面顶部、应用名右侧：打谱、读谱、做题共用一块棋盘，权限不同。",
    tab: "record",
    tips: [
      { sel: ".topbar-mode-toggle", name: "模式切换", desc: "打谱=编辑棋谱；读谱=只读浏览；做题=答题。它只在打谱页顶部出现。", icon: PenTool },
    ],
  },
  { id: "diff-record",
    title: "打谱：自由编辑",
    lead: "打谱模式下可以落子、建立新分支、修改注释和棋谱信息。",
    mode: "record",
    tips: [
      { sel: ".action-top-row", name: "常驻操作区", desc: "注释、保存、新建、删除、禁手规则和落子颜色都在这一排；删除某一步会连同它后面的变化一起删。", icon: Save },
    ],
  },
  { id: "diff-review",
    title: "读谱：安心浏览",
    lead: "切到读谱模式，只看棋不编辑，误点空位也不会改坏棋谱。",
    mode: "review",
    tips: [
      { sel: ".topbar-mode-toggle", name: "模式切换", desc: "读谱只能沿原谱已有的变化浏览；新建、保存、删除、改规则和改棋谱信息都不可用。", icon: BookOpen },
    ],
  },
  { id: "diff-play",
    title: "读谱：自动播放",
    lead: "读谱模式下点「播放」，从头到尾自动走棋。",
    mode: "review",
    tips: [
      { sel: ".playback-command", name: "播放", desc: "播放按钮只在读谱里出现，点一下开始、再点暂停；速度和遇到分支的行为在设置或快捷中心的「自动演示」里调。", icon: Play },
    ],
  },
  { id: "diff-puzzle",
    title: "做题：答题与摆棋",
    lead: "再切到做题模式，载入题目初始局面并按规则作答。",
    mode: "puzzle",
    tips: [
      { sel: ".puzzle-nav-row", name: "题目导航", desc: "固定五键：上一题、选题、下一题、悔棋、重启；悔棋只退你走过的回合，重启会清掉本题的临时改动。", icon: RotateCw },
      { sel: ".action-bottom-row", name: "题目首行", desc: "分析（帮你想一手）、应战/摆棋、VCF、禁手规则、更多，共五格。", icon: Gauge },
    ],
  },
  { id: "diff-done",
    title: "按需切换",
    lead: "先选对模式，后面的操作会简单很多。",
    tips: [
      { sel: ".topbar-mode-toggle", name: "模式切换", desc: "切到读谱会暂存草稿、切回打谱自动恢复；切到做题前如果有草稿，会先让你保存或放弃。", icon: PenTool },
    ],
    final: true,
  },
];
