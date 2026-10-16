/**
 * **恢复码**（本机凭证的钥匙）：生成、规范化、校验。
 *
 * 用户 2026-10-11：「我们确实得搞一个东西，让每一个机子都有本地凭证，
 * 即便是以后删除了软件，有了这个凭证，也能恢复到之前的状态什么的」。
 *
 * ## 为什么是"4 组 × 4 位"而不是一句长口令
 *
 * 恢复码要在**手机上被手抄到纸上或别处**，所以它必须：
 *  · 够短（抄得完、抄不错）—— 16 个字符；
 *  · 够强（猜不到）—— 31 个字符的表、16 位 ⇒ 约 **79 bit**。
 *    对"离线暴力破解一个本地文件"来说远超需要（PBKDF2 25 万次迭代下，
 *    猜 2^79 个候选在物理上不可能），所以强度不是靠长度堆的；
 *  · **不含易混字符**（下面 `CODE_ALPHABET` 剔掉了 `0 O 1 I L`）——
 *    手抄最容易错的就是这几个（0/O、1/I/l），剔掉之后"抄错"的概率大幅下降。
 *
 * ## 大小写与分隔符都容错
 *
 * 用户抄的时候会写小写、会漏掉连字符、会多打空格。所以 `normalizeCode()`
 * 统一处理这几件事，**校验前一律先规范化** —— 否则"码是对的但格式不同"
 * 会被判成错码，用户只会觉得"这软件坏了"。
 *
 * ## 随机源：能力检测 + 降级
 *
 * 照 `recent-imports.ts:59` 的既有写法做能力检测（本应用也跑在 http 与
 * Capacitor 本地域上，`crypto` 不一定在所有环境都在）。
 * ⚠ 但**降级路径会明显变弱**（`Math.random` 不是密码学随机），
 * 所以 `codeSourceLabel()` 会如实告诉调用方"这次是用什么生成的"——
 * 弱随机源下 UI 应该提示用户"换个环境重新生成"。
 */

/** 恢复码的字符表：剔除 `0 O 1 I L` 这几个手抄最容易混的。 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** 一组几位、共几组。 */
export const CODE_GROUP_LENGTH = 4;
export const CODE_GROUP_COUNT = 4;
/** 规范化之后的长度（恰好 16）。 */
export const CODE_LENGTH = CODE_GROUP_LENGTH * CODE_GROUP_COUNT;

/** 用什么生成的（用于如实告知强度）。 */
export type CodeSource = "crypto" | "weak";

const hasCryptoRandom = (): boolean => {
  try {
    return typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  } catch { return false; }
};

/** 取一个 [0, max) 的随机整数。有 `crypto.getRandomValues` 就用它。 */
const randomIndex = (max: number): { value: number; source: CodeSource } => {
  if (hasCryptoRandom()) {
    // 拒绝采样：直接 `% max` 会让靠前的字符略微偏多（31 不整除 256）。
    // 对 79 bit 的强度来说这点偏斜无害，但拒绝采样只多几行，没有理由不做对。
    const limit = Math.floor(256 / max) * max;
    const buffer = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buffer);
      if (buffer[0] < limit) return { value: buffer[0] % max, source: "crypto" };
    }
  }
  return { value: Math.floor(Math.random() * max), source: "weak" };
};

export interface GeneratedCode {
  /** 给人看的形式：`7K2M-9QX4-H3VP-BN6T` */
  display: string;
  /** 规范化形式（无分隔符、全大写）：`7K2M9QX4H3VPNB6T` */
  normalized: string;
  /** 这次用的随机源（`weak` = 环境没有 crypto，应提示用户换环境重生成）。 */
  source: CodeSource;
}

/**
 * 生成一个新的恢复码。
 *
 * 只要**其中任何一位**退化成 `weak`，整串就标成 `weak` —— 强度由最弱的那一位决定，
 * 报成 `crypto` 会是虚假的安全感（这正是这个字段存在的理由）。
 */
export const generateRecoveryCode = (): GeneratedCode => {
  let weak = false;
  const chars: string[] = [];
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const { value, source } = randomIndex(CODE_ALPHABET.length);
    if (source === "weak") weak = true;
    chars.push(CODE_ALPHABET[value]);
  }
  const normalized = chars.join("");
  return { display: formatCode(normalized), normalized, source: weak ? "weak" : "crypto" };
};

/**
 * 规范化用户输入的恢复码。
 *
 * 做三件事：**去掉所有非字母数字**（连字符 / 空格 / 换行 / 全角标点）、
 * **转大写**、截断到约定长度。
 *
 * ⚠ 刻意**不做"字形纠错"**（比如把用户写的 `O` 当成 `0`）。原因：
 * 本表里既没有 `0` 也没有 `O`，所以收到 `O` 时**无法知道**用户抄的是哪一位 ——
 * 猜错会把"码抄错了"变成"码对但解不开"，反而更难排查。
 * 真正降低手抄错误靠的是**生成时就不产生易混字符**（见 `CODE_ALPHABET`）：
 * 用户不会看到 `0/O/1/I/L`，也就不太可能把别的字符写成它们。
 *
 * 截断而不是报错：用户可能粘贴了带说明文字的一段（比如从备忘录里连标题一起复制）。
 * 截断之后长度不对自然会被 `isWellFormedCode` 拦下。
 */
export const normalizeCode = (input: string): string =>
  input.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, CODE_LENGTH);

/** 把规范化后的码排成给人看的分组形式。 */
export const formatCode = (normalized: string): string => {
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += CODE_GROUP_LENGTH) {
    chunks.push(normalized.slice(index, index + CODE_GROUP_LENGTH));
  }
  return chunks.join("-");
};

/**
 * 这串码**看起来**是否合法（长度对 + 字符都在表里）。
 *
 * ⚠ 它**不能**判断"码对不对"——那只有解密成功才算证明（见 vault-crypto）。
 * 它的用途是在用户还没点"恢复"之前先拦掉明显残缺的输入（少抄一组、抄错字符），
 * 给一句"还差几位"而不是让用户等一次必然失败的解密。
 */
export const isWellFormedCode = (input: string): boolean => {
  const normalized = normalizeCode(input);
  if (normalized.length !== CODE_LENGTH) return false;
  for (const char of normalized) {
    if (!CODE_ALPHABET.includes(char)) return false;
  }
  return true;
};

/** 还差多少位（给"少抄了一组"这类输入一句准确的话）。 */
export const codeShortfall = (input: string): number => {
  const missing = CODE_LENGTH - normalizeCode(input).length;
  return missing > 0 ? missing : 0;
};

/** 让"码是我生成的"这件事可核对：只回显前 4 位（用于"确认是这一份凭证"）。 */
export const codeHint = (normalized: string): string =>
  `${normalized.slice(0, CODE_GROUP_LENGTH)}····`;
