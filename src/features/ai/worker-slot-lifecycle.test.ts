/**
 * 分析槽 / 对弈 worker 的生命周期守卫（09-27 真机定位的头号根因）。
 *
 * 现象：旗舰引擎「只有第一次开在计算」「点一手没反应」「面板全是 -」。
 * 真机日志实锤的机制：`thinkWorker` / `rapfiThinkWorker` 在面板分析时指向的就是
 * 分析槽里那个常驻 worker，某些清理代码「顺手 terminate」它们却不清槽位；下一次
 * startThink 见 `slot.key` 仍匹配就把这个**已终止的 worker** 当活的复用，而
 * postMessage 投进已 terminate 的 worker 是**静默丢弃**（不报错、不进 onerror）——
 * 于是 App 以为发了请求（`app:startThink post gen=6` 有日志），worker 侧
 * analyze in / runKata 全为 0，引擎还在算旧局面。
 *
 * 这类错误在运行时不会抛异常，只能靠「所有终止都必须连带清槽 / 标死」的约定 +
 * startThink 的 dead 兜底来防。本测试守的是**约定本身**：任何绕过封装的裸
 * terminate 都在这里被拦下。
 */
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../../src/App.tsx", import.meta.url), "utf8");

describe("AI worker 槽位生命周期（禁止裸 terminate 留死槽）", () => {
  it("thinkWorker / rapfiThinkWorker 不得被裸 terminate（必须走 releaseThinkWorkerRefs / killAnalysisSlot）", () => {
    // 这两个 ref 可能指向分析槽 worker；裸 terminate 会留下「槽里是死 worker」的
    // 状态，正是本次线上故障的成因。
    expect(app).not.toMatch(/thinkWorker\.current\?\.terminate\(\)/);
    expect(app).not.toMatch(/rapfiThinkWorker\.current\?\.terminate\(\)/);
    expect(app).toContain("function releaseThinkWorkerRefs");
    expect(app).toContain("function killAnalysisSlot");
  });

  it("分析槽 worker 一律由 makeAnalysisSlot 创建（terminate 被包装，任何终止都会标 dead）", () => {
    expect(app).toContain("function makeAnalysisSlot");
    expect(app).toMatch(/worker\.terminate = \(\) => \{ slot\.dead = true; originalTerminate\(\); \}/);
    // 不允许再出现手工拼装槽条目（绕过 dead 包装）的写法
    expect(app).not.toMatch(/worker: createEngineWorker\([^)]*\), key: \w+, controller: \w+, running: false/);
    expect(app).not.toMatch(/worker: (?:warm|rebuilt), key: \w+, controller: \w+, running: false/);
  });

  it("复用槽位前必须检查 dead（否则会把 analyze 投进已终止的 worker）", () => {
    expect(app).toMatch(/slot\.key !== thinkSlotKey \|\| slot\.dead/);
    // 预热槽的「同键即复用」判据同样要看 dead
    expect(app).toMatch(/slot\?\.key === slotKey && !slot\.dead/);
    // 对弈常驻 worker 同理（cancelActiveAiComputation 会 terminate 它）
    expect(app).toMatch(/persistentEntry\.key !== slotKey \|\| persistentEntry\.dead/);
  });

  it("dead 标记的闭包必须绑到具体 entry 对象（捕获可变变量会误伤后继 entry）", () => {
    // 旧 worker 的 terminate 若捕获 `persistentEntry` 这个 let 变量，worker 被替换后
    // 它会去标**新** entry 的 dead → 新 worker 又被判死重建，循环丢请求。
    expect(app).toMatch(/const ownedEntry = persistentEntry;/);
    expect(app).toMatch(/gameWorker\.terminate = \(\) => \{ ownedEntry\.dead = true; originalGameTerminate\(\); \}/);
    expect(app).not.toMatch(/gameWorker\.terminate = \(\) => \{[^}]*persistentEntry\.dead/);
  });

  it("「有没有轮在跑」的判据不把已死槽算作活轮（否则自愈保活会被永久挡住）", () => {
    // 只看读 controller.current 的活轮判据（另一处 some() 问的是「这个 worker 是否
    // 属于某个槽」，与死活无关）。
    const liveChecks = app.match(/analysisPersistent\.current\.some\(\(slot\) =>[^\n]*controller\.current[^\n]*\)/g) ?? [];
    expect(liveChecks.length).toBeGreaterThanOrEqual(3);
    for (const check of liveChecks) expect(check).toContain("!slot.dead");
  });

  it("位置变化清理必须同时看分析槽（只看对局控制器就会误杀常驻分析 worker）", () => {
    // 该 effect 的 else 分支只在「对局轮与分析轮都不在」时才清理
    expect(app).toMatch(/else if \(!active && !analysisActive\) \{/);
  });
});
