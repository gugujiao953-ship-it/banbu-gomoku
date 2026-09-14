# 落子实录音效来源与许可

`real-*.wav` 来自开源围棋训练软件 KaTrain 仓库（`katrain/sounds/stone1-5.wav`）：

- 来源：<https://github.com/kaorahi/katrain>
- 许可证：MIT（Copyright 2020 Sander Land and/or other authors of the content in that repository）

本项目按 MIT 要求保留上述版权与许可声明；随后做了如下处理（不改变许可）：

- 立体声混缩为单声道，44.1kHz 16-bit PCM；
- 掐去首尾静音，峰值归一化到 0.45（与合成音色的削波余量一致）。

五条录音不分黑白共用一个池：每次落子从池中随机挑一条并加轻微变速/音量抖动，避免连拍时机械感。
黑白不区分音色是用户明确要求——交替落子时变换音高会被听成"两种音效"。
