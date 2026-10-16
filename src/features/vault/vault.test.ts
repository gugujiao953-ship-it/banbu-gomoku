/**
 * 本机凭证的**生命周期**单测（2026-10-11 第六轮重写）。
 *
 * 加解密本身在 `vault-crypto.test.ts` 里测；这里测围绕它的**容易悄悄错**的事：
 *  ① 登记表（多份、命名、改名、移除）的读写与坏值回落；
 *  ② **恢复码是唯一钥匙**：文件里只留前四位提示，不藏码；
 *  ③ **两种范围各有各的恢复语义**（只数值=叠加不删棋谱；含棋谱=整份替换）——
 *     这一条是本次修的**会丢数据的 bug** 的守卫；
 *  ④ 文件名带名字与 id（一个文件夹里能放多份）；
 *  ⑤ `scope: "state"` 真的不含棋谱、但含数值。
 */

// `createBackupSnapshot` 会读 IndexedDB（大型棋谱那几个 store），照 `backup.test.ts` 的先例装内存实现。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupSnapshot, restoreBackupStateOnly } from "../../backup";
import { createKdf, deriveVaultKey, encryptText } from "./vault-crypto";
import { createDocument } from "../../game";
import { loadLibrary, saveToLibrary } from "../../storage";
import {
  VAULT_REGISTRY_KEY, createVaultEntry, loadVaultRegistry, markVaultExported, parseVaultFile,
  registerImportedVault, removeVaultEntry, renameVaultEntry, vaultFilename, vaultIdFromCode,
  readVault,
} from "./vault";

/** 内存版 Storage（照项目里其它测试的写法）。 */
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

beforeEach(() => { vi.stubGlobal("localStorage", new MemoryStorage()); });

describe("encrypted snapshot metadata", () => {
  it("uses the encrypted scope if someone changes the plaintext envelope scope", async () => {
    const snapshot = await createBackupSnapshot("test", "state");
    const code = "7K2M9QX4H3VPNB6T";
    const kdf = { ...createKdf(), iterations: 1000 };
    const salt = Uint8Array.from(atob(kdf.salt), (char) => char.charCodeAt(0));
    const key = await deriveVaultKey(code, salt, kdf.iterations);
    const cipher = await encryptText(key, JSON.stringify(snapshot));
    const file = parseVaultFile(JSON.stringify({ kind: "banbu-vault", v: 1, scope: "full", kdf, cipher }));
    expect((await readVault(file, code)).scope).toBe("state");
  });

  it("rejects decrypted JSON that is not a valid backup", async () => {
    const code = "7K2M9QX4H3VPNB6T";
    const kdf = { ...createKdf(), iterations: 1000 };
    const salt = Uint8Array.from(atob(kdf.salt), (char) => char.charCodeAt(0));
    const key = await deriveVaultKey(code, salt, kdf.iterations);
    const cipher = await encryptText(key, '{"hello":"world"}');
    const file = parseVaultFile(JSON.stringify({ kind: "banbu-vault", v: 1, scope: "state", kdf, cipher }));
    expect((await readVault(file, code)).ok).toBe(false);
  });
});

describe("登记表：多份凭证 + 命名", () => {
  it("初始为空", () => {
    expect(loadVaultRegistry()).toEqual([]);
  });

  it("建一份就进列表，名字与码都在（名字可留空 → 用 id 兜底）", () => {
    const named = createVaultEntry("我的主力号");
    expect(loadVaultRegistry()).toHaveLength(1);
    expect(loadVaultRegistry()[0].name).toBe("我的主力号");
    expect(loadVaultRegistry()[0].code).toHaveLength(16);
    expect(named.vaultId).toBe(vaultIdFromCode(named.code));

    const unnamed = createVaultEntry("");
    expect(loadVaultRegistry()).toHaveLength(2);
    expect(unnamed.name).toBe(unnamed.vaultId);   // 兜底不是空串
  });

  it("**可以有多份**（用户：「想啥时候生成凭证就啥时候生成凭证」）", () => {
    createVaultEntry("一号");
    createVaultEntry("二号");
    createVaultEntry("三号");
    expect(loadVaultRegistry().map((item) => item.name)).toEqual(["三号", "二号", "一号"]);
    // 每份的 id 与码都不同
    const ids = loadVaultRegistry().map((item) => item.vaultId);
    expect(new Set(ids).size).toBe(3);
  });

  it("改名", () => {
    const entry = createVaultEntry("旧名字");
    renameVaultEntry(entry.vaultId, "新名字");
    expect(loadVaultRegistry()[0].name).toBe("新名字");
    // 改成空白 → 回落成 id（不留空名字，列表里总得能认出）
    renameVaultEntry(entry.vaultId, "   ");
    expect(loadVaultRegistry()[0].name).toBe(entry.vaultId);
  });

  it("移除只删登记，不影响别的条目", () => {
    const a = createVaultEntry("A");
    createVaultEntry("B");
    removeVaultEntry(a.vaultId);
    expect(loadVaultRegistry().map((item) => item.name)).toEqual(["B"]);
  });

  it("导出后记下时间与范围（列表上要显示「上次导出」）", () => {
    const entry = createVaultEntry("我的");
    expect(loadVaultRegistry()[0].lastExportedAt).toBeNull();
    markVaultExported(entry.vaultId, "full", "2026-10-11T12:00:00.000Z");
    expect(loadVaultRegistry()[0].lastExportedAt).toBe("2026-10-11T12:00:00.000Z");
    expect(loadVaultRegistry()[0].lastScope).toBe("full");
  });

  it("坏存档不炸：坏 JSON / 不是数组 → 空列表", () => {
    localStorage.setItem(VAULT_REGISTRY_KEY, "不是 json");
    expect(loadVaultRegistry()).toEqual([]);
    localStorage.setItem(VAULT_REGISTRY_KEY, JSON.stringify({ vaultId: "x" }));
    expect(loadVaultRegistry()).toEqual([]);
  });

  it("坏条目被逐条丢掉（缺 id 或缺码的那条没有意义）", () => {
    localStorage.setItem(VAULT_REGISTRY_KEY, JSON.stringify([
      { vaultId: "A-B", code: "7K2M9QX4H3VPNB6T", name: "好的" },
      { vaultId: "", code: "7K2M9QX4H3VPNB6T" },          // 缺 id
      { vaultId: "C-D", code: "" },                        // 缺码
      "垃圾",
    ]));
    const loaded = loadVaultRegistry();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("好的");
  });

  it("小写/带连字符的码在登记表里被规范化", () => {
    localStorage.setItem(VAULT_REGISTRY_KEY, JSON.stringify([
      { vaultId: "A-B", code: "7k2m-9qx4-h3vp-nb6t", name: "x" },
    ]));
    expect(loadVaultRegistry()[0].code).toBe("7K2M9QX4H3VPNB6T");
  });
});

describe("文件名：带名字与 id", () => {
  it("形如 `<名字>-<id>.json`（一个文件夹里能放多份）", () => {
    expect(vaultFilename({ vaultId: "7K2M-9QX4", name: "我的主力号" })).toBe("我的主力号-7K2M-9QX4.json");
  });

  it("**危险字符被清掉**（名字是用户随手输的，不能让它决定文件能不能写出去）", () => {
    // 路径分隔符与 Windows 非法字符
    const name = vaultFilename({ vaultId: "AAAA-BBBB", name: "我的/主号:2026*test?" });
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
    expect(name).not.toContain("*");
    expect(name).not.toContain("?");
    expect(name).toContain("AAAA-BBBB");

    // 空格换连字符（老文件系统更稳）
    expect(vaultFilename({ vaultId: "X-Y", name: "a b c" })).toBe("a-b-c-X-Y.json");
    // 全是非法字符 → 回落成"凭证"，不留空文件名
    expect(vaultFilename({ vaultId: "X-Y", name: "///" })).toBe("凭证-X-Y.json");
    // 空格转连字符后是合法文件名（不像斜杠那样被删光）
    expect(vaultFilename({ vaultId: "X-Y", name: "   " })).toBe("凭证-X-Y.json");
    // 超长被截断
    expect(vaultFilename({ vaultId: "X-Y", name: "名".repeat(80) }).length).toBeLessThan(60);
  });
});

describe("凭证文件：信封（不含码）", () => {
  const envelope = {
    kind: "banbu-vault", v: 1, vaultId: "7K2M-9QX4", name: "我的主力号",
    kdf: { alg: "PBKDF2-SHA256", iterations: 250000, salt: "AAAA" },
    cipher: { alg: "AES-GCM-256", iv: "BBBB", ct: "CCCC" },
    exportedAt: "2026-10-11T00:00:00.000Z", appVersion: "1.1.9.27",
    scope: "state", codeHint: "7K2M····",
  };

  it("能读出名字/时间/范围（**不解密**就能显示，用于「选对文件了吗」）", () => {
    const file = parseVaultFile(JSON.stringify(envelope));
    expect(file.name).toBe("我的主力号");
    expect(file.scope).toBe("state");
    expect(file.exportedAt).toBe("2026-10-11T00:00:00.000Z");
  });

  it("**文件里没有恢复码**（只有前四位提示 —— 这是加密凭证该有的样子）", () => {
    const text = JSON.stringify(envelope);
    expect(text).not.toContain("7K2M9QX4H3VPNB6T");
    expect(parseVaultFile(text).codeHint).toBe("7K2M····");
  });

  it("不是凭证文件时明确拒绝", () => {
    expect(() => parseVaultFile(JSON.stringify({ hello: 1 }))).toThrow(/不是本机凭证/);
    expect(() => parseVaultFile("不是 json")).toThrow(/不是有效的 JSON/);
  });

  it("更高版本明确说「请升级应用」（而不是含糊失败）", () => {
    expect(() => parseVaultFile(JSON.stringify({ ...envelope, v: 2 }))).toThrow(/更新的应用版本/);
  });

  it("老文件（上一版导出的）没有 `name` 时回落到 id（列表里总得有个称谓）", () => {
    const { name: _missing, ...older } = envelope;
    expect(parseVaultFile(JSON.stringify(older)).name).toBe("7K2M-9QX4");
  });

  it("缺密文/缺 kdf 判为损坏", () => {
    expect(() => parseVaultFile(JSON.stringify({ ...envelope, cipher: undefined }))).toThrow(/不完整/);
    expect(() => parseVaultFile(JSON.stringify({ ...envelope, kdf: undefined }))).toThrow(/不完整/);
  });
});

describe("导入之后的登记（这份也在我的列表里了）", () => {
  const file = parseVaultFile(JSON.stringify({
    kind: "banbu-vault", v: 1, vaultId: "9WER-TYUI", name: "别人的凭证",
    kdf: { alg: "PBKDF2-SHA256", iterations: 250000, salt: "AAAA" },
    cipher: { alg: "AES-GCM-256", iv: "BBBB", ct: "CCCC" },
    exportedAt: "2026-10-01T00:00:00.000Z", appVersion: "1.1.9.27",
    scope: "full", codeHint: "9WER····",
  }));

  it("导入别人的凭证之后登记进来（之后能再导出/再看码）", () => {
    registerImportedVault(file, "9WERTYUIOPASDFGH");
    const list = loadVaultRegistry();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("别人的凭证");
    expect(list[0].code).toBe("9WERTYUIOPASDFGH");
    // 恢复码是导入时输入的，不是从文件里读的（文件里没有）。
    expect(list[0].lastScope).toBe("full");
  });

  it("重复导入同一份：不产生第二条（按 vaultId 归一）", () => {
    registerImportedVault(file, "9WERTYUIOPASDFGH");
    registerImportedVault(file, "9WERTYUIOPASDFGH");
    expect(loadVaultRegistry()).toHaveLength(1);
  });

  it("已经有本机那条时，导入不覆盖用户起的名字", () => {
    registerImportedVault(file, "9WERTYUIOPASDFGH");
    renameVaultEntry(file.vaultId, "我给他起的名字");
    registerImportedVault(file, "9WERTYUIOPASDFGH");
    expect(loadVaultRegistry()[0].name).toBe("我给他起的名字");
  });
});

/**
 * **两种范围的恢复语义**（本次修的那个"会丢棋谱"的 bug 的守卫）。
 *
 * 用户原话：「这个凭证一般就导出关于棋魂，成就，战绩等这些数值类的，
 * 但是也可以选择连同备份一起导出」—— 两种范围**必须分开对待**：
 *  · 只数值 → 叠加，不碰棋谱；
 *  · 含棋谱 → 整份替换，"和之前一模一样"。
 */
describe("两种范围：只数值不碰棋谱；含棋谱才整份替换", () => {
  it("state 快照不含棋谱、但含数值与进度", async () => {
    saveToLibrary(createDocument("不该进快照的棋谱"));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({ "c/p": { solved: true, attempts: 2 } }));
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "e1", at: 1, amount: 50, reason: "duel-win", detail: "赢" }]));
    const state = await createBackupSnapshot("test", "state");
    expect(state.scope).toBe("state");
    expect(state.localStorage.library).toEqual([]);
    expect(state.localStorage.puzzleProgress).toEqual({ "c/p": { solved: true, attempts: 2 } });
    expect(state.localStorage.soulLedger).toHaveLength(1);
  });

  it("**导入只数值的凭证不会删棋谱**（回归守卫）", async () => {
    const keep = createDocument("必须留下来的棋谱");
    saveToLibrary(keep);
    const state = await createBackupSnapshot("test", "state");
    const extra = createDocument("凭证导出之后新加的棋谱");
    saveToLibrary(extra);
    expect(loadLibrary().length).toBe(2);

    await restoreBackupStateOnly(state);

    const ids = loadLibrary().map((item) => item.id);
    expect(ids).toContain(keep.id);
    expect(ids).toContain(extra.id);
  });

  it("数值**真的写进去了**（否则「导入」是空转）", async () => {
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "e9", at: 2, amount: 888, reason: "achievement", detail: "凭证" }]));
    localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: 6400, solved: 200, failed: 20, solvedIds: [], seenIds: [], streak: 1, bestStreak: 5, daily: {}, history: [], settings: { pace: "default", genDeep: true } }));
    const state = await createBackupSnapshot("test", "state");

    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([]));
    localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: 1000 }));
    await restoreBackupStateOnly(state);

    expect(JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}").rating).toBe(6400);
  });
});

/**
 * 错误**归因**（2026-10-11 门禁抓到的一个 UX bug）。
 *
 * 第一版把「码抄漏了几位」归成 `malformed`，于是 UI 按类别给出的话是
 * 「这个文件不像一份本机凭证」—— **把用户引向文件**，
 * 而他真正的问题只是码不全。这种"错误归因错了"比不给提示更糟：
 * 他会去翻文件、来回折腾一圈。
 */
describe("错误归因：短码要说码，不要怪文件", () => {
  // ⚠ 密文必须是**像样的长度**：`ct` 太短会先撞上"内容不完整"那条检查，
  // 于是归因成 malformed —— 那样就测不到"码不对"这条路径了（我第一版就踩了）。
  const file = parseVaultFile(JSON.stringify({
    kind: "banbu-vault", v: 1, vaultId: "7K2M-9QX4", name: "t",
    kdf: { alg: "PBKDF2-SHA256", iterations: 1000, salt: "AAAAAAAAAAAAAAAAAAAAAA==" },
    cipher: { alg: "AES-GCM-256", iv: "AAAAAAAAAAAAAAAA", ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    exportedAt: "2026-10-11T00:00:00.000Z", appVersion: "1", scope: "state", codeHint: "7K2M····",
  }));

  it("码不完整 → 报 bad-code，且提示里说清「16 位」（不指向文件）", async () => {
    const { readVault } = await import("./vault");
    const short = await readVault(file, "AAAA-BBBB");
    expect(short.ok).toBe(false);
    expect(short.failure).toBe("bad-code");
    expect(short.error).toContain("16 位");
    // 关键：**不能**说成"文件不像凭证"（那会把用户引去查文件）。
    expect(short.error).not.toContain("不像");
  });

  it("16 位但码错的 → 也报 bad-code（与短码同类，都是「码不对」）", async () => {
    const { readVault } = await import("./vault");
    const wrong = await readVault(file, "AAAA-BBBB-CCCC-DDDD");
    expect(wrong.ok).toBe(false);
    expect(wrong.failure).toBe("bad-code");
  });
});
