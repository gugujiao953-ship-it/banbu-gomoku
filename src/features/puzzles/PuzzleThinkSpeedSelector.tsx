export type PuzzleThinkSpeed = "slow" | "fast";

interface PuzzleThinkSpeedSelectorProps {
  value: PuzzleThinkSpeed;
  onChange: (value: PuzzleThinkSpeed) => void;
}

export function PuzzleThinkSpeedSelector({ value, onChange }: PuzzleThinkSpeedSelectorProps) {
  const currentLabel = value === "fast" ? "快，1 秒内落子" : "慢，沿用当前思考时间";
  return <div className="puzzle-think-speed-selector" role="radiogroup" aria-label={`陪练思考速度：${currentLabel}`}>
    <button type="button" role="radio" aria-checked={value === "fast"} className={value === "fast" ? "selected" : ""} aria-label="快速陪练，1 秒内落子" title="快速陪练，1 秒内落子" onClick={() => onChange("fast")}>快 · 1秒</button>
    <button type="button" role="radio" aria-checked={value === "slow"} className={value === "slow" ? "selected" : ""} aria-label="慢速陪练，沿用当前思考时间" title="慢速陪练，沿用当前思考时间" onClick={() => onChange("slow")}>慢</button>
  </div>;
}
