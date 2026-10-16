import { describe, expect, it } from "vitest";
import {
  ENGINE_MAX_BOARD_SIZE,
  KATA_MAX_BOARD_SIZE,
  boardSizeStrengthNotice,
  championWeightCoverage,
  engineSupportsBoardSize,
  kataFallsBackToRapfi,
  kataSupportsBoardSize,
} from "./board-size-support";

// 矩阵来自对实际 wasm 的实测（scripts/.tmp-boardsize-boundary.mjs /
// .tmp-boardsize-matrix.mjs）：5–22 路引擎吃 START，23 路起直接
// "ERROR Unsupported board size!"；冠军权重只有 freestyle 的 bsmix 与
// standard/renju 的 bs15 三种，所以覆盖范围就是这几条。
describe("engine board size support", () => {
  it("accepts 5-22 and rejects anything past the compile-time limit", () => {
    for (const size of [5, 9, 13, 15, 19, 21, 22]) expect(engineSupportsBoardSize(size)).toBe(true);
    for (const size of [0, 1, 4, 23, 25, 15.5, Number.NaN]) expect(engineSupportsBoardSize(size)).toBe(false);
    // 下限跟应用自己的最小路数一致，别让 1–4 路的怪数据混进引擎。
    expect(engineSupportsBoardSize(4)).toBe(false);
    expect(ENGINE_MAX_BOARD_SIZE).toBe(22);
  });

  it("KataGo 旗舰档只接受 15 路以内（二进制编译上限）", () => {
    // 二进制 version 自报 "Compiled to allow boards of size up to 15"；
    // 超限时 GTP 坐标都拼不出，App 选型阶段就要让位给 Rapfi。
    for (const size of [5, 9, 13, 15]) expect(kataSupportsBoardSize(size)).toBe(true);
    for (const size of [0, 4, 16, 19, 21, 22, 15.5, Number.NaN]) expect(kataSupportsBoardSize(size)).toBe(false);
    expect(KATA_MAX_BOARD_SIZE).toBe(15);
    // 旗舰档上限必须比 Rapfi 的更严（Rapfi 5–22），否则门控没有意义
    expect(KATA_MAX_BOARD_SIZE).toBeLessThan(ENGINE_MAX_BOARD_SIZE);
  });

  it("旗舰降级只在「明确不可用」或盘面超限时发生（探测未完成必须保持旗舰）", () => {
    // 回归（用户 09-26 报「katago 下每下一手都提示引擎未启动」）：
    // 探测是异步的（启动后 1.2/3/7/15 秒退避重试），把 undefined（还没探到）
    // 当成不可用，会在那段窗口里把用户选的 katago 静默换成 rapfi——katago 进程
    // 已经吃掉 850MB，rapfi 起不来，于是每手都报错。
    expect(kataFallsBackToRapfi(true, 15)).toBe(false);
    // **关键**：未探到（undefined）不得降级
    expect(kataFallsBackToRapfi(undefined, 15)).toBe(false);
    // 明确不可用 → 降级
    expect(kataFallsBackToRapfi(false, 15)).toBe(true);
    // 盘面超上限 → 降级（GTP 坐标都拼不出）
    expect(kataFallsBackToRapfi(true, 19)).toBe(true);
    expect(kataFallsBackToRapfi(undefined, 19)).toBe(true);
    // 不传盘面尺寸时只看可用性
    expect(kataFallsBackToRapfi(true)).toBe(false);
    expect(kataFallsBackToRapfi(undefined)).toBe(false);
    expect(kataFallsBackToRapfi(false)).toBe(true);
  });

  it("maps each size/rule pair to the weight the engine actually loads", () => {    // 15 路：三种规则都有专属权重（bs15 / bs15 黑白双权重）。
    expect(championWeightCoverage(15, "renju")).toBe("exact");
    expect(championWeightCoverage(15, "standard")).toBe("exact");
    expect(championWeightCoverage(15, "freestyle")).toBe("exact");
    // 13–22 路自由：吃 bsmix 混合尺寸权重。
    for (const size of [13, 17, 19, 22]) expect(championWeightCoverage(size, "freestyle")).toBe("mixed");
    // 非 15 路的有禁手/标准、以及 11 路以下：评估器整个禁用。
    expect(championWeightCoverage(19, "renju")).toBe("none");
    expect(championWeightCoverage(19, "standard")).toBe("none");
    expect(championWeightCoverage(9, "freestyle")).toBe("none");
    expect(championWeightCoverage(11, "renju")).toBe("none");
    expect(championWeightCoverage(23, "freestyle")).toBe("none");
  });
});

describe("board size strength notice", () => {
  it("stays silent on 15 boards, where the champion weights are size-specific", () => {
    expect(boardSizeStrengthNotice(15, "renju")).toBeNull();
    expect(boardSizeStrengthNotice(15, "freestyle")).toBeNull();
  });

  it("names the mixed-size weights for 13-22 freestyle boards", () => {
    const notice = boardSizeStrengthNotice(19, "freestyle");
    expect(notice).toContain("bsmix");
    expect(notice).toContain("19 路");
  });

  it("spells out the handcrafted-evaluation fallback for the rest", () => {
    const renju = boardSizeStrengthNotice(19, "renju");
    expect(renju).toContain("连珠（有禁手）");
    expect(renju).toContain("手工评估");
    const small = boardSizeStrengthNotice(9, "freestyle");
    expect(small).toContain("手工评估");
  });

  it("explains the hard limit above 22 instead of silently doing nothing", () => {
    const notice = boardSizeStrengthNotice(25, "freestyle");
    expect(notice).toContain("25");
    expect(notice).toContain(String(ENGINE_MAX_BOARD_SIZE));
  });
});
