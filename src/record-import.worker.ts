import { importRecordFile } from "./formats";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const started = performance.now();
    const result = await importRecordFile(event.data);
    const parseMs = performance.now() - started;
    const nodeCount = result.stats?.nodeCount ?? 0;
    const isLarge = event.data.size >= 4 * 1024 * 1024 || nodeCount >= 40000;
    const summary = isLarge && result.stats ? {
      id: result.document.id, metadata: result.document.metadata, updatedAt: result.document.updatedAt,
      mainLineLength: result.stats.maxDepth, nodeCount: result.stats.nodeCount,
      fingerprint: `import-${result.document.id}-${result.stats.nodeCount}`, storageMode: result.compactIndex ? "compact-index" as const : "document" as const,
    } : undefined;
    const compactIndex = result.compactIndex;
    const transferableResult = compactIndex
      ? { ...result, document: { id: result.document.id, version: result.document.version, rootId: result.document.rootId, metadata: result.document.metadata, createdAt: result.document.createdAt, updatedAt: result.document.updatedAt, nodes: {} } }
      : result;
    const message = { ok: true, result: transferableResult, summary, compactIndex: undefined, compactDiagnostic: compactIndex ? { hasCompact: true, nodeCount: compactIndex.nodeCount, rootId: compactIndex.rootId, rootIndex: compactIndex.ids.indexOf(compactIndex.rootId), rootFirstChild: compactIndex.firstChild[compactIndex.ids.indexOf(compactIndex.rootId)] ?? null, parseMs } : { hasCompact: false, parseMs } };
    if (compactIndex) {
      const transferables: ArrayBuffer[] = [];
      for (const value of [compactIndex.parent, compactIndex.firstChild, compactIndex.nextSibling, compactIndex.childCount, compactIndex.preferredChild, compactIndex.moveCode, compactIndex.anchorCode, compactIndex.state, compactIndex.evaluation, compactIndex.evaluationLevel, compactIndex.markRefs, compactIndex.textRefs, compactIndex.setupRefs]) { if (value?.buffer instanceof ArrayBuffer) transferables.push(value.buffer); }
      self.postMessage({ ...message, compactIndex }, transferables);
    } else self.postMessage(message);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "棋谱解析失败", stack: error instanceof Error ? error.stack : undefined });
  }
};
