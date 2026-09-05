import type { GameMetadata, OpeningRule, RuleSet } from "../../types";

export interface AiRulePresetGuide {
  key: string;
  rule: RuleSet;
  openingRule: OpeningRule;
  name: string;
  badge: "有禁" | "无禁";
  summary: string;
  detail: string;
  steps: string;
  winning: string;
}

export const AI_RULE_PRESET_GUIDES: readonly AiRulePresetGuide[] = [
  { key: "freestyle", rule: "freestyle", openingRule: "free", name: "无禁手", badge: "无禁", summary: "自由开局；五连或更长都算胜", detail: "双方都没有三三、四四、长连禁手，先后在任意空位落子。", steps: "黑方先手 → 双方轮流落子 → 五连或长连即胜", winning: "任意一方形成五连或更长连续棋子即获胜。" },
  { key: "standard", rule: "standard", openingRule: "free", name: "无禁6不胜", badge: "无禁", summary: "自由开局；必须恰好五连", detail: "双方都没有禁手，但六子及以上的长连不断线也不算胜。", steps: "黑方先手 → 双方轮流落子 → 恰好五连判胜", winning: "只有恰好五连获胜；六连及以上不判胜。" },
  { key: "swap1", rule: "freestyle", openingRule: "swap1", name: "一手交换", badge: "无禁", summary: "第1手后决定是否交换执子方", detail: "黑方先落第1手，随后另一方可以交换黑白执子颜色；交换完成后进入无禁手正常对局。", steps: "黑1 → 选择交换或不交换 → 正常轮流落子", winning: "交换只改变执子颜色；之后五连或长连均可获胜。" },
  { key: "swap3", rule: "freestyle", openingRule: "swap3", name: "三手交换", badge: "无禁", summary: "黑白黑三手后决定是否交换", detail: "先完成黑1、白2、黑3，随后后手方选择交换或保持执子颜色；之后进入无禁手正常对局。", steps: "黑1 → 白2 → 黑3 → 选择交换 → 正常轮流落子", winning: "交换只改变执子颜色；之后五连或长连均可获胜。" },
  { key: "five-two", rule: "renju", openingRule: "five-two", name: "五手两打", badge: "有禁", summary: "白4后提供 A1、A2 两个黑5候选", detail: "前三手由开局方摆出，另一方决定是否交换；白4后黑方给出两个不同棋形的第5手候选，白方选择其中一个继续。", steps: "黑1 → 白2 → 黑3 → 交换决定 → 白4 → 黑方给 A1/A2 → 白方选一个", winning: "采用连珠胜负：黑方恰五获胜并受三三、四四、长连禁手约束；白方五连或长连获胜。" },
  { key: "five-n", rule: "renju", openingRule: "five-n", name: "五手多打", badge: "有禁", summary: "白4后临场选择 3–10 个打点", detail: "数量不在开局前决定。白4完成后由白方临场选择本局打点数，黑方依次提供 A1、A2…候选，白方从中选择一个；候选不得对称重复。", steps: "黑1 → 白2 → 黑3 → 交换决定 → 白4 → 选择打点数 → 黑方给候选 → 白方选一个", winning: "采用连珠胜负，黑方有三三、四四、长连禁手。" },
  { key: "yamaguchi", rule: "renju", openingRule: "yamaguchi", name: "山口", badge: "有禁", summary: "黑方开局时宣布打点数，白4后黑方打点", detail: "山口：先手方摆出前三手（天元、3×3、5×5 的 26 开局点内）并同时宣布本局第5手打点数量；另一方决定是否交换；白方在任意位置落第4手；黑方放置宣言数量的第5手候选（不得对称重复），白方选择其一并下白6。", steps: "黑1 并宣布打点数 → 白2 → 黑3 → 交换决定 → 白4 → 黑方打点 → 白方选一个并下白6", winning: "采用连珠胜负，黑方有三三、四四、长连禁手。" },
  { key: "soosyrv-8", rule: "renju", openingRule: "soosyrv-8", name: "索索夫-8", badge: "有禁", summary: "白4宣布 1–8 打，宣布后可再交换", detail: "索索夫-8（2017 年起的世界锦标赛规则）：前三手在 26 开局点内摆出，另一方决定是否交换；白方在任意位置落第4手并宣布 1–8 个第5手打点数量；宣布后执黑方仍有一次交换权；黑方放置宣言数量的第5手候选（不得对称重复），白方选择其一并下白6。", steps: "黑1 → 白2 → 黑3 → 交换决定 → 白4 并宣布打点数 → 交换决定 → 黑方打点 → 白方选一个并下白6", winning: "采用连珠胜负，黑方有三三、四四、长连禁手。" },
  { key: "taraguchi-10", rule: "renju", openingRule: "taraguchi-10", name: "塔十", badge: "有禁", summary: "前四手交换后选择单点或十打", detail: "塔拉山口-10：前四手在逐步扩大的中心区域落子，每手后可交换；第4手后可选择交换并单点黑5，或不交换进入十个黑5候选。", steps: "前四手逐步落子并可交换 → 单点黑5或十打 → 选定黑5 → 正常对局", winning: "采用连珠胜负，黑方有三三、四四、长连禁手。" },
  { key: "tarannikov", rule: "renju", openingRule: "tarannikov", name: "塔拉", badge: "有禁", summary: "前五手每手后都可交换", detail: "前五手每落一手，对方都获得一次交换权；允许落子区域从天元开始逐步扩大到 9×9。", steps: "黑1 → 交换决定 → 白2 → 交换决定……直到第5手 → 正常对局", winning: "采用连珠胜负，黑方有三三、四四、长连禁手。" },
];

export interface RuleGuideEntry {
  rule: RuleSet;
  name: string;
  board: string;
  firstMove: string;
  win: string;
  overline: string;
  forbidden: string;
}

export const RULE_GUIDES: readonly RuleGuideEntry[] = [
  {
    rule: "renju",
    name: "连珠规则 · 有禁",
    board: "正式规则使用 15×15；应用的黑方禁手判定也以十五路为主要验证范围。",
    firstMove: "黑方先行；正式开局通常还要配合交换或打点规则。",
    win: "黑方必须恰好五连；白方五连或长连均获胜。黑方同一手形成恰五时优先判胜。",
    overline: "黑方六子或以上为长连；未同时成恰五时属于禁手。白方长连可胜。",
    forbidden: "仅约束黑方：长连、四四、三三。白方没有这些禁手。",
  },
  {
    rule: "standard",
    name: "无禁6不胜 · 无禁",
    board: "应用支持 5–25 路；竞赛与 AI 常用 15×15。",
    firstMove: "黑方先行，应用的人机模式采用自由落点，不附加 Pro/Swap 开局限制。",
    win: "双方都必须形成恰好五连；六子或以上不断线，但不算胜。",
    overline: "双方都允许形成长连，只是长连本身不获胜。",
    forbidden: "双方均无三三、四四、长连禁手。",
  },
  {
    rule: "freestyle",
    name: "无禁手 · 无禁",
    board: "应用支持 5–25 路；常见对局使用 15×15 或 19×19。",
    firstMove: "黑方先行，双方依次在任意空点落子。",
    win: "双方五子或更多连续相连都获胜。",
    overline: "长连允许，并直接视为胜利。",
    forbidden: "双方均无禁手。",
  },
] as const;

export const OPENING_GUIDES: ReadonlyArray<{ rule: OpeningRule; name: string; summary: string }> = [
  { rule: "swap1", name: "一手交换 · 无禁", summary: "黑方先落 1 手后，白方可选择交换黑白。" },
  { rule: "swap3", name: "三手交换 · 无禁", summary: "黑白黑 3 手后，后手方可选择交换。" },
  { rule: "free", name: "自由开局 · 无禁", summary: "应用直接进入轮流落子；适合最简单的起始流程。" },
  { rule: "five-two", name: "五手两打（经典） · 有禁", summary: "前三手由开局方摆出，另一方可交换；白4后黑方给两个不对称黑5，白方选一个并走白6。黑方执行连珠禁手。" },
  { rule: "five-n", name: "五手多打（对局中定数） · 有禁", summary: "白4后白方临场指定 3–10 个黑5候选，黑方依次打点，白方再选择一个；候选拒绝对称重复，黑方执行连珠禁手。" },
  { rule: "yamaguchi", name: "山口 · 有禁", summary: "先手方摆 26 开局时宣布第5手打点数量，对方交换后白4，黑方按宣言数量打点，白方选一并下白6；黑方执行连珠禁手。" },
  { rule: "soosyrv-8", name: "索索夫-8 · 有禁", summary: "26 开局后交换；白4并宣布 1–8 打后执黑方可再交换；黑方按宣言数量打点，白方选一并下白6；黑方执行连珠禁手。" },
  { rule: "taraguchi-10", name: "塔拉山口-10 · 有禁", summary: "前四手按中心区域逐步扩大并可交换；第4手后可走单点黑5路径，或提供十个不对称黑5候选。黑方执行连珠禁手。" },
  { rule: "tarannikov", name: "塔拉（五次交换） · 有禁", summary: "前五手每手后均给对方交换权，允许区域从天元、3×3、5×5、7×7 到 9×9 逐步扩大，黑方执行连珠禁手。" },
];

export const RULE_SOURCE_NOTES = [
  "RIF《International Rules of Renju》：棋盘、五连、长连、四、活四、三、四四、三三及胜负优先级。",
  "RenjuNet 的 Classic、Soosõrv-N、Taraguchi-10、Tarannikov 开局条目：应用五手两打、对局中定数多打、塔十与塔拉流程的依据。",
  "Gomocup/Gomoku AI 协议约定：freestyle 为五个以上可胜，standard 为仅恰五获胜，renju 为黑方禁手。",
] as const;

/** One display source for record lists, exports and future rule summaries. */
export function recordRuleDisplayName(metadata: Pick<GameMetadata, "rule" | "openingRule" | "openingN">): string {
  const openingRule = metadata.openingRule || "free";
  const preset = AI_RULE_PRESET_GUIDES.find((guide) => guide.rule === metadata.rule && guide.openingRule === openingRule);
  if (preset) {
    const count = openingRule === "five-n" && metadata.openingN ? `（${metadata.openingN}打）` : "";
    return `${preset.name}${count} · ${preset.badge}`;
  }
  return RULE_GUIDES.find((guide) => guide.rule === metadata.rule)?.name || "规则未标注";
}
