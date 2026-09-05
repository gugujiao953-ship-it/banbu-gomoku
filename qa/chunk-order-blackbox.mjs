import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ serviceWorkers: "block" });
try {
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const count = 1_000_001;
    const { compactIndexOf } = await import("/src/compact-index.ts");
    const { loadLargeDocument, removeLargeDocument, saveCompactIndex } = await import("/src/large-storage.ts");
    const ints = () => new Int32Array(count).fill(-1);
    const index = {
      version: 2,
      nodeCount: count,
      rootId: "root-test",
      ids: Array.from({ length: count }, (_, i) => i === 0 ? "root-test" : `renlib-test-${i.toString(36)}`),
      parent: ints(),
      firstChild: ints(),
      nextSibling: ints(),
      childCount: new Int32Array(count),
      preferredChild: ints(),
      moveCode: new Uint16Array(count),
      state: new Uint8Array(count),
      textRefs: new Int32Array(count * 2).fill(-1),
      texts: [],
      anchorCode: new Uint16Array(count),
      evaluation: new Int8Array(count),
      evaluationLevel: new Uint8Array(count),
      markRefs: new Int32Array(count * 2).fill(-1),
      marks: [],
    };
    const now = new Date().toISOString();
    const document = {
      id: "chunk-order-regression",
      version: 1,
      rootId: "root-test",
      nodes: {},
      metadata: { title: "chunk order", black: "", white: "", event: "", date: "", result: "", rule: "renju", boardSize: 15, tags: [] },
      createdAt: now,
      updatedAt: now,
    };
    await saveCompactIndex(document, index, {
      id: document.id,
      metadata: document.metadata,
      updatedAt: now,
      mainLineLength: 0,
      nodeCount: count,
      fingerprint: "chunk-order",
      storageMode: "compact-index",
    });
    const loaded = await loadLargeDocument(document.id);
    const restored = loaded ? compactIndexOf(loaded) : undefined;
    const samples = [0, 250_000, 500_000, 750_000, 1_000_000].map((i) => ({
      index: i,
      expected: index.ids[i],
      actual: loaded?.nodes[index.ids[i]]?.id ?? null,
    }));
    await removeLargeDocument(document.id);
    return {
      loaded: Boolean(loaded),
      saveImplementation: saveCompactIndex.toString().slice(0, 240),
      loadedKeys: loaded ? Object.keys(loaded) : [],
      loadedNodeKeys: loaded ? Object.keys(loaded.nodes).slice(0, 5) : [],
      restored: Boolean(restored),
      restoredIdCount: restored?.ids.length ?? null,
      restoredNodeCount: restored?.nodeCount ?? null,
      samples,
      matches: samples.every((sample) => sample.expected === sample.actual),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.loaded || !result.restored || !result.matches || result.restoredIdCount !== 1_000_001 || result.restoredNodeCount !== 1_000_001) process.exitCode = 1;
} finally {
  await browser.close();
}

