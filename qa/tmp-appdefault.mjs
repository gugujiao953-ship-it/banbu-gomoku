// 用应用**自己的默认模型常量**（不注入任何候选）读一张 224 手留出盘：
// iter8（171 类）结构上读不出 ≥171 的号；能读出就证明装上去的是 226 类新模型。
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const base = "http://127.0.0.1:5301/";
const IMG = resolve("qa/fixtures/materials/self-val-2/self-039@1200.jpg");
const TRUTH = resolve("qa/fixtures/materials/self-val-2/self-039@1200.truth.json");
const truth = JSON.parse(readFileSync(TRUTH, "utf8"));
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ serviceWorkers: "block" })).newPage();
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 160)));
await p.route("**/qa-ad-host.html", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
await p.goto(new URL("qa-ad-host.html", base).href, { waitUntil: "domcontentloaded" });
const out = await p.evaluate(async ({ dataUrl, truthList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });
  const blob = await (await fetch(dataUrl)).blob();
  const res = await mod.recognizeBoardImage(new File([blob], "t.jpg", { type: "image/jpeg" }), 15, { skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: scanner });
  const expect = new Map(truthList.map((s) => [`${s.row},${s.col}`, s.number]));
  const got = new Map(res.readMoveNumbers.map((m) => [`${m.row},${m.col}`, m.number]));
  let hit = 0, over170 = 0;
  for (const [rc, want] of expect) { if (got.get(rc) === want) hit += 1; if (want >= 171) over170 += 1; }
  const nums = res.readMoveNumbers.map((m) => m.number);
  return { url: head.DIGIT_HEAD_MODEL_URL, stones: res.board.flat().filter(Boolean).length, read: nums.length, maxRead: Math.max(...nums), truthMax: Math.max(...truthList.map((s) => s.number)), gt170Read: nums.filter((n) => n >= 171).length, hit, of: expect.size };
}, { dataUrl: `data:image/jpeg;base64,${readFileSync(IMG).toString("base64")}`, truthList: truth.stones });
console.log(JSON.stringify(out, null, 1));
await b.close();
