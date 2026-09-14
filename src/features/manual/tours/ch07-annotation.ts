import { MessageSquareText, Palette, SquarePen, Tag } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 07 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch07: TourStep[] = [
  { id: "note-comment",
    title: "查看节点注释",
    lead: "首行「注释框」展开或收起当前局面的只读注释（默认收起）。",
    tips: [
      { sel: "[data-action-id=\"comment\"]", name: "注释框", desc: "有注释的节点会在最后一手棋子上显示小气泡；要写入或修改注释，用「编辑」面板里的「注释」，保存后导出 SGF 会保留。", icon: MessageSquareText },
    ],
  },
  { id: "note-bubble",
    title: "棋盘上的气泡",
    lead: "带注释的局面在棋盘上有气泡标记，一眼就能找到。",
    tips: [
      { sel: ".renju-board", name: "棋盘上的注释气泡", desc: "某一步写了注释时，那一手棋子的右上角会出现气泡标记（当前示例棋谱尚无注释，所以此刻看不到气泡）。要写入或修改注释，用「编辑」面板里的「注释」。", icon: MessageSquareText },
    ],
  },
  { id: "note-info",
    title: "编辑面板与棋谱信息",
    lead: "点「编辑」打开常用编辑面板，里面再选「信息」。",
    panel: "notes",
    tips: [
      { sel: "[data-action-id=\"notes\"]", name: "编辑", desc: "面板含「注释」「信息」「旋转」「镜像」「去子」；点「信息」填棋谱名称、黑白方、赛事或主题、日期、规则和开局规则。", icon: SquarePen },
    ],
  },
  { id: "note-studio",
    title: "打开标注工作台",
    lead: "点首行「标注」打开工作台，在棋盘上画重点。",
    panel: "annotation",
    tips: [
      { sel: ".mark-studio", name: "标注工作台", desc: "标注属于棋谱内容，但不是落子：不改变轮次，也不参与胜负判断；打谱中的改动要保存才落盘。", icon: Tag },
    ],
  },
  { id: "note-styles",
    title: "选择样式与颜色",
    lead: "工作台里的样式盒集中管理标注工具：选好直接点棋盘位置放下。",
    panel: "annotation",
    tips: [
      { sel: ".mark-studio-box", name: "样式 / 颜色 / 类型 / 内容", desc: "「样式」选形状，「颜色」十二选一，「类型」决定候选字符，「内容」填字（自定义最多四个字）；还有「去标注」只擦不画。", icon: Palette },
    ],
  },
  { id: "note-done",
    title: "想法记在正确位置",
    lead: "注释写思路、信息管档案、标注画重点；打谱中的修改记得保存。",
    tips: [
      { sel: "[data-action-id=\"comment\"]", name: "注释框", desc: "注释和标注都写进棋谱、要保存；读谱时画的标注只存本机，可再写入棋谱。", icon: MessageSquareText },
    ],
    final: true,
  },
];
