// Lightweight in-app diagnostics: a ring buffer of user-visible actions plus a
// report builder for bug reports. Kept dependency-free so the ErrorBoundary can
// rely on it even when the rest of the app failed to boot.

export const APP_VERSION = "1.1.6";

interface DiagnosticsEntry {
  time: string;
  action: string;
}

const MAX_ENTRIES = 60;
const entries: DiagnosticsEntry[] = [];

export const recordAction = (action: string) => {
  entries.push({ time: new Date().toISOString(), action });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
};

export const recentActions = (): DiagnosticsEntry[] => [...entries];

export interface DiagnosticsReport {
  app: string;
  version: string;
  time: string;
  userAgent: string;
  language: string;
  viewport: { width: number; height: number };
  url: string;
  mode: "development" | "production" | "test";
  error?: { message: string; stack?: string };
  componentStack?: string;
  recentActions: DiagnosticsEntry[];
}

export const buildDiagnosticsReport = (error?: unknown, componentStack?: string): DiagnosticsReport => ({
  app: "banbu-gomoku",
  version: APP_VERSION,
  time: new Date().toISOString(),
  userAgent: navigator.userAgent,
  language: navigator.language,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  // Do not put query strings or hash fragments into a bug-report artifact.
  url: `${location.origin}${location.pathname}`,
  mode: import.meta.env.MODE === "development" ? "development" : import.meta.env.MODE === "test" ? "test" : "production",
  error: error instanceof Error
    ? { message: error.message, stack: error.stack }
    : error !== undefined
      ? { message: String(error) }
      : undefined,
  componentStack: componentStack || undefined,
  recentActions: recentActions(),
});

export const diagnosticsFilename = (time = new Date()) => `半步五子棋打谱诊断-${time.toISOString().replace(/[:.]/g, "-").replace("Z", "")}.json`;

export const diagnosticsText = (error?: unknown, componentStack?: string) => JSON.stringify(buildDiagnosticsReport(error, componentStack), null, 2);

export const downloadDiagnostics = (error?: unknown, componentStack?: string) => {
  const blob = new Blob([diagnosticsText(error, componentStack)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = diagnosticsFilename();
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
