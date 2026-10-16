import { EyeOff, Library, RotateCw } from "lucide-react";

/**
 * 题库管理（用户 2026-09-21 引入，2026-09-26 从设置搬进题库页）：
 * 隐藏的题集可从恢复，做题进度可重置。
 *
 * 之前它是设置页里的一个完整分区，但内容就这两件事，撑不起一个分区（用户：「字有点太
 * 不合题，功能小材大用了」），现在挂到题库页快捷入口的第 8 个按钮上，作为弹层打开。
 * 隐藏不删除：题目、做题进度和收藏都原样保留；重置只清「做过哪些题、做对没有、用时多少」
 * 这些做题记录，题目本身、自建题集、收藏、文件夹归属与书签都不受影响。
 */
export interface PuzzleManagePanelProps {
  hiddenPuzzleCollections: { id: string; title: string; puzzles: number }[];
  masteredPuzzleCount: number;
  puzzleProgressCount: number;
  onRestoreHiddenPuzzleCollection: (id: string) => void;
  onRestoreAllHiddenPuzzleCollections: () => void;
  onResetPuzzleProgress: () => void;
}

export function PuzzleManagePanel({ hiddenPuzzleCollections, masteredPuzzleCount, puzzleProgressCount, onRestoreHiddenPuzzleCollection, onRestoreAllHiddenPuzzleCollections, onResetPuzzleProgress }: PuzzleManagePanelProps) {
  return (
    <div className="sheet-body puzzle-manage-sheet" data-puzzle-manage aria-label="题库管理">
      <p className="settings-note">隐藏的题集不会出现在题库列表里，但题目、做题进度和收藏都原样保留。内置题库不能删除，隐藏是把它收起来的办法。</p>
      {hiddenPuzzleCollections.length ? <>
        {hiddenPuzzleCollections.map((collection) => <div key={collection.id} className="settings-link-row"><span><EyeOff aria-hidden="true"/><b>{collection.title}</b><small>{collection.puzzles} 道题 · 已隐藏</small></span><button type="button" className="secondary-button" onClick={() => onRestoreHiddenPuzzleCollection(collection.id)}>恢复显示</button></div>)}
        <button type="button" className="secondary-button" onClick={onRestoreAllHiddenPuzzleCollections}>全部恢复显示</button>
      </> : <p className="settings-note">当前没有隐藏的题集。在题库列表里点题集上的眼睛图标即可隐藏。</p>}
      <p className="settings-note">重置只会清掉「做过哪些题、做对没有、用时多少」这些做题记录{masteredPuzzleCount > 0 ? `（已掌握标记 ${masteredPuzzleCount} 道会保留）` : ""}；题目本身、自建题集、收藏、文件夹归属与书签都不受影响。</p>
      <div className="settings-link-row"><span><RotateCw aria-hidden="true"/><b>重置做题进度</b><small>{puzzleProgressCount > 0 ? `当前有 ${puzzleProgressCount} 道题留下了做题记录，重置后全部清空` : "当前没有做题记录"}</small></span><button type="button" className="secondary-button" disabled={!puzzleProgressCount} onClick={onResetPuzzleProgress}>重置</button></div>
    </div>
  );
}
