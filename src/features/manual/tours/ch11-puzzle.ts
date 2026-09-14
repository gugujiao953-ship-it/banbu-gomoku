import { BookOpen, ChevronDown, CircleDot, Gauge, Layers3, Puzzle, Shield } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 11 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch11: TourStep[] = [
  { id: "puzzle-mode",
    title: "进入做题模式",
    lead: "顶栏把模式切成「做题」，棋盘就变成练习场。",
    tab: "record",
    mode: "puzzle",
    tips: [
      { sel: ".topbar-mode-toggle", name: "模式切换", desc: "打谱、读谱、做题三档，点右边带拼图图标的那一档。做题时棋盘下方固定是首行功能区和走棋区。", icon: Puzzle },
    ],
  },
  { id: "puzzle-layout",
    title: "做题页布局",
    lead: "做题页固定两行：上面一行 5 格，再往下是走棋区五键。",
    mode: "puzzle",
    tips: [
      { sel: ".workspace-status.puzzle-mode", name: "应战状态与换边", desc: "这行在首行之上：左边是当前状态（练习中／陪练思考中／挑战成功／本题失败等）和题面提示，右边固定是黑白切换。", icon: CircleDot },
      { sel: ".action-bottom-row", name: "首行功能区（5 格）", desc: "分析／应战或摆棋（同一枚按钮的两种状态，按当前是否在摆棋只显示一枚）／VCF／禁手规则／更多。", icon: Gauge },
      { sel: ".puzzle-nav-row", name: "走棋区（固定五键）", desc: "上一题／选题／下一题／悔棋／重启，摆棋时也不变；陪练思考中「下一题」会临时变成「停止」。", icon: BookOpen },
    ],
  },
  { id: "puzzle-title",
    title: "当前题目",
    lead: "棋盘上方还有一条状态条，显示做到哪、轮到谁。",
    mode: "puzzle",
    tips: [
      { sel: ".workspace-current", name: "题目状态条", desc: "显示题目名、题集名、题号进度、轮到哪一方和当前状态；点它直接打开换题浮层。", icon: ChevronDown },
    ],
  },
  { id: "puzzle-rule",
    title: "做题规则",
    lead: "有禁还是无禁以首行这枚按钮为准，切换会重置当前作答。",
    mode: "puzzle",
    tips: [
      { sel: "[data-action-id=\"rule\"]", name: "禁手规则", desc: "按钮上写着「有禁」或「无禁」。被题目或题集指定时会锁住点不动；能改时点一下切换，当前作答会安全重置。", icon: Shield },
    ],
  },
  { id: "wrongbook-entry",
    title: "错题本入口",
    lead: "没攻克的题会自动收进错题本，入口在题库页的快捷图标行。",
    tab: "library",
    tips: [
      { sel: ".library-segment", name: "棋谱 / 题库切换", desc: "先点「题库」切到题库页；下面快捷图标行里的「错题本」集中列出尝试过但还没赢下的题。", icon: Layers3 },
    ],
  },
  { id: "wrongbook-list",
    title: "错题本列表",
    lead: "点开错题本，每道没过的题都在。",
    tab: "library",
    sheet: "wrongbook",
    tips: [
      { sel: ".sheet-body", name: "错题本", desc: "只收录尝试过但尚未攻克的题，已完成的不会出现；每个条目显示题名、所属题集、尝试次数与最近做题日期，点条目直接重新打开练习。若还没有错题，这里会显示空状态提示。", icon: Layers3 },
    ],
    final: true,
  },
];
