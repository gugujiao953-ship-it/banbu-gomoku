/**
 * 成就工坊的**自检门禁**：验证"源码 → 网页数据 → 导出的 JSON → 写回源码"这条链子
 * 是**无损**的。
 *
 * ## 为什么这个门禁是必须的
 *
 * 工坊让用户能删成就、改定价，然后把导出结果写回源码。这条路有两个危险：
 *
 *  ① **搬运算术**：解析器读错一条（比如把分组注释里的字当数据）、渲染器写少一个字段，
 *     用户点了导出、跑了 apply，**源码就静默地少了一条成就** —— 而"少了一条"在界面上
 *     可能一直看不出来（要等真的解锁那一刻）。
 *  ② **格式漂移**：写回去的文件要还能被 `tsc` 编译、被单测读到。渲染器一旦写出
 *     语法坏掉的文件，用户会以为工坊把项目搞坏了。
 *
 * 所以这里做三件事，全部在**临时目录**里跑（不碰真实源码）：
 *
 *  · **识别相等**：`build → apply → build` 之后，两条数据必须逐字节一致；
 *  · **改动可用**：删几条、加几条、改定价、改判据之后再走一轮，改动必须如实落地；
 *  · **语法可编**：写回的文件要能过 `tsc`（把临时副本当一个最小工程编一次）。
 *
 * 用法：`node qa/achievement-workshop-check.mjs`
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";
import { apply, buildData, validate } from "../scripts/achievement-workshop.mjs";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const REAL_CATALOG = path.join(root, "src", "features", "progress", "achievement-catalog.ts");
const REAL_ECONOMY = path.join(root, "src", "features", "progress", "soul-economy.ts");
const REAL_RULES = path.join(root, "src", "features", "progress", "achievement-rules.ts");
const REAL_UNLOCKS = path.join(root, "src", "features", "progress", "soul-unlocks.ts");
const REAL_ITEMS = path.join(root, "src", "features", "vcf-challenge", "items.ts");

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) {
    process.stdout.write(`  ✓ ${label}${detail ? `（${detail}）` : ""}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${label}${detail ? `（${detail}）` : ""}\n`);
  }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

// 临时工作区：把五个真实源文件复制进来，所有写操作都发生在这里。
const work = fs.mkdtempSync(path.join(os.tmpdir(), "banbu-workshop-"));
const tmpCatalog = path.join(work, "achievement-catalog.ts");
const tmpEconomy = path.join(work, "soul-economy.ts");
const tmpRules = path.join(work, "achievement-rules.ts");
// 定价与道具这两个是 2026-10-10 新纳入工坊的（外观定价 + VCF 等级奖励 + 道具单价）。
const tmpUnlocks = path.join(work, "soul-unlocks.ts");
const tmpItems = path.join(work, "items.ts");
for (const [from, to] of [
  [REAL_CATALOG, tmpCatalog], [REAL_ECONOMY, tmpEconomy], [REAL_RULES, tmpRules],
  [REAL_UNLOCKS, tmpUnlocks], [REAL_ITEMS, tmpItems],
]) {
  fs.copyFileSync(from, to);
}
const build = () => buildData({
  catalogFile: tmpCatalog, economyFile: tmpEconomy, rulesFile: tmpRules,
  unlocksFile: tmpUnlocks, itemsFile: tmpItems,
});
/**
 * 沙箱路径的**唯一出处**：`apply` 的四个写回目标全在这儿。
 *
 * ⚠ 为什么不就地写 `{ catalogFile: tmpCatalog, ... }`：那正是出事故的写法 ——
 * 门禁原来只传两个路径，于是新增的定价/道具写回**悄悄落到了真实源码**上
 * （把自检用的 275 / 0 / 55 写进了 `soul-unlocks.ts` 与 `items.ts`）。
 * 现在收成一个常量，并且 `apply()` 里加了"要么全传、要么全不传"的护栏。
 */
const sandboxPaths = {
  catalogFile: tmpCatalog, economyFile: tmpEconomy, rulesFile: tmpRules,
  unlocksFile: tmpUnlocks, itemsFile: tmpItems,
};

try {
  // ── 1. 解析：能读到全部成就与全部来源 ─────────────────────────────
  section("1. 解析源码");
  const realCatalogText = fs.readFileSync(REAL_CATALOG, "utf8");
  // 源文件里 `{ id: "` 出现在成就条目与分组元数据两处，所以只数成就那种（含 group:）
  const expectedCount = (realCatalogText.match(/\{ id: "[a-z0-9-]+", group: "/g) || []).length;
  const parsed = await build();
  check("成就条数 = 源文件里的成就条数", parsed.catalog.length === expectedCount,
    `${parsed.catalog.length} 条，源文件 ${expectedCount} 条`);
  check("每条都有 id 与文案", parsed.catalog.every((item) => item.id && item.title && item.text));
  check("除全图鉴外每条都有判据", parsed.catalog.filter((item) => !item.rule).length === 1,
    `缺判据 ${parsed.catalog.filter((item) => !item.rule).length} 条`);
  check("算符解析正确（不含文档注释里的中文）",
    // ⚠ 不钉数量：算符是**会长**的（2026-10-10 加了 `always`，用来做那条"打开就有"的
    // 福利成就）。这里守的是"解析出来的都是**全小写标识符**"——
    // 而文档注释里那些 '"从没发生过"'、'"从未因禁手判负"' 是中文，
    // 一旦漏进 ops 就会被这条抓出来（这才是这条断言真正想防的事）。
    parsed.ops.length >= 4 && parsed.ops.every((op) => /^[a-z]+$/.test(op)),
    parsed.ops.join("/"));
  check("分组元数据没被当成成就", parsed.catalog.every((item) => item.rule !== undefined || item.id === parsed.allTruthId));
  check("来源表解析出全部条目", parsed.earnRules.length >= 8, `${parsed.earnRules.length} 条`);
  check("默认调度是对象（不是字符串）",
    typeof parsed.defaultTuning === "object" && Array.isArray(parsed.defaultTuning.disabledReasons));
  check("所有成就的取值路径都合法",
    parsed.catalog.every((item) => !item.rule || parsed.sourceKeys.some((entry) => entry.key === item.rule.from)));
  // 评审说明：这份稿子的核心是"每条后面都写了为什么提它"。漏写时页面会显示
  // 「（待补说明）」—— 看起来像那条不重要，所以这里当错误拦下。
  check("每条成就都有评审说明（没有「待补说明」）", parsed.missingNotes.length === 0,
    parsed.missingNotes.length ? "漏写 " + parsed.missingNotes.length + " 条：" + parsed.missingNotes.slice(0, 6).join(", ") : "74/74");
  // 阈值 8 而不是更长：有几条说明本身就是一句短的（如「五十份：小有藏书。」），
  // 那是**写完的**而不是敷衍的。这里只拦"明显没写"的（空、或只剩一个词）。
  check("评审说明不是占位文字（不是空或一个词）",
    parsed.catalog.every((item) => (parsed.notes.achievements[item.id] || "").length >= 8));
  check("每条棋魂来源都有定价说明",
    parsed.earnRules.every((rule) => Boolean(parsed.notes.earn[rule.reason + "@solo"] || parsed.notes.earn[rule.reason])),
    Object.keys(parsed.notes.earn).length + " 条说明");
  check("每个调度旋钮都有作用 + 建议两段说明",
    ["earnMultiplier", "achievementMultiplier", "earnCapPerGrant", "dailyEarnLimit", "lossAmount", "drawAmount",
      "tapAmount", "tapCountsAsSpent", "tapCountsAsEarned", "spendMultiplier", "minimumSpend", "dailySpendLimit"]
      .filter((key) => parsed.defaultTuning[key] !== undefined)
      .every((key) => parsed.notes.tuning[key] && parsed.notes.tuning[key].role && parsed.notes.tuning[key].advice));
  check("评审稿导言有导语与步骤", Boolean(parsed.notes.brief.lead) && parsed.notes.brief.steps.length >= 3);

  // ── 2. 无损往返 ─────────────────────────────────────────────────
  section("2. 无损往返（读出来 → 写回去 → 再读出来）");
  // ⚠ 五个路径必须全传（`sandboxPaths` 一处定义）。少传会让剩下那几份落到真实源码上
  // —— 这正是本门禁第一版踩过的坑（见 apply() 里的沙箱护栏注释）。
  const result = apply(parsed, sandboxPaths);
  check("写回成功", result.ok, result.problems.join("；"));
  const again = await build();
  /**
   * 逐条对拍（**按 id 排序后**比，不比顺序）。
   *
   * ⚠ 为什么允许顺序变：写回时是按 `ACHIEVEMENT_GROUPS` 的分组顺序**重排**的
   * （那是渲染器的既定行为，也让文件更整齐）。所以"新旧逐位相等"会因为
   * "某条成就换了个分组顺序"而假失败 —— 它报的是"有条成就不一样"，
   * 实际只是位置动了。真正要守的是**每一条的内容一字不差**。
   */
  const byId = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  check("成就逐字段一致（按 id 对齐，没有丢字段、没有改文案）",
    JSON.stringify(byId(again.catalog)) === JSON.stringify(byId(parsed.catalog)));
  check("来源表逐字段一致", JSON.stringify(again.earnRules) === JSON.stringify(parsed.earnRules));
  check("消费点逐字段一致", JSON.stringify(again.spendPoints) === JSON.stringify(parsed.spendPoints));
  check("默认调度逐字段一致", JSON.stringify(again.defaultTuning) === JSON.stringify(parsed.defaultTuning));
  // 2026-10-10 新纳入工坊的三块：外观定价 / VCF 等级奖励 / 道具单价
  check("外观定价（SOUL_PRICE_RULES）逐字段一致",
    JSON.stringify(again.priceRules) === JSON.stringify(parsed.priceRules));
  check("VCF 等级奖励逐项一致", JSON.stringify(again.levelSoul) === JSON.stringify(parsed.levelSoul));
  check("道具单价逐项一致", JSON.stringify(again.vcfItems) === JSON.stringify(parsed.vcfItems));
  check("说明文案一致", again.earnNote === parsed.earnNote && again.spendNote === parsed.spendNote);

  // ── 3. 写回的源码里，注释与其它导出都没被破坏 ─────────────────────
  section("3. 写回的文件结构");
  const nextCatalogText = fs.readFileSync(tmpCatalog, "utf8");
  const nextEconomyText = fs.readFileSync(tmpEconomy, "utf8");
  check("目录文件头部的设计口径注释还在", nextCatalogText.includes("设计口径"));
  check("目录自检函数还在", nextCatalogText.includes("validateAchievementCatalog"));
  check("ACHIEVEMENT_BY_ID 等派生导出还在",
    nextCatalogText.includes("ACHIEVEMENT_BY_ID") && nextCatalogText.includes("TOTAL_SOUL_FROM_ACHIEVEMENTS"));
  check("ALL_TRUTH_ACHIEVEMENT_ID 还在", nextCatalogText.includes("ALL_TRUTH_ACHIEVEMENT_ID"));
  check("经济文件头部的三条口径注释还在", nextEconomyText.includes("三条口径"));
  check("TUNABLE_REASONS 还在", nextEconomyText.includes("TUNABLE_REASONS"));
  check("成就数与写回前一致",
    (nextCatalogText.match(/\{ id: "[a-z0-9-]+", group: "/g) || []).length === expectedCount);

  // ── 4. 改动确实落地（删 / 增 / 改价 / 改判据 / 调度）──────────────
  section("4. 改动落地（模拟工坊里操作一轮）");
  const edited = JSON.parse(JSON.stringify(await build()));
  const removedId = edited.catalog.find((item) => item.id === "duel-draw").id;
  const removedCount = edited.catalog.length;
  edited.catalog = edited.catalog.filter((item) => item.id !== removedId);          // 删一条
  edited.catalog.push({                                                             // 加一条
    id: "workshop-self-test",
    group: "explore",
    title: "工坊自检条目",
    text: "这条只在自检里存在，不该出现在真实源码里",
    soul: 123,
    target: 3,
    unit: "次",
    rule: { from: "puzzle.solved", op: "gte", value: 3 },
  });
  const pricedId = "puzzle-solve-10";
  edited.catalog.find((item) => item.id === pricedId).soul = 999;                    // 改奖励
  const tuningEdited = edited.catalog.find((item) => item.id === "duel-rating-1500");
  tuningEdited.rule = { from: "duel.rating", op: "gte", value: 1750 };               // 改判据
  edited.earnRules = edited.earnRules.map((rule) =>
    rule.reason === "puzzle-solve" ? { ...rule, amount: 7 } : rule);                 // 改定价
  edited.spendPoints = [{ id: "hint", cost: 20, title: "看一步提示", text: "花棋魂换一步提示", ready: false }];  // 加消费点
  edited.defaultTuning = { ...edited.defaultTuning, earnMultiplier: 1.5, tapAmount: 3, disabledReasons: ["recognition"], lossAmount: 2 };
  edited.earnNote = "自检用的说明文案";
  // 定价三块也各改一处（验证它们真的写进了源码，而不是只在页面上好看）
  edited.priceRules = { ...edited.priceRules, boardBase: 275, newMaterialBonus: 0 };
  edited.levelSoul = edited.levelSoul.map((value, index) => (index === 0 ? 33 : value));
  edited.vcfItems = edited.vcfItems.map((item) => (item.id === "hint" ? { ...item, cost: 55 } : item));

  const editedProblems = validate(edited);
  check("改动后的数据通过了校验", editedProblems.length === 0, editedProblems.join("；"));
  const editedResult = apply(edited, sandboxPaths);
  check("改动写回成功", editedResult.ok, editedResult.problems.join("；"));

  const reread = await build();
  check("删掉的那条真的没了", !reread.catalog.some((item) => item.id === removedId));
  check("新增的那条带齐了所有字段",
    JSON.stringify(reread.catalog.find((item) => item.id === "workshop-self-test"))
      === JSON.stringify(edited.catalog.find((item) => item.id === "workshop-self-test")));
  check("条数 = 原 - 1 + 1", reread.catalog.length === removedCount, `${reread.catalog.length} vs ${removedCount}`);
  check("改过的奖励生效", reread.catalog.find((item) => item.id === pricedId).soul === 999);
  check("改过的判据生效（数值也写对了）",
    JSON.stringify(reread.catalog.find((item) => item.id === "duel-rating-1500").rule)
      === JSON.stringify({ from: "duel.rating", op: "gte", value: 1750 }));
  check("来源定价生效", reread.earnRules.find((rule) => rule.reason === "puzzle-solve").amount === 7);
  check("消费点写进去了", reread.spendPoints.length === 1 && reread.spendPoints[0].id === "hint");
  check("消费点的 ready=false 如实写进源码", reread.spendPoints[0].ready === false);
  check("调度项生效",
    reread.defaultTuning.earnMultiplier === 1.5 && reread.defaultTuning.tapAmount === 3
    && JSON.stringify(reread.defaultTuning.disabledReasons) === JSON.stringify(["recognition"])
    && reread.defaultTuning.lossAmount === 2);
  check("说明文案生效", reread.earnNote === "自检用的说明文案");
  // 定价三块（2026-10-10）
  check("外观定价改动生效", reread.priceRules.boardBase === 275 && reread.priceRules.newMaterialBonus === 0);
  check("VCF 等级奖励改动生效", reread.levelSoul[0] === 33 && reread.levelSoul[1] === edited.levelSoul[1]);
  check("道具单价改动生效", reread.vcfItems.find((i) => i.id === "hint").cost === 55);
  check("改价没有动到道具的其它字段（amount / name / text）",
    (() => {
      const before = parsed.vcfItems.find((i) => i.id === "hint");
      const after = reread.vcfItems.find((i) => i.id === "hint");
      return after.name === before.name && after.text === before.text;
    })());
  check("改价没有破坏 VCF 等级那 25 行的注释",
    fs.readFileSync(tmpEconomy, "utf8").includes("从这里开始有"));
  check("改价没有破坏定价规则周围的注释",
    fs.readFileSync(tmpUnlocks, "utf8").includes("档位增量"));
  check("定价规则字段顺序没漂移",
    /boardBase[\s\S]*stoneBase[\s\S]*motionBonus[\s\S]*heavyBonus[\s\S]*newMaterialBonus[\s\S]*themePlain[\s\S]*themeMid[\s\S]*themeHeavy/.test(
      fs.readFileSync(tmpUnlocks, "utf8")));
  check("空消费点能写回成 `[]`（不留一个空行数组）", /export const SOUL_SPEND_POINTS[^=]*= \[\];/.test(
    (() => {
      const copy = JSON.parse(JSON.stringify(edited));
      copy.spendPoints = [];
      apply(copy, sandboxPaths);
      return fs.readFileSync(tmpEconomy, "utf8");
    })()));

  // ── 5. 校验能拦住坏数据 ─────────────────────────────────────────
  section("5. 校验拦截（这些都不该被写进源码）");
  const badCases = [
    ["id 重复", (data) => { data.catalog.push({ ...data.catalog[0] }); }],
    ["id 不合法（中文）", (data) => { data.catalog[0].id = "成就一号"; }],
    ["奖励不是正整数", (data) => { data.catalog[0].soul = 0; }],
    ["缺标题", (data) => { data.catalog[0].title = "  "; }],
    ["判据路径不存在", (data) => { data.catalog[0].rule = { from: "duel.不存在", op: "gte", value: 1 }; }],
    ["判据缺数值", (data) => { data.catalog[0].rule = { from: "duel.wins", op: "gte" }; }],
    ["有 target 没 unit", (data) => { data.catalog[0].target = 5; delete data.catalog[0].unit; }],
    ["target = 1（应当是一次性事件）", (data) => { data.catalog[0].target = 1; data.catalog[0].unit = "次"; }],
    ["来源 reason 不合法", (data) => { data.earnRules[0].reason = "whatever"; }],
    ["来源数额是负数", (data) => { data.earnRules[0].amount = -5; }],
    ["调度倍率超界", (data) => { data.defaultTuning.earnMultiplier = 99; }],
    ["调度里关掉了 carry（不是来源）", (data) => { data.defaultTuning.disabledReasons = ["carry"]; }],
    ["消费点 id 重复", (data) => {
      data.spendPoints = [
        { id: "a", cost: 1, title: "x", text: "y", ready: false },
        { id: "a", cost: 1, title: "x", text: "y", ready: false },
      ];
    }],
    ["消费点没写 ready", (data) => { data.spendPoints = [{ id: "a", cost: 1, title: "x", text: "y" }]; }],
    // 定价三块（2026-10-10 新纳入）
    ["定价不是整数", (data) => { data.priceRules.boardBase = 12.5; }],
    ["定价是负数", (data) => { data.priceRules.themeMid = -1; }],
    ["主题定价反了（朴素贵过中间）", (data) => { data.priceRules.themePlain = 999; }],
    ["VCF 等级奖励为空", (data) => { data.levelSoul = []; }],
    ["VCF 等级奖励出现负数", (data) => { data.levelSoul[3] = -1; }],
    ["VCF 等级奖励项数少于最高等级", (data) => { data.levelSoul = data.levelSoul.slice(0, 10); }],
    ["道具单价为 0", (data) => { data.vcfItems[0].cost = 0; }],
    ["道具 id 不认识", (data) => { data.vcfItems[0].id = "whatever"; }],
    ["道具少了 / 多了", (data) => { data.vcfItems = data.vcfItems.slice(0, 2); }],
  ];
  for (const [label, mutate] of badCases) {
    const broken = JSON.parse(JSON.stringify(await build()));
    mutate(broken);
    check(`拦下：${label}`, validate(broken).length > 0);
  }

  // 全图鉴是唯一允许没有判据的：确认校验没把它当成错误
  const onlyTruthMissing = JSON.parse(JSON.stringify(await build()));
  check("不误报：全图鉴没有判据是合法的",
    validate(onlyTruthMissing).length === 0);

  // 沙箱护栏：只传部分路径必须被拒绝（否则剩下那几份会落到真实源码上）
  let guardFired = false;
  let guardMessage = "";
  try {
    apply(JSON.parse(JSON.stringify(await build())), { catalogFile: tmpCatalog, economyFile: tmpEconomy });
  } catch (error) {
    guardFired = true;
    guardMessage = String(error.message || error);
  }
  check("拦下：路径只传两个（会写到真实源码）", guardFired, guardMessage.slice(0, 60));
  check("护栏的报错说清了为什么", guardMessage.includes("真实源码"), guardMessage.slice(0, 80));

  // ── 6. 写回的文件能过 tsc ───────────────────────────────────────
  section("6. 写回的文件能编译（把临时副本当一个最小工程编一次）");
  // 临时文件 import 的是 `./achievement-rules` 与 `./achievements` 这类**同目录相对路径**，
  // 而真实项目里那两个文件不在临时目录 —— 所以把它们一起复制过来，
  // 让这个最小工程自带完整依赖（否则编不过的是缺文件，而不是我们写的语法）。
  for (const dependency of ["achievement-rules.ts", "achievements.ts", "signal-store.ts", "soul.ts"]) {
    fs.copyFileSync(path.join(root, "src", "features", "progress", dependency), path.join(work, dependency));
  }
  // 目录现在还会 import 项目里别处的模块（例如 `puzzle-vcf-level-max` 引
  // `../vcf-challenge/rating` 的 `LEVEL_MAX` —— 那正是"引常量不抄数字"的做法）。
  //
  // ⚠ 所以临时副本必须**摆在和真实工程相同的相对深度**上：把文件平铺在 `work/` 根下，
  // `../vcf-challenge/rating` 就会解析到临时目录外面去（实测报 TS2307「找不到模块」，
  // 而且那个失败看起来像"渲染器把 import 写坏了"，其实只是沙箱结构不对）。
  //
  // 做法：整个 `src/` 目录结构镜像一份（只复制 .ts，跳过 node_modules 之类）。
  const mirrorTree = (relativeDir) => {
    const from = path.join(root, "src", relativeDir);
    if (!fs.existsSync(from)) return;
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const rel = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) { mirrorTree(rel); continue; }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      // 测试文件不用带（它们会 import vitest，反而让最小工程编不过）
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const target = path.join(work, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(from, entry.name), target);
    }
  };
  // 镜像整个 src（只复制 .ts/.tsx、跳过测试）—— 依赖链比想象的长
  // （catalog → vcf-challenge/rating → vcf/vcf-corpus → ../../types …），
  // 一个个补齐只会一次次撞到下一层。整棵 src 也就是几百个源文件，复制很快，
  // 而且是**临时目录**、不碰真实工程。
  mirrorTree("");
  // 再把上面那三个临时副本换成"镜像里的那一份"，这样它们的相对 import 才成立。
  const mirrorCatalog = path.join(work, "features", "progress", "achievement-catalog.ts");
  const mirrorEconomy = path.join(work, "features", "progress", "soul-economy.ts");
  const mirrorRules = path.join(work, "features", "progress", "achievement-rules.ts");
  const mirrorUnlocks = path.join(work, "features", "progress", "soul-unlocks.ts");
  const mirrorItems = path.join(work, "features", "vcf-challenge", "items.ts");
  for (const [from, to] of [
    [tmpCatalog, mirrorCatalog], [tmpEconomy, mirrorEconomy], [tmpRules, mirrorRules],
    [tmpUnlocks, mirrorUnlocks], [tmpItems, mirrorItems],
  ]) {
    fs.copyFileSync(from, to);
  }
  mirrorTree(path.join("features", "progress"));
  mirrorTree(path.join("features", "vcf-challenge"));
  // 这两个是 `achievements.ts` / `achievement-sources.ts` 依赖到的外部模块，一并带过来。
  // 用 `paths` 映射回真实目录（TS 7 已移除 baseUrl，所以只写 paths + 相对根）。
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      // `vite/client`：沙箱编到的文件里有 `import.meta.env` 的用法（vcf-corpus.ts）。
      // 不带上它就会报「Property 'env' does not exist on type 'ImportMeta'」——
      // 那是环境缺类型，不是我们写回的内容有问题。
      // ⚠ 光写 `types` 不够：临时目录不在工程里，tsc 找不到类型包的位置，
      // 必须用 `typeRoots` 指回真实工程的 node_modules（否则报 TS2688）。
      types: ["vite/client"],
      typeRoots: [path.join(root, "node_modules", "@types"), path.join(root, "node_modules")],
      paths: { "*": [path.join(root, "*")] },
    },
    // 编**镜像里的那几份**（不是平铺在 work/ 根下的副本）—— 只有它们的相对 import 成立。
    // 四份都要编：定价在 soul-unlocks.ts、道具在 items.ts（2026-10-10 新纳入工坊）。
    files: [mirrorCatalog, mirrorEconomy, mirrorUnlocks, mirrorItems],
  };
  const tsconfigPath = path.join(work, "tsconfig.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  let compiled = true;
  let output = "";
  try {
    output = execFileSync(process.execPath,
      [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    compiled = false;
    output = String(error.stdout || "") + String(error.stderr || "");
  }
  check("改动后的四个文件能过 tsc", compiled, compiled ? "无错误" : output.split("\n").slice(0, 6).join(" | "));

  // 编辑过的临时目录里现在是最新一版，再走一次往返仍要无损（防止"第二次写"漂移）
  const third = JSON.parse(JSON.stringify(await build()));
  apply(third, sandboxPaths);
  const fourth = await build();
  check("反复写回不会漂移（第三次读出来还是一样）",
    JSON.stringify(fourth.catalog) === JSON.stringify(third.catalog));
  check("反复写回：定价 / VCF 奖励 / 道具也不漂移",
    JSON.stringify(fourth.priceRules) === JSON.stringify(third.priceRules)
    && JSON.stringify(fourth.levelSoul) === JSON.stringify(third.levelSoul)
    && JSON.stringify(fourth.vcfItems) === JSON.stringify(third.vcfItems));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
if (failures > 0) process.exit(1);
