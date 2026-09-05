import { ArchiveRestore, DatabaseBackup, Download, Upload } from "lucide-react";

export function DataSafetyPanel({ recycleCount, backupBusy, onOpenTrash, onExportBackup, onRestoreBackup }: {
  recycleCount: number;
  backupBusy: boolean;
  onOpenTrash: () => void;
  onExportBackup: () => void;
  onRestoreBackup: () => void;
}) {
  return <div className="sheet-body data-safety-panel">
    <div className="data-safety-summary"><ShieldIcon/><span><b>删除可恢复，备份可迁移</b><small>回收站处理误删；完整备份覆盖棋谱、草稿、题库、进度、书签与大型棋谱索引。</small></span></div>
    <div className="data-safety-summary" role="note"><span><b>导出范围说明</b><small>棋谱页的“当前变化 / 当前局面”是分享或交换用的轻量导出；“整份棋谱”包含完整变化树。这里的“完整备份”是用于无损恢复的应用原生格式，包含 schemaVersion、应用版本、导出时间与损坏校验，不等同于保存当前棋谱。</small></span></div>
    <button className="data-safety-action" onClick={onOpenTrash}><ArchiveRestore/><span><b>打开回收站</b><small>{recycleCount ? `${recycleCount} 项已删除，可恢复或彻底清理` : "回收站为空"}</small></span></button>
    <button className="data-safety-action" onClick={onExportBackup} disabled={backupBusy}><Download/><span><b>{backupBusy ? "正在处理备份…" : "导出完整备份"}</b><small>生成一个版本化 ZIP 备份包，内含完整备份 JSON 与说明文件。</small></span></button>
    <button className="data-safety-action" onClick={onRestoreBackup} disabled={backupBusy}><Upload/><span><b>恢复完整备份</b><small>支持 JSON 或 ZIP；会自动校验格式，失败时不会覆盖当前数据。</small></span></button>
  </div>;
}

function ShieldIcon() {
  return <span className="data-safety-icon"><DatabaseBackup/></span>;
}
