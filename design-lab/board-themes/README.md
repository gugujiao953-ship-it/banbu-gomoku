# 棋盘外观探索画廊（100 个动效主题）

独立的设计沙盒：**不属于软件构建产线**，不参与 `npm run build`，也不影响应用预览。
用途是在 100 套「棋盘材质 + 棋子质感 + 动效 + 配色」方案里挑选软件下一步的外观方向。

## 打开方式

- **最快**：直接双击 `gallery.html`（纯静态、无外部依赖、classic script，`file://` 下可正常渲染）。
- 或起静态服务器（推荐，便于手机同 Wi-Fi 查看）：
  ```bash
  cd design-lab/board-themes
  python -m http.server 8099
  # 浏览器打开 http://localhost:8099/gallery.html
  ```

页面顶部可按风格族筛选、切换页面底色、一键关闭全部动效；**点击任意卡片**会放大到 15 路棋盘细看（Esc 或点背景关闭）。

## 文件结构

| 文件 | 作用 |
|---|---|
| `gallery.html` | 画廊引擎：材质库（`bd-*`）、棋子质感库（`st-*`）、动效库（`mo-*`）、渲染器、筛选与放大预览 |
| `themes-core.js` | 核心 20 套（schema 与质量基线） |
| `themes-batch-a.js` | 东方器物 / 手作纸本 / 古典工艺 20 套 |
| `themes-batch-b.js` | 赛博未来 / 数字终端 / 游戏世界 20 套 |
| `themes-batch-c.js` | 自然地质 / 宇宙光影 / 材质实验 20 套 |
| `themes-batch-d.js` | 艺术流派 / 印刷复刻 / 玩趣材质 20 套 |
| `SPEC.md` | 主题数据规范：字段、可用类名清单、质量红线 |
| `gallery-check.cjs` | 渲染体检：卡片数、棋子尺寸、动效存在性、自适应描边统计 + 截图 |
| `palette-check.cjs` | 配色体检：棋盘底与黑白子/网格线的对比度 |

## 一套主题长什么样

```js
{
  name: "青花御瓷", family: "东方器物",
  note: "釉下钴蓝晕染的瓷面，棋子如珠，光晕缓缓呼吸",
  board: "porcelain", stone: "ceramic",
  motion: ["glow-breathe"], stoneMotion: ["orbit", "drop"],
  vars: { "bd-1": "#f4f8fd", "bd-2": "#c8dbee", "ln": "#3f6ea5aa",
          "star": "#35618f", "s-black": "#17304d", "s-black-2": "#4d7aa8",
          "s-white": "#fbfdff", "glow": "#6fa6dd" }
}
```

组合逻辑：**棋盘材质**（40+ 种）× **棋子质感**（23 种）× **棋盘动效**（19 种）× **棋动效**（11 种）× 配色。

## 自适应描边（重要机制）

深色棋盘上黑子会「融进底色」，浅色棋盘上白子同理。渲染器会实时计算棋子与棋盘底的对比度：

- 黑子对比度 < 2.6 → 自动加一圈**亮描边**（颜色优先取主题的 `glow`）
- 白子对比度 < 1.45 → 自动加一圈**暗描边**

所以数据里可以放心用低对比配色，画面不会糊。跑 `gallery-check.cjs` 可看到当前有多少棋子触发了描边。

## 体检命令

```bash
cd design-lab/board-themes
node gallery-check.cjs      # 渲染体检 + 截图（输出到 %TEMP%/gallery-*.png）
node palette-check.cjs      # 配色对比度体检
```

## 后续扩展

- 加主题：往任意 `themes-batch-*.js` 里追加条目（字段见 `SPEC.md`），刷新页面即可。
- 加材质/质感/动效：在 `gallery.html` 对应区块新增一个 `bd-*` / `st-*` / `mo-*` 类，然后在 `SPEC.md` 的清单里登记。
- 选中方案落地到软件时：主题数据可直接映射为 CSS 变量，棋盘 SVG 结构与软件现有现实一致（网格线 / 星位 / 棋子三层）。
