# iOS 网页版使用说明（Safari / 添加到主屏幕）

本文档说明在 iPhone / iPad 的 Safari 上使用「半步五子棋打谱」网页版，以及把它「添加到主屏幕」当作本地应用使用的步骤与已知限制。

网页版地址（应用本体部署在站点根的 `/app/` 子路径下）：

- **网页版（打开这个）**：<https://gugujiao953-ship-it.github.io/banbu-gomoku/app/>
- 站点首页（功能介绍与全部下载入口）：<https://gugujiao953-ship-it.github.io/banbu-gomoku/>

---

## 1. 用 Safari 打开

1. 在 iPhone / iPad 上打开 **Safari**（必须是 Safari；Chrome / 微信内置浏览器不支持「添加到主屏幕」的独立窗口模式）。
2. 地址栏输入上面的部署地址。
3. 首次打开需要联网：页面本身、Service Worker（`sw.js`）与图标都在这一次加载中一起装好。之后即使断网也能再次打开（见第 3 节）。

> 若你部署到自己的 GitHub Pages，请把上面的域名替换成你的实际地址；应用内所有资源都使用相对路径（Vite `base: "./"`），因此放在任意子路径下都可以正常工作。

## 2. 添加到主屏幕

1. 在 Safari 中打开应用页面，等待页面加载完成。
2. 点击底部的 **分享按钮**（方框 + 向上箭头）。
3. 在菜单中选择 **「添加到主屏幕」**。
4. 名称会默认显示为 **半步五子棋打谱**（来自 `index.html` 的 `apple-mobile-web-app-title`），可自行修改，然后点 **添加**。
5. 回到主屏幕，会出现应用图标（来自 `public/apple-touch-icon.png` 等 PNG，iOS 不支持 SVG 图标，所以这里用的是 PNG）。
6. 以后从主屏幕图标打开，会以 **独立窗口（全屏，无 Safari 地址栏）** 运行，而不是在浏览器标签页中打开。

## 3. 离线能力来自 Service Worker

- 网页版注册了 Service Worker：非 Capacitor 原生环境且浏览器支持 `serviceWorker` 时，页面加载完成后注册 `./sw.js`（见 `src/main.tsx`）。
- 该 Service Worker 由 `vite-plugin-pwa`（Workbox `generateSW`，`registerType: "autoUpdate"`）生成，会预缓存构建产物：`js / css / html / svg / json / gz / wasm / data / sgf / db / wav`。
- **至少成功联网打开过一次**，Service Worker 才会安装完成并具备离线能力。此后再断网打开，应用主体（打谱、做题、看棋谱）可离线使用。
- 注意：`apple-touch-icon*.png` 没有列进 Workbox 的 `globPatterns`（该列表只含 `js/css/html/svg/json/gz/wasm/data/sgf/db/wav`），所以不会进预缓存。这不影响使用——这些图标只在「添加到主屏幕」时由 iOS 抓取一次并自行存档，应用运行时不请求它们。
- `engine-packs/**` 被 Workbox 显式排除（`globIgnores`），不会进预缓存（见下节）。

## 4. AI 引擎包需要应用内下载（网页版不含引擎包）

- 强引擎数据包 `rapfi-full-v3.data`（40,306,406 字节，约 38.4 MiB，版本 3）**不在 Git 仓库里**（`.gitignore` 第 57 行忽略了 `engine-packs/`，因此也忽略了 `public/engine-packs/`）。从仓库源码构建并部署的 GitHub Pages **不含引擎包**。
- 注意（已实测）：本机 `public/engine-packs/rapfi-full-v3.data` 是存在的，`vite build` 会把 `public/` 原样拷进产物（实测临时构建产物里出现 39MB 的 `engine-packs/`，而当前仓库的 `dist/` 里没有该目录）。所以**部署前请确认你上传的产物是否带上了这 39MB**：带上则同源直接可用，不带则走下面的远端下载。
- 网页版首次需要强 AI 时，会在应用内下载该包并缓存到浏览器（IndexedDB），下载来源依次为（`src/features/ai/engine-pack.ts` 的 `enginePackUrls()`）：
  1. 同源 `engine-packs/rapfi-full-v3.data`（相对当前页面 URL 解析；部署在 Pages 子路径下时会解析成该 Pages 地址）；
  2. `https://gugujiao953-ship-it.github.io/banbu-gomoku/engine-packs/rapfi-full-v3.data`；
  3. GitHub Releases：`.../releases/download/engine-pack-v3/rapfi-full-v3.data`（国内直连常不稳，仅兜底）。
- 下载受 iOS Safari 限制：**需要保持页面在前台并保持网络**，下载中断后应用内支持分块续传，但 iOS 可能在内存紧张时回收后台标签页。建议插电、连 Wi-Fi 后一次性下完。
- 提示：iOS 上 Safari 长期不访问站点时可能清理其存储（包括 Service Worker 与 IndexedDB），届时需要重新下载引擎包。用「添加到主屏幕」后从主屏幕图标启动，被系统清理的概率相对更低，但**未验证**具体保留时长。

## 5. 多线程 WASM 在 iOS 上的表现

- **当前代码不依赖多线程 WASM。** 仓库中没有任何 `crossOriginIsolated` 或 `SharedArrayBuffer` 的运行时判断与降级路径（全仓库仅 `vite.config.ts` 注释与 `src/zip.ts` 的注释提到过这两个词）。
- 随应用分发的引擎加载器 `public/rapfi/fallback/rapfi-single.js` 与 `public/rapfi/full/rapfi-single.js` 都是**单线程**构建：其中 `SharedArrayBuffer`、`pthread`、`crossOriginIsolated` 出现次数均为 0。
- `src/features/ai/engine-pack.ts` 明确注释：**多线程引擎资产管线已于 2026-09-12 移除**（原因是 App 内 blob MIME + WebView 无跨域隔离，multi 从未在真机生效）。
- 因此 iOS / GitHub Pages **不需要** COOP/COEP 响应头（这也正好绕开了 GitHub Pages 无法自定义响应头的限制）。棋力来自单线程 Rapfi + NNUE，能正常使用；相比桌面多线程会有速度差距，但这不是 iOS 特有的降级。
- 补充说明（历史背景，避免误判）：`vite.config.ts` 里为**本地 dev server** 设置了 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: credentialless`，那是给桌面开发时验证 RenLib WASM worker 用的。生产网页版页面本身不是 COEP 页面，**不受**该限制；RenLib 的经典 worker 在没有 COOP/COEP 的普通页面里可以正常创建。

## 6. 已知限制 / 未验证项

| 项目 | 说明 |
| --- | --- |
| iOS 版本要求 | 未验证。构建链含 `@vitejs/plugin-legacy`（目标 `Chrome >= 83`），iOS Safari 的兼容下限没有在本仓库实测过。建议 iOS 15 及以上。 |
| 主屏幕图标 | iOS 会把 `apple-touch-icon` 再做一次圆角遮罩；本仓库的 PNG 已把图标原本的透明圆角压平到图标底色上，避免透明区域变黑。 |
| 状态栏样式 | `apple-mobile-web-app-status-bar-style` 取 `default`（状态栏文字随系统深浅色自适应）。应用同时有浅色与 dark 主题，`black-translucent` 会强制白色文字、在浅色顶栏上不可读，故未采用。 |
| 安全区域 | `index.html` 已含 `viewport-fit=cover`，样式里多处使用 `env(safe-area-inset-*)`（顶栏、底部导航、抽屉、弹层等），刘海/Home Indicator 区域已处理。 |
| 安装提示 | iOS 不提供自动的「安装应用」横幅，只能按第 2 节手动「添加到主屏幕」。 |
| 存储清理 | iOS 可能在长期不使用后清理站点数据，导致引擎包与本地记录丢失。 |
