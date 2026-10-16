import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./diagnostics";
import { RELEASE_NOTES, RELEASE_NOTES_FALLBACK, releaseNotesFor } from "./release-notes";

/**
 * 「本版本更新内容」的守门用例（用户 2026-10-01 要这个入口，并说「以后更新了可以在这里看」）。
 *
 * 关键是**别让机制烂掉**：谁抬了 `package.json` 的版本号却没在 `RELEASE_NOTES` 里补条目，
 * 这里就红。项目里已经吃过「按钮接了但没线」「入口存在但点了没用」那类亏（改造表 R93），
 * 所以这种"靠人记得写"的约定必须有一条断言兜着。
 */

// APP_VERSION 由 vite 从 package.json 注入（vite.config.ts 的 __APP_VERSION__），
// 所以这里直接用它：它就是发版抬的那个值。注入没生效时会退回 "0.0.0-dev"，
// 下面第一条用例先把它钉住，免得"缺条目"的红误导人去补内容。
const currentVersion = APP_VERSION;

// 逐段版本号比大小（1.1.8.9 < 1.1.8.17，按字符串比会反过来；三段与四段混比时缺的那段按 0 算）。
const versionKey = (v: string) => v.split(".").map((n) => Number(n) || 0);
const isNewer = (a: string, b: string) => {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};
// 这套机制是从 1.1.8.17 才开始有的；比它更早的版本从来没有更新说明，
// 要求补等于逼人回头造假内容。所以「必须有条目」只对**不低于最新一条**的版本成立。
const newestDocumented = Object.keys(RELEASE_NOTES).reduce((a, b) => (isNewer(a, b) ? a : b), "0.0.0.0");

describe("本版本更新内容（关于 → 更新内容）", () => {
  it("APP_VERSION 是从 package.json 注入的真实版本号", () => {
    // 三段或四段都接受：公开仓历史上 `v1.1.8`、`v1.1.7` 本来就是三段，minor 版本
    // （1.1.9 这种）用三段是既有惯例；第四段是补丁线（1.1.8.17 这类），照旧允许。
    expect(currentVersion).toMatch(/^\d+\.\d+\.\d+(\.\d+)?$/);
  });

  it("当前版本号必须有对应条目——抬了版本没写更新说明就报红", () => {
    const hasOwnEntry = RELEASE_NOTES[currentVersion] !== undefined;
    // 这套机制是从某一行才有的：版本号还低于最新已记录那一版时（例如检查点里
    // package.json 没跟着抬），逼人回头补 1.1.8.8 的说明等于造假内容。
    const predatesMechanism = !isNewer(currentVersion, newestDocumented);
    expect(hasOwnEntry || predatesMechanism, `package.json 已是 ${currentVersion}，但 src/release-notes.ts 里还没有这一版的更新说明。`
      + `请补一条 RELEASE_NOTES["${currentVersion}"]（面向用户的说法，技术细节留在 RELEASE_NOTES.md 与改造表）。`).toBe(true);
  });

  it("条目形状：有概括、至少一条、标题短说明完整", () => {
    // 逐条查所有已记录的条目，而不是只查当前版本——当前版本可能还没写（上一条用例管那个）。
    Object.entries(RELEASE_NOTES).forEach(([version, notes]) => {
      expect(notes.version).toBe(version);
      expect(notes.summary.trim().length).toBeGreaterThan(8);
      expect(notes.items.length).toBeGreaterThanOrEqual(1);
      notes.items.forEach((item) => {
        expect(item.title.trim().length).toBeLessThanOrEqual(20);
        expect(item.text.trim().length).toBeGreaterThanOrEqual(20);
        // 浮层里一行说明超过两屏就读不动了；开发日志该留在 RELEASE_NOTES.md。
        expect(item.text.trim().length).toBeLessThanOrEqual(180);
      });
    });
  });

  it("日期缺失时是空串而不是 undefined（界面按空串跳过，不显示「undefined」）", () => {
    Object.values(RELEASE_NOTES).forEach((notes) => {
      expect(typeof notes.date).toBe("string");
      expect(notes.date === "" || /^\d{1,2}-\d{1,2}$/.test(notes.date)).toBe(true);
    });
  });

  it("每个键都是三段或四段版本号，且与条内 version 一致", () => {
    Object.entries(RELEASE_NOTES).forEach(([key, notes]) => {
      // 同上：minor 版本用三段是既有惯例（v1.1.8 / v1.1.7），四段是补丁线。
      expect(key).toMatch(/^\d+\.\d+\.\d+(\.\d+)?$/);
      expect(notes.version).toBe(key);
    });
  });

  it("查不到的版本返回 null，界面有诚实兜底文案（不拿旧版内容冒充新版）", () => {
    expect(releaseNotesFor("9.9.9.9")).toBeNull();
    expect(RELEASE_NOTES_FALLBACK.length).toBeGreaterThan(10);
  });
});
