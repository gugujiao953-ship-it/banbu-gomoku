/**
 * 本机凭证的加解密单测（2026-10-11）。
 *
 * 覆盖四件**必须是对的**的事：
 *  ① 自己加密的自己能解开（往返）；
 *  ② **错码必须被拒绝**（否则凭证就是明文）；
 *  ③ **密文被改必须被拒绝**（GCM 认证标签）—— 这正是用来堵"手改备份白拿付费外观"的那一层；
 *  ④ 恢复码的规范化容错（用户抄成小写、漏连字符、带空格都得认）。
 */

import { describe, expect, it } from "vitest";
import {
  CIPHER_ALGORITHM, KDF_ALGORITHM, PBKDF2_ITERATIONS, VaultCryptoError,
  canEncrypt, createKdf, decryptText, deriveVaultKey, encryptText, describeVaultFailure,
} from "./vault-crypto";
import {
  CODE_ALPHABET, CODE_LENGTH, codeHint, codeShortfall, formatCode, generateRecoveryCode,
  isWellFormedCode, normalizeCode,
} from "./vault-code";

// 这些用例要真跑 PBKDF2（25 万轮），比普通单测慢，给足时间。
const ITERATIONS = 1000;   // 单测用低迭代：验证的是"逻辑对不对"，不是"够不够强"

const encode = (value: string) => new TextEncoder().encode(value);

describe("恢复码", () => {
  it("生成的码：长度对、字符全在表里、显示形式带分隔符", () => {
    const code = generateRecoveryCode();
    expect(code.normalized).toHaveLength(CODE_LENGTH);
    expect(code.display).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}-[^-]{4}$/);
    // 去掉连字符后与规范化形式一致（格式化没丢字符）。
    expect(code.display.replace(/-/g, "")).toBe(code.normalized);
    for (const char of code.normalized) expect(CODE_ALPHABET).toContain(char);
  });

  it("**不含易混字符** `0 O 1 I L`（这是手抄不出错的关键）", () => {
    for (const char of "0O1IL") expect(CODE_ALPHABET).not.toContain(char);
    // 多生成几次也不该漏进来（生成逻辑只从表里取）。
    for (let index = 0; index < 50; index += 1) {
      const code = generateRecoveryCode();
      expect(/[0O1IL]/.test(code.normalized)).toBe(false);
    }
  });

  it("两次生成不一样（不是常量）", () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateRecoveryCode().normalized));
    expect(seen.size).toBeGreaterThan(15);
  });

  it("规范化：小写 / 空格 / 漏连字符 / 多余标点都能还原", () => {
    const canonical = "7K2M9QX4H3VPNB6T";
    expect(normalizeCode("7k2m-9qx4-h3vp-nb6t")).toBe(canonical);
    expect(normalizeCode("7K2M 9QX4 H3VP NB6T")).toBe(canonical);
    expect(normalizeCode("  7K2M9QX4H3VPNB6T  ")).toBe(canonical);
    expect(normalizeCode("恢复码：7K2M-9QX4-H3VP-NB6T")).toBe(canonical);
    expect(normalizeCode("7K2M/9QX4\nH3VP\tNB6T")).toBe(canonical);
  });

  it("`isWellFormedCode`：长度不足 / 含表外字符都判非法", () => {
    expect(isWellFormedCode("7K2M-9QX4-H3VP-NB6T")).toBe(true);
    expect(isWellFormedCode("7K2M-9QX4-H3VP")).toBe(false);          // 少一组
    // ⚠ 多带一段**不算非法**：粘贴时连说明文字一起复制是常见操作，
    // `normalizeCode` 会截断到 16 位（前 16 位有效就算合法）。这条断的是那个有意的行为。
    expect(isWellFormedCode("7K2M-9QX4-H3VP-NB6T-XXXX")).toBe(true);
    expect(isWellFormedCode("7K2M0QX4H3VPNB6T")).toBe(false);        // 含表外的 `0`
  });

  it("`codeShortfall` 告诉用户还差几位", () => {
    expect(codeShortfall("7K2M9QX4")).toBe(8);
    expect(codeShortfall("7K2M9QX4H3VPNB6T")).toBe(0);
    expect(codeShortfall("7K2M9QX4H3VPNB6TXXXX")).toBe(0);   // 超长不报负数
  });

  it("`formatCode` 四位一组；`codeHint` 只回显前四位（不足以还原）", () => {
    expect(formatCode("7K2M9QX4H3VPNB6T")).toBe("7K2M-9QX4-H3VP-NB6T");
    expect(codeHint("7K2M9QX4H3VPNB6T")).toBe("7K2M····");
    // 提示里不能出现够还原的位数。
    expect(codeHint("7K2M9QX4H3VPNB6T").replace(/·/g, "")).toHaveLength(4);
  });
});

describe("加解密", () => {
  it("这台环境支持加解密（Capacitor https://localhost 与 https 都在安全上下文里）", () => {
    expect(canEncrypt()).toBe(true);
  });

  it("往返：自己加密的自己能解开", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, JSON.stringify({ hello: "半步五子棋", n: 42 }));
    const plain = await decryptText("7K2M9QX4H3VPNB6T", { ...kdf, iterations: ITERATIONS }, cipher);
    expect(JSON.parse(plain)).toEqual({ hello: "半步五子棋", n: 42 });
  });

  it("**错码必须解不开**（否则凭证等于明文）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, "秘密内容");
    await expect(decryptText("8N3P9RX5H4VPNB6T", { ...kdf, iterations: ITERATIONS }, cipher))
      .rejects.toMatchObject({ failure: "bad-code" });
  });

  it("**密文被改一个字节就解不开**（GCM 认证标签，堵的就是手改存档白拿东西那条路）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, JSON.stringify({ soulUnlocks: [] }));
    // 手改：把密文里一个字节翻一下（模拟"用户改文件想给自己加东西"）。
    const bytes = base64Bytes(cipher.ct);
    bytes[10] ^= 0x01;
    const tampered = { ...cipher, ct: bytesToBase64(bytes) };
    await expect(decryptText("7K2M9QX4H3VPNB6T", { ...kdf, iterations: ITERATIONS }, tampered))
      .rejects.toBeInstanceOf(VaultCryptoError);
  });

  it("算法标识不认识时明确报 malformed（而不是含糊的「解不开」）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, "x");
    await expect(decryptText("7K2M9QX4H3VPNB6T", { ...kdf, iterations: ITERATIONS, alg: "ROT13" as never }, cipher))
      .rejects.toMatchObject({ failure: "malformed" });
    await expect(decryptText("7K2M9QX4H3VPNB6T", { ...kdf, iterations: ITERATIONS }, { ...cipher, alg: "DES" as never }))
      .rejects.toMatchObject({ failure: "malformed" });
  });

  it("迭代次数不合理时报 malformed（坏文件不会让派生跑成天文数字）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, "x");
    await expect(decryptText("x".repeat(16), { ...kdf, iterations: 0 }, cipher)).rejects.toMatchObject({ failure: "malformed" });
    await expect(decryptText("x".repeat(16), { ...kdf, iterations: 99_999_999 }, cipher)).rejects.toMatchObject({ failure: "malformed" });
  });

  it("base64 坏掉时报 malformed（不是崩溃）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const cipher = await encryptText(key, "x");
    await expect(decryptText("7K2M9QX4H3VPNB6T", { ...kdf, iterations: ITERATIONS, salt: "!!!不是base64" }, cipher))
      .rejects.toMatchObject({ failure: "malformed" });
  });

  it("同一明文两次加密产生不同密文（IV 每次都是新的）", async () => {
    const kdf = createKdf();
    const key = await deriveVaultKey("7K2M9QX4H3VPNB6T", base64Bytes(kdf.salt), ITERATIONS);
    const a = await encryptText(key, "相同的内容");
    const b = await encryptText(key, "相同的内容");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("默认迭代次数是 OWASP 建议量级（不是随手填的小数字）", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(200_000);
    expect(KDF_ALGORITHM).toBe("PBKDF2-SHA256");
    expect(CIPHER_ALGORITHM).toBe("AES-GCM-256");
  });

  it("失败原因都能翻成人话（UI 直接用）", () => {
    for (const failure of ["bad-code", "corrupt", "unsupported", "malformed"] as const) {
      const text = describeVaultFailure(failure);
      expect(text.length).toBeGreaterThan(4);
      expect(text).not.toContain("undefined");
    }
  });
});

/** 测试里用的 base64 解码（与 vault-crypto 内部同一套）。 */
function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
