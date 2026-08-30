const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const root = new URL(baseURL);

const request = async (path) => {
  const response = await fetch(new URL(path, root));
  const body = await response.arrayBuffer();
  return {
    path,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    length: body.byteLength,
  };
};

const javascript = await request("renlib/RenjuLib_worker.js");
const wasm = await request("renlib/RenLib.wasm");
const missing = await request("renlib/__qa_missing_asset__.js");

if (javascript.status !== 200 || !javascript.contentType.includes("javascript") || javascript.length <= 0) {
  throw new Error(`RenLib worker dev 资产异常：${JSON.stringify(javascript)}`);
}
if (wasm.status !== 200 || !wasm.contentType.includes("application/wasm") || wasm.length <= 0) {
  throw new Error(`RenLib WASM dev 资产异常：${JSON.stringify(wasm)}`);
}
if (javascript.cacheControl !== "no-store" || wasm.cacheControl !== "no-store") {
  throw new Error("RenLib dev 资产必须使用 no-store，避免旧 PWA 缓存污染");
}
if (missing.status !== 404) throw new Error(`未知 RenLib 资产应返回 404，实际为 ${missing.status}`);

console.log(JSON.stringify({ passed: true, javascript, wasm, missing }, null, 2));
