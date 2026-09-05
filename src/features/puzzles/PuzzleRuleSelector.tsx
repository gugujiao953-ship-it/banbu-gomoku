import type { PuzzleRuleMode, ResolvedPuzzleRule } from "./puzzle-rules";

interface PuzzleRuleSelectorProps {
  value: ResolvedPuzzleRule;
  onChange: (value: PuzzleRuleMode) => void;
}

export function PuzzleRuleSelector({ value, onChange }: PuzzleRuleSelectorProps) {
  const lockedLabel = value.locked ? "，由题目指定" : "";
  return <div className="puzzle-rule-selector" role="radiogroup" aria-label={`做题规则${lockedLabel}`}>
    <button type="button" role="radio" aria-checked={value.mode === "forbidden"} className={value.mode === "forbidden" ? "selected" : ""} disabled={value.locked} onClick={() => onChange("forbidden")}>禁手</button>
    <button type="button" role="radio" aria-checked={value.mode === "unrestricted"} className={value.mode === "unrestricted" ? "selected" : ""} disabled={value.locked} onClick={() => onChange("unrestricted")}>无禁手</button>
  </div>;
}
