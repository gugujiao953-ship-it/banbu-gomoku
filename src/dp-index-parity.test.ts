import { describe, expect, it } from "vitest";

import { DpStateIndex, dpCanonicalKey, parseDpDatabaseStates } from "./formats";

/**
 * 索引换实现时的语义钉（2026-10-03）：新实现是「零拷贝视图 + 哈希桶」，
 * 但对外必须和原来的 `Map<string, DpState>` 一模一样，否则大库读出来的东西会悄悄变。
 * 真实文件的逐字节指纹另有一支脚本对（12 份 .db），这里钉的是指纹覆盖不到的边角语义。
 */

const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));

/** 按 DP 的记录布局拼一份小库：u32 条数 + 每条 [键长][键][记录长][记录]。 */
const buildDatabase = (entries: Array<{ key: number[]; comment: string; extraHeader?: number[] }>) => {
  const bytes: number[] = [];
  const push32 = (value: number) => bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  const push16 = (value: number) => bytes.push(value & 0xff, (value >>> 8) & 0xff);
  push32(entries.length);
  for (const entry of entries) {
    const record = [...(entry.extraHeader || [0, 0, 0, 0, 0]), ...utf8(entry.comment)];
    push16(entry.key.length); bytes.push(...entry.key);
    push16(record.length); bytes.push(...record);
  }
  return Uint8Array.from(bytes);
};

const ROOT = [2, 15, 15];
const BLACK_H8 = [2, 15, 15, 7, 7];

describe("DP 紧凑索引的 Map 语义等价", () => {
  it("条数、按键取用、字节键与字符串键都取到同一条", () => {
    const states = parseDpDatabaseStates(buildDatabase([
      { key: ROOT, comment: "空局面" },
      { key: BLACK_H8, comment: "黑 H8" },
    ]));
    expect(states.size).toBe(2);
    expect(states.get(Uint8Array.from(ROOT))?.comment).toBe("空局面");
    expect(states.get("2,15,15")?.comment).toBe("空局面");
    expect(states.byKey(Uint8Array.from(BLACK_H8))?.comment).toBe("黑 H8");
    expect(states.byKey(Uint8Array.from([2, 15, 15, 1, 1]))).toBeUndefined();
  });

  it("同一个键出现两次：值取后者，位置按首次出现（与 Map.set 一致）", () => {
    const states = parseDpDatabaseStates(buildDatabase([
      { key: ROOT, comment: "第一次" },
      { key: BLACK_H8, comment: "黑 H8" },
      { key: ROOT, comment: "第二次" },
    ]));
    expect(states.size).toBe(2);
    expect(states.get(Uint8Array.from(ROOT))?.comment).toBe("第二次");
    expect([...states].map(([key]) => key)).toEqual(["2,15,15", "2,15,15,7,7"]);
  });

  it("非 15 路的键跳过；文件被截断时停在能读的地方而不是抛", () => {
    const states = parseDpDatabaseStates(buildDatabase([
      { key: [2, 19, 19, 1, 1], comment: "19 路" },
      { key: ROOT, comment: "空局面" },
    ]));
    expect(states.size).toBe(1);
    const truncated = Uint8Array.from([...buildDatabase([{ key: ROOT, comment: "空局面" }]), 9, 0]);
    expect(parseDpDatabaseStates(truncated).size).toBe(1);
  });

  it("行棋方按黑白子数差判定，与旧实现按格子数一致", () => {
    const states = parseDpDatabaseStates(buildDatabase([{ key: BLACK_H8, comment: "黑 H8" }]));
    const state = states.get(Uint8Array.from(BLACK_H8))!;
    expect(state.sideToMove).toBe(1);
    expect(state.position[7 * 15 + 7]).toBe(1);
    expect(state.key).toEqual(Uint8Array.from(BLACK_H8));
    // 规范键回环：由局面反推的键必须还能取回同一条（这是查询热路径唯一的入口）
    expect(states.byKey(dpCanonicalKey(state.position, 1).key)?.comment).toBe("黑 H8");
  });

  it("空索引（open 之前）不抛，只说没有", () => {
    const empty = new DpStateIndex(1);
    expect(empty.size).toBe(0);
    expect(empty.get(Uint8Array.from(ROOT))).toBeUndefined();
    expect([...empty]).toEqual([]);
  });

  it("常驻内存报得出来（用于「这台机器开不开得动」的判断）", () => {
    const states = parseDpDatabaseStates(buildDatabase([{ key: ROOT, comment: "空局面" }]));
    expect(states.residentBytes).toBeGreaterThan(0);
    expect(states.residentBytes).toBeLessThan(1024 * 1024);
  });
});
