/**
 * renju.net reference tables. Both are transcribed from the site's own search
 * form (`/game/search/`) and rule pages (`/rule/<id>/`), which is why every
 * entry carries the id the site uses in its query string — the search request
 * needs the id, the game page reports the human-readable code instead.
 */
import type { OpeningRule, RuleSet } from "../../types";

export interface RenjuOpening {
  /** Position code as printed on the game page and in published game records. */
  code: string;
  /** Traditional name used by RIF; kept for reference and for Japanese records. */
  jpName: string;
  /** Simplified-Chinese name shown in this app. */
  zhName: string;
}

/** The 26 named openings: indirect (i1–i13) then direct (d1–d13). The search
 *  form numbers them 1–26 in exactly this order, with 27 = "Others". */
export const RENJU_OPENINGS: RenjuOpening[] = [
  { code: "i1", jpName: "長星", zhName: "长星" },
  { code: "i2", jpName: "峡月", zhName: "峡月" },
  { code: "i3", jpName: "恒星", zhName: "恒星" },
  { code: "i4", jpName: "水月", zhName: "水月" },
  { code: "i5", jpName: "流星", zhName: "流星" },
  { code: "i6", jpName: "雲月", zhName: "云月" },
  { code: "i7", jpName: "浦月", zhName: "浦月" },
  { code: "i8", jpName: "嵐月", zhName: "岚月" },
  { code: "i9", jpName: "銀月", zhName: "银月" },
  { code: "i10", jpName: "明星", zhName: "明星" },
  { code: "i11", jpName: "斜月", zhName: "斜月" },
  { code: "i12", jpName: "名月", zhName: "名月" },
  { code: "i13", jpName: "彗星", zhName: "彗星" },
  { code: "d1", jpName: "寒星", zhName: "寒星" },
  { code: "d2", jpName: "渓月", zhName: "溪月" },
  { code: "d3", jpName: "疎星", zhName: "疏星" },
  { code: "d4", jpName: "花月", zhName: "花月" },
  { code: "d5", jpName: "残月", zhName: "残月" },
  { code: "d6", jpName: "雨月", zhName: "雨月" },
  { code: "d7", jpName: "金星", zhName: "金星" },
  { code: "d8", jpName: "松月", zhName: "松月" },
  { code: "d9", jpName: "丘月", zhName: "丘月" },
  { code: "d10", jpName: "新月", zhName: "新月" },
  { code: "d11", jpName: "瑞星", zhName: "瑞星" },
  { code: "d12", jpName: "山月", zhName: "山月" },
  { code: "d13", jpName: "遊星", zhName: "游星" },
];

const OPENING_BY_CODE = new Map(RENJU_OPENINGS.map((opening) => [opening.code, opening]));

export const renjuOpeningByCode = (code: string) => OPENING_BY_CODE.get(code.trim().toLowerCase());

/** Search-form id (1-based over RENJU_OPENINGS, 27 = Others) -> position code. */
export const renjuOpeningCodeForId = (id: number) => RENJU_OPENINGS[id - 1]?.code;

/** Display label for an opening position code, e.g. `d11` -> `瑞星（d11）`. */
export const renjuOpeningLabel = (code: string) => {
  const opening = renjuOpeningByCode(code);
  return opening ? `${opening.zhName}（${opening.code}）` : code;
};

export interface RenjuRule {
  id: string;
  name: string;
  category: "renju" | "gomoku";
  /** Set only where the RIF procedure is the same procedure this app implements. */
  openingRule?: OpeningRule;
  /** The win condition / forbidden-move family. Renju-category rules always
   *  carry forbidden moves; the Gomoku family never does, and only Gomoku-Pro
   *  states outright that six in a row does not win. */
  ruleSet: RuleSet;
}

/** Transcribed from /rule/<id>/. `openingRule` is deliberately sparse: an
 *  approximate mapping would silently apply the wrong forbidden-move rules in
 *  analysis, so unmapped rules keep their original name in `ruleText`. */
export const RENJU_RULES: RenjuRule[] = [
  { id: "1", name: "Classic", category: "renju", openingRule: "five-two", ruleSet: "renju" },
  { id: "2", name: "Taraguchi", category: "renju", ruleSet: "renju" },
  { id: "3", name: "Sakata", category: "renju", ruleSet: "renju" },
  { id: "4", name: "Tarannikov", category: "renju", openingRule: "tarannikov", ruleSet: "renju" },
  { id: "5", name: "Yamaguchi", category: "renju", openingRule: "yamaguchi", ruleSet: "renju" },
  { id: "6", name: "Jonsson", category: "renju", ruleSet: "renju" },
  { id: "7", name: "Gomoku - Pro", category: "gomoku", ruleSet: "standard" },
  { id: "8", name: "Rejection", category: "renju", ruleSet: "renju" },
  { id: "9", name: "Experimental", category: "renju", ruleSet: "renju" },
  { id: "10", name: "Soosyrv", category: "renju", ruleSet: "renju" },
  { id: "11", name: "Gomoku - Swap 2", category: "gomoku", openingRule: "swap2", ruleSet: "freestyle" },
  { id: "12", name: "LianHuan", category: "renju", ruleSet: "renju" },
  { id: "13", name: "Soosyrv-10", category: "renju", ruleSet: "renju" },
  { id: "14", name: "LianHuan-5", category: "renju", ruleSet: "renju" },
  { id: "15", name: "Gomoku - Experimental", category: "gomoku", ruleSet: "freestyle" },
  { id: "16", name: "Taraguchi-7", category: "renju", ruleSet: "renju" },
  { id: "17", name: "Super Sakata", category: "renju", ruleSet: "renju" },
  { id: "18", name: "Soosyrv-5", category: "renju", ruleSet: "renju" },
  { id: "19", name: "Yamasyrv-5", category: "renju", ruleSet: "renju" },
  { id: "20", name: "Soosyrv-7", category: "renju", ruleSet: "renju" },
  { id: "21", name: "Yamasyrv-7", category: "renju", ruleSet: "renju" },
  { id: "22", name: "Yamasyrv-8", category: "renju", ruleSet: "renju" },
  { id: "23", name: "Soosyrv-8 (with indulgence)", category: "renju", ruleSet: "renju" },
  { id: "24", name: "Soosyrv-8", category: "renju", openingRule: "soosyrv-8", ruleSet: "renju" },
  { id: "25", name: "Taraguchi-10", category: "renju", openingRule: "taraguchi-10", ruleSet: "renju" },
  { id: "26", name: "Swap gomoku + Taraguchi-10", category: "renju", ruleSet: "renju" },
  { id: "27", name: "Swap-5 free", category: "renju", ruleSet: "renju" },
  { id: "28", name: "Gomoku - Swap", category: "gomoku", ruleSet: "freestyle" },
  { id: "29", name: "Super Taraguchi-10", category: "renju", ruleSet: "renju" },
];

const RULE_BY_NAME = new Map(RENJU_RULES.map((rule) => [rule.name.trim().toLowerCase(), rule]));

export const renjuRuleByName = (name: string) => RULE_BY_NAME.get(name.trim().toLowerCase());

/** Win-condition / forbidden-move family for a RIF rule name, or undefined when
 *  the name is not one of the federation's rules (then the caller keeps the
 *  importer's default instead of inventing a family). */
export const renjuRuleSetFor = (name: string) => renjuRuleByName(name)?.ruleSet;

/** The opening procedure, when RIF's procedure is one this app implements. */
export const renjuOpeningRuleFor = (name: string) => renjuRuleByName(name)?.openingRule;

/** Game-type filter ids used by `/game/search?type=`. */
export const RENJU_GAME_TYPES: Array<[string, string]> = [
  ["Ordinary", "普通对局"],
  ["2", "通信对局"],
  ["1", "快棋"],
  ["-1", "全部"],
];
