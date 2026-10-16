#!/usr/bin/env python
"""把 cell-cls 的 ONNX 输入第一维改成符号维（动态批），并做等价性验证。

动机（2026-10-08 实测）：导入路径里 cell-cls 逐格 225 次调用，每格 13ms，而**裁剪+张量
构造的开销在噪声内（±0.09ms/格）**——也就是说这 13ms 全是 ONNX 推理的**每次调用固定
开销**（JS↔wasm 边界、张量分配、session.run 记账），不是算力。批量跑能把 225 次调用压到
15 次左右。

模型权重来自集群（本地没有 .pt，无法从 checkpoint 重导出），所以只改图的**元数据**：
输入张量的第一维从固定 1 改成符号维 N。权重一个字节不动。

本脚本只写候选文件到 qa/ 下，并打印等价性验证结果；是否替换 public/models 下的资产由
人看过数字后决定。

用法：python scripts/make-cell-cls-batchable.py
"""
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "public" / "models" / "cell-cls-real-mix.onnx"
CANDIDATE = REPO / "qa" / "recover" / "cell-cls-batchable.onnx"


def describe(model: onnx.ModelProto) -> None:
    for value in model.graph.input:
        dims = [d.dim_value if d.HasField("dim_value") else d.dim_param or "?" for d in value.type.tensor_type.shape.dim]
        print(f"  输入 {value.name}: {dims}")
    for value in model.graph.output:
        dims = [d.dim_value if d.HasField("dim_value") else d.dim_param or "?" for d in value.type.tensor_type.shape.dim]
        print(f"  输出 {value.name}: {dims}")


def main() -> None:
    model = onnx.load(str(SOURCE))
    print("原模型：")
    describe(model)
    if len(model.graph.input) != 1:
        print(f"输入不是 1 个（{len(model.graph.input)}），脚本按单输入写的，先确认再改。")
        return
    # 输入与输出都要改：ORT 导出的这份模型输出也写着 [1, 3]，只改输入会出现
    # 「图声明的输出批维是 1、实际拿到 N」的不一致。
    for value in list(model.graph.input) + list(model.graph.output):
        dim = value.type.tensor_type.shape.dim[0]
        if dim.HasField("dim_value") and dim.dim_value != 1:
            print(f"{value.name} 第一维不是 1（{dim.dim_value}），跳过。")
            continue
        dim.ClearField("dim_value")
        dim.dim_param = "N"
    print("改后：")
    describe(model)
    # 注意：onnx.checker 会抱怨「节点未按拓扑排序」——这是该导出器（ORT 侧）的既有特征，
    # 与本次元数据改动无关；真正的权威是 onnxruntime 能不能跑、结果是否一致，见下面。
    CANDIDATE.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(CANDIDATE))
    print(f"候选文件：{CANDIDATE}（{CANDIDATE.stat().st_size} 字节）")

    # 等价性：批量一次 vs 逐格 N 次
    rng = np.random.default_rng(20261008)
    batch = 8
    x = (rng.random((batch, 3, 64, 64), dtype=np.float32) * 2 - 1).astype(np.float32)
    original = ort.InferenceSession(str(SOURCE), providers=["CPUExecutionProvider"])
    patched = ort.InferenceSession(str(CANDIDATE), providers=["CPUExecutionProvider"])
    single_name = original.get_inputs()[0].name
    batch_name = patched.get_inputs()[0].name
    singles = np.concatenate([original.run(None, {single_name: x[i : i + 1]})[0] for i in range(batch)], axis=0)
    batched = patched.run(None, {batch_name: x})[0]
    diff = np.abs(singles - batched)
    print(f"逐格 {batch} 次 vs 批量 1 次：最大绝对差 {diff.max():.6f}，平均 {diff.mean():.6f}")
    # argmax（softmax 后的类别）必须完全一致
    agree = (singles.argmax(axis=1) == batched.argmax(axis=1)).mean()
    print(f"类别 argmax 一致率：{agree * 100:.1f}%（逐格 output shape {singles.shape}，批量 {batched.shape}）")
    print("结论：" + ("可替换（argmax 全一致）" if agree == 1.0 else "**不可替换**（类别有分歧）"))


if __name__ == "__main__":
    sys.exit(main())
