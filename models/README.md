# AI 模型与变体（索引）

[English](#english) · [中文](#中文)

这个目录**只放索引，不放文件本体**：模型是构建产物/第三方权重，各自住在被代码直接读取的位置（移动它们会让打包与识别失效）。这里把每一个模型、它的变体、体积、来源与许可以表格列清楚，方便第一次看仓库的人一眼知道"这东西用的是什么网、多大、从哪来"。

## 中文

### KataGo（旗舰档，随 APK 分发）

| 文件 | 体积 | 用途 | 位置 | 来源与许可 |
|---|---|---|---|---|
| `distill-fp16.onnx` | 3.2MB | 有禁手（连珠）规则下的人机/分析小网 | `android/app/src/main/assets/engine-katago/` | KataGomo 作者蒸馏网 → 转 ONNX + fp16（见 `docs/` 与改造表 ONNX 线）；许可见同目录 `LICENSE-katagomo.txt` |
| `distill-freestyle-fp16.onnx` | 3.2MB | **无禁手**（标准五子棋）规则用的同一档小网 | 同上 | 同上（按规则换网，2026-10 补） |
| `zhizi-b24-int8.onnx` | 21.9MB | 「大网」档，更强更慢 | 同上 | 智子 b24 → **int8 静态量化**（同预算 1.95×、等预算对局持平） |
| `kata.cfg` | 4KB | KataGo 运行配置（线程、缓存等） | 同上 | 本项目维护 |

- 后端：ONNX Runtime Web / Android ONNX Runtime CPU，全部**本机运行**，不联网。
- 量化与精度变体的取舍（fp16 / int8、批量、线程）在改造表与 `RELEASE_NOTES.md` 的引擎各段有实测数字。

### 图片识谱（随网页资源分发）

| 文件 | 体积 | 用途 | 位置 |
|---|---|---|---|
| `cell-cls-real-mix.onnx` | 0.95MB | 逐格「占用 / 颜色」分类 | `public/models/` |
| `digit-head-combo46-fp16.onnx` | 2.67MB | 棋子序号（读号）识别，226 类 | `public/models/` |
| `ort-wasm-simd-threaded.wasm` 等 3 件 | 11.8MB | ONNX Runtime Web 运行时 | `public/ort/` |

### Rapfi（内置引擎，权重随 APK 分发）

| 文件 | 体积 | 用途 | 位置 |
|---|---|---|---|
| 4 × `mix9svq*.bin.lz4` | 38.5MB | NNUE 权重（连珠 / 标准 / 自由三套 × 黑白） | 由 `scripts/build-android-engine.mjs` 从官方数据包切片铺进 `android/app/src/main/assets/engine-native/`（大权重不入库） |
| `model210901.bin` · `model220723.bin` | 108KB | 经典模型（0.43.02 新格式） | **入库副本**在 `scripts/engine-native-overlay/`，打包时覆盖数据包里的旧格式版本 |
| `config.toml` | 6.6KB | 引擎参数（含 `advanced_stop_ratio = 0.90` 等调优针） | 同上，由构建脚本从数据包切出并按针表调优 |

### 变体的"单一真值"在哪

- **引擎参数针表**：`src/features/ai/engine-pack.ts` 的 `CONFIG_TUNE_NEEDLES`（网页版运行时改、APK 由构建脚本读同一张表）——两边不会再分叉。
- **原生引擎资产**：`scripts/build-android-engine.mjs`（切片 → 覆盖 → 调针 → 字节和自检）。
- **KataGo 两档切换**：`src/features/ai/kata-net.ts` + `android/.../NativeKataGoPlugin.java`。

---

## English

This folder is an **index only** — the model files themselves live where the code reads them (moving them would break packaging and recognition).

| Model | Size | Purpose | Location |
|---|---|---|---|
| `distill-fp16.onnx` | 3.2MB | Small net for the forbidden-move (Renju) rule | `android/app/src/main/assets/engine-katago/` |
| `distill-freestyle-fp16.onnx` | 3.2MB | Same tier for **freestyle** (no forbidden moves) | same |
| `zhizi-b24-int8.onnx` | 21.9MB | "Large net" tier — stronger, slower (int8 static quantization) | same |
| `cell-cls-real-mix.onnx` | 0.95MB | Per-cell occupancy/colour classifier used by image recognition | `public/models/` |
| `digit-head-combo46-fp16.onnx` | 2.67MB | Move-number (digit) reader, 226 classes | `public/models/` |
| ONNX Runtime Web (`ort-wasm-*`, 3 files) | 11.8MB | Runtime for the recognition models | `public/ort/` |
| Rapfi NNUE weights (4 × `mix9svq*.bin.lz4`) | 38.5MB | Built-in engine weights, sliced from the official pack at build time (not stored in git) | `android/app/src/main/assets/engine-native/` |
| Classical models + `config.toml` | ≈114KB | 0.43.02-format classical nets and engine parameters | tracked copies in `scripts/engine-native-overlay/` |

All engines run **on device**; no network is required for analysis. Third-party licenses: `LICENSE-katagomo.txt` (KataGo/KataGomo) and `THIRD-PARTY-NOTICES.md`.
