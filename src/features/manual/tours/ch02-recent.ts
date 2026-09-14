import { ArchiveRestore, Clock3, FolderOpen, Library, Search } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 02 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch02: TourStep[] = [
  { id: "recent-current",
    title: "顶部名称是切换入口",
    lead: "棋盘上方显示当前棋谱与手数，点它可以快速切换内容。",
    tab: "record",
    tips: [
      { sel: ".workspace-current", name: "当前棋谱", desc: "显示棋谱名、第几手与轮次；点开是「选择棋谱 / 题集」面板，按文件夹浏览、可搜索，点一项直接切换。", icon: Clock3 },
    ],
  },
  { id: "recent-restore",
    title: "找到恢复开关",
    lead: "恢复开关在设置页的「文件与存储」里，用搜索框定位最省事。",
    tab: "settings",
    tips: [
      { sel: ".settings-search", name: "设置搜索", desc: "输入「恢复」即可把「文件与存储」这一区直接过滤出来。", icon: Search },
      { sel: ".settings-order-50", name: "文件与存储", desc: "这一区里就是「退出后恢复上次局面」开关。", icon: FolderOpen },
    ],
  },
  { id: "recent-switch",
    title: "开启恢复上次局面",
    lead: "这个开关默认是开着的，打开后下次进入自动回到上次的位置。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-50 .setting-row", name: "退出后恢复上次局面", desc: "关掉只是下次不自动跳回，棋谱库、题库、草稿和做题进度都不会被删除。", icon: ArchiveRestore },
    ],
  },
  { id: "recent-done",
    title: "在棋谱库看最近内容",
    lead: "真正的「最近」在棋谱库：棋谱分区有「继续上次研究」和「最近棋谱」，题库分区有「最近棋题」。",
    tab: "record",
    tips: [
      { sel: ".bottom-nav", name: "棋谱库入口", desc: "点「棋谱库」就能看到上次研究的棋谱和最近练习的题目，点一项直接继续。", icon: Library },
    ],
    final: true,
  },
];
