import { describe, expect, it } from "vitest";
import type { OpeningRule, RuleSet } from "../../types";
import { AI_RULE_PRESET_GUIDES, OPENING_GUIDES, RULE_GUIDES, recordRuleDisplayName } from "./rule-guide-data";

describe("rule guide mapping", () => {
  it("covers every rule enum exactly once", () => {
    const expected: RuleSet[] = ["renju", "standard", "freestyle"];
    expect(RULE_GUIDES.map((entry) => entry.rule).sort()).toEqual(expected.sort());
    expect(new Set(RULE_GUIDES.map((entry) => entry.rule)).size).toBe(expected.length);
  });

  it("covers every opening option exposed by the app", () => {
    const expected: OpeningRule[] = ["swap1", "swap2", "swap3", "free", "five-two", "five-n", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"];
    expect(OPENING_GUIDES.map((entry) => entry.rule).sort()).toEqual(expected.sort());
  });

  it("exposes a single AI rule catalog with the expected forbidden labels", () => {
    expect(AI_RULE_PRESET_GUIDES.map((entry) => entry.key)).toEqual(["freestyle", "standard", "swap1", "swap3", "swap2", "renju-free", "five-two", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"]);
    expect(AI_RULE_PRESET_GUIDES.filter((entry) => entry.badge === "有禁").map((entry) => entry.key)).toEqual(["renju-free", "five-two", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"]);
  });

  it("lists the fifth-move multi-dot rule exactly once, as 五手多打（山口）", () => {
    const fifthMoveRules = AI_RULE_PRESET_GUIDES.filter((entry) => entry.openingRule === "five-n" || entry.openingRule === "yamaguchi");
    expect(fifthMoveRules.map((entry) => entry.key)).toEqual(["yamaguchi"]);
    expect(fifthMoveRules[0].name).toBe("五手多打（山口）");
    expect(AI_RULE_PRESET_GUIDES.some((entry) => entry.openingRule === "five-n")).toBe(false);
    // 只从人机可选清单里去掉：引擎与开局簿层（opening-rules.ts / opening-book.ts / rapfi-worker）
    // 仍以五个打点为独立开局规则，OPENING_GUIDES 必须保留 five-n，老存档才不会失效。
    expect(OPENING_GUIDES.some((entry) => entry.rule === "five-n")).toBe(true);
  });

  it("uses the same detailed rule labels in legacy record surfaces", () => {
    expect(recordRuleDisplayName({ rule: "freestyle", openingRule: "swap3" })).toBe("三手交换 · 无禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "five-n", openingN: 7 })).toBe("五手多打（7打） · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "yamaguchi" })).toBe("五手多打（山口） · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "soosyrv-8" })).toBe("索索夫-8 · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "free" })).toBe("有禁手 · 有禁");
    expect(recordRuleDisplayName({ rule: "standard", openingRule: "swap2" })).toBe("Swap2（二次交换） · 无禁");
  });
});
