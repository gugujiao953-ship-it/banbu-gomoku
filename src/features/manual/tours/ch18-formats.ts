import { ArchiveRestore, BookOpen, Search, Upload } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 18 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch18: TourStep[] = [
  { id: "compat-enter",
    title: "数据与兼容区",
    lead: "格式兼容与规则边界的说明，都在设置里的「数据与兼容」区。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-60", name: "数据与兼容", desc: "导入、导出、备份与「格式兼容说明」收在同一区，说明里逐项列出各格式的可写能力与保真范围。", icon: ArchiveRestore },
    ],
  },
  { id: "compat-lookup",
    title: "按关键词直达",
    lead: "记不住分区，就用设置搜索。",
    tab: "settings",
    tips: [
      { sel: ".settings-search", name: "设置搜索", desc: "输入「格式」「兼容」「导入」「导出」等关键词，相关分类会直接过滤出来。", icon: Search },
    ],
  },
  { id: "compat-check",
    title: "导入后先核对",
    lead: "导入成功不等于规则和标记完全一致。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-60", name: "导入后核对", desc: "导入后先看棋盘路数与规则名称，再抽查主线、分支、注释和坐标基准；结构不明确的文件会被拒绝或提示，不会静默改写。", icon: ArchiveRestore },
    ],
  },
  { id: "compat-rules",
    title: "规则边界",
    lead: "有禁与无禁的胜负条件不同，开局流程也不同。",
    tab: "record",
    sheet: "aiGame",
    tips: [
      { sel: ".ai-rule-help-btn", name: "规则说明", desc: "人机对局设置里规则行右侧的「?」可查看所有规则说明：连珠黑方受三三、四四、长连禁手约束，无禁6不胜必须恰好五连。", icon: BookOpen },
    ],
  },
  { id: "compat-export",
    title: "导出格式与范围",
    lead: "导出先选范围，再点格式。",
    tab: "record",
    sheet: "export",
    tips: [
      { sel: ".export-scope-grid", name: "导出范围", desc: "整份棋谱 / 当前变化 / 当前局面先选清楚：LIB 与 PSQ 只在「整份棋谱」下可用。", icon: Upload },
      { sel: ".export-format-grid", name: "导出格式", desc: "现有 SGF、FGF、REN、RENJS、WZQ、JSON、LIB、PSQ 八种；PSQ 与 POS 只保留主线，LIB / SGF / JSON 互转保留变化树与注释。", icon: Upload },
    ],
    final: true,
  },
];
