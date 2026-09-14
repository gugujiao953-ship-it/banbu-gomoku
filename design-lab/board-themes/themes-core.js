/* 棋盘外观探索 · 核心 20 套（schema 示范与质量基线）
 *
 * 每套 = 棋盘材质(bd-*) + 棋子质感(st-*) + 棋盘子动效(mo-*) + 棋动效(mo-*) + 配色变量
 * 可用材质/质感/动效清单见 gallery.html 顶部注释区块，请只使用清单内的类名。
 *
 * vars 可用的键：
 *   bd-1 bd-2        棋盘底色渐变两端（必填）
 *   ln               网格线颜色（必填，建议带透明度）
 *   star             星位颜色
 *   s-black          黑子主色        s-black-2  黑子高光
 *   s-white          白子主色        glow       发光/强调色
 *   grain-opacity    纹理层不透明度（默认 .5）    grain-blend  混合模式（默认 overlay）
 *   line-filter      网格线滤镜（如 "blur(.4px)"）  frame/frame-w  边框线
 *   pad              棋盘留白百分比（默认 6）
 */
window.BOARD_THEMES_CORE = [
  {
    name: "榧木清供", family: "东方器物",
    note: "本榧木纹、蛤贝白子与温润包浆，最接近真实棋具的暖木基调",
    board: "wood", stone: "ceramic", motion: ["drift-slow"], stoneMotion: ["drop", "orbit"],
    vars: { "bd-1": "#e8cb92", "bd-2": "#c1904f", "ln": "#6b4a2a99", "star": "#5b3f26", "s-black": "#1b1b1f", "s-black-2": "#5c5c66", "s-white": "#f6efe2", "glow": "#ffd9a0" }
  },
  {
    name: "宣纸墨韵", family: "东方器物",
    note: "生宣底色配焦墨点，落子如题款，静中带动",
    board: "paper", stone: "ink", motion: ["inkspread"], stoneMotion: ["drop", "breathe"],
    vars: { "bd-1": "#f8f4ea", "bd-2": "#e6dcc4", "ln": "#6b625244", "star": "#4a4238", "s-black": "#141317", "s-black-2": "#4d4a52", "s-white": "#fbf8f0", "glow": "#b9ac93" }
  },
  {
    name: "青花御瓷", family: "东方器物",
    note: "釉下钴蓝晕染的瓷面，棋子如珠，光晕缓缓呼吸",
    board: "porcelain", stone: "ceramic", motion: ["glow-breathe"], stoneMotion: ["orbit", "drop"],
    vars: { "bd-1": "#f4f8fd", "bd-2": "#c8dbee", "ln": "#3f6ea5aa", "star": "#35618f", "s-black": "#17304d", "s-black-2": "#4d7aa8", "s-white": "#fbfdff", "glow": "#6fa6dd" }
  },
  {
    name: "大漆朱金", family: "东方器物",
    note: "堆朱大漆的深沉红黑，金线流光掠过漆面",
    board: "lacquer", stone: "metal", motion: ["shimmer"], stoneMotion: ["orbit", "drop"],
    vars: { "bd-1": "#2b100c", "bd-2": "#4d1b12", "ln": "#ffcf7a5c", "star": "#ffcf7a", "s-black": "#120806", "s-black-2": "#6b3a25", "s-white": "#ffd9a3", "glow": "#ff9d4d" }
  },
  {
    name: "金缮霜裂", family: "东方器物",
    note: "深灰陶面与金缮裂纹，残缺之美，金粉细微闪烁",
    board: "kintsugi", stone: "ceramic", motion: ["shimmer", "drift"], stoneMotion: ["sparkle", "drop"],
    vars: { "bd-1": "#2c2a28", "bd-2": "#413d38", "ln": "#ffd98273", "star": "#ffd982", "s-black": "#15130f", "s-black-2": "#5a534a", "s-white": "#f2ece0", "glow": "#ffd982" }
  },
  {
    name: "云锦织金", family: "织物纸艺",
    note: "云锦斜纹与织金光泽，棋子带珠母虹彩",
    board: "silk", stone: "pearl", motion: ["sweep"], stoneMotion: ["orbit", "breathe"],
    vars: { "bd-1": "#7c1c30", "bd-2": "#4a0f22", "ln": "#ffd76e73", "star": "#ffd76e", "s-black": "#2a0a12", "s-black-2": "#7d3a4a", "s-white": "#ffeccd", "glow": "#ffd76e" }
  },
  {
    name: "竹席清风", family: "东方器物",
    note: "竹丝编纹与炭黑棋，纹理缓缓平移如风过席面",
    board: "bamboo", stone: "matte", motion: ["drift"], stoneMotion: ["sway", "drop"],
    vars: { "bd-1": "#e7d5ab", "bd-2": "#c6a469", "ln": "#6f573244", "star": "#5c4526", "s-black": "#22201a", "s-black-2": "#5f5a4a", "s-white": "#f4ecd8", "glow": "#cfe3a8" }
  },
  {
    name: "玉髓凝脂", family: "材质实验",
    note: "半透青玉底与玉质棋子，光感在玉肉里缓慢游走",
    board: "jade", stone: "jade", motion: ["bloom"], stoneMotion: ["breathe", "glow-soft"],
    vars: { "bd-1": "#e2f5e9", "bd-2": "#a2d1b9", "ln": "#2f6b5173", "star": "#2f6b51", "s-black": "#10352a", "s-black-2": "#2f6b51", "s-white": "#f2fff8", "glow": "#7fe3c0" }
  },
  {
    name: "青铜饕餮", family: "东方器物",
    note: "青铜锈绿与饕餮纹的斑驳，金属反光缓缓横扫",
    board: "bronze", stone: "metal", motion: ["drift", "sweep"], stoneMotion: ["orbit", "sway"],
    vars: { "bd-1": "#3d4c3b", "bd-2": "#1f2c1d", "ln": "#9fd4b84d", "star": "#8fc7a3", "s-black": "#0f150f", "s-black-2": "#4a6b52", "s-white": "#cfe6d2", "glow": "#7fd4c0" }
  },
  {
    name: "月白极简", family: "现代极简",
    note: "几乎无色的纸白与哑光棋子，静到只剩落子动作",
    board: "paper", stone: "matte", motion: ["drift-slow", "glow-breathe"], stoneMotion: ["drop", "breathe"],
    vars: { "bd-1": "#fcfbf8", "bd-2": "#edeae3", "ln": "#b8b4a83d", "star": "#9a968c", "s-black": "#23221f", "s-black-2": "#6b6a64", "s-white": "#ffffff", "glow": "#d8d4c8" }
  },
  {
    name: "莫兰迪静物", family: "现代极简",
    note: "低饱和亚麻底与陶土棋子，像一幅静物画",
    board: "linen", stone: "clay", motion: ["drift-slow"], stoneMotion: ["breathe", "drop"],
    vars: { "bd-1": "#ded7cc", "bd-2": "#c0b5a5", "ln": "#7a72664d", "star": "#6f6858", "s-black": "#3c3a36", "s-black-2": "#6e6a62", "s-white": "#efeae0", "glow": "#c9a88f" }
  },
  {
    name: "霓虹夜巷", family: "赛博未来",
    note: "青粉双色霓虹网格，灯管偶尔接触不良地闪",
    board: "grid-neon", stone: "neon", motion: ["flicker"], stoneMotion: ["charge", "echo"],
    vars: { "bd-1": "#0a0c1c", "bd-2": "#170a28", "ln": "#00f0ff4d", "star": "#ff2fc8", "s-black": "#04060e", "s-black-2": "#2a2e52", "s-white": "#d8fbff", "glow": "#00f0ff" }
  },
  {
    name: "全息终端", family: "赛博未来",
    note: "全息薄膜的彩虹掠光，棋子像数据投影般转动",
    board: "holo", stone: "holo", motion: ["sweep"], stoneMotion: ["orbit", "sparkle"],
    vars: { "bd-1": "#111528", "bd-2": "#1c1032", "ln": "#b9a8ff4d", "star": "#8f7bff", "s-black": "#0b0a1a", "s-black-2": "#4a3f8f", "s-white": "#eae6ff", "glow": "#b9a8ff" }
  },
  {
    name: "深海荧光", family: "光影氛围",
    note: "深渊蓝里的生物荧光，水光缓慢扫过棋盘",
    board: "ocean", stone: "plasma", motion: ["caustics"], stoneMotion: ["echo", "glow-soft"],
    vars: { "bd-1": "#05222f", "bd-2": "#01101b", "ln": "#4fe3c14d", "star": "#3fd0b0", "s-black": "#01161f", "s-black-2": "#1f6b7a", "s-white": "#d6fff6", "glow": "#4fe3c1" }
  },
  {
    name: "星空之弈", family: "光影氛围",
    note: "深空底色与繁星闪烁，棋子像切割过的星晶",
    board: "star", stone: "crystal", motion: ["twinkle"], stoneMotion: ["sparkle", "breathe"],
    vars: { "bd-1": "#0a1030", "bd-2": "#050614", "ln": "#8fb0ff3d", "star": "#cfe0ff", "s-black": "#060818", "s-black-2": "#3a4a8f", "s-white": "#ffffff", "glow": "#a8c8ff" }
  },
  {
    name: "极光穹顶", family: "光影氛围",
    note: "极光带在棋面上缓慢起伏，玻璃棋子通透发亮",
    board: "aurora", stone: "glass", motion: ["aurora"], stoneMotion: ["glow-soft", "breathe"],
    vars: { "bd-1": "#061826", "bd-2": "#0b0f2a", "ln": "#7fffd03d", "star": "#8fffe0", "s-black": "#04121c", "s-black-2": "#2a6b7a", "s-white": "#e6fffa", "glow": "#7fffd0" }
  },
  {
    name: "熔岩裂谷", family: "自然有机",
    note: "暗岩裂隙里透出橙红余温，棋子像烧透的炭",
    board: "lava", stone: "ember", motion: ["haze"], stoneMotion: ["charge", "glow-soft"],
    vars: { "bd-1": "#1b0b06", "bd-2": "#300f06", "ln": "#ff9d4d5c", "star": "#ffb03a", "s-black": "#120604", "s-black-2": "#7a2f10", "s-white": "#ffd9a0", "glow": "#ff7a1a" }
  },
  {
    name: "冰川晶簇", family: "自然有机",
    note: "冰蓝底与霜晶切面，光在冰棱上跳",
    board: "ice", stone: "crystal", motion: ["shimmer"], stoneMotion: ["sparkle", "orbit"],
    vars: { "bd-1": "#eaf7ff", "bd-2": "#b4d5ea", "ln": "#5b8fb95c", "star": "#4a7fa8", "s-black": "#123048", "s-black-2": "#4a7fa8", "s-white": "#fbfeff", "glow": "#9fd8ff" }
  },
  {
    name: "樱吹雪", family: "自然有机",
    note: "粉白花瓣缓缓飘落，糖霜质感的棋子轻轻浮动",
    board: "sakura", stone: "candy", motion: ["snow"], stoneMotion: ["float", "breathe"],
    vars: { "bd-1": "#fdf3f7", "bd-2": "#f2d7e5", "ln": "#c98aa85c", "star": "#c07a98", "s-black": "#4a2a38", "s-black-2": "#8f5a70", "s-white": "#fff7fa", "glow": "#ffb7cf" }
  },
  {
    name: "像素街机", family: "游戏像素",
    note: "8-bit 方格与扫描线，方块棋子一格格落下",
    board: "pixel", stone: "pixel", motion: ["scan"], stoneMotion: ["drop", "sparkle"],
    vars: { "bd-1": "#1c1132", "bd-2": "#2c1142", "ln": "#ffffff4d", "star": "#ffd166", "s-black": "#0d0818", "s-black-2": "#4a3a6b", "s-white": "#f2f0ff", "glow": "#ff5ea8" }
  }
];
