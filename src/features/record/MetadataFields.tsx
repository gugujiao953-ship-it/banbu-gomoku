import type { GameDocument, OpeningRule } from "../../types";

const OPENING_RULE_OPTIONS: Array<[OpeningRule, string]> = [
  ["swap1", "一手交换 · 无禁"],
  ["swap3", "三手交换 · 无禁"],
  ["free", "自由开局 · 无禁"],
  ["five-two", "五手两打 · 有禁"],
  ["five-n", "五手多打 · 有禁"],
  ["yamaguchi", "山口 · 有禁"],
  ["soosyrv-8", "索索夫-8 · 有禁"],
  ["taraguchi-10", "塔十（塔拉山口-10） · 有禁"],
  ["tarannikov", "塔拉（五次交换） · 有禁"],
];

interface MetadataFieldsProps {
  metadata: GameDocument["metadata"];
  onChange: (patch: Partial<GameDocument["metadata"]>) => void;
}

export function MetadataFields({ metadata, onChange }: MetadataFieldsProps) {
  return <>
    <label>棋谱名称<input value={metadata.title} onChange={(event) => onChange({ title: event.target.value })}/></label>
    <div className="two-cols">
      <label>黑方<input value={metadata.black} onChange={(event) => onChange({ black: event.target.value })}/></label>
      <label>白方<input value={metadata.white} onChange={(event) => onChange({ white: event.target.value })}/></label>
    </div>
    <label>赛事 / 主题<input value={metadata.event} onChange={(event) => onChange({ event: event.target.value })}/></label>
    <div className="two-cols">
      <label>日期<input type="date" value={metadata.date} onChange={(event) => onChange({ date: event.target.value })}/></label>
      <label>规则<select value={metadata.rule} onChange={(event) => onChange({ rule: event.target.value as GameDocument["metadata"]["rule"] })}>
        <option value="renju">连珠规则 · 有禁</option>
        <option value="standard">无禁6不胜 · 无禁</option>
        <option value="freestyle">无禁手 · 无禁</option>
      </select></label>
    </div>
    <label>开局规则<select
      value={metadata.openingRule || "free"}
      onChange={(event) => onChange({
        openingRule: event.target.value as OpeningRule,
        openingN: event.target.value === "five-n" ? (metadata.openingN || 3) : undefined,
      })}
    >
      {OPENING_RULE_OPTIONS.map(([rule, title]) => <option key={rule} value={rule}>{title}</option>)}
    </select></label>
    {metadata.openingRule === "five-n" && <p className="helper">五手多打数量在白4后由白方临场指定（3–10 个），不会在开局前固定。</p>}
    {metadata.openingRule === "yamaguchi" && <p className="helper">山口规则的打点数量由先手方在开局时宣布（应用内 1–10），对局中不再更改。</p>}
    {metadata.openingRule === "soosyrv-8" && <p className="helper">索索夫-8 的打点数量由白方落第4手时宣布（1–8 个），宣布后执黑方仍有一次交换权。</p>}
    <p className="helper">开局规则会作为棋谱信息保存；五手两打、五手多打、山口、索索夫-8、塔十和塔拉目前可在人机模式中使用。</p>
  </>;
}
