import { describe, expect, it } from "vitest";
import { MAX_BOARD_SCALE, MIN_BOARD_SCALE, clampBoardScale, shouldZoomOnWheel, zoomAnchorScroll } from "./board-zoom";

describe("board zoom (棋盘缩放)", () => {
  it("allows zooming well past the old 2.35 cap", () => {
    // 用户原话「之前能缩放的很大，大概五倍还多」。2.35 这个旧上限一次捏合就顶死，
    // 是「棋盘被限制大小了」的直接原因。
    expect(MAX_BOARD_SCALE).toBeGreaterThanOrEqual(5);
    expect(clampBoardScale(4)).toBe(4);
    expect(clampBoardScale(5.5)).toBe(5.5);
    expect(clampBoardScale(99)).toBe(MAX_BOARD_SCALE);
  });

  it("never zooms below the fitted size and recovers from junk", () => {
    expect(clampBoardScale(0.4)).toBe(MIN_BOARD_SCALE);
    expect(clampBoardScale(0)).toBe(MIN_BOARD_SCALE);
    expect(clampBoardScale(-3)).toBe(MIN_BOARD_SCALE);
    expect(clampBoardScale(Number.NaN)).toBe(MIN_BOARD_SCALE);
    expect(clampBoardScale(1)).toBe(1);
  });

  it("treats trackpad pinch (ctrl+wheel) and cmd+wheel as zoom", () => {
    // 触摸板捏合在 Chromium 里就是带 ctrlKey 的 wheel——旧实现只听 touch 指针事件，
    // 所以桌面端「双指缩放」一点反应都没有。
    expect(shouldZoomOnWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("keeps the anchored point fixed while zooming", () => {
    // 锚点 x=100、当前滚动 0、从 1 倍放到 2 倍：内容里那一处是 100，缩放后应落在
    // 视口 100 处 → 新滚动 = 100*2 - 100 = 100。
    expect(zoomAnchorScroll({ anchorX: 100, anchorY: 40, scrollLeft: 0, scrollTop: 0, fromScale: 1, toScale: 2 }))
      .toEqual({ left: 100, top: 40 });
    // 反向（缩小）回到 0：内容点 100 在 2 倍下是视口 (0+100)/2=50 → 1 倍时滚动 = 50-100 = -50（会被浏览器夹到 0）。
    expect(zoomAnchorScroll({ anchorX: 100, anchorY: 0, scrollLeft: 0, scrollTop: 0, fromScale: 2, toScale: 1 }).left).toBe(-50);
  });

  it("keeps the anchored content point fixed across a real chain of steps", () => {
    // 用「围着一个点滚十格」的方式验证：每一格之后，锚点处的内容坐标都应当不变。
    const anchorX = 120, anchorY = 90;
    let scrollLeft = 30, scrollTop = 10, scale = 1.6;
    const contentX = () => (scrollLeft + anchorX) / scale;
    const contentY = () => (scrollTop + anchorY) / scale;
    const targetX = contentX(), targetY = contentY();
    for (const next of [1.8, 2.4, 3.5, 6, 6, 4.2, 2, 1]) {
      const to = clampBoardScale(next);
      const offset = zoomAnchorScroll({ anchorX, anchorY, scrollLeft, scrollTop, fromScale: scale, toScale: to });
      scrollLeft = Math.max(0, offset.left);
      scrollTop = Math.max(0, offset.top);
      scale = to;
      // 只在滚动没被夹到 0 的时候核对（夹住就说明已经到内容边界，锚点必然漂移）。
      if (scrollLeft > 0 && scrollTop > 0) {
        expect(contentX()).toBeCloseTo(targetX, 6);
        expect(contentY()).toBeCloseTo(targetY, 6);
      }
    }
  });
});
