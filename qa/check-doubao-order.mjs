import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 用识别器认出的「棋子位置 + 颜色」当基准，校验一份外部（豆包）给出的手序：
 *   · 每一步声称的坐标上，到底有没有子；
 *   · 有的话，颜色对不对「奇=黑、偶=白」这条铁律（连珠/五子棋交替落子，黑先）。
 * 颜色与占位是识别器最可靠的部分（基线实测：paper10 子数 63/66、颜色逐颗对），
 * 而它读不出的恰恰是数字——所以用它的强项去查豆包，而不是用我的肉眼。
 * 跑法：QA_BASE_URL=http://localhost:5301/ node qa/check-doubao-order.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://localhost:5301/";
const fixture = resolve("qa/fixtures/recognition/paper10.jpg");

// 豆包给出的 66 手（number:coord）
const DOUBAO = "1:H8,2:H7,3:H10,4:G7,5:F10,6:I8,7:I7,8:G9,9:G6,10:E9,11:F9,12:E7,13:F8,14:F7,15:D7,16:G11,17:E8,18:G10,19:G8,20:D8,21:F11,22:F12,23:F5,24:E11,25:D10,26:G12,27:G13,28:E12,29:D12,30:E13,31:E10,32:C15,33:D14,34:H12,35:I12,36:F13,37:D15,38:C10,39:D11,40:C12,41:C8,42:E14,43:E15,44:I10,45:H11,46:E6,47:C6,48:B5,49:C5,50:C7,51:B7,52:D9,53:G5,54:D5,55:F4,56:C4,57:B3,58:H6,59:H5,60:I5,61:F2,62:F6,63:B10,64:C13,65:C11,66:B13";

const moves = DOUBAO.split(",").map((token) => {
  const [number, coord] = token.split(":");
  return { number: Number(number), coord: coord.trim().toUpperCase() };
});

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(180_000);
await page.route("**/qa-doubao-host.html", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset=utf-8></head><body></body></html>" }));

try {
  await page.goto(new URL("qa-doubao-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const board = await page.evaluate(async (b64) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], "paper10.jpg", { type: "image/jpeg" }), 15, { skipMoveOrder: true });
    const cells = [];
    result.board.forEach((row, r) => row.forEach((p, c) => { if (p) cells.push({ coord: `${String.fromCharCode(65 + c)}${15 - r}`, color: p === "black" ? "黑" : "白" }); }));
    return cells;
  }, readFileSync(fixture).toString("base64"));

  const at = new Map(board.map((cell) => [cell.coord, cell.color]));
  const problems = [];
  for (const move of moves) {
    const expected = move.number % 2 === 1 ? "黑" : "白";
    const actual = at.get(move.coord);
    if (!actual) problems.push(`第 ${move.number} 手 ${move.coord}：识别器在该点**没有子**（豆包说应是${expected}）`);
    else if (actual !== expected) problems.push(`第 ${move.number} 手 ${move.coord}：颜色不对——该点识别为${actual}，但第 ${move.number} 手（${move.number % 2 === 1 ? "奇=黑" : "偶=白"}）应是${expected}`);
  }
  // 反向：识别器认到的子，豆包有没有漏（豆包 66 个坐标覆盖了多少个识别到的子）
  const doubaoCoords = new Set(moves.map((m) => m.coord));
  const missed = board.filter((cell) => !doubaoCoords.has(cell.coord)).map((cell) => `${cell.coord}(${cell.color})`);
  const dupCoords = moves.map((m) => m.coord).filter((coord, index, all) => all.indexOf(coord) !== index);

  console.log(`豆包 ${moves.length} 手；识别器认到 ${board.length} 子（paper10 真值 66 子，识别器少认 ${66 - board.length}）`);
  console.log(`\n【坐标/颜色矛盾】${problems.length} 处：`);
  for (const line of problems) console.log("  ✗ " + line);
  console.log(`\n【识别器认到、但豆包坐标没覆盖的点】${missed.length} 个：${missed.join(" ") || "无"}`);
  console.log(`【豆包重复坐标】${dupCoords.length ? [...new Set(dupCoords)].join(" ") : "无"}`);
} finally {
  await browser.close();
}
