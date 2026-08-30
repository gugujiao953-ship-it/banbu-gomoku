import { Lightbulb, X } from "lucide-react";

export type CoachMarkId = "record-tools" | "library-search" | "settings-groups";
export type CoachMarkAction = "acknowledge" | "later" | "dismiss";

const content: Record<CoachMarkId, { title: string; body: string }> = {
  "record-tools": { title: "棋盘工具小提示", body: "棋盘下方的文件图标可以新建空白棋局，标签图标可以快速添加标注。" },
  "library-search": { title: "棋谱库搜索", body: "这里的搜索会同时覆盖棋谱、题集和题目内容。" },
  "settings-groups": { title: "设置已分类", body: "设置按功能折叠收纳，展开需要调整的分组即可。" },
};

export function CoachMark({ id, onAction }: { id: CoachMarkId; onAction: (action: CoachMarkAction) => void }) {
  const item = content[id];
  return <aside className={`coach-mark coach-mark-${id}`} role="dialog" aria-label={item.title}>
    <span className="coach-mark-icon"><Lightbulb size={17}/></span>
    <div className="coach-mark-copy"><b>{item.title}</b><p>{item.body}</p></div>
    <button className="coach-mark-close" type="button" onClick={() => onAction("dismiss")} aria-label="不再提示"><X size={14}/></button>
    <div className="coach-mark-actions"><button type="button" onClick={() => onAction("acknowledge")}>知道了</button><button type="button" onClick={() => onAction("later")}>稍后</button></div>
  </aside>;
}
