/* 棋盘外观探索 · B 批 20 套（赛博未来 / 数字终端 / 游戏世界）
 *
 * schema 与类名清单见 SPEC.md；风格基线见 themes-core.js。
 * 本批全为深底（16 蒙德风原为浅底，7 体素方块为中调），故 s-black 一律压到明显低于 bd-1，
 * s-white 统一偏冷白/荧光感，ln 用主题强调色叠 40%–60% 透明度。
 * 未新增任何材质/质感/动效类名，全部取自 SPEC 清单。
 */
window.BOARD_THEMES_B = [
  {
    name: "亚克力霓虹", family: "赛博未来",
    note: "透明亚克力叠出品红紫光边，棋子如悬浮灯管",
    board: "crystal", stone: "glass", motion: ["glow-breathe"], stoneMotion: ["glow-soft", "drop"],
    vars: { "bd-1": "#14121F", "bd-2": "#2A2440", "ln": "#6B5BFF80", "star": "#FF2FB9", "s-black": "#04030A", "s-black-2": "#453A7A", "s-white": "#F2F0FF", "glow": "#FF2FB9" }
  },
  {
    name: "液态铬", family: "赛博未来",
    note: "水银镜面在棋面上缓慢流动，棋子是液态金属",
    board: "chrome", stone: "chrome", motion: ["caustics"], stoneMotion: ["liquid", "hover-stone"],
    vars: { "bd-1": "#2A2E35", "bd-2": "#3E454E", "ln": "#6E7A8899", "star": "#8FD4FF", "s-black": "#0B0E13", "s-black-2": "#8794A3", "s-white": "#F0F4FA", "glow": "#8FD4FF" }
  },
  {
    name: "黑曜陨石", family: "赛博未来",
    note: "火山玻璃棱面嵌着陨坑，紫闪从裂缝里漏出",
    board: "stone", stone: "obsidian", motion: ["dust"], stoneMotion: ["sparkle", "sway"],
    vars: { "bd-1": "#131318", "bd-2": "#26262E", "ln": "#6A5C9A80", "star": "#A56BFF", "s-black": "#06060A", "s-black-2": "#4A4066", "s-white": "#D8D8E2", "glow": "#A56BFF" }
  },
  {
    name: "镭射箔", family: "赛博未来",
    note: "镭射箔纸掠光流转，棋子落进薄荷青虹彩",
    board: "mesh", stone: "holo", motion: ["sweep"], stoneMotion: ["orbit", "breathe"],
    vars: { "bd-1": "#1A1630", "bd-2": "#2E2050", "ln": "#8C7BFF73", "star": "#5CFFD0", "s-black": "#08040F", "s-black-2": "#5A4A9A", "s-white": "#F5F0FF", "glow": "#5CFFD0" }
  },
  {
    name: "故障艺术", family: "赛博未来",
    note: "RGB 通道不断错位撕裂，棋子抖动出重影",
    board: "carbon", stone: "plasma", motion: ["flicker"], stoneMotion: ["echo", "ripple-stone"],
    vars: { "bd-1": "#0E0E16", "bd-2": "#181820", "ln": "#00FFF066", "star": "#FF00A0", "s-black": "#020207", "s-black-2": "#2A4A5A", "s-white": "#EAFBFF", "glow": "#FF00A0" }
  },
  {
    name: "CRT 磷光", family: "数字终端",
    note: "老式绿屏扫描线缓缓下移，余辉久久不散",
    board: "newsprint", stone: "ember", motion: ["scan"], stoneMotion: ["charge", "glow-soft"],
    vars: { "bd-1": "#0B1A0E", "bd-2": "#123018", "ln": "#33FF6680", "star": "#33FF66", "s-black": "#020A05", "s-black-2": "#1E5C2E", "s-white": "#D9FFE2", "glow": "#33FF66" },
    "line-filter": "blur(.3px)"
  },
  {
    name: "体素方块", family: "游戏世界",
    note: "等距方块堆出的草绿世界，棋子一格格落下",
    board: "pixel", stone: "pixel", motion: ["drift"], stoneMotion: ["drop", "sparkle"],
    vars: { "bd-1": "#7FA36B", "bd-2": "#5E7E4E", "ln": "#3E5C3499", "star": "#C08B4A", "s-black": "#2A2A2A", "s-black-2": "#55555A", "s-white": "#F1F4EF", "glow": "#C08B4A" },
    "stone-scale": 0.8
  },
  {
    name: "终端命令", family: "数字终端",
    note: "近黑命令行里磷光绿闪烁，光标在棋格跳动",
    board: "circuit", stone: "neon", motion: ["pulse-grid"], stoneMotion: ["hover-stone", "echo"],
    vars: { "bd-1": "#0A0C12", "bd-2": "#151A24", "ln": "#00D99280", "star": "#00D992", "s-black": "#000000", "s-black-2": "#1E7A58", "s-white": "#D8FFE8", "glow": "#00D992" }
  },
  {
    name: "数据网格", family: "数字终端",
    note: "热力图色块铺满棋盘，棋子像跳动的数据点",
    board: "terrazzo", stone: "matte", motion: ["shimmer"], stoneMotion: ["ripple-stone", "breathe"],
    vars: { "bd-1": "#0B1220", "bd-2": "#132038", "ln": "#3B82F680", "star": "#10B981", "s-black": "#03060C", "s-black-2": "#2A4A7A", "s-white": "#EAF0FF", "glow": "#10B981" },
    "grain-opacity": 0.35
  },
  {
    name: "工程蓝图", family: "数字终端",
    note: "蓝晒图纸上白描网格，棋子如刚标注的节点",
    board: "blueprint", stone: "paper", motion: ["drift-slow"], stoneMotion: ["drop", "hover-stone"],
    vars: { "bd-1": "#0A2540", "bd-2": "#123A5C", "ln": "#EAF2FF66", "star": "#4FA3FF", "s-black": "#041020", "s-black-2": "#2A5A8F", "s-white": "#F5FAFF", "glow": "#4FA3FF" },
    "frame": "#7FB4FF", "frame-w": 1
  },
  {
    name: "蒸汽波", family: "赛博未来",
    note: "品红青渐变漫过棋盘，罗马柱影子缓缓摇晃",
    board: "gradient-sunset", stone: "pearl", motion: ["haze"], stoneMotion: ["orbit", "sway"],
    vars: { "bd-1": "#1A0B2E", "bd-2": "#2E1050", "ln": "#00E5FF66", "star": "#FF6AD5", "s-black": "#080313", "s-black-2": "#6A3A8F", "s-white": "#F5E6FF", "glow": "#FF6AD5" }
  },
  {
    name: "合成器波", family: "赛博未来",
    note: "紫红落日垂在霓虹网格后，棋子泛着铬光",
    board: "grid-neon", stone: "metal", motion: ["pulse-grid"], stoneMotion: ["breathe", "echo"],
    vars: { "bd-1": "#150632", "bd-2": "#26094E", "ln": "#FF2A6D80", "star": "#05D9E8", "s-black": "#03000B", "s-black-2": "#6A1F55", "s-white": "#EAF6FF", "glow": "#FF2A6D" }
  },
  {
    name: "夜城 2077", family: "赛博未来",
    note: "黄黑警示纹配青粉霓虹，棋子在霓虹雨里通电",
    board: "construct", stone: "metal", motion: ["flicker"], stoneMotion: ["charge", "sparkle"],
    vars: { "bd-1": "#0D0F1A", "bd-2": "#141B2E", "ln": "#F5D40073", "star": "#00F0FF", "s-black": "#03040A", "s-black-2": "#5A4A2A", "s-white": "#E8F6FF", "glow": "#00F0FF" }
  },
  {
    name: "希卡石板", family: "游戏世界",
    note: "蓝黑石壁浮起青色符文，棋子是古代核心",
    board: "marble", stone: "gem", motion: ["bloom"], stoneMotion: ["glow-soft", "orbit"],
    vars: { "bd-1": "#1B2226", "bd-2": "#2C3639", "ln": "#6FE3D266", "star": "#F5A623", "s-black": "#070B0D", "s-black-2": "#2F6B62", "s-white": "#E6F2F0", "glow": "#F5A623" }
  },
  {
    name: "璃月岩金", family: "游戏世界",
    note: "岩金回纹配青玉棋子，港口的灯缓缓扫过",
    board: "gold", stone: "jade", motion: ["dust"], stoneMotion: ["sway", "glow-soft"],
    vars: { "bd-1": "#1C1C28", "bd-2": "#2A2438", "ln": "#3FA98A80", "star": "#E8C86A", "s-black": "#090910", "s-black-2": "#5A7A66", "s-white": "#F5F1EA", "glow": "#E8C86A" }
  },
  {
    name: "蒙德风原", family: "游戏世界",
    note: "暖木浅底上青绿流动，棋子被风轻轻托起",
    board: "wood-fine", stone: "cloud", motion: ["float"], stoneMotion: ["breathe", "sway"],
    vars: { "bd-1": "#E4EFEC", "bd-2": "#C6DAD5", "ln": "#5E8A8299", "star": "#2F8F74", "s-black": "#2C3A38", "s-black-2": "#5A7A72", "s-white": "#FDFFFE", "glow": "#4FC3A1" }
  },
  {
    name: "Persona 红黑", family: "游戏世界",
    note: "红黑白硬边构成与半调网点，棋子在高对比里跳动",
    board: "riso", stone: "ink", motion: ["swirl"], stoneMotion: ["hover-stone", "drop"],
    vars: { "bd-1": "#101010", "bd-2": "#1A1A1A", "ln": "#E6001288", "star": "#FFFFFF", "s-black": "#000000", "s-black-2": "#555555", "s-white": "#FFFFFF", "glow": "#E60012" }
  },
  {
    name: "空洞骑士", family: "游戏世界",
    note: "幽蓝墨线勾出孤独废墟，棋子是寂静的灯",
    board: "ink", stone: "velvet-stone", motion: ["inkspread"], stoneMotion: ["sway", "glow-soft"],
    vars: { "bd-1": "#0C131E", "bd-2": "#16202F", "ln": "#9FB6D066", "star": "#7FD1E0", "s-black": "#02050A", "s-black-2": "#3A5A7A", "s-white": "#E9F0F7", "glow": "#7FD1E0" }
  },
  {
    name: "神族水晶", family: "游戏世界",
    note: "金蓝水晶悬在能量网格上，棋子嗡鸣充能",
    board: "jade", stone: "crystal", motion: ["twinkle"], stoneMotion: ["orbit", "charge"],
    vars: { "bd-1": "#0E1A24", "bd-2": "#16303F", "ln": "#7FE3F066", "star": "#F2C94C", "s-black": "#030A0F", "s-black-2": "#2A6A7A", "s-white": "#EAF8FF", "glow": "#F2C94C" }
  },
  {
    name: "奥术法阵", family: "游戏世界",
    note: "深蓝宇宙里符文旋转，金芒随法阵缓缓亮起",
    board: "nebula", stone: "gem", motion: ["aurora"], stoneMotion: ["sparkle", "breathe"],
    vars: { "bd-1": "#0B1020", "bd-2": "#13203F", "ln": "#3A5BA080", "star": "#D9B45C", "s-black": "#02040B", "s-black-2": "#3A5A9A", "s-white": "#E8EEF9", "glow": "#5FD0E8" }
  }
];
