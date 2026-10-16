import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMove, createDocument } from "./game";
import { buildCompactRenLibIndex } from "./compact-index";
import { loadLargeDocument, loadLargeSummaries, saveCompactIndex } from "./large-storage";
import { loadDraftFromLocal, loadLibrary, saveDraftToLocal, saveToLibrary } from "./storage";
import { createBackupSnapshot, parseBackup, restoreBackup, restoreBackupStateOnly, serializeBackup, validateBackup } from "./backup";
// 构造"旧备份"时要重算哈希（备份带防篡改校验，见那条用例的注释）。
import { contentHash } from "./features/data-safety/export-semantics";
import { createZip, readZip, textFromZipEntry } from "./zip";
import { generatedCollection } from './features/puzzle-generator/collection';
import { generate } from '../vcf-generator/lib/browser.mjs';
import { grantSoul, recoverSoulPurchases, resetSoulLedger, soulLedger, subscribeSoulLedger } from "./features/progress/soul";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("versioned application backup", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    resetSoulLedger();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("banbu-gomoku-large-library");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each(["full", "state"] as const)("replaces the cached soul ledger after a successful %s restore", async (scope) => {
    const incoming = await createBackupSnapshot("test", scope);
    incoming.localStorage.soulLedger = [{ id: "restored", at: 1, amount: 700, reason: "manual", detail: "restored balance" }];
    grantSoul(soulLedger(), { amount: 30, reason: "manual", detail: "old process balance", token: "old" });
    const restore = scope === "state" ? restoreBackupStateOnly : restoreBackup;
    await restore(incoming);
    expect(grantSoul(soulLedger(), { amount: 20, reason: "manual", detail: "earned after restore", token: "new" }).ok).toBe(true);
    const stored = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1")!);
    expect(stored.map((entry: { id: string }) => entry.id)).toContain("restored");
    expect(stored.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0)).toBe(720);
  });

  it.each(["full", "state"] as const)("delivers only restored pending purchases after a successful %s restore", async (scope) => {
    const incoming = await createBackupSnapshot("test", scope);
    incoming.localStorage.soulLedger = [{
      id: "restored", at: 1, amount: 700, reason: "manual", detail: "restored balance",
      pendingPurchases: [{ key: "banbu-vcf-items-v1", id: "hint", count: 2, token: "new-purchase" }],
    }];
    incoming.localStorage.vcfItems = { hint: 3 };
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{
      id: "old", at: 1, amount: 100, reason: "manual", detail: "old balance",
      pendingPurchases: [{ key: "banbu-vcf-items-v1", id: "hint", count: 100, token: "old-purchase" }],
    }]));
    soulLedger();
    const observedStocks: number[] = [];
    const unsubscribe = subscribeSoulLedger(() => {
      observedStocks.push(JSON.parse(localStorage.getItem("banbu-vcf-items-v1")!).hint);
      recoverSoulPurchases(soulLedger());
    });
    try {
      const restore = scope === "state" ? restoreBackupStateOnly : restoreBackup;
      await restore(incoming);
      recoverSoulPurchases(soulLedger());
      expect(JSON.parse(localStorage.getItem("banbu-vcf-items-v1")!).hint).toBe(5);
      expect(observedStocks[0]).toBe(3);
      expect(soulLedger().entries.map((entry) => entry.id)).toContain("restored");
    } finally { unsubscribe(); }
  });

  it.each(["dunhuang", '"dunhuang"', "pelican", "dark", '"dark"'])("preserves theme preference %s through backup and restore", async (stored) => {
    localStorage.setItem("banbu-theme-preference-v1", stored);
    const snapshot = parseBackup(serializeBackup(await createBackupSnapshot("test")));
    const expected = stored.startsWith('"') ? JSON.parse(stored) : stored;
    expect(snapshot.localStorage.themePreference).toBe(expected);
    localStorage.setItem("banbu-theme-preference-v1", "light");
    await restoreBackup(snapshot);
    expect(localStorage.getItem("banbu-theme-preference-v1")).toBe(expected);
  });

  it("rejects draft entries that would overwrite unrelated storage keys", async () => {
    const snapshot = await createBackupSnapshot("test", "state");
    snapshot.localStorage.drafts["banbu-vault-registry-v1"] = { operations: [], redo: [] };
    expect(validateBackup(snapshot)).toBe(false);
  });

  it("rejects malformed recycle-bin storage before restoring", async () => {
    const snapshot = await createBackupSnapshot("test", "state");
    snapshot.indexedDb.trashDocuments = {} as never;
    expect(validateBackup(snapshot)).toBe(false);
  });

  it("rejects duplicate IndexedDB keys instead of silently overwriting a record", async () => {
    const snapshot = await createBackupSnapshot("test", "state");
    snapshot.indexedDb.documents = [{ id: "same", nodes: {} }, { id: "same", nodes: {} }];
    expect(validateBackup(snapshot)).toBe(false);
  });

  it("rejects cyclic or out-of-bounds record trees in a backup", async () => {
    const snapshot = await createBackupSnapshot("test", "state");
    const document = createDocument();
    document.nodes[document.rootId].children = [document.rootId];
    snapshot.localStorage.library = [document];
    expect(validateBackup(snapshot)).toBe(false);
    document.nodes[document.rootId].children = [];
    const moved = addMove(document, document.rootId, { row: 7, col: 7 });
    moved.document.nodes[moved.nodeId].move!.row = 100;
    snapshot.localStorage.library = [moved.document];
    expect(validateBackup(snapshot)).toBe(false);
  });

  it("rolls back state writes as raw bytes if a later write exceeds quota", async () => {
    const incoming = await createBackupSnapshot("test", "state");
    incoming.localStorage.soulLedger = [{ amount: 900 }];
    incoming.localStorage.soulUnlocks = ["new-theme"];
    localStorage.setItem("banbu-soul-ledger-v1", ' [ { "amount" : 20 } ] ');
    localStorage.setItem("banbu-soul-unlocks-v1", '["old-theme"]');
    const before = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map((key) => [key, localStorage.getItem(key)]);
    const setItem = localStorage.setItem.bind(localStorage);
    let failed = false;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "banbu-soul-unlocks-v1" && !failed) { failed = true; throw new DOMException("quota", "QuotaExceededError"); }
      setItem(key, value);
    });
    await expect(restoreBackupStateOnly(incoming)).rejects.toThrow("quota");
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map((key) => [key, localStorage.getItem(key)]).sort()).toEqual(before.sort());
  });

  it("preserves local records when a state backup reaches the full restore API", async () => {
    const incoming = await createBackupSnapshot("test", "state");
    const original = createDocument("local record");
    saveToLibrary(original);
    await restoreBackup(incoming);
    expect(loadLibrary().map((document) => document.id)).toContain(original.id);
  });

  it("restores exact local bytes and large records after a full restore fails", async () => {
    const incoming = await createBackupSnapshot("test");
    const original = createDocument("survive full restore failure");
    await saveCompactIndex(original, buildCompactRenLibIndex(original));
    saveToLibrary(original);
    localStorage.setItem("banbu-review-marks-v1", "legacy unparseable marks");
    const before = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map((key) => [key, localStorage.getItem(key)]);
    const setItem = localStorage.setItem.bind(localStorage);
    let failed = false;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "banbu-review-marks-v1" && !failed) { failed = true; throw new DOMException("quota", "QuotaExceededError"); }
      setItem(key, value);
    });
    await expect(restoreBackup(incoming)).rejects.toThrow("quota");
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map((key) => [key, localStorage.getItem(key)]).sort()).toEqual(before.sort());
    expect((await loadLargeDocument(original.id))?.metadata.title).toBe(original.metadata.title);
  });
  it('round-trips a full generator proof on a 30-line board and the matching default size', async () => {
    const generated = generate({ count:1,depth:5,size:30,seed:7,timeMs:10000 }).puzzles[0];
    expect(generated).toBeTruthy();
    localStorage.setItem('renju-note-puzzle-collections-v1',JSON.stringify([generatedCollection([generated],'generated-test','生成题集')]));
    localStorage.setItem('banbu-default-board-size-v1','30');
    const parsed = parseBackup(serializeBackup(await createBackupSnapshot('test')));
    expect(parsed.localStorage.puzzleCollections).toEqual([generatedCollection([generated],'generated-test','生成题集')]);
    expect(parsed.localStorage.defaultBoardSize).toBe(30);
    localStorage.clear(); await restoreBackup(parsed);
    expect(JSON.parse(localStorage.getItem('renju-note-puzzle-collections-v1')!)[0].puzzles[0].generated).toEqual(generated);
  });

  it("keeps puzzle stones that sit outside the legacy 15x15 box", async () => {
    // 引擎已支持多路数，19 路题目是合法数据。旧校验写死 row/col < 15，会把这类
    // 题目的棋子判成非法，进而让整份备份过不了 validateBackup（数据静默丢失）。
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{ id: "c19", title: "19 路题库", source: "用户", license: "自有", puzzles: [{ id: "p19", title: "19 路题", prompt: "黑先", difficulty: 3, player: "black", boardSize: 19, stones: [{ row: 16, col: 16, player: "black" }, { row: 9, col: 9, player: "white" }] }] }]));
    const parsed = parseBackup(serializeBackup(await createBackupSnapshot("test")));
    const collections = parsed.localStorage.puzzleCollections as Array<{ puzzles: Array<{ id: string; stones: unknown[] }> }>;
    expect(collections).toHaveLength(1);
    expect(collections[0].puzzles[0].id).toBe("p19");
    expect(collections[0].puzzles[0].stones).toContainEqual({ row: 16, col: 16, player: "black" });
  });

  it("round-trips local data, drafts, and compact large indexes", async () => {
    let document = createDocument("备份棋谱");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    saveToLibrary(document);
    saveDraftToLocal(document.id, { operations: [{ type: "update-node", nodeId: document.rootId, patch: { comment: "未保存注释" } }], redo: [] });
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{ id: "c1", title: "题库", source: "用户", license: "自有", puzzles: [{ id: "p1", title: "题目", prompt: "黑先", difficulty: 2, player: "black", stones: [{ row: 7, col: 7, player: "black" }] }] }]));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({ "c1/p1": { solved: true, attempts: 2, updatedAt: new Date().toISOString() } }));
    localStorage.setItem("renju-note-library-folders-v1", JSON.stringify({ recordFolders: ["研究"], puzzleFolders: ["题库"], recordAssignments: { [document.id]: "研究" }, puzzleAssignments: {} }));
    localStorage.setItem("banbu-stone-opacity-v1", "0.68");
    localStorage.setItem("banbu-board-opacity-v1", "0.74");
    localStorage.setItem("banbu-board-theme-v1", "aurora");
    localStorage.setItem("banbu-stone-theme-v1", "diamond");
    localStorage.setItem("banbu-default-board-size-v1", "19");
    localStorage.setItem("banbu-font-scale-v1", "large");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ gestureSwipe: true, gestureZoom: true }));
    localStorage.setItem("banbu-annotation-highlight-v1", "gold");
    await saveCompactIndex(document, buildCompactRenLibIndex(document));

    const serialized = serializeBackup(await createBackupSnapshot("test"));
    const parsed = parseBackup(serialized);

    saveToLibrary(createDocument("覆盖数据"));
    localStorage.setItem("renju-note-draft-v2:other", JSON.stringify({ operations: [], redo: [] }));
    await restoreBackup(parsed);

    expect(loadLibrary().some((item) => item.id === document.id && item.metadata.title === "备份棋谱")).toBe(true);
    expect(loadDraftFromLocal(document.id).operations).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("renju-note-puzzle-progress-v1") || "{}")["c1/p1"].solved).toBe(true);
    expect(JSON.parse(localStorage.getItem("renju-note-library-folders-v1") || "{}").recordFolders).toEqual(["研究"]);
    expect(JSON.parse(localStorage.getItem("banbu-stone-opacity-v1") || "1")).toBe(0.68);
    expect(JSON.parse(localStorage.getItem("banbu-board-opacity-v1") || "1")).toBe(0.74);
    expect(localStorage.getItem("banbu-board-theme-v1")).toBe("aurora");
    expect(localStorage.getItem("banbu-stone-theme-v1")).toBe("diamond");
    expect(localStorage.getItem("banbu-default-board-size-v1")).toBe("19");
    expect(localStorage.getItem("banbu-font-scale-v1")).toBe("large");
    expect(JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").gestureSwipe).toBe(true);
    expect(localStorage.getItem("banbu-annotation-highlight-v1")).toBe("gold");
    expect((await loadLargeDocument(document.id))?.nodes[document.rootId]).toBeDefined();
    expect((await loadLargeSummaries()).some((item) => item.id === document.id)).toBe(true);
  });

  it("rejects invalid schema and leaves existing data untouched", async () => {
    const document = createDocument("原有数据");
    saveToLibrary(document);
    await expect(Promise.resolve().then(() => parseBackup(JSON.stringify({ schema: "wrong", version: 99 })))).rejects.toThrow();
    expect(loadLibrary()[0]?.metadata.title).toBe("原有数据");
  });

  it("棋谱里的标注、分支、盘面文字与评价都随备份原样回来（2026-09-19 补）", async () => {
    // 备份是数据安全底线：以前这条测试只断言「棋谱在不在」，标注/分支丢了也照样绿。
    let document = createDocument("带标注与分支");
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 });
    document = second.document;
    const branch = addMove(document, first.nodeId, { row: 6, col: 6 }); // 第二分支
    document = branch.document;
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [first.nodeId]: {
          ...document.nodes[first.nodeId],
          comment: "第一手要点",
          boardText: "要点",
          evaluation: "good",
          marks: [
            { row: 3, col: 3, kind: "circle", style: "circle-solid", color: "#2872b8", label: "长标注文字超过四字" },
            { row: 4, col: 4, kind: "triangle", style: "triangle" },
          ],
        },
      },
    };
    saveToLibrary(document);

    const serialized = serializeBackup(await createBackupSnapshot("test"));
    saveToLibrary(createDocument("覆盖数据"));
    await restoreBackup(parseBackup(serialized));

    const restored = loadLibrary().find((item) => item.id === document.id);
    expect(restored).toBeDefined();
    const node = restored!.nodes[first.nodeId];
    expect(node.comment).toBe("第一手要点");
    expect(node.boardText).toBe("要点");
    expect(node.evaluation).toBe("good");
    expect(node.marks?.map((mark) => `${mark.row},${mark.col}:${mark.style}:${mark.label || ""}`))
      .toEqual(["3,3:circle-solid:长标注文字超过四字", "4,4:triangle:"]);
    // 两个分支都要在，且 preferredChildId 仍指向主线那一手
    expect(restored!.nodes[first.nodeId].children).toHaveLength(2);
    expect(restored!.nodes[first.nodeId].children).toContain(second.nodeId);
    expect(restored!.nodes[first.nodeId].children).toContain(branch.nodeId);
    expect(restored!.nodes[first.nodeId].preferredChildId).toBe(branch.nodeId);
  });

  it("分析缓存与整局复盘数据也随备份往返（2026-09-19 新增键的回归锁）", async () => {
    // 这两个键是「分析结果沉淀 / 整局复盘」的落库位置：换机丢一次就等于把用户的研读成果
    // 清空一次（收藏当年漏进备份键表就是这类事故）。写死在测试里，防止以后又被漏掉。
    localStorage.setItem("banbu-analysis-cache-v2", JSON.stringify({ version: 2, entries: { "doc::node": { ts: 123, mover: "black", depth: 14, nodes: 900, winRate: 0.62 } } }));
    localStorage.setItem("banbu-game-review-v2", JSON.stringify({ doc: { ts: 456, totalMoves: 9, samples: [], entries: [{ nodeId: "n1", moveNumber: 1, mover: "black", played: { row: 7, col: 7 }, best: null, lossForMover: 0, grade: "best" }] } }));
    const serialized = serializeBackup(await createBackupSnapshot("test"));
    localStorage.removeItem("banbu-analysis-cache-v2");
    localStorage.removeItem("banbu-game-review-v2");
    await restoreBackup(parseBackup(serialized));
    expect(JSON.parse(localStorage.getItem("banbu-analysis-cache-v2") || "{}").entries["doc::node"].depth).toBe(14);
    expect(JSON.parse(localStorage.getItem("banbu-game-review-v2") || "{}").doc.entries[0].grade).toBe("best");
  });

  it("收藏、快捷中心自定义、在线代理、更新偏好随备份往返（2026-09-19 补齐的键）", async () => {
    // 这五个键以前不在备份里：换机/重装后收藏清空、快捷中心恢复默认、代理地址丢失。
    localStorage.setItem("banbu-library-favorites-v1", JSON.stringify({ records: ["r1"], puzzleCollections: ["c1"], puzzles: { c1: ["p1"] } }));
    localStorage.setItem("banbu-quick-drawer-v1", JSON.stringify({ hidden: ["analysis"], order: { tools: ["a", "b"] } }));
    localStorage.setItem("banbu-online-proxy-v1", "https://proxy.example/?url={url}");
    localStorage.setItem("banbu-update-auto-check-v1", "false");
    localStorage.setItem("banbu-update-prompt-dismissed-v1", "1.2.3");
    const serialized = serializeBackup(await createBackupSnapshot("test"));
    for (const key of ["banbu-library-favorites-v1", "banbu-quick-drawer-v1", "banbu-online-proxy-v1", "banbu-update-auto-check-v1", "banbu-update-prompt-dismissed-v1"]) localStorage.removeItem(key);
    await restoreBackup(parseBackup(serialized));
    expect(JSON.parse(localStorage.getItem("banbu-library-favorites-v1") || "{}")).toEqual({ records: ["r1"], puzzleCollections: ["c1"], puzzles: { c1: ["p1"] } });
    expect(JSON.parse(localStorage.getItem("banbu-quick-drawer-v1") || "{}").hidden).toEqual(["analysis"]);
    expect(localStorage.getItem("banbu-online-proxy-v1")).toBe("https://proxy.example/?url={url}");
    expect(JSON.parse(localStorage.getItem("banbu-update-auto-check-v1") || "true")).toBe(false);
    expect(localStorage.getItem("banbu-update-prompt-dismissed-v1")).toBe("1.2.3");
  });

  it("「自定义背景」的界面主题随备份往返（2026-10-12 补的键）", async () => {
    // 与"背景颜色 / 背景图"同一类：都是用户选的外观，换机不该丢。
    localStorage.setItem("banbu-custom-ui-theme-v1", "cyber");
    const serialized = serializeBackup(await createBackupSnapshot("test"));
    localStorage.removeItem("banbu-custom-ui-theme-v1");
    await restoreBackup(parseBackup(serialized));
    expect(localStorage.getItem("banbu-custom-ui-theme-v1")).toBe("cyber");
  });

  it("棋魂**买来的东西**随备份往返（2026-10-11 补的四个键）", async () => {
    /**
     * ⚠ 这条守的是一类很隐蔽的数据丢失：备份里原来**只有账本**（钱），
     * 没有"买到了什么"。恢复之后余额还在（流水里有），但买过的外观与道具
     * 全部回到"没买" —— 用户看到的是"钱花了、东西没了"，而且怪不到备份头上。
     */
    localStorage.setItem("banbu-soul-unlocks-v1", JSON.stringify(["theme-bamboo", "board-app-jade"]));
    localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ hint: 3, undo: 1 }));
    localStorage.setItem("banbu-vcf-level-paid-v1", "11");
    localStorage.setItem("banbu-soul-tuning-v1", JSON.stringify({ earnMultiplier: 2 }));

    const serialized = serializeBackup(await createBackupSnapshot("test"));
    // 模拟换机：全部清掉再恢复
    for (const key of ["banbu-soul-unlocks-v1", "banbu-vcf-items-v1", "banbu-vcf-level-paid-v1", "banbu-soul-tuning-v1"]) localStorage.removeItem(key);
    await restoreBackup(parseBackup(serialized));

    expect(JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]")).toEqual(["theme-bamboo", "board-app-jade"]);
    expect(JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}")).toEqual({ hint: 3, undo: 1 });
    expect(localStorage.getItem("banbu-vcf-level-paid-v1")).toBe("11");
    expect(JSON.parse(localStorage.getItem("banbu-soul-tuning-v1") || "{}").earnMultiplier).toBe(2);
  });

  it("旧备份（没有那四个键）**不会把买来的东西清空**", async () => {
    /**
     * 反向的那一半，而且更要紧：一份 2026-10-11 之前导出的备份里没有这几个键。
     * 如果恢复时按"缺失即给空值"处理，用户拿旧备份恢复一次就等于**买过的东西全没了**
     * —— 那比不恢复还糟。所以这几个键的语义是"缺就跳过"，与上面那张表的
     * "缺就给默认"**刻意不同**。这条断言把这个区别钉住。
     *
     * ⚠ 构造方式：备份带 `contentHash`（防篡改），删完字段必须**重新算哈希**，
     * 否则 parseBackup 会以"文件已损坏"拒绝 —— 那验的就不是这条语义了。
     * 重算用的是**生产代码同一个** `contentHash`，所以这就是一份合法的旧备份。
     */
    const snapshot = await createBackupSnapshot("test");
    const legacy = JSON.parse(serializeBackup(snapshot)) as {
      localStorage: Record<string, unknown>;
      indexedDb: unknown;
      contentHash?: string;
    };
    // 手工抹掉那四个键，模拟旧备份
    delete legacy.localStorage.soulUnlocks;
    delete legacy.localStorage.vcfItems;
    delete legacy.localStorage.vcfLevelPaid;
    delete legacy.localStorage.soulTuning;
    // 重算哈希（同一份生产实现），让它成为一份**合法**的旧备份
    legacy.contentHash = contentHash({ localStorage: legacy.localStorage, indexedDb: legacy.indexedDb });

    localStorage.setItem("banbu-soul-unlocks-v1", JSON.stringify(["theme-bamboo"]));
    localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ hint: 2 }));
    localStorage.setItem("banbu-vcf-level-paid-v1", "7");
    localStorage.setItem("banbu-soul-tuning-v1", JSON.stringify({ earnMultiplier: 3 }));

    await restoreBackup(parseBackup(JSON.stringify(legacy)));

    // 原样留着（没有被清空）
    expect(JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]")).toEqual(["theme-bamboo"]);
    expect(JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}")).toEqual({ hint: 2 });
    expect(localStorage.getItem("banbu-vcf-level-paid-v1")).toBe("7");
    expect(JSON.parse(localStorage.getItem("banbu-soul-tuning-v1") || "{}").earnMultiplier).toBe(3);
  });

  it("reads a native backup snapshot from the exported ZIP container", async () => {
    const document = createDocument("ZIP 备份");
    saveToLibrary(document);
    const snapshot = await createBackupSnapshot("test");
    const archive = await createZip([{ name: "banbu-backup.json", data: serializeBackup(snapshot) }, { name: "README.txt", data: "说明" }]);
    const entries = await readZip(archive);
    const backupEntry = entries.find((entry) => entry.name === "banbu-backup.json");
    expect(backupEntry).toBeDefined();
    expect((parseBackup(textFromZipEntry(backupEntry!)).localStorage.library as Array<{ id?: string }>).some((item) => item.id === document.id)).toBe(true);
  });

  it("uses replacement semantics on repeated restore", async () => {
    const first = createDocument("第一份");
    saveToLibrary(first);
    const snapshot = await createBackupSnapshot("test");
    const second = createDocument("第二份");
    saveToLibrary(second);
    await restoreBackup(snapshot);
    await restoreBackup(snapshot);
    expect(loadLibrary().map((item) => item.id)).toEqual([first.id]);
  });

  /**
   * **`scope: "state"` 只含状态，且恢复它不会碰棋谱**
   * （2026-10-11 修的一个会丢数据的 bug）。
   *
   * 上一版：凭证恢复走 `restoreBackup` —— 它是"整份替换"语义（先清空再写回），
   * 而 state 快照里棋谱库是空的 ⇒ **用户只想同步棋魂/成就，棋谱库却被清空了**。
   * 用户对凭证的原话是「一般就导出关于棋魂，成就，战绩等这些数值类的」——
   * 既然只导数值，恢复时就只能写数值。
   */
  describe("本机凭证：只含状态、恢复不碰棋谱", () => {
    it("state 快照不含棋谱（但含进度与数值）", async () => {
      const document = createDocument("不该进快照的棋谱");
      saveToLibrary(document);
      localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({ "c/p": { solved: true, attempts: 2 } }));
      localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "e1", at: 1, amount: 50, reason: "duel-win", detail: "赢" }]));
      const state = await createBackupSnapshot("test", "state");
      expect(state.scope).toBe("state");
      expect(state.localStorage.library).toEqual([]);
      expect(state.localStorage.recycleBin).toEqual([]);
      // 数值与进度在
      expect(state.localStorage.puzzleProgress).toEqual({ "c/p": { solved: true, attempts: 2 } });
      expect(state.localStorage.soulLedger).toHaveLength(1);
    });

    it("**恢复 state 快照不会删棋谱**（这条就是那个 bug 的回归守卫）", async () => {
      const keep = createDocument("必须留下来的棋谱");
      saveToLibrary(keep);
      const state = await createBackupSnapshot("test", "state");
      // 再往库上加一份（模拟"凭证导出之后，本机又多了一份棋谱"）
      const extra = createDocument("凭证导出后新加的棋谱");
      saveToLibrary(extra);
      expect(loadLibrary().length).toBe(2);

      await restoreBackupStateOnly(state);

      // 棋谱**一份都不能少**（整份替换语义会把它清成 0 份）。
      const ids = loadLibrary().map((item) => item.id);
      expect(ids).toContain(keep.id);
      expect(ids).toContain(extra.id);
    });

    it("state 快照里的数值**真的写进去了**（否则「恢复」是空转）", async () => {
      localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "e9", at: 2, amount: 888, reason: "achievement", detail: "凭证" }]));
      localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: 6400, solved: 200, failed: 20, solvedIds: [], seenIds: [], streak: 1, bestStreak: 5, daily: {}, history: [], settings: { pace: "default", genDeep: true } }));
      const state = await createBackupSnapshot("test", "state");

      // 本机数值被改掉，再用凭证恢复回来
      localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([]));
      localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: 1000 }));
      await restoreBackupStateOnly(state);

      expect(JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]")).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}").rating).toBe(6400);
    });
  });
});
