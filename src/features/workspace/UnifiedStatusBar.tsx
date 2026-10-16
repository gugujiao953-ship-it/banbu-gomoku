import { Bot, Check, ChevronDown, CircleDot, FlaskConical, PencilLine } from "lucide-react";
import "./unified-status.css";

interface UnifiedStatusBarProps {
  kind: "record" | "review" | "puzzle";
  title: string;
  subtitle: string;
  ruleLabel?: string;
  stepLabel: string;
  turnLabel: string;
  stateLabel: string;
  stateKind?: "saved" | "draft" | "analysis" | "playing" | "neutral";
  selectorOpen: boolean;
  aiGame: boolean;
  onToggleSelector: () => void;
  onExitAiGame?: () => void;
  annotationErase?: boolean;
  onExitAnnotationErase?: () => void;
}

export function UnifiedStatusBar(props: UnifiedStatusBarProps) {
  // 状态条三段一律纯文本（用户 09-23：那行字太小、不好点，而且三件事都有平替——
  // 跳手用棋盘下方的手数滑轨、锁落子颜色用首行的黑白切换、保存用首行的保存按钮）。
  // 所以这里不再有任何可点分段，DOM 与「状态条可点化」引入前逐字一致。
  const lines = <span className="unified-status-lines">
    <span className="unified-status-line">{props.ruleLabel ? `${props.ruleLabel} · ` : ""}{props.subtitle}</span>
    <span className="unified-status-line">{props.stepLabel} · {props.turnLabel} · {props.stateLabel}</span>
  </span>;
  const compat = <small className="workspace-current-compat">{props.ruleLabel ? `${props.ruleLabel} · ` : ""}{props.subtitle} · {props.stepLabel} · {props.turnLabel} · {props.stateLabel}</small>;
  const kindBadge = <span className="unified-status-kind">{props.kind === "puzzle" ? "题" : "谱"}</span>;
  const selectorLabel = `切换${props.kind === "puzzle" ? "棋题" : "棋谱"}，当前为${props.title}`;
  return <section className={`unified-status ${props.stateKind || "neutral"}`} aria-label="当前工作状态">
    <button
      type="button"
      className={`workspace-current unified-status-title ${props.selectorOpen ? "open" : ""}`}
      onClick={props.onToggleSelector}
      aria-expanded={props.selectorOpen}
      aria-label={selectorLabel}
    >
      {kindBadge}
      <span className="unified-status-copy"><b className="unified-status-name">{props.title}</b>{lines}{compat}</span>
      <ChevronDown aria-hidden="true"/>
    </button>
    <div className="unified-status-mode">
      {props.annotationErase && props.onExitAnnotationErase && <button type="button" className="exit-annotation-erase" onClick={props.onExitAnnotationErase} aria-label="退出去标注">去标注中 · 退出</button>}
      {props.aiGame && props.onExitAiGame && <button type="button" className="exit-ai-game" onClick={props.onExitAiGame} aria-label="退出对弈">退出</button>}
    </div>
  </section>;
}
