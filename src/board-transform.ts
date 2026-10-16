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

// ── 双指旋转手势（用户 09-17 第二批②）──────────────────────────────
// 两指连线相对屏幕的角度差决定旋转方向与步进。屏幕坐标 y 向下，所以
// atan2 增大的方向在视觉上就是顺时针——与 transformBoardPosition 的
// 「顺时针为正」约定一致（rotation 90 把左上角转到右上角）。

/** 触发一次 90° 旋转所需的转角（弧度）。30° 是「手腕轻拧」与「误碰」的分界：
 * 小于它时两指抖动不会转盘，大于它时不必拧到半圈才响应。一次手势只转一格
 * （见 App 的 gestureRotateHandled），要连续转就抬手重拧。 */
export const ROTATE_GESTURE_THRESHOLD_RAD = (30 * Math.PI) / 180;

export const pointerAngle = (first: { x: number; y: number }, second: { x: number; y: number }): number =>
  Math.atan2(second.y - first.y, second.x - first.x);

/** 把角度差归一化到 (-π, π]，避免 179° → -179° 被当成反向大转。 */
export const normalizeAngleDelta = (delta: number): number => {
  let value = delta;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value <= -Math.PI) value += Math.PI * 2;
  return value;
};

/** 转角 → 本次应转的度数（0=不动，90=顺时针，270=逆时针 90）。
 * 顺时针为正、逆时针为 270，这样 `(rotation + step) % 360` 就是新角度。 */
export const rotationStepForAngleDelta = (delta: number, threshold = ROTATE_GESTURE_THRESHOLD_RAD): 0 | 90 | 270 => {
  if (delta >= threshold) return 90;
  if (delta <= -threshold) return 270;
  return 0;
};

/** 应用一次旋转步进（顺时针累加、吸附在 90° 的整数倍上）。 */
export const applyRotationStep = (rotation: BoardRotation, step: 0 | 90 | 270): BoardRotation =>
  ((rotation + step) % 360) as BoardRotation;
