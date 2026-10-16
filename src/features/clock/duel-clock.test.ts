import { describe, expect, it } from "vitest";
import {
  CLOCK_LOW_MS,
  CLOCK_PRESETS,
  CLOCK_PRESET_GROUPS,
  clockDisplaySlots,
  clockWinner,
  createClock,
  formatClockMs,
  isClockIdle,
  isClockOver,
  isLowOnTime,
  lowTimeSecond,
  pauseClock,
  remainingAt,
  remainingBothAt,
  flagBothClock,
  isClockDraw,
  resignClock,
  restartClock,
  resumeClock,
  switchClock,
  tickClock,
  DEFAULT_CLOCK_SETTINGS,
  type ClockSettings,
} from "./duel-clock";

/**
 * 棋钟是时间相关逻辑，手点几乎验不出问题（走慢两秒看不出来、超时边界更不可能手抓），
 * 所以这里把时间当参数传进去，逐个边界钉死。
 *
 * 一条容易忘的前提：**开局钟是停的**（用户 09-23 钦定「点一下才开始计时」）。
 * 所以凡是要验走时的用例，都得先按一下把钟启动起来——`press` 就是那一按。
 */

const fischer = (baseMs: number, incrementMs: number): ClockSettings => ({
  mode: "fischer",
  baseMs,
  incrementMs,
  delayMs: 10_000,
  readOffMs: 60_000,
  readOffPeriods: 3,
});

/** 布龙斯坦夹具：每手加回 min(用时, delayMs)。 */
const bronstein = (baseMs: number, delayMs: number): ClockSettings => ({
  mode: "bronstein",
  baseMs,
  incrementMs: 0,
  delayMs,
  readOffMs: 60_000,
  readOffPeriods: 3,
});

describe("按下开始（开局钟是停的）", () => {
  it("刚打开时两边的钟都是满的，且一秒都不走", () => {
    const clock = createClock(fischer(60_000, 0), "black", 0);
    expect(isClockIdle(clock)).toBe(true);
    // 摆着不动 10 分钟，还是满的——没按下去就不该扣时间。
    expect(remainingBothAt(clock, 10 * 60 * 1000)).toEqual({ black: 60_000, white: 60_000 });
  });

  it("先走方点一下才开始走时，按下之前的等待不算数", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    // 摆好设备过了 30 秒（商量事情/摆棋子）才按下开始。
    clock = switchClock(clock, "black", 30_000);
    expect(clock.runningSince).toBe(30_000);
    expect(isClockIdle(clock)).toBe(false);
    // 按下后走 5 秒才扣 5 秒：前面那 30 秒是白送的。
    expect(remainingAt(clock, "black", 35_000)).toBe(55_000);
  });

  it("第一次按只启动钟：不换手、不加秒、不算走了一手", () => {
    let clock = createClock(fischer(60_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 10_000);
    expect(clock.turn).toBe("black");
    expect(clock.moves).toEqual({ black: 0, white: 0 });
    expect(clock.remaining.black).toBe(60_000);
  });

  it("不是先走方时按不动（白方先按没用，钟还是停的）", () => {
    const clock = createClock(fischer(60_000, 0), "black", 0);
    expect(switchClock(clock, "white", 5_000)).toBe(clock);
    expect(isClockIdle(clock)).toBe(true);
  });

  it("钟没跑时不报时（一打开就滴滴响会吓到人）", () => {
    const clock = createClock(fischer(9_000, 0), "black", 0);
    expect(isLowOnTime(clock, "black", 100_000)).toBe(false);
    expect(lowTimeSecond(clock, 100_000)).toBeNull();
  });

  it("按下开始之后恢复成原来那套语义：换手 + 加秒 + 记手数", () => {
    let clock = createClock(fischer(60_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);      // 按下开始
    clock = switchClock(clock, "black", 2_000);  // 走完一手交出去
    expect(clock.turn).toBe("white");
    expect(clock.moves.black).toBe(1);
    expect(clock.remaining.black).toBe(88_000);
  });

  it("重开一局也回到「等按下」的状态（不是直接就跑）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = restartClock(clock, "black", 100_000);
    expect(isClockIdle(clock)).toBe(true);
    expect(remainingAt(clock, "black", 200_000)).toBe(60_000);
  });
});

describe("菲舍尔加秒", () => {
  it("开局两个钟都是满的，且轮走方开始走时", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    expect(remainingBothAt(clock, 0)).toEqual({ black: 60_000, white: 60_000 });
    clock = switchClock(clock, "black", 0);      // 按下开始
    // 走了 5 秒后，只有轮走方在减少。
    expect(remainingBothAt(clock, 5_000)).toEqual({ black: 55_000, white: 60_000 });
  });

  it("落一手加固定秒数，剩余时间可以增长（与布龙斯坦延时的本质区别）", () => {
    let clock = createClock(fischer(60_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);      // 按下开始
    // 黑方只用 2 秒就落子 → 60 − 2 + 30 = 88 秒，比开局还多。
    clock = switchClock(clock, "black", 2_000);
    expect(clock.remaining.black).toBe(88_000);
    expect(clock.turn).toBe("white");
    expect(clock.moves.black).toBe(1);
  });

  it("加秒设 0 时退化为简单计时", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = switchClock(clock, "black", 10_000);
    expect(clock.remaining.black).toBe(50_000);
  });

  it("连续对走各算各的，互不影响", () => {
    let clock = createClock(fischer(60_000, 10_000), "black", 0);
    clock = switchClock(clock, "black", 0);       // 按下开始
    clock = switchClock(clock, "black", 5_000);   // 黑：60−5+10 = 65
    clock = switchClock(clock, "white", 8_000);   // 白：60−3+10 = 67（8−5=3 秒）
    expect(clock.remaining.black).toBe(65_000);
    expect(clock.remaining.white).toBe(67_000);
  });

  it("传错走子方时原样返回（宁可不动，也不给出错误的时间）", () => {
    let clock = createClock(fischer(60_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    expect(switchClock(clock, "white", 5_000)).toBe(clock);
  });
});

describe("超时判定", () => {
  it("主时间走到 0 判超时，并允许落到负数以显示超时了多久", () => {
    let clock = createClock(fischer(10_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 10_000);
    expect(clock.flagged).toBe("black");
    expect(clock.remaining.black).toBe(0);
    expect(isClockOver(clock)).toBe(true);
    expect(clockWinner(clock)).toBe("white");

    clock = createClock(fischer(10_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 12_500);
    expect(clock.remaining.black).toBe(-2_500);
  });

  it("超时后不再走时间（对方的钟也不动）", () => {
    let clock = createClock(fischer(1_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 2_000);
    expect(remainingAt(clock, "white", 999_999)).toBe(1_000);
  });

  it("加秒能把落后的一方从超时边缘救回来（但不救已经判负的）", () => {
    let clock = createClock(fischer(10_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = switchClock(clock, "black", 9_000);
    expect(clock.remaining.black).toBe(31_000);
    expect(clock.flagged).toBeNull();
  });
});

describe("暂停与恢复", () => {
  it("暂停时先把已用时间结清，之后双方都不走时间", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = pauseClock(clock, 7_000);
    expect(clock.paused).toBe(true);
    expect(clock.remaining.black).toBe(53_000);
    // 暂停 1 分钟后仍是 53 秒。
    expect(remainingBothAt(clock, 67_000)).toEqual({ black: 53_000, white: 60_000 });
  });

  it("恢复后从恢复时刻继续走，暂停的那段时间不算进去", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = pauseClock(clock, 7_000);
    clock = resumeClock(clock, 67_000);
    expect(clock.paused).toBe(false);
    // 恢复后再过 3 秒 → 又走 3 秒。
    expect(remainingAt(clock, "black", 70_000)).toBe(50_000);
  });

  it("钟还没按下时，暂停/继续不改变「等按下」这个状态", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = pauseClock(clock, 7_000);
    expect(isClockOver(clock)).toBe(false);
    expect(remainingAt(clock, "black", 100_000)).toBe(60_000);
    clock = resumeClock(clock, 107_000);
    expect(isClockIdle(clock)).toBe(true);
    expect(remainingAt(clock, "black", 200_000)).toBe(60_000);
  });

  it("暂停中不能落子切钟", () => {
    let clock = createClock(fischer(60_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = pauseClock(clock, 5_000);
    expect(switchClock(clock, "black", 6_000)).toBe(clock);
  });
});

describe("后台跳变（息屏 / 切走）", () => {
  it("隔很久回来时按真实时间补算，而不是按 tick 次数", () => {
    // 模拟：每 200ms 一次 tick 的循环被浏览器节流，直接跳到 10 分钟后。
    let clock = createClock(fischer(60 * 60 * 1000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    const after = tickClock(clock, 10 * 60 * 1000);
    expect(after.remaining.black).toBe(50 * 60 * 1000);
    // 漏掉的 tick 不影响结果——同一次 `now` 再算一遍结果相同（幂等）。
    expect(tickClock(after, 10 * 60 * 1000).remaining.black).toBe(50 * 60 * 1000);
  });

  it("息屏期间走完时间，回来立刻判超时", () => {
    let clock = createClock(fischer(5_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 5 * 60 * 1000);
    expect(clock.flagged).toBe("black");
  });

  it("tick 是幂等的：同一时刻重复调用不会重复扣时间", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    const once = tickClock(clock, 5_000);
    const twice = tickClock(once, 5_000);
    expect(twice.remaining.black).toBe(55_000);
  });
});

describe("读秒制式", () => {
  const readOff: ClockSettings = { mode: "readOff", baseMs: 60_000, incrementMs: 0, delayMs: 10_000, readOffMs: 10_000, readOffPeriods: 3 };

  it("主时间还在时先吃主时间，读秒不动", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 3_000);
    expect(clock.remaining.black).toBe(57_000);
    expect(clock.periods.black).toBe(3);
  });

  it("主时间走完后进入读秒段，此时显示的是本手读秒剩余", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 60_000);          // 主时间耗尽
    expect(clock.remaining.black).toBe(0);
    expect(clock.inReadOffSince).toBe(60_000);
    // 进入读秒后再过 4 秒 → 本手还剩 6 秒。
    expect(remainingAt(clock, "black", 64_000)).toBe(6_000);
  });

  it("读秒周期用完扣一个周期，周期尽则判超时", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 60_000);          // 主时间耗尽，开始第 1 个读秒周期
    expect(clock.periods.black).toBe(3);
    clock = tickClock(clock, 70_000);          // 本手读秒 10 秒用完 → 扣 1 周期
    expect(clock.periods.black).toBe(2);
    expect(clock.flagged).toBeNull();
    clock = tickClock(clock, 80_000);
    expect(clock.periods.black).toBe(1);
    clock = tickClock(clock, 90_000);
    expect(clock.periods.black).toBe(0);
    expect(clock.flagged).toBe("black");
    expect(clockWinner(clock)).toBe("white");
  });

  it("换手后读秒从满额重新起算（读秒按手记，不跨手继承）", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);      // 按下开始
    clock = switchClock(clock, "black", 3_000);
    expect(clock.turn).toBe("white");
    expect(clock.inReadOffSince).toBeNull();
    // 轮走方（白）此刻拿的是自己的主时间满额。
    expect(remainingAt(clock, "white", 3_000)).toBe(60_000);
  });

  it("读秒段中途暂停：本手已用掉的部分不退回来", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 60_000);            // 主时间耗尽，进入第 1 个读秒周期
    expect(clock.inReadOffSince).toBe(60_000);
    clock = pauseClock(clock, 64_000);           // 本手已经用掉 4 秒
    // 暂停中显示的是**冻住的本手余额**（6 秒），不是 0:00（那看起来像已超时）
    expect(remainingAt(clock, "black", 64_000)).toBe(6_000);
    expect(remainingAt(clock, "black", 99_000)).toBe(6_000);
    clock = resumeClock(clock, 124_000);         // 暂停了整整 60 秒
    // 恢复后仍然只剩那 6 秒：暂停的 60 秒不计，但也不白送一手满额读秒
    expect(remainingAt(clock, "black", 124_000)).toBe(6_000);
    clock = tickClock(clock, 130_000);           // 又用掉 6 秒 → 本手读秒用完
    expect(clock.periods.black).toBe(2);
    expect(clock.flagged).toBeNull();
  });

  it("读秒段暂停到额度耗尽也不会偷偷多给一个周期", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 60_000);
    clock = pauseClock(clock, 66_000);           // 本手已用 6 秒
    clock = resumeClock(clock, 300_000);
    // 恢复后再走 4 秒就该扣周期（6+4=10 秒满额），不是从 10 秒重新起算
    clock = tickClock(clock, 304_000);
    expect(clock.periods.black).toBe(2);
  });
});

describe("布龙斯坦延时", () => {
  it("每手加回 min(本手用时, 延时额度)", () => {
    let clock = createClock(bronstein(60_000, 10_000), "black", 0);
    clock = switchClock(clock, "black", 0);        // 按下开始
    // 本手用了 4 秒（< 延时 10 秒）→ 只加回 4 秒，净耗时归零：60 − 4 + 4 = 60。
    clock = switchClock(clock, "black", 4_000);
    expect(clock.remaining.black).toBe(60_000);
    expect(clock.turn).toBe("white");
  });

  it("用了超过延时额度时只拿回额度（剩余时间只减不增）", () => {
    let clock = createClock(bronstein(60_000, 10_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    // 本手用了 25 秒（> 延时 10 秒）→ 只加回 10 秒：60 − 25 + 10 = 45。
    clock = switchClock(clock, "black", 25_000);
    expect(clock.remaining.black).toBe(45_000);
    expect(clock.remaining.black).toBeLessThan(60_000);
  });

  it("与菲舍尔的关键区别：走得再快也不会让剩余时间超过开局", () => {
    let clock = createClock(bronstein(30_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    // 连着 5 手都只花 1 秒——菲舍尔会越走越多，布龙斯坦一步都不涨。
    let at = 0;
    for (let move = 0; move < 5; move += 1) {
      at += 1_000;
      clock = switchClock(clock, clock.turn, at);
      expect(clock.remaining.black).toBeLessThanOrEqual(30_000);
      expect(clock.remaining.white).toBeLessThanOrEqual(30_000);
    }
    // 每手 1 秒、延时 5 秒 → 每手净耗 0 秒，五手之后仍是满额。
    expect(clock.remaining.black).toBe(30_000);
  });

  it("延时设 0 时退化成包干（一点都不返还）", () => {
    let clock = createClock(bronstein(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = switchClock(clock, "black", 7_000);
    expect(clock.remaining.black).toBe(53_000);
  });

  it("延时也算不走时：还没按下时不扣", () => {
    const clock = createClock(bronstein(60_000, 10_000), "black", 0);
    expect(isClockIdle(clock)).toBe(true);
    expect(remainingAt(clock, "black", 999_999)).toBe(60_000);
  });
});

describe("双超时判和（连珠规则，与国象不同）", () => {
  // 《中国五子棋竞赛规则》和棋条件第 4 项 + RIF Gomoku Rules 5.7.2：
  // 「发现时双方都已超时、又无法确定谁先超时」= 和棋。
  it("双方都超时 → 和棋，不是某一方胜", () => {
    let clock = createClock(fischer(10_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);       // 按下开始
    clock = tickClock(clock, 10_000);             // 黑先超时
    expect(clock.flagged).toBe("black");
    expect(clockWinner(clock)).toBe("white");     // 此刻还是白胜
    // 再看白方：发现时白的钟也走完了 → 升级成和棋。
    clock = flagBothClock(clock);
    expect(clock.flaggedBoth).toBe(true);
    expect(isClockDraw(clock)).toBe(true);
    expect(clockWinner(clock)).toBeNull();        // 不再判白胜
    expect(isClockOver(clock)).toBe(true);
  });

  it("判和后不再走时间（两边的钟都停住）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = flagBothClock(clock);
    expect(remainingAt(clock, "black", 999_999)).toBeLessThanOrEqual(60_000);
    expect(clock.runningSince).toBeNull();
  });

  it("认负之后不能再改成判和（认负是明确的终局原因）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = resignClock(clock, "white");
    const after = flagBothClock(clock);
    expect(after.flaggedBoth).toBe(false);
    expect(isClockDraw(after)).toBe(false);
    expect(clockWinner(after)).toBe("black");
  });

  it("没超时的情况下判和也是允许的（裁判直接记和）", () => {
    const clock = createClock(fischer(60_000, 0), "black", 0);
    const after = flagBothClock(clock);
    expect(isClockDraw(after)).toBe(true);
    expect(clockWinner(after)).toBeNull();
  });

  it("和棋不是胜方（clockWinner 为 null，UI 才不会显示「X胜」）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 60_000);
    clock = flagBothClock(clock);
    expect(clockWinner(clock)).toBeNull();
  });
});

describe("显示格式（小时位只在需要时出现）", () => {
  it("不到一小时只显示 分:秒", () => {
    expect(formatClockMs(5 * 60 * 1000)).toBe("5:00");
    expect(formatClockMs(59 * 60 * 1000 + 59_000)).toBe("59:59");
    expect(formatClockMs(9_000)).toBe("0:09");
  });

  it("到了一小时才挂小时位", () => {
    expect(formatClockMs(3600_000)).toBe("1:00:00");
    expect(formatClockMs(2 * 3600_000)).toBe("2:00:00");
    expect(formatClockMs(12 * 3600_000 + 34 * 60_000 + 56_000)).toBe("12:34:56");
  });

  it("向上取整到秒，超时带负号", () => {
    expect(formatClockMs(1_500)).toBe("0:02");
    expect(formatClockMs(-2_500)).toBe("-0:03");
    expect(formatClockMs(0)).toBe("0:00");
  });

  it("字号槽位按「这一档可能出现的最大值」给，不是按当前值", () => {
    // 5 分钟档最长是 59:59（5 字符）；2 小时档最长 1:59:59（6 字符）；
    // 超长档到 9:59:59（7 字符）——槽位数决定字号，算少了就会横向撑爆半屏。
    expect(clockDisplaySlots(5 * 60 * 1000)).toBe(5);
    expect(clockDisplaySlots(59 * 60 * 1000)).toBe(5);
    expect(clockDisplaySlots(3600_000)).toBe(7);
    expect(clockDisplaySlots(2 * 3600_000)).toBe(7);
    expect(clockDisplaySlots(10 * 3600_000)).toBe(8);
  });
});

describe("认负与重开", () => {
  it("认负后对方胜，且不再走时间", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = resignClock(clock, "white");
    expect(clockWinner(clock)).toBe("black");
    expect(remainingAt(clock, "black", 30_000)).toBe(60_000);
  });

  it("重开保留设置、时间归零", () => {
    const settings = fischer(30 * 60 * 1000, 15_000);
    let clock = createClock(settings, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = switchClock(clock, "black", 5_000);
    clock = restartClock(clock, "white", 100_000);
    expect(clock.settings).toEqual(settings);
    expect(clock.remaining).toEqual({ black: settings.baseMs, white: settings.baseMs });
    expect(clock.turn).toBe("white");
    expect(clock.moves).toEqual({ black: 0, white: 0 });
    expect(clock.flagged).toBeNull();
  });
});

describe("低时间警告与报时", () => {
  it("剩余 ≤10 秒时进入低时间（且只有轮走方）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    expect(isLowOnTime(clock, "black", 60_000 - CLOCK_LOW_MS - 1)).toBe(false);
    expect(isLowOnTime(clock, "black", 60_000 - CLOCK_LOW_MS)).toBe(true);
    expect(isLowOnTime(clock, "white", 60_000)).toBe(false);
  });

  it("报时秒数从 10 递减到 1，超时/暂停时不报", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    expect(lowTimeSecond(clock, 50_000)).toBe(10);
    expect(lowTimeSecond(clock, 50_500)).toBe(10);
    expect(lowTimeSecond(clock, 59_000)).toBe(1);
    // 还没进低时间：不报。
    expect(lowTimeSecond(clock, 10_000)).toBeNull();
  });

  it("暂停时不报时（暂停了还滴滴响会吓到人）", () => {
    let clock = createClock(fischer(60_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = pauseClock(clock, 55_000);
    expect(lowTimeSecond(clock, 58_000)).toBeNull();
  });
});

describe("比赛预设", () => {
  it("预设齐全且都可用（总时限 > 0）", () => {
    expect(CLOCK_PRESETS.length).toBeGreaterThanOrEqual(6);
    CLOCK_PRESETS.forEach((preset) => {
      expect(preset.settings.baseMs).toBeGreaterThan(0);
      expect(preset.settings.incrementMs).toBeGreaterThanOrEqual(0);
      expect(preset.title.length).toBeGreaterThan(0);
    });
  });

  // 预设按**连珠/五子棋赛事实际时限**排（RIF §4 与《中国五子棋竞赛规则》第八条）：
  // 之前那些 5+5 / 10+5 是照国象抄的，连珠五子棋的正式时限不是那个路子。
  it("第一档就是 RIF 世锦赛的 2 小时 + 30 秒（Fischer，RIF 官方配置）", () => {
    const wc = CLOCK_PRESETS.find((preset) => preset.id === "rif-wc");
    expect(wc?.settings.baseMs).toBe(120 * 60 * 1000);
    expect(wc?.settings.incrementMs).toBe(30 * 1000);
    expect(wc?.settings.mode).toBe("fischer");
    // RIF 的第一档必须排在最前——是这个应用最可能用到的场景。
    expect(CLOCK_PRESETS[0].id).toBe("rif-wc");
  });

  it("RIF 公开赛档与中国全国锦标赛档都是 60 分 + 30 秒", () => {
    expect(CLOCK_PRESETS.find((p) => p.id === "rif-open")?.settings.baseMs).toBe(3600_000);
    expect(CLOCK_PRESETS.find((p) => p.id === "rif-open")?.settings.incrementMs).toBe(30_000);
    expect(CLOCK_PRESETS.find((p) => p.id === "chn-nat")?.settings.baseMs).toBe(3600_000);
    expect(CLOCK_PRESETS.find((p) => p.id === "chn-nat")?.settings.incrementMs).toBe(30_000);
  });

  it("中国全国赛公开组是 60 分钟包干（规则里的「包干制」，不加秒）", () => {
    const open = CLOCK_PRESETS.find((p) => p.id === "chn-open");
    expect(open?.settings.baseMs).toBe(60 * 60 * 1000);
    expect(open?.settings.incrementMs).toBe(0);
    expect(open?.settings.mode).toBe("fischer");
  });

  // 用户 09-23 点名保留的 5 分钟快棋与 20 分钟包干：移到「快棋 / 超快棋」组，仍在列。
  it("用户点名的 5 分钟快棋与 20 分钟包干保留（包干档）", () => {
    const b5 = CLOCK_PRESETS.find((p) => p.id === "blitz5");
    expect(b5?.settings.baseMs).toBe(5 * 60 * 1000);
    expect(b5?.settings.incrementMs).toBe(0);
    const s20 = CLOCK_PRESETS.find((p) => p.id === "standard20");
    expect(s20?.settings.baseMs).toBe(20 * 60 * 1000);
    expect(s20?.settings.incrementMs).toBe(0);
  });

  it("连珠正式赛那组全是 Fischer 加秒（RIF 不用读秒、不用包干）", () => {
    const rif = CLOCK_PRESETS.filter((p) => p.group === "连珠正式赛");
    expect(rif.length).toBeGreaterThanOrEqual(3);
    rif.forEach((p) => {
      expect(p.settings.mode).toBe("fischer");
      expect(p.settings.incrementMs).toBeGreaterThan(0);
    });
  });

  it("默认就是 5 分钟包干（打开就能用）", () => {
    expect(DEFAULT_CLOCK_SETTINGS.baseMs).toBe(5 * 60 * 1000);
    expect(DEFAULT_CLOCK_SETTINGS.incrementMs).toBe(0);
    expect(DEFAULT_CLOCK_SETTINGS.mode).toBe("fischer");
  });

  it("预设覆盖包干 / 加秒 / 读秒 / 延时四种制式", () => {
    const deaths = CLOCK_PRESETS.filter((preset) => preset.settings.mode === "fischer" && preset.settings.incrementMs === 0);
    const increments = CLOCK_PRESETS.filter((preset) => preset.settings.mode === "fischer" && preset.settings.incrementMs > 0);
    const delays = CLOCK_PRESETS.filter((preset) => preset.settings.mode === "bronstein");
    const yomi = CLOCK_PRESETS.filter((preset) => preset.settings.mode === "readOff");
    expect(deaths.length).toBeGreaterThanOrEqual(3);
    expect(increments.length).toBeGreaterThanOrEqual(6);
    expect(delays.length).toBeGreaterThanOrEqual(1);
    expect(yomi.length).toBeGreaterThanOrEqual(2);
  });

  it("每档预设都归在一个分组里，且分组顺序固定（面板按这个顺序渲染）", () => {
    const groups = CLOCK_PRESET_GROUPS;
    expect(groups.length).toBeGreaterThanOrEqual(4);
    CLOCK_PRESETS.forEach((preset) => {
      expect(groups).toContain(preset.group);
    });
    // 每组都要有档位——空组会在面板上留一个空标题。
    groups.forEach((group) => {
      expect(CLOCK_PRESETS.filter((preset) => preset.group === group).length).toBeGreaterThan(0);
    });
  });

  it("预设 id 不重复（重复会让选中态同时亮两格）", () => {
    const ids = CLOCK_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * 布龙斯坦延时的两条回归（用户 2026-10-01 问「所有计时规则里有没有不准确的」时实测出的两个真 bug）。
 *
 * ① **返还的是真实本手用时**，不是「距离上一次重绘多久」。
 *    状态机原本用 `now - runningSince` 当本手用时，而 UI 每 200ms 就把 `runningSince` 前移一次
 *    （`tickClock` 要拿它当补算锚点），于是交钟时只剩 ≤200ms 的尾巴——生产构建上实测
 *    思考 4 秒交钟返还 **0 秒**，整个制式退化成包干。下面那条"每 200ms tick 一次"的用例
 *    就是这个场景的模型：**以前所有用例都不跑那个定时器，所以它们一直全绿。**
 *
 * ② **延时额度是这一手的保护时**：用满「主时间 + 延时」才判负。
 *    原本 `tickClock` 一见主时间归零就判负，于是「主 1 秒 + 延时 5 秒、用 3 秒落子」被误判超时，
 *    而文件头自己写着「它与简单延时在时间总量上等价」——简单延时下这手根本不会输。
 */
describe("布龙斯坦延时：返还真实本手用时（带重绘 tick）", () => {
  /** 模拟 DuelClockPanel 的 200ms 定时器：每 200ms 调一次 tickClock（它同时把 runningSince 前移）。 */
  const thinkWithTicker = (state: ReturnType<typeof createClock>, from: number, to: number) => {
    let clock = state;
    for (let t = from + 200; t <= to; t += 200) clock = tickClock(clock, t);
    return clock;
  };

  it("思考 4 秒（每 200ms 重绘一次）后交钟，剩余时间回到满额", () => {
    let clock = createClock(bronstein(60_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = thinkWithTicker(clock, 0, 4_000);
    expect(remainingAt(clock, "black", 4_000)).toBe(56_000);   // 屏上先扣到底
    clock = switchClock(clock, "black", 4_000);
    // 本手用 4 秒 < 延时 5 秒 → 全额返还：净耗时 0（旧实现给的是 56000，等于一秒都没返）
    expect(clock.remaining.black).toBe(60_000);
    expect(clock.moves.black).toBe(1);
  });

  it("moveUsedMs 每 tick 累加、交钟归零、暂停期间不计", () => {
    let clock = createClock(bronstein(60_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);          // 按下开始
    clock = tickClock(clock, 1_000);
    clock = tickClock(clock, 2_500);
    expect(clock.moveUsedMs).toBe(2_500);
    clock = pauseClock(clock, 2_500);
    clock = resumeClock(clock, 30_000);              // 暂停 27.5 秒
    clock = tickClock(clock, 31_000);
    expect(clock.moveUsedMs).toBe(3_500);            // 暂停那段不算进本手
    clock = switchClock(clock, "black", 31_000);
    expect(clock.moveUsedMs).toBe(0);                // 换手后新的本手从零起算
    expect(clock.remaining.black).toBe(60_000);      // 本手用 3.5 秒 < 延时 5 秒 → 一分不扣
  });
});

describe("布龙斯坦延时：保护期内不判负", () => {
  it("主 1 秒 + 延时 5 秒，用 3 秒落子 → 不判负，主时间一秒没扣", () => {
    let clock = createClock(bronstein(1_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    expect(remainingAt(clock, "black", 3_000)).toBe(-2_000);   // 屏上负值 = 已吃掉的 2 秒延时
    clock = switchClock(clock, "black", 3_000);
    expect(clock.flagged).toBeNull();
    expect(clock.remaining.black).toBe(1_000);   // 简单延时下这手同样不扣主时间（两种算法等价）
    expect(clock.turn).toBe("white");
  });

  it("用满「主时间 + 延时额度」才判负", () => {
    let clock = createClock(bronstein(1_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = switchClock(clock, "black", 7_000);    // 1 + 5 = 6 秒可用，用了 7 秒
    expect(clock.flagged).toBe("black");
    expect(clock.remaining.black).toBe(-6_000);
  });

  it("不动手让钟走到「主时间 + 延时」也会判负（判负不只在交钟那一刻）", () => {
    let clock = createClock(bronstein(1_000, 5_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 5_000);
    expect(clock.flagged).toBeNull();              // 主时间早已走完，但延时还在保护
    clock = tickClock(clock, 6_000);
    expect(clock.flagged).toBe("black");           // 恰好 1 + 5 = 6 秒用尽 → 超时
  });

  it("延时额度设 0 时判负时机与包干一致（保护期为 0）", () => {
    let clock = createClock(bronstein(1_000, 0), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 1_000);
    expect(clock.flagged).toBe("black");
  });

  it("菲舍尔不吃延时保护：主时间走完那一刻就判负（加秒也救不回来）", () => {
    // 这条是防止 guard 误加到别的制式上——菲舍尔的标准就是「旗落即负」，加秒只在落子后加。
    let clock = createClock(fischer(1_000, 30_000), "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 1_200);
    expect(clock.flagged).toBe("black");
  });
});

describe("读秒显示锚点（跨过主时间归零的大跳）", () => {
  const readOff: ClockSettings = { mode: "readOff", baseMs: 60_000, incrementMs: 0, delayMs: 10_000, readOffMs: 10_000, readOffPeriods: 3 };

  it("后台节流一次跳 75 秒：扣掉耗尽周期并保留本周期已经用掉的 5 秒", () => {
    let clock = createClock(readOff, "black", 0);
    clock = switchClock(clock, "black", 0);
    clock = tickClock(clock, 75_000);     // 主时间 60 秒用完后又多过了 15 秒
    expect(clock.periods.black).toBe(2);
    expect(clock.inReadOffSince).toBe(70_000);
    expect(remainingAt(clock, "black", 75_000)).toBe(5_000);
    expect(tickClock(clock, 75_000)).toEqual(clock);
  });

  it("一次跳过主时间和所有读秒周期时立即判负，不能靠交钟逃过超时", () => {
    const clock = switchClock(createClock(readOff), "black", 0);
    for (const finish of [90_000, 125_000]) {
      const after = switchClock(clock, "black", finish);
      expect(after.flagged).toBe("black");
      expect(after.periods.black).toBe(0);
      expect(after.moves.black).toBe(0);
    }
  });

  it("已经进入读秒后息屏多周期，和每秒推进的结果一致", () => {
    const started = switchClock(createClock(readOff), "black", 0);
    const entered = tickClock(started, 60_000);
    const jumped = tickClock(entered, 85_000);
    let stepped = entered;
    for (let at = 61_000; at <= 85_000; at += 1_000) stepped = tickClock(stepped, at);
    expect(jumped.periods).toEqual(stepped.periods);
    expect(jumped.inReadOffSince).toBe(stepped.inReadOffSince);
    expect(remainingAt(jumped, "black", 85_000)).toBe(5_000);
  });

  it("非轮走方在读秒时显示自己的完整周期，暂停不串用轮走方的锚点", () => {
    let clock = switchClock(createClock({ ...readOff, baseMs: 0 }), "black", 0);
    clock = tickClock(clock, 4_000);
    expect(remainingAt(clock, "white", 4_000)).toBe(10_000);
    clock = pauseClock(clock, 4_000);
    expect(remainingAt(clock, "black", 20_000)).toBe(6_000);
    expect(remainingAt(clock, "white", 20_000)).toBe(10_000);
  });
});
