import { useEffect, useLayoutEffect, useRef } from "react";
import { lockDocumentScroll } from "./document-scroll-lock";
import { Check, Download, RotateCcw, Settings2, X, Wifi } from "lucide-react";

export type EngineSwitchStatus = "loading" | "download" | "config" | "restoring" | "success" | "failure" | "same";
export type EngineSwitchChannel = "local" | "internal" | "cloud";

export interface EngineSwitchOverlayProps {
  from: string;
  to: string;
  channel: EngineSwitchChannel;
  status: EngineSwitchStatus;
  percent?: number;
  phase?: string;
  error?: string;
  canCancel?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  /** 失败时的第二个选项（用户 2026-10-15：别偷偷回落，弹窗让他选）。
   *  例：KataGo 起不来时给「改用 rapfi 继续」。 */
  fallbackLabel?: string;
  onFallback?: () => void;
  onClose?: () => void;
}

const statusCopy: Record<EngineSwitchStatus, { title: string; detail: string }> = {
  loading: { title: "正在切换引擎", detail: "新引擎正在接管棋局" },
  download: { title: "准备引擎资源", detail: "正在下载所需的本地引擎包" },
  config: { title: "还差一步配置", detail: "填写连接地址后才能启用这个引擎" },
  restoring: { title: "正在恢复棋局", detail: "切换没有完成，正在回到可用引擎" },
  success: { title: "切换已完成", detail: "接下来会使用新的引擎思考" },
  failure: { title: "引擎切换未完成", detail: "请检查引擎资源，或稍后重新发起切换" },
  same: { title: "引擎未改变", detail: "当前已经是这个引擎" },
};

const channelCopy: Record<EngineSwitchChannel, string> = {
  local: "本机引擎",
  internal: "内网连接",
  cloud: "云端连接",
};

export function EngineSwitchOverlay({ from, to, channel, status, percent = 0, phase, error, canCancel = false, onCancel, onRetry, fallbackLabel, onFallback, onClose }: EngineSwitchOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = statusCopy[status];
  const settled = status === "success" || status === "failure" || status === "same" || status === "config";
  const clampedPercent = Math.min(100, Math.max(0, Math.round(percent)));

  useEffect(() => {
    const previous = globalThis.document?.activeElement as HTMLElement | null;
    const focusable = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      : [];
    const timer = window.setTimeout(() => (focusable()[0] || closeRef.current || dialogRef.current)?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && settled) { event.preventDefault(); onClose?.(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose, settled]);

  useLayoutEffect(() => lockDocumentScroll(), []);

  return <div className={`engine-switch-backdrop engine-switch-backdrop--${status}`}>
    <section ref={dialogRef} className="engine-switch-dialog" role="dialog" aria-modal="true" aria-labelledby="engine-switch-title" tabIndex={-1}>
      <div className="engine-switch-topline">
        <span className="engine-switch-channel"><Wifi size={13} aria-hidden="true"/>{channelCopy[channel]}</span>
        {settled && <button ref={closeRef} type="button" className="engine-switch-close" onClick={onClose} aria-label="关闭"><X size={17}/></button>}
      </div>
      <div className={`engine-switch-art engine-switch-art--${status}`} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <i key={index} className={`engine-switch-stone engine-switch-stone--${index + 1}`}><span className="engine-switch-stone-cover engine-switch-stone-cover--white"/><span className="engine-switch-stone-cover engine-switch-stone-cover--black"/></i>) }
      </div>
      <div className="engine-switch-route" aria-label={`从${from}切换到${to}`}><span>{from}</span><b aria-hidden="true">→</b><strong>{to}</strong></div>
      <h2 id="engine-switch-title">{copy.title}</h2>
      <p className="engine-switch-detail">{error || phase || copy.detail}</p>
      {(status === "loading" || status === "download" || status === "restoring") && <div className="engine-switch-progress" aria-label={`进度 ${clampedPercent}%`}><span style={{ width: `${clampedPercent}%` }}/></div>}
      {status === "loading" && <small className="engine-switch-progress-label">{phase || `正在准备 · ${clampedPercent}%`}</small>}
      <div className="engine-switch-actions">
        {canCancel && onCancel && <button type="button" className="engine-switch-action engine-switch-action--quiet" onClick={onCancel}><RotateCcw size={15}/>放弃切换</button>}
        {status === "config" && <button type="button" className="engine-switch-action engine-switch-action--primary" onClick={onClose}><Settings2 size={15}/>去配置</button>}
        {status === "download" && <button type="button" className="engine-switch-action engine-switch-action--quiet" onClick={onClose}>稍后再说</button>}
        {status === "failure" && onRetry && <button type="button" className="engine-switch-action engine-switch-action--primary" onClick={onRetry}><RotateCcw size={15}/>重试切换</button>}
        {status === "failure" && onFallback && <button type="button" className="engine-switch-action engine-switch-action--quiet" onClick={onFallback}>{fallbackLabel || "改用内置引擎继续"}</button>}
        {status === "success" && <span className="engine-switch-confirm" aria-hidden="true"><Check size={15}/>已接管</span>}
      </div>
      {status === "download" && <small className="engine-switch-footnote"><Download size={13}/>下载完成后会自动继续切换</small>}
    </section>
  </div>;
}
