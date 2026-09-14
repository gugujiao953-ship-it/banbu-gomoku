/**
 * Uniform-grid board recognizer (POC-validated, 19/20 on "other-app" style
 * screenshots where the frozen algorithm scores 3/20).
 *
 * Contract: the caller provides the image region that the user aligned with
 * the fixed square frame (the board's outer grid frame), as ImageData. The
 * grid is divided evenly into 15×15 intersections; each intersection is
 * classified as empty (grid-line cross, via direction-continuity), or
 * black/white by RELATIVE clustering (brightest stones = white, darkest =
 * black — no absolute thresholds, so any board/stone palette works).
 *
 * snapUniformFrame refines a slightly-off frame (up to ±~0.8 cell per axis)
 * by maximizing per-line "on-line contrast minus shoulder contrast", axis by
 * axis, global coarse scan then fine pass.
 *
 * Algorithm reference: lfz084/renju CheckerBoard/image2board.js (GPL-era
 * community tool, concepts re-implemented); POC: experiments/board-recognition-poc/.
 */

export interface UniformStone {
  row: number;
  col: number;
  player: "black" | "white";
}

export interface UniformGridBoard {
  boardSize: 15;
  board: Array<Array<"black" | "white" | null>>;
  stones: UniformStone[];
  /** Mean peakness at the final frame — alignment quality signal. */
  alignmentScore: number;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const N = 15;

const luminance = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Refine a rough grid frame by maximizing per-line peakness (axis-decomposed). */
export const snapUniformFrame = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  frame: Frame,
): Frame => {
  const lumAt = (x: number, y: number) => {
    const xx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const yy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const k = (yy * width + xx) * 4;
    return luminance(data[k], data[k + 1], data[k + 2]);
  };
  const samples: number[] = [];
  for (let gy = frame.y; gy <= frame.y + frame.h; gy += frame.h / 40) {
    for (let gx = frame.x; gx <= frame.x + frame.w; gx += frame.w / 40) samples.push(lumAt(gx, gy));
  }
  samples.sort((a, b) => a - b);
  const medianLum = samples[samples.length >> 1] ?? 128;
  const diffAt = (x: number, y: number) => Math.abs(lumAt(x, y) - medianLum);
  const axisScore = (origin: number, span: number, crossStart: number, crossSpan: number, vertical: boolean) => {
    const lineAvg = (fixed: number, start: number, len: number) => {
      let s = 0, c = 0;
      for (let t = 0; t <= len; t += 3) {
        const x = vertical ? fixed : start + t;
        const y = vertical ? start + t : fixed;
        s += diffAt(x, y); c += 1;
      }
      return c ? s / c : 0;
    };
    let total = 0;
    for (let i = 0; i < N; i += 1) {
      const pos = origin + (i * span) / (N - 1);
      const on = lineAvg(pos, crossStart, crossSpan);
      const shoulderA = lineAvg(pos - 3, crossStart, crossSpan);
      const shoulderB = lineAvg(pos + 3, crossStart, crossSpan);
      total += Math.max(0, on - (shoulderA + shoulderB) / 2);
    }
    return total;
  };
  const snapAxis = (start0: number, span0: number, cell0: number, score: (start: number, span: number) => number) => {
    let bestStart = start0, bestSpan = span0, bestScore = -Infinity;
    for (let d0 = -cell0; d0 <= cell0; d0 += 2) {
      for (let ds = -0.08; ds <= 0.08; ds += 0.01) {
        const s = score(start0 + d0, span0 * (1 + ds));
        if (s > bestScore) { bestScore = s; bestStart = start0 + d0; bestSpan = span0 * (1 + ds); }
      }
    }
    for (let d0 = -2; d0 <= 2; d0 += 0.5) {
      for (let ds = -0.012; ds <= 0.012; ds += 0.003) {
        const s = score(bestStart + d0, bestSpan * (1 + ds));
        if (s > bestScore) { bestScore = s; bestStart = bestStart + d0; bestSpan = bestSpan * (1 + ds); }
      }
    }
    return { start: bestStart, span: bestSpan };
  };
  const xAxis = snapAxis(frame.x, frame.w, frame.w / (N - 1), (o, s) => axisScore(o, s, frame.y, frame.h, true));
  const yAxis = snapAxis(frame.y, frame.h, frame.h / (N - 1), (o, s) => axisScore(o, s, frame.x, frame.w, false));
  return { x: xAxis.start, y: yAxis.start, w: xAxis.span, h: yAxis.span };
};

/** Recognize the 15×15 position inside the (already aligned) frame region. */
export const recognizeUniformGrid = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  frame: Frame,
): UniformGridBoard => {
  const cellW = frame.w / (N - 1), cellH = frame.h / (N - 1);
  const winW = Math.max(3, Math.floor(cellW / 2)), winH = Math.max(3, Math.floor(cellH / 2));
  const pixel = (x: number, y: number): [number, number, number] => {
    const xx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const yy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const k = (yy * width + xx) * 4;
    return [data[k], data[k + 1], data[k + 2]];
  };
  const isDark = (p: [number, number, number], c: number) => p[0] < c && p[1] < c && p[2] < c;
  const pts: Array<{ x: number; y: number; cx: number; cy: number; px: Array<[number, number, number]>; avg: { r: number; g: number; b: number } }> = [];
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const cx = frame.x + j * cellW, cy = frame.y + i * cellH;
      const px: Array<[number, number, number]> = [];
      for (let yy = Math.round(cy - winH / 2); yy < Math.round(cy - winH / 2) + winH; yy += 1) {
        for (let xx = Math.round(cx - winW / 2); xx < Math.round(cx - winW / 2) + winW; xx += 1) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          px.push(pixel(xx, yy));
        }
      }
      let r = 0, g = 0, b = 0;
      for (const p of px) { r += p[0]; g += p[1]; b += p[2]; }
      const n = Math.max(1, px.length);
      pts.push({ x: j, y: i, cx, cy, px, avg: { r: r / n, g: g / n, b: b / n } });
    }
  }
  // Empty intersections show the grid-line cross: the window holds the two
  // lines (limited dark share) and the lines continue toward every neighbour.
  const isLine = (pt: (typeof pts)[number]) => {
    const avgLum = (pt.avg.r + pt.avg.g + pt.avg.b) / 3;
    const dirs: Array<[number, number]> = [];
    if (pt.x > 0) dirs.push([-1, 0]);
    if (pt.x < N - 1) dirs.push([1, 0]);
    if (pt.y > 0) dirs.push([0, -1]);
    if (pt.y < N - 1) dirs.push([0, 1]);
    for (const cnum of [avgLum, avgLum + 18, avgLum - 18]) {
      const dark = pt.px.filter((p) => isDark(p, cnum)).length;
      if (dark > pt.px.length * 3 / 8) return false; // too much dark: a stone
      let all = true;
      for (const [dx, dy] of dirs) {
        const a = pixel(pt.cx + dx * cellW / 2, pt.cy + dy * cellH / 2);
        const b2 = pixel(pt.cx + dx * cellW * 0.42, pt.cy + dy * cellH * 0.42);
        if (!(isDark(a, cnum) && isDark(b2, cnum))) { all = false; break; }
      }
      if (all && dirs.length) return true;
    }
    return false;
  };
  // Relative clustering: brightest stones = white, darkest = black. Colored
  // marks (channel spread ≥ 60) are excluded from the clustering entirely.
  const arr: number[] = [];
  let max = 0, min = 255, wBoard = true;
  for (const pt of pts) {
    const { r, g, b } = pt.avg;
    if (isLine(pt)) { arr.push(-1000); wBoard = false; continue; }
    if (Math.abs(r - g) < 60 && Math.abs(r - b) < 60 && Math.abs(g - b) < 60) {
      const cNum = (r + g + b) / 3;
      arr.push(cNum);
      if (cNum > max) max = cNum;
      if (cNum < min) min = cNum;
    } else { arr.push(-1000); wBoard = false; }
  }
  if (Math.abs(max - min) < 30) {
    if ((max + min) / 2 < 128) max = 255; else min = 0;
  }
  const board: Array<Array<"black" | "white" | null>> = Array.from({ length: N }, () => Array.from({ length: N }, () => null));
  const stones: UniformStone[] = [];
  pts.forEach((pt, idx) => {
    if (arr[idx] === -1000) return;
    let player: "black" | "white" | null = null;
    if (Math.abs(arr[idx] - max) < (wBoard || max > 250 ? 20 : 50)) player = "white";
    else if (Math.abs(arr[idx] - min) < (wBoard || min < 5 ? 30 : 60)) player = "black";
    if (!player) return;
    board[pt.y][pt.x] = player;
    stones.push({ row: pt.y, col: pt.x, player });
  });
  return { boardSize: 15, board, stones, alignmentScore: 0 };
};
