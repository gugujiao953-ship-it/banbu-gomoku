import { describe, expect, it, vi } from "vitest";
import { createRenLibWebWorker } from "./renlib-web-worker";

describe("RenLib webpage worker deployment boundary", () => {
  it("accepts only an explicitly deployed root or http(s) worker asset", () => {
    const factory = vi.fn(class { terminate = vi.fn(); });
    vi.stubGlobal("Worker", factory);
    const created = createRenLibWebWorker({ workerUrl: "/renlib/RenjuLib_worker.js", wasmUrl: "/renlib/RenLib.wasm" });
    expect(created).toBeInstanceOf(factory);
    expect(factory).toHaveBeenCalledWith("/renlib/RenjuLib_worker.js", { type: "classic" });
    vi.unstubAllGlobals();
  });

  it("rejects ambiguous relative worker paths", () => {
    expect(() => createRenLibWebWorker({ workerUrl: "./RenjuLib_worker.js", wasmUrl: "./RenLib.wasm" })).toThrow("绝对 http(s) 或站点根路径");
  });
});
