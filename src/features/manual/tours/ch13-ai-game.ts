import { BookOpen, Bot, CircleHelp, Cpu, Gauge, Library } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 13 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch13: TourStep[] = [
  { id: "ai-enter",
    title: "进入 AI 对战",
    lead: "点底部导航的「AI」，打开对战设置。",
    tab: "record",
    sheet: "aiGame",
    tips: [
      { sel: ".ai-game-setup", name: "对战设置", desc: "从上到下依次是引擎、规则、难度（含开局库开关）、对局时长和执子；底部的「开始人机对战」按当前设置开新局。", icon: Bot },
    ],
  },
  { id: "ai-engine",
    title: "选择引擎",
    lead: "三档引擎决定速度和是否要额外下载。",
    tips: [
      { sel: ".ai-setup-cells.three", name: "引擎档位", desc: "轻量随包即用；强力用 128MB 标准配置；自调可以自己定内存（256–2048MB）。强力与自调都需要先下载档位数据包（约 38.4MB；引擎本体随包、缺失时启动会提示），没装会先用轻量并提示。", icon: Cpu },
    ],
  },
  { id: "ai-rule",
    title: "选择开局规则",
    lead: "规则分无禁、有禁两组，共 11 项。",
    tips: [
      { sel: ".ai-setup-cells.two", name: "无禁手 / 有禁手", desc: "点任一格展开该组的规则列表：无禁 4 项（无禁手、无禁6不胜、一手交换、三手交换），有禁 7 项（有禁手、五手两打、五手多打、山口、索索夫-8、塔拉山口-10、塔拉）。", icon: BookOpen },
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
      { sel: ".ai-start-button", name: "开始人机对战", desc: "有对局进行时按钮变成「按新规则重新开始」。开局要宣布或选打点数量时会弹浮层；对局中点棋盘上的「思考中」可停止这次思考（AI 落当前最强点），状态条右侧的「退出」结束对局。", icon: Bot },
    ],
    final: true,
  },
];
