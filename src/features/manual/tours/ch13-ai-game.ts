import { BookOpen, Bot, CircleHelp, Cpu, Gauge, Library } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 13 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch13: TourStep[] = [
  { id: "duel-page",
    title: "进入对弈页",
    lead: "底部导航第四格是「对弈」，AI 对战排在第一条。",
    tab: "duel",
    tips: [
      { sel: ".duel-entries", name: "五张入口卡", desc: "按顺序是 AI 对战、VCF 挑战、比赛计时器（线下对局用的独立计时器，界面上没有棋盘）、棋题生成器、每日一题。", icon: Bot },
      { sel: "[data-duel-entry=\"ai\"]", name: "AI 对战", desc: "点右侧「开始对局」打开对战设置；已有一盘没下完的对局时，会先问「回到上次对局，还是放弃它开新局」。", icon: Bot },
    ],
  },
  { id: "ai-enter",
    title: "对战设置",
    lead: "点「开始对局」，从上到下依次设置。",
    tab: "duel",
    sheet: "aiGame",
    tips: [
      { sel: ".ai-game-setup", name: "对战设置", desc: "从上到下依次是引擎、规则、开局（按规则走开局流程 / 自定义开局自己摆子）、难度（含开局库开关）、对局时长和执子；底部的「开始人机对战」按当前设置开新局。", icon: Bot },
    ],
  },
  { id: "ai-engine",
    title: "选择引擎",
    lead: "对弈跟着你选的引擎走；内存与线程可以自己调。",
    tips: [
      { sel: ".ai-setup-cells", name: "引擎", desc: "对弈用哪个引擎跟着你在设置 →「分析」或快捷中心里选的那个走（rapfi / katago / 云端）。安卓跑随包的原生引擎，装完即用、不需下载；网页版可以下载 38.4MB 的 rapfi 冠军权重包，没下载时先用内置备用引擎。内存与线程数在设置 →「分析」里调（内存默认 128MB、范围 64–2048MB）。", icon: Cpu },
    ],
  },
  { id: "ai-rule",
    title: "选择开局规则",
    lead: "规则分无禁、有禁两组，共 11 项。",
    tips: [
      { sel: ".ai-setup-cells.two", name: "无禁手 / 有禁手", desc: "点任一格展开该组的规则列表：无禁 5 项（无禁手、无禁6不胜、一手交换、三手交换、Swap2），有禁 6 项（有禁手、五手两打、五手多打（山口）、索索夫-8、塔拉山口-10、塔拉）。", icon: BookOpen },
      { sel: ".ai-rule-help-btn", name: "规则说明", desc: "这个问号打开完整规则说明，逐项给出流程、胜负和禁手；山口、索索夫-8 这类复杂开局建议先看流程再选。", icon: CircleHelp },
    ],
  },
  { id: "ai-difficulty",
    title: "难度与开局库",
    lead: "难度决定每步思考多久，右侧是开局库开关。",
    tips: [
      { sel: ".ai-setup-difficulty-line", name: "难度与开局库", desc: "难度：初级约 0.6 秒/步、中级约 2 秒、高级约 5 秒、大师约 10 秒，自由可自定义时间与深度；选完即生效。", icon: Gauge },
    ],
  },
  { id: "ai-book",
    title: "开局库（打点簿）",
    lead: "开启后开局能按内置打点簿秒落。",
    tips: [
      { sel: ".ai-setup-book-toggle", name: "开局库开关", desc: "默认关闭；开启后 AI 开局先查内置打点簿（索索夫簿与山口簿，按规则自动选簿），命中按最强打点秒落，未命中回落引擎。设置「可选增强功能」里有同一项。", icon: Library },
    ],
  },
  { id: "ai-start",
    title: "开始对局",
    lead: "点开始，按选定的开局规则落子。",
    tips: [
      { sel: ".ai-start-button", name: "开始人机对战", desc: "点它就进专门的对弈界面（界面上没有打谱 / 读谱 / 做题那一套）；要宣布或选打点数量的规则会在开局中弹出浮层。已有一盘没下完的对局时，会先问要不要回到它。", icon: Bot },
    ],
    final: true,
  },
];
