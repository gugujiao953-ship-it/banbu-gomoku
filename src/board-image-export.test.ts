import { describe, expect, it } from "vitest";
import { addMove, createDocument, setLabelMark, toggleMark } from "./game";
import { BOARD_SHARE_HEIGHT, BOARD_SHARE_WIDTH, boardShareFilename, createBoardShareSvg, type BoardShareOptions } from "./board-image-export";

const options: BoardShareOptions = {
  showMoveNumbers: true,
  showCoordinates: true,
  showAnnotations: true,
  showWatermark: true,
  rotation: 0,
  mirrored: false,
};

describe("board share image", () => {
  it("renders a self-contained card with stones, coordinates, numbers and annotations", () => {
    let document = createDocument("复盘 / 测试");
    const black = addMove(document, document.rootId, { row: 7, col: 7 });
    document = black.document;
    const white = addMove(document, black.nodeId, { row: 7, col: 8 });
    document = white.document;
    document.nodes[white.nodeId].marks = setLabelMark(document.nodes[white.nodeId].marks, { row: 6, col: 7 }, "胜", "text", "#b94b3f");
    document.nodes[white.nodeId].marks = toggleMark(document.nodes[white.nodeId].marks, { row: 8, col: 8 });

    const svg = createBoardShareSvg(document, white.nodeId, options);

    expect(svg).toContain(`width="${BOARD_SHARE_WIDTH}"`);
    expect(svg).toContain(`height="${BOARD_SHARE_HEIGHT}"`);
    expect(svg).toContain("复盘 / 测试");
    expect(svg.match(/data-export-role="stone"/g)).toHaveLength(2);
    expect(svg).toContain('data-export-role="move-number"');
    expect(svg).toContain('data-export-role="coordinate"');
    expect(svg).toContain('data-export-role="annotation"');
    expect(svg).toContain('data-export-role="watermark"');
    expect(svg).not.toContain("<style");
  });

  it("honors visibility and board direction options", () => {
    const document = createDocument("方向测试");
    const svg = createBoardShareSvg(document, document.rootId, {
      ...options,
      showMoveNumbers: false,
      showCoordinates: false,
      showAnnotations: false,
      showWatermark: false,
      rotation: 90,
      mirrored: true,
    });

    expect(svg).not.toContain('transform="translate(');
    expect(svg).toContain('<rect x="70" y="190" width="1060" height="1060"');
    expect(svg).not.toContain('data-export-role="move-number"');
    expect(svg).not.toContain('data-export-role="coordinate"');
    expect(svg).not.toContain('data-export-role="annotation"');
    expect(svg).not.toContain('data-export-role="watermark"');
  });

  it("creates a safe filename with the current move", () => {
    let document = createDocument('A/B:复盘?');
    const move = addMove(document, document.rootId, { row: 7, col: 7 });
    document = move.document;
    expect(boardShareFilename(document, move.nodeId)).toBe("A-B-复盘--第1手.png");
  });

  it("isolates stone opacity from move numbers and last-move markers", () => {
    let document = createDocument("透明度");
    const move = addMove(document, document.rootId, { row: 7, col: 7 });
    document = move.document;
    const svg = createBoardShareSvg(document, move.nodeId, { ...options, stoneOpacity: .4 });
    expect(svg).toContain('data-export-role="stone-body"');
    expect(svg).toContain('opacity="0.4"');
    expect(svg).toContain('data-export-role="move-number"');
    expect(svg).not.toMatch(/data-export-role="move-number"[^>]*opacity="0\.4"/);
  });
});
