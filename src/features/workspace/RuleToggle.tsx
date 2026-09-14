import type { RuleSet } from "../../types";
import { Shield } from "lucide-react";

interface RuleToggleProps {
  value: RuleSet;
  disabled?: boolean;
  onChange: (value: Extract<RuleSet, "freestyle" | "renju">) => void;
}

export function RuleToggle({ value, disabled = false, onChange }: RuleToggleProps) {
  const hasForbidden = value === "renju";
  return <div className={`rule-toggle ${hasForbidden ? "renju" : "freestyle"} ${disabled ? "disabled" : ""}`} role="radiogroup" aria-label="当前局面规则">
    <i aria-hidden="true"/>
    <button type="button" role="radio" aria-checked={!hasForbidden} className={!hasForbidden ? "selected" : ""} disabled={disabled} onClick={() => onChange("freestyle")}>无禁</button>
    <button type="button" role="radio" aria-checked={hasForbidden} className={hasForbidden ? "selected" : ""} disabled={disabled} onClick={() => onChange("renju")}><Shield aria-hidden="true"/>有禁</button>
  </div>;
}
