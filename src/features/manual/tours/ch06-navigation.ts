import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Play, Undo2 } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 06 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch06: TourStep[] = [
  { id: "nav-steps",
    title: "上一手 / 下一手",
    lead: "先用这两个键熟悉当前变化：逐步前进或回退。",
    tips: [
      { sel: "[data-action-id=\"navPrev\"]", name: "上一手", desc: "回到上一手；导航只改变正在看的节点，不会删除棋子。", icon: ChevronLeft },
      { sel: "[data-action-id=\"navNext\"]", name: "下一手", desc: "前进到下一手落子之后的局面。", icon: ChevronRight },
    ],
  },
  { id: "nav-ends",
    title: "起点 / 终点",
    lead: "看整盘时用「起点」「终点」直接跳到两端。",
    tips: [
      { sel: "[data-action-id=\"navStart\"]", name: "起点", desc: "回到当前变化的第一步。", icon: ChevronFirst },
      { sel: "[data-action-id=\"navEnd\"]", name: "终点", desc: "跳到当前分支的最新手。", icon: ChevronLast },
    ],
  },
  { id: "nav-undo",
    title: "撤销 / 重做 / 放弃",
    lead: "编辑出错时先用「撤销」，撤多了用「重做」。",
    mode: "record",
    tips: [
      { sel: "[data-action-id=\"navUndo\"]", name: "撤销", desc: "回退最近一次未保存的编辑；右侧还有「重做」和「放弃」，放弃会清掉全部未保存修改。", icon: Undo2 },
    ],
  },
  { id: "nav-review",
    title: "读谱连播",
    lead: "需要连续观看时切到读谱，开始自动播放；打谱模式这里换成撤销、重做、放弃。",
    mode: "review",
    tips: [
      { sel: ".playback-command", name: "播放", desc: "按当前变化自动连播，遇到分支或末尾自动停；速度与分支处理在快捷中心的「自动演示」里调。", icon: Play },
    ],
  },
  { id: "nav-done",
    title: "导航全掌握",
    lead: "导航、播放、撤销都在这几排按钮里，练几遍就熟了。",
    tab: "record",
    tips: [
      { sel: "[data-action-id=\"navNext\"]", name: "下一手", desc: "配合上一手、播放与撤销，就能走完整盘棋。", icon: ChevronRight },
    ],
    final: true,
  },
];
