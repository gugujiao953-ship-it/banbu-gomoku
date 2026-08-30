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

interface SampledImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  gray: Float32Array;
}

const sampleImage = (ctx: CanvasRenderingContext2D, side: number): SampledImage => {
  const { data } = ctx.getImageData(0, 0, side, side);
  const gray = new Float32Array(side * side);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    gray[pixel] = luminance(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]);
  }
  return { data, width: side, height: side, gray };
};

interface GridEstimate {
  originX: number;
  originY: number;
  spacingX: number;
  spacingY: number;
  quality: number;
}

/** Line score per row/column: count pixels where a thin dark line sits
 * between two bright neighbours ACROSS the line (bright–dark–bright). Rows
 * are probed vertically and columns horizontally, so both line orientations
 * score along their full length. A stone edge fails the pattern (its inner
 * side is dark too), and the statistic is independent of overall exposure,
 * which plain darkness thresholds are not — a page-dominated screenshot
 * shifts the median and breaks them. */
const collectLineScores = (gray: Float32Array, width: number, height: number, alongX: boolean) => {
  const span = alongX ? height : width;
  const inner = alongX ? width : height;
  const scores = new Float32Array(span);
  for (let fixed = 1; fixed < span - 1; fixed += 1) {
    let score = 0;
    for (let index = 1; index < inner - 1; index += 1) {
      const center = alongX ? gray[fixed * width + index] : gray[index * width + fixed];
      const above = alongX
        ? gray[(fixed - 1) * width + index]
        : gray[index * width + fixed - 1];
      const below = alongX
        ? gray[(fixed + 1) * width + index]
        : gray[index * width + fixed + 1];
      // relative threshold: border lines are thick, so their core row borders
      // on antialiased edge rows (~110-150) rather than plain board colour
      if (above > 105 && below > 105 && center < above - 22 && center < below - 22) score += 1;
    }
    scores[fixed] = score;
  }
  return scores;
};

const groupLinePeaks = (scores: Float32Array) => {
  const maximum = Math.max(...scores);
  if (maximum < 40) return [];
  // 0.68 keeps coordinate-caption rows (short glyph strokes) out of the line
  // set; lines hidden under stones are recovered later by the phase fit.
  const threshold = maximum * 0.68;
  const lines: number[] = [];
  for (let fixed = 1; fixed < scores.length - 1; fixed += 1) {
    if (scores[fixed] < threshold) continue;
    let sum = 0, count = 0;
    while (fixed < scores.length - 1 && scores[fixed] >= threshold) { sum += fixed; count += 1; fixed += 1; }
    lines.push(sum / count);
  }
  return lines;
};

/** Locate the go/gomoku grid anywhere in the image: score every row/column by
 * its bright–dark–bright line pattern, fit the detected line positions to an
 * arithmetic series of boardSize lines, and verify the two spacings agree.
 * Works without any crop assumption, so screenshots with toolbars, captions
 * or margins still align. Returns null when no credible grid exists. */
const detectGrid = (image: SampledImage, boardSize: number): GridEstimate | null => {
  const { gray, width: side, height } = image;

  const rowLines = groupLinePeaks(collectLineScores(gray, side, height, true));
  const columnLines = groupLinePeaks(collectLineScores(gray, side, height, false));

  // Wood extent: the dominant luminance inside the detected-line rectangle is
  // the board wood. Its bounding box is the only signal that can tell a board
  // whose border line escaped detection (origin one cell before the first
  // detected line) apart from a series shifted a full cell onto the next row.
  // The rectangle must NOT span stray separator lines: occlusion can only
  // widen gaps, so the smallest gap lower-bounds the real spacing.
  const smallestGap = (lines: number[]) => {
    let smallest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < lines.length; index += 1) {
      const gap = lines[index] - lines[index - 1];
      if (gap >= 8 && gap < smallest) smallest = gap;
    }
    return Number.isFinite(smallest) ? smallest : 30;
  };
  const rowSpanLimit = rowLines.length > 1 ? Math.min(...rowLines) + (boardSize - 1) * smallestGap(rowLines) : height;
  const colSpanLimit = columnLines.length > 1 ? Math.min(...columnLines) + (boardSize - 1) * smallestGap(columnLines) : side;
  const rowsMin = rowLines.length ? Math.min(...rowLines) : 0;
  const rowsMax = Math.min(rowLines.length ? Math.max(...rowLines) : 0, rowSpanLimit);
  const colsMin = columnLines.length ? Math.min(...columnLines) : 0;
  const colsMax = Math.min(columnLines.length ? Math.max(...columnLines) : 0, colSpanLimit);
  const hist = new Float64Array(256);
  for (let y = Math.max(0, Math.floor(rowsMin)); y <= Math.min(height - 1, Math.ceil(rowsMax)); y += 3) {
    for (let x = Math.max(0, Math.floor(colsMin)); x <= Math.min(side - 1, Math.ceil(colsMax)); x += 3) {
      hist[Math.min(255, Math.max(0, Math.round(gray[y * side + x])))] += 1;
    }
  }
  let woodLum = 0, woodPeak = 0;
  for (let value = 40; value < 256; value += 1) {
    if (hist[value] > woodPeak) { woodPeak = hist[value]; woodLum = value; }
  }
  const inWood = (value: number) => Math.abs(value - woodLum) < 30;
  const woodSpan = (alongX: boolean) => {
    const spanLimit = alongX ? height : side;
    const crossStart = alongX ? Math.max(0, Math.floor(colsMin - 20)) : Math.max(0, Math.floor(rowsMin - 20));
    const crossEnd = alongX ? Math.min(side - 1, Math.ceil(colsMax + 20)) : Math.min(height - 1, Math.ceil(rowsMax + 20));
    const lineMin = alongX ? rowsMin : colsMin;
    const lineMax = alongX ? rowsMax : colsMax;
    let start = -1, end = -1;
    for (let fixed = Math.max(0, Math.floor(lineMin - 45)); fixed <= Math.min(spanLimit - 1, Math.ceil(lineMax + 45)); fixed += 1) {
      let wood = 0, total = 0;
      for (let index = crossStart; index <= crossEnd; index += 2) {
        total += 1;
        const value = alongX ? gray[fixed * side + index] : gray[index * side + fixed];
        if (inWood(value)) wood += 1;
      }
      const wooden = total > 0 && wood / total > 0.6;
      if (wooden && start < 0) start = fixed;
      if (wooden) end = fixed;
    }
    return { start, end };
  };
  const woodRows = woodSpan(true);
  const woodCols = woodSpan(false);

  const fitLineSeries = (lines: number[], span: number, wood: { start: number; end: number }) => {
    // Stones cover the middle of the board, so grid lines are usually only
    // visible near the edges. Four+ detected lines are enough: candidate
    // spacings come from every gap (and its 2/3 splits — occlusion can only
    // widen gaps, never shrink them). Each candidate is refined by least
    // squares over the lines it matches (integral gaps quantise the spacing
    // and drift across a 512px board), and the series must stretch over every
    // detected line, which rejects UI separators far from the board.
    const minLine = Math.min(...lines), maxLine = Math.max(...lines);
    if (lines.length < 4) return null;
    const candidates = new Set<number>();
    for (let index = 1; index < lines.length; index += 1) {
      const gap = lines[index] - lines[index - 1];
      if (gap >= 8) {
        candidates.add(gap);
        candidates.add(Math.round(gap / 2));
        candidates.add(Math.round(gap / 3));
      }
    }
    let best: { origin: number; spacing: number; coverage: number } | null = null;
    for (const rawSpacing of candidates) {
      if (rawSpacing < 8) continue;
      for (const anchor of lines) {
        // initial phase from the anchor, one refinement pass, then fit
        let first = anchor % rawSpacing;
        let spacing = rawSpacing;
        const scoreOf = (origin: number, step: number) => {
          const tolerance = Math.max(2, step * 0.16);
          let hits = 0;
          for (const line of lines) {
            const k = Math.round((line - origin) / step);
            if (k >= 0 && Math.abs(origin + k * step - line) <= tolerance) hits += 1;
          }
          return hits;
        };
        const baseCoverage = scoreOf(first, spacing);
        for (let pass = 0; pass < 2; pass += 1) {
          const tolerance = Math.max(2, spacing * 0.16);
          const pairs: Array<[number, number]> = [];
          for (const line of lines) {
            const k = Math.round((line - first) / spacing);
            if (k >= 0 && Math.abs(first + k * spacing - line) <= tolerance) pairs.push([k, line]);
          }
          if (pairs.length < 2) break;
          let sumK = 0, sumL = 0;
          for (const [k, line] of pairs) { sumK += k; sumL += line; }
          const meanK = sumK / pairs.length, meanL = sumL / pairs.length;
          let denom = 0;
          for (const [k, line] of pairs) denom += (k - meanK) * (k - meanK);
          if (denom < 1) break;
          let slope = 0;
          for (const [k, line] of pairs) slope += (k - meanK) * (line - meanL);
          const refinedSpacing = slope / denom;
          const refinedFirst = meanL - refinedSpacing * meanK;
          if (refinedSpacing < 8) break;
          // keep the refinement only when it does not lose lines (a stray
          // separator that coincides with the coarse series would otherwise
          // drag the regression away from the board)
          if (scoreOf(refinedFirst, refinedSpacing) < scoreOf(first, spacing)) break;
          spacing = refinedSpacing;
          first = refinedFirst;
        }
        const coverage = scoreOf(first, spacing);
        // Ties go to the series whose first line sits nearest the smallest
        // detected line: a one-cell-shifted series can score the same when a
        // stray separator closes the gap, but it starts off the board.
        const nearer = (origin: number) => Math.abs(origin - minLine);
        if (!best || coverage > best.coverage || (coverage === best.coverage && nearer(first) < nearer(best.origin))) {
          best = { origin: first, spacing, coverage };
        }
      }
    }
    if (!best || best.coverage < Math.max(4, lines.length * 0.8)) return null;

    // Walk the series around the fitted origin (both directions: a board
    // whose border line escaped detection starts one cell before the first
    // detected line). The window must cover the detected lines AND the whole
    // series must stay on the wood: the first line may sit at most ~one cell
    // outside the wood box, and so may the last one.
    let chosen: { origin: number; spacing: number; coverage: number } | null = null;
    const tolerance = Math.max(2, best.spacing * 0.16);
    const boardRangeEnd = minLine + (boardSize - 0.4) * best.spacing;
    const maxBoardLine = Math.max(...lines.filter((line) => line <= boardRangeEnd));
    const woodStartLimit = wood.start >= 0 ? wood.start - best.spacing : minLine - best.spacing;
    const woodEndLimit = wood.end >= 0 ? wood.end + best.spacing : minLine + (boardSize - 1) * best.spacing + best.spacing;
    const firstOrigin = Math.max(2, best.origin - Math.ceil((best.origin - woodStartLimit) / best.spacing) * best.spacing);
    for (let origin = firstOrigin; origin <= minLine + best.spacing * 0.16 + 2; origin += best.spacing) {
      if (origin + (boardSize - 1) * best.spacing > span - 2) break;
      if (origin < woodStartLimit - tolerance) continue;
      if (origin + (boardSize - 1) * best.spacing > woodEndLimit + tolerance) continue;
      if (origin + (boardSize - 1) * best.spacing < maxBoardLine - tolerance) continue;
      let inside = 0;
      for (const line of lines) {
        if (line >= origin - tolerance && line <= origin + (boardSize - 1) * best.spacing + tolerance) inside += 1;
      }
      if (inside < lines.length * 0.75) continue;
      chosen = { ...best, origin };
      break;
    }
    if (!chosen) return null;
    return { origin: chosen.origin, spacing: chosen.spacing, coverage: chosen.coverage };
  };

  const rowFit = fitLineSeries(rowLines, height, woodRows);
  const columnFit = fitLineSeries(columnLines, side, woodCols);
  if (!rowFit || !columnFit) return null;
  const spacingRatio = Math.min(rowFit.spacing, columnFit.spacing) / Math.max(rowFit.spacing, columnFit.spacing);
  if (spacingRatio < 0.9) return null;
  const quality = Math.min(rowFit.coverage, columnFit.coverage) / boardSize;
  return {
    originX: columnFit.origin,
    originY: rowFit.origin,
    spacingX: columnFit.spacing,
    spacingY: rowFit.spacing,
    quality,
  };
};

const meanPatchGray = (image: SampledImage, x: number, y: number, radius: number, excludeRadius = 0) => {
  const { gray, width, height } = image;
  const left = Math.max(0, Math.floor(x - radius));
  const top = Math.max(0, Math.floor(y - radius));
  const right = Math.min(width - 1, Math.ceil(x + radius));
  const bottom = Math.min(height - 1, Math.ceil(y + radius));
  let light = 0, saturation = 0, red = 0, green = 0, blue = 0, count = 0;
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      if (Math.hypot(px + 0.5 - x, py + 0.5 - y) > radius) continue;
      if (excludeRadius && Math.hypot(px + 0.5 - x, py + 0.5 - y) < excludeRadius) continue;
      const index = py * width + px;
      light += gray[index];
      const r = image.data[index * 4], g = image.data[index * 4 + 1], b = image.data[index * 4 + 2];
      red += r; green += g; blue += b;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
      count += 1;
    }
  }
  return {
    light: count ? light / count : 0,
    saturation: count ? saturation / count : 0,
    red: count ? red / count : 0,
    green: count ? green / count : 0,
    blue: count ? blue / count : 0,
    count,
  };
};

/** 5x7 dot-matrix digit templates used for move-number recovery. Each row is
 * one bit pattern of the digit glyph (1 = ink). */
const DIGIT_TEMPLATES: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const matchDigitTemplate = (image: SampledImage, cx: number, cy: number, halfWidth: number, glyphHeight: number, inkIsDark: boolean) => {
  const { gray } = image;
  const templateWidth = 5, templateHeight = 7;
  let bestDigit = "", bestScore = 0;
  for (const [digit, pattern] of Object.entries(DIGIT_TEMPLATES)) {
    let hit = 0, total = 0;
    for (let row = 0; row < templateHeight; row += 1) {
      for (let column = 0; column < templateWidth; column += 1) {
        const want = Boolean((pattern[row] >> (templateWidth - 1 - column)) & 1);
        const gx = cx - halfWidth + (column + 0.5) * (halfWidth * 2) / templateWidth;
        const gy = cy - glyphHeight / 2 + (row + 0.5) * glyphHeight / templateHeight;
        const px = Math.round(gx), py = Math.round(gy);
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const value = gray[py * image.width + px];
        const isInk = inkIsDark ? value < 120 : value > 175;
        total += 1;
        if (want === isInk) hit += 1;
      }
    }
    const score = total ? hit / total : 0;
    if (score > bestScore) { bestScore = score; bestDigit = digit; }
  }
  return { digit: bestDigit, score: bestScore };
};

const detectMoveNumber = (image: SampledImage, x: number, y: number, spacing: number, player: Player): number | null => {
  // The move number is painted in the opposite color near the stone center;
  // our own board renders it at ~0.26 of the grid spacing tall.
  const inkIsDark = player === "white";
  let best: { value: number; score: number } | null = null;
  for (const scale of [0.9, 1, 1.15, 1.3]) {
    const glyphHeight = spacing * 0.26 * scale;
    const halfWidth = glyphHeight * (5 / 7) / 2;
    const single = matchDigitTemplate(image, x, y, halfWidth, glyphHeight, inkIsDark);
    if (!best || single.score > best.score) best = { value: Number(single.digit), score: single.score };
    // two-digit numbers: probe the left and right glyph boxes
    const offset = glyphHeight * 0.62;
    const left = matchDigitTemplate(image, x - offset, y, halfWidth, glyphHeight, inkIsDark);
    const right = matchDigitTemplate(image, x + offset, y, halfWidth, glyphHeight, inkIsDark);
    if (left.score > 0.72 && right.score > 0.72) {
      const value = Number(left.digit + right.digit);
      const score = (left.score + right.score) / 2;
      if (!best || score > best.score) best = { value, score };
    }
  }
  if (best && best.score >= 0.76 && best.value > 0) return best.value;
  return null;
};

/**
 * Recognizes a board position from a screenshot. The grid is located by
 * detecting the near-full-length dark lines instead of assuming margins, so
 * cropped, framed and zoomed screenshots still align. The input is treated as
 * a position, not a move record: analysis labels (green/blue points) never
 * become invented moves, and legible move numbers are reported separately.
 */
export const recognizeBoardImage = async (file: File, boardSize = 15): Promise<ImageRecognitionResult> => {
  if (!isSupportedBoardSize(boardSize)) throw new Error("棋盘尺寸必须在 5–25 路之间");
  const loaded = await loadRasterImage(file);
  const { image } = loaded;
  try {
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("图片没有有效尺寸");

    // Keep the whole frame (no crop): the grid detector locates the board by
    // its lines wherever it sits. Long side is capped for memory.
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvasWidth = Math.max(320, Math.round(sourceWidth * scale));
    const canvasHeight = Math.max(320, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持图片识谱");
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight);
    const data = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
    const gray = new Float32Array(canvasWidth * canvasHeight);
    for (let pixel = 0; pixel < gray.length; pixel += 1) {
      gray[pixel] = luminance(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]);
    }
    const sampled: SampledImage = { data, width: canvasWidth, height: canvasHeight, gray };

    let grid = detectGrid(sampled, boardSize);
    // Fallback: legacy fixed-inset geometry, still better than failing hard.
    const fallback = !grid;
    if (!grid) {
      const inset = canvasWidth * 0.055;
      const span = canvasWidth - inset * 2;
      const spacing = span / (boardSize - 1);
      grid = { originX: inset, originY: canvasHeight * 0.5 - span / 2, spacingX: spacing, spacingY: spacing, quality: 0.5 };
    }

    // Board background luminance from the median INSIDE the detected grid:
    // the frame-wide median drifts with how much page/application chrome
    // surrounds the board (a white page pushed it to 238 and made the wooden
    // board count as "dark", painting empty points black).
    const medianSample = new Float32Array(4096);
    const gridLeft = Math.max(0, Math.floor(grid.originX - grid.spacingX * 0.5));
    const gridTop = Math.max(0, Math.floor(grid.originY - grid.spacingY * 0.5));
    const gridRight = Math.min(canvasWidth - 1, Math.ceil(grid.originX + (boardSize - 1) * grid.spacingX + grid.spacingX * 0.5));
    const gridBottom = Math.min(canvasHeight - 1, Math.ceil(grid.originY + (boardSize - 1) * grid.spacingY + grid.spacingY * 0.5));
    const gridArea = Math.max(1, (gridRight - gridLeft) * (gridBottom - gridTop));
    for (let index = 0; index < 4096; index += 1) {
      const px = gridLeft + (index % 64) * Math.max(1, Math.floor((gridRight - gridLeft) / 64));
      const py = gridTop + Math.floor(index / 64) * Math.max(1, Math.floor((gridBottom - gridTop) / 64));
      medianSample[index] = sampled.gray[Math.min(sampled.gray.length - 1, py * canvasWidth + px)];
    }
    void gridArea;
    const background = Array.from(medianSample).sort((a, b) => a - b)[2048];

    const board: Cell[][] = Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null));
    const numberedMoves: Array<Position & { player: Player; number: number }> = [];
    const discRadius = Math.max(5, grid.spacingX * 0.42);
    let occupied = 0;
    let score = 0;
    let ignoredColoredMarkers = 0;

    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const x = grid.originX + col * grid.spacingX;
        const y = grid.originY + row * grid.spacingY;
        if (x < 3 || y < 3 || x > canvasWidth - 4 || y > canvasHeight - 4) continue;
        // Majority vote over a stone-sized disc. Stones are neutral grey
        // (low saturation) while a wooden board is strongly coloured, so the
        // wood is separated by saturation first; within the neutral pixels
        // black and white split by luminance. Move numbers, native labels and
        // small analysis dots only cover a minority of the disc, so the vote
        // reflects the stone itself, not its annotations.
        const votes = { dark: 0, light: 0 };
        const color = { red: 0, green: 0, blue: 0, saturated: 0, count: 0 };
        {
          const { gray, data, width, height } = sampled;
          const left = Math.max(0, Math.floor(x - discRadius));
          const top = Math.max(0, Math.floor(y - discRadius));
          const right = Math.min(width - 1, Math.ceil(x + discRadius));
          const bottom = Math.min(height - 1, Math.ceil(y + discRadius));
          const darkLine = Math.min(110, background - 55);
          for (let py = top; py <= bottom; py += 1) {
            for (let px = left; px <= right; px += 1) {
              if (Math.hypot(px + 0.5 - x, py + 0.5 - y) > discRadius) continue;
              const index = py * width + px;
              const r = data[index * 4], g = data[index * 4 + 1], b = data[index * 4 + 2];
              const saturation = Math.max(r, g, b) - Math.min(r, g, b);
              const value = gray[index];
              color.red += r; color.green += g; color.blue += b;
              if (saturation > 42) color.saturated += 1;
              color.count += 1;
              if (saturation > 55) continue; // wooden board / coloured marker
              if (value < darkLine) votes.dark += 1;
              else if (value > background - 18) votes.light += 1;
            }
          }
        }
        const total = color.count || 1;
        const red = color.red / total, green = color.green / total, blue = color.blue / total;
        const saturationShare = color.saturated / total;

        // Green/blue/red analysis annotations are not stones.
        const greenMarker = green > red * 1.12 && green > blue * 1.05;
        const blueMarker = blue > red * 1.10 && blue > green * 1.02;
        const redMarker = red > green * 1.45 && red > blue * 1.45;
        if (saturationShare > 0.45 && (greenMarker || blueMarker || redMarker)) {
          ignoredColoredMarkers += 1;
          continue;
        }
        // A stone covers the majority of the disc even after antialiasing and
        // a center number; grid lines and star points never reach 40%.
        if (votes.dark > total * 0.4 && votes.dark >= votes.light) {
          board[row][col] = "black";
          occupied += 1;
          score += Math.min(1, votes.dark / total + 0.25);
          const number = detectMoveNumber(sampled, x, y, grid.spacingX, "black");
          if (number !== null) numberedMoves.push({ row, col, player: "black", number });
        } else if (votes.light > total * 0.4) {
          board[row][col] = "white";
          occupied += 1;
          score += Math.min(1, votes.light / total + 0.2);
          const number = detectMoveNumber(sampled, x, y, grid.spacingX, "white");
          if (number !== null) numberedMoves.push({ row, col, player: "white", number });
        }
      }
    }

    if (!occupied) throw new Error("没有找到可靠棋子，请确保棋盘完整可见并提高图片清晰度");
    const confidence = Math.max(0.35, Math.min(0.99, (score / occupied) * (fallback ? 0.8 : 0.9 + grid.quality * 0.1)));
    const ordered = numberedMoves.slice().sort((a, b) => a.number - b.number);
    const note = [
      fallback ? "未检测到网格线，已按标准边距识别，建议截取仅含棋盘的区域。" : "已自动定位棋盘网格。",
      `识别 ${occupied} 子`,
      ignoredColoredMarkers ? `忽略 ${ignoredColoredMarkers} 个彩色标注` : "",
      ordered.length ? `已按序号恢复 ${ordered.length} 手顺序` : "未检测到可靠序号",
    ].filter(Boolean).join("；");
    return {
      boardSize,
      board,
      numberedMoves: ordered,
      confidence,
      ignoredColoredMarkers,
      note,
    };
  } finally {
    closeRasterImage(image, loaded.revoke);
  }
};
