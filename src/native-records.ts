import { importRecordFile } from "./formats";
import type { GameDocument, RecordNode } from "./types";

export const NATIVE_MATCH_FOLDER = "祁观vs弈心 人机大战五局";
export const NATIVE_MATCH_ASSET = "records/祁观vs弈心 人机大战五局.sgf";
export const NATIVE_RECORD_FOLDER = "内置棋谱";
export const NATIVE_DATABASE_ID = "native-database-jiutian-v5-1";
export const NATIVE_DATABASE_TITLE = "九天指南v5-1";
export const NATIVE_DATABASE_ASSET = "records/九天指南v5-1.db";
export const NATIVE_DATABASE_FILE_NAME = "九天指南v5-1.db";
const NATIVE_MATCH_ID_PREFIX = "native-record-qiguan-yixin-2018-game-";

const stableNativeDocument = (document: GameDocument, gameIndex: number): GameDocument => {
  const prefix = `${NATIVE_MATCH_ID_PREFIX}${gameIndex + 1}`;
  const idMap = new Map<string, string>();
  const visit = (id: string, path: string) => {
    if (idMap.has(id)) return;
    idMap.set(id, `${prefix}-${path}`);
    const node = document.nodes[id];
    node?.children.forEach((childId, childIndex) => visit(childId, `${path}-${childIndex + 1}`));
  };
  visit(document.rootId, "root");
  Object.keys(document.nodes).forEach((id, index) => visit(id, `orphan-${index + 1}`));

  const nodes = Object.fromEntries(Object.entries(document.nodes).map(([oldId, node]) => {
    const stableId = idMap.get(oldId) || `${prefix}-orphan-${oldId}`;
    const stableNode: RecordNode = {
      ...node,
      id: stableId,
      parentId: node.parentId ? idMap.get(node.parentId) || null : null,
      children: node.children.map((childId) => idMap.get(childId) || childId),
      preferredChildId: node.preferredChildId ? idMap.get(node.preferredChildId) : undefined,
    };
    return [stableId, stableNode];
  }));
  const metadata = {
    ...document.metadata,
    title: `第${gameIndex + 1}局`,
    sourceFormat: "sgf" as const,
    sourceFileName: NATIVE_MATCH_ASSET,
    tags: [...new Set([...document.metadata.tags, "内置棋谱", "祁观vs弈心"])],
  };
  return {
    ...document,
    id: prefix,
    rootId: idMap.get(document.rootId) || `${prefix}-root`,
    nodes,
    metadata,
    savedCurrentId: document.savedCurrentId ? idMap.get(document.savedCurrentId) : undefined,
  };
};

/** Load the bundled five-game Yixin/Qi Guan match as ordinary read/write records. */
export async function loadNativeMatchRecords(): Promise<GameDocument[]> {
  const response = await fetch(`/${NATIVE_MATCH_ASSET}`);
  if (!response.ok) throw new Error(`内置棋谱加载失败：${NATIVE_MATCH_FOLDER}`);
  const text = await response.text();
  const imported = await importRecordFile(new File([text], NATIVE_MATCH_ASSET, { type: "application/x-go-sgf" }));
  const documents = [imported.document, ...(imported.additionalDocuments || [])];
  if (documents.length !== 5) throw new Error(`内置棋谱应包含 5 局，实际读取到 ${documents.length} 局`);
  return documents.map((document, index) => stableNativeDocument(document, index));
}

export async function loadNativeDatabaseFile(): Promise<File> {
  const response = await fetch(`/${NATIVE_DATABASE_ASSET}`);
  if (!response.ok) throw new Error(`内置棋谱加载失败：${NATIVE_DATABASE_TITLE}`);
  return new File([await response.arrayBuffer()], NATIVE_DATABASE_FILE_NAME, { type: "application/octet-stream" });
}
