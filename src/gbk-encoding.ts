/**
 * GBK (the two-byte portion of GB18030) text encoding for RenLib LIB export.
 *
 * Browsers can decode gb18030 but cannot encode it, so the inverse mapping is
 * built once at runtime from the native decoder. Only the single-byte ASCII
 * range and the GBK two-byte range used by RenLib are covered; characters
 * outside it (private use areas, four-byte GB18030 extensions) are replaced
 * with "?".
 */
let unicodeToGbk: Map<number, number> | null = null;
let gbkDecoder: TextDecoder | null = null;

const buildMap = (): Map<number, number> => {
  const decoder = new TextDecoder("gb18030");
  const map = new Map<number, number>();
  for (let byte = 0; byte <= 0x7f; byte += 1) map.set(byte, byte);
  const pair = new Uint8Array(2);
  for (let hi = 0x81; hi <= 0xfe; hi += 1) {
    for (let lo = 0x40; lo <= 0xfe; lo += 1) {
      if (lo === 0x7f) continue;
      pair[0] = hi; pair[1] = lo;
      const decoded = decoder.decode(pair);
      if (decoded.length !== 1) continue;
      const codePoint = decoded.codePointAt(0);
      if (codePoint === undefined || codePoint === 0xfffd) continue;
      // GBK is injective outside ASCII; keep the first (canonical) mapping.
      if (!map.has(codePoint)) map.set(codePoint, (hi << 8) | lo);
    }
  }
  gbkDecoder = decoder;
  return map;
};

/** Encode a Unicode string as GBK bytes (ASCII fast path, no table build). */
export const encodeGbkString = (text: string): Uint8Array<ArrayBuffer> => {
  let needsTable = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) { needsTable = true; break; }
  }
  if (!needsTable) {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  }
  const map = unicodeToGbk ?? (unicodeToGbk = buildMap());
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) { bytes.push(code); continue; }
    const gbk = map.get(code);
    if (gbk === undefined) { bytes.push(0x3f); continue; }
    bytes.push(gbk >> 8, gbk & 0xff);
  }
  return Uint8Array.from(bytes);
};