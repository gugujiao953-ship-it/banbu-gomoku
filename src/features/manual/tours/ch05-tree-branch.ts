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
      { sel: ".record-tree-panel", name: "图谱工作区", desc: "上面是连线画布：一条单链沿同一行拉直，无分叉的链条节点压成小胶囊，上面同时写着坐标与手数；工具条的「搜索」可以搜手数、坐标、注释和标注，「分区」是每条变化一屏的目录式总览，「放大图谱」把面板让出去、整块屏幕给画布。单指拖动找分支，双指或滚轮缩放（以手指/光标为锚，缩到多小都还看得见树）。下面是节点详情面板，可以折叠成画布右下角的一颗小按钮。面板顶部可切换「图谱」「导航」「列表」「书签」四个标签页。", icon: ListTree },
    ],
  },
  { id: "tree-branch",
    title: "分支与跳转",
    lead: "点树里的任意节点，棋盘立刻跳到那个局面。",
    sheet: "tree",
    tips: [
      { sel: ".record-tree-panel", name: "树中节点", desc: "方块写着坐标与手数，胶囊（原先是圆点）也写着坐标与手数（起始局面直接写出来）；点一下跳转，展开后可见后续。右下角金色环标出「这里有几支」的多分支点，不在当前路径上的分叉还会加金色描边。长按弹出复制、剪切、粘贴、删除分支；重命名在下方操作区。", icon: GitBranch },
      { sel: ".tree-inspector", name: "节点详情面板", desc: "这块面板默认收起，展开的是**「棋盘预览」**（点画布上的节点，那里就显示那个局面）或**「节点操作」**两档；宽屏时它浮在画布右下角，不占画布。面板右上角那把折叠点一下收起来，缩成画布右下角的一颗小按钮，再点按原档恢复。要一手一手读变化清单，切到顶部的「列表」标签页：一手一行、分支缩进，点一行跳到那个局面。", icon: GitBranch },
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
      { sel: ".record-tree-tabs", name: "图谱 / 导航 / 列表 / 书签", desc: "点「书签」标签：按标题或备注搜索当前棋谱的书签，点书签跳回局面，还能改标题、备注和标识颜色。", icon: Bookmark },
    ],
  },
  { id: "bm-create",
    title: "打一个书签",
    lead: "在分支树里选中节点，下方操作区就能加书签。",
    sheet: "tree",
    tips: [
      { sel: ".tree-inspector-options", name: "节点操作", desc: "选中节点后先点这一排的「节点操作」展开那一档，里面就有「加书签」；再到「书签」标签页里补标题、备注和颜色。读谱模式只能看，先回到打谱模式再加。", icon: Bookmark },
    ],
    final: true,
  },
];
