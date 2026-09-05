/** Small ZIP reader/writer used for portable application backups.
 *
 * Backups are written with the ZIP "store" method so they work offline and
 * do not need a third-party runtime. The reader also accepts normal deflated
 * ZIP entries through the browser's DecompressionStream implementation.
 */

export interface ZipEntryInput { name: string; data: string | Uint8Array | Blob }
export interface ZipEntry { name: string; data: Uint8Array }

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const u16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const u32 = (view: DataView, offset: number) => view.getUint32(offset, true);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const bytesOf = async (value: string | Uint8Array | Blob) => value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : typeof value === "string" ? encoder.encode(value) : value;
const safeName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((part) => part && part !== "." && part !== "..").join("/");

const concat = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

export const createZip = async (entries: ZipEntryInput[]) => {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = safeName(entry.name);
    if (!name) continue;
    const nameBytes = encoder.encode(name);
    const data = await bytesOf(entry.data);
    const checksum = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true); header.set(nameBytes, 30);
    local.push(header, data);
    const directory = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(directory.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true); centralView.setUint16(10, 0, true); centralView.setUint16(12, 0, true); centralView.setUint16(14, 0, true);
    centralView.setUint32(16, checksum, true); centralView.setUint32(20, data.length, true); centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true); centralView.setUint16(30, 0, true); centralView.setUint16(32, 0, true); centralView.setUint16(34, 0, true); centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true); centralView.setUint32(42, offset, true); directory.set(nameBytes, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, central.length, true); endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralBytes.length, true); endView.setUint32(16, offset, true);
  return concat([...local, centralBytes, end]);
};

const inflateRaw = async (bytes: Uint8Array) => {
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持 ZIP 压缩条目，请使用本应用导出的 ZIP");
  // Copy into a standalone ArrayBuffer: newer TypeScript DOM typings reject
  // Uint8Array<ArrayBufferLike> (which may be backed by SharedArrayBuffer) as
  // a BlobPart even though browsers accept it at runtime.
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const readZip = async (source: Blob | Uint8Array): Promise<ZipEntry[]> => {
  const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(0, bytes.length - 0x10016);
  let end = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) if (u32(view, index) === 0x06054b50) { end = index; break; }
  if (end < 0) throw new Error("ZIP 文件缺少结束目录，可能已损坏");
  const count = u16(view, end + 10), directoryOffset = u32(view, end + 16);
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || u32(view, cursor) !== 0x02014b50) throw new Error("ZIP 中央目录无效");
    const flags = u16(view, cursor + 8), method = u16(view, cursor + 10), expectedCrc = u32(view, cursor + 16), compressedSize = u32(view, cursor + 20), uncompressedSize = u32(view, cursor + 24), nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), commentLength = u16(view, cursor + 32), localOffset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!safeName(name) || name.endsWith("/")) continue;
    if (flags & 1) throw new Error("ZIP 加密条目不受支持");
    if (localOffset + 30 > bytes.length || u32(view, localOffset) !== 0x04034b50) throw new Error("ZIP 本地条目无效");
    const localNameLength = u16(view, localOffset + 26), localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart < 0 || dataStart + compressedSize > bytes.length) throw new Error("ZIP 条目数据不完整");
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? new Uint8Array(compressed) : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error(`ZIP 压缩方式 ${method} 不受支持`); })();
    if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) throw new Error(`ZIP 条目“${name}”校验失败，文件可能已损坏`);
    entries.push({ name: safeName(name), data });
  }
  return entries;
};

export const textFromZipEntry = (entry: ZipEntry) => decoder.decode(entry.data);
