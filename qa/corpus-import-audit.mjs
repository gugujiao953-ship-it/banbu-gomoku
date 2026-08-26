import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = process.argv.slice(2);
if (!files.length) throw new Error("用法：node qa/corpus-import-audit.mjs <file>...");
const worker = fileURLToPath(new URL("./corpus-import-one.mjs", import.meta.url));
const runOne = (path) => new Promise((resolve) => {
  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite-node", worker], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: { ...process.env, AUDIT_FILE: path } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code, signal) => {
    try { resolve({ path, ...(JSON.parse(stdout || "{}")), processCode: code, signal, stderr: stderr.trim() || undefined }); }
    catch { resolve({ path, ok: false, error: stderr.trim() || `子进程退出 ${code ?? signal}` }); }
  });
});
const results = [];
for (const path of files) results.push(await runOne(path));
console.log(JSON.stringify(results, null, 2));
if (results.some((item) => !item.ok && !/ar 静态库/.test(item.error || ""))) process.exitCode = 1;
