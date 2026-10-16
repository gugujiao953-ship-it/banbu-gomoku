import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestTimeout } from "./request-timeout";

afterEach(() => vi.useRealTimers());

describe("request timeout", () => {
  it("rejects an unresponsive native request and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = withRequestTimeout((value) => { signal = value; return new Promise(() => undefined); }, 100, "request expired");
    const rejected = expect(pending).rejects.toThrow("request expired");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after success or failure", async () => {
    vi.useFakeTimers();
    expect(await withRequestTimeout(async () => 42, 100, "expired")).toBe(42);
    await expect(withRequestTimeout(async () => { throw new Error("network failed"); }, 100, "expired")).rejects.toThrow("network failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
