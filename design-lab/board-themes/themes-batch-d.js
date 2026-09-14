/* 棋盘外观探索 · 批次 D（艺术流派 / 印刷复刻 / 玩趣材质）
 *
 * 20 套方案：棋盘材质(bd-*) + 棋子质感(st-*) + 棋盘子动效(mo-*) + 棋动效(mo-*) + 配色变量
 * 只使用 SPEC.md 清单内的类名。
 * 说明：浅底主题把 bd-2 收深了一档，保证 s-white 明显偏白可辨；深底主题让 s-black 比底色更暗。
 */
window.BOARD_THEMES_D = [
  {
    name: "包豪斯原色", family: "艺术流派",
    note: "红黄蓝硬边方块压在米白上，棋子像三原色积木",
    board: "bauhaus", stone: "ceramic", motion: ["pulse-grid"], stoneMotion: ["drop"],
    vars: { "bd-1": "#F2F0EA", "bd-2": "#C4BCA8", "ln": "#11111155", "star": "#111111", "s-black": "#141414", "s-black-2": "#4A4A4A", "s-white": "#FFFFFF", "glow": "#D62828" }
  },
  {
    name: "孟菲斯狂想", family: "艺术流派",
    note: "80s 撞色波浪与圆点，糖果棋子踩着节拍摆动",
    board: "memphis", stone: "candy", motion: ["ripple"], stoneMotion: ["sway", "drop"],
    vars: { "bd-1": "#F5F0E6", "bd-2": "#CCBB96", "ln": "#16161655", "star": "#161616", "s-black": "#1A1A1A", "s-black-2": "#565656", "s-white": "#FFFFFF", "glow": "#FF5C8A" }
  },
  {
    name: "构成主义红", family: "艺术流派",
    note: "红黑斜切与工业粗线，棋子如铆钉般硬朗",
    board: "construct", stone: "metal", motion: ["drift"], stoneMotion: ["hover-stone", "drop"],
    vars: { "bd-1": "#E8E3D8", "bd-2": "#C4BBA6", "ln": "#11111155", "star": "#111111", "s-black": "#111111", "s-black-2": "#4A443C", "s-white": "#FFFFFF", "glow": "#D62828" }
  },
  {
    name: "装饰艺术黑金", family: "艺术流派",
    note: "黑金对称放射，爵士时代的华丽光弧缓缓扫过",
    board: "artdeco", stone: "gem", motion: ["sweep"], stoneMotion: ["orbit", "sparkle"],
    vars: { "bd-1": "#1A1A26", "bd-2": "#322B44", "ln": "#C9A22766", "star": "#C9A227", "s-black": "#050508", "s-black-2": "#4A4468", "s-white": "#F2EEE3", "glow": "#C9A227" }
  },
  {
    name: "新艺术藤蔓", family: "艺术流派",
    note: "藤蔓金线缠上橄榄绿，棋子在曲线里轻轻摇曳",
    board: "silk", stone: "wood-stone", motion: ["bloom"], stoneMotion: ["sway", "breathe"],
    vars: { "bd-1": "#EFE6D0", "bd-2": "#C9B98F", "ln": "#8A7A5A66", "star": "#3E5C4B", "s-black": "#23201C", "s-black-2": "#5A5245", "s-white": "#FBF7EC", "glow": "#3E5C4B" }
  },
  {
    name: "瑞士网格", family: "艺术流派",
    note: "极致理性的网格与一枚红点，安静而精确",
    board: "blueprint", stone: "chrome", motion: ["scan"], stoneMotion: ["drop"],
    vars: { "bd-1": "#FAFAF8", "bd-2": "#B0B0AA", "ln": "#16161644", "star": "#E4002B", "s-black": "#161616", "s-black-2": "#4A4A4A", "s-white": "#FFFFFF", "glow": "#0F62FE" }
  },
  {
    name: "粗野主义黄", family: "艺术流派",
    note: "黑黄高对比与硬偏移阴影，粗粝得像水泥墙",
    board: "stone", stone: "obsidian", motion: ["dust"], stoneMotion: ["drop", "charge"],
    vars: { "bd-1": "#F5FFC7", "bd-2": "#B4C246", "ln": "#00000066", "star": "#000000", "s-black": "#050505", "s-black-2": "#3A3A1A", "s-white": "#FFFFFF", "glow": "#FAFF69" }
  },
  {
    name: "孔版双色", family: "印刷复刻",
    note: "专色叠印与半调网点，红蓝错位有印刷味",
    board: "riso", stone: "paper", motion: ["drift"], stoneMotion: ["drop", "echo"],
    vars: { "bd-1": "#F7F2E4", "bd-2": "#C6B992", "ln": "#2B4C7E66", "star": "#2B4C7E", "s-black": "#1E2233", "s-black-2": "#4A5470", "s-white": "#FFFDF7", "glow": "#FF4E50" }
  },
  {
    name: "复古套印", family: "印刷复刻",
    note: "暖纸颗粒上的橙红套印，像刚下机的老海报",
    board: "paper", stone: "ink", motion: ["shimmer"], stoneMotion: ["drop", "ripple-stone"],
    vars: { "bd-1": "#FFFEFB", "bd-2": "#BCB08A", "ln": "#20151555", "star": "#201515", "s-black": "#201515", "s-black-2": "#55443C", "s-white": "#FFFFFF", "glow": "#FF4F00" }
  },
  {
    name: "报纸编辑台", family: "印刷复刻",
    note: "新闻纸横纹与衬线气质，落子如排版铅字",
    board: "newsprint", stone: "matte", motion: ["drift-slow"], stoneMotion: ["drop"],
    vars: { "bd-1": "#F2F1ED", "bd-2": "#C0BDAE", "ln": "#26251E55", "star": "#26251E", "s-black": "#26251E", "s-black-2": "#5A574A", "s-white": "#FFFFFF", "glow": "#CF2D56" }
  },
  {
    name: "哥特玫瑰窗", family: "艺术流派",
    note: "尖拱玫瑰窗透进彩光，玻璃棋子忽明忽暗",
    board: "crystal", stone: "glass", motion: ["twinkle"], stoneMotion: ["glow-soft", "breathe"],
    vars: { "bd-1": "#221A2C", "bd-2": "#3A2C50", "ln": "#7A6BA866", "star": "#7A6BA8", "s-black": "#08060C", "s-black-2": "#3A3355", "s-white": "#E6E1F0", "glow": "#A62B44" }
  },
  {
    name: "巴洛克金饰", family: "艺术流派",
    note: "卷草金饰与戏剧金光，棋子像烛台下的宝石",
    board: "gold", stone: "pearl", motion: ["shimmer"], stoneMotion: ["orbit", "sway"],
    vars: { "bd-1": "#241A12", "bd-2": "#4A3620", "ln": "#C9A22766", "star": "#C9A227", "s-black": "#100A05", "s-black-2": "#5A3A1A", "s-white": "#F2E8D5", "glow": "#C9A227" }
  },
  {
    name: "洛可可贝壳", family: "艺术流派",
    note: "浅粉描金与贝壳曲线，轻盈得像一场下午茶",
    board: "velvet", stone: "cloud", motion: ["float"], stoneMotion: ["breathe", "glow-soft"],
    vars: { "bd-1": "#F7EDE2", "bd-2": "#D4BBA4", "ln": "#C9A22766", "star": "#C9A227", "s-black": "#3A2E30", "s-black-2": "#6E5A5A", "s-white": "#FFFFFF", "glow": "#E8B4B8" }
  },
  {
    name: "新拟物柔光", family: "玩趣材质",
    note: "同色系双阴影的凸凹软胶，光在表面慢慢呼吸",
    board: "mesh", stone: "velvet-stone", motion: ["glow-breathe"], stoneMotion: ["breathe", "hover-stone"],
    vars: { "bd-1": "#E4E9F0", "bd-2": "#B4BECC", "ln": "#A6B0C0AA", "star": "#5B7CFA", "s-black": "#2C333D", "s-black-2": "#5A6472", "s-white": "#F7FAFF", "glow": "#5B7CFA" }
  },
  {
    name: "粘土童趣", family: "玩趣材质",
    note: "橡皮泥厚圆与双层阴影，棋子捏起来软乎乎",
    board: "terrazzo", stone: "clay", motion: ["ripple"], stoneMotion: ["breathe", "drop"],
    vars: { "bd-1": "#FDF3E0", "bd-2": "#D9B988", "ln": "#451A0355", "star": "#451A03", "s-black": "#451A03", "s-black-2": "#7A4A2A", "s-white": "#FFFFFF", "glow": "#EC4899" }
  },
  {
    name: "果冻糖果", family: "玩趣材质",
    note: "粉紫蓝半透果冻，像能挤出甜味的软糖",
    board: "marble", stone: "holo", motion: ["caustics"], stoneMotion: ["liquid", "breathe"],
    vars: { "bd-1": "#F5E8F8", "bd-2": "#D3BEEA", "ln": "#7B3AA855", "star": "#7B3AA8", "s-black": "#3A2450", "s-black-2": "#7A5A9A", "s-white": "#FFFFFF", "glow": "#EA5EC1" }
  },
  {
    name: "磨砂玻璃", family: "玩趣材质",
    note: "磨砂玻璃浮在蓝紫渐变上，背后彩光透出来",
    board: "nebula", stone: "glass", motion: ["caustics"], stoneMotion: ["glow-soft", "hover-stone"],
    vars: { "bd-1": "#1B2A4A", "bd-2": "#3E2E5E", "ln": "#A9C4FF60", "star": "#7FD8F7", "s-black": "#10141C", "s-black-2": "#3A4258", "s-white": "#FFFFFF", "glow": "#7FD8F7" }
  },
  {
    name: "马赛克彩砖", family: "玩趣材质",
    note: "小方块玻璃砖嵌进灰缝，星芒在砖面跳",
    board: "pixel", stone: "crystal", motion: ["pulse-grid"], stoneMotion: ["breathe", "drop"],
    vars: { "bd-1": "#E8DFCB", "bd-2": "#C6B896", "ln": "#6B5B45AA", "star": "#C9A227", "s-black": "#1A1A1A", "s-black-2": "#4A4238", "s-white": "#FFFFFF", "glow": "#C9A227" }
  },
  {
    name: "十字绣布", family: "玩趣材质",
    note: "亚麻底上的十字针脚，棋子像绣线团",
    board: "linen", stone: "velvet-stone", motion: ["drift-slow"], stoneMotion: ["sway", "breathe"],
    vars: { "bd-1": "#F0E6D8", "bd-2": "#D2C2A8", "ln": "#8A755A66", "star": "#8A755A", "s-black": "#2A2620", "s-black-2": "#5E5448", "s-white": "#FFFFFF", "glow": "#C0392B" }
  },
  {
    name: "极繁拼贴墙", family: "印刷复刻",
    note: "多色贴纸层层叠加，丝网叠印出彩虹毛边",
    board: "holo", stone: "neon", motion: ["shimmer"], stoneMotion: ["sparkle", "liquid"],
    vars: { "bd-1": "#FFF8E8", "bd-2": "#C9B47F", "ln": "#146EF544", "star": "#146EF5", "s-black": "#1A1A2A", "s-black-2": "#4A4A6A", "s-white": "#FFFFFF", "glow": "#7A3DFF" }
  }
];
