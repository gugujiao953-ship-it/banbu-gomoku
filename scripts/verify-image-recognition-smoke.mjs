import { chromium } from "playwright";

// Smoke for the (original) image-recognition pipeline: a full board is read,
// and cropping the board region out of a "screenshot + app UI below" still
// recognizes it. Drives the real module from the dev server.
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(async () => {
  const module = await import("/src/image-recognition.ts");
  const drawBoard = (canvas, stones, boardSize = 15) => {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const margin = 0.06;
    ctx.fillStyle = "#e8c98f";
    ctx.fillRect(0, 0, size, size);
    const cell = (size * (1 - margin * 2)) / (boardSize - 1);
    ctx.strokeStyle = "#4a3a24";
    ctx.lineWidth = Math.max(1, size / 640);
    for (let index = 0; index < boardSize; index += 1) {
      const p = margin * size + index * cell;
      ctx.beginPath(); ctx.moveTo(p, margin * size); ctx.lineTo(p, size - margin * size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin * size, p); ctx.lineTo(size - margin * size, p); ctx.stroke();
    }
    for (const [row, col, player] of stones) {
      const x = margin * size + col * cell;
      const y = margin * size + row * cell;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = player === "black" ? "#111" : "#fafafa";
      ctx.fill();
      ctx.strokeStyle = player === "black" ? "#000" : "#999";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };
  const canvasToFile = async (canvas, name) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return new File([blob], name, { type: "image/png" });
  };

  // A screenshot whose top part is the board and whose bottom is app UI that
  // must not read as stones.
  const stones = [];
  for (let index = 0; index < 10; index += 1) stones.push([3 + (index % 3) * 2, 3 + Math.floor(index / 3) * 2, index % 2 === 0 ? "black" : "white"]);
  const board = document.createElement("canvas");
  board.width = 1200; board.height = 1200;
  drawBoard(board, stones);

  const screenshot = document.createElement("canvas");
  screenshot.width = 1200; screenshot.height = 1440;
  const ctx = screenshot.getContext("2d");
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, 1200, 1440);
  ctx.drawImage(board, 0, 0);
  ctx.fillStyle = "#365e4b";
  for (let index = 0; index < 4; index += 1) {
    const x = 60 + index * 280;
    ctx.beginPath();
    ctx.roundRect(x, 1250, 240, 90, 18);
    ctx.fill();
  }
  ctx.fillStyle = "#fafafa";
  ctx.beginPath();
  ctx.roundRect(60, 1370, 1080, 44, 22);
  ctx.fill();
  const screenshotFile = await canvasToFile(screenshot, "screenshot-with-ui.png");

  const direct = await module.recognizeBoardImage(screenshotFile, 15);
  const directStones = direct.board.flat().filter(Boolean).length;

  const cropped = document.createElement("canvas");
  cropped.width = 1200; cropped.height = 1200;
  cropped.getContext("2d").drawImage(screenshot, 0, 0, 1200, 1200, 0, 0, 1200, 1200);
  const croppedFile = await canvasToFile(cropped, "board-crop.png");
  const croppedResult = await module.recognizeBoardImage(croppedFile, 15);
  const croppedStones = croppedResult.board.flat().filter(Boolean).length;

  return { expected: stones.length, directStones, croppedStones };
});

console.log(JSON.stringify(result));
await browser.close();
const ok = result.directStones >= result.expected * 0.8 && result.croppedStones >= result.expected * 0.8;
if (!ok) { console.error("SMOKE FAILED"); process.exit(1); }
console.log("SMOKE OK");
