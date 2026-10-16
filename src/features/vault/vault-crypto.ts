/**
 * 本机凭证的**加解密**：PBKDF2-SHA256 派生密钥 + AES-GCM-256 加密。
 *
 * 全部是**纯函数**（不碰存储、不读全局状态），所以能直接单测 ——
 * 加解密这种东西单测覆盖得住，就不该等到真机上试。
 *
 * ## 为什么需要加密（而不只是"打包一下"）
 *
 * 凭证文件放在**公共下载目录**里，也就是任何文件管理器、任何云盘同步、
 * 任何拿到手机的人都能打开看。两个真实收益：
 *
 *  ① **内容不外泄**：棋谱、棋谱库、复盘标注、成就进度都是用户的东西，
 *     不该因为"放了个备份"就变成人人可读的明文；
 *  ② **改不动**：AES-GCM 自带认证标签（tag），密文被改**一个字节**就解不开。
 *     这一条顺手堵掉了上一轮发现的那个口子 ——「手改备份 JSON 里的
 *     `soulUnlocks` 就能白拿全部付费外观」。凭证走加密之后，
 *     改密文得到的只是"解不开"，拿不到任何东西。
 *
 * ⚠ **诚实的局限**（也要写进 UI 与手册）：恢复码存在本机以便自动续写，
 * 所以它防的是"文件外流"，**不是"设备被拿走"**。手机在别人手上、
 * 又能解锁进本应用的人，本来就能直接看到全部数据。
 *
 * ## 迭代次数
 *
 * 25 万次是 OWASP 对 PBKDF2-SHA256 的现行建议量级。它让"拿文件离线穷举"
 * 变得不划算 —— 而 16 位 × 31 字符表的恢复码本身已有约 79 bit 熵，
 * 两者叠加之后穷举在物理上不可能。
 *
 * 代价是**派生一次要几百毫秒到一两秒**（真机上）——所以：
 *  · 只在"生成凭证"和"解锁凭证"时派生一次；
 *  · **自动续写绝不能重新派生**（那会在每次切后台时卡一下、还费电），
 *    派生出来的 `CryptoKey` 缓存在内存里复用，见 `vault.ts`。
 */

/** KDF / 加密算法的标识（写进凭证文件，将来换算法时据此判断）。 */
export const KDF_ALGORITHM = "PBKDF2-SHA256";
export const CIPHER_ALGORITHM = "AES-GCM-256";
/** 迭代次数：OWASP 建议量级。改它要同时考虑老凭证的解密（见 `iterations` 字段）。 */
export const PBKDF2_ITERATIONS = 250_000;

/** 导出到文件里的密钥派生参数与密文。 */
export interface VaultKdf {
  alg: typeof KDF_ALGORITHM;
  iterations: number;
  /** base64（无换行）。 */
  salt: string;
}

export interface VaultCipher {
  alg: typeof CIPHER_ALGORITHM;
  /** base64，12 字节（AES-GCM 的标准 IV 长度）。 */
  iv: string;
  /** base64 密文（含 GCM tag）。 */
  ct: string;
}

const hasSubtle = (): boolean => {
  try {
    return typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof crypto.subtle.importKey === "function";
  } catch { return false; }
};

/**
 * 这个环境能不能加解密。
 *
 * 生产路径上**必须是 true**：Capacitor 的安卓端默认跑在 `https://localhost`
 * （安全上下文），网页端在 https 或 localhost 下也是。项目里已经有两处
 * 生产代码在用 `crypto.subtle.digest`（校验引擎包 / APK），所以这条链路是验证过的。
 *
 * 返回 false 的情况：极老的 WebView、或者网页版被部署在**纯 http** 的地址上。
 * 那时 UI 要如实说"这台设备/这个地址不支持加密凭证"，
 * 而不是悄悄退化成明文 —— 退化成明文会让用户以为自己是加密存的。
 */
export const canEncrypt = (): boolean => hasSubtle();

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** 字节 → base64（分块拼接，避免大数组时 `String.fromCharCode(...arr)` 爆栈）。 */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** 解密失败的几种原因 —— 调用方要据此给**不同的话**（不然用户只会觉得软件坏了）。 */
export type VaultCryptoFailure =
  /** 恢复码不对（最常见）。 */
  | "bad-code"
  /** 文件被改过 / 损坏（GCM tag 校验失败）。 */
  | "corrupt"
  /** 环境不支持加密。 */
  | "unsupported"
  /** 凭证格式不对（缺字段、算法不认识）。 */
  | "malformed";

export class VaultCryptoError extends Error {
  readonly failure: VaultCryptoFailure;
  constructor(failure: VaultCryptoFailure, message: string) {
    super(message);
    this.name = "VaultCryptoError";
    this.failure = failure;
  }
}

/**
 * 从恢复码派生 AES-GCM 密钥。
 *
 * `iterations` 由调用方传（从凭证文件里读），这样将来提高迭代次数时
 * **老凭证仍能解开** —— 如果不传（新生成时），就用当前默认值。
 */
export const deriveVaultKey = async (
  normalizedCode: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> => {
  if (!hasSubtle()) throw new VaultCryptoError("unsupported", "这台设备或这个地址不支持加密凭证（需要 HTTPS 或应用内环境）");
  const base = await crypto.subtle.importKey("raw", textEncoder.encode(normalizedCode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,                       // 不可导出：派生出的密钥不允许被读出来（减少被内存抓取的面）
    ["encrypt", "decrypt"],
  );
};

/** 新建一份 KDF 参数（随机 salt）。 */
export const createKdf = (): VaultKdf => {
  if (!hasSubtle()) throw new VaultCryptoError("unsupported", "这台设备或这个地址不支持加密凭证（需要 HTTPS 或应用内环境）");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { alg: KDF_ALGORITHM, iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) };
};

/** 加密一段文本。`key` 由调用方缓存复用（见文件头那段"自动续写不重新派生"）。 */
export const encryptText = async (key: CryptoKey, plaintext: string): Promise<VaultCipher> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, textEncoder.encode(plaintext));
  return { alg: CIPHER_ALGORITHM, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
};

/**
 * 解密。失败的三种原因分开报（`bad-code` / `corrupt` / `malformed`）。
 *
 * ⚠ 为什么能区分"码不对"和"文件坏了"：
 * 凭证文件是 JSON，**明文部分是明文的**（kind/v/kdf/iv 都在外面），
 * 只有内容（`ct`）是密文。所以"解不开"只可能是这两件事之一：
 *  · key 不对（码错）—— GCM tag 对不上；
 *  · 密文被改过（文件坏）—— 同样是 tag 对不上。
 * **两者在密码学上无法区分**（这正是 GCM 的设计：不泄露"哪一步错了"）。
 * 所以这里的做法是**按 JSON 结构是否完整**来分：结构坏 → `malformed`；
 * 结构好但解不开 → `bad-code`（因为码错远比密文损坏常见，
 * 报"码不对"对用户更有用）。文件真被改过时用户会重试几次码、
 * 然后去看文件是否被改 —— 这条路径是可接受的。
 */
export const decryptText = async (
  normalizedCode: string,
  kdf: VaultKdf,
  cipher: VaultCipher,
): Promise<string> => {
  if (!hasSubtle()) throw new VaultCryptoError("unsupported", "这台设备或这个地址不支持加密凭证（需要 HTTPS 或应用内环境）");
  if (kdf?.alg !== KDF_ALGORITHM || cipher?.alg !== CIPHER_ALGORITHM) {
    throw new VaultCryptoError("malformed", `凭证用的算法本版本认不出来（${String(kdf?.alg)} / ${String(cipher?.alg)}），请升级应用后重试`);
  }
  if (!Number.isFinite(kdf.iterations) || kdf.iterations < 1000 || kdf.iterations > 10_000_000) {
    throw new VaultCryptoError("malformed", "凭证里的迭代次数不合理，文件可能已损坏");
  }
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    salt = base64ToBytes(kdf.salt);
    iv = base64ToBytes(cipher.iv);
    ct = base64ToBytes(cipher.ct);
  } catch {
    throw new VaultCryptoError("malformed", "凭证内容不是有效的 base64，文件可能已损坏");
  }
  if (salt.length === 0 || iv.length === 0 || ct.length < 16) {
    throw new VaultCryptoError("malformed", "凭证内容不完整，文件可能已损坏");
  }
  const key = await deriveVaultKey(normalizedCode, salt, kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
    return textDecoder.decode(plain);
  } catch {
    // 见上面那段注释：GCM 不区分"码错"与"密文被改"，这里按常识归因到码错。
    throw new VaultCryptoError("bad-code", "恢复码不对（或者凭证文件被改过）。请核对恢复码，注意区分大小写以外的字符是否抄漏");
  }
};

/** 给 UI 用的一句话（把 `failure` 翻成人话）。 */
export const describeVaultFailure = (failure: VaultCryptoFailure): string => {
  switch (failure) {
    case "bad-code": return "恢复码不对。请仔细核对那 16 位（连字符不用管，大小写也不影响）。";
    case "corrupt": return "凭证文件已损坏。";
    case "unsupported": return "这台设备或这个地址不支持加密凭证（需要 HTTPS 或应用内环境）。";
    case "malformed": return "这个文件不像一份本机凭证，或者它的版本比当前应用更新。";
  }
};
