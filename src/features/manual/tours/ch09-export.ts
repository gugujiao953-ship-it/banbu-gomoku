import { Download, FilePlus2, Layers3, Upload } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 09 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch09: TourStep[] = [
  { id: "export-scope",
    title: "先选导出范围",
    lead: "面板从上到下：先定范围，再看格式，最后分享。",
    sheet: "export",
    tips: [
      { sel: ".export-scope-grid", name: "导出范围", desc: "整份棋谱（完整变化树、注释与标注）/ 当前变化（从起点到当前选择，再沿主线到末尾）/ 当前局面（只保留盘面、轮到谁走与当前标注）。弹窗每次打开都默认「整份棋谱」。", icon: Layers3 },
    ],
  },
  { id: "export-lib",
    title: "LIB 转换",
    lead: "当前棋谱来自 LIB 时，这里多一张转换卡片。",
    sheet: "export",
    tips: [
      { sel: ".export-primary-card", name: "完整 LIB 转换为 SGF", desc: "只有当前棋谱来自 LIB（刚打开且未编辑、仍保留原文件）时，这排主卡片里才会额外出现「完整 LIB 转换为 SGF」；它需保持「整份棋谱」范围，源文件超过 64MB 会停用。", icon: Upload },
    ],
  },
  { id: "export-format",
    title: "选择导出格式",
    lead: "选好范围，再点格式网格里的按钮。",
    sheet: "export",
    tips: [
      { sel: ".export-format-grid", name: "导出格式", desc: "SGF / FGF / REN / RENJS / WZQ 内容相同、扩展名不同；JSON 是半步原生数据；LIB 与 PSQ 只有「整份棋谱」范围能点，其中 PSQ 只保留主线。", icon: FilePlus2 },
      { sel: ".export-primary-card.direct", name: "原格式直接导出", desc: "按导入时的原格式导出：SGF 系重新生成同语法内容，POS / TXT 导出主线坐标，LIB / DP / DB 直接输出原始字节。", icon: Download },
    ],
  },
  { id: "export-share",
    title: "导出并分享",
    lead: "把当前棋谱作为 SGF 文件交给系统分享面板。",
    sheet: "export",
    tips: [
      { sel: ".export-primary-card", name: "导出并分享", desc: "默认导出 SGF，微信 / QQ 发出去对方可直接打开打谱；想导出成图片请用下面的卡片。", icon: Upload },
    ],
  },
  { id: "export-image",
    title: "分享当前局面图片",
    lead: "「分享为图片」把当前局面生成 PNG，适合分享或讲解。",
    sheet: "export",
    tips: [
      { sel: ".board-share-card", name: "分享为图片", desc: "先勾选要带的内容（手数 / 坐标 / 标注 / 水印），再点「系统分享」或「保存」；棋盘主题、棋子透明度与旋转、镜像都沿用当前棋盘上的显示。", icon: Download },
    ],
  },
  { id: "export-done",
    title: "导出不等于保存",
    lead: "导出只是创建副本，不会自动把当前草稿写进本机棋谱库。",
    sheet: "export",
    tips: [
      { sel: ".export-hub", name: "导出中心", desc: "默认落到「下载 / 半步五子棋打谱 / 导出」，没有公共下载目录时退回「文档 / 半步五子棋打谱 / 导出」；长期迁移整套资料请用「资料安全」里的完整备份。", icon: Download },
    ],
    final: true,
  },
];
