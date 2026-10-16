import { useMemo, useState } from "react";
import { parseCoordinateCode } from "../../coordinate-code";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "../../game";
import type { Position } from "../../types";
import "./coordinate-code.css";

const BOARD_SIZE_OPTIONS = Array.from({ length: MAX_BOARD_SIZE - MIN_BOARD_SIZE + 1 }, (_, index) => index + MIN_BOARD_SIZE);

/**
 * 「粘贴坐标代码」面板：把复制来的坐标串直接变成一份棋谱。
 *
 * 解析放在输入时实时跑（`useMemo`），因为**跳过的东西必须在按下「生成棋谱」之前就看见**——
 * 越界的坐标、重复的点、看不懂的片段都会列在输入框下面，而不是等生成完再补一句提示。
 * 面板自己持有输入与路数，父组件只负责最后"用这些坐标开一份棋谱"。
 */
export function CoordinateCodePanel({ defaultBoardSize, onApply, onCancel, onNotice }: {
  defaultBoardSize: number;
  onApply: (positions: Position[], boardSize: number, warnings: string[]) => void;
  onCancel: () => void;
  onNotice: (message: string) => void;
}) {
  const [boardSize, setBoardSize] = useState(defaultBoardSize);
  const [draft, setDraft] = useState("");
  const parsed = useMemo(() => parseCoordinateCode(draft, boardSize), [draft, boardSize]);
  const ready = parsed.positions.length > 0;

  const submit = () => {
    if (!ready) {
      onNotice(`没有识别到坐标：请按 ${boardSize} 路的「字母+数字」写法，例如 H8 I9 H10`);
      return;
    }
    onApply(parsed.positions, boardSize, parsed.warnings);
  };

  return (
    <div className="sheet-body coordinate-code-sheet">
      <div className="coordinate-code-toolbar">
        <label>
          <span>棋盘路数</span>
          <select value={boardSize} aria-label="坐标代码的棋盘路数" onChange={(event) => setBoardSize(Number(event.target.value))}>
            {BOARD_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 路</option>)}
          </select>
        </label>
        <span className={`coordinate-code-count ${ready ? "ready" : ""}`} aria-live="polite">
          {ready ? `识别到 ${parsed.positions.length} 手` : "等待输入"}
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        placeholder={"H8 I9 H10\n或 h8i9h10"}
        aria-label="坐标代码"
      />
      {parsed.warnings.length > 0 && (
        <ul className="coordinate-code-notes">
          {parsed.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <p className="helper">
        支持 <code>H8 I9 H10</code>、<code>h8i9h10</code>、<code>1.H8 2.I9</code>、<code>黑 H8 白 I9</code>，
        也认全角字符和逗号、分号分隔；列自左起 A、行自下起算，与「五子棋小工具」一致。
        生成的是未保存棋谱，核对后再保存。
      </p>
      <div className="coordinate-code-actions">
        <button type="button" className="primary-button" onClick={submit}>生成棋谱</button>
        <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
