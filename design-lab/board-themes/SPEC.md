# 棋盘外观探索 · 主题数据 SPEC

本目录是一个**独立**的动效棋盘设计画廊（不属于软件构建产线）。目标：100 套「棋盘材质 + 棋子质感 + 动效 + 配色」方案，用于挑选软件下一步的外观方向。

## 你要产出的东西

一个 JS 文件，形如：

```js
window.BOARD_THEMES_X = [
  {
    name: "青花御瓷",                 // 中文名，2-6 字，准确且有画面感
    family: "东方器物",               // 风格族（同批内保持一致用词）
    note: "釉下钴蓝晕染的瓷面，棋子如珠，光晕缓缓呼吸",  // 一句话视觉描述，≤32 字
    board: "porcelain",              // 棋盘材质类（下方清单）
    stone: "ceramic",                // 棋子质感类（下方清单）
    motion: ["glow-breathe"],        // 棋盘子动效 1-2 个（下方清单，可留 []）
    stoneMotion: ["orbit", "drop"],  // 棋子动效 1-2 个（下方清单，可留 []）
    vars: {
      "bd-1": "#f4f8fd", "bd-2": "#c8dbee",   // 棋盘底色渐变两端（必填）
      "ln": "#3f6ea5aa",                       // 网格线（必填，建议带 alpha）
      "star": "#35618f",                       // 星位
      "s-black": "#17304d", "s-black-2": "#4d7aa8",  // 黑子主色 / 高光
      "s-white": "#fbfdff",                    // 白子主色
      "glow": "#6fa6dd"                        // 发光/强调色
    }
  },
  ...
];
```

可选高级键（用得少更好，避免堆砌）：
`"grain-opacity"` `"grain-blend"`（纹理层不透明度/混合模式，默认 .5 / overlay）、`"line-filter"`（如 `"blur(.4px)"`）、`"frame"` `"frame-w"`（棋盘外框线）、`"stone-scale"`（棋子占格比例，默认 .86）、`"pad"`（棋盘留白百分比，默认 6）

## 可用棋盘材质 `board`

| 类名 | 视觉 |
|---|---|
| `wood` / `wood-fine` | 木纹（粗木纹 / 细密木纹） |
| `bamboo` | 竹席编织横纹 |
| `paper` / `newsprint` | 手工纸颗粒 / 新闻纸横纹 |
| `riso` | 孔版双色网点（粉/蓝叠印） |
| `porcelain` | 瓷釉斜向高光 |
| `lacquer` | 大漆镜面高光 |
| `bronze` / `gold` / `chrome` | 青铜锈斑 / 金箔碎光 / 镀铬冷光泽 |
| `stone` / `marble` | 石粒噪点 / 大理石脉络 |
| `jade` | 玉的半透光晕 |
| `crystal` / `ice` | 棱镜切面 / 冰晶划痕 |
| `ink` | 水墨径向晕染 |
| `ocean` | 纵深水光 |
| `grid-neon` | 青粉双色霓虹网格 |
| `holo` | 全息彩虹膜 |
| `circuit` | 电路走线 |
| `pixel` | 8-bit 方格 |
| `blueprint` | 蓝图坐标网格 |
| `mesh` | 多点渐变网格 |
| `star` / `nebula` / `aurora` | 繁星 / 星云 / 极光带 |
| `lava` / `sand` / `moss` / `forest` | 熔岩裂纹 / 沙丘波纹 / 苔藓斑 / 林地暗绿 |
| `sakura` | 樱瓣 |
| `linen` / `silk` / `velvet` / `carbon` / `terrazzo` | 亚麻 / 绸缎 / 绒面 / 碳纤维 / 水磨石 |
| `kintsugi` | 金缮裂纹 |
| `artdeco` / `bauhaus` / `memphis` / `construct` | 装饰艺术斜线 / 包豪斯色块 / 孟菲斯点线 / 构成主义斜切 |
| `gradient-sunset` | 落日渐层 |

## 可用棋子质感 `stone`

`ceramic`（瓷高光）`matte`（哑光）`glass`（玻璃透光）`metal`（金属镜面）`jade`（玉）`neon`（霓虹发光）`ink`（墨点）`pearl`（珠母虹彩）`holo`（全息）`pixel`（像素方块）`ember`（余烬内发光）`crystal`（晶面）`chrome`（镀铬）`clay`（陶土）`paper`（折纸）`gem`（宝石星芒）`plasma`（等离子）`obsidian`（黑曜石）`cloud`（云雾）`candy`（糖霜）`velvet-stone`（绒面）`wood-stone`（木子）

## 可用动效

**棋盘 `motion`**：`drift` `drift-slow` `aurora` `twinkle` `ripple` `scan` `pulse-grid` `shimmer` `swirl` `haze` `snow` `inkspread` `flicker` `dust` `caustics` `sweep` `glow-breathe` `float` `bloom`

**棋子 `stoneMotion`**：`drop` `breathe` `orbit` `echo` `sparkle` `liquid` `sway` `charge` `hover-stone` `ripple-stone` `glow-soft`

## 质量要求（重要）

1. **黑子必须看得见**：深色棋盘底色（亮度低）上，`s-black` 不要贴着底色 —— 引擎会自动补一圈描边，但底色与黑子明度差越大越好看。
2. **白子必须看得见**：浅色底上 `s-white` 要偏白且有暖/冷偏移，不要和底色同色系同明度。
3. **网格线 `ln` 必须可辨**：不要用和底色几乎一样的颜色；建议带 40%–70% 透明度。
4. **同一批次内不要重复组合**：材质、棋子质感、配色至少有两项不同；配色要能一眼区分。
5. **深底/浅底都要有**：一批 20 个里大约 10 浅底 10 深底（或按族特征）。
6. **动效与气质匹配**：静雅主题用 `drift-slow`/`inkspread`/`breathe`，能量主题用 `flicker`/`charge`/`sparkle`；不要每条都堆两个动效。
7. 命名与描述用中文，简洁有画面感；`family` 用批次给定的族名。
8. **只使用上方清单里的类名**。若确需新材质/新动效，写在自己文件的注释里（`// TODO-ENGINE: ...`），不要修改 gallery.html。

## 自查

写完后逐个核对：`bd-1/bd-2/ln/star/s-black/s-white/glow` 是否齐全、是否 hex；`board`/`stone`/`motion`/`stoneMotion` 的类名是否都在清单内。
