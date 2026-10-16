/**
 * 外部文件的「按内容」识别（用户 2026-10-03：从别的应用点/分享过来的东西，
 * 是棋谱就自动导入、是图片就自动进识谱，而不是靠文件名猜）。
 *
 * 为什么必须嗅内容而不是看 mimeType / 扩展名：
 *   · 安卓 `ContentResolver.getType()` 对微信 / QQ / 文件管理器给的东西经常是
 *     `application/octet-stream` 甚至 null（原生侧 null 时回落成 octet-stream）。
 *     于是既可能把一张棋盘截图当成"文档"送进棋谱导入器，也可能反过来。
 *   · 另一头，扩展名也不可靠：不少应用分享时会把名字改成没有后缀的样子
 *     （`sgffile`、`9527`），而 `App.tsx` 的导入白名单第一句就是按后缀拦，
 *     拦下来报「不支持 .未知 文件」——其实文件本身是完好的 SGF。
 *
 * 所以这里只认字节：魔术头能定档就定档，定不了就返回 null 让原有的按后缀逻辑继续走，
 * **绝不**为了"看起来智能"去猜一个格式出来。
 */

export type SniffedKind =
  | "png" | "jpeg" | "gif" | "bmp" | "webp" | "heic"
  | "sgf" | "psq" | "json" | "zip";

export interface SniffResult {
  kind: SniffedKind;
  /** 交给下游的 MIME。图片这一路 `intakeExternalFiles` 就是靠 `image/` 前缀分流到识谱的。 */
  mimeType: string;
  /**
   * 补全用的后缀（不含点）。只有原文件名压根没有后缀时才会被用上——
   * 有后缀时一律尊重用户给的名字，免得把 `.txt` 里的一份 SGF 改叫 `x.sgf.txt`。
   */
  extension: string;
  /** 图片：true 时走识谱，false 时走棋谱导入。 */
  image: boolean;
}

const TEXT_WINDOW = 512;

const startsWith = (bytes: Uint8Array, at: number, signature: number[]) => {
  if (bytes.length < at + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[at + index] !== signature[index]) return false;
  }
  return true;
};

const ascii = (bytes: Uint8Array, start: number, end: number) => {
  let text = "";
  for (let index = start; index < Math.min(end, bytes.length); index += 1) text += String.fromCharCode(bytes[index]);
  return text;
};

/** 跳过 BOM 与前导空白后的第一个可读字节位置（SGF / JSON 都可能是「空格开头」的文件）。 */
const firstMeaningfulByte = (bytes: Uint8Array) => {
  let index = 0;
  if (startsWith(bytes, 0, [0xef, 0xbb, 0xbf])) index = 3;
  for (; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value !== 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d && value !== 0x00) break;
  }
  return index;
};

const IMAGE_KINDS = new Map<string, SniffResult>([
  ["png", { kind: "png", mimeType: "image/png", extension: "png", image: true }],
  ["jpeg", { kind: "jpeg", mimeType: "image/jpeg", extension: "jpg", image: true }],
  ["gif", { kind: "gif", mimeType: "image/gif", extension: "gif", image: true }],
  ["bmp", { kind: "bmp", mimeType: "image/bmp", extension: "bmp", image: true }],
  ["webp", { kind: "webp", mimeType: "image/webp", extension: "webp", image: true }],
  ["heic", { kind: "heic", mimeType: "image/heic", extension: "heic", image: true }],
]);

const DOCUMENT_KINDS = new Map<string, SniffResult>([
  ["sgf", { kind: "sgf", mimeType: "application/x-go-sgf", extension: "sgf", image: false }],
  ["psq", { kind: "psq", mimeType: "text/plain", extension: "psq", image: false }],
  ["json", { kind: "json", mimeType: "application/json", extension: "json", image: false }],
  ["zip", { kind: "zip", mimeType: "application/zip", extension: "zip", image: false }],
]);

/**
 * 只吃文件头 512 字节（够判 PSQ 的第一行了；SGF/JSON 只看第一个有效字符）。
 * 判定不出来返回 null——调用方应保持原样，别把未知内容硬套一个格式。
 */
export const sniffIncomingBytes = (head: Uint8Array): SniffResult | null => {
  if (head.length === 0) return null;

  if (startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47])) return IMAGE_KINDS.get("png")!;
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return IMAGE_KINDS.get("jpeg")!;
  if (startsWith(head, 0, [0x47, 0x49, 0x46, 0x38])) return IMAGE_KINDS.get("gif")!;
  if (startsWith(head, 0, [0x42, 0x4d])) return IMAGE_KINDS.get("bmp")!;
  if (startsWith(head, 0, [0x52, 0x49, 0x46, 0x46]) && ascii(head, 8, 12) === "WEBP") return IMAGE_KINDS.get("webp")!;
  // HEIC/HEIF 是 MP4 容器：4-8 字节固定 "ftyp"，品牌决定是不是苹果那套照片格式。
  // 手机相册默认存 HEIC，安卓侧 `getType()` 有时直接给 null，不认这一条就会把照片送进棋谱管线。
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "mif1" || brand === "msf1") {
      return IMAGE_KINDS.get("heic")!;
    }
  }

  // zip 系（本应用的批量导出包）：本地文件头 PK\3\4，空包/分卷也认。
  if (startsWith(head, 0, [0x50, 0x4b]) && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return DOCUMENT_KINDS.get("zip")!;
  }

  const at = firstMeaningfulByte(head);
  const first = head[at];
  if (first === undefined) return null;
  const window = ascii(head, at, at + TEXT_WINDOW);

  // SGF 的根节点一定以 '(' 开头（`\n(;GM[5]…` 这类缩进式写法照样算）。
  if (first === 0x28) return DOCUMENT_KINDS.get("sgf")!;
  if (first === 0x7b || first === 0x5b) return DOCUMENT_KINDS.get("json")!;
  // 李一 / Piskvork 的 .psq：第一行 `Piskvorky 19x19,8,0` —— 它也是纯文本，
  // 不先摘出来的话会掉进 POS 读法里得到一个空棋谱（老问题，见 formats.ts 的 importPsq）。
  if (/^piskvorky\s+\d+\s*x\s*\d+\s*,/i.test(window)) return DOCUMENT_KINDS.get("psq")!;
  return null;
};

/** 文件对象版：只读前 512 字节，不整份进内存（256MB 的 LIB 也要能秒判）。 */
export const sniffIncomingFile = async (file: File): Promise<SniffResult | null> => {
  try {
    const buffer = await file.slice(0, TEXT_WINDOW).arrayBuffer();
    return sniffIncomingBytes(new Uint8Array(buffer));
  } catch {
    return null;
  }
};

/** 文件名有没有带后缀（不含点的那个部分；开头的点不算，`.gitignore` 那种是名字不是后缀）。 */
export const fileExtension = (name: string) => {
  const base = name.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
};

/**
 * 把嗅探结果落到 File 上，两条规则：
 *   · MIME 缺失、或只是兜底的 `application/octet-stream` 时用嗅出来的；嗅出是图片而当前
 *     类型不是图片时也覆盖——因为「是不是图片」这件事下游只看 `type` 前缀（`image/`），
 *     一张被叫成 `截图.txt` 的照片不覆盖就会被送进棋谱管线并报解析失败。
 *   · 原名一个后缀都没有时补上嗅出来的后缀：`App.tsx` 的导入白名单与 `sourceFormatOf`
 *     都是按后缀判的，不补就会被挡成「不支持 .未知 文件」。已有后缀的一律尊重原名。
 */
export const applySniff = (file: File, sniffed: SniffResult | null): File => {
  if (!sniffed) return file;
  const declared = (file.type || "").toLowerCase();
  const untrustworthy = declared === "" || declared === "application/octet-stream";
  const mislabeledImage = sniffed.image && !declared.startsWith("image/");
  const mimeType = untrustworthy || mislabeledImage ? sniffed.mimeType : declared;
  const name = fileExtension(file.name) ? file.name : `${file.name}.${sniffed.extension}`;
  if (name === file.name && mimeType === declared) return file;
  try {
    return new File([file], name, { type: mimeType });
  } catch {
    return file;
  }
};
