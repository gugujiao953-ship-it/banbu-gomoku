// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:preview");
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("image preview cache", () => {
  it("retries the same image after a failed decoder attempt", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockRejectedValueOnce(new Error("decoder temporarily unavailable"))
      .mockResolvedValue({ width: 100, height: 100, close });
    vi.stubGlobal("createImageBitmap", decode);
    const { getImagePreview } = await import("./image-preview");
    const file = new File(["image"], "board.png", { type: "image/png" });
    await expect(getImagePreview(file)).rejects.toThrow("temporarily unavailable");
    expect(await getImagePreview(file)).toMatchObject({ downscaled: false, url: "blob:preview" });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("evicts a rejected in-flight image without creating an unhandled rejection", async () => {
    let rejectFirst!: (error: Error) => void;
    const decode = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue({ width: 100, height: 100, close: vi.fn() });
    vi.stubGlobal("createImageBitmap", decode);
    const { getImagePreview } = await import("./image-preview");
    const first = getImagePreview(new File(["one"], "one.png"));
    const rejected = expect(first).rejects.toThrow("decode failed");
    await getImagePreview(new File(["two"], "two.png"));
    await getImagePreview(new File(["three"], "three.png"));
    rejectFirst(new Error("decode failed"));
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
