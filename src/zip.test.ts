import { describe, expect, it } from "vitest";
import { createZip, readZip, textFromZipEntry } from "./zip";

describe("portable ZIP container", () => {
  it("round-trips text, binary and unicode names", async () => {
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    const zip = await createZip([
      { name: "banbu-backup.json", data: '{"ok":true}' },
      { name: "题库/入门.json", data: "[]" },
      { name: "棋谱.bin", data: bytes },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["banbu-backup.json", "题库/入门.json", "棋谱.bin"]);
    expect(textFromZipEntry(entries[0])).toBe('{"ok":true}');
    expect(Array.from(entries[2].data)).toEqual(Array.from(bytes));
  });

  it("cleans traversal paths and rejects malformed archives", async () => {
    const zip = await createZip([{ name: "../../safe.txt", data: "ok" }, { name: "/nested/./file.txt", data: "yes" }]);
    const entries = await readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["safe.txt", "nested/file.txt"]);
    await expect(readZip(new Uint8Array([1, 2, 3]))).rejects.toThrow("结束目录");
  });
});
