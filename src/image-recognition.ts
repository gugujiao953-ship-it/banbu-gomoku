import type { Cell, Position, Player } from "./types";
import { isSupportedBoardSize } from "./game";

export interface ImageRecognitionResult {
  boardSize: number;
  board: Cell[][];
  numberedMoves: Array<Position & { player: Player; number: number }>;
  confidence: number;
  note: string;
}

/** Lightweight, dependency-free recognizer for screenshots/scans of a square board.
 * It deliberately returns confidence and asks the UI to confirm low-confidence results.
 */
export const recognizeBoardImage = async (file: File, boardSize = 15): Promise<ImageRecognitionResult> => {
  if (!isSupportedBoardSize(boardSize)) throw new Error("棋盘尺寸必须在 5–25 路之间");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const side = Math.min(1200, Math.max(bitmap.width, bitmap.height));
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("当前浏览器不支持图片识谱");
  ctx.fillStyle = "#d8b477"; ctx.fillRect(0, 0, side, side);
  const scale = Math.min(side / bitmap.width, side / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h);
  bitmap.close();
  const board: Cell[][] = Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null));
  const inset = side * 0.08, span = side - inset * 2, patch = Math.max(3, Math.floor(span / boardSize * 0.42));
  let occupied = 0, confidence = 0;
  for (let row = 0; row < boardSize; row += 1) for (let col = 0; col < boardSize; col += 1) {
    const x = inset + col * span / (boardSize - 1), y = inset + row * span / (boardSize - 1);
    const pixels = ctx.getImageData(Math.max(0, Math.floor(x - patch / 2)), Math.max(0, Math.floor(y - patch / 2)), patch, patch).data;
    let total = 0, darkest = 255;
    for (let i = 0; i < pixels.length; i += 4) { const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3; total += value; darkest = Math.min(darkest, value); }
    const average = total / (pixels.length / 4);
    if (average < 72 && darkest < 45) { board[row][col] = "black"; occupied += 1; confidence += 1; }
    else if (average > 205 && darkest > 110 && average - darkest > 45) { board[row][col] = "white"; occupied += 1; confidence += 0.65; }
  }
  return { boardSize, board, numberedMoves: [], confidence: occupied ? confidence / occupied : 0.35, note: "已识别棋盘上的黑白棋子；数字顺序需要在确认界面人工校正。" };
};
