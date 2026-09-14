/* 棋盘外观探索 · C 批 20 套（自然地质 / 宇宙光影 / 材质实验）
 *
 * 规范见 SPEC.md；类名只取棋盘材质 / 棋子质感 / 动效清单内。
 * 与 core 及 A/B 批不重复组合：本批 20 个 board 均为本批内唯一。
 */
window.BOARD_THEMES_C = [
  {
    name: "极光带", family: "宇宙光影",
    note: "深空的绿紫光幕缓缓翻涌，棋子像等离子体般发亮",
    board: "aurora", stone: "plasma", motion: ["aurora", "pulse-grid"], stoneMotion: ["breathe", "glow-soft"],
    vars: { "bd-1": "#08172b", "bd-2": "#1a1548", "ln": "#a5b4fc66", "star": "#a78bfa", "s-black": "#02050f", "s-black-2": "#4a3a8c", "s-white": "#eafdf8", "glow": "#7b61ff" }
  },
  {
    name: "星云团", family: "宇宙光影",
    note: "紫粉蓝的气体云层层堆叠，棋子披着一层虹彩",
    board: "nebula", stone: "holo", motion: ["haze"], stoneMotion: ["hover-stone", "glow-soft"],
    vars: { "bd-1": "#0e0826", "bd-2": "#2c1a56", "ln": "#4a2e7a88", "star": "#ff5c8a", "s-black": "#04020e", "s-black-2": "#5a3a9e", "s-white": "#f2eaff", "glow": "#ff5c8a" }
  },
  {
    name: "银河旋臂", family: "宇宙光影",
    note: "银道横贯、星点密布，棋子像凝结的星核",
    board: "star", stone: "gem", motion: ["twinkle"], stoneMotion: ["sparkle", "orbit"],
    vars: { "bd-1": "#0a0824", "bd-2": "#241c58", "ln": "#2e2a6b99", "star": "#f0eeff", "s-black": "#02020c", "s-black-2": "#4a3fa0", "s-white": "#f0eeff", "glow": "#a56bff" }
  },
  {
    name: "深海浮游", family: "自然地质",
    note: "近黑海水里浮游生物泛着青光，缓缓升起",
    board: "ocean", stone: "neon", motion: ["float"], stoneMotion: ["hover-stone", "glow-soft"],
    vars: { "bd-1": "#02070f", "bd-2": "#0a2c40", "ln": "#06303f99", "star": "#35ffd0", "s-black": "#000206", "s-black-2": "#0e5a6b", "s-white": "#dffbff", "glow": "#35ffd0" }
  },
  {
    name: "珊瑚礁", family: "自然地质",
    note: "深青水下水磨石般的珊瑚碎屑，棋子带贝母光",
    board: "terrazzo", stone: "pearl", motion: ["drift"], stoneMotion: ["breathe", "sway"],
    vars: { "bd-1": "#0a2a33", "bd-2": "#175a66", "ln": "#2e7a85b3", "star": "#ff6b5c", "s-black": "#04161c", "s-black-2": "#2e7a85", "s-white": "#eaf7f7", "glow": "#ff6b5c" }
  },
  {
    name: "云海", family: "自然地质",
    note: "白云像絮层层铺开，暖阳光斑缓缓游移",
    board: "velvet", stone: "candy", motion: ["float"], stoneMotion: ["hover-stone", "breathe"],
    vars: { "bd-1": "#d8e4ee", "bd-2": "#a8c0d6", "ln": "#7e97acc0", "star": "#ffc93c", "s-black": "#26313e", "s-black-2": "#5a6a7a", "s-white": "#fffdf6", "glow": "#ffc93c" }
  },
  {
    name: "日蚀", family: "宇宙光影",
    note: "近黑圆盘悬在金色日冕里，光环缓缓呼吸",
    board: "gold", stone: "obsidian", motion: ["shimmer"], stoneMotion: ["orbit", "charge"],
    vars: { "bd-1": "#100e1c", "bd-2": "#241a34", "ln": "#4a3a52cc", "star": "#ffb347", "s-black": "#030308", "s-black-2": "#5a4020", "s-white": "#f7e8d0", "glow": "#ffb347" }
  },
  {
    name: "霜花结晶", family: "自然地质",
    note: "六角霜花在冷白冰面上生长，晶光细细闪烁",
    board: "crystal", stone: "crystal", motion: ["twinkle"], stoneMotion: ["breathe", "sparkle"],
    vars: { "bd-1": "#e8f2f8", "bd-2": "#96bfd8", "ln": "#6e96b2cc", "star": "#4a7a9e", "s-black": "#1e3040", "s-black-2": "#4a7a9e", "s-white": "#f7fcff", "glow": "#c9e8ff" }
  },
  {
    name: "沙漠星夜", family: "宇宙光影",
    note: "深蓝夜穹缀满星子，沙丘在月光下起伏",
    board: "blueprint", stone: "metal", motion: ["twinkle", "pulse-grid"], stoneMotion: ["sparkle", "breathe"],
    vars: { "bd-1": "#1a1e3a", "bd-2": "#241e4a", "ln": "#4a4a8aa6", "star": "#ffd98a", "s-black": "#0a0c1c", "s-black-2": "#3a3a72", "s-white": "#f5f0e0", "glow": "#ffd98a" }
  },
  {
    name: "流体大理石", family: "材质实验",
    note: "粉紫奶油的流体漩涡，被凝在漆面之下",
    board: "mesh", stone: "chrome", motion: ["swirl"], stoneMotion: ["liquid", "orbit"],
    vars: { "bd-1": "#f2ede6", "bd-2": "#d2bebc", "ln": "#8a7a8aaa", "star": "#c9a227", "s-black": "#2a2430", "s-black-2": "#6a5a66", "s-white": "#ffffff", "glow": "#c9a227" }
  },
  {
    name: "树脂海洋", family: "材质实验",
    note: "环氧树脂浇出层叠海浪，白沫凝成半透的玉",
    board: "lacquer", stone: "jade", motion: ["glow-breathe"], stoneMotion: ["breathe", "glow-soft"],
    vars: { "bd-1": "#0b3c5d", "bd-2": "#062a40", "ln": "#7fd3e099", "star": "#4fe3c1", "s-black": "#04161f", "s-black-2": "#2e7a9e", "s-white": "#eaf9ff", "glow": "#4fe3c1" }
  },
  {
    name: "卡拉拉大理石", family: "材质实验",
    note: "冷白大理石上灰纹如闪电，棋子似打磨过的玉",
    board: "marble", stone: "ceramic", motion: ["drift-slow"], stoneMotion: ["breathe"],
    vars: { "bd-1": "#f2f1ee", "bd-2": "#bab7aa", "ln": "#8a8a8ab8", "star": "#c7a96b", "s-black": "#1e1e20", "s-black-2": "#5a5a5e", "s-white": "#fcfcff", "glow": "#c7a96b" }
  },
  {
    name: "雾面玻璃", family: "材质实验",
    note: "冷调磨砂玻璃透着朦胧光，棋子安静而柔和",
    board: "ice", stone: "cloud", motion: ["twinkle"], stoneMotion: ["glow-soft", "hover-stone"],
    vars: { "bd-1": "#dce7f0", "bd-2": "#a9c0d6", "ln": "#7e97adcc", "star": "#3a4a5c", "s-black": "#2b323c", "s-black-2": "#5a6472", "s-white": "#fbfdff", "glow": "#7fd8f7" }
  },
  {
    name: "清水混凝土", family: "材质实验",
    note: "工业毛坯的灰与气孔，一道施工橙线划破沉默",
    board: "stone", stone: "matte", motion: ["drift-slow", "pulse-grid"], stoneMotion: ["drop", "echo"],
    vars: { "bd-1": "#b8b6b0", "bd-2": "#96938b", "ln": "#6e6c67d9", "star": "#e8552f", "s-black": "#1f1f1e", "s-black-2": "#4a4a48", "s-white": "#edece9", "glow": "#e8552f" }
  },
  {
    name: "苔原苔藓", family: "自然地质",
    note: "深绿绒面般的苔原，露珠在光里轻轻呼吸",
    board: "moss", stone: "velvet-stone", motion: ["drift-slow"], stoneMotion: ["breathe", "glow-soft"],
    vars: { "bd-1": "#2e3b24", "bd-2": "#445c33", "ln": "#6a8a4ab3", "star": "#9bc53d", "s-black": "#131a0e", "s-black-2": "#4a5c36", "s-white": "#eaf0dc", "glow": "#9bc53d" }
  },
  {
    name: "竹林叶影", family: "自然地质",
    note: "竹青底上叶影轻摇，木子温润如新削的竹节",
    board: "bamboo", stone: "wood-stone", motion: ["drift"], stoneMotion: ["sway", "breathe"],
    vars: { "bd-1": "#e3efd8", "bd-2": "#a8c894", "ln": "#4a6b3ecc", "star": "#c9a227", "s-black": "#1e2a18", "s-black-2": "#4a5c36", "s-white": "#fafdf3", "glow": "#c9a227" }
  },
  {
    name: "沙丘风纹", family: "自然地质",
    note: "暖沙上风刻出的弧线，一层层铺向天边",
    board: "sand", stone: "paper", motion: ["drift-slow"], stoneMotion: ["sway", "hover-stone"],
    vars: { "bd-1": "#e0b87a", "bd-2": "#c39a56", "ln": "#8a5f2ecc", "star": "#7a4a20", "s-black": "#2a1e12", "s-black-2": "#6a4a26", "s-white": "#fbf3e2", "glow": "#e8a05c" }
  },
  {
    name: "花筏", family: "自然地质",
    note: "落花浮在浅青水面上，棋子像被水汽托起",
    board: "sakura", stone: "glass", motion: ["drift"], stoneMotion: ["hover-stone", "sway"],
    vars: { "bd-1": "#f2f6f8", "bd-2": "#96bad0", "ln": "#8fa8b8cc", "star": "#c97a98", "s-black": "#3a3540", "s-black-2": "#6a6270", "s-white": "#fbfeff", "glow": "#f2b8c8" }
  },
  {
    name: "雨林湿地", family: "自然地质",
    note: "湿润深绿里光柱斜落，陶土棋子盛着一夜雨",
    board: "forest", stone: "clay", motion: ["haze"], stoneMotion: ["glow-soft", "echo"],
    vars: { "bd-1": "#10241a", "bd-2": "#1e4630", "ln": "#4a8a66b3", "star": "#8fe0a8", "s-black": "#061410", "s-black-2": "#2e6b4a", "s-white": "#e4f5ea", "glow": "#8fe0a8" }
  },
  {
    name: "雪原暮色", family: "自然地质",
    note: "冷白积雪映着暮紫天光，棋子泛起微彩",
    board: "chrome", stone: "pearl", motion: ["glow-breathe"], stoneMotion: ["glow-soft", "hover-stone"],
    vars: { "bd-1": "#e6ecf4", "bd-2": "#b6c2da", "ln": "#8a9ab4cc", "star": "#b07aa8", "s-black": "#2e3646", "s-black-2": "#5a6478", "s-white": "#fbfbff", "glow": "#e8a8c8" }
  }
];
