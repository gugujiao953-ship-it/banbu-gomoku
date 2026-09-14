import { Bookmark, GitBranch, ListTree } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 05 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch05: TourStep[] = [
  { id: "tree-open",
    title: "打开分支树",
    lead: "首行功能区的「分支树」按钮展开棋谱的全部变化。",
    sheet: "tree",
    tips: [
      { sel: ".record-tree-panel", name: "分支树", desc: "每个方块一个局面，连线表示走棋关系；单指拖动找分支，双指缩放。面板顶部可切换「分支树」和「书签」两个标签页。", icon: ListTree },
    ],
  },
  { id: "tree-branch",
    title: "分支与跳转",
    lead: "点树里的任意节点，棋盘立刻跳到那个局面。",
    sheet: "tree",
    tips: [
      { sel: ".record-tree-panel", name: "树中节点", desc: "方块上标着手数或「起始局面」；点方块跳转，展开后可见后续。长按弹出复制、剪切、粘贴、删除分支；重命名在下方操作区。", icon: GitBranch },
    ],
  },
  { id: "bm-entry",
    title: "书签入口",
    lead: "棋谱库的快捷图标行里有「分支书签」，按棋谱收纳所有书签。",
    tab: "library",
    tips: [
      { sel: ".library-shortcuts[aria-label=\"棋谱库快捷入口\"]", name: "快捷图标行", desc: "点「分支书签」：每本棋谱一行，展开即见全部书签，点一下跳回那个局面。", icon: Bookmark },
    ],
  },
  { id: "bm-list",
    title: "书签标签页",
    lead: "分支树面板里也有「书签」标签页，专看当前棋谱的书签。",
    sheet: "tree",
    tips: [
      { sel: ".record-tree-tabs", name: "分支树 / 书签", desc: "点「书签」标签：按标题或备注搜索当前棋谱的书签，点书签跳回局面，还能改标题、备注和标识颜色。", icon: Bookmark },
    ],
  },
  { id: "bm-create",
    title: "打一个书签",
    lead: "在分支树里选中节点，下方操作区就能加书签。",
    sheet: "tree",
    tips: [
      { sel: ".tree-node-actions", name: "节点操作区", desc: "选中节点后点「加书签」；再到「书签」标签页里补标题、备注和颜色。读谱模式只能看，先回到打谱模式再加。", icon: Bookmark },
    ],
    final: true,
  },
];
