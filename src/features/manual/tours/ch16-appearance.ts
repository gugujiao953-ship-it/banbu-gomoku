import { Grid, Layers3, Palette, Search } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 16 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch16: TourStep[] = [
  { id: "theme-enter",
    title: "进入外观设置",
    lead: "设置页顶部搜索框，输入「主题」「棋盘」就能直达。",
    tab: "settings",
    tips: [
      { sel: ".settings-search", name: "设置搜索", desc: "输入主题、棋盘、棋子或透明度，相关设置分类立刻过滤出来。", icon: Search },
    ],
  },
  { id: "theme-pref",
    title: "外观主题",
    lead: "浅色、深色还是跟随系统，这里定基调。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-0 > summary", name: "外观与音效", desc: "设置页的外观设置都收在「外观与音效」这一节里（默认收起）；点开它，再进「主题」子目录：跟随系统、浅色、深色、护眼与多套彩色主题，点选即切换并立即生效。落子、导航与主题动画可在「声音与音效 → 界面动效」里单独开关。", icon: Palette },
    ],
  },
  { id: "theme-visual",
    title: "棋盘与棋子材质",
    lead: "棋盘材质与棋子材质各自独立选择。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-0 > summary", name: "外观与音效", desc: "点开「外观与音效」，在「棋盘」子目录里选棋盘材质（14 种）、在「棋子」子目录里选棋子材质（16 种），每项都带预览图。", icon: Grid },
    ],
  },
  { id: "theme-board-opacity",
    title: "棋盘透明度",
    lead: "调低透明度，让页面背景主题透出。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-0 > summary", name: "外观与音效", desc: "点开「外观与音效 → 棋盘」，最下方的「棋盘透明度」滑杆只改棋面底色和边框，网格、坐标与提示保持清晰；最低 35%，预览会同时显示当前棋盘与棋子材质。", icon: Layers3 },
    ],
  },
  { id: "theme-stone",
    title: "棋子透明度",
    lead: "棋子本体也能调透明度。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-0 > summary", name: "外观与音效", desc: "点开「外观与音效 → 棋子」，最下方的「棋子透明度」滑杆只改黑白棋子本体，手数、最后一手、禁手和候选点保持清晰；最低 40%。", icon: Layers3 },
    ],
  },
  { id: "theme-quick",
    title: "快捷中心里也能改",
    lead: "点顶部应用图标打开快捷中心，主题、棋盘、棋子、声音在这里也能改。",
    tab: "record",
    openQuickDrawer: true,
    tips: [
      { sel: ".quick-visual-card", name: "外观与声音", desc: "展开后可直接切换应用主题、棋盘、棋子与声音开关，与设置里是同一批设置。右上角「自定义」可勾选快捷中心显示哪些项（取消勾选只是不在这里显示，设置里仍在）。", icon: Palette },
    ],
    final: true,
  },
];
