# 半步五子棋打谱 Logo 方案

本轮先提供 5 套轻量、适合 Web/PWA/Android 的 SVG 资产，暂不替换当前正在使用的图标，等待选择后再合入正式图标链路。

预览：开发预览启动后打开 `/logo-options/preview.html`；也可以直接打开 `public/logo-options/preview.html`。

## 方案

- A `option-a-intersection.svg`：交叉落子。最接近棋盘语义，缩小到 32px 仍容易辨认。
- B `option-b-half-step.svg`：半步路径。品牌识别度最高，抽象表达“半步”与变化路径。
- C `option-c-seal.svg`：棋印。更稳重、适合工具型和研究型产品。
- D `option-d-dialogue.svg`：对话棋局。更偏陪练、教学和互动。
- E `option-e-inkstone.svg`：墨玉。更有高级感，适合深色主题和 Android 自适应图标。

## 资产约束

- 全部为内联几何 SVG，不依赖字体、网络图片或动画库。
- 当前 5 个文件合计体积很小，不会明显增加网页或 APK 包体。
- 选定后再生成 Android adaptive icon 的 foreground/background，并同步 `public/icon.svg`、PWA manifest 和顶栏品牌标记。
- 在正式替换前保留旧图标，便于回滚和对比安装效果。

## 当前建议

优先比较 A、B、E：A 最直观，B 最有品牌独特性，E 的 Android 图标表现通常最好。当前没有擅自选择其中一个作为正式图标。
