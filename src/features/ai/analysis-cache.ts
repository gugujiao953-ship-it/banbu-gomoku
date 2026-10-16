import type { Player, Position } from "../../types";

/**
 * 分析结果沉淀（用户 09-17 第一梯队②）。
 *
 * 每轮分析完成后把评估写进本机缓存，按「棋谱 + 节点」取用；同一局面再打开时
 * 分析面板可以直接载入上次结果，整局复盘也靠它做增量续算的地基。数据只存
 * localStorage——引擎结果本来就是估算值，不值得进 IndexedDB，也没有跨设备诉求。
 *
 * 体量控制：候选只留前三（PV 全剪掉）、全局 LRU 上限 600 条（约 60 份谱的
 * 主线体量），超限按 ts 淘汰最旧的。读写全部 try/catch：存储不可用时静默
 * 退化为「无沉淀」，绝不影响分析本身。
 */

export const ANALYSIS_CACHE_KEY = "banbu-analysis-cache-v2";
const CACHE_VERSION = 2;
const MAX_ENTRIES = 600;
const MAX_CANDIDATES = 3;

export interface AnalysisCacheCandidate {
  move: Position;
  score?: number;
  winRate?: number;
  depth?: number;
}

export interface AnalysisCacheEntry {
  /** 写入时间戳，LRU 淘汰依据。 */
  ts: number;
  /** 该局面轮谁走。存的是**引擎原值 + 行棋方**（2026-09-30 起所有引擎统一为行棋方视角：
   *  kata.cfg 的 reportAnalysisWinratesAs=SIDETOMOVE 再由启动参数兜底，Rapfi 本来就是）。
   *  曲线/复盘要单一视角，读取处用 toBlackWinRate(raw, mover) 现折。 */
  mover: Player;
  /** 产生这条记录的引擎（仅作溯源信息；视角已不随引擎变化）。 */
  engine?: "rapfi" | "kata" | "ikatago";
  depth: number;
  selDepth?: number;
  nodes: number;
  score?: number;
  scoreAvailable?: boolean;
  winRate?: number;
  candidates?: AnalysisCacheCandidate[];
}

interface AnalysisCacheFile {
  version: number;
  entries: Record<string, AnalysisCacheEntry>;
}

export const analysisCacheEntryKey = (documentId: string, nodeId: string) => `${documentId}::${nodeId}`;

const parseEntry = (raw: unknown): AnalysisCacheEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<AnalysisCacheEntry> & Record<string, unknown>;
  if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) return null;
  if (value.mover !== "black" && value.mover !== "white") return null;
  if (typeof value.depth !== "number" || typeof value.nodes !== "number") return null;
  const entry: AnalysisCacheEntry = {
    ts: value.ts,
    mover: value.mover,
    depth: value.depth,
    nodes: value.nodes,
  };
  if (typeof value.selDepth === "number") entry.selDepth = value.selDepth;
  // 引擎（决定 winRate 视角）：只认白名单，其余一律按 rapfi（旧缓存没有这个字段，
  // 而旧缓存全是 rapfi 时期写的——这样默认值就是正确的）。
  if (value.engine === "kata" || value.engine === "ikatago") entry.engine = value.engine;
  if (typeof value.score === "number") entry.score = value.score;
  if (value.scoreAvailable === true) entry.scoreAvailable = true;
  if (typeof value.winRate === "number" && Number.isFinite(value.winRate)) entry.winRate = value.winRate;
  if (Array.isArray(value.candidates)) {
    entry.candidates = value.candidates
      .filter((candidate): candidate is AnalysisCacheCandidate => Boolean(candidate && typeof candidate === "object" && (candidate as AnalysisCacheCandidate).move && typeof (candidate as AnalysisCacheCandidate).move.row === "number"))
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => ({
        move: { row: candidate.move.row, col: candidate.move.col },
        ...(typeof candidate.score === "number" ? { score: candidate.score } : {}),
        ...(typeof candidate.winRate === "number" ? { winRate: candidate.winRate } : {}),
        ...(typeof candidate.depth === "number" ? { depth: candidate.depth } : {}),
      }));
    if (!entry.candidates.length) delete entry.candidates;
  }
  return entry;
};

const loadFile = (): AnalysisCacheFile => {
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return { version: CACHE_VERSION, entries: {} };
    const parsed = JSON.parse(raw) as Partial<AnalysisCacheFile> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: CACHE_VERSION, entries: {} };
    }
    const entries: Record<string, AnalysisCacheEntry> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      const entry = parseEntry(value);
      if (entry) entries[key] = entry;
    }
    return { version: CACHE_VERSION, entries };
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
};

const writeFile = (file: AnalysisCacheFile) => {
  try { localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(file)); } catch { /* storage can be unavailable */ }
};

/** LRU 淘汰：条目超限时按 ts 删最旧的。 */
const trim = (file: AnalysisCacheFile) => {
  const keys = Object.keys(file.entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys.sort((a, b) => (file.entries[a]?.ts || 0) - (file.entries[b]?.ts || 0));
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete file.entries[key];
};

export const getAnalysisCacheEntry = (documentId: string, nodeId: string): AnalysisCacheEntry | null => {
  const file = loadFile();
  return file.entries[analysisCacheEntryKey(documentId, nodeId)] || null;
};

export const putAnalysisCacheEntry = (documentId: string, nodeId: string, entry: AnalysisCacheEntry) => {
  const file = loadFile();
  file.entries[analysisCacheEntryKey(documentId, nodeId)] = parseEntry(entry) || entry;
  trim(file);
  writeFile(file);
};

export const removeDocumentAnalysisCache = (documentId: string) => {
  const file = loadFile();
  let changed = false;
  const prefix = `${documentId}::`;
  for (const key of Object.keys(file.entries)) {
    if (key.startsWith(prefix)) { delete file.entries[key]; changed = true; }
  }
  if (changed) writeFile(file);
};

/** 一次读出某份棋谱的全部缓存（胜率图常态合成用：逐条 get 会把整个 JSON 反复解析 N 次）。 */
export const getDocumentAnalysisCache = (documentId: string): Record<string, AnalysisCacheEntry> => {
  const file = loadFile();
  const prefix = `${documentId}::`;
  const result: Record<string, AnalysisCacheEntry> = {};
  for (const [key, entry] of Object.entries(file.entries)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = entry;
  }
  return result;
};

export const analysisCacheEntryCount = (): number => Object.keys(loadFile().entries).length;

export const clearAnalysisCache = () => {
  try { localStorage.removeItem(ANALYSIS_CACHE_KEY); } catch { /* storage can be unavailable */ }
};
