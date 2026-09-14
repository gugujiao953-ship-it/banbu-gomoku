import { Download } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 08 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch08: TourStep[] = [
  { id: "import-nav",
    title: "导入入口",
    lead: "底部导航中间的「导入」，随时从这里添加新内容。",
    tips: [
      { sel: "nav.bottom-nav button:nth-child(3)", name: "导入", desc: "棋谱文件与图片识谱都从这里开始；点开先弹出导入面板。棋谱库和设置页右上角也有同一个导入按钮。", icon: Download },
    ],
  },
  { id: "import-choose",
    title: "选择导入方式",
    lead: "弹窗里两个入口：文件导入和图片识谱。",
    sheet: "import",
    tips: [
      { sel: ".import-options", name: "选择导入方式", desc: "上：导入棋谱文件（SGF、LIB、JSON、POS 等，题库 JSON 会自动识别，ZIP 备份包也能从这里导入）；下：图片识谱。在题库分区导入时，上面一条会变成「导入题库文件」。", icon: Download },
    ],
  },
  { id: "import-image",
    title: "图片识谱",
    lead: "棋盘截图也能变成棋谱。",
    sheet: "import",
    tips: [
      { sel: ".import-choice:nth-of-type(2)", name: "图片识谱", desc: "选图后先进入对齐界面：放大、拖动图片，把方框对准棋盘四条外框线再点「识别」。固定按十五路识别，会区分黑子与印刷空心白子。", icon: Download },
    ],
  },
  { id: "import-recent",
    title: "最近导入",
    lead: "开启「最近导入列表」后，用过的来源会留在这里，下次一键重开。",
    sheet: "import",
    tips: [
      { sel: ".import-options", name: "最近导入", desc: "需先在设置 →「可选增强功能」里打开「最近导入列表」，默认关闭；开启后保留最近 5 个来源文件，会显示在这个面板的下方，点任一来源直接重新打开；文件超过 16MB 时只留文件名，会提示重新选择原文件。", icon: Download },
    ],
    final: true,
  },
];
