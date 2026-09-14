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
  eraseStone?: boolean;
  onExitEraseStone?: () => void;
}

export function UnifiedStatusBar(props: UnifiedStatusBarProps) {
  return <section className={`unified-status ${props.stateKind || "neutral"}`} aria-label="当前工作状态">
    <button
      type="button"
      className={`workspace-current unified-status-title ${props.selectorOpen ? "open" : ""}`}
      onClick={props.onToggleSelector}
      aria-expanded={props.selectorOpen}
      aria-label={`切换${props.kind === "puzzle" ? "棋题" : "棋谱"}，当前为${props.title}`}
    >
      <span className="unified-status-kind">{props.kind === "puzzle" ? "题" : "谱"}</span>
      <span className="unified-status-copy"><b className="unified-status-name">{props.title}</b><span className="unified-status-lines"><span className="unified-status-line">{props.ruleLabel ? `${props.ruleLabel} · ` : ""}{props.subtitle}</span><span className="unified-status-line">{props.stepLabel} · {props.turnLabel} · {props.stateLabel}</span></span><small className="workspace-current-compat">{props.ruleLabel ? `${props.ruleLabel} · ` : ""}{props.subtitle} · {props.stepLabel} · {props.turnLabel} · {props.stateLabel}</small></span>
      <ChevronDown aria-hidden="true"/>
    </button>
    <div className="unified-status-mode">
      {props.annotationErase && props.onExitAnnotationErase && <button type="button" className="exit-annotation-erase" onClick={props.onExitAnnotationErase} aria-label="退出去标注">去标注中 · 退出</button>}
      {props.eraseStone && props.onExitEraseStone && <button type="button" className="exit-annotation-erase" onClick={props.onExitEraseStone} aria-label="退出去子">去子中 · 退出</button>}
      {props.aiGame && props.onExitAiGame && <button type="button" className="exit-ai-game" onClick={props.onExitAiGame} aria-label="退出对弈">退出</button>}
    </div>
  </section>;
}
