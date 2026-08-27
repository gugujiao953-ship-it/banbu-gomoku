/// <reference lib="webworker" />

/**
 * Deployment boundary for the source-compatible webpage worker.
 *
 * The webpage worker must be served as a classic worker together with its
 * sibling scripts and RenLib.wasm. It is intentionally not instantiated from
 * the Vite module graph until those asset URLs are supplied by the deployment
 * adapter.
 */
export type RenLibWebWorkerAssets = {
  workerUrl: string;
  wasmUrl: string;
};

export const createRenLibWebWorker = (assets: RenLibWebWorkerAssets) => {
  if (!/^https?:\/\//i.test(assets.workerUrl) && !assets.workerUrl.startsWith("/")) {
    throw new Error("RenLib 网页 worker URL 必须是绝对 http(s) 或站点根路径");
  }
  return new Worker(assets.workerUrl, { type: "classic" });
};
