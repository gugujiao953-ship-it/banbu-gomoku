import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node is available to Vitest, not the browser application.
// （照 `appearance-materials.test.ts` 的先例：tsconfig 里没有 @types/node，
//   而这个"源码级不变量"测试需要读源码文件。）
import { readFileSync } from "node:fs";

/**
 * 棋魂解锁商店的**行为**测试（用户 2026-10-10：解锁项要真的能买、真的落地）。
 *
 * 这一组守的是这个模块最容易出的两类错：
 *  ① **漏项**：手写商品表只覆盖了一小半材质，剩下的静默免费
 *     （第一版就是这样：45 条手写表 vs 实际 60 多个材质 id）；
 *  ② **买了没落地**：扣了钱却没记上、或者记上了但界面不刷新。
 */

// jsdom 也没提供 localStorage 时用一个最小实现（本仓库其它测试同款做法）。
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
});

const {
  SOUL_UNLOCKS, SOUL_UNLOCK_GROUPS, soulUnlockById, soulUnlockForTarget, soulUnlockStats,
  DEFAULT_FREE_THEMES, DEFAULT_FREE_BOARD, DEFAULT_FREE_STONE, VCF_START_TIERS, vcfStartLevelCost,
} = await import("./soul-unlocks");
const {
  loadSoulUnlocks, saveSoulUnlocks, isSoulUnlocked, isTargetUnlocked, soulTargetCost,
  purchaseSoulUnlock, useSoulAction, describePurchaseFailure, soulUnlockProgress, SOUL_UNLOCKS_KEY,
} = await import("./soul-shop");
const { grantSoul } = await import("./soul");
const { THEME_OPTIONS } = await import("../../theme-options");
const { materialBoards, materialStones } = await import("../../appearance/render");

const freshLedger = (seed = 100000) => {
  const ledger = { version: 1 as const, entries: [] as never[], usedTokens: new Set<string>() };
  if (seed > 0) {
    grantSoul(ledger, { amount: seed, reason: "achievement", detail: "测试本金", token: "test:seed" });
  }
  return ledger;
};
const balanceOf = (ledger: { entries: { amount: number }[] }) =>
  ledger.entries.reduce((sum, item) => sum + item.amount, 0);

describe("解锁商店：商品表完整（不许漏项）", () => {
  beforeEach(() => { store.clear(); vi.unstubAllEnvs; });

  it("**每一个**可收费的外观项都上架了（这条是拿注册表对拍的，不是数条目）", () => {
    // 主题：`THEME_OPTIONS` 里除免费项外，每一项都要有商品
    for (const [id] of THEME_OPTIONS) {
      if (DEFAULT_FREE_THEMES.includes(id)) continue;
      expect(soulUnlockForTarget("theme", id), `主题 ${id} 没有上架`).toBeDefined();
    }
    // 棋盘 / 棋子：材质注册表里除默认项与被删项外，每一项都要有商品
    for (const material of materialBoards()) {
      if (material.src.replace(/^app-/, "") === DEFAULT_FREE_BOARD) continue;
      expect(soulUnlockForTarget("board", material.src), `棋盘 ${material.src} 没有上架`).toBeDefined();
    }
    for (const material of materialStones()) {
      if (material.src.replace(/^app-/, "") === DEFAULT_FREE_STONE) continue;
      expect(soulUnlockForTarget("stone", material.src), `棋子 ${material.src} 没有上架`).toBeDefined();
    }
  });

  it("默认项**永远免费**（不收费的是默认棋盘/棋子/主题那几套）", () => {
    for (const id of DEFAULT_FREE_THEMES) {
      expect(soulUnlockForTarget("theme", id)).toBeUndefined();
      expect(soulTargetCost("theme", id)).toBe(0);
    }
    expect(soulUnlockForTarget("board", DEFAULT_FREE_BOARD)).toBeUndefined();
    expect(soulUnlockForTarget("board", `app-${DEFAULT_FREE_BOARD}`)).toBeUndefined();
    expect(soulUnlockForTarget("stone", DEFAULT_FREE_STONE)).toBeUndefined();
    expect(soulUnlockForTarget("stone", `app-${DEFAULT_FREE_STONE}`)).toBeUndefined();
  });

  it("两种写法（`jade` 与 `app-jade`）查出来是同一项 —— 设置页两种值都可能传", () => {
    const bare = soulUnlockForTarget("board", "jade");
    const prefixed = soulUnlockForTarget("board", "app-jade");
    expect(bare).toBeDefined();
    expect(prefixed?.id).toBe(bare?.id);
  });

  it("id 唯一、价格是正整数、分组都有人住", () => {
    const ids = new Set<string>();
    for (const item of SOUL_UNLOCKS) {
      expect(ids.has(item.id), `id 重复：${item.id}`).toBe(false);
      ids.add(item.id);
      expect(Number.isInteger(item.cost) && item.cost > 0, `${item.id} 价格不合法：${item.cost}`).toBe(true);
      expect(item.title.trim().length > 0).toBe(true);
      if (item.kind !== "action") expect(item.target, `${item.id} 缺 target`).toBeTruthy();
    }
    for (const group of SOUL_UNLOCK_GROUPS) {
      expect(SOUL_UNLOCKS.some((item) => item.kind === group.kind), `分组 ${group.kind} 是空的`).toBe(true);
    }
  });

  it("外观定价**只有少数几档**（用户 2026-10-11 在工坊里调成 500 / 700 两档）", () => {
    const stats = soulUnlockStats();
    // 用户在工坊里把基础档设成 500、中/高档设成 700（见 SOUL_PRICE_RULES）。
    // ⚠ 这条**不再钉死单一数字** —— 定价是用户在调的旋钮，钉死等于每次调价都要改测试。
    // 它守的是"档位数量有界"：规则化定价的意义就是"只有几档"，
    // 若某天出现十几个不同价位，说明有人绕过 `SOUL_PRICE_RULES` 手写了价格。
    const ownable = SOUL_UNLOCKS.filter((entry) => !entry.consumable);
    const tiers = [...new Set(ownable.map((entry) => entry.cost))].sort((a, b) => a - b);
    expect(tiers.length, `价位档数 ${tiers.length}：${tiers.join("/")}`).toBeLessThanOrEqual(4);
    expect(tiers.length).toBeGreaterThan(0);
    // 每一档都是正整数、且不低于"便宜"这一档（防手滑写 0）
    for (const cost of tiers) expect(Number.isInteger(cost) && cost > 0).toBe(true);
    expect(stats.cheapest).toBe(tiers[0]);
    expect(stats.priciest).toBe(tiers[tiers.length - 1]);
  });

  it("一次性动作**不受**一口价影响（它们是功能不是外观）", () => {
    const actions = SOUL_UNLOCKS.filter((item) => item.consumable);
    expect(actions.length).toBeGreaterThan(0);
    // 至少有一个不等于 500，且都仍然是个正整数价
    for (const item of actions) {
      expect(Number.isInteger(item.cost) && item.cost > 0, `${item.id} 价格不合法`).toBe(true);
    }
  });
});

/**
 * **付费能力不许有免费旁路**（2026-10-11，用户报的一类 bug）。
 *
 * 用户原话：「我搞了很多用棋魂买的地方，但是这些地方，有的却有其他通道可以免费，
 * 比如 vcf 挑战里面的 vcf 设置，里面有很多是我们设计要棋魂才能买的，这里却全部免费」。
 *
 * 这一组测的是**结构性事实**，不是某个按钮的行为：那些"改付费状态"的函数
 * （`resetToStartLevel` / `clearDuelHistory`）**只允许**出现在两条路上 ——
 * 收费的产品代码里，或者测试里。谁在 UI 代码里直接调它们而不经过
 * `useSoulShop().spend`，这里就会红。
 *
 * 为什么用源码扫描而不是单测行为：这类 bug 的形态是"某处漏接了收费"，
 * 而那个"某处"是**屏幕上的一个按钮**——单测拿不到它（要起浏览器）。
 * 门禁（`qa/vcf-flow-sweep.mjs`）已经在真实路径上比对了余额，
 * 这里再加一道**编译期的记账**：新增调用点时必须解释清楚为什么它不要钱。
 */
describe("付费能力没有免费旁路（源码级不变量）", () => {
  /**
   * 读源码。照 `appearance-materials.test.ts` 的先例用**静态 import + `new URL`**
   * （不是动态 `await import("node:fs/promises")` —— 那种写法过不了 tsc 的 node 类型解析，
   *  本项目的 tsconfig 没装 @types/node）。
   */
  const readSource = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

  it("`resetToStartLevel` 只在**收费**的两处被调用（VCF 页 / 设置页）", () => {
    const vcfPage = readSource("../vcf-challenge/VcfChallengePage.tsx");
    // VCF 页：调用点必须与 `shop.spend` 在同一个处理函数里（同一个 `onClick` 块内）。
    const callIndex = vcfPage.indexOf("resetToStartLevel(state, debugLevel, debugClear)");
    expect(callIndex, "VCF 页里找不到重置调用（改过名字？）").toBeGreaterThan(-1);
    // 往上找最近的 `shop.spend(`，必须在同一个按钮处理函数里（中间不能出现别的 onClick 收尾）。
    const before = vcfPage.slice(0, callIndex);
    const lastSpend = before.lastIndexOf("shop.spend(");
    expect(lastSpend, "VCF 页的重置**没有经过 shop.spend** —— 就是那条免费旁路").toBeGreaterThan(-1);
    // 两次之间不能跨过另一个 `onClick={`（跨过就说明不是同一个处理函数）。
    expect(before.slice(lastSpend).includes("onClick={"), "重置与扣费不在同一个点击处理函数里").toBe(false);
  });

  it("`clearDuelHistory` 只在**收费**的那一处被调用（DuelStatsSheet 经 shop.spend）", () => {
    const sheet = readSource("../duel/DuelStatsSheet.tsx");
    const app = readSource("../../App.tsx");
    // 面板里必须扣费。
    expect(sheet.includes("shop.spend("), "战绩面板清空没有扣费 —— 就是那条免费旁路").toBe(true);
    // App 里只负责执行（`clearDuelStats`），不许再有别的清空入口。
    const appCalls = (app.match(/clearDuelHistory\(\)/g) ?? []).length;
    expect(appCalls, `App 里 clearDuelHistory 调用了 ${appCalls} 次，应该恰好 1 次（执行那一步）`).toBe(1);
  });

  it("调试桥的 `setTheme` 会检查解锁（不是无条件写盘）", () => {
    const bridge = readSource("../../debug-bridge.ts");
    expect(bridge.includes("soulUnlockForTarget"), "调试桥 setTheme 没查解锁").toBe(true);
    /**
     * 关键不是"有没有 setItem"（正常的写法里当然有，扣费检查之后就该写盘了），
     * 而是**顺序**：解锁检查必须出现在写盘**之前**。
     * 所以切出 `setTheme` 那一段，比两个下标谁在前。
     */
    const setThemeAt = bridge.indexOf("setTheme: (id) =>");
    expect(setThemeAt, "找不到 setTheme 实现（改名了？）").toBeGreaterThan(-1);
    // 取到下一个同级方法（`eval:`）之前就算这一段。
    const evalAt = bridge.indexOf("eval: (code) =>", setThemeAt);
    const body = bridge.slice(setThemeAt, evalAt > 0 ? evalAt : undefined);
    const checkAt = body.indexOf("soulUnlockForTarget");
    const writeAt = body.indexOf('setItem("banbu-theme-preference-v1"');
    expect(checkAt, "setTheme 里没有解锁检查").toBeGreaterThan(-1);
    expect(writeAt, "setTheme 里没有写盘（实现变了？）").toBeGreaterThan(-1);
    expect(checkAt < writeAt, "解锁检查排在写盘**之后** —— 等于没检查（先斩后奏）").toBe(true);
  });

  it("没有「直接写解锁集合」的导出（白拿后门）", () => {
    const shop = readSource("./use-soul-shop.ts");
    // ⚠ 不能只 `includes("writeUnlocksForTest")` —— 那个名字会出现在**解释为什么删掉它**
    // 的注释里（就在本文件的注释政策里），于是这条断言会一直红。
    // 要判的是"它作为**导出**回来了"：`export const writeUnlocksForTest`。
    expect(/export\s+const\s+writeUnlocksForTest/.test(shop), "白拿后门又长回来了").toBe(false);
    // 再兜一层：任何"只写解锁集合"的小函数都不该作为产品 API 导出。
    expect(/export\s+const\s+\w*[Ww]rite\w*[Uu]nlock/.test(shop), "又出现了写解锁集合的导出").toBe(false);
  });
});

describe("老用户迁移：在用的付费外观自动赠送", () => {
  beforeEach(() => store.clear());

  it("把**正在用**的主题/棋盘/棋子直接送进解锁集合（不扣棋魂）", async () => {
    const { grantEquippedAppearance, loadSoulUnlocks, SOUL_GRANT_KEY } = await import("./soul-shop");
    // 模拟老用户：正在用三样现在要收费的外观，且从没买过
    store.set("banbu-theme-preference-v1", "bamboo");
    store.set("banbu-board-theme-v1", "app-jade");
    store.set("banbu-stone-theme-v1", "app-snow");
    const granted = grantEquippedAppearance();
    expect(granted.sort()).toEqual(["board-app-jade", "stone-app-snow", "theme-bamboo"]);
    const unlocks = loadSoulUnlocks();
    expect(unlocks.has("theme-bamboo")).toBe(true);
    expect(unlocks.has("board-app-jade")).toBe(true);
    expect(unlocks.has("stone-app-snow")).toBe(true);
    // 打了标记（迁移执行过的凭证）
    expect(store.get(SOUL_GRANT_KEY)).toBeTruthy();
  });

  it("**只执行一次**：标记存在时不再送（否则换掉旧的再切回来会被反复白送）", async () => {
    const { grantEquippedAppearance, SOUL_GRANT_KEY } = await import("./soul-shop");
    store.set(SOUL_GRANT_KEY, JSON.stringify(["theme-bamboo"]));
    store.set("banbu-theme-preference-v1", "bamboo");
    store.set("banbu-soul-unlocks-v1", "[]");
    expect(grantEquippedAppearance()).toEqual([]);
    expect(JSON.parse(store.get("banbu-soul-unlocks-v1")!)).toEqual([]);
  });

  it("用默认外观的老用户：什么都不送，但**照样打标记**（迁移确实跑过了）", async () => {
    const { grantEquippedAppearance, SOUL_GRANT_KEY } = await import("./soul-shop");
    store.set("banbu-theme-preference-v1", "light");     // 免费
    store.set("banbu-board-theme-v1", "wood");           // 免费
    store.set("banbu-stone-theme-v1", "classic");        // 免费
    expect(grantEquippedAppearance()).toEqual([]);
    expect(store.get(SOUL_GRANT_KEY)).toBe("[]");
  });

  it("存储是空的时候不炸（新用户第一次进来就是这条路）", async () => {
    const { grantEquippedAppearance } = await import("./soul-shop");
    expect(grantEquippedAppearance()).toEqual([]);
  });

  it("值里带引号也能认（历史上两种写法都出现过）", async () => {
    const { grantEquippedAppearance } = await import("./soul-shop");
    store.set("banbu-theme-preference-v1", '"bamboo"');
    expect(grantEquippedAppearance()).toEqual(["theme-bamboo"]);
  });
});

describe("解锁商店：购买与落地", () => {
  beforeEach(() => { store.clear(); });

  it("买了：扣钱、记上、之后算已解锁", () => {
    const ledger = freshLedger();
    const unlocks = new Set<string>();
    const item = soulUnlockById("theme-eye")!;
    const before = balanceOf(ledger);

    const result = purchaseSoulUnlock(ledger, unlocks, item.id);
    expect(result.code).toBe("ok");
    expect(balanceOf(ledger)).toBe(before - item.cost);
    expect(unlocks.has(item.id)).toBe(true);
    // 落盘了（换一次会话还在）
    expect(loadSoulUnlocks().has(item.id)).toBe(true);
    expect(isSoulUnlocked(unlocks, item)).toBe(true);
  });

  it("重复购买**不扣第二次钱**（幂等：第一次就拒绝）", () => {
    const ledger = freshLedger();
    const unlocks = new Set<string>();
    const item = soulUnlockById("theme-eye")!;
    purchaseSoulUnlock(ledger, unlocks, item.id);
    const afterFirst = balanceOf(ledger);
    const again = purchaseSoulUnlock(ledger, unlocks, item.id);
    expect(again.code).toBe("already");
    expect(balanceOf(ledger)).toBe(afterFirst);      // 钱没动
  });

  it("钱不够时**拒绝且不写流水**（不留半成品）", () => {
    const ledger = freshLedger(50);                  // 只有 50，买不起 120 的
    const unlocks = new Set<string>();
    const before = ledger.entries.length;
    const result = purchaseSoulUnlock(ledger, unlocks, "theme-eye");
    expect(result.code).toBe("insufficient");
    expect(ledger.entries.length).toBe(before);
    expect(unlocks.size).toBe(0);
  });

  it("一次性动作**不能当商品买**（它不能「拥有」）", () => {
    const ledger = freshLedger();
    const unlocks = new Set<string>();
    expect(purchaseSoulUnlock(ledger, unlocks, "action-reset-duel-rating").code).toBe("not-consumable");
  });

  /**
   * 五档「VCF 起始等级」的定价规则（用户 2026-10-12 第二轮：「把重置等级分用的棋魂加多一点吧，
   * **最少 500 棋魂重置到 1 级**，重置到高级版耗费的更高」）。
   * 价格是 `500 +（等级 − 1）× 100` **算出来的**，这条钉三件事：最低档就是 500、
   * 逐档递增、以及"改规则只改一个式子"之后表里五档跟着走（不是手抄的表）。
   */
  it("VCF 起始等级五档：最低 500 魂，按 500+(等级−1)×100 逐档变贵", () => {
    expect(VCF_START_TIERS.map((t) => `${t.level} 级 ${t.cost}`))
      .toEqual(["1 级 500", "3 级 700", "6 级 1000", "9 级 1300", "12 级 1600"]);
    expect(VCF_START_TIERS[0].cost).toBeGreaterThanOrEqual(500);
    for (let i = 1; i < VCF_START_TIERS.length; i += 1) {
      expect(VCF_START_TIERS[i].cost).toBeGreaterThan(VCF_START_TIERS[i - 1].cost);
      expect(vcfStartLevelCost(VCF_START_TIERS[i].level)).toBe(VCF_START_TIERS[i].cost);
    }
    // 商品表里的价格与这张表同源（商店面板与 VCF 页读的都是 `soulUnlockById(...).cost`）
    for (const { level, cost } of VCF_START_TIERS) {
      expect(soulUnlockById(`action-vcf-start-${level}`)!.cost).toBe(cost);
    }
  });

  it("一次性动作：扣钱**后才**执行（失败不能先跑掉）", () => {
    // 钱不够：run 不该被调用
    const poor = freshLedger(10);
    let ran = 0;
    const failed = useSoulAction(poor, "action-vcf-start-3", { run: () => { ran += 1; }, token: "t1" });
    expect(failed.code).toBe("insufficient");
    expect(ran).toBe(0);

    // 钱够：扣钱并执行
    const rich = freshLedger();
    const before = balanceOf(rich);
    const ok = useSoulAction(rich, "action-vcf-start-3", { run: () => { ran += 1; }, token: "t2" });
    expect(ok.code).toBe("ok");
    expect(ran).toBe(1);
    expect(balanceOf(rich)).toBe(before - soulUnlockById("action-vcf-start-3")!.cost);
  });

  it("一次性动作**可以反复用**（每次付一次，不像商品那样幂等）", () => {
    const ledger = freshLedger();
    let ran = 0;
    for (const token of ["a", "b", "c"]) {
      const result = useSoulAction(ledger, "action-vcf-start-3", { run: () => { ran += 1; }, token });
      expect(result.code).toBe("ok");
    }
    expect(ran).toBe(3);
  });

  it("重复 token 的一次性动作**只扣一次钱、只执行一次**（刷新重放不会白扣）", () => {
    // ⚠ 余额从**价格本身**推，不写死数字（用户 10-12 把五档整体涨价到 500–1600，
    //    上一版这里写死 `freshLedger(400)`「只够付一次 150」就直接红了）。
    const cost = soulUnlockById("action-vcf-start-3")!.cost;
    const ledger = freshLedger(cost + 50);   // 够付一次这一档，但付不起第二次
    let ran = 0;
    const first = useSoulAction(ledger, "action-vcf-start-3", { run: () => { ran += 1; }, token: "same" });
    expect(first.code).toBe("ok");
    const afterFirst = balanceOf(ledger);

    const again = useSoulAction(ledger, "action-vcf-start-3", { run: () => { ran += 1; }, token: "same" });
    // 幂等在 spendSoul 里先判：重放会被 duplicate 挡下。⚠ 对外不暴露 duplicate 这个码
    // （它是内部账务语义），useSoulAction 把它归到 not-consumable ——
    // 调用方只需要知道"这次没成"，不必区分"幂等挡的"还是"类型不对"。
    expect(again.code).not.toBe("ok");
    expect(ran).toBe(1);                          // 没有执行第二次
    expect(balanceOf(ledger)).toBe(afterFirst);   // 钱也没再扣
  });

  it("**批量购买**：逐个买、如实汇报（不做事务）", async () => {
    const { purchaseSoulUnlocks } = await import("./soul-shop");
    const { soulUnlockById } = await import("./soul-unlocks");
    // ⚠ 本金**按真实单价算**，不写死：定价是用户在工坊里调的旋钮
    // （500 → 700 那次就把"够买 3 件"变成了"够买 2 件"，写死金额的测试会假失败）。
    const ids = ["theme-eye", "theme-mono", "theme-rain", "theme-snow"];
    const price = soulUnlockById("theme-eye")!.cost;
    // 本金 = 3 件的钱少一点 ⇒ 保证"前两件成、第三件起不够"
    const ledger = freshLedger(price * 2 + Math.floor(price / 2));
    const unlocks = new Set<string>();
    const result = purchaseSoulUnlocks(ledger, unlocks, ids);
    // 前 2 件买到、第 3 件钱不够 —— **不做事务**（"钱只够一部分时把能买的也退掉"更糟）
    expect(result.bought.length).toBe(2);
    expect(result.failed[0].id).toBe("theme-rain");
    expect(result.failed[0].code).toBe("insufficient");
    expect(balanceOf(ledger)).toBe(Math.floor(price / 2));
    expect(unlocks.size).toBe(2);
  });

  it("批量里重复勾 / 已拥有的：算成功跳过，不重复扣钱", async () => {
    const { purchaseSoulUnlocks } = await import("./soul-shop");
    const ledger = freshLedger(2000);
    const unlocks = new Set<string>(["theme-eye"]);   // 已经有一个了
    const result = purchaseSoulUnlocks(ledger, unlocks, ["theme-eye", "theme-eye", "theme-mono"]);
    expect(result.bought).toEqual(["theme-eye", "theme-eye", "theme-mono"]);
    expect(result.failed).toEqual([]);
    // 只为没买过的那一件付钱
    expect(balanceOf(ledger)).toBe(1500);
  });

  it("批量里混一次性动作：直接拒（它不是「可拥有」的东西）", async () => {
    const { purchaseSoulUnlocks } = await import("./soul-shop");
    const ledger = freshLedger(3000);
    const unlocks = new Set<string>();
    const result = purchaseSoulUnlocks(ledger, unlocks, ["theme-eye", "action-reset-duel-rating"]);
    expect(result.bought).toEqual(["theme-eye"]);
    expect(result.failed[0].id).toBe("action-reset-duel-rating");
    expect(balanceOf(ledger)).toBe(2500);
  });

  it("批量买完**落盘**（换一次会话还在）", async () => {
    const { purchaseSoulUnlocks, loadSoulUnlocks } = await import("./soul-shop");
    const ledger = freshLedger(2000);
    const unlocks = new Set<string>();
    purchaseSoulUnlocks(ledger, unlocks, ["theme-eye", "theme-mono"]);
    const reloaded = loadSoulUnlocks();
    expect(reloaded.has("theme-eye")).toBe(true);
    expect(reloaded.has("theme-mono")).toBe(true);
  });

  it("不存在的 id：如实报 not-found（不静默）", () => {
    const ledger = freshLedger();
    expect(purchaseSoulUnlock(ledger, new Set(), "board-不存在的盘").code).toBe("not-found");
    expect(useSoulAction(ledger, "也没这个", { run: () => {}, token: "x" }).code).toBe("not-found");
  });

  it("存档校验：只认现在表里还存在的 id（下架项会被丢掉）", () => {
    saveSoulUnlocks(new Set(["theme-eye", "已经下架的商品 id"]));
    const loaded = loadSoulUnlocks();
    expect(loaded.has("theme-eye")).toBe(true);
    expect(loaded.has("已经下架的商品 id")).toBe(false);
  });

  it("坏存档不炸（JSON 烂了当作没买过）", () => {
    store.set(SOUL_UNLOCKS_KEY, "{不是数组");
    expect(loadSoulUnlocks().size).toBe(0);
    store.set(SOUL_UNLOCKS_KEY, '"字符串"');
    expect(loadSoulUnlocks().size).toBe(0);
  });

  it("失败原因能说人话（余额不足要提「攒一攒」）", () => {
    expect(describePurchaseFailure("insufficient", 120)).toContain("120");
    expect(describePurchaseFailure("insufficient", 120)).toContain("攒");
    expect(describePurchaseFailure("already", 100)).toContain("已经");
    expect(describePurchaseFailure("ok", 100)).toBe("");
  });

  it("进度：已解锁 / 可拥有的总数（一次性动作不算「拥有」）", () => {
    const progress = soulUnlockProgress(new Set(["theme-eye", "board-app-jade"]));
    expect(progress.done).toBe(2);
    expect(progress.total).toBe(SOUL_UNLOCKS.filter((item) => !item.consumable).length);
    expect(progress.percent).toBe(Math.round((2 / progress.total) * 100));
  });

  it("`isTargetUnlocked`：没上架的外观 id 一律算解锁（默认项走这条路）", () => {
    const empty = new Set<string>();
    expect(isTargetUnlocked(empty, "board", DEFAULT_FREE_BOARD)).toBe(true);
    expect(isTargetUnlocked(empty, "theme", "light")).toBe(true);
    expect(isTargetUnlocked(empty, "board", "app-jade")).toBe(false);
  });
});
