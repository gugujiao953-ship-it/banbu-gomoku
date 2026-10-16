import { importRecordFile } from "./formats";
import { saveCompactIndex } from "./large-storage";

const transferIndex = (index: NonNullable<Awaited<ReturnType<typeof importRecordFile>>["compactIndex"]>) => {
  const transferables: ArrayBuffer[] = [];
  for (const value of [index.parent, index.firstChild, index.nextSibling, index.childCount, index.preferredChild, index.moveCode, index.anchorCode, index.state, index.evaluation, index.evaluationLevel, index.markRefs, index.textRefs, index.setupRefs, index.annotationRefs, index.renLibFlags, index.renLibExtendedFlags]) { if (value?.buffer instanceof ArrayBuffer) transferables.push(value.buffer); }
  return transferables;
};

const baseResult = (result: Awaited<ReturnType<typeof importRecordFile>>) => ({ ...result, document: { id: result.document.id, version: result.document.version, rootId: result.document.rootId, metadata: result.document.metadata, createdAt: result.document.createdAt, updatedAt: result.document.updatedAt, nodes: {} } });

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    self.postMessage({ progress: true, phase: "parsing", detail: "正在解析棋谱结构" });
    const started = performance.now();
    let previewSent = false;
    const result = await importRecordFile(event.data, { onPreview: async (preview) => {
      if (previewSent) return;
      previewSent = true;
      const summary = { id: preview.document.id, metadata: preview.document.metadata, updatedAt: preview.document.updatedAt, mainLineLength: preview.stats?.maxDepth || 0, nodeCount: preview.stats?.nodeCount || preview.compactIndex.nodeCount, fingerprint: `import-${preview.document.id}-complete`, storageMode: "compact-index" as const, preview: true };
      // Do not transfer preview buffers: parsing continues after this callback.
      // Transferring would detach the Worker's live typed arrays and can corrupt
      // or crash the remaining parse. The bounded preview is safely cloned.
      self.postMessage({ progress: true, phase: "indexing", detail: "首批内容已可浏览，后台继续建立完整索引", background: true });
      self.postMessage({ ok: true, preview: true, result: baseResult({ ...preview, warnings: [], format: "RenLib LIB", stats: preview.stats }), summary, compactIndex: preview.compactIndex, compactDiagnostic: { hasCompact: true, nodeCount: preview.compactIndex.nodeCount, preview: true } });
    } });
    const parseMs = performance.now() - started;
    const nodeCount = result.stats?.nodeCount ?? 0;
    const isLarge = event.data.size >= 4 * 1024 * 1024 || nodeCount >= 40000;
    const summary = isLarge && result.stats ? {
      id: result.document.id, metadata: result.document.metadata, updatedAt: result.document.updatedAt,
      mainLineLength: result.stats.maxDepth, nodeCount: result.stats.nodeCount,
      fingerprint: `import-${result.document.id}-${result.stats.nodeCount}`, storageMode: result.compactIndex ? "compact-index" as const : "document" as const,
    } : undefined;
    const compactIndex = result.compactIndex;
    if (compactIndex && summary && previewSent) {
      // The complete result stays in the worker and is committed directly to
      // the paged store. This avoids copying a multi-million-node index back
      // through postMessage after the UI has already become usable.
      self.postMessage({ progress: true, phase: "saving", detail: "完整索引已建立，正在后台保存", background: true });
      const persistedSummary = await saveCompactIndex(result.document, compactIndex, summary);
      self.postMessage({ ok: true, finalOnly: true, summary: persistedSummary, compactDiagnostic: { hasCompact: true, nodeCount: compactIndex.nodeCount, parseMs } });
      return;
    }
    // 只有带 compact 索引时才能回传「剥掉 nodes 的文档」——主线程会用
    // createLazyDocument(索引) 把节点树还原出来。**没有索引的格式（SGF / PSQ / POS 等）
    // 必须回传完整节点树**：baseResult 会把 nodes 清空，那条路存进库里的就是一份空棋谱
    // （实测：≥4MB 的 SGF 导入后提示「已存入大型棋谱库」，但条目里没有子、棋盘空白）。
    // 结构化克隆一整棵树的代价换的是正确性；真要省这一步，得给大 SGF 也建 compact 索引。
    const message = compactIndex
      ? { ok: true, result: baseResult(result), summary, compactDiagnostic: { hasCompact: true, parseMs } }
      : { ok: true, result, summary, compactDiagnostic: { hasCompact: false, parseMs } };
    if (compactIndex) {
      self.postMessage({ ...message, compactIndex }, transferIndex(compactIndex));
    } else self.postMessage(message);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "棋谱解析失败", stack: error instanceof Error ? error.stack : undefined });
  }
};
