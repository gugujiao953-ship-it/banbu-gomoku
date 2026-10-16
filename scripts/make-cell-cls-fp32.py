#!/usr/bin/env python
"""把 cell-cls 从纯 fp16 改成 fp32，并做等价性与提速验证（2026-10-08）。

动机（实测）：cell-cls 逐格在浏览器 ORT-Web wasm 上 13.0ms/格，而同一份模型在 Python
原生 ORT 上 1.1ms/格——差 12 倍；批量在 ORT-Web 里完全没有收益（1.0×）。図は純 fp16
（全初始器 dtype=FLOAT16，结构：fp32 输入 → Cast fp16 → 卷积链 → Cast fp32 → 输出），
ORT-Web 的 wasm 后端没有原生 fp16 计算只能软件模拟，所以按样本线性地慢。

本脚本只改精度、不动数值：fp16 初始器逐个 astype 成 fp32；value_info 的 elem_type 改 1；
第一个 Cast（to=10）改成 to=1（即 no-op）。然后：
  * Python 侧：逐格 fp16 原模型 vs 逐格 fp32 新模型，比对 argmax 与最大绝对差；
  * 浏览器侧（另脚本）：同一批 225 格分别计时。

用法：python scripts/make-cell-cls-fp32.py
产物：public/models/cell-cls-real-mix-fp32.onnx（先写候选，验证过再决定替换）
"""
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "public" / "models" / "cell-cls-real-mix.onnx"
# ⚠ 输出写到 qa/recover/，**不写进 public/models**：实验产物不该混进随包资产。
CANDIDATE = REPO / "qa" / "recover" / "cell-cls-real-mix-fp32.onnx"
FLOAT, FLOAT16 = onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16


def main() -> None:
    model = onnx.load(str(SOURCE))
    graph = model.graph
    # ① 初始器 fp16 → fp32
    converted = 0
    for index, initializer in enumerate(graph.initializer):
        if initializer.data_type == FLOAT16:
            array = numpy_helper.to_array(initializer).astype(np.float32)
            graph.initializer[index].CopyFrom(numpy_helper.from_array(array, initializer.name))
            converted += 1
    # ② 中间张量声明
    for value in list(graph.value_info) + list(graph.input) + list(graph.output):
        if value.type.tensor_type.elem_type == FLOAT16:
            value.type.tensor_type.elem_type = FLOAT
    # ③ 第一个 Cast（fp32 → fp16）改成 no-op；第二个（fp16 → fp32）本来就对
    casts = 0
    for node in graph.node:
        if node.op_type != "Cast":
            continue
        for attribute in node.attribute:
            if attribute.name == "to" and attribute.i == FLOAT16:
                attribute.i = FLOAT
                casts += 1
    print(f"初始器转换 {converted} 个，Cast 改为 no-op {casts} 个")
    onnx.save(model, str(CANDIDATE))
    print(f"候选：{CANDIDATE}（{CANDIDATE.stat().st_size / 1e6:.2f}MB，原 {SOURCE.stat().st_size / 1e6:.2f}MB）")

    # 等价性：同输入下 fp16 原版 vs fp32 新版
    rng = np.random.default_rng(20261008)
    x = (rng.random((8, 3, 64, 64), dtype=np.float32) * 2 - 1).astype(np.float32)
    a = ort.InferenceSession(str(SOURCE), providers=["CPUExecutionProvider"])
    b = ort.InferenceSession(str(CANDIDATE), providers=["CPUExecutionProvider"])
    name_a = a.get_inputs()[0].name
    name_b = b.get_inputs()[0].name
    # 两份模型的输入批维都固定为 1（应用本来就是逐格跑；批量已在浏览器实测无收益），
    # 所以两边都逐格喂，比对的是**精度差异**而非批处理。
    ya = np.concatenate([a.run(None, {name_a: x[i : i + 1]})[0] for i in range(x.shape[0])], axis=0)
    yb = np.concatenate([b.run(None, {name_b: x[i : i + 1]})[0] for i in range(x.shape[0])], axis=0)
    print(f"逐格输出：fp16 {ya.shape} vs fp32 {yb.shape}；最大绝对差 {np.abs(ya - yb).max():.6f}")
    print(f"类别 argmax 一致率：{(ya.argmax(axis=1) == yb.argmax(axis=1)).mean() * 100:.1f}%")
    # 概率层面的差异（pEmpty/pBlack/pWhite 的比较门控用得到）
    sa = np.exp(ya - ya.max(axis=1, keepdims=True)); sa /= sa.sum(axis=1, keepdims=True)
    sb = np.exp(yb - yb.max(axis=1, keepdims=True)); sb /= sb.sum(axis=1, keepdims=True)
    print(f"softmax 概率最大绝对差：{np.abs(sa - sb).max():.6f}")


if __name__ == "__main__":
    main()
