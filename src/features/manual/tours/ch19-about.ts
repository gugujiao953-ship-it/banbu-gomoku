import { BookOpen, Info, Mail, RefreshCw } from "lucide-react";
import type { TourStep } from "../../onboarding/tour-steps";

// 手册第 19 章的「目录引导」步骤。
// 纪律：tip 图标必须与真实按钮同图标；文案只讲功能不比喻；sel 锚定必须真实存在
// （改了界面要同步这里，qa/manual-tour-targets.mjs 会逐章验证目标能否找到）。
// 章节顺序与目录编号/引导下标（App.tsx 的 MANUAL_TOURS[index]）绑定，勿调换。
export const ch19: TourStep[] = [
  { id: "about-enter",
    title: "关于与更新",
    lead: "设置最下面的「关于」区，集中版本与更新入口。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-100", name: "关于", desc: "「启动时自动检查新版本」开关（默认开启）和「关于半步五子棋打谱」入口都在这里，点进去可看版本、检查更新和项目主页。", icon: Info },
    ],
  },
  { id: "about-update",
    title: "检查更新",
    lead: "自动与手动检查都会依次尝试多个更新源。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-100", name: "检查更新", desc: "发现新版本会弹窗提示一次：点「立即更新到 vX」前往下载页；点「以后再说」会记住该版本，之后同一版本不再打扰，出更新版本时仍会提示一次。手动检查在关于页和快捷中心底部都有。", icon: RefreshCw },
    ],
  },
  { id: "about-manual",
    title: "手册与新手引导",
    lead: "设置 →「使用手册与反馈」里有引导和手册入口。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-90", name: "使用手册与反馈", desc: "「新手引导」用高亮把核心功能重走一遍，约 1 分钟；「使用手册」按章说明，每章底部还能开「目录引导」。", icon: BookOpen },
    ],
  },
  { id: "about-feedback",
    title: "提交反馈",
    lead: "反馈先写成文本，确认后再发送。",
    tab: "settings",
    tips: [
      { sel: ".settings-order-90", name: "反馈问题或建议", desc: "面板会自动附上应用版本、当前页面和设备信息，但不会带棋谱内容、导入文件或诊断日志；回复邮箱可不填，填了只存本机。", icon: Mail },
    ],
    final: true,
  },
];
