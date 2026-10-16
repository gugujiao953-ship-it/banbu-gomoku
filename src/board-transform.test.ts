import { describe, expect, it } from "vitest";
import { applyRotationStep, inverseTransformBoardPosition, normalizeAngleDelta, pointerAngle, ROTATE_GESTURE_THRESHOLD_RAD, rotationStepForAngleDelta, transformBoardPosition, type BoardRotation } from "./board-transform";

const point = { row: 2, col: 5 };
const rotations: BoardRotation[] = [0, 90, 180, 270];

describe("board content transform", () => {
  it("maps a point around a fixed 15x15 board", () => {
    expect(transformBoardPosition(point, 15, 0, false)).toEqual({ row: 2, col: 5 });
    expect(transformBoardPosition(point, 15, 90, false)).toEqual({ row: 5, col: 12 });
    expect(transformBoardPosition(point, 15, 180, false)).toEqual({ row: 12, col: 9 });
    expect(transformBoardPosition(point, 15, 270, false)).toEqual({ row: 9, col: 2 });
    expect(transformBoardPosition(point, 15, 0, true)).toEqual({ row: 2, col: 9 });
  });

  it("keeps every transformed point inside the board", () => {
    for (const rotation of rotations) {
      for (const mirrored of [false, true]) {
        for (const row of [0, 7, 14]) {
          for (const col of [0, 7, 14]) {
            const transformed = transformBoardPosition({ row, col }, 15, rotation, mirrored);
            expect(transformed.row).toBeGreaterThanOrEqual(0);
            expect(transformed.row).toBeLessThan(15);
            expect(transformed.col).toBeGreaterThanOrEqual(0);
            expect(transformed.col).toBeLessThan(15);
          }
        }
      }
    }
  });

  it("round-trips visual hits back to logical positions", () => {
    for (const rotation of rotations) {
      for (const mirrored of [false, true]) {
        const transformed = transformBoardPosition(point, 15, rotation, mirrored);
        expect(inverseTransformBoardPosition(transformed, 15, rotation, mirrored)).toEqual(point);
      }
    }
  });
});

describe("双指旋转手势的角度换算（用户 09-17 第二批②）", () => {
  it("顺时针拧超过阈值转 90°，逆时针拧转 270°（等价于反向 90°）", () => {
    expect(rotationStepForAngleDelta(ROTATE_GESTURE_THRESHOLD_RAD)).toBe(90);
    expect(rotationStepForAngleDelta(ROTATE_GESTURE_THRESHOLD_RAD + 0.5)).toBe(90);
    expect(rotationStepForAngleDelta(-ROTATE_GESTURE_THRESHOLD_RAD)).toBe(270);
    expect(rotationStepForAngleDelta(-ROTATE_GESTURE_THRESHOLD_RAD - 0.5)).toBe(270);
  });

  it("阈值内不动（防手抖）", () => {
    expect(rotationStepForAngleDelta(0)).toBe(0);
    expect(rotationStepForAngleDelta(ROTATE_GESTURE_THRESHOLD_RAD - 0.01)).toBe(0);
    expect(rotationStepForAngleDelta(-ROTATE_GESTURE_THRESHOLD_RAD + 0.01)).toBe(0);
  });

  it("角度差归一化：跨 ±180° 不被当成反向大转", () => {
    expect(normalizeAngleDelta(Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 6);
    expect(normalizeAngleDelta(-Math.PI * 2 + 0.1)).toBeCloseTo(0.1, 6);
    expect(normalizeAngleDelta(0.3)).toBeCloseTo(0.3, 6);
  });

  it("pointerAngle 在屏幕坐标（y 向下）下顺时针增大", () => {
    const origin = { x: 0, y: 0 };
    expect(pointerAngle(origin, { x: 10, y: 0 })).toBeCloseTo(0, 6);
    expect(pointerAngle(origin, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2, 6);
  });

  it("步进累加吸附在 90° 整数倍上，四次回到原位", () => {
    let rotation: BoardRotation = 0;
    for (let index = 0; index < 4; index += 1) rotation = applyRotationStep(rotation, 90);
    expect(rotation).toBe(0);
    expect(applyRotationStep(0, 270)).toBe(270);
    expect(applyRotationStep(270, 90)).toBe(0);
  });
});
