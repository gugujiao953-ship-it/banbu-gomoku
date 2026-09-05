import { BookOpen, Bot, Check, ChevronDown, CircleDot, FlaskConical, PencilLine, PenTool, Puzzle, X } from "lucide-react";
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
  mode: "record" | "review" | "puzzle";
  aiGame: boolean;
  aiThinking: boolean;
  onToggleSelector: () => void;
  onToggleMode: (mode: "record" | "review" | "puzzle") => void;
  onExitAiGame?: () => void;
  onStopAiThinking?: () => void;
}

const StateIcon = ({ kind }: { kind: UnifiedStatusBarProps["stateKind"] }) => kind === "saved"
  ? <Check/>
  : kind === "draft" ? <PencilLine/>
  : kind === "analysis" ? <Bot/>
  : kind === "playing" ? <FlaskConical/>
  : <CircleDot/>;

export function UnifiedStatusBar(props: UnifiedStatusBarProps) {
  return <section className={`unified-status ${props.stateKind || "neutral"} ${props.aiThinking ? "ai-thinking" : ""}`} aria-label="当前工作状态" aria-busy={props.aiThinking || undefined}>
    <button
      type="button"
      className={`workspace-current unified-status-title ${props.selectorOpen ? "open" : ""}`}
      onClick={props.onToggleSelector}
      aria-expanded={props.selectorOpen}
      aria-label={`切换${props.kind === "puzzle" ? "棋题" : "棋谱"}，当前为${props.title}`}
    >
      <span className="unified-status-kind">{props.kind === "puzzle" ? "题" : "谱"}</span>
      <span className="unified-status-copy"><b className="unified-status-name">{props.title}</b><span className="unified-status-subtitle">{props.ruleLabel ? `规则：${props.ruleLabel} · ` : ""}{props.subtitle} · {props.stepLabel} · {props.turnLabel} · {props.stateLabel}</span><small className="workspace-current-compat">{props.ruleLabel ? `规则：${props.ruleLabel} · ` : ""}{props.subtitle} · {props.stepLabel} · {props.turnLabel} · {props.stateLabel}</small></span>
      <ChevronDown aria-hidden="true"/>
    </button>
    <div className="unified-status-facts" aria-live="polite">
      <span><small>位置</small><b>{props.stepLabel}</b></span>
      <span><small>轮次</small><b>{props.turnLabel}</b></span>
      <span className={`status-state ${props.stateKind || "neutral"}`}><StateIcon kind={props.stateKind}/><small>状态</small><b>{props.stateLabel}</b></span>
    </div>
    <div className="unified-status-mode">
      <div
        className={`workspace-mode-toggle ${props.mode}`}
        role="tablist"
        aria-label="工作模式"
      >
        <button type="button" role="tab" aria-selected={props.mode === "record"} className={props.mode === "record" ? "selected" : ""} onClick={() => props.onToggleMode("record")} aria-label="打谱模式"><PenTool aria-hidden="true"/><span>打谱</span></button>
        <button type="button" role="tab" aria-selected={props.mode === "review"} className={props.mode === "review" ? "selected" : ""} onClick={() => props.onToggleMode("review")} aria-label="读谱模式"><BookOpen aria-hidden="true"/><span>读谱</span></button>
        <button type="button" role="tab" aria-selected={props.mode === "puzzle"} className={props.mode === "puzzle" ? "selected" : ""} onClick={() => props.onToggleMode("puzzle")} aria-label="做题模式"><Puzzle aria-hidden="true"/><span>做题</span></button>
      </div>
      {props.mode === "record" && props.aiGame
        ? props.aiThinking
          ? <button type="button" className="exit-ai-game stop-ai-thinking" onClick={props.onStopAiThinking} aria-label="停止 AI 思考"><X aria-hidden="true"/><span>停止</span></button>
          : <button type="button" className="exit-ai-game" onClick={props.onExitAiGame} aria-label="退出对弈">退出</button>
        : null}
    </div>
  </section>;
}
