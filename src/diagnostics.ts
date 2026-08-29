// Lightweight in-app diagnostics: a ring buffer of user-visible actions plus a
// report builder for bug reports. Kept dependency-free so the ErrorBoundary can
// rely on it even when the rest of the app failed to boot.

export const APP_VERSION = "1.1.4";

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
  error?: { message: string; stack?: string };
  recentActions: DiagnosticsEntry[];
}

export const buildDiagnosticsReport = (error?: unknown): DiagnosticsReport => ({
  app: "banbu-gomoku",
  version: APP_VERSION,
  time: new Date().toISOString(),
  userAgent: navigator.userAgent,
  language: navigator.language,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  url: location.href,
  error: error instanceof Error
    ? { message: error.message, stack: error.stack }
    : error !== undefined
      ? { message: String(error) }
      : undefined,
  recentActions: recentActions(),
});

export const diagnosticsFilename = (time = new Date()) => `半步五子棋诊断-${time.toISOString().replace(/[:.]/g, "-").replace("Z", "")}.json`;

export const diagnosticsText = (error?: unknown) => JSON.stringify(buildDiagnosticsReport(error), null, 2);

export const downloadDiagnostics = (error?: unknown) => {
  const blob = new Blob([diagnosticsText(error)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = diagnosticsFilename();
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
