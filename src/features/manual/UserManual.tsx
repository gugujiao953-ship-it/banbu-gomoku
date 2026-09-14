import { useEffect, useState } from "react";
import {
  ArchiveRestore, BookOpen, Bot, Check, ChevronDown, ChevronLeft, CircleHelp, Download, Eye, FilePlus2,
  FolderOpen, GitBranch, Home, Info, Library, ListTree, MessageSquareText, Palette, Play,
  Save, Settings, Tag, Undo2, Upload, X,
} from "lucide-react";
import type { ManualIconName } from "./manual-types";
import { manualSections } from "./sections";

function ManualIcon({ name }: { name: ManualIconName }) {
  const props = { size: 20, strokeWidth: 2 };
  if (name === "home") return <Home {...props}/>;
  if (name === "new") return <FilePlus2 {...props}/>;
  if (name === "save") return <Save {...props}/>;
  if (name === "import") return <Download {...props}/>;
  if (name === "export") return <Upload {...props}/>;
  if (name === "library") return <Library {...props}/>;
  if (name === "folder") return <FolderOpen {...props}/>;
  if (name === "comment") return <MessageSquareText {...props}/>;
  if (name === "mark") return <Tag {...props}/>;
  if (name === "branch") return <GitBranch {...props}/>;
  if (name === "tree") return <ListTree {...props}/>;
  if (name === "ai") return <Bot {...props}/>;
  if (name === "undo") return <Undo2 {...props}/>;
  if (name === "backup") return <ArchiveRestore {...props}/>;
  if (name === "settings") return <Settings {...props}/>;
  if (name === "review") return <Eye {...props}/>;
  if (name === "palette") return <Palette {...props}/>;
  if (name === "help") return <CircleHelp {...props}/>;
  return <Info {...props}/>;
}

export function UserManual({ onClose, onOpenRules, onStartGuide, focusSection }: { onClose: () => void; onOpenRules?: () => void; onStartGuide?: (index: number) => void; focusSection?: number | null }) {
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  // 引导完成后回到手册并展开对应章节（原生 summary click 保持 details 受控状态不受影响）
  useEffect(() => {
    if (focusSection == null) return;
    const item = document.querySelectorAll<HTMLDetailsElement>(".manual-item")[focusSection];
    const summary = item?.querySelector("summary");
    if (item && !item.open && summary) summary.click();
  }, [focusSection]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  return <div className="sheet-body manual-sheet">
    <div className="manual-intro"><span className="manual-intro-icon"><BookOpen size={24}/></span><div><b>别担心，跟着做一遍就会了</b><p>不用一次看完所有内容。第一次使用建议先读第 01、03、04 节；遇到具体问题时，再回来展开对应章节。功能点旁的小图可点击放大，直观看到每个界面长什么样。</p></div></div>
    <div className="manual-icon-legend"><span>常用图标</span><div><span><Home size={15}/>主界面</span><span><Save size={15}/>保存</span><span><Download size={15}/>导入</span><span><Bot size={15}/>AI</span><span><Settings size={15}/>设置</span></div></div>
    <div className="manual-list">{manualSections.map((section, index) => <details className="manual-item" key={section.title}><summary><span className="manual-icon-shot"><ManualIcon name={section.icon}/></span><span className="manual-summary-copy"><b>{String(index + 1).padStart(2, "0")} · {section.title}</b><small>{section.summary}</small></span><button type="button" className="manual-guide-entry" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onStartGuide?.(index); }} aria-label={`引导：${section.title}`} title="跟着引导走一遍（会跳到对应功能），完成后回到这里"><Play size={13}/>引导</button><ChevronDown className="manual-chevron" size={18}/></summary><div className="manual-item-body">
      <div className="manual-feature-list"><b>这里可以做什么</b>{section.features.map((feature, featureIndex) => <div className="manual-feature" key={feature.title}><span>{featureIndex + 1}</span><p><b>{feature.title}</b><small>{feature.text}</small></p>{feature.image && <button type="button" className="manual-feature-thumb" onClick={() => setZoom({ src: feature.image!, caption: feature.title })} aria-label={`查看 ${feature.title} 截图`}><img src={feature.image} alt={`${feature.title}界面`} loading="lazy" decoding="async"/><span className="manual-thumb-hint"><Eye size={11}/>点击放大</span></button>}</div>)}</div>
      <div className="manual-steps"><b>跟着做</b><ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      <div className="manual-tip"><Info size={15}/><span><b>贴心提示</b>{section.tip}</span></div>
      {section.ruleEntry && onOpenRules && <button type="button" className="manual-rule-entry" onClick={onOpenRules}><CircleHelp size={16}/>打开完整规则说明</button>}
    </div></details>)}</div>
  {zoom && <div className="manual-lightbox" role="dialog" aria-label={`${zoom.caption} 截图`} onClick={() => setZoom(null)}><button type="button" className="manual-lightbox-close" aria-label="关闭大图" onClick={() => setZoom(null)}><X size={20}/></button><figure onClick={(event) => event.stopPropagation()}><img src={zoom.src} alt={`${zoom.caption}界面大图`}/><figcaption>{zoom.caption}</figcaption></figure></div>}
  <button className="primary-button" onClick={onClose}><Check/>看完了，开始使用</button>
  </div>;
}
