// @ts-expect-error 应用有意不引 Node 类型；Vitest 在 Node 下跑这个文件。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 胜率视角守卫（2026-09-30 重写）。
 *
 * 背景：用户反复报「黑棋时显示白棋胜率 / 白棋时显示黑棋胜率」，前后修过两次都没修好。
 * 09-30 用**行棋方无歧义**的局面重做矩阵实验（_engine-lab/矩阵结果）才定案：
 *     未设置 / SIDETOMOVE → 行棋方视角（已判决局面同样遵守）
 *     BLACK → 黑方视角        WHITE → 白方视角
 * 09-29 那次标定用的局面是「黑四连 + 白走」（盘面 4 黑 3 白），却按「黑走」解读，
 * 于是把 0（= 白方即行棋方必败）误读成「黑方胜率 0」，得出了「SIDETOMOVE = 对手视角」
 * 的错误结论，并把 cfg 改成了 BLACK。
 *
 * 而 09-29 用户看到的「黑白颠倒」真正根因是：**cfg 改了却没升 PAYLOAD_VERSION** ——
 * 设备上跑的仍是旧 payload 里的 SIDETOMOVE cfg，前端却已按「引擎给的就是黑方胜率」
 * 原样透传，于是白行棋时把白方胜率当黑方显示。
 *
 * 现在的定案（用户 09-30 钦定，与「智子本地版」同款）：
 *   · 引擎恒输出**行棋方视角**，且启动参数再强制一次（不依赖 payload 是否重铺）；
 *   · 面板/候选点直接显示引擎原值，**标签跟着行棋方走**（谁在走就显示谁的胜率）；
 *   · 胜率曲线/整局复盘/复盘样本必须单一视角才可比 → 折到黑方视角。
 * 下面把「引擎配置」「启动参数」「资产版本戳」「前端语义」四边钉在一起，
 * 任何一边被改回旧约定都会红。
 */
describe("胜率视角（引擎配置 ↔ 启动参数 ↔ 前端语义 必须一致）", () => {
  const cfg = readFileSync(
    new URL("../../../android/app/src/main/assets/engine-katago/kata.cfg", import.meta.url),
    "utf8",
  );
  const plugin = readFileSync(
    new URL("../../../android/app/src/main/java/cn/renjunote/mobile/NativeKataGoPlugin.java", import.meta.url),
    "utf8",
  );
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

  it("kata.cfg 用 SIDETOMOVE（引擎输出行棋方视角）", () => {
    const match = cfg.match(/^\s*reportAnalysisWinratesAs\s*=\s*(\w+)/m);
    expect(match).toBeTruthy();
    expect(match![1].toUpperCase()).toBe("SIDETOMOVE");
    expect(cfg).not.toMatch(/^\s*reportAnalysisWinratesAs\s*=\s*BLACK/mi);
  });

  it("启动参数再强制一次视角（cfg 改了但 payload 没重铺时仍然正确）", () => {
    expect(plugin).toContain('"-override-config", "reportAnalysisWinratesAs=SIDETOMOVE"');
  });

  it("资产版本戳已升高（改了 kata.cfg 就必须升，否则设备上刷不掉）", () => {
    const match = plugin.match(/PAYLOAD_VERSION\s*=\s*(\d+)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThan(5);
  });

  it("面板直接显示引擎原值，标签跟着行棋方走", () => {
    expect(app).toMatch(/const panelWinRate = \(raw: number \| undefined\): number \| undefined => raw/);
    expect(app).toMatch(/mover === "white" \? "白方胜率" : "黑方胜率"/);
    // 写死的「黑方胜率」标签不能再出现在面板统计里
    expect(app).not.toMatch(/黑方胜率<\/small>/);
  });

  it("折算只服务曲线/复盘，且不再按引擎分流（视角只随行棋方翻面）", () => {
    expect(app).toMatch(/const toBlackWinRate = \(raw: number \| undefined, mover: Player \| undefined\)/);
    expect(app).not.toMatch(/engine === "kata" \|\| engine === "ikatago" \? raw/);
    expect(app).not.toMatch(/state\.engine === "kata" \|\| state\.engine === "ikatago" \? raw/);
  });

  it("旧视角数据作废：分析缓存与整局复盘键都已升版", () => {
    const cache = readFileSync(new URL("./analysis-cache.ts", import.meta.url), "utf8");
    const review = readFileSync(new URL("../research/game-review.ts", import.meta.url), "utf8");
    expect(cache).toContain('"banbu-analysis-cache-v2"');
    expect(review).toContain('"banbu-game-review-v2"');
  });
});
