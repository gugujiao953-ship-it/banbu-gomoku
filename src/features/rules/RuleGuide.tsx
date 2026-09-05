import { AlertTriangle, CircleHelp, ExternalLink } from "lucide-react";
import { AI_RULE_PRESET_GUIDES, RULE_SOURCE_NOTES } from "./rule-guide-data";

const cells = Array.from({ length: 7 }, (_, index) => index);

function ShapeDiagram({ kind }: { kind: "overline" | "double-four" | "double-three" }) {
  const stones = kind === "overline"
    ? [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5]]
    : kind === "double-four"
      ? [[3, 1], [3, 2], [3, 4], [1, 3], [2, 3], [4, 3]]
      : [[3, 2], [3, 4], [2, 3], [4, 3]];
  return <svg className="rule-shape" viewBox="0 0 140 140" role="img" aria-label={kind === "overline" ? "六枚黑子连续相连的长连示意" : kind === "double-four" ? "落点同时形成横竖两个四的示意" : "落点同时形成横竖两个活三方向的示意"}>
    {cells.map((index) => <g key={index}><line x1="10" y1={10 + index * 20} x2="130" y2={10 + index * 20}/><line x1={10 + index * 20} y1="10" x2={10 + index * 20} y2="130"/></g>)}
    {stones.map(([row, col]) => <circle key={`${row}-${col}`} cx={10 + col * 20} cy={10 + row * 20} r="7.5" className="black"/>)}
    {kind !== "overline" && <g className="focus"><circle cx="70" cy="70" r="9"/><text x="70" y="74">落</text></g>}
  </svg>;
}

export function RuleGuide({ onOpenManual }: { onOpenManual: () => void }) {
  return <div className="sheet-body rule-guide">
    <section className="rule-guide-intro"><CircleHelp/><div><b>规则预设 = 胜负方式 + 开局流程</b><p>每个预设已经把是否有禁、长连判定、交换与打点流程绑定在一起；进入 AI 对战后直接选择一个规则即可。</p></div></section>
    <div className="rule-compare-list">{AI_RULE_PRESET_GUIDES.map((entry) => <details key={entry.key} className="rule-card" open={entry.key === "freestyle"}><summary><span>{entry.name} · {entry.badge}</span><small>{entry.summary}</small></summary><dl><div><dt>详细</dt><dd>{entry.detail}</dd></div><div><dt>流程</dt><dd>{entry.steps}</dd></div><div><dt>胜负</dt><dd>{entry.winning}</dd></div></dl></details>)}</div>

    <details className="rule-detail-card" open><summary>禁手怎么判断</summary><div className="rule-detail-body">
      <p><b>只看黑方、只在连珠规则生效。</b>应用在候选点显示红色 X，并写出“长连禁手 / 四四禁手 / 三三禁手”；落子时也会阻止该点。</p>
      <div className="rule-shape-grid"><figure><ShapeDiagram kind="overline"/><figcaption><b>长连</b><span>一条不断开的黑棋行达到六子或以上。</span></figcaption></figure><figure><ShapeDiagram kind="double-four"/><figcaption><b>四四</b><span>同一落点同时产生两个独立的“四”。活四有两个成五点，冲四通常只有一个。</span></figcaption></figure><figure><ShapeDiagram kind="double-three"/><figcaption><b>三三</b><span>同一落点同时产生两个可合法发展成活四的“真三”。</span></figcaption></figure></div>
      <h3>真三、假三与重复计算</h3>
      <p>“活三”不是看起来有三个黑子就算。它必须还能通过一个<b>合法黑棋着点</b>形成两端均可成五的直四。若延伸点贴边、被白棋封住，或延伸本身会造成长连、四四、禁三三，这个方向可能是假三。</p>
      <p>多个棋形可以共享落点或已有棋子；四形按实际四子组合区分，同一条直四的两个成五端不会重复算成两个四。同一方向若确实存在两组不同四子组合，仍可能构成四四。</p>
      <h3>五连与禁手的优先级</h3>
      <p>依据 RIF 规则，黑棋一手同时形成<b>恰好五连</b>时先判胜，即使还出现三三、四四或另一方向长连；没有恰五时才判长连、四四、三三。白棋五连或长连都获胜。</p>
      <div className="rule-boundary"><AlertTriangle/><p><b>实现边界：</b>应用已经覆盖常见直三、跳三、假三、同向/异向四四与延伸点合法性；极少数需要多层递归推演的复杂禁三例，仍属于“实用禁手辅助”，不替代正式裁判。</p></div>
    </div></details>

    <details className="rule-detail-card"><summary>依据与应用对应</summary><div className="rule-source-list">{RULE_SOURCE_NOTES.map((note) => <p key={note}><ExternalLink/>{note}</p>)}</div></details>
    <button className="secondary-button" onClick={onOpenManual}>打开使用手册中的 AI 条目</button>
  </div>;
}
