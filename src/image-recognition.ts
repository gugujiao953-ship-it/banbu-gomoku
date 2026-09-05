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

/** Line score per row/column. A grid line is a narrow local contrast peak:
 * it may be darker than the board (wood/pale) or brighter than it
 * (circuit/aurora). Using the signed bright–dark–bright pattern made every
 * dark board fall through to the inaccurate fixed-inset fallback. A relative
 * second-difference keeps the detector exposure-independent while accepting
 * both line polarities. */
const collectLineScores = (
  gray: Float32Array,
  width: number,
  height: number,
  alongX: boolean,
  innerStart = 1,
  innerEnd?: number,
) => {
  const span = alongX ? height : width;
  const inner = alongX ? width : height;
  const start = Math.max(1, Math.floor(innerStart));
  const end = Math.min(inner - 2, Math.ceil(innerEnd ?? inner - 2));
  const scores = new Float32Array(span);
  if (end <= start) return scores;
  for (let fixed = 1; fixed < span - 1; fixed += 1) {
    let score = 0;
    for (let index = start; index <= end; index += 1) {
      const center = alongX ? gray[fixed * width + index] : gray[index * width + fixed];
      const above = alongX
        ? gray[(fixed - 1) * width + index]
        : gray[index * width + fixed - 1];
      const below = alongX
        ? gray[(fixed + 1) * width + index]
        : gray[index * width + fixed + 1];
      const contrast = Math.abs(center - (above + below) / 2);
      const neighbourDelta = Math.abs(above - below);
      // Antialiased SVG lines can be split across two pixels. The neighbour
      // guard rejects broad lighting gradients while retaining either a dark
      // or a bright one-pixel line core.
      if (contrast > 10 && neighbourDelta < 55 && contrast > neighbourDelta * 0.22) score += 1;
    }
    scores[fixed] = score;
  }
  return scores;
};

interface CombFit {
  origin: number;
  spacing: number;
  score: number;
  coverage: number;
}

const scoreQuantile = (scores: Float32Array, quantile: number) => {
  const sorted = Array.from(scores).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * quantile)))] ?? 0;
};

/** Search the original line-strength signal with a complete N-tooth comb.
 *
 * Peak grouping loses phase information when a border line is weak or hidden:
 * fourteen real lines can then be fitted as a complete board shifted by one
 * cell. Searching all origins/spacings keeps the missing fifteenth tooth in
 * the score. Support immediately before/after the proposed board is also
 * penalised, because it is usually the omitted border line of that shifted
 * candidate. */
const fitCombSeries = (
  scores: Float32Array,
  boardSize: number,
  limits: { pool: number; seeds: number; output: number } = { pool: 180, seeds: 80, output: 80 },
  spacingRange?: { minimum: number; maximum?: number },
): CombFit[] => {
  const span = scores.length;
  const baseline = scoreQuantile(scores, 0.55);
  // Do not clip at a high quantile: clipping made every strong line equal and
  // left a one-cell-shifted comb indistinguishable from the real phase. The
  // global maximum is only used to normalise contrast; proximity below keeps
  // a strong but off-centre line from receiving full support.
  const cap = Math.max(baseline + 1, Math.max(...scores));
  const scale = cap - baseline;
  const minSpacing = Math.max(5, spacingRange?.minimum ?? 5);
  const maxSpacing = Math.min(
    (span - 1) / Math.max(1, boardSize - 1),
    spacingRange?.maximum ?? Number.POSITIVE_INFINITY,
  );
  if (maxSpacing < minSpacing) return [];

  const evaluate = (origin: number, spacing: number): CombFit | null => {
    const end = origin + (boardSize - 1) * spacing;
    if (origin < 0 || end > span - 1) return null;
    const radius = Math.min(5, Math.max(1, Math.round(spacing * 0.09)));
    const supportAt = (position: number) => {
      const center = Math.round(position);
      let peak = 0;
      let peakDistance = Number.POSITIVE_INFINITY;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const index = center + offset;
        if (index < 0 || index >= span) continue;
        if (scores[index] > peak) {
          peak = scores[index];
          peakDistance = Math.abs(offset + center - position);
        }
      }
      const contrast = Math.max(0, (peak - baseline) / scale);
      const sigma = Math.max(1, radius * 0.45);
      const proximity = Math.exp(-(peakDistance * peakDistance) / (2 * sigma * sigma));
      return Math.min(1.5, contrast) * (0.25 + proximity * 0.75);
    };

    const supports = Array.from({ length: boardSize }, (_, index) => supportAt(origin + index * spacing));
    const ordered = [...supports].sort((left, right) => left - right);
    const weakCount = Math.min(4, boardSize);
    const weakSupport = ordered.slice(0, weakCount).reduce((sum, value) => sum + value, 0);
    const insideSupport = supports.reduce((sum, value) => sum + value, 0);
    const edgeSupport = supports[0] + supports[supports.length - 1];
    // Check several teeth beyond both proposed edges. In a full-screen image a
    // shifted candidate can take 12-13 genuine board lines and borrow one or
    // two UI separators to appear complete. Looking only one tooth outside did
    // not detect a two-cell phase error. A real complete board should not have
    // another strong same-period comb continuing past either edge.
    let outsideSupport = 0;
    [1, 0.72, 0.45].forEach((weight, index) => {
      const distance = index + 1;
      const beforePosition = origin - spacing * distance;
      const afterPosition = end + spacing * distance;
      if (beforePosition >= 0) outsideSupport += supportAt(beforePosition) * weight;
      if (afterPosition <= span - 1) outsideSupport += supportAt(afterPosition) * weight;
    });
    const coverage = supports.filter((value) => value >= 0.28).length / boardSize;
    // Low-tooth support differentiates 15/15 from 14/15; outside support
    // rejects the phase-shifted 14-line window. Edge weighting helps when
    // stones obscure central line pixels but the board border remains visible.
    const score = insideSupport
      + weakSupport * 0.72
      + edgeSupport * 0.32
      - outsideSupport * 1.05
      + coverage * 0.35;
    return { origin, spacing, score, coverage };
  };

  const candidates: CombFit[] = [];
  const retain = (candidate: CombFit, limit: number) => {
    const duplicate = candidates.findIndex((existing) => (
      Math.abs(existing.origin - candidate.origin) < 1.2
      && Math.abs(existing.spacing - candidate.spacing) < 0.18
    ));
    if (duplicate >= 0) {
      if (candidate.score > candidates[duplicate].score) candidates[duplicate] = candidate;
    } else {
      candidates.push(candidate);
    }
    candidates.sort((left, right) => right.score - left.score);
    if (candidates.length > limit) candidates.length = limit;
  };

  const spacingStep = Math.max(0.2, span / 1800);
  for (let spacing = minSpacing; spacing <= maxSpacing + 0.001; spacing += spacingStep) {
    const latestOrigin = span - 1 - (boardSize - 1) * spacing;
    for (let origin = 0; origin <= latestOrigin + 0.001; origin += 0.75) {
      const candidate = evaluate(origin, spacing);
      // Full-screen screenshots can contain stronger one-off UI separators
      // than the board lines. Keep a wider pool here; detectGrid will later
      // evaluate whether both axes coexist inside one coherent square window.
      if (candidate && candidate.coverage >= 0.55) retain(candidate, limits.pool);
    }
  }

  // Subpixel refinement is intentionally performed only around the strongest
  // globally searched candidates, keeping mobile import latency bounded.
  const coarse = [...candidates];
  const refined: CombFit[] = [];
  const retainRefined = (candidate: CombFit) => {
    const duplicate = refined.findIndex((existing) => (
      Math.abs(existing.origin - candidate.origin) < 0.45
      && Math.abs(existing.spacing - candidate.spacing) < 0.06
    ));
    if (duplicate >= 0) {
      if (candidate.score > refined[duplicate].score) refined[duplicate] = candidate;
    } else refined.push(candidate);
  };
  coarse.slice(0, limits.seeds).forEach((seed) => {
    for (let spacing = seed.spacing - 0.35; spacing <= seed.spacing + 0.351; spacing += 0.05) {
      for (let origin = seed.origin - 1; origin <= seed.origin + 1.001; origin += 0.1) {
        const candidate = evaluate(origin, spacing);
        if (candidate) retainRefined(candidate);
      }
    }
  });
  refined.sort((left, right) => right.score - left.score);
  return refined.slice(0, limits.output);
};

/** Evidence (0..1) that a one-pixel-wide line of the requested direction runs
 * through (x, y). A board is a two-direction mesh: at (almost) every declared
 * intersection a line of the perpendicular direction must cross. Analysis
 * tables, text baselines and stone-pattern backgrounds can imitate one axis of
 * periodic lines, but almost never a dense mesh of both directions. */
const directionalLineEvidence = (
  gray: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  alongX: boolean,
) => {
  let evidence = 0;
  for (let phase = -2; phase <= 2; phase += 1) {
    const px = alongX ? Math.round(x) + phase : Math.round(x);
    const py = alongX ? Math.round(y) : Math.round(y) + phase;
    if (px < 2 || py < 2 || px >= width - 2 || py >= height - 2) continue;
    const index = py * width + px;
    const center = gray[index];
    // Two pixels out on BOTH axes: one pixel can still sit on a 1-2px line's
    // antialiasing, which made every horizontal-line probe fail its
    // neighbour guard while the vertical probes worked.
    const sideA = alongX ? gray[index - 2] : gray[index - 2 * width];
    const sideB = alongX ? gray[index + 2] : gray[index + 2 * width];
    const contrast = Math.abs(center - (sideA + sideB) / 2);
    const neighbourDelta = Math.abs(sideA - sideB);
    if (contrast > 7 && neighbourDelta < 55) evidence = Math.max(evidence, Math.min(1, contrast / 18));
  }
  return evidence;
};

/** Evidence (0..1) that a straight line of the requested direction passes
 * through (x, y) and CONTINUES on both sides. The probes sit just off the
 * intersection and at mid-cell, and all of them must agree on one sub-pixel
 * line position: a real grid line is straight and continuous, while text,
 * tables and textured backgrounds do not keep one aligned edge across four
 * samples. Border intersections only probe inward. */
const lineThroughEvidence = (
  gray: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  alongX: boolean,
  offsets: number[],
) => {
  const fixedBase = Math.round(alongX ? x : y);
  const alongBase = Math.round(alongX ? y : x);
  const contrastAt = (px: number, py: number) => {
    if (px < 2 || py < 2 || px >= width - 2 || py >= height - 2) return 0;
    const index = py * width + px;
    const center = gray[index];
    // Two pixels out on BOTH axes: one pixel can still sit on a 1-2px line's
    // antialiasing, which made every horizontal-line probe fail its
    // neighbour guard while the vertical probes worked.
    const sideA = alongX ? gray[index - 2] : gray[index - 2 * width];
    const sideB = alongX ? gray[index + 2] : gray[index + 2 * width];
    const contrast = Math.abs(center - (sideA + sideB) / 2);
    const neighbourDelta = Math.abs(sideA - sideB);
    if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
      return Math.min(1, contrast / 16);
    }
    return 0;
  };
  let best = 0;
  for (let phase = -2; phase <= 2; phase += 1) {
    const fixed = fixedBase + phase;
    let worst = 1;
    for (const offset of offsets) {
      const along = Math.round(alongBase + offset);
      const evidence = contrastAt(alongX ? fixed : along, alongX ? along : fixed);
      if (evidence <= 0) {
        worst = 0;
        break;
      }
      if (evidence < worst) worst = evidence;
    }
    if (worst > best) best = worst;
  }
  return best;
};

/** Fraction of declared intersections where the two-direction mesh exists.
 * A stone legitimately hides its own intersection, so validity falls back to
 * a coarse stone-blob probe: diagonal disc samples against a diagonal outer
 * ring at 0.62-0.70 of the spacing (outside a full-size stone, inside the
 * cell). A real board therefore measures near 1.0 even when a third of the
 * points are occupied, while texture and one-direction table lines stay near
 * zero — and a window that only PARTIALLY overlaps the board loses whole
 * border rows at once, which the per-axis fractions expose. */
const intersectionMesh = (
  image: { gray: Float32Array; width: number; height: number; data: Uint8ClampedArray },
  originX: number,
  originY: number,
  spacingX: number,
  spacingY: number,
  boardSize: number,
  sampleStep = 1,
) => {
  const { gray, width, height } = image;
  const endX = originX + (boardSize - 1) * spacingX;
  const endY = originY + (boardSize - 1) * spacingY;
  const rowFractions = new Array<number>(boardSize).fill(-1);
  const columnFractions = new Array<number>(boardSize).fill(-1);
  if (originX < 2 || originY < 2 || endX >= width - 2 || endY >= height - 2) {
    return { support: 0, rowFractions, columnFractions };
  }
  const spacing = Math.min(spacingX, spacingY);
  const reach = Math.min(6, Math.max(3, spacing * 0.13));
  // 0.42 keeps the far probe clear of a full-size neighbour stone's rim
  // (radius up to ~0.48 of the spacing) while still demanding the line exist
  // well away from the intersection itself.
  const halfSpan = spacing * 0.42;
  // Well-aligned evidence scales with line sharpness: on small-spacing
  // screenshots (device pixel ratio 1) one-pixel lines plus stone glow cap
  // the evidence near 0.5-0.6 even at perfect phase, while large images keep
  // 0.8+. The threshold follows so misaligned windows stay excluded.
  const strictEvidence = spacing >= 32 ? 0.6 : 0.5;
  const rowHits = new Array<number>(boardSize).fill(0);
  const columnHits = new Array<number>(boardSize).fill(0);
  const rowChecks = new Array<number>(boardSize).fill(0);
  const columnChecks = new Array<number>(boardSize).fill(0);
  const discOffsets: Array<[number, number]> = [];
  const ringOffsets: Array<[number, number]> = [];
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      discOffsets.push([
        Math.round(spacing * 0.22) * signX,
        Math.round(spacing * 0.22) * signY,
      ]);
    }
    // Ring samples sit on the diagonals at 0.62-0.70 of the spacing: safely
    // outside a full-size stone (radius ≈ 0.48) yet still far from the
    // diagonal neighbours (centre distance 1.41). Tighter rings landed on the
    // stone rim and its shadow, which hid occupied intersections and made
    // stone-heavy columns look invalid.
    for (const radiusScale of [0.62, 0.7]) {
      const ringOffset = Math.round(spacing * radiusScale * 0.7071);
      for (const signY of [-1, 1]) {
        ringOffsets.push([ringOffset * signX, ringOffset * signY]);
        ringOffsets.push([ringOffset * signX, -ringOffset * signY]);
      }
    }
  }
  const readColor = (px: number, py: number): Rgb | null => {
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const index = (py * width + px) * 4;
    return [image.data[index], image.data[index + 1], image.data[index + 2]];
  };
  const stoneBlobAt = (x: number, y: number) => {
    const disc: Rgb[] = [];
    const ring: Rgb[] = [];
    for (const [dx, dy] of discOffsets) {
      const color = readColor(Math.round(x) + dx, Math.round(y) + dy);
      if (color) disc.push(color);
    }
    for (const [dx, dy] of ringOffsets) {
      const color = readColor(Math.round(x) + dx, Math.round(y) + dy);
      if (color) ring.push(color);
    }
    if (disc.length < 3 || ring.length < 6) return false;
    const medianColor = (items: Rgb[]): Rgb => [
      median(items.map((color) => color[0])),
      median(items.map((color) => color[1])),
      median(items.map((color) => color[2])),
    ];
    const discMedian = medianColor(disc);
    const ringMedian = medianColor(ring);
    const discDistance = rgbDistance(discMedian, ringMedian);
    // A stone is a COHERENT disc; high-frequency backgrounds have a large
    // spread around their own median, which otherwise validated texture rows
    // through pure noise contrast. Stroke marks (notebook checks) mix stroke
    // and board in the four disc samples, so a decisive distance stands on
    // its own and the coherence demand only guards the moderate band.
    const discSpread = median(disc.map((color) => rgbDistance(color, discMedian)));
    // Grid lines crossing an empty intersection on a dark board also create a
    // large disc-to-ring distance; a real mark sits ON the disc's diagonal
    // samples (share ≥ 0.5) while the diagonal samples of a line-only
    // intersection stay board-coloured.
    const discMarkedShare = disc.filter((color) => rgbDistance(color, ringMedian) >= 25).length / disc.length;
    return (discDistance >= 55 && discMarkedShare >= 0.5)
      || (discDistance >= 25 && discSpread <= 30);
  };
  for (let row = 0; row < boardSize; row += sampleStep) {
    const y = originY + row * spacingY;
    const verticalOffsets = row === 0
      ? [reach, halfSpan]
      : row === boardSize - 1 ? [-reach, -halfSpan] : [-reach, reach, -halfSpan, halfSpan];
    for (let col = 0; col < boardSize; col += sampleStep) {
      const x = originX + col * spacingX;
      const horizontalOffsets = col === 0
        ? [reach, halfSpan]
        : col === boardSize - 1 ? [-reach, -halfSpan] : [-reach, reach, -halfSpan, halfSpan];
      // Demands a WELL-ALIGNED line, not merely a detected one: windows cut
      // from inside a larger grid or glued to page texture drift 2-4px
      // across the board, which caps their crossing evidence well below a
      // correctly phased window's.
      const crossEvidence = Math.min(
        lineThroughEvidence(gray, width, height, x, y, true, verticalOffsets),
        lineThroughEvidence(gray, width, height, x, y, false, horizontalOffsets),
      );
      let ok = crossEvidence >= strictEvidence;
      if (!ok) ok = stoneBlobAt(x, y);
      rowChecks[row] += 1;
      columnChecks[col] += 1;
      if (ok) {
        rowHits[row] += 1;
        columnHits[col] += 1;
      }
    }
  }
  for (let index = 0; index < boardSize; index += 1) {
    rowFractions[index] = rowChecks[index] ? rowHits[index] / rowChecks[index] : -1;
    columnFractions[index] = columnChecks[index] ? columnHits[index] / columnChecks[index] : -1;
  }
  let total = 0;
  let crossed = 0;
  for (let index = 0; index < boardSize; index += 1) {
    total += rowChecks[index];
    crossed += rowHits[index];
  }
  return {
    support: total ? crossed / total : 0,
    rowFractions,
    columnFractions,
  };
};

interface GridWindowQuality {
  score: number;
  lineCoverage: number;
  continuity: number;
  spatialCoverage: number;
  fullLineShare: number;
  intersectionSupport: number;
  outerFrameShare: number;
  validRowCount: number;
  validColumnCount: number;
  rowContinuity: number;
  columnContinuity: number;
  externalContinuation: number;
  externalLineCount: number;
  strokeBeyondSides: number;
  crossAxisBalance: number;
  starSupport: number;
  borderContext: number;
  texture: number;
  colorCoherence: number;
  edgeSupport: number;
  sizeRatio: number;
}

/** Score a candidate grid only inside its own square window.
 *
 * Full phone screenshots often contain several independent stacks of lines:
 * cards, tables, toolbars and the actual board. The old detector scored every
 * line across the whole image, so a candidate could mix a board's lines with
 * UI lines and still look like a valid 15x15 comb. A real board has all of its
 * horizontal and vertical lines in the same square window, with a consistent
 * cell interior and visible outer edges. */
const scoreGridWindow = (
  image: SampledImage,
  originX: number,
  originY: number,
  spacingX: number,
  spacingY: number,
  boardSize: number,
): GridWindowQuality | null => {
  const { gray, width, height } = image;
  const endX = originX + (boardSize - 1) * spacingX;
  const endY = originY + (boardSize - 1) * spacingY;
  if (originX < 0 || originY < 0 || endX >= width || endY >= height) return null;

  const lineProfile = (fixed: number, alongX: boolean, start: number, end: number) => {
    const span = alongX ? width : height;
    const from = Math.max(1, Math.floor(start));
    const to = Math.min(span - 2, Math.ceil(end));
    if (to <= from) return { support: 0, spatial: 0 };
    let weightedHits = 0;
    let samples = 0;
    const segmentHits = new Uint16Array(Math.max(1, boardSize - 1));
    const segmentSamples = new Uint16Array(segmentHits.length);
    for (let index = from; index <= to; index += 1) {
      let evidence = 0;
      // Permit a small subpixel/antialiasing offset, but require evidence at
      // this longitudinal position. Circle rims only light up a few cells;
      // genuine grid lines continue through most cells of the board.
      for (let offset = -2; offset <= 2; offset += 1) {
        const rounded = Math.round(fixed) + offset;
        if (rounded <= 0 || rounded >= (alongX ? height : width) - 1) continue;
        const center = alongX ? gray[rounded * width + index] : gray[index * width + rounded];
        const above = alongX
          ? gray[(rounded - 1) * width + index]
          : gray[index * width + rounded - 1];
        const below = alongX
          ? gray[(rounded + 1) * width + index]
          : gray[index * width + rounded + 1];
        const contrast = Math.abs(center - (above + below) / 2);
        const neighbourDelta = Math.abs(above - below);
        if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
          evidence = Math.max(evidence, Math.min(1.5, contrast / 22));
        }
      }
      const segment = Math.min(
        segmentHits.length - 1,
        Math.max(0, Math.floor((index - from) * segmentHits.length / Math.max(1, to - from + 1))),
      );
      segmentSamples[segment] += 1;
      if (evidence > 0) segmentHits[segment] += 1;
      weightedHits += evidence;
      samples += 1;
    }
    const activeSegments = Array.from(segmentHits).filter((hits, index) => (
      hits / Math.max(1, segmentSamples[index]) >= 0.14
    )).length;
    return {
      support: samples ? weightedHits / samples : 0,
      spatial: activeSegments / segmentHits.length,
    };
  };

  const rowProfiles = Array.from({ length: boardSize }, (_, row) => (
    lineProfile(originY + row * spacingY, true, originX, endX)
  ));
  const columnProfiles = Array.from({ length: boardSize }, (_, col) => (
    lineProfile(originX + col * spacingX, false, originY, endY)
  ));
  const rowSupports = rowProfiles.map((profile) => profile.support);
  const columnSupports = columnProfiles.map((profile) => profile.support);
  const allSupports = [...rowSupports, ...columnSupports];
  const allSpatial = [...rowProfiles, ...columnProfiles].map((profile) => profile.spatial);
  const lineCoverage = allSupports.reduce((sum, value) => sum + Math.min(1, value * 3.2), 0) / allSupports.length;
  const continuity = allSupports.filter((value) => value >= 0.045).length / allSupports.length;
  // Per-axis continuity, kept separate because the comb fits of one axis can
  // be polluted by UI texture: a real board needs fifteen supported lines on
  // BOTH axes inside the same window.
  const rowContinuity = rowSupports.filter((value) => value >= 0.045).length / boardSize;
  const columnContinuity = columnSupports.filter((value) => value >= 0.045).length / boardSize;
  const spatialCoverage = allSpatial.reduce((sum, value) => sum + value, 0) / allSpatial.length;
  const fullLineShare = allSpatial.filter((value) => value >= 0.55).length / allSpatial.length;
  const mesh = intersectionMesh(image, originX, originY, spacingX, spacingY, boardSize);
  const intersectionSupport = mesh.support;
  // A window whose OUTERMOST line is the board's thick decorative frame
  // (3.5px+ of line-coloured pixels) rather than a thin grid line is anchored
  // on the frame — one row/column short of the real grid. Measured as the
  // median run of pixels differing from the board colour 6px inward.
  const outerThicknessShare = (fixed: number, from: number, to: number, alongX: boolean, inwardSign: number) => {
    let thick = 0;
    const samples = 20;
    for (let i = 0; i < samples; i += 1) {
      const along = Math.round(from + (to - from) * (i + 0.5) / samples);
      const linePos = Math.round(fixed);
      const boardPos = Math.round(fixed + inwardSign * 6);
      if (boardPos < 0 || boardPos >= (alongX ? height : width)) continue;
      const boardL = alongX ? gray[boardPos * width + along] : gray[along * width + boardPos];
      // Run measured in a ±2 window: on themes with a small frame-to-grid
      // margin a wider window catches the real grid line next to the frame
      // and flags every window; a genuine thick frame fills ±2 completely.
      let run = 0;
      for (let d = -2; d <= 2; d += 1) {
        const l = alongX
          ? gray[(linePos + d) * width + along]
          : gray[along * width + (linePos + d)];
        if (Math.abs(l - boardL) >= 30) run += 1;
      }
      if (run >= 4) thick += 1;
    }
    return thick / samples;
  };
  const outerFrameShare = Math.max(
    outerThicknessShare(originY, originX, endX, true, 1),
    outerThicknessShare(endY, originX, endX, true, -1),
    outerThicknessShare(originX, originY, endY, false, 1),
    outerThicknessShare(endX, originY, endY, false, -1),
  );
  // A window that only partially overlaps the real board keeps a decent mean
  // support but loses complete border rows at once. Requiring nearly every
  // row AND column to be mostly valid is what rejects those partial windows.
  // 0.6, not 0.5: a window that mixes real board rows with texture rows can
  // still average well, but its junk rows stay far below while a real board
  // line reaches ~1.0 (empty crossings plus stone blobs). 0.6 accommodates
  // dark-on-dark stones whose occluded crossings cap the line fraction.
  const validRowCount = mesh.rowFractions.filter((fraction) => fraction >= 0.6).length;
  const validColumnCount = mesh.columnFractions.filter((fraction) => fraction >= 0.6).length;
  const edgeSupport = Math.min(
    1,
    (rowSupports[0] + rowSupports[rowSupports.length - 1]
      + columnSupports[0] + columnSupports[columnSupports.length - 1]) / 0.32,
  );

  // Reject a grid window cut from the middle of a larger same-period grid.
  // This matters for complete phone screenshots: a candidate may use 11-13
  // genuine board lines, then borrow similarly spaced page/background edges to
  // make up the remaining teeth. Global one-dimensional comb scores cannot
  // reliably distinguish that mixture. Here every outside probe is measured
  // only across the candidate board span, so two or more continued teeth are
  // strong evidence that the proposed outer line is not the board boundary.
  const continuationStrength = (profile: { support: number; spatial: number }) => (
    Math.min(1, profile.support * 3.2) * 0.55 + profile.spatial * 0.45
  );
  const outsideSides = [
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(originY - spacingY * (index + 1), true, originX, endX)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(endY + spacingY * (index + 1), true, originX, endX)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(originX - spacingX * (index + 1), false, originY, endY)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(endX + spacingX * (index + 1), false, originY, endY)
    )),
  ];
  const outsideWeights = [1, 0.78, 0.56];
  // An outside line only counts as a board continuation when the perpendicular
  // mesh continues through it. Noise backgrounds (stone-texture wallpaper) and
  // one-directional table separators otherwise look like continuation lines:
  // on the second user screenshot that false positive rejected the real board
  // while the true mesh evidence was discarded.
  const outsideCrossings = outsideSides.map((profiles, sideIndex) => profiles.map((profile, lineIndex) => {
    if (!profile.spatial && !profile.support) return 0;
    const alongX = sideIndex < 2;
    const fixed = sideIndex === 0 ? originY - spacingY * (lineIndex + 1)
      : sideIndex === 1 ? endY + spacingY * (lineIndex + 1)
        : sideIndex === 2 ? originX - spacingX * (lineIndex + 1)
          : endX + spacingX * (lineIndex + 1);
    // Strict continuation probe: the perpendicular line must pass through the
    // outside line AND continue half a cell beyond it on both sides. Texture
    // and page separators cannot satisfy the aligned multi-probe test.
    const meshReach = Math.min(6, Math.max(3, Math.min(spacingX, spacingY) * 0.13));
    const meshHalf = Math.min(spacingX, spacingY) * 0.42;
    let sum = 0;
    for (let index = 0; index < boardSize; index += 1) {
      const along = alongX ? originX + index * spacingX : originY + index * spacingY;
      sum += lineThroughEvidence(
        gray,
        width,
        height,
        alongX ? along : fixed,
        alongX ? fixed : along,
        alongX,
        [-meshReach, meshReach, -meshHalf, meshHalf],
      );
    }
    return sum / boardSize;
  }));
  const continuationMeshWeight = (crossing: number) => 0.22 + 0.78 * Math.min(1, crossing * 1.6);
  const outsideSideScores = outsideSides.map((profiles, sideIndex) => (
    profiles.reduce((sum, profile, index) => (
      sum + continuationStrength(profile) * outsideWeights[index] * continuationMeshWeight(outsideCrossings[sideIndex][index])
    ), 0) / outsideWeights.reduce((sum, value) => sum + value, 0)
  ));
  const outsideStrongCounts = outsideSides.map((profiles, sideIndex) => profiles.filter((profile, index) => (
    profile.support >= 0.045
    && profile.spatial >= 0.42
    && continuationStrength(profile) >= 0.34
    && outsideCrossings[sideIndex][index] >= 0.4
  )).length);
  const externalContinuation = Math.max(...outsideSideScores);
  const externalLineCount = Math.max(...outsideStrongCounts);

  // A board's strokes run about half a cell past the outer intersection line
  // and then stop. When the perpendicular strokes still survive 0.9 spacing
  // beyond a candidate's outer line, that line sits INSIDE the real board:
  // the window borrowed a margin or frame line as its edge, shifting every
  // intersection by one row/column. Measured as the share of intersections
  // whose stroke evidence survives at the 0.9 probe — frame edges and page
  // texture carry no perpendicular strokes there, so they stay silent. Soft
  // score penalty, never a gate: dense backgrounds can legitimately echo it.
  const strokeBeyondShare = (probe: number, from: number, to: number, alongX: boolean) => {
    const span = alongX ? height : width;
    if (probe < 2 || probe > span - 3) return 0;
    let hits = 0;
    for (let index = 0; index < boardSize; index += 1) {
      const along = Math.round(alongX ? originX + index * spacingX : originY + index * spacingY);
      let best = 0;
      for (let phase = -1; phase <= 1; phase += 1) {
        const fixed = Math.round(probe) + phase;
        const px = alongX ? along : fixed;
        const py = alongX ? fixed : along;
        if (px < 2 || px >= width - 2 || py < 2 || py >= height - 2) continue;
        const center = gray[py * width + px];
        const sideA = alongX ? gray[py * width + px - 2] : gray[(py - 2) * width + px];
        const sideB = alongX ? gray[py * width + px + 2] : gray[(py + 2) * width + px];
        const contrast = Math.abs(center - (sideA + sideB) / 2);
        const neighbourDelta = Math.abs(sideA - sideB);
        if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
          best = Math.max(best, 1);
        }
      }
      hits += best;
    }
    return hits / boardSize;
  };
  const strokeBeyondSides = Math.round(
    (strokeBeyondShare(originY - spacingY * 0.9, originX, endX, true) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(endY + spacingY * 0.9, originX, endX, true) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(originX - spacingX * 0.9, originY, endY, false) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(endX + spacingX * 0.9, originY, endY, false) >= 0.6 ? 1 : 0),
  );

  // Sample cell interiors rather than intersections. Stones occupy the
  // intersections, while a board's cell background remains comparatively
  // coherent even when the board has wood grain or a light texture. UI cards
  // and analysis tables tend to have much higher local variation.
  const interiorSamples: number[] = [];
  const interiorColors: Rgb[] = [];
  for (let row = 0; row < boardSize - 1; row += 2) {
    for (let col = 0; col < boardSize - 1; col += 2) {
      const x = Math.round(originX + (col + 0.5) * spacingX);
      const y = Math.round(originY + (row + 0.5) * spacingY);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      interiorSamples.push(gray[index]);
      interiorColors.push([image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]]);
    }
  }
  const interiorMedian = median(interiorSamples);
  const interiorMad = interiorSamples.length
    ? median(interiorSamples.map((value) => Math.abs(value - interiorMedian)))
    : 255;
  const texture = Math.max(0, Math.min(1, 1 - interiorMad / 52));
  const interiorColor: Rgb = interiorColors.length
    ? [
        median(interiorColors.map((color) => color[0])),
        median(interiorColors.map((color) => color[1])),
        median(interiorColors.map((color) => color[2])),
      ]
    : [0, 0, 0];
  const colorDistanceMedian = interiorColors.length
    ? median(interiorColors.map((color) => rgbDistance(color, interiorColor)))
    : 255;
  const coherentColors = interiorColors.filter((color) => rgbDistance(color, interiorColor) <= 42).length;
  const colorCoherence = interiorColors.length
    ? Math.max(0, Math.min(1, coherentColors / interiorColors.length - colorDistanceMedian / 180))
    : 0;
  const sampleColor = (x: number, y: number): Rgb | null => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const index = py * width + px;
    return [image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]];
  };
  const sideColors: Rgb[][] = [[], [], [], []];
  for (let index = 0; index < boardSize - 1; index += 2) {
    const x = originX + (index + 0.5) * spacingX;
    const y = originY + (index + 0.5) * spacingY;
    const samples = [
      sampleColor(x, originY - spacingY * 0.48),
      sampleColor(x, endY + spacingY * 0.48),
      sampleColor(originX - spacingX * 0.48, y),
      sampleColor(endX + spacingX * 0.48, y),
    ];
    samples.forEach((color, side) => {
      if (color) sideColors[side].push(color);
    });
  }
  const sideMedian = (colors: Rgb[]): Rgb => colors.length
    ? [
        median(colors.map((color) => color[0])),
        median(colors.map((color) => color[1])),
        median(colors.map((color) => color[2])),
      ]
    : interiorColor;
  const sideScores = sideColors.map((colors) => (
    Math.max(0, Math.min(1, 1 - rgbDistance(sideMedian(colors), interiorColor) / 95))
  ));
  // A real board normally includes a margin or frame just outside all four
  // outer grid lines. A shifted comb may still use 13 genuine lines, but one
  // outside side then lands in the app/page background and differs sharply.
  const borderContext = median(sideScores);
  const sizeRatio = Math.max(0, Math.min(1, Math.min(
    ((boardSize - 1) * spacingX) / width,
    ((boardSize - 1) * spacingY) / height,
  )));
  const horizontalSlack = Math.max(1, width - (endX - originX));
  const verticalSlack = Math.max(1, height - (endY - originY));
  const horizontalBalance = Math.max(0, Math.min(1,
    1 - Math.abs(originX - (width - endX)) / horizontalSlack,
  ));
  const verticalBalance = Math.max(0, Math.min(1,
    1 - Math.abs(originY - (height - endY)) / verticalSlack,
  ));
  // On portrait phone screenshots the board is normally centred across the
  // screen width but intentionally not centred vertically because controls sit
  // above/below it. Landscape screenshots use the analogous vertical axis.
  const crossAxisBalance = width <= height ? horizontalBalance : verticalBalance;
  const patchLight = (cx: number, cy: number, radius: number) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    let total = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        total += gray[y * width + x];
        count += 1;
      }
    }
    return count ? total / count : 0;
  };
  const starInset = boardSize >= 13 ? 3 : Math.max(1, Math.floor(boardSize / 4));
  const starFar = boardSize - 1 - starInset;
  const starMiddle = Math.floor(boardSize / 2);
  const starPoints = [
    [starInset, starInset],
    [starInset, starFar],
    [starMiddle, starMiddle],
    [starFar, starInset],
    [starFar, starFar],
  ];
  const starScores = starPoints.map(([row, col]) => {
    const x = originX + col * spacingX;
    const y = originY + row * spacingY;
    const radius = Math.max(1.5, Math.min(spacingX, spacingY) * 0.1);
    const center = patchLight(x, y, radius);
    const offsetX = spacingX * 0.24;
    const offsetY = spacingY * 0.24;
    const surroundings = [
      patchLight(x - offsetX, y - offsetY, radius),
      patchLight(x + offsetX, y - offsetY, radius),
      patchLight(x - offsetX, y + offsetY, radius),
      patchLight(x + offsetX, y + offsetY, radius),
    ];
    const background = median(surroundings);
    // Star dots are normally dark, but some themes use bright or coloured
    // dots. Absolute local contrast also treats an occupied star as valid.
    return Math.max(0, Math.min(1, (Math.abs(center - background) - 7) / 32));
  });
  const starSupport = starScores.reduce((sum, value) => sum + value, 0) / starScores.length;

  return {
    // Window-local structure is deliberately dominant. The intersection mesh
    // is the strongest single discriminator between a real board and periodic
    // page texture, so it outranks every purely one-dimensional evidence.
    // Same-period lines beyond an edge are NOT penalised: high-frequency
    // backgrounds contain aligned thin lines that rival real continuation, so
    // the penalty only punished boards sitting next to such texture while
    // shifted windows (surrounded by the board itself) escaped it. The
    // strict per-axis validity gates carry the anti-shift job instead.
    score: lineCoverage * 20
      + continuity * 12
      + spatialCoverage * 58
      + fullLineShare * 32
      + crossAxisBalance * 52
      + intersectionSupport * 85
      + starSupport * 18
      + borderContext * 26
      + edgeSupport * 12
      + texture * 8
      + colorCoherence * 54
      + sizeRatio * 18,
    lineCoverage,
    continuity,
    spatialCoverage,
    fullLineShare,
    intersectionSupport,
    outerFrameShare,
    validRowCount,
    validColumnCount,
    rowContinuity,
    columnContinuity,
    externalContinuation,
    externalLineCount,
    strokeBeyondSides,
    crossAxisBalance,
    starSupport,
    borderContext,
    texture,
    colorCoherence,
    edgeSupport,
    sizeRatio,
  };
};

/** Locate the grid directly from complete row/column combs. Pairing the two
 * axes is part of the fit so a decorative repeated pattern on one axis cannot
 * win unless its spacing agrees with the actual square grid on the other. */
const detectGrid = (image: SampledImage, boardSize: number): GridEstimate | null => {
  const { gray, width: side, height } = image;
  // A readable board screenshot never shows a fifteen-tooth comb narrower than
  // ~1.5% of the image width per cell; anything below that is text baselines
  // or icon rows. The floor keeps dense UI texture out of the global candidate
  // pools, where it previously outranked the real board rows.
  const globalMinSpacing = Math.max(5, side * 0.015);
  const rowFits = fitCombSeries(collectLineScores(gray, side, height, true), boardSize, undefined, { minimum: globalMinSpacing });
  const columnFits = fitCombSeries(collectLineScores(gray, side, height, false), boardSize, undefined, { minimum: globalMinSpacing });
  const debug = (globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__;
  if (debug) console.info("[banbu-image-fits]", JSON.stringify({
    rows: rowFits.slice(0, 5),
    columns: columnFits.slice(0, 5),
  }));
  if (debug && columnFits.length) {
    const column = columnFits[0];
    const spanY = (boardSize - 1) * column.spacing;
    const phaseSamples = Array.from({ length: Math.max(0, Math.floor((height - spanY) / column.spacing) + 1) }, (_, index) => {
      const originY = index * column.spacing;
      return {
        originY,
        quality: scoreGridWindow(image, column.origin, originY, column.spacing, column.spacing, boardSize),
      };
    })
      .filter((item) => item.originY >= side * 0.2 && item.originY <= height - spanY)
      .sort((left, right) => (right.quality?.score ?? -1) - (left.quality?.score ?? -1))
      .slice(0, 12);
    console.info("[banbu-image-phases]", JSON.stringify(phaseSamples));
  }
  let best: { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null = null;
  let cleanBest: { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null = null;
  // Debug-only rejection ledger: when nothing passes, this explains which
  // hard gate killed the strongest candidates, in evaluation order.
  const rejected: Array<Record<string, unknown>> = [];
  const consider = (row: CombFit, column: CombFit, localBonus = 0): string[] | null => {
    const spacingRatio = Math.min(row.spacing, column.spacing) / Math.max(row.spacing, column.spacing);
    if (spacingRatio < 0.92) return ["spacingRatio"];
    const mismatchPenalty = (1 - spacingRatio) * boardSize * 2.4;
    const window = scoreGridWindow(
      image,
      column.origin,
      row.origin,
      column.spacing,
      row.spacing,
      boardSize,
    );
    if (!window) return ["outOfBounds"];
    const failures: string[] = [];
    if (window.continuity < 0.55) failures.push("continuity");
    if (window.lineCoverage < 0.12) failures.push("lineCoverage");
    if (window.spatialCoverage < 0.3) failures.push("spatialCoverage");
    if (window.fullLineShare < 0.35) failures.push("fullLineShare");
    if (window.colorCoherence < 0.36) failures.push("colorCoherence");
    if (window.borderContext < 0.38) failures.push("borderContext");
    if (window.intersectionSupport < 0.55) failures.push("intersectionSupport");
    if (window.outerFrameShare >= 0.5) failures.push("outerFrame");
    if (window.validRowCount < boardSize - 1) failures.push("validRowCount");
    if (window.validColumnCount < boardSize - 1) failures.push("validColumnCount");
    if (window.rowContinuity < 0.68) failures.push("rowContinuity");
    if (window.columnContinuity < 0.68) failures.push("columnContinuity");
    // Continuation of same-period lines beyond an edge is only a soft penalty,
    // not a hard gate: high-frequency backgrounds (stone walls, dense tables)
    // genuinely contain aligned thin lines that pass even the strict mesh
    // probe. The intersection validity gates above already reject windows cut
    // from inside a larger grid far more reliably.
    if (window.sizeRatio >= 0.72 && window.crossAxisBalance < 0.42) failures.push("crossAxisBalance");
    if (failures.length) {
      const record = {
        x: Math.round(column.origin * 10) / 10,
        y: Math.round(row.origin * 10) / 10,
        sx: Math.round(column.spacing * 100) / 100,
        failed: failures,
        mesh: Math.round(window.intersectionSupport * 1000) / 1000,
        rowsValid: window.validRowCount,
        colsValid: window.validColumnCount,
        rowCont: Math.round(window.rowContinuity * 1000) / 1000,
        colCont: Math.round(window.columnContinuity * 1000) / 1000,
        score: Math.round(window.score * 10) / 10,
      };
      if (rejected.length < 48) rejected.push(record);
      else {
        let weakest = 0;
        for (let index = 1; index < rejected.length; index += 1) {
          if ((rejected[index].score as number) < (rejected[weakest].score as number)) weakest = index;
        }
        if ((record.score as number) > (rejected[weakest].score as number)) rejected[weakest] = record;
      }
      return failures;
    }
    const pairedScore = window.score
      + (row.score + column.score) * 0.035
      + localBonus
      - mismatchPenalty;
    if (!best || pairedScore > best.score) best = { row, column, score: pairedScore, window };
    if (window.strokeBeyondSides === 0
      && (!cleanBest || pairedScore > cleanBest.score)) {
      cleanBest = { row, column, score: pairedScore, window };
    }
    return null;
  };

  // First consider pairs found across the complete image. This is the fast and
  // accurate path for already-cropped board images.
  for (const row of rowFits.slice(0, 36)) {
    for (const column of columnFits.slice(0, 36)) consider(row, column);
  }

  // For full-screen UI screenshots, one global axis is often correct while the
  // other is polluted by toolbar/card/table lines. Lock the reliable axis,
  // restrict the perpendicular scan to that square, and fit the missing axis
  // again. Thus both combs must belong to the same physical board region.
  const localLimits = { pool: 48, seeds: 20, output: 16 };
  for (const column of columnFits.slice(0, 12)) {
    const startX = column.origin - column.spacing * 0.35;
    const endX = column.origin + (boardSize - 1) * column.spacing + column.spacing * 0.35;
    const localRows = fitCombSeries(
      collectLineScores(gray, side, height, true, startX, endX),
      boardSize,
      localLimits,
      { minimum: column.spacing * 0.88, maximum: column.spacing * 1.12 },
    );
    localRows.forEach((row) => consider(row, column, 4));
  }
  for (const row of rowFits.slice(0, 12)) {
    const startY = row.origin - row.spacing * 0.35;
    const endY = row.origin + (boardSize - 1) * row.spacing + row.spacing * 0.35;
    const localColumns = fitCombSeries(
      collectLineScores(gray, side, height, false, startY, endY),
      boardSize,
      localLimits,
      { minimum: row.spacing * 0.88, maximum: row.spacing * 1.12 },
    );
    localColumns.forEach((column) => consider(row, column, 4));
  }

  // The one-dimensional comb score cannot separate the board's own rows from
  // stronger periodic UI texture (analysis tables, text baselines) sharing the
  // same spacing, so a correct row comb may never reach the candidate pools at
  // all. Instead of trusting those rankings, enumerate row phases directly
  // from the most trusted column combs (and vice versa) and pre-filter them
  // with cheap two-direction mesh evidence: only the real board has a dense
  // intersection mesh, texture and tables stay near zero.
  const enumeratePhases = (fixed: CombFit, alongRows: boolean) => {
    const span = (boardSize - 1) * fixed.spacing;
    const bound = alongRows ? height : side;
    const step = Math.max(2, fixed.spacing * 0.055);
    const phases: Array<{ origin: number; mesh: number }> = [];
    for (let origin = 0; origin <= bound - span + 0.001; origin += step) {
      const mesh = alongRows
        ? intersectionMesh(image, fixed.origin, origin, fixed.spacing, fixed.spacing, boardSize, 2)
        : intersectionMesh(image, origin, fixed.origin, fixed.spacing, fixed.spacing, boardSize, 2);
      phases.push({ origin, mesh: mesh.support });
    }
    phases.sort((left, right) => right.mesh - left.mesh);
    const kept: Array<{ origin: number; mesh: number }> = [];
    for (const phase of phases) {
      if (kept.some((item) => Math.abs(item.origin - phase.origin) < fixed.spacing * 0.5)) continue;
      kept.push(phase);
      if (kept.length >= 4) break;
    }
    // The enumeration step reaches 2px, which at small spacings costs enough
    // subpixel alignment to drop borderline rows or columns below the strict
    // validity threshold. Polish each kept phase over ±1px and pick by the
    // FULL window score: raw mesh support is bistable at the subpixel level
    // (a 0.5px phase move flips borderline rows), while the window score
    // integrates every piece of evidence and ranks stably.
    for (let index = 0; index < kept.length; index += 1) {
      let best = kept[index];
      let bestScore = scoreGridWindow(
        image,
        alongRows ? fixed.origin : kept[index].origin,
        alongRows ? kept[index].origin : fixed.origin,
        fixed.spacing,
        fixed.spacing,
        boardSize,
      )?.score ?? -1;
      for (const delta of [-1, -0.5, 0.5, 1]) {
        const origin = kept[index].origin + delta;
        if (origin < 0 || origin > bound - span) continue;
        const score = scoreGridWindow(
          image,
          alongRows ? fixed.origin : origin,
          alongRows ? origin : fixed.origin,
          fixed.spacing,
          fixed.spacing,
          boardSize,
        )?.score ?? -1;
        if (score > bestScore) {
          bestScore = score;
          best = { origin, mesh: kept[index].mesh };
        }
      }
      kept[index] = best;
    }
    if (debug) {
      console.info("[banbu-image-mesh]", JSON.stringify({
        alongRows,
        fixedOrigin: fixed.origin,
        spacing: fixed.spacing,
        kept,
      }));
    }
    return kept;
  };
  // Faint-line boards (minimal/pale materials, heavy glow) can fail the
  // one-dimensional comb fit entirely, leaving only junk seeds and mesh
  // scores of zero. Geometric square seeds — a centred, near-full-width
  // board — do not depend on any comb being found: they cover the realistic
  // lattice directly and still need real mesh evidence to pass.
  const geometricSeeds: CombFit[] = [];
  if (height >= side * 1.15) {
    for (const spanRatio of [0.84, 0.88, 0.92, 0.96]) {
      const span = side * spanRatio;
      geometricSeeds.push({
        origin: (side - span) / 2,
        spacing: span / (boardSize - 1),
        score: 0,
        coverage: 0.75,
      });
    }
  }
  for (const column of [...columnFits.slice(0, 3), ...geometricSeeds]) {
    for (const phase of enumeratePhases(column, true)) {
      if (phase.mesh < 0.3) break;
      const failures = consider({ origin: phase.origin, spacing: column.spacing, score: 0, coverage: 1 }, column, 6);
      if (debug) {
        const meshFull = intersectionMesh(image, column.origin, phase.origin, column.spacing, column.spacing, boardSize);
        console.info("[banbu-image-phase-window]", JSON.stringify({
          y: Math.round(phase.origin * 10) / 10,
          x: Math.round(column.origin * 10) / 10,
          mesh: Math.round(phase.mesh * 1000) / 1000,
          failures,
          rows: meshFull.rowFractions.map((fraction) => Math.round(fraction * 100) / 100),
          cols: meshFull.columnFractions.map((fraction) => Math.round(fraction * 100) / 100),
        }));
        const windowFull = scoreGridWindow(image, column.origin, phase.origin, column.spacing, column.spacing, boardSize);
        if (windowFull) {
          console.info("[banbu-image-phase-scores]", JSON.stringify({
            y: Math.round(phase.origin * 10) / 10,
            extLine: windowFull.externalLineCount,
            extCont: Math.round(windowFull.externalContinuation * 1000) / 1000,
            border: Math.round(windowFull.borderContext * 1000) / 1000,
            star: Math.round(windowFull.starSupport * 1000) / 1000,
            score: Math.round(windowFull.score * 10) / 10,
          }));
        }
      }
    }
  }
  for (const row of rowFits.slice(0, 3)) {
    for (const phase of enumeratePhases(row, false)) {
      if (phase.mesh < 0.3) break;
      consider(row, { origin: phase.origin, spacing: row.spacing, score: 0, coverage: 1 }, 6);
    }
  }

  // Mobile screenshots usually show the board as a large, horizontally
  // centred square while controls occupy the space above/below it. When the
  // global detector is confused by those controls, seed several realistic
  // full-width board spans, find the horizontal comb inside each span, then
  // refine both axes inside the resulting square. These are only geometric
  // seeds: they cannot win unless real grid lines validate the complete area.
  if (height >= side * 1.15) {
    const screenLimits = { pool: 32, seeds: 12, output: 10 };
    for (const spanRatio of [0.84, 0.87, 0.9, 0.93]) {
      const span = side * spanRatio;
      const spacing = span / (boardSize - 1);
      const origin = (side - span) / 2;
      const seededColumn: CombFit = { origin, spacing, score: 0, coverage: 0.75 };
      const localRows = fitCombSeries(
        collectLineScores(gray, side, height, true, origin, origin + span),
        boardSize,
        screenLimits,
        { minimum: spacing * 0.88, maximum: spacing * 1.12 },
      );
      for (const row of localRows.slice(0, 6)) {
        const startY = row.origin - row.spacing * 0.35;
        const endY = row.origin + (boardSize - 1) * row.spacing + row.spacing * 0.35;
        const refinedColumns = fitCombSeries(
          collectLineScores(gray, side, height, false, startY, endY),
          boardSize,
          screenLimits,
          { minimum: row.spacing * 0.88, maximum: row.spacing * 1.12 },
        );
        // Also retain the centred seed when vertical grid lines are faint; the
        // window scorer still requires distributed line evidence on both axes.
        consider(row, seededColumn, 5);
        refinedColumns.slice(0, 8).forEach((column) => consider(row, column, 8));
      }
    }
  }
  // A borrowed-edge winner (strokes still running 0.9 cells past an outer
  // line) has anchored one row/column off the real board and borrowed a
  // margin or frame line. When an unborrowed candidate scored within 10
  // points — the decoys and the true board tie inside that window — prefer
  // the clean one. Deliberately a selection tie-break, never a score term or
  // gate: photo texture (wood grain, page rules) can fire the beyond-probe on
  // a correct window, and reordering every candidate by it broke real-photo
  // recognition while a near-tie swap only arbitrates the anchored decoys.
  type GridCandidate = { row: CombFit; column: CombFit; score: number; window: GridWindowQuality };
  if (best && (best as GridCandidate).window.strokeBeyondSides > 0
    && cleanBest && (cleanBest as GridCandidate).score >= (best as GridCandidate).score - 10) {
    best = cleanBest;
  }
  // TypeScript does not track assignments performed inside consider() across
  // the callback-based local searches above, so retain the explicit runtime
  // union here instead of allowing it to narrow the value to never.
  const selected = best as { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null;
  if (debug && rejected.length) {
    console.info("[banbu-image-rejected]", JSON.stringify(rejected.slice(0, 48)));
  }
  if (debug && selected) {
    const w = selected.window;
    console.info("[banbu-image-selected]", JSON.stringify({
      score: Math.round(selected.score * 10) / 10,
      mesh: Math.round(w.intersectionSupport * 1000) / 1000,
      extLine: w.externalLineCount,
      extCont: Math.round(w.externalContinuation * 1000) / 1000,
      borrowed: w.strokeBeyondSides,
      border: Math.round(w.borderContext * 1000) / 1000,
      star: Math.round(w.starSupport * 1000) / 1000,
      texture: Math.round(w.texture * 1000) / 1000,
      color: Math.round(w.colorCoherence * 1000) / 1000,
      spatial: Math.round(w.spatialCoverage * 1000) / 1000,
      lineCov: Math.round(w.lineCoverage * 1000) / 1000,
      full: Math.round(w.fullLineShare * 1000) / 1000,
      x: Math.round(selected.column.origin * 10) / 10,
      y: Math.round(selected.row.origin * 10) / 10,
    }));
  }
  // Phase-seeded combs carry no honest one-dimensional coverage, so validate
  // the selected window by its measured per-axis evidence instead.
  if (!selected
    || selected.window.rowContinuity < 0.68
    || selected.window.columnContinuity < 0.68
    || selected.window.validRowCount < boardSize - 1
    || selected.window.validColumnCount < boardSize - 1) return null;
  return {
    originX: selected.column.origin,
    originY: selected.row.origin,
    spacingX: selected.column.spacing,
    spacingY: selected.row.spacing,
    quality: Math.min(
      1,
      Math.min(selected.window.rowContinuity, selected.window.columnContinuity) * 0.7
        + selected.window.continuity * 0.3,
    ),
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

type Rgb = [number, number, number];

interface IntersectionFeatures {
  stoneLike: boolean;
  markerLike: boolean;
  score: number;
  foregroundLight: number;
  foregroundColor: Rgb;
  backgroundLight: number;
  // Diagnostics for threshold tuning (surfaced only through the debug flag):
  // shape coverages per radial band plus the local decision thresholds.
  coreShare: number;
  middleShare: number;
  outerShare: number;
  discShare: number;
  ringShare: number;
  diagonalShare: number;
  foregroundSaturation: number;
  foregroundDarkColor: Rgb;
  differenceThreshold: number;
  backgroundSpread: number;
  voidShare: number;
  voidMedian: Rgb;
  voidSpread: number;
  stubCount: number;
  darkDiscShare: number;
  darkBelowShare: number;
  discCoreSpread: number;
  discCoreDistance: number;
  discRawFillShare: number;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const rgbDistance = (left: Rgb, right: Rgb) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

/**
 * Classify one grid intersection from its local structure instead of global
 * black/white thresholds. The diagonal annulus is just outside a normal
 * Gomoku stone and therefore estimates the board colour at this exact point,
 * even on gradient, dark or strongly coloured boards. A real stone changes a
 * broad part of the outer disc; grid lines, star points and board labels only
 * change a narrow centre stroke. This also recognises non-round notebook
 * crosses/checks because their ink reaches the outer band.
 */
const analyzeIntersection = (image: SampledImage, x: number, y: number, spacing: number): IntersectionFeatures => {
  const { data, gray, width, height } = image;
  const safeSpacing = Math.max(10, spacing);
  const sampleRadius = safeSpacing * 0.68;
  const left = Math.max(0, Math.floor(x - sampleRadius));
  const top = Math.max(0, Math.floor(y - sampleRadius));
  const right = Math.min(width - 1, Math.ceil(x + sampleRadius));
  const bottom = Math.min(height - 1, Math.ceil(y + sampleRadius));
  const backgroundPixels: Rgb[] = [];
  const discPixels: Array<{ radius: number; dx: number; dy: number; rgb: Rgb; light: number }> = [];
  const ringPixels: Array<{ dx: number; dy: number; radius: number; rgb: Rgb; light: number }> = [];

  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = (px + 0.5 - x) / safeSpacing;
      const dy = (py + 0.5 - y) / safeSpacing;
      const radius = Math.hypot(dx, dy);
      const index = py * width + px;
      const rgb: Rgb = [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
      // Avoid the horizontal/vertical grid lines when learning the local
      // board colour. Diagonal samples also stay clear of adjacent stones.
      if (radius >= 0.48 && radius <= 0.66 && Math.abs(dx) > 0.16 && Math.abs(dy) > 0.16) {
        backgroundPixels.push(rgb);
      }
      if (radius <= 0.48) discPixels.push({ radius, dx, dy, rgb, light: gray[index] });
      if (radius >= 0.36 && radius <= 0.58 && Math.abs(dx) > 0.12 && Math.abs(dy) > 0.12) {
        ringPixels.push({ dx, dy, radius, rgb, light: gray[index] });
      }
    }
  }

  if (backgroundPixels.length < 8 || discPixels.length < 20) {
    return {
      stoneLike: false,
      markerLike: false,
      score: 0,
      foregroundLight: 0,
      foregroundColor: [0, 0, 0],
      backgroundLight: 0,
      coreShare: 0,
      middleShare: 0,
      outerShare: 0,
      discShare: 0,
      ringShare: 0,
      diagonalShare: 0,
      foregroundSaturation: 0,
      foregroundDarkColor: [0, 0, 0] as Rgb,
      differenceThreshold: 0,
      backgroundSpread: 0,
      voidShare: 0,
      voidMedian: [0, 0, 0] as Rgb,
      voidSpread: 0,
      stubCount: 0,
      darkDiscShare: 0,
      darkBelowShare: 0,
      discCoreSpread: 0,
      discCoreDistance: 0,
      discRawFillShare: 0,
    };
  }

  const background: Rgb = [
    median(backgroundPixels.map((pixel) => pixel[0])),
    median(backgroundPixels.map((pixel) => pixel[1])),
    median(backgroundPixels.map((pixel) => pixel[2])),
  ];
  const backgroundSpread = median(backgroundPixels.map((pixel) => rgbDistance(pixel, background)));
  // Raw (threshold-free) statistics of the intersection's inner disc. The
  // adaptive change threshold is texture-driven and can exceed the contrast of
  // a subtle real stone; these medians see the fill colour directly. The core
  // band stays inside the fill (r<0.16) so outline strokes cannot pollute the
  // median, and the raw fill share demands stone-sized coverage so small solid
  // badges (move-number dots) never qualify.
  const corePixels = discPixels.filter((pixel) => pixel.radius < 0.16);
  const discCoreMedian: Rgb = corePixels.length >= 4
    ? [
        median(corePixels.map((pixel) => pixel.rgb[0])),
        median(corePixels.map((pixel) => pixel.rgb[1])),
        median(corePixels.map((pixel) => pixel.rgb[2])),
      ]
    : background;
  const discCoreSpread = corePixels.length >= 4
    ? median(corePixels.map((pixel) => rgbDistance(pixel.rgb, discCoreMedian)))
    : 0;
  const discCoreDistance = rgbDistance(discCoreMedian, background);
  const discPixelsFull = discPixels.filter((pixel) => pixel.radius < 0.43);
  const discRawFillShare = discPixelsFull.length
    ? discPixelsFull.filter((pixel) => rgbDistance(pixel.rgb, background) >= 22).length
      / discPixelsFull.length
    : 0;
  // 22 filters antialiased grid lines. The adaptive part tolerates textured
  // boards and camera noise without letting a noisy background become a stone.
  const differenceThreshold = Math.min(66, Math.max(22, backgroundSpread * 2.6 + 10));
  const changed = discPixels.map((pixel) => ({ ...pixel, changed: rgbDistance(pixel.rgb, background) > differenceThreshold }));
  const changedRing = ringPixels.map((pixel) => ({
    ...pixel,
    changed: rgbDistance(pixel.rgb, background) > differenceThreshold,
  }));
  // Diagonal samples one half-cell BEYOND a full-size stone: a real stone
  // ends near 0.48 of the spacing, so this band shows plain board, while the
  // interior of a sprawling light overlay (the victory banner pill) is still
  // overlay colour clear out to here and beyond.
  const voidPixels: Array<{ rgb: Rgb; changed: boolean }> = [];
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = (px + 0.5 - x) / safeSpacing;
      const dy = (py + 0.5 - y) / safeSpacing;
      const radius = Math.hypot(dx, dy);
      if (radius >= 0.55 && radius <= 0.72 && Math.abs(dx) > 0.2 && Math.abs(dy) > 0.2) {
        const index = py * width + px;
        voidPixels.push({
          rgb: [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]],
          changed: false,
        });
        voidPixels[voidPixels.length - 1].changed =
          rgbDistance(voidPixels[voidPixels.length - 1].rgb, background) > differenceThreshold;
      }
    }
  }
  const voidShare = voidPixels.length
    ? voidPixels.filter((pixel) => pixel.changed).length / voidPixels.length
    : 0;
  // Fraction of the disc clearly DARKER than the local board (40+ luminance).
  // A dark stone under a bright overlay keeps a large dark share; the body of
  // a bright overlay itself has none, whatever the board tone is.
  const darkThreshold = luminance(background[0], background[1], background[2]) - 40;
  const darkDiscPixels = discPixels.filter((pixel) => pixel.light < darkThreshold);
  const darkDiscShare = discPixels.length
    ? darkDiscPixels.length / discPixels.length
    : 0;
  // Dark pixels huddled on ONE side of the disc (the pill's drop shadow sits
  // below it) instead of around the centre (a real dark stone).
  const darkBelowShare = darkDiscPixels.length
    ? darkDiscPixels.filter((pixel) => pixel.dy > 0.1).length / darkDiscPixels.length
    : 0;
  const voidMedian: Rgb = voidPixels.length
    ? [
        median(voidPixels.map((pixel) => pixel.rgb[0])),
        median(voidPixels.map((pixel) => pixel.rgb[1])),
        median(voidPixels.map((pixel) => pixel.rgb[2])),
      ]
    : [0, 0, 0];
  const voidSpread = voidPixels.length
    ? median(voidPixels.map((pixel) => rgbDistance(pixel.rgb, voidMedian)))
    : 0;
  // Grid-line stubs: a real stone interrupts the grid but the lines re-emerge
  // just outside its rim along the board axes (off-board axes are skipped).
  // Overlay elements floating ON the board — the victory pill and its badge —
  // hide the lines completely, so zero stubs marks a floating object.
  const stubDistance = safeSpacing * 0.66;
  let stubCount = 0;
  const stubPoints: Array<[number, number, boolean]> = [
    [x, y - stubDistance, true],
    [x, y + stubDistance, true],
    [x - stubDistance, y, false],
    [x + stubDistance, y, false],
  ];
  for (const [sx, sy, alongX] of stubPoints) {
    if (sx < 2 || sy < 2 || sx >= width - 2 || sy >= height - 2) continue;
    if (directionalLineEvidence(gray, width, height, sx, sy, alongX) >= 0.35) stubCount += 1;
  }
  const share = (minimum: number, maximum: number) => {
    const band = changed.filter((pixel) => pixel.radius >= minimum && pixel.radius < maximum);
    return band.length ? band.filter((pixel) => pixel.changed).length / band.length : 0;
  };
  const coreShare = share(0, 0.24);
  const middleShare = share(0.24, 0.36);
  const outerShare = share(0.36, 0.48);
  const discShare = share(0, 0.43);
  const ringShare = changedRing.length
    ? changedRing.filter((pixel) => pixel.changed).length / changedRing.length
    : 0;
  const ringSectors = new Set(
    changedRing
      .filter((pixel) => pixel.changed)
      .map((pixel) => Math.floor((Math.atan2(pixel.dy, pixel.dx) + Math.PI) * 8 / Math.PI) % 16),
  ).size;
  const diagonalRing = changedRing.filter((pixel) => Math.abs(Math.abs(pixel.dx) - Math.abs(pixel.dy)) < 0.17);
  const diagonalShare = diagonalRing.length
    ? diagonalRing.filter((pixel) => pixel.changed).length / diagonalRing.length
    : 0;
  const diagonalQuadrants = new Set(
    diagonalRing
      .filter((pixel) => pixel.changed && Math.abs(pixel.dx) > 0.1 && Math.abs(pixel.dy) > 0.1)
      .map((pixel) => `${pixel.dx < 0 ? 0 : 1}${pixel.dy < 0 ? 0 : 1}`),
  ).size;
  const foreground = changed.filter((pixel) => pixel.changed && pixel.radius < 0.4);
  const markerSaturation = foreground.length
    ? median(foreground.map((pixel) => Math.max(...pixel.rgb) - Math.min(...pixel.rgb)))
    : 0;
  // The test matrix deliberately places a red circle and a blue letter on
  // empty intersections. They are compact, highly saturated marks with no
  // broad outer disc; identify that shape before low-contrast stone rules can
  // promote it to a dark stone.
  // Annotation marks are SMALL: their ink never reaches the outer band and
  // the whole mark stays under half the disc. Colored stone materials (the
  // notebook check marks are fully saturated red) share the saturation, so a
  // generous 0.35/0.62 boundary kept flipping them to "marker".
  const compactMarker = markerSaturation >= 34
    && coreShare >= 0.42
    && outerShare < 0.32
    && ringShare < 0.18
    && discShare < 0.52;

  // Outer-band coverage is the strongest discriminator: across the built-in
  // round, jewel, kawaii, aurora, snow, terminal and notebook materials a
  // stone occupies at least half of this band, while lines/labels stay narrow.
  const broadStone = outerShare >= 0.38
    && discShare >= 0.54
    && (coreShare >= 0.5 || middleShare >= 0.55);
  // Bright ice/porcelain rims can make the local background estimate noisy;
  // their centre contrast drops, but the outer stone ring remains dominant.
  const rimStone = outerShare >= 0.6
    && discShare >= 0.5
    && Math.max(coreShare, middleShare) >= 0.38;
  // Grid fitting can be a few raster pixels off on very dark boards whose
  // lines blend into the background. In that case one side of the outer band
  // misses the stone, but the core and total disc remain densely covered.
  // Empty intersections never cover this much of the complete disc.
  const offsetStone = outerShare >= 0.28
    && discShare >= 0.62
    && coreShare >= 0.72
    && middleShare >= 0.55;
  // Notebook crosses/checks are intentionally sparse rather than circular.
  // Their ink fills the core and middle bands but only part of the outer ring.
  // Notebook crosses/checks are intentionally sparse rather than circular.
  // Their ink fills the core and most of the middle band but only part of the
  // outer ring; 0.62 excluded the check-mark material by two hundredths.
  const strokeStone = outerShare >= 0.2
    && discShare >= 0.56
    && coreShare >= 0.6
    && middleShare >= 0.58;
  // Dark classic/black-gold stones can have a board-coloured interior and only
  // a thin illuminated perimeter. Terminal X stones are sparse too, but their
  // four diagonal arms reach the same outer band. Both patterns are much more
  // structured than a star point or a single coloured annotation stroke.
  // Keep the perimeter rule deliberately strict. A nearby stone can bleed
  // into a loose annulus when the fitted phase is a fraction of a pixel off;
  // requiring a nearly complete ring and enough inner evidence avoids turning
  // that bleed into a second stone.
  const terminalRingStone = ringShare >= 0.21
    && ringSectors >= 14
    && outerShare >= 0.47
    && coreShare >= 0.14;
  const metalRingStone = ringShare >= 0.17
    && ringSectors >= 14
    && outerShare >= 0.38
    && middleShare >= 0.17
    && (coreShare >= 0.1 || diagonalShare >= 0.2);
  // On a black-gold board, classic and Yun black stones may have almost no
  // visible perimeter. Their filled centre and middle band are still broad,
  // unlike star points or thin annotations.
  // Ink/snow-outline stones are HOLLOW: a light fill with a grey-blue rim.
  // Their centre matches the board (low core), while the rim lights up the
  // middle band, outer band and diagonal ring at once — a combination an
  // empty intersection or a star dot never produces.
  const hollowStone = coreShare >= 0.15
    && coreShare < 0.4
    && middleShare >= 0.5
    && outerShare >= 0.44
    && ringShare >= 0.25
    && diagonalShare >= 0.3;  const extendedForeground = foreground.length >= 4
    ? foreground
    : changedRing.filter((pixel) => pixel.changed && pixel.radius < 0.56);
  const foregroundLight = foreground.length
    ? median(foreground.map((pixel) => pixel.light))
    : extendedForeground.length
      ? median(extendedForeground.map((pixel) => pixel.light))
    : median(discPixels.filter((pixel) => pixel.radius < 0.24).map((pixel) => pixel.light));
  const foregroundColor: Rgb = extendedForeground.length
    ? [
        median(extendedForeground.map((pixel) => pixel.rgb[0])),
        median(extendedForeground.map((pixel) => pixel.rgb[1])),
        median(extendedForeground.map((pixel) => pixel.rgb[2])),
      ]
    : background;
  const foregroundSaturation = extendedForeground.length
    ? median(extendedForeground.map((pixel) => Math.max(...pixel.rgb) - Math.min(...pixel.rgb)))
    : 0;
  // Colour of the darkest 30% of the foreground: on glow-heavy boards the
  // median of a dark stone's foreground mixes in halo pixels and drifts teal,
  // which then clusters the stone with the pale materials. The dark quartile
  // recovers the stone's own colour; for bright stones it is unused.
  const foregroundDarkColor: Rgb = extendedForeground.length
    ? (() => {
        const ordered = extendedForeground.slice().sort((left, right) => left.light - right.light);
        const darkest = ordered.slice(0, Math.max(2, Math.ceil(ordered.length * 0.3)));
        return [
          median(darkest.map((pixel) => pixel.rgb[0])),
          median(darkest.map((pixel) => pixel.rgb[1])),
          median(darkest.map((pixel) => pixel.rgb[2])),
        ];
      })()
    : background;
  // On a black-gold board, classic and Yun black stones may have almost no
  // visible perimeter. Their filled centre and middle band are still broad,
  // unlike star points or thin annotations. Real dark stones are strongly
  // desaturated (black ≈ 10-20, navy ink ≈ 18-21, dark green ≈ 35); the
  // outline-cased annotation letters land around 45-55.
  // Terminal O stones are a LARGE thin ring parked in the outer band: the
  // centre and the middle band stay empty while the outer band and diagonal
  // ring light up. Annotation circles render smaller (their ring crosses the
  // middle band), so the near-empty middle band is what separates them.
  const outerRingStone = coreShare < 0.2
    && middleShare <= 0.2
    && outerShare >= 0.42
    && ringShare >= 0.25
    && diagonalShare >= 0.25;
  const darkBoard = luminance(background[0], background[1], background[2]) < 110;
  const darkSolidStone = darkBoard
    && foregroundSaturation < 40
    && coreShare >= 0.3
    && middleShare >= 0.24
    && discShare >= 0.22
    && outerShare < 0.28;
  const backgroundLightValue = luminance(background[0], background[1], background[2]);
  // Pale-fill stones (jade/snow bright materials on mid-tone boards) fade
  // out before the outer band: the bright core and middle band carry the
  // signal, and the fill must be clearly LIGHTER than the local board. The
  // ring requirement keeps centre-cased annotation letters (whose ink never
  // reaches the ring band at all) out; a real fill always grazes it.
  const brightStone = coreShare >= 0.75
    && middleShare >= 0.5
    && (discShare >= 0.54 || (differenceThreshold >= 35 && discShare >= 0.5))
    && outerShare < 0.45
    && ringShare >= 0.1
    && foregroundLight - backgroundLightValue >= 25;
  // Soft-edged pale fills on textured light boards (notebook cream stones):
  // the paper noise caps the difference threshold, so the disc coverage stays
  // partial. Requires a clearly BRIGHTER fill reaching the core and a ring
  // presence (annotation letters have neither).
  const paleSoftStone = coreShare >= 0.6
    && middleShare >= 0.35
    && discShare >= 0.45
    && ringShare >= 0.15
    && foregroundSaturation < 60
    && foregroundLight - backgroundLightValue >= 40;
  // Soft dark fills on light boards (snow/pale blue materials): the mirror of
  // paleSoftStone, with the middle band carrying the coverage.
  const softDarkStone = coreShare >= 0.55
    && middleShare >= 0.7
    && discShare >= 0.55
    && backgroundLightValue - foregroundLight >= 40;
  // Subtle filled discs that the adaptive change threshold never separates:
  // kawaii porcelain white on pink paper (~40 RGB units), blue-rimmed
  // porcelain whose fill stays under the texture-inflated threshold. The fill
  // is self-consistent while an empty intersection averages in grid-line ink
  // or page noise, and its colour sits clearly off the local board (~22+ RGB)
  // without annotation-level saturation. The raw fill share demands
  // stone-sized coverage — a real fill reaches the rim (0.9+ of the disc)
  // while the pill's badges and icons stop around 0.6-0.75. Textured paper
  // caps the self-consistency around 16-21, so a second tier admits up to 26
  // when the fill sits far enough off the board (30+); empty crossings never
  // reach that colour distance. Dark boards are excluded: their glow
  // gradients mimic a coherent shift.
  const coherentDiscStone = !darkBoard
    && discRawFillShare >= 0.8
    && foregroundSaturation < 50
    && voidShare <= 0.35
    && ((discCoreSpread <= 18 && discCoreDistance >= 22)
      || (discCoreSpread <= 26 && discCoreDistance >= 30));
  // Muted filled discs on light boards (notebook cream, porcelain yun): soft
  // grey fills whose ink lives in the middle band while the core blends back
  // toward the board, so the change-based shares hover just under the
  // hollowStone bar. The dark-disc share anchors them physically: a real muted
  // fill keeps ~40% of the disc clearly darker than the board, while an empty
  // crossing's grid ink stays near 0.2 and annotation strokes stay saturated.
  const mutedDiscStone = darkDiscShare >= 0.3
    && coreShare >= 0.1
    && coreShare < 0.4
    && middleShare >= 0.44
    && outerShare >= 0.42
    && ringShare >= 0.25
    && diagonalShare >= 0.3
    && foregroundSaturation < 50;
  const rawStoneLike = broadStone
    || rimStone
    || offsetStone
    || strokeStone
    || hollowStone
    || brightStone
    || paleSoftStone
    || softDarkStone
    || coherentDiscStone
    || mutedDiscStone
    || outerRingStone
    || terminalRingStone
    || metalRingStone
    || darkSolidStone;
  // Real pale stones (jade ≈ 40, snow ≈ 30-45) sit just above the old 34
  // threshold; actual coloured annotations are far more saturated (120+).
  const coloredMarker = compactMarker || (foregroundSaturation >= 50
    && coreShare >= 0.38
    && outerShare < 0.32
    && ringShare < 0.18
    && (discShare < 0.52
      // On dark boards the board-coloured letter halo fattens the disc share
      // of axis labels past the light-board bar (walnut snow theme): the halo
      // is board-adjacent ink, not a stone fill, and the saturation plus the
      // thin ring still give it away.
      || (darkBoard && discShare < 0.65)));
  // A bright fill whose colour keeps going past the stone boundary half a
  // cell out is the interior of a sprawling overlay (the "five in a row"
  // victory pill), not a stone; real stones — however pale — end at their
  // rim and the band beyond shows the board. The band must also be
  // UNIFORMLY the fill colour: textured boards (notebook ruling) light their
  // void band up too, but as a mixture, not as one flat colour.
  const sprawlingLight = foregroundLight >= 195
    && voidShare >= 0.4
    && voidSpread < 28
    && rgbDistance(voidMedian, foregroundColor) < 30;
  const stoneLike = !coloredMarker && rawStoneLike && !sprawlingLight;
  const markerLike = coloredMarker || (!stoneLike
    && coreShare >= 0.42
    && outerShare < 0.32
    && foregroundSaturation >= 34);
  const score = Math.max(0, Math.min(1,
    outerShare * 0.45
    + discShare * 0.25
    + Math.max(coreShare, middleShare) * 0.12
    + ringShare * 0.1
    + diagonalShare * 0.08,
  ));

  return {
    stoneLike,
    markerLike,
    score,
    foregroundLight,
    foregroundColor,
    backgroundLight: backgroundLightValue,
    coreShare,
    middleShare,
    outerShare,
    discShare,
    ringShare,
    diagonalShare,
    foregroundSaturation,
    foregroundDarkColor,
    differenceThreshold,
    backgroundSpread,
    voidShare,
    voidMedian,
    voidSpread,
    stubCount,
    darkDiscShare,
    darkBelowShare,
    discCoreSpread,
    discCoreDistance,
    discRawFillShare,
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
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-grid]", JSON.stringify({
        file: file.name,
        canvasWidth,
        canvasHeight,
        fallback,
        grid,
      }));
    }
    const board: Cell[][] = Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null));
    const numberedMoves: Array<Position & { player: Player; number: number }> = [];
    let candidates: Array<{ row: number; col: number; x: number; y: number; features: IntersectionFeatures }> = [];
    let ignoredColoredMarkers = 0;
    const localSpacing = Math.min(grid.spacingX, grid.spacingY);
    const debugPoints: Array<Record<string, unknown>> = [];

    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const x = grid.originX + col * grid.spacingX;
        const y = grid.originY + row * grid.spacingY;
        if (x < 3 || y < 3 || x > canvasWidth - 4 || y > canvasHeight - 4) continue;
        const features = analyzeIntersection(sampled, x, y, localSpacing);
        if (features.stoneLike) candidates.push({ row, col, x, y, features });
        else if (features.markerLike) ignoredColoredMarkers += 1;
        debugPoints.push({
          rc: `${String.fromCharCode(65 + col)}${boardSize - row}`,
          s: features.stoneLike ? 1 : 0,
          c: features.foregroundColor,
          l: Math.round(features.foregroundLight),
          b: Math.round(features.backgroundLight),
          core: Math.round(features.coreShare * 100) / 100,
          mid: Math.round(features.middleShare * 100) / 100,
          out: Math.round(features.outerShare * 100) / 100,
          disc: Math.round(features.discShare * 100) / 100,
          ring: Math.round(features.ringShare * 100) / 100,
          dg: Math.round(features.diagonalShare * 100) / 100,
          sat: Math.round(features.foregroundSaturation),
          th: Math.round(features.differenceThreshold),
          sp: Math.round(features.backgroundSpread),
          vd: Math.round(features.voidShare * 100) / 100,
          st: features.stubCount,
          dd: Math.round(features.darkDiscShare * 100) / 100,
          db: Math.round(features.darkBelowShare * 100) / 100,
          cs: Math.round(features.discCoreSpread),
          cd: Math.round(features.discCoreDistance),
          rf: Math.round(features.discRawFillShare * 100) / 100,
        });
      }
    }
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-points]", JSON.stringify(debugPoints));
    }

    // The app draws its "five in a row" victory pill over the top-centre of
    // the board. Its body reaches the second grid row, so the two top rows
    // need targeted checks; everything else keeps its normal classification.
    // Row 0: the pill and its badge hide the grid lines completely — a real
    // top-row stone keeps stubs on at least two of its three inward axes.
    // Row 1: the pill's bright bottom edge reads as a solid disc over a
    // gradient background; a real stone there either is darker or sits on a
    // verifiably non-overlay void band.
    const boardCenterCol = (boardSize - 1) / 2;
    candidates = candidates.filter((candidate) => {
      if (candidate.row > 1 || Math.abs(candidate.col - boardCenterCol) > 3.2) return true;
      const features = candidate.features;
      if (candidate.row === 0) return features.stubCount >= 2;
      // Row 1: the pill's bright bottom edge reads as a solid disc over a
      // gradient background. A DARK stone under the pill edge keeps a large
      // dark share inside its disc and must survive; the overlay body has no
      // dark pixels at all, whatever the board tone is.
      // The pill body is BRIGHTER than the board under it, on every theme;
      // a dark stone under the pill edge is DARKER than the board. Relative
      // brightness separates them where absolute thresholds drift. A DARK
      // stone under the pill edge keeps a bright polluted fill (fg ≥ bg+20
      // as well!) — its disc still holds the stone's own dark pixels, so a
      // large dark share survives the overlay tests.
      if (features.darkDiscShare >= 0.3) return true;
      if (
        features.voidShare >= 0.4
        && features.coreShare >= 0.65
        && features.foregroundLight >= features.backgroundLight + 20
      ) return false;
      return true;
    });

    if (!candidates.length) throw new Error("没有找到可靠棋子，请确保棋盘完整可见并提高图片清晰度");

    // Separate materials in RGB space, not luminance alone. Pink/teal kawaii
    // stones and blue/gold jewel stones can have overlapping brightness near
    // highlights, while their colour centroids remain clearly distinct.
    // Plain 2-means WITHOUT a forced half/half split: detection legitimately
    // misses stones of one material, and forcing the balance then recolours
    // correctly found stones to fill the quota.
    const sortedCandidates = candidates.slice().sort((left, right) => left.features.foregroundLight - right.features.foregroundLight);
    const lights = sortedCandidates.map((candidate) => candidate.features.foregroundLight);
    const lightRange = lights[lights.length - 1] - lights[0];
    const clusteredPlayers = new Map<typeof candidates[number], Player>();
    if (candidates.length >= 2) {
      const seedCount = Math.max(1, Math.ceil(candidates.length * 0.2));
      const colorMedian = (items: typeof candidates): Rgb => [
        median(items.map((candidate) => candidate.features.foregroundColor[0])),
        median(items.map((candidate) => candidate.features.foregroundColor[1])),
        median(items.map((candidate) => candidate.features.foregroundColor[2])),
      ];
      let blackCentroid = colorMedian(sortedCandidates.slice(0, seedCount));
      let whiteCentroid = colorMedian(sortedCandidates.slice(-seedCount));
      let blackCandidates: typeof candidates = [];
      let whiteCandidates: typeof candidates = [];
      for (let iteration = 0; iteration < 6; iteration += 1) {
        blackCandidates = [];
        whiteCandidates = [];
        for (const candidate of candidates) {
          // A dark stone under the victory-pill edge keeps a glow-polluted
          // median colour (teal) that lands it in the pale cluster; its own
          // colour lives in the darkest quartile of the foreground.
          const color = candidate.features.darkDiscShare >= 0.3
            ? candidate.features.foregroundDarkColor
            : candidate.features.foregroundColor;
          if (rgbDistance(color, whiteCentroid) - rgbDistance(color, blackCentroid) >= 0) {
            blackCandidates.push(candidate);
          } else {
            whiteCandidates.push(candidate);
          }
        }
        if (!blackCandidates.length || !whiteCandidates.length) break;
        blackCentroid = colorMedian(blackCandidates);
        whiteCentroid = colorMedian(whiteCandidates);
      }
      const materialSeparation = rgbDistance(blackCentroid, whiteCentroid);
      if ((materialSeparation >= 12 || lightRange >= 10) && blackCandidates.length && whiteCandidates.length) {
        blackCandidates.forEach((candidate) => clusteredPlayers.set(candidate, "black"));
        whiteCandidates.forEach((candidate) => clusteredPlayers.set(candidate, "white"));
      }
    }

    let score = 0;
    candidates.forEach((candidate) => {
      const { row, col, x, y, features } = candidate;
      let player: Player;
      if (clusteredPlayers.has(candidate)) {
        player = clusteredPlayers.get(candidate)!;
      } else if (candidates.length === 1) {
        // A legal single-stone position starts with black.
        player = "black";
      } else if (features.foregroundLight >= 128) {
        player = "white";
      } else if (features.backgroundLight < 95 && features.foregroundLight > features.backgroundLight + 18) {
        player = "white";
      } else {
        player = "black";
      }
      board[row][col] = player;
      score += features.score;
      const number = detectMoveNumber(sampled, x, y, localSpacing, player);
      if (number !== null) numberedMoves.push({ row, col, player, number });
    });

    const occupied = candidates.length;
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
