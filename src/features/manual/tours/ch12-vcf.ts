import { Layers3, ListTree, Sparkles } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 12 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch12: TourStep[] = [
  { id: "vcf-enter",
    title: "找到 VCF 按钮",
    lead: "做题模式的首行功能区里有 VCF 生成器。",
    tab: "record",
    mode: "puzzle",
    tips: [
      { sel: "[data-action-id=\"vcf\"]", name: "VCF", desc: "点它展开出题面板，再点一次收起。", icon: Sparkles },
    ],
  },
  { id: "vcf-panel",
    title: "出题设置",
    lead: "模式、档位、数量，设好点「生成题目」。",
    mode: "puzzle",
    panel: "vcf",
    tips: [
      { sel: ".vcf-panel", name: "VCF 出题面板", desc: "模式：变形＝真题换朝向，原创＝用真题改出新局；档位：短 4–6 手／中 6–12 手／深 12–30 手；数量 1／5／10。生成中按钮变成「停止生成」，可以随时停下，每题都会再复核一遍才入库。", icon: Sparkles },
    ],
  },
  { id: "vcf-prove",
    title: "解答当前局面",
    lead: "不确定当前盘面有没有连续冲四，就点这个。",
    mode: "puzzle",
    panel: "vcf",
    tips: [
      { sel: "[aria-label=\"解答当前局面连续冲四\"]", name: "解答本局", desc: "对当前棋盘找连续冲四胜：九手内找到就把完整线路写在面板下方，没找到也会说明「九手内未找到、不代表无胜」。", icon: ListTree },
    ],
  },
  { id: "vcf-final",
    title: "入库与跟踪",
    lead: "生成的题直接进题库，题号列表跟踪进度。",
    mode: "puzzle",
    panel: "vcf",
    tips: [
      { sel: ".vcf-panel", name: "库与状态", desc: "生成的题自动存入「我的题库」：题号列表标出已通过、尝试中和未做，未攻克的会进错题本；点题号开始做，当前题再点一次收起面板。", icon: Layers3 },
    ],
    final: true,
  },
];
