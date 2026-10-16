import { describe, expect, it } from "vitest";

import { applySniff, fileExtension, sniffIncomingBytes } from "./sniff";

/** 允许数字与字符串混写（字符串既可以是整段，也可以只有一两个字节），一律展开成字节。 */
type ByteSource = string | (number | string)[];
const bytes = (source: ByteSource) => {
  const out: number[] = [];
  const items: (number | string)[] = typeof source === "string" ? Array.from(source) : source;
  for (const item of items) {
    if (typeof item === "number") out.push(item);
    else for (const char of item) out.push(char.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(out);
};

const head = (source: ByteSource) => sniffIncomingBytes(bytes(source));

describe("外部文件按内容识别（用户 2026-10-03）", () => {
  it("认出棋盘截图：系统给的 mimeType 不可信时也能分流到识谱", () => {
    expect(head([0x89, "PNG", "\r\n", 0x1a, "\n"])).toMatchObject({ mimeType: "image/png", image: true });
    expect(head([0xff, 0xd8, 0xff, 0xe0, 0])).toMatchObject({ kind: "jpeg", image: true });
    expect(head(["GIF8", "9a", 0])).toMatchObject({ kind: "gif", image: true });
    expect(head(["RIFF", "\x00\x00\x00\x00", "WEBP", "VP"])).toMatchObject({ kind: "webp", image: true });
    // 手机相册默认存 HEIC，安卓侧 getType() 经常直接给 null。
    expect(head(["\x00\x00\x00\x18", "ftyp", "heic", "\x00"])).toMatchObject({ kind: "heic", image: true });
  });

  it("认出棋谱：SGF 看根节点括号，PSQ 看首行，压缩包看 PK 头", () => {
    expect(head("(;GM[5]FF[4]SZ[15]))")).toMatchObject({ kind: "sgf", image: false });
    expect(head(["\n\n  ", "(;GM[5]"])).toMatchObject({ kind: "sgf" });
    expect(head("Piskvorky 19x19,8,0\r\n")).toMatchObject({ kind: "psq" });
    expect(head(["PK", "\x03", "\x04"])).toMatchObject({ kind: "zip", mimeType: "application/zip" });
    expect(head('{"schema":"banbu-gomoku-export"')).toMatchObject({ kind: "json" });
  });

  it("认不出来就如实说没有，绝不猜一个格式", () => {
    expect(head("随便一段中文说明")).toBeNull();
    expect(head([])).toBeNull();
    // MP4 视频同样是 ftyp 容器，但不是照片，不许被当成图片送进识谱。
    expect(head(["\x00\x00\x00\x18", "ftyp", "mp42", "\x00"])).toBeNull();
  });

  it("微信那种没有后缀的文件名：补上嗅出来的后缀，好让既有白名单放行", () => {
    const source = bytes("(;GM[5]SZ[15]))");
    const fixed = applySniff(new File([source], "sgffile", { type: "application/octet-stream" }), head("(;GM[5]SZ[15]))"));
    expect(fixed.name).toBe("sgffile.sgf");
    expect(fixed.type).toBe("application/x-go-sgf");
    const photo = applySniff(new File([source], "9527", { type: "application/octet-stream" }), head([0x89, "PNG", "\r\n", 0x1a, "\n"]));
    expect(photo.name).toBe("9527.png");
    expect(photo.type).toBe("image/png");
    expect(fileExtension("sgffile")).toBe("");
    expect(fileExtension("棋谱.SGF")).toBe("sgf");
    // `.hidden` 开头的点是名字不是后缀。
    expect(fileExtension(".hidden")).toBe("");
  });

  it("已有后缀时尊重用户给的名字，但被叫成 .txt 的照片仍会改回 image/*", () => {
    const png = bytes([0x89, "PNG", "\r\n", 0x1a, "\n"]);
    const sniffed = head([0x89, "PNG", "\r\n", 0x1a, "\n"])!;
    const kept = applySniff(new File([png], "截图.png", { type: "image/png" }), sniffed);
    expect(kept.name).toBe("截图.png");
    expect(kept.type).toBe("image/png");
    const mislabeled = applySniff(new File([png], "棋盘截图.txt", { type: "text/plain" }), sniffed);
    expect(mislabeled.name).toBe("棋盘截图.txt");
    expect(mislabeled.type).toBe("image/png");
  });

  it("类型可信且名字完整时原样返回（不给已验证的管线添变量）", () => {
    const original = new File([bytes("(;GM[5]")], "对局.sgf", { type: "application/x-go-sgf" });
    expect(applySniff(original, head("(;GM[5]"))).toBe(original);
    expect(applySniff(original, null)).toBe(original);
  });
});
