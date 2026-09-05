import type { GameDocument, RecordNode } from "../../types";
import { documentFingerprint } from "../../large-storage";

export type ExportScope = "current-variation" | "full-tree" | "single-record" | "library-backup";
export type ExportPurpose = "share" | "restore";
export type ExportFormat = "sgf" | "json" | "native-backup" | "png";
export const exportScopeLabel = (scope: ExportScope) => ({ "current-variation": "当前变化 / 当前分支", "full-tree": "完整棋谱树", "single-record": "单个棋谱或棋题", "library-backup": "整个资料库备份" } as Record<ExportScope, string>)[scope];
export const exportPurposeLabel = (purpose: ExportPurpose) => purpose === "share" ? "分享/交换（通用格式）" : "无损恢复（应用原生备份）";

export interface ExportContentSummary {
  scope: ExportScope;
  purpose: ExportPurpose;
  format: ExportFormat;
  recordCount: number;
  nodeCount: number;
  branchCount: number;
  includes: {
    comments: boolean;
    bookmarks: boolean;
    evaluations: boolean;
    metadata: boolean;
    history: boolean;
  };
  description: string;
}

export interface ExportEnvelope<T = unknown> {
  schema: "banbu-gomoku-export";
  schemaVersion: 2;
  appVersion: string;
  exportedAt: string;
  scope: ExportScope;
  purpose: ExportPurpose;
  format: ExportFormat;
  contentHash: string;
  compatibility: { minAppVersion?: string; importableBy: string[]; notes: string[] };
  summary: ExportContentSummary;
  payload: T;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
const hash = (text: string) => {
  let a = 2166136261 >>> 0;
  let b = 2246822519 >>> 0;
  for (let i = 0; i < text.length; i += 1) { a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ text.charCodeAt(i), 3266489917) >>> 0; }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
};

export const contentHash = (value: unknown) => hash(stableJson(value));
const nodesOf = (payload: unknown): Record<string, RecordNode> => isRecord(payload) && isRecord(payload.nodes) ? payload.nodes as Record<string, RecordNode> : {};
const countComments = (nodes: Record<string, RecordNode>) => Object.values(nodes).filter((node) => Boolean(node.comment || node.boardText || node.renLibAnnotations?.some((item) => item.text))).length;
const countBookmarks = (payload: unknown) => isRecord(payload) && isRecord(payload.branchBookmarks) ? Object.values(payload.branchBookmarks).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0) : 0;

export const summarizeExport = (payload: unknown, scope: ExportScope, purpose: ExportPurpose, format: ExportFormat): ExportContentSummary => {
  if (scope === "library-backup") return { scope, purpose, format, recordCount: isRecord(payload) && isRecord(payload.localStorage) && Array.isArray(payload.localStorage.library) ? payload.localStorage.library.length : 0, nodeCount: 0, branchCount: 0, includes: { comments: true, bookmarks: true, evaluations: true, metadata: true, history: true }, description: "整个资料库的原生备份，包含可恢复数据与版本信息" };
  const nodes = nodesOf(payload);
  const branchCount = Object.values(nodes).filter((node) => Array.isArray(node.children) && node.children.length > 1).length;
  const comments = countComments(nodes) > 0;
  const evaluations = Object.values(nodes).some((node) => Boolean(node.evaluation));
  const bookmarks = countBookmarks(payload) > 0;
  return {
    scope, purpose, format, recordCount: 1, nodeCount: Object.keys(nodes).length, branchCount,
    includes: { comments, bookmarks, evaluations, metadata: isRecord(payload) && isRecord(payload.metadata), history: purpose === "restore" || format === "native-backup" },
    description: scope === "current-variation" ? "当前分支路径及其后续主线" : scope === "full-tree" ? "完整棋谱树、分支和节点资料" : "单个棋谱/棋题及其当前资料",
  };
};

export const createExportEnvelope = <T>(payload: T, options: { appVersion: string; scope: ExportScope; purpose?: ExportPurpose; format: ExportFormat; minAppVersion?: string; notes?: string[] }): ExportEnvelope<T> => {
  const purpose = options.purpose || (options.format === "native-backup" ? "restore" : "share");
  return { schema: "banbu-gomoku-export", schemaVersion: 2, appVersion: options.appVersion, exportedAt: new Date().toISOString(), scope: options.scope, purpose, format: options.format, contentHash: contentHash(payload), compatibility: { minAppVersion: options.minAppVersion, importableBy: ["半步五子棋打谱 1.x"], notes: options.notes || [] }, summary: summarizeExport(payload, options.scope, purpose, options.format), payload };
};

export const serializeExportEnvelope = <T>(envelope: ExportEnvelope<T>) => {
  if (!validateExportEnvelope(envelope)) throw new Error("导出文件未通过格式校验");
  return JSON.stringify(envelope, null, 2);
};

export const migrateExportEnvelope = (value: unknown): ExportEnvelope => {
  if (!isRecord(value)) throw new Error("导出文件不是有效对象");
  if (value.schema === "banbu-gomoku-backup" && value.version === 1) {
    const payload = value;
    return createExportEnvelope(payload, { appVersion: String(value.appVersion || "unknown"), scope: "library-backup", purpose: "restore", format: "native-backup", notes: ["由 banbu-gomoku-backup v1 自动迁移"] });
  }
  if (value.schema !== "banbu-gomoku-export") throw new Error("不支持的导出文件 schema");
  if (value.schemaVersion === 1) {
    const migrated = { ...value, schemaVersion: 2, compatibility: value.compatibility || { importableBy: ["半步五子棋打谱 1.x"], notes: ["由 v1 自动迁移"] }, summary: value.summary || summarizeExport(value.payload, value.scope as ExportScope, value.purpose as ExportPurpose, value.format as ExportFormat), contentHash: typeof value.contentHash === "string" ? value.contentHash : contentHash(value.payload) };
    return migrated as unknown as ExportEnvelope;
  }
  return value as unknown as ExportEnvelope;
};

export const parseExportEnvelope = (text: string): ExportEnvelope => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("导出文件不是有效的 JSON"); }
  const envelope = migrateExportEnvelope(value);
  if (!validateExportEnvelope(envelope)) throw new Error("导出文件版本、字段或数据结构无效");
  if (envelope.contentHash !== contentHash(envelope.payload)) throw new Error("导出文件内容校验失败，文件可能已损坏");
  return envelope;
};

export const validateExportEnvelope = (value: unknown): value is ExportEnvelope => {
  if (!isRecord(value) || value.schema !== "banbu-gomoku-export" || value.schemaVersion !== 2 || typeof value.appVersion !== "string" || typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt)) || !["current-variation", "full-tree", "single-record", "library-backup"].includes(String(value.scope)) || !["share", "restore"].includes(String(value.purpose)) || !["sgf", "json", "native-backup", "png"].includes(String(value.format)) || typeof value.contentHash !== "string" || !isRecord(value.compatibility) || !Array.isArray(value.compatibility.importableBy) || !isRecord(value.summary) || !isRecord(value.payload)) return false;
  return true;
};

export const filenameForExport = (title: string, scope: ExportScope, format: ExportFormat, exportedAt = new Date()) => {
  const safe = title.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名棋谱";
  const stamp = exportedAt.toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const suffix = scope === "current-variation" ? "当前分支" : scope === "full-tree" ? "完整棋谱树" : scope === "single-record" ? "单个棋谱" : "资料库备份";
  const ext = format === "native-backup" ? "banbu-backup.json" : format;
  return `${safe}-${suffix}-${stamp}.${ext}`;
};

export const fingerprintForExport = (document: GameDocument) => documentFingerprint(document);
