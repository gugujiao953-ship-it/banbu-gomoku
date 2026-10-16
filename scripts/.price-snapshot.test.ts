// @vitest-environment jsdom
/**
 * 生成 `design-lab/soul-price-table.js`：**外观售价的对照快照**。
 *
 * 为什么需要它：售价是**算出来的**（基价 + 命中档位），不是一张手写表。
 * 工坊要显示"这 8 个数字算出来的实际售价是多少"，就得知道每个材质
 * **命中了哪几档**（有没有动效 / 是不是重材质 / 落哪个主题档）。
 * 那些信息只有跑起来才拿得到（要看材质注册表），所以在这里算一次、导成数据。
 *
 * ⚠ 它是**对照表不是数据源**：真正的数据源是 `soul-unlocks.ts` 的规则。
 * 工坊会拿当前编辑中的规则**重新套一遍这些标记**来算价，所以改了数字能立刻看到新价。
 * 材质清单变化（新增/删除材质）后要重跑本脚本：
 *   npx vitest run scripts/.price-snapshot.test.ts
 */
import { describe, it } from "vitest";
import fs from "node:fs";
import { SOUL_UNLOCKS, soulUnlockStats, SOUL_PRICE_RULES } from "../src/features/progress/soul-unlocks";
import { VCF_ITEMS } from "../src/features/vcf-challenge/items";
import { materialBoards, materialStones } from "../src/appearance/render";

/** 把材质 id 归一成 `soul-unlocks.ts` 里那种 `kind-target` 形式，好和 SOUL_UNLOCKS 对上。 */
const norm = (src: string) => src.replace(/^app-/, "");

const HEAVY_BOARD = /黑金|极光|敦煌|青花/;
const HEAVY_STONE = /黑金|极光|钻石|尊贵/;
const HEAVY_THEMES = new Set(["blackgold", "aurora", "cyber", "firefly", "kawaii", "jiangnan", "pixel", "deepsea", "baroque"]);
const MID_THEMES = new Set(["bamboo", "snow", "porcelain", "plum", "rice", "pelican", "rain", "pale"]);

describe("price snapshot", () => {
  it("dump", () => {
    // 材质侧：记录"命中哪几档"，供工坊按新规则重算。
    // ⚠ `newMotion` 判的是**动效 id**（`bmo-*` / `smo-*`），不是材质 `src`。
    //   源码在 2026-10-10 修过一次：原来判 src，而 src 永远不带那个前缀（实测 59 个材质
    //   src 命中 0 / 动效 id 命中 26），那条规则从来没生效过。现在两个位置都要算对。
    const materialFlags = new Map<string, { motions: boolean; newMotion: boolean; heavy: boolean }>();
    for (const m of materialBoards()) {
      materialFlags.set(`board-${m.src}`, {
        motions: (m.motions?.length ?? 0) > 0,
        newMotion: (m.motions ?? []).some((x) => /^(bmo|smo)-/.test(x.id)),
        heavy: HEAVY_BOARD.test(`${m.name}${m.group ?? ""}`),
      });
    }
    for (const m of materialStones()) {
      materialFlags.set(`stone-${m.src}`, {
        motions: (m.motions?.length ?? 0) > 0,
        newMotion: (m.motions ?? []).some((x) => /^(bmo|smo)-/.test(x.id)),
        heavy: HEAVY_STONE.test(`${m.name}${m.group ?? ""}`),
      });
    }

    const rows = SOUL_UNLOCKS.map((u) => {
      const flags = materialFlags.get(u.id);
      const row: Record<string, unknown> = {
        id: u.id, kind: u.kind, title: u.title, cost: u.cost, consumable: Boolean(u.consumable),
      };
      if (u.kind === "theme") {
        row.tier = HEAVY_THEMES.has(u.target ?? "") ? "heavy" : MID_THEMES.has(u.target ?? "") ? "mid" : "plain";
      } else if (flags) {
        row.motions = flags.motions;
        row.newMotion = flags.newMotion;
        row.heavy = flags.heavy;
      }
      return row;
    });

    /**
     * ⚠ 两份数据都**不带时间戳**：这份文件是"按当前材质清单算出来的对照表"，
     * 内容由源码唯一决定。带上生成时间的话，每跑一次测试文件就变一次
     * （git 里满是无意义的 diff，而且"文件变了"会掩盖"内容真的变了"）。
     *
     * 也正因为它只由源码决定，这里做的是**只在内容变化时才写盘**：
     * 没变就不碰文件 —— 于是跑测试不会把工作区弄脏。
     */
    const payload = {
      rules: SOUL_PRICE_RULES,
      stats: soulUnlockStats(),
      unlocks: rows,
      items: VCF_ITEMS.map((i) => ({ id: i.id, name: i.name, cost: i.cost, amount: i.amount, unit: i.unit })),
    };
    const header = `// 由 scripts/.price-snapshot.test.ts 生成 —— 外观售价的对照快照，不是数据源。\n`
      + `// 数据源是 src/features/progress/soul-unlocks.ts 的 SOUL_PRICE_RULES（工坊可改那个）。\n`
      + `// 这里的 motions/heavy/tier 标记是"这个商品命中哪几档"，让工坊能按新规则重算售价。\n`
      + `// 材质清单变化后重新生成：npx vitest run scripts/.price-snapshot.test.ts\n`;
    const out = `${header}window.SOUL_PRICE_TABLE = ${JSON.stringify(payload, null, 2)};\n`;
    const target = "design-lab/soul-price-table.js";
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    // 只比正文（跳过 header 注释：那几行是给读文件的人看的，不影响数据）
    const bodyOf = (text: string) => text.slice(text.indexOf("window.SOUL_PRICE_TABLE"));
    if (bodyOf(existing) === bodyOf(out)) {
      console.log("design-lab/soul-price-table.js 已是最新（未改动文件）");
    } else {
      fs.writeFileSync(target, out, "utf8");
      console.log("已写出 design-lab/soul-price-table.js：", rows.length, "项，其中带档位标记的",
        rows.filter((r) => r.motions !== undefined || r.tier !== undefined).length, "项");
    }
  });
});
