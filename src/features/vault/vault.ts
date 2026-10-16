/**
 * **本机凭证**：一份"导出即可带走、导入即可还原"的加密数据包。
 *
 * 用户 2026-10-11 定下的形态（这一版按它重写）：
 * 「把凭证做成一个入口吧，就是，想啥时候生成凭证就啥时候生成凭证，还可以给凭证命名，
 *  理论上我们可以用别人的凭证去登入。然后这个有导入凭证和导出凭证，这个凭证一般就导出
 *  关于棋魂，成就，战绩等这些数值类的，但是也可以选择连同备份一起导出，就是导出后，
 *  即使换机，也可以全部导入，和之前一模一样」
 *
 * 所以这一版与上一版的**根本区别**：
 *
 * | | 上一版 | 这一版 |
 * |---|---|---|
 * | 时机 | 每次切后台自动写 | **用户想什么时候生成就什么时候生成** |
 * | 份数 | 只有一份（固定 id） | **可以有多份**，各有名字 |
 * | 名字 | 无 | **可命名**（"我的主力号""给孩子用的"） |
 * | 用途 | 只能恢复自己 | **可以拿别人的凭证导入**（换号/共享） |
 * | 内容 | 只状态 | 默认只状态，**可选连棋谱一起** |
 *
 * ## 三条不可动摇的口径
 *
 * ① **凭证是"导出的文件"，不是"一直在后台同步的东西"**。
 *    所以没有定时器、没有 visibilitychange 钩子 —— 上一版那套（`vault-auto.ts`）
 *    这一版**删掉了**。少一个后台写入点，就少一类"用户没让我写却在写盘"的问题。
 *
 * ② **只状态 / 连棋谱，两种范围各有各的恢复语义**（这是最容易出错的地方）：
 *    · `scope: "state"`（默认，数值类）→ 恢复走 `restoreBackupStateOnly`：
 *      **叠加**，有就写、没有就留着本机的，**绝不删东西**；
 *    · `scope: "full"`（连棋谱）→ 恢复走 `restoreBackup`：**整份替换**，
 *      这才是"和之前一模一样"。
 *    ⚠ 上一版把两种都走"整份替换"，于是**只同步数值会把棋谱库清空** ——
 *    这是本次修掉的一个会丢数据的 bug（回归守卫在 `backup.test.ts`）。
 *
 * ③ **恢复码是唯一钥匙**。它不进凭证文件（只存前 4 位的提示），
 *    所以"别人的凭证"必须先拿到他的码才能导入 —— 这也正好是"登入"的语义。
 */

import {
  createBackupSnapshot, parseBackup, restoreBackup, restoreBackupStateOnly,
  type BackupSnapshot, type BackupScope,
} from "../../backup";
import { downloadText } from "../../formats";
import {
  DEFAULT_NATIVE_EXPORT_FOLDER, defaultNativeExportHandle, isDownloadsDirectoryHandle,
  isNativeDirectoryHandle, isSafDirectoryHandle, loadDefaultDirectoryHandle,
  supportsNativeExportDirectory, writeTextFileToDirectory, type ExportDirectoryHandle,
} from "../../file-destination";
import {
  VaultCryptoError, canEncrypt, createKdf, decryptText, deriveVaultKey, encryptText,
  type VaultCipher, type VaultKdf,
} from "./vault-crypto";
import { codeHint, generateRecoveryCode, isWellFormedCode, normalizeCode, type CodeSource } from "./vault-code";

// ─────────────────────────────────────────────────────────────────────
// 凭证文件（导出出去的那个东西）
// ─────────────────────────────────────────────────────────────────────

/** 凭证文件的信封（明文部分）。只有 `cipher.ct` 是密文。 */
export interface VaultFile {
  kind: "banbu-vault";
  v: 1;
  /** 凭证 id（形如 `7K2M-9QX4`）：文件名的一部分，也是"这是哪一份"的标识。 */
  vaultId: string;
  /** 用户给这份凭证起的名字（"我的主力号"）。**明文**，好让选文件时能认出来。 */
  name: string;
  kdf: VaultKdf;
  cipher: VaultCipher;
  /** 导出时刻（ISO，明文 —— 选文件时不必解密就能看到新旧）。 */
  exportedAt: string;
  appVersion: string;
  /** 含不含棋谱。**恢复时据此选语义**（见文件头第 ② 条）。 */
  scope: BackupScope;
  /** 恢复码前 4 位的提示（不足以还原出码）。 */
  codeHint: string;
}

// ─────────────────────────────────────────────────────────────────────
// 本机登记表（记着"我导出过哪几份"，不是"数据存在哪"）
// ─────────────────────────────────────────────────────────────────────

/**
 * 本机**登记表**：列出"这台机子导出过哪些凭证"。
 *
 * ⚠ 它的作用与上一版的"档案"**完全不同**：上一版靠它自动续写，
 * 这一版只用它**显示一份列表**（名字 / 时间 / 范围 / 恢复码），
 * 让用户随时能"再看一眼我的码"、"再导出一份"。
 *
 * 所以它**不参与数据恢复**：恢复完全靠"导入时选的那个文件 + 输入的码"。
 * 这也意味着**丢掉登记表不影响任何数据**（凭证文件本身才是资产）。
 */
export const VAULT_REGISTRY_KEY = "banbu-vault-registry-v1";

export interface VaultEntry {
  vaultId: string;
  /** 用户起的名字。 */
  name: string;
  /** 恢复码（规范化形式）。存本机是为了"随时能再看一眼" —— 见文件头第 ③ 条。 */
  code: string;
  codeSource: CodeSource;
  createdAt: string;
  /** 最近一次导出成功的时间。 */
  lastExportedAt: string | null;
  /** 最近一次导出用的范围。 */
  lastScope: BackupScope | null;
}

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

/** 读登记表。**逐条校验**：坏条目丢掉，不整份作废（照项目里其它存档的写法）。 */
export const loadVaultRegistry = (): VaultEntry[] => {
  const storage = safeStorage();
  if (!storage) return [];
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(VAULT_REGISTRY_KEY) || "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: VaultEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const vaultId = typeof value.vaultId === "string" ? value.vaultId : "";
    const code = typeof value.code === "string" ? normalizeCode(value.code) : "";
    // 缺 id 或缺码的条目没有意义（既认不出是哪份、也开不了）—— 丢掉。
    if (!vaultId || !code) continue;
    out.push({
      vaultId,
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : vaultId,
      code,
      codeSource: value.codeSource === "weak" ? "weak" : "crypto",
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      lastExportedAt: typeof value.lastExportedAt === "string" ? value.lastExportedAt : null,
      lastScope: value.lastScope === "full" ? "full" : value.lastScope === "state" ? "state" : null,
    });
  }
  return out;
};

export const saveVaultRegistry = (entries: readonly VaultEntry[]): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(VAULT_REGISTRY_KEY, JSON.stringify(entries)); return true; } catch { return false; }
};

/** 加一条 / 覆盖同 id 的一条。返回新的登记表。 */
export const upsertVaultEntry = (entry: VaultEntry): VaultEntry[] => {
  const current = loadVaultRegistry().filter((item) => item.vaultId !== entry.vaultId);
  const next = [entry, ...current];
  saveVaultRegistry(next);
  return next;
};

/** 从登记表里删一条（**只删登记，不删已导出的文件**）。 */
export const removeVaultEntry = (vaultId: string): VaultEntry[] => {
  const next = loadVaultRegistry().filter((item) => item.vaultId !== vaultId);
  saveVaultRegistry(next);
  return next;
};

/** 改名字（同名 id 覆盖）。 */
export const renameVaultEntry = (vaultId: string, name: string): VaultEntry[] => {
  const next = loadVaultRegistry().map((item) => (item.vaultId === vaultId ? { ...item, name: name.trim() || item.vaultId } : item));
  saveVaultRegistry(next);
  return next;
};

// ─────────────────────────────────────────────────────────────────────
// 生成 / 导出
// ─────────────────────────────────────────────────────────────────────

/** 从恢复码生成凭证 id（给人看、也进文件名）。 */
export const vaultIdFromCode = (normalized: string): string =>
  `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;

/**
 * 文件名：`<名字>-<id>.json`。
 *
 * ⚠ **名字要进文件名**，但不能让它决定文件能不能写出去：用户可能起
 * "我的主号 2026/10 测试"这种带斜杠和空格的名字。所以这里做一次**安全化**
 * （去掉路径分隔符与控制字符、限长），名字里的中文保留 ——
 * 安卓的 MediaStore 与各主流文件系统都支持。
 */
export const vaultFilename = (entry: Pick<VaultEntry, "vaultId" | "name">): string => {
  const safe = entry.name
    // 先 trim：否则"全是空格"的名字会在替换后留下一个孤零零的连字符（实测踩到）。
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")   // 路径分隔符与 Windows 非法字符
    .replace(/\s+/g, "-")                        // 空格换连字符（老文件系统更稳）
    .replace(/^-+|-+$/g, "")                     // 去掉首尾残留的连字符
    .slice(0, 40);
  return `${safe || "凭证"}-${entry.vaultId}.json`;
};

/** 凭证存放的子目录。 */
export const VAULT_FOLDER = `${DEFAULT_NATIVE_EXPORT_FOLDER}/凭证`;

/**
 * 导出到哪。
 *
 * 三级判定（顺序要紧）：
 *  ① **安卓端**：走 `defaultNativeExportHandle()`（下载夹 → 文档，它自己会挑）；
 *  ② **网页版 + 用户选过文件夹**（File System Access）：授权持久化，能直接写；
 *  ③ **网页版 + 没选过**：**退化成浏览器下载**。
 *
 * ⚠ ③ 与上一版不同（上一版是"明确报错"）：那时凭证是**自动写**的，
 * 每次切后台触发一次下载会把下载夹堆满；而现在是**用户主动点"导出"**，
 * 一次点击换一次下载**完全正确**（这正是网页版导出该有的样子）。
 */
export interface VaultExportTarget {
  /** 有句柄就直接写；没有就触发下载。 */
  handle: ExportDirectoryHandle | null;
}

export const resolveExportTarget = async (): Promise<VaultExportTarget> => {
  if (supportsNativeExportDirectory()) return { handle: await defaultNativeExportHandle() };
  const saved = await loadDefaultDirectoryHandle();
  return { handle: saved ?? null };
};

export interface VaultExportResult {
  ok: boolean;
  /** 写到哪了（给人看）。 */
  location?: string;
  exportedAt?: string;
  error?: string;
}

/**
 * 生成并导出一次凭证。
 *
 * `entry` 由调用方先建好（名字 + 码），`scope` 决定含不含棋谱。
 * 成功后把 `lastExportedAt` / `lastScope` 记进登记表。
 */
export const exportVault = async (input: {
  entry: VaultEntry;
  appVersion: string;
  scope: BackupScope;
  target?: VaultExportTarget;
}): Promise<VaultExportResult> => {
  if (!canEncrypt()) return { ok: false, error: "这台设备或这个地址不支持加密凭证（需要 HTTPS 或应用内环境）。" };
  try {
    const snapshot = await createBackupSnapshot(input.appVersion, input.scope);
    // ⚠ KDF 每次导出都**新生成 salt**：只导出一次、解一次，没有"复用密钥省时间"的诉求；
    // 每次新 salt 意味着"同一份数据两次导出的密文毫不相关"（多一层，零成本）。
    const kdf = createKdf();
    const key = await deriveVaultKey(input.entry.code, base64ToBytes(kdf.salt), kdf.iterations);
    const cipher = await encryptText(key, JSON.stringify(snapshot));
    const exportedAt = new Date().toISOString();
    const file: VaultFile = {
      kind: "banbu-vault", v: 1,
      vaultId: input.entry.vaultId,
      name: input.entry.name,
      kdf, cipher, exportedAt,
      appVersion: input.appVersion,
      scope: input.scope,
      codeHint: codeHint(input.entry.code),
    };
    const text = JSON.stringify(file, null, 2);
    const filename = vaultFilename(input.entry);
    const target = input.target ?? await resolveExportTarget();
    if (target.handle) {
      await writeTextFileToDirectory(target.handle, filename, text, "application/json");
      const location = isDownloadsDirectoryHandle(target.handle)
        ? `下载 / ${VAULT_FOLDER}`
        : isSafDirectoryHandle(target.handle) ? (target.handle.location || target.handle.name)
          : isNativeDirectoryHandle(target.handle) ? `文档 / ${target.handle.path}` : target.handle.name;
      return { ok: true, location, exportedAt };
    }
    // 网页版且没选过文件夹：直接下载（用户点一次、下一次，正是要的）。
    downloadText(text, filename, "application/json");
    return { ok: true, location: "浏览器的下载位置", exportedAt };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** `kdf.salt` 是 base64，派生前要还原成字节。 */
const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

// ─────────────────────────────────────────────────────────────────────
// 导入 / 恢复
// ─────────────────────────────────────────────────────────────────────

/**
 * 解析凭证文件（只解出**信封**，不碰密文）。
 *
 * 密文要等用户输码才解得开，所以这一步能在"刚选完文件、还没输码"时
 * 就把**名字 / 导出时间 / 含不含棋谱**显示出来 ——
 * 让用户先确认"选对了文件"（"理论上我们可以用别人的凭证去登入"，
 * 那么"选错人"就是必须先确认的事）。
 */
export const parseVaultFile = (text: string): VaultFile => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new VaultCryptoError("malformed", "这个文件不是有效的 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VaultCryptoError("malformed", "这个文件不是一份本机凭证");
  const file = value as Record<string, unknown>;
  if (file.kind !== "banbu-vault") throw new VaultCryptoError("malformed", "这个文件不是本机凭证（缺少凭证标记）");
  if (Number(file.v) > 1) throw new VaultCryptoError("malformed", "这份凭证由更新的应用版本创建，请先升级应用");
  const kdf = file.kdf as VaultKdf | undefined;
  const cipher = file.cipher as VaultCipher | undefined;
  if (!kdf || !cipher || typeof kdf.salt !== "string" || typeof cipher.iv !== "string" || typeof cipher.ct !== "string") {
    throw new VaultCryptoError("malformed", "凭证内容不完整，文件可能已损坏");
  }
  const vaultId = typeof file.vaultId === "string" ? file.vaultId : "未知";
  return {
    kind: "banbu-vault", v: 1, vaultId,
    // 老文件（上一版导出的）没有 `name`，回落到 id 而不是空串 —— 列表里总得有个称谓。
    name: typeof file.name === "string" && file.name.trim() ? file.name.trim() : vaultId,
    kdf, cipher,
    exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
    appVersion: typeof file.appVersion === "string" ? file.appVersion : "unknown",
    scope: file.scope === "state" ? "state" : "full",
    codeHint: typeof file.codeHint === "string" ? file.codeHint : "",
  };
};

export interface VaultImportResult {
  ok: boolean;
  snapshot?: BackupSnapshot;
  scope?: BackupScope;
  name?: string;
  exportedAt?: string;
  vaultId?: string;
  failure?: string;
  error?: string;
}

/**
 * 用恢复码解开一份凭证（**不落盘、不改任何数据**）。
 *
 * 分成"先解开看看"与"真的恢复"两步是刻意的：恢复是破坏性操作，
 * 必须先让用户看到"这是谁的凭证、含什么、什么时候导出的"，再决定要不要用。
 */
export const readVault = async (file: VaultFile, code: string): Promise<VaultImportResult> => {
  const normalized = normalizeCode(code);
  if (!isWellFormedCode(normalized)) {
    /**
     * ⚠ 这里归到 **`bad-code`** 而不是 `malformed`。
     *
     * 第一版归成 `malformed`，于是 UI 按那个类别给出的话是
     * "这个文件不像一份本机凭证" —— **把用户引向文件**，
     * 而他真正的问题只是码抄漏了几位。这属于"错误归因错了"，
     * 比不给提示更糟（他会去翻文件、来回折腾）。
     * 判据很简单：**这个分支的成因只有一个 —— 码不对/不全**，那就是 bad-code。
     */
    return { ok: false, failure: "bad-code", error: "恢复码不完整：应该是 16 位（连字符可以不管）。" };
  }
  try {
    const plain = await decryptText(normalized, file.kdf, file.cipher);
    const snapshot = parseBackup(plain);
    // The envelope is plaintext; only metadata inside the authenticated
    // ciphertext may decide whether restoring will replace local records.
    const scope = snapshot.scope === "state" || snapshot.scope === "full" ? snapshot.scope : file.scope;
    return {
      ok: true, snapshot, scope,
      name: file.name, exportedAt: file.exportedAt, vaultId: file.vaultId,
    };
  } catch (error) {
    if (error instanceof VaultCryptoError) return { ok: false, failure: error.failure, error: error.message };
    return { ok: false, failure: "corrupt", error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * 把一份凭证**真正恢复**进本机（破坏性）。
 *
 * ⚠ 两条语义**必须按 `scope` 分开**（见文件头第 ② 条）：
 *  · `state` → `restoreBackupStateOnly`（叠加，不删棋谱）；
 *  · `full`  → `restoreBackup`（整份替换，"和之前一模一样"）。
 *
 * 分错的后果是**数据丢失**：把 state 当 full 恢复会清空棋谱库；
 * 把 full 当 state 恢复会"看起来恢复了、其实旧的棋谱还混在里面"。
 * 所以这里不接受调用方传 `scope` —— 它只信**凭证文件里**写的那个值，
 * 而那个值是导出时定的、跟内容是一致的。
 */
export const applyVaultSnapshot = async (input: { snapshot: BackupSnapshot; scope: BackupScope }): Promise<void> => {
  if (input.scope === "full") {
    await restoreBackup(input.snapshot);
    return;
  }
  await restoreBackupStateOnly(input.snapshot);
};

/**
 * 建一份新凭证（**还没导出**）：生成码、起好名字、记进登记表。
 *
 * 返回的 `entry` 直接喂给 `exportVault` 即可导出。
 * 名字留空时用 id 兜底（不强制命名，但给了名字会在文件列表里更好认）。
 */
export const createVaultEntry = (name: string): VaultEntry => {
  const generated = generateRecoveryCode();
  const vaultId = vaultIdFromCode(generated.normalized);
  const entry: VaultEntry = {
    vaultId,
    name: name.trim() || vaultId,
    code: generated.normalized,
    codeSource: generated.source,
    createdAt: new Date().toISOString(),
    lastExportedAt: null,
    lastScope: null,
  };
  upsertVaultEntry(entry);
  return entry;
};

/** 记一次导出成功（把时间与范围写回登记表）。 */
export const markVaultExported = (vaultId: string, scope: BackupScope, at: string): VaultEntry[] => {
  const next = loadVaultRegistry().map((item) => (item.vaultId === vaultId ? { ...item, lastExportedAt: at, lastScope: scope } : item));
  saveVaultRegistry(next);
  return next;
};

/**
 * 导入之后把这份凭证也记进登记表（"这份现在也在我的列表里了"）。
 *
 * ⚠ 用途是**方便再导出/再看码**，不是"自动续写"——
 * 这一版没有自动写盘，所以登记与否不影响数据安全。
 * 若导入的是**别人的**凭证（"用别人的凭证去登入"），登记之后
 * 他就随时能从列表里再导出一份给对方，或再看一眼那个码。
 */
export const registerImportedVault = (file: VaultFile, code: string): VaultEntry[] => {
  const existing = loadVaultRegistry().find((item) => item.vaultId === file.vaultId);
  const entry: VaultEntry = {
    vaultId: file.vaultId,
    name: existing?.name ?? file.name,
    code: normalizeCode(code),
    codeSource: existing?.codeSource ?? "crypto",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastExportedAt: existing?.lastExportedAt ?? file.exportedAt ?? null,
    lastScope: file.scope,
  };
  return upsertVaultEntry(entry);
};

export { canEncrypt } from "./vault-crypto";
export { codeHint as codeHintOf, formatCode as formatCodeOf, isWellFormedCode, normalizeCode } from "./vault-code";
