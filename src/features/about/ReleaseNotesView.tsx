import { ChevronLeft, Info } from "lucide-react";
import { APP_VERSION } from "../../diagnostics";
import { withBold } from "../../ui/with-bold";
import { RELEASE_NOTES_FALLBACK, releaseNotesFor } from "../../release-notes";

/**
 * 「关于 → 本版本更新内容」（用户 2026-10-01：单独一个按钮，以后更新了在这里看，
 * 并且**只显示当前版本**这一条）。
 *
 * 数据在 `src/release-notes.ts`，那里有"抬版本必须补条目"的单测兜着；
 * 查不到当前版本时不拿旧版内容冒充，直接给一句诚实的兜底文案。
 */
export function ReleaseNotesView({ onBack }: { onBack: () => void }) {
  const notes = releaseNotesFor(APP_VERSION);
  return (
    <div className="about-detail" data-about-view="release-notes">
      <button type="button" className="about-detail-back" data-about-back="" onClick={onBack}>
        <ChevronLeft size={16}/>返回「关于」
      </button>
      <header className="about-detail-head">
        <b>本版本更新了什么</b>
        <small>版本 {APP_VERSION}{notes?.date ? ` · ${notes.date}` : ""}。只列这一版；更早的改动看仓库的发布页。</small>
      </header>
      {notes ? (
        <>
          <p className="about-detail-summary" data-release-summary="">{withBold(notes.summary)}</p>
          <ul className="about-detail-list" data-release-notes="">
            {notes.items.map((item) => (
              <li key={item.title}><b>{item.title}</b><span>{withBold(item.text)}</span></li>
            ))}
          </ul>
        </>
      ) : (
        <p className="about-detail-empty" data-release-empty=""><Info size={15}/>{RELEASE_NOTES_FALLBACK}</p>
      )}
      <p className="about-detail-foot">这一版的技术细节（实测数字、诊断过程）记在仓库的更新日志与改造表里，不搬进应用：那里是给人维护用的。</p>
    </div>
  );
}
