/* Node harness: run the classic Rapfi worker script outside a browser to
 * verify analyze behavior (used for the finishOnBareMove acceptance test). */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = process.env.WNODE_ROOT || fileURLToPath(new URL("../", import.meta.url));
globalThis.self = globalThis;
globalThis.require = createRequire(root + "public/rapfi/rapfi-worker.js");
globalThis.__dirname = root + "public/rapfi";
globalThis.location = { href: `file:///${root.replaceAll("\\", "/")}public/rapfi/rapfi-worker.js` };
globalThis.importScripts = (relative) => {
  const code = readFileSync(root + relative.replace("./", ""), "utf8");
  vm.runInThisContext(code, { filename: relative });
};

const workerCode = readFileSync(root + (process.env.WNODE_ROOT ? "rapfi-worker.js" : "public/rapfi/rapfi-worker.js"), "utf8");
vm.runInThisContext(workerCode, { filename: "rapfi-worker.js" });

const mateMoves = [
  { row: 6, col: 5, player: "black" }, { row: 4, col: 3, player: "white" },
  { row: 6, col: 6, player: "black" }, { row: 4, col: 5, player: "white" },
  { row: 6, col: 7, player: "black" }, { row: 4, col: 7, player: "white" },
  { row: 6, col: 8, player: "black" }, { row: 10, col: 10, player: "white" },
];
const label = process.argv[2] || "mate-in-1";
const timeMs = Number(process.argv[3] || 3000);

const seen = [];
self.postMessage = (message) => {
  if (message.type === "log") { seen.push(Math.round(performance.now()) + " " + String(message.message).slice(0, 90)); return; }
  if (message.type === "result") {
    seen.forEach((line) => console.log(line));
    console.log(JSON.stringify({ label, elapsed: Math.round(message.result.elapsedMs), move: message.result.move, depth: message.result.depth, finishOnBareMove: "fired" }));
    process.exit(0);
  }
  if (message.type === "error") {
    console.log(JSON.stringify({ label, error: message.message }));
    process.exit(1);
  }
};

self.onmessage({ data: { type: "analyze", size: 15, moves: mateMoves, player: "black", rule: "renju", timeMs, maxDepth: 64, finishOnBareMove: true, rawDebug: true } });

setTimeout(() => {
  console.log(JSON.stringify({ label, hang: true }));
  process.exit(1);
}, timeMs + 25000);
