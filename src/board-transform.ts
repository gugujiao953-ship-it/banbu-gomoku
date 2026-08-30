import type { Position } from "./types";

export type BoardRotation = 0 | 90 | 180 | 270;

/**
 * Maps a logical board position to the position shown on the fixed board.
 * Mirroring is horizontal first, followed by clockwise rotation. The board
 * itself (grid, coordinates and star points) is intentionally not transformed.
 */
export const transformBoardPosition = (
  position: Position,
  size: number,
  rotation: BoardRotation,
  mirrored: boolean,
): Position => {
  const last = Math.max(0, size - 1);
  let row = position.row;
  let col = mirrored ? last - position.col : position.col;
  if (rotation === 90) {
    [row, col] = [col, last - row];
  } else if (rotation === 180) {
    [row, col] = [last - row, last - col];
  } else if (rotation === 270) {
    [row, col] = [last - col, row];
  }
  return { row, col };
};

/** Reverse transform for mapping a visual board hit back to game data. */
export const inverseTransformBoardPosition = (
  position: Position,
  size: number,
  rotation: BoardRotation,
  mirrored: boolean,
): Position => {
  const last = Math.max(0, size - 1);
  let row = position.row;
  let col = position.col;
  if (rotation === 90) {
    [row, col] = [last - col, row];
  } else if (rotation === 180) {
    [row, col] = [last - row, last - col];
  } else if (rotation === 270) {
    [row, col] = [col, last - row];
  }
  if (mirrored) col = last - col;
  return { row, col };
};
