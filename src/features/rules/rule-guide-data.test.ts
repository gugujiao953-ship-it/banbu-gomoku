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
    const expected: OpeningRule[] = ["swap1", "swap3", "free", "five-two", "five-n", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"];
    expect(OPENING_GUIDES.map((entry) => entry.rule).sort()).toEqual(expected.sort());
  });

  it("exposes a single AI rule catalog with the expected forbidden labels", () => {
    expect(AI_RULE_PRESET_GUIDES.map((entry) => entry.key)).toEqual(["freestyle", "standard", "swap1", "swap3", "five-two", "five-n", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"]);
    expect(AI_RULE_PRESET_GUIDES.filter((entry) => entry.badge === "有禁").map((entry) => entry.key)).toEqual(["five-two", "five-n", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"]);
  });

  it("uses the same detailed rule labels in legacy record surfaces", () => {
    expect(recordRuleDisplayName({ rule: "freestyle", openingRule: "swap3" })).toBe("三手交换 · 无禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "five-n", openingN: 7 })).toBe("五手多打（7打） · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "yamaguchi" })).toBe("山口 · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "soosyrv-8" })).toBe("索索夫-8 · 有禁");
    expect(recordRuleDisplayName({ rule: "renju", openingRule: "free" })).toBe("连珠规则 · 有禁");
  });
});
