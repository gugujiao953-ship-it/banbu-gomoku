/**
 * 棋魂**解锁商店**（用户 2026-10-10：「可以去设置一些用棋魂的点了，比如重置等级分，
 * 选择等级分什么的，还有，外观那一块，除了默认棋盘默认棋子以外，都要棋魂解锁，
 * 主题也是，都要棋魂解锁这样的」）。
 *
 * ## 定价口径（用户原话就是口径）
 *
 * 「我们这个棋魂系统本质是增加可玩性的，不是去给他们束手束脚的，
 *  所以给的要大方，同时卖的也不能太贵。」
 *
 * 所以定成"给得松、卖得不贵"：日常一局 20 点、赢大师 100 点、成就 10–9999 点、
 * 连点无限刷；商城里最贵的单品也在**二三十局**的量级，不是几百局。
 * （⚠ 这些数字**会随工坊改**，别把这段当事实来源 —— 真值在 `soul-economy.ts`
 *  的来源表与下面的 `SOUL_PRICE_RULES` 里。写死在这里的说明迟早会过时，
 *  2026-10-11 就因为这段还写着"8 点 / 60 点 / 8–2026"而误导过一次。）
 *
 * ## 三条自律
 *
 *  ① **默认的永远免费**：默认主题（跟随系统 / 浅色 / 深色）、默认棋盘（原木）、
 *     默认棋子（经典）**永不收费** —— 收费的是"另一种样子"，不是"能不能用"。
 *  ② **不卖功能**：只卖外观与"重置类"便利，不卖提示、不卖答案、不卖胜率。
 *  ③ **解锁是一次性的**：买过就永久拥有（`banbu-soul-unlocks-v1`），
 *     换主题/换棋盘不影响、也不会重复收费。
 *
 * ## 价格是**算出来的**，不是手抄的一张表
 *
 * ⚠ 第一版我手写了 45 条 `{ target: "jade", cost: 300 }` —— 那是错的，而且错得很隐蔽：
 * `materialBoards()` 里实际有 **60 多个**材质 id（`app-wood`、`blue-abyss`、
 * `ripple-calm`、`bmo-pencil-berry`…），我手抄的那份只覆盖了一小半，
 * 剩下的会**静默地全部免费**。
 *
 * 所以现在改成：**外观项从注册表现遍历**（`materialBoards()` / `materialStones()` /
 * `THEME_OPTIONS`），价格由一个**规则函数**算（见 `priceOfBoard` 等）。
 * 这样新增材质时不需要动这个文件，也不会漏掉任何一项。
 */

import { THEME_OPTIONS } from "../../theme-options";
import { materialBoards, materialStones, RETIRED_BOARD_THEMES, RETIRED_STONE_THEMES } from "../../appearance/render";

/** 解锁项的分类：决定它在设置页哪一块出现、以及说明页怎么分组。 */
export type SoulUnlockKind = "theme" | "board" | "stone" | "action";

export interface SoulUnlock {
  /** 稳定 id。**发布后不可改**（存档里按它记"买过没有"）。 */
  id: string;
  kind: SoulUnlockKind;
  /** 界面上显示的标题（主题名 / 材质名 / 动作名）。 */
  title: string;
  /** 一句话（只在说明页与购买框里出现，界面上不占地方 —— 用户：「不要整说明」）。 */
  text: string;
  /** 售价（棋魂）。 */
  cost: number;
  /** 对应的外观 id（`kind` 为 theme/board/stone 时必填）。 */
  target?: string;
  /**
   * `true` = 一次性动作，**不能"拥有"**。
   *
   * 「重置等级分」这类就是：它不是一个可以永久拥有的东西，而是**每次使用付一次钱**。
   * 所以它不进解锁集合，走"当场扣费并执行"那条路（见 `soul-shop.ts` 的 `useSoulAction`）。
   * 混在一起会导致"买过一次就永久免费重置"。
   */
  consumable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// 定价规则
// ─────────────────────────────────────────────────────────────────────

/** 免费的默认项（用户：「除了默认棋盘默认棋子以外」）。 */
export const DEFAULT_FREE_THEMES: readonly string[] = ["system", "light", "dark", "custom"];
export const DEFAULT_FREE_BOARD = "wood";
export const DEFAULT_FREE_STONE = "classic";

/** 被点名删掉的材质（读档时会被归一化回默认）——不上架、也不收费。 */
const RETIRED_BOARDS = new Set(Object.keys(RETIRED_BOARD_THEMES).map((key) => `app-${key}`));
const RETIRED_STONES = new Set(Object.keys(RETIRED_STONE_THEMES).map((key) => `app-${key}`));

/**
 * 材质的价格规则：**按"这块东西有多费工"分档**，而不是逐个定价。
 *
 * 判据取三个能自动读出来的信号：
 *  · **有没有自带动效**（`motions.length`）—— 动效最费工，直接加到最高档；
 *  · **动效是不是"后做的那批"**（动效 id 带 `bmo-`/`smo-` 前缀）—— 见下面那条 ⚠；
 *  · **名字/分组里带"黑金/极光/敦煌/青花"这类词**的（视觉最重的几套）再加一档。
 *
 * 规则化而不是手写表的好处：**新增材质自动有价**，不会出现"漏写 = 白送"。
 *
 * ## ⚠ 这里曾经有一条永远不命中的判据（2026-10-10 修的）
 *
 * 第二档原来写的是 `input.src.startsWith("bmo-")`。但 `bmo-`/`smo-` 这两个前缀
 * **只出现在动效 id 上**（`bmo-pencil-forest`、`smo-pencil-forest`），
 * 材质的 `src` 是 `pencil-forest` / `app-blackgold` / `hard-08` 这种，**永远不带前缀**。
 * 实测 59 个材质：**src 命中 0 个，动效 id 命中 26 个**。
 * 也就是说那一行从来没生效过 —— 这批材质的加价实际全靠"有没有动效"那一条。
 *
 * 现在把判据挪到**动效 id** 上（那才是前缀真实所在的位置）。金额仍是
 * `SOUL_PRICE_RULES.newMaterialBonus`，所以调价照旧只改那一个数。
 *
 * ## 定价：**两档（500 / 700）**，规则从 `SOUL_PRICE_RULES` 算
 *
 * 历史：最早按"费工程度"分档（主题 120–300、棋盘 200–450、棋子 170–320），
 * 后来用户改成一口价 500（「我现在想的是，把这些外观的价格，全部加到500棋魂」），
 * 2026-10-11 又在工坊里调成**两档**：基础 500、中间与最重档 700。
 *
 * 口径没变：
 *  · **规则算出来**，不是手抄一张表 —— 所以新增材质不会漏（见上面那段教训）；
 *  · 与收入对表：赢一局 20、赢大师 100、解一题 10 起、成就 10–9999，
 *    连点魂火还能无限刷。500 大约"二十来局"、700 也就"三十来局"；
 *  · ⚠ 具体数额**别在这段里当事实**（这里写死过 8 / 60 / 8–2026 而全部过时了），
 *    真值看下面的 `SOUL_PRICE_RULES` 与 `soul-economy.ts` 的来源表。
 *
 * ⚠ 一次性动作（重置等级分那些）**不在此列**，它们仍是各自独立的价（见 ACTIONS）——
 * 那是"功能"不是"外观"，混进外观定价没有道理。
 */
/**
 * **定价参数**（2026-10-10 从写死的函数里提出来，好让「成就工坊」能调）。
 *
 * 为什么要单独成一个常量：下面三个 `priceOf*` 以前把档位加成、前缀加成、各档基础价
 * 都写死在函数体里 —— 那样工坊（`design-lab/achievement-workshop.html`）**读不到、改不了**，
 * 每次调价都得手改源码。提成一个字面量之后，工坊可以整块读写它，
 * 而计算逻辑仍然留在代码里（数字归数据、算法归代码，同 `soul-economy.ts` 的分界）。
 *
 * ⚠ **这里的数是"档位增量"不是"最终售价"**：最终价 = 该类的 base + 命中的各档增量。
 * 所以改一个增量会同时影响所有命中它的商品 —— 这是有意的（规则化定价的代价与好处）。
 */
export const SOUL_PRICE_RULES = {
  boardBase: 500,
  stoneBase: 500,
  motionBonus: 0,
  heavyBonus: 0,
  newMaterialBonus: 0,
  themePlain: 500,
  themeMid: 700,
  themeHeavy: 700,
};

/** 材质是不是"后做的那批"（动效 id 带 `bmo-`/`smo-` 前缀）。
 *  ⚠ 判的是**动效 id**，不是材质 `src` —— 前缀只存在于前者（详见上面那段注释）。 */
const hasNewMaterialMotion = (motions?: Array<{ id?: string }>) =>
  (motions ?? []).some((motion) => typeof motion?.id === "string" && /^(bmo|smo)-/.test(motion.id));

const priceFromSignals = (input: { src: string; motions: number; newMotion?: boolean; heavy?: boolean }, base: number): number => {
  let price = base;
  if (input.motions > 0) price += SOUL_PRICE_RULES.motionBonus;
  if (input.heavy) price += SOUL_PRICE_RULES.heavyBonus;
  if (input.newMotion) price += SOUL_PRICE_RULES.newMaterialBonus;
  return price;
};

/** 棋盘价格：基础价 + 命中的档位（见 `SOUL_PRICE_RULES`）。 */
const priceOfBoard = (m: { src: string; motions?: Array<{ id?: string }>; name: string; group?: string }) =>
  priceFromSignals(
    {
      src: m.src,
      motions: m.motions?.length ?? 0,
      newMotion: hasNewMaterialMotion(m.motions),
      heavy: /黑金|极光|敦煌|青花/.test(`${m.name}${m.group ?? ""}`),
    },
    SOUL_PRICE_RULES.boardBase,
  );

/** 棋子价格：基础价 + 命中的档位（见 `SOUL_PRICE_RULES`）。 */
const priceOfStone = (m: { src: string; motions?: Array<{ id?: string }>; name: string; group?: string }) =>
  priceFromSignals(
    {
      src: m.src,
      motions: m.motions?.length ?? 0,
      newMotion: hasNewMaterialMotion(m.motions),
      heavy: /黑金|极光|钻石|尊贵/.test(`${m.name}${m.group ?? ""}`),
    },
    SOUL_PRICE_RULES.stoneBase,
  );

/**
 * 主题价格：这套主题带多少"额外东西"决定。
 * 最朴素的几套（护眼 / 黑白极简）几乎零成本 → 最便宜那档；有背景装饰或动效的往上走。
 *
 * ⚠ 这两份名单**只决定"落哪一档"**，档位金额在 `SOUL_PRICE_RULES` 里。
 *    新增主题时如果没进这两份名单，会落到 `themePlain` 那档（不会漏定价，只是可能定低了）。
 */
const HEAVY_THEMES = new Set(["blackgold", "aurora", "cyber", "firefly", "kawaii", "jiangnan", "pixel", "deepsea", "baroque"]);
const MID_THEMES = new Set(["bamboo", "snow", "porcelain", "plum", "rice", "pelican", "dunhuang", "rain", "pale"]);
const priceOfTheme = (id: string): number => HEAVY_THEMES.has(id)
  ? SOUL_PRICE_RULES.themeHeavy
  : MID_THEMES.has(id) ? SOUL_PRICE_RULES.themeMid : SOUL_PRICE_RULES.themePlain;

// ─────────────────────────────────────────────────────────────────────
// 一次性动作
// ─────────────────────────────────────────────────────────────────────

/**
 * 一次性动作**手写**（它们是功能而不是资源，规则算不出来）。
 *
 * ## 五档「自选 VCF 起始等级」（2026-10-12 用户定稿）
 *
 * 用户原话：「要不还是搞成，1级，3级，6级，9级，12级吧，就是五个档位，
 *           每个档位要的棋魂都不一样，越高越多，1级最少。」
 *
 * 所以档位不再是"一个动作两件商品"（旧的 `action-reset-vcf-rating` 200 魂 +
 * `action-start-level` 500 魂自选），而是**五件独立商品**，一件一档。
 *
 * | 档位 | 等级 | 价格（10-12 第二轮） | 第一轮（已废） |
 * |---|---|---|---|
 * | 1 级 | 0 分 | **500**  | 50  |
 * | 3 级 | 600 分 | **700**  | 150 |
 * | 6 级 | 1500 分 | **1000** | 350 |
 * | 9 级 | 2400 分 | **1300** | 600 |
 * | 12 级 | 3300 分 | **1600** | 900 |
 *
 * 第二轮是用户 2026-10-12 当天改的口：「把重置等级分用的棋魂加多一点吧，**最少 500 棋魂
 * 重置到 1 级**，重置到高级版耗费的更高」。所以价格改成**算出来的规则**
 * `500 + (等级 − 1) × 100`（见 `vcfStartLevelCost`），不再手抄一张表 ——
 * 以后加档位/改步长只动那一个式子，五档自动跟着走。
 *
 * 递增的理由（用户「越高越多」）不变：越高档省下的爬坡越多，跳档等于把那段打过去。
 * 对照收入（真值见 `soul-economy.ts` 的 `SOUL_EARN_NOTE`，成就按级别给：1 级 10–30 … 4 级 200–9999）：
 * 一局对局约 20 魂、赢大师 100 魂 ⇒ 最低档 500 ≈ 二十来局，最高档 1600 ≈ 大师局十几局——
 * 比第一轮贵一个数量级，这正是他要的"别随手就跳级"。
 *
 * ⚠ **id 是存档键**（买过就记 `banbu-soul-unlocks-v1`）：发布后不可改；
 *   **价格不是键**，可以随轮次调（本轮就是只调价格、id 一个没动）。
 *   旧的三个 id（`action-reset-vcf-rating` / `action-start-level`）**已删**，
 *   老存档里那两条解锁记录会被当作"不认识的东西"忽略（不会崩，只是那两个按钮换成新五档）。
 */
/** 一档的定价规则（**唯一真值来源**）：500 起步，每高一级再加 100 魂。 */
export const vcfStartLevelCost = (level: number): number => 500 + (Math.max(1, level) - 1) * 100;
/** 五档的等级（1/3/6/9/12 级，用户 10-12 定稿）。 */
const VCF_START_LEVELS: ReadonlyArray<number> = [1, 3, 6, 9, 12];
/** 五档的等级与价格（**唯一真值来源**：商品、设置页标签、VCF 页定价全读它）。 */
export const VCF_START_TIERS: ReadonlyArray<{ level: number; cost: number }> =
  VCF_START_LEVELS.map((level) => ({ level, cost: vcfStartLevelCost(level) }));

const ACTIONS: readonly SoulUnlock[] = [
  {
    id: "action-reset-duel-rating",
    kind: "action",
    title: "重置人机等级分",
    // ⚠ 文案必须说"清空战绩"，不能说"战绩保留"。
    //
    // 上一版写的是"把等级分清回起点，战绩记录保留" —— 那是**错的**：
    // 人机等级分**不落盘**，是按 `duel-history` 的整条历史现推出来的
    // （见 duel-history.ts 的 `computeRatingTrack`）。所以"只清分、留战绩"
    // 物理上做不到 —— 实现里唯有一途是把战绩删了、分自然回到起点
    // （`SettingsPage` 的 `resetDuel` 调的正是 `clearDuelHistory()`）。
    text: "清空本机人机战绩，等级分随之一并回到起点（等级分由战绩推算，两者分不开）。",
    cost: 300,
    consumable: true,
  },
  /* 五档起始等级：一件一档（见上面 VCF_START_TIERS 的表） */
  ...VCF_START_TIERS.map(({ level, cost }) => ({
    id: `action-vcf-start-${level}`,
    kind: "action" as const,
    title: `VCF 起始等级 · ${level} 级`,
    text: `把解答力等级分直接设到 ${level} 级（约 ${level} 手题），不用从头爬。`,
    cost,
    consumable: true,
  })),
];

// ─────────────────────────────────────────────────────────────────────
// 组装
// ─────────────────────────────────────────────────────────────────────

/** 主题项：中文名从 `THEME_OPTIONS` 取（**不另抄一份**，见 theme-options.ts 的历史教训）。 */
const themeUnlocks: SoulUnlock[] = THEME_OPTIONS
  .filter(([id]) => !DEFAULT_FREE_THEMES.includes(id))
  .map(([id, label]) => ({
    id: `theme-${id}`,
    kind: "theme" as const,
    target: id,
    title: label,
    text: `${label}主题`,
    cost: priceOfTheme(id),
  }));

const boardUnlocks: SoulUnlock[] = materialBoards()
  .filter((m) => !RETIRED_BOARDS.has(m.src))
  // 默认盘（原木）免费 —— 材质里它叫 `app-wood`，所以按"去掉 app- 前缀"来判。
  .filter((m) => m.src.replace(/^app-/, "") !== DEFAULT_FREE_BOARD)
  .map((m) => ({
    id: `board-${m.src}`,
    kind: "board" as const,
    target: m.src,
    title: m.name,
    text: m.motions?.length ? `自带动效 · ${m.motions[0].name}` : (m.sub || m.group || "棋盘材质"),
    cost: priceOfBoard(m),
  }));

const stoneUnlocks: SoulUnlock[] = materialStones()
  .filter((m) => !RETIRED_STONES.has(m.src))
  .filter((m) => m.src.replace(/^app-/, "") !== DEFAULT_FREE_STONE)
  .map((m) => ({
    id: `stone-${m.src}`,
    kind: "stone" as const,
    target: m.src,
    title: m.name,
    text: m.motions?.length ? `自带动效 · ${m.motions[0].name}` : (m.sub || m.group || "棋子材质"),
    cost: priceOfStone(m),
  }));

/** 全部解锁项（动作 + 主题 + 棋盘 + 棋子）。 */
export const SOUL_UNLOCKS: readonly SoulUnlock[] = [
  ...ACTIONS,
  ...themeUnlocks,
  ...boardUnlocks,
  ...stoneUnlocks,
];

/** id → 项（查询用）。 */
const UNLOCK_INDEX = new Map(SOUL_UNLOCKS.map((item) => [item.id, item]));
export const soulUnlockById = (id: string): SoulUnlock | undefined => UNLOCK_INDEX.get(id);

/** 按**档位等级**取那件起始等级商品（VCF 页重置面板与设置页共用；找不到返回 undefined）。 */
export const vcfStartTierUnlock = (level: number): SoulUnlock | undefined =>
  UNLOCK_INDEX.get(`action-vcf-start-${level}`);

/**
 * 看某个外观 id 有没有上架。
 *
 * ⚠ **两种写法都要认**：材质注册表里是 `app-jade`，而旧存档/枚举里是 `jade`
 * （`LEGACY_BOARD_THEMES`）。设置页两种值都可能传进来，只认一种就会漏掉一半。
 * 所以这里原样查一次、去掉 / 补上 `app-` 前缀再各查一次。
 */
export const soulUnlockForTarget = (kind: SoulUnlockKind, target: string): SoulUnlock | undefined => {
  const bare = target.replace(/^app-/, "");
  for (const candidate of [target, bare, `app-${bare}`]) {
    const found = UNLOCK_INDEX.get(`${kind}-${candidate}`);
    if (found) return found;
  }
  return undefined;
};

/** 说明页的「能花在哪」分组（商店条目很多，平铺会很长）。 */
export const SOUL_UNLOCK_GROUPS: ReadonlyArray<{ kind: SoulUnlockKind; title: string; summary: string }> = [
  { kind: "action", title: "一次性动作", summary: "用一次付一次，不拥有" },
  { kind: "theme", title: "外观主题", summary: "换整身的配色与氛围" },
  { kind: "board", title: "棋盘材质", summary: "换盘面本身" },
  { kind: "stone", title: "棋子材质", summary: "换棋子的样子" },
];

/** 说明页统计用：各类各有多少项、总价多少（让用户知道"全收下要攒多久"）。 */
export const soulUnlockStats = () => {
  const ownable = SOUL_UNLOCKS.filter((item) => !item.consumable);
  const totalCost = ownable.reduce((sum, item) => sum + item.cost, 0);
  const cheapest = ownable.reduce((min, item) => Math.min(min, item.cost), Number.POSITIVE_INFINITY);
  const priciest = ownable.reduce((max, item) => Math.max(max, item.cost), 0);
  return { count: ownable.length, totalCost, cheapest: Number.isFinite(cheapest) ? cheapest : 0, priciest };
};
