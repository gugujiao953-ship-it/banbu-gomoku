import { Component, type ErrorInfo, type ReactNode } from "react";
import { APP_VERSION, downloadDiagnostics, recordAction } from "./diagnostics";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Top-level crash guard: a render exception anywhere in the app used to blank
 * the whole PWA (users had to clear the cache to recover). This keeps the user
 * on a recovery card with a one-click diagnostics export instead. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordAction(`渲染异常：${error.message.slice(0, 120)}`);
    console.error("半步五子棋遇到未处理异常", error, info.componentStack);
  }

  private handleCopy = () => {
    const { error } = this.state;
    void navigator.clipboard?.writeText(JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2)).catch(() => {});
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <span className="error-boundary-mark" aria-hidden="true">半</span>
          <h1>半步五子棋遇到异常</h1>
          <p>页面崩溃了，但你的棋谱、题库与设置仍保存在本机。可先导出诊断信息，再重新加载应用。</p>
          <p className="error-boundary-message">{error.message || "未知错误"}</p>
          {error.stack && (
            <details>
              <summary>技术细节（错误堆栈）</summary>
              <pre>{error.stack}</pre>
            </details>
          )}
          <div className="error-boundary-actions">
            <button type="button" className="primary-button" onClick={() => downloadDiagnostics(error)}>导出诊断信息</button>
            <button type="button" className="secondary-button" onClick={this.handleCopy}>复制错误内容</button>
            <button type="button" className="secondary-button" onClick={this.handleReload}>重新加载应用</button>
          </div>
          <small className="error-boundary-version">半步五子棋 {APP_VERSION} · 诊断信息只保存在导出文件中，不会自动上传</small>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
