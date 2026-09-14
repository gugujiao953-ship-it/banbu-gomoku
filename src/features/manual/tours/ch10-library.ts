import { ClipboardList, FolderOpen, Library, Recycle, Search, Zap } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 10 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch10: TourStep[] = [
  { id: "lib-tab",
    title: "棋谱库入口",
    lead: "点底部导航进入棋谱库，棋谱和题库分两个分区。",
    tab: "library",
    tips: [
      { sel: ".library-segment", name: "棋谱 / 题库分区", desc: "左边是棋谱，右边是题库，各自独立管理；上面那排「继续上次研究 / 最近棋谱 / 状态筛选」只在棋谱分区显示。", icon: Library },
    ],
  },
  { id: "lib-shortcuts",
    title: "快捷图标行",
    lead: "顶部一排小图标是常用入口。",
    tips: [
      { sel: ".library-shortcuts[aria-label=\"棋谱库快捷入口\"]", name: "快捷图标行", desc: "导入棋谱、新建棋谱、新建文件夹、收藏、分支书签、资料安全、回收站、批量处理，点开即用；切到题库分区会换成题库自己的一行。", icon: Zap },
      { sel: ".library-search", name: "搜索", desc: "按棋谱名、棋手或主题词检索，只筛当前分区；资料多时先搜索更快。", icon: Search },
    ],
  },
  { id: "lib-recycle",
    title: "回收站独立入口",
    lead: "误删的内容在这里找回。",
    tips: [
      { sel: "[aria-label=\"回收站\"]", name: "回收站", desc: "删除的棋谱与题集先进回收站：可单条恢复（保留原文件夹归属）或彻底删除，清空回收站前会再次确认。", icon: Recycle },
    ],
  },
  { id: "lib-folder",
    title: "文件夹",
    lead: "展开文件夹看看内容归属。",
    tips: [
      { sel: ".folder-library-list .library-folder-row", name: "文件夹列表", desc: "点文件夹行展开或收起；行右侧可置顶、排序、新建子文件夹、重命名，行本身还能拖动调整先后。", icon: FolderOpen },
    ],
  },
  { id: "lib-batch",
    title: "批量处理",
    lead: "一次移动或删除多份棋谱。",
    tips: [
      { sel: "[aria-label=\"批量处理\"]", name: "批量处理", desc: "进入后勾选棋谱，底部固定显示全选、取消全选、移动、删除、更多和退出；「更多」里有批量导出、收藏所选和批量替换注释。", icon: ClipboardList },
    ],
    final: true,
  },
];
