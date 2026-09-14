import { FilePlus2, Grid, PenLine, Save, X } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 03 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch03: TourStep[] = [
  { id: "create-new",
    title: "新建棋谱",
    lead: "在打谱页点「新建」，开始一盘新的空白棋局。",
    tab: "record",
    mode: "record",
    tips: [
      { sel: "[data-action-id=\"new\"]", name: "新建", desc: "新建不会删除棋谱库里已经保存的旧棋谱，放心开新盘。", icon: FilePlus2 },
    ],
  },
  { id: "create-moves",
    title: "先落几手",
    lead: "落子、写注释或建立变化，让棋谱有内容可保存。",
    tips: [
      { sel: ".renju-board", name: "棋盘", desc: "点交叉点落子；每一步都会记入当前棋谱，顶部随之显示「未保存草稿」。", icon: Grid },
    ],
  },
  { id: "create-save",
    title: "正式保存",
    lead: "点「保存」，草稿才会写回当前棋谱。",
    tips: [
      { sel: "[data-action-id=\"save\"]", name: "保存", desc: "这里是常驻操作区的保存；顶栏的「保存棋谱」还能改名称、存成题目或换分组。保存后等顶部变成「已保存」。", icon: Save },
    ],
  },
  { id: "create-draft",
    title: "草稿保护",
    lead: "未保存的改动会先保留为草稿，顶部状态条会给出提示。",
    tips: [
      { sel: ".workspace-current", name: "当前棋谱", desc: "切谱、新建、导入或开始做题前如果还有草稿，应用会先让你选保存、放弃或取消。", icon: PenLine },
    ],
  },
  { id: "create-discard",
    title: "放弃修改",
    lead: "这次编辑不想要了，点「放弃」回到最近一次保存的状态。",
    tips: [
      { sel: "[data-action-id=\"navDiscard\"]", name: "放弃", desc: "清除当前全部未保存修改；有草稿时会再次确认。", icon: X },
    ],
  },
  { id: "create-done",
    title: "基本循环",
    lead: "新建 → 编辑 → 保存或放弃，是这个页面的基本循环。",
    tips: [
      { sel: "[data-action-id=\"save\"]", name: "保存", desc: "养成先形成草稿、确认后再正式保存的习惯。", icon: Save },
    ],
    final: true,
  },
];
