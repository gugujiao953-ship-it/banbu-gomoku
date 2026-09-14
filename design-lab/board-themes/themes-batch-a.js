/* 棋盘外观探索 · A 批 20 套
 * 风格族：东方器物 / 手作纸本 / 古典工艺
 * 材质·棋子质感·动效类名均取自 SPEC.md 清单；每套含完整 vars。
 * 深底黑子略作提亮、浅底白子带冷暖偏移，网格线统一保留 alpha 以保证可辨。
 */
window.BOARD_THEMES_A = [
  {
    name: "天目棋墩", family: "东方器物",
    note: "榧木墩上的蜂蜜暖光，天目釉落子沉入木纹",
    board: "wood-fine", stone: "ceramic", motion: ["drift-slow", "dust"], stoneMotion: ["drop", "breathe"],
    vars: { "bd-1": "#E3B778", "bd-2": "#C08B4A", "ln": "#5C3A1B99", "star": "#5C3A1B", "s-black": "#1A1714", "s-black-2": "#5A4A3A", "s-white": "#F7F1E3", "glow": "#E0A93F" }
  },
  {
    name: "蛤贝那智", family: "古典工艺",
    note: "那智黑石配蛤贝白子，冷光在贝面缓缓流转",
    board: "wood", stone: "pearl", motion: ["shimmer"], stoneMotion: ["orbit", "breathe"],
    vars: { "bd-1": "#D9A85F", "bd-2": "#B8843D", "ln": "#4A2E1499", "star": "#4A2E14", "s-black": "#16202B", "s-black-2": "#4A6B85", "s-white": "#F4F0E6", "glow": "#8FBBD9" }
  },
  {
    name: "青瓷开片", family: "东方器物",
    note: "粉青釉上冰裂细纹，棋子温润如玉片",
    board: "porcelain", stone: "jade", motion: ["inkspread"], stoneMotion: ["breathe", "drop"],
    vars: { "bd-1": "#C8DCC9", "bd-2": "#9DB89E", "ln": "#5A7A638C", "star": "#5A7A63", "s-black": "#23372C", "s-black-2": "#4A6B5A", "s-white": "#F6FBF4", "glow": "#E6D9A8" }
  },
  {
    name: "大漆螺钿", family: "古典工艺",
    note: "黑漆镜面上贝片七彩，金线扫过荡出虹光",
    board: "lacquer", stone: "pearl", motion: ["shimmer", "sweep"], stoneMotion: ["orbit", "sparkle"],
    vars: { "bd-1": "#1A120C", "bd-2": "#2B1B12", "ln": "#C9A22780", "star": "#C9A227", "s-black": "#0A0705", "s-black-2": "#3A2A22", "s-white": "#EFE3C8", "glow": "#7FE0D0" }
  },
  {
    name: "胡桃皮革", family: "古典工艺",
    note: "深胡桃木压缝线皮革，棋子如打磨过的木珠",
    board: "velvet", stone: "wood-stone", motion: ["drift-slow"], stoneMotion: ["drop", "hover-stone"],
    vars: { "bd-1": "#4A3324", "bd-2": "#5E4029", "ln": "#C9A87A73", "star": "#C9A87A", "s-black": "#17110C", "s-black-2": "#4A382A", "s-white": "#E7D8C3", "glow": "#C08B4A" }
  },
  {
    name: "缟玛瑙", family: "古典工艺",
    note: "墨绿矿脉带状铺陈，金线勾边暗处生辉",
    board: "marble", stone: "obsidian", motion: ["sweep", "haze"], stoneMotion: ["glow-soft", "orbit"],
    vars: { "bd-1": "#10312B", "bd-2": "#1E5A4A", "ln": "#8FD9C466", "star": "#E0B252", "s-black": "#061411", "s-black-2": "#2E6B58", "s-white": "#EAF6F1", "glow": "#E0B252" }
  },
  {
    name: "螺钿珍珠贝", family: "古典工艺",
    note: "珍珠虹彩的浅色贝面，棋子泛起粉蓝珠光",
    board: "crystal", stone: "holo", motion: ["shimmer", "glow-breathe"], stoneMotion: ["liquid", "glow-soft"],
    vars: { "bd-1": "#E9EDF2", "bd-2": "#C9D7E3", "ln": "#97A8B899", "star": "#97A8B8", "s-black": "#2A2F3A", "s-black-2": "#5A6478", "s-white": "#FDFEFF", "glow": "#F3B6D2" }
  },
  {
    name: "浮世绘浪", family: "手作纸本",
    note: "和纸底上普鲁士蓝浪头，朱印落款似的暖点",
    board: "paper", stone: "matte", motion: ["drift"], stoneMotion: ["sway", "drop"],
    vars: { "bd-1": "#E8D5B7", "bd-2": "#DCC49B", "ln": "#2B211899", "star": "#2B2118", "s-black": "#1A1A1A", "s-black-2": "#4A4A4A", "s-white": "#F5EFE0", "glow": "#C0392B" }
  },
  {
    name: "琳派金箔", family: "手作纸本",
    note: "金箔碎光衬大和绘留白，落子如点翠",
    board: "gold", stone: "metal", motion: ["sweep", "shimmer"], stoneMotion: ["orbit", "glow-soft"],
    vars: { "bd-1": "#E9D8B4", "bd-2": "#D4BE8E", "ln": "#7A5C3A99", "star": "#C9A227", "s-black": "#232323", "s-black-2": "#5A5A5A", "s-white": "#F7F2E4", "glow": "#C9A227" }
  },
  {
    name: "敦煌剥落", family: "手作纸本",
    note: "土红赭石与青绿飘带，壁画斑驳处浮起细尘",
    board: "stone", stone: "clay", motion: ["dust", "drift-slow"], stoneMotion: ["drop", "breathe"],
    vars: { "bd-1": "#E8D5B0", "bd-2": "#D4B98A", "ln": "#8A4A2A99", "star": "#8A4A2A", "s-black": "#2A1E16", "s-black-2": "#5A3E2A", "s-white": "#F7EFDD", "glow": "#3E8A8A" }
  },
  {
    name: "蓝染深靛", family: "手作纸本",
    note: "靛蓝层层浸染，扎染留白如云隙透气",
    board: "linen", stone: "velvet-stone", motion: ["haze", "drift-slow"], stoneMotion: ["breathe", "drop"],
    vars: { "bd-1": "#E4EAF0", "bd-2": "#C6D4E0", "ln": "#1E3A5F99", "star": "#1E3A5F", "s-black": "#0C1B2A", "s-black-2": "#33506E", "s-white": "#F5F8FB", "glow": "#7FA8C9" }
  },
  {
    name: "扎染晕圈", family: "手作纸本",
    note: "紫调同心晕圈缓缓扩散，云纹棋子轻浮",
    board: "mesh", stone: "cloud", motion: ["bloom", "drift-slow"], stoneMotion: ["breathe", "sway"],
    vars: { "bd-1": "#EDE6F2", "bd-2": "#D8CCE6", "ln": "#5B4B8A99", "star": "#5B4B8A", "s-black": "#1A1428", "s-black-2": "#4A3E6B", "s-white": "#FAF7FF", "glow": "#7FD1E0" }
  },
  {
    name: "景泰蓝", family: "古典工艺",
    note: "深蓝珐琅嵌金丝，棋子似玻璃滴釉透亮",
    board: "chrome", stone: "glass", motion: ["shimmer", "sweep"], stoneMotion: ["echo", "sparkle"],
    vars: { "bd-1": "#1B4F8A", "bd-2": "#0D2340", "ln": "#C9A22799", "star": "#C9A227", "s-black": "#071A30", "s-black-2": "#2E5A8F", "s-white": "#F2F7FC", "glow": "#2E8A6B" }
  },
  {
    name: "泥金手抄本", family: "手作纸本",
    note: "羊皮纸上金箔与红蓝泥金，光在字口呼吸",
    board: "paper", stone: "paper", motion: ["glow-breathe"], stoneMotion: ["glow-soft", "drop"],
    vars: { "bd-1": "#EFE2C4", "bd-2": "#DCC9A0", "ln": "#3A2E1E99", "star": "#C9A227", "s-black": "#1E1810", "s-black-2": "#4A3E2A", "s-white": "#FBF5E4", "glow": "#C9A227" }
  },
  {
    name: "水墨飞白", family: "手作纸本",
    note: "生宣冷灰底，飞白笔触干涩地带出枯墨",
    board: "ink", stone: "ink", motion: ["inkspread", "dust"], stoneMotion: ["sway", "breathe"],
    vars: { "bd-1": "#F4F3EE", "bd-2": "#E2E0D6", "ln": "#6B6A6073", "star": "#6B6A60", "s-black": "#131313", "s-black-2": "#4A4A4A", "s-white": "#FAFAF7", "glow": "#8A8A82", "line-filter": "blur(.4px)" }
  },
  {
    name: "影青宋瓷", family: "东方器物",
    note: "青白瓷薄胎透光，淡青釉上水光轻轻晃",
    board: "porcelain", stone: "ceramic", motion: ["glow-breathe", "caustics"], stoneMotion: ["glow-soft", "breathe"],
    vars: { "bd-1": "#EDF4F2", "bd-2": "#CFE2DD", "ln": "#6E9A9099", "star": "#6E9A90", "s-black": "#1E3833", "s-black-2": "#4A6E66", "s-white": "#FBFEFD", "glow": "#A8CFC5" }
  },
  {
    name: "碑帖拓片", family: "手作纸本",
    note: "浓墨拓底浮出白字口，石花斑驳带粗粝感",
    board: "carbon", stone: "ink", motion: ["dust", "drift-slow"], stoneMotion: ["drop", "glow-soft"],
    vars: { "bd-1": "#2A2A2A", "bd-2": "#3A3A38", "ln": "#9A958C66", "star": "#C9C4B8", "s-black": "#0A0A0A", "s-black-2": "#4A4A48", "s-white": "#E8E4DA", "glow": "#C9C4B8", "grain-opacity": ".55" }
  },
  {
    name: "良渚玉琮", family: "东方器物",
    note: "岫岩玉沁色斑驳，神人兽面纹含蓄生光",
    board: "jade", stone: "gem", motion: ["drift-slow", "glow-breathe"], stoneMotion: ["breathe", "orbit"],
    vars: { "bd-1": "#C9D6B8", "bd-2": "#A8BC96", "ln": "#5A6B4899", "star": "#5A6B48", "s-black": "#24301C", "s-black-2": "#4A5C3A", "s-white": "#F2F7EA", "glow": "#D9C98A" }
  },
  {
    name: "云雷纹青铜", family: "东方器物",
    note: "亮绿铜锈刻云雷回转，棋子映出冷冷金属光",
    board: "bronze", stone: "metal", motion: ["sweep", "swirl"], stoneMotion: ["orbit", "echo"],
    vars: { "bd-1": "#4A5C46", "bd-2": "#2E3D2A", "ln": "#A8D9BC80", "star": "#8FE0C0", "s-black": "#101810", "s-black-2": "#3E5C46", "s-white": "#DCEEDC", "glow": "#8FE0C0" }
  },
  {
    name: "洒金宣", family: "手作纸本",
    note: "米黄宣纸上洒金细屑，落子时金粉微微闪",
    board: "sand", stone: "matte", motion: ["twinkle", "shimmer"], stoneMotion: ["drop", "sparkle"],
    vars: { "bd-1": "#F0E8D4", "bd-2": "#DCCDA8", "ln": "#7A6A4A66", "star": "#D4AF37", "s-black": "#1C1810", "s-black-2": "#4A4234", "s-white": "#FBF6E8", "glow": "#D4AF37", "grain-opacity": ".45" }
  }
];
