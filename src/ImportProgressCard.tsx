import { importPhaseLabel, importPhaseStep, importProgressPercent, type ImportProgressState } from "./import-progress";

const steps = ["读取", "解析", "索引 / 保存", "完成"];

export function ImportProgressCard({ state }: { state: ImportProgressState }) {
  const activeStep = importPhaseStep(state.phase === "error" ? state.failedAt || "reading" : state.phase);
  const percent = importProgressPercent(state.progress);
  const terminal = state.phase === "complete" || state.phase === "error";
  const countLabel = state.totalFiles && state.totalFiles > 1
    ? `第 ${Math.min(state.currentFile || 1, state.totalFiles)} / ${state.totalFiles} 份`
    : "";

  return (
    <section
      className={`import-progress import-progress--${state.phase}`}
      role={state.phase === "error" ? "alert" : "status"}
      aria-live={state.phase === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="import-progress__head">
        <span className="import-progress__status-mark" aria-hidden="true" />
        <div className="import-progress__copy">
          <div className="import-progress__eyebrow">
            <b>{importPhaseLabel(state.phase)}</b>
            {state.background && !terminal && <span>后台进行</span>}
            {countLabel && <span>{countLabel}</span>}
            {percent !== undefined && !terminal && <span>{percent}%</span>}
          </div>
          <strong title={state.fileName}>{state.fileName}</strong>
          <small>{state.detail}</small>
        </div>
      </div>

      {!terminal && (
        <div
          className={`import-progress__track${percent === undefined ? " is-indeterminate" : ""}`}
          role="progressbar"
          aria-label={`${importPhaseLabel(state.phase)}${countLabel ? `，${countLabel}` : ""}`}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === undefined ? {} : { "aria-valuenow": percent })}
        >
          <i style={percent === undefined ? undefined : { width: `${percent}%` }} />
        </div>
      )}

      <ol className="import-progress__steps" aria-label="导入阶段">
        {steps.map((step, index) => {
          const stateClass = state.phase === "error" && index === activeStep
            ? "is-error"
            : index < activeStep || state.phase === "complete" ? "is-done"
            : index === activeStep ? "is-active" : "";
          return <li key={step} className={stateClass}><i aria-hidden="true" /><span>{step}</span></li>;
        })}
      </ol>

      {!terminal && percent === undefined && (
        <div className="import-progress__skeleton" aria-hidden="true"><i /><i /><i /></div>
      )}
    </section>
  );
}
