import { ArchiveRestore, DatabaseBackup, Download, Recycle } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 15 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch15: TourStep[] = [
  { id: "safety-shortcuts",
    title: "棋谱库快捷图标行",
    lead: "从底部导航进棋谱库，看顶部这排小图标。",
    tab: "library",
    tips: [
      { sel: ".library-shortcuts", name: "快捷图标行", desc: "资料安全、回收站、批量处理等入口都在这排图标里，点开即用。", icon: ArchiveRestore },
    ],
  },
  { id: "safety-trash-entry",
    title: "回收站独立入口",
    lead: "回收站有自己的入口，不藏在设置里。",
    tips: [
      { sel: "[aria-label=\"回收站\"]", name: "回收站", desc: "删除的棋谱与用户题集会先进回收站；可恢复（保留原文件夹归属）或彻底删除，清空前会再次确认。", icon: Recycle },
    ],
  },
  { id: "safety-trash-open",
    title: "在回收站里恢复",
    lead: "打开回收站，误删的内容都在这里。",
    sheet: "trash",
    tips: [
      { sel: ".recycle-bin-sheet", name: "回收站", desc: "有内容时，顶部工具条显示当前项数，点「清空回收站」会先确认再全部删除；下方每条都能单独恢复或彻底删除，恢复后回到原来的文件夹。回收站为空时这里只显示空状态说明。", icon: ArchiveRestore },
    ],
  },
  { id: "safety-panel",
    title: "资料安全页",
    lead: "棋谱库快捷行的「资料安全」打开这一页。",
    sheet: "dataSafety",
    tips: [
      { sel: ".data-safety-panel", name: "资料安全页", desc: "完整备份的导出与恢复都集中在这里。", icon: DatabaseBackup },
      { sel: ".data-safety-summary", name: "数据概况", desc: "说明完整备份的覆盖范围与导出范围；误删内容请到回收站处理。", icon: DatabaseBackup },
    ],
  },
  { id: "safety-backup",
    title: "导出完整备份",
    lead: "定期把整套资料打成备份包，重要资料不只要保存。",
    sheet: "dataSafety",
    tips: [
      { sel: ".data-safety-action", name: "导出完整备份 / 恢复完整备份", desc: "导出会生成带校验的 ZIP（完整备份 JSON＋说明文件），覆盖棋谱、草稿、题库、进度、书签、回收站与设置；恢复会用备份整体替换当前数据，失败自动回滚，成功后页面重新加载。", icon: Download },
    ],
    final: true,
  },
];
