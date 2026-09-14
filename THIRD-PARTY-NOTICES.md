# 第三方组件与许可

本项目**自身代码**以 MIT License 开放（见 `LICENSE`）。此外随包或随仓库分发下列第三方组件，
它们各自的权利与许可归原始权利人，条款不因本项目使用而改变。

## Rapfi（五子棋 AI 引擎，GPL-3.0）

- 上游仓库：<https://github.com/dhbloo/rapfi>（本项目随包构建基于 tag `250615`）
- 浏览器集成参考：<https://github.com/dhbloo/gomoku-calculator>
- 许可：**GNU General Public License v3.0**，正文见 [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt)；
  上游项目主页：<https://github.com/dhbloo/rapfi>
- 随包内容：`public/rapfi/fallback/`（单线程精简构建，含小型旧网络）与
  `public/rapfi/full/`（单线程 SIMD 完整强度构建，Emscripten 4.0.8、`USE_WASM_SIMD=ON`）。
  两处的 `NOTICE.txt` 记录了各自的构建配置、上游来源与数据包校验值。
- **不随包分发**：完整强度 NNUE 数据包（约 40.3MB）在应用内按需下载并保存在用户设备上；
  上游为官方 `rapfi.data` 包（<https://www.gomocalc.com/build/rapfi.data>，v3 起逐字节一致）。
- 再分发要求：GPL-3.0 要求随二进制一并提供许可正文与对应源码。许可正文已随仓库提供；
  源码以上游仓库对应 tag 为准。修改本目录内二进制并再分发时，请同时公开你的修改。

## 其他参考与致谢（不含其代码或二进制）

- **RenLib / SGF 生态、爱五子棋打谱**：打谱与库格式（`.lib`）的交互与格式参考。
- **SlowRenju 等公开项目**：AI 搜索思路参考。
- **开宝五子棋**：做题交互与题集格式的参考；相关兼容性审计见
  [`KAIBAO_REFERENCE_AUDIT.md`](KAIBAO_REFERENCE_AUDIT.md)（审计的反编译产物不随产品发布）。

## 数据与题库来源

- 内置棋谱与题库来源见仓库根目录各审计/说明文档；若某份数据集的再分发授权尚不明确，
  以该文档中的记录为准，必要时从分发物中移除。

---

如你是某项权利的权利人并认为本仓库的处理不妥，请通过仓库 Issue 联系，我们会及时调整或移除。
