import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";

type ToastKind = "success" | "info" | "warning" | "error" | "loading";

const classifyToast = (message: string): ToastKind => {
  if (/失败|错误|异常|无法|不能|不足|失败|拒绝/.test(message)) return "error";
  if (/正在|处理中|读取中|加载中|识别中|搜索中|转换中/.test(message)) return "loading";
  if (/警告|注意|禁手|非法|请先|没有合法|已用尽|超过/.test(message)) return "warning";
  if (/已|成功|完成|保存|创建|导入|导出|恢复|切换|放置|找到/.test(message)) return "success";
  return "info";
};

const iconFor = (kind: ToastKind) => {
  if (kind === "success") return <CheckCircle2 aria-hidden="true"/>;
  if (kind === "warning") return <AlertTriangle aria-hidden="true"/>;
  if (kind === "error") return <AlertTriangle aria-hidden="true"/>;
  if (kind === "loading") return <LoaderCircle className="app-toast-spinner" aria-hidden="true"/>;
  return <Info aria-hidden="true"/>;
};

export function AppToast({ message, onClose }: { message: string; onClose: () => void }) {
  const kind = classifyToast(message);
  const liveMode = kind === "error" || kind === "warning" ? "assertive" : "polite";
  return <div className={`toast app-toast app-toast-${kind}`} role="status" aria-live={liveMode} aria-atomic="true">
    <span className="app-toast-icon">{iconFor(kind)}</span>
    <span className="app-toast-message">{message}</span>
    <button className="app-toast-close" type="button" onClick={onClose} aria-label="关闭提示"><X size={15}/></button>
  </div>;
}
