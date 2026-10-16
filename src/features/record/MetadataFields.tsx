import { ChevronDown, ExternalLink } from "lucide-react";
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
  ["swap2", "Swap2（二次交换） · 无禁"],
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
    {metadata.openingRule === "yamaguchi" && <p className="helper">山口规则的打点数量由先手方在开局时宣布（应用内 1–15），对局中不再更改。</p>}
    {metadata.openingRule === "soosyrv-8" && <p className="helper">索索夫-8 的打点数量由白方落第4手时宣布（1–8 个），宣布后执黑方仍有一次交换权。</p>}
    <p className="helper">开局规则会作为棋谱信息保存；五手两打、五手多打（山口）、索索夫-8、塔十和塔拉目前可在人机模式中使用（导入的老棋谱若是「五手多打」临场定数型，仍可保留该标注，只是人机菜单里已并到「五手多打（山口）」）。</p>
    <details className="metadata-extra">
      <summary><span><b>对弈信息</b><small>轮次 · 地点 · 段位 · 用时 · 开局 · 来源</small></span><ChevronDown size={16}/></summary>
      <div className="metadata-extra-body">
        <div className="two-cols">
          <label>轮次<input value={metadata.round || ""} onChange={(event) => onChange({ round: event.target.value })}/></label>
          <label>地点<input value={metadata.place || ""} onChange={(event) => onChange({ place: event.target.value })}/></label>
        </div>
        <div className="two-cols">
          <label>黑方段位<input value={metadata.blackRank || ""} onChange={(event) => onChange({ blackRank: event.target.value })}/></label>
          <label>白方段位<input value={metadata.whiteRank || ""} onChange={(event) => onChange({ whiteRank: event.target.value })}/></label>
        </div>
        <div className="two-cols">
          <label>贴目 / 让子<input value={metadata.komi || ""} onChange={(event) => onChange({ komi: event.target.value })}/></label>
          <label>开局名称<input value={metadata.openingName || ""} onChange={(event) => onChange({ openingName: event.target.value })}/></label>
        </div>
        <div className="two-cols">
          <label>时限<input value={metadata.timeLimit || ""} onChange={(event) => onChange({ timeLimit: event.target.value })}/></label>
          <label>读秒 / 加时<input value={metadata.overtime || ""} onChange={(event) => onChange({ overtime: event.target.value })}/></label>
        </div>
        <div className="two-cols">
          <label>注释者<input value={metadata.annotator || ""} onChange={(event) => onChange({ annotator: event.target.value })}/></label>
          <label>版权<input value={metadata.copyright || ""} onChange={(event) => onChange({ copyright: event.target.value })}/></label>
        </div>
        <label>来源网址<input value={metadata.sourceUrl || ""} onChange={(event) => onChange({ sourceUrl: event.target.value })}/></label>
        {/^https?:\/\//i.test(metadata.sourceUrl || "") && <a className="metadata-source-link" href={metadata.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>打开来源页面</a>}
        <p className="helper">这些字段来自棋谱文件的 SGF 属性（RO/PC/BR/WR/KM/TM/OT/ON/AN/CP/SO），留空即不再写出。</p>
      </div>
    </details>
  </>;
}
