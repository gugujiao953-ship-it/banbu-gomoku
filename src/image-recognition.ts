import type { Cell, Position, Player } from "./types";
import { isSupportedBoardSize } from "./game";

export interface ImageRecognitionResult {
  boardSize: number;
  board: Cell[][];
  numberedMoves: Array<Position & { player: Player; number: number }>;
  confidence: number;
  ignoredColoredMarkers: number;
  note: string;
}

type RasterImage = ImageBitmap | HTMLImageElement;

const loadRasterImage = async (file: File): Promise<{ image: RasterImage; revoke?: string }> => {
  if (typeof createImageBitmap === "function") {
    try {
      return { image: await createImageBitmap(file) };
    } catch {
      // Some WebViews reject createImageBitmap for screenshots. Fall back to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片格式无法读取，请选择 JPG、PNG 或 WEBP 图片"));
    element.src = url;
  });
  return { image, revoke: url };
};

const closeRasterImage = (image: RasterImage, revoke?: string) => {
  if ("close" in image && typeof image.close === "function") image.close();
  if (revoke) URL.revokeObjectURL(revoke);
};

const luminance = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

const meanPatch = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, excludeRadius = 0) => {
  const left = Math.max(0, Math.floor(x - radius));
  const top = Math.max(0, Math.floor(y - radius));
  const size = Math.max(2, Math.min(ctx.canvas.width - left, ctx.canvas.height - top, Math.ceil(radius * 2 + 1)));
  const pixels = ctx.getImageData(left, top, size, size).data;
  let light = 0;
  let saturation = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = index / 4;
    const px = pixel % size + left + 0.5;
    const py = Math.floor(pixel / size) + top + 0.5;
    if (excludeRadius && Math.hypot(px - x, py - y) < excludeRadius) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    light += luminance(r, g, b);
    saturation += Math.max(r, g, b) - Math.min(r, g, b);
    count += 1;
  }
  return { light: count ? light / count : 0, saturation: count ? saturation / count : 0 };
};

/**
 * Recognizes a board position from a screenshot. The input is deliberately
 * treated as a position, not as a move record: analysis labels (green/blue
 * points and win-rate numbers) must never become invented moves.
 */
export const recognizeBoardImage = async (file: File, boardSize = 15): Promise<ImageRecognitionResult> => {
  if (!isSupportedBoardSize(boardSize)) throw new Error("棋盘尺寸必须在 5–25 路之间");
  const loaded = await loadRasterImage(file);
  const { image } = loaded;
  try {
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("图片没有有效尺寸");

    // Mobile screenshots commonly contain a tall UI around a nearly square
    // board. Crop the centered square first; treating the whole portrait as a
    // board was the original cause of the reported false result.
    const portrait = sourceWidth / sourceHeight < 0.86;
    const cropSide = portrait ? sourceWidth * 0.98 : Math.min(sourceWidth, sourceHeight) * 0.96;
    const cropLeft = (sourceWidth - cropSide) / 2;
    const cropTop = portrait ? (sourceHeight - cropSide) / 2 : (sourceHeight - cropSide) / 2;
    const side = Math.min(1400, Math.max(600, Math.round(cropSide)));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持图片识谱");
    ctx.drawImage(image, cropLeft, cropTop, cropSide, cropSide, 0, 0, side, side);

    const board: Cell[][] = Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null));
    // The labels A–O and 1–15 sit outside the grid. This inset matches the
    // board frame in common Gomoku screenshots while leaving room for stones.
    const inset = side * 0.055;
    const span = side - inset * 2;
    const spacing = span / (boardSize - 1);
    // Keep the inner sample well inside a stone. A larger inner sample lets a
    // neighboring stone or a large move number dilute the color contrast.
    const coreRadius = Math.max(3, spacing * 0.27);
    const labelRadius = Math.max(2, spacing * 0.10);
    const ringRadius = Math.max(coreRadius + 3, spacing * 0.38);
    let occupied = 0;
    let score = 0;
    let ignoredColoredMarkers = 0;

    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const x = inset + col * spacing;
        const y = inset + row * spacing;
        // Read the stone surface around the label rather than only the exact
        // center: move numbers can invert the center pixel of both colors.
        const inner = meanPatch(ctx, x, y, coreRadius, labelRadius);
        const ring = meanPatch(ctx, x, y, ringRadius, coreRadius * 1.12);
        const contrast = inner.light - ring.light;

        // Green/blue AI candidates are analysis annotations, not stones. A
        // saturation gate prevents labels such as 49, 51 and 100 from entering
        // the imported position as white stones.
        if (inner.saturation > 42 && inner.light > 70 && contrast > 3) {
          ignoredColoredMarkers += 1;
          continue;
        }
        if (contrast < -12 && inner.light < 150) {
          board[row][col] = "black";
          occupied += 1;
          score += Math.min(1, Math.abs(contrast) / 60);
        } else if (contrast > 5 && inner.light > 165) {
          board[row][col] = "white";
          occupied += 1;
          score += Math.min(1, contrast / 35) * 0.9;
        }
      }
    }

    if (!occupied) throw new Error("没有找到可靠棋子，请确保棋盘完整可见并提高图片清晰度");
    const confidence = Math.max(0.35, Math.min(0.99, score / occupied));
    return {
      boardSize,
      board,
      numberedMoves: [],
      confidence,
      ignoredColoredMarkers,
      note: ignoredColoredMarkers
        ? `已识别棋盘局面，并忽略 ${ignoredColoredMarkers} 个彩色分析点；数字顺序需要人工确认。`
        : "已识别棋盘上的黑白棋子；数字顺序需要人工确认。",
    };
  } finally {
    closeRasterImage(image, loaded.revoke);
  }
};
