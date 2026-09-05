import { BookOpen, Check, FileInput, MessageCircle, Palette, ScanLine, Smartphone, Sparkles } from "lucide-react";
import { GITHUB_RELEASES_URL } from "../../update-check";

const GITHUB_PROJECT_URL = GITHUB_RELEASES_URL.replace(/\/releases$/, "");

export function FirstRunWelcome({ onDismiss, onOpenManual }: { onDismiss: () => void; onOpenManual: () => void }) {
  return <div className="first-run-backdrop" role="presentation">
    <section className="first-run-dialog" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
      <div className="first-run-icon"><Sparkles/></div>
      <p className="first-run-eyebrow">欢迎使用</p>
      <h2 id="first-run-title">欢迎来到半步五子棋打谱</h2>
      <p id="first-run-description">一款为手机操作认真设计的五子棋打谱、读谱与研究工具。无论是随手记录一盘棋，还是整理自己的棋谱资料，都可以从这里开始。</p>
      <div className="first-run-feature-list" aria-label="主要功能">
        <div><Smartphone/><span><b>手机端打谱</b><small>紧凑棋盘与触控操作，随时记录、浏览变化</small></span></div>
        <div><FileInput/><span><b>多格式导入</b><small>支持 SGF、LIB、DP、DB、JSON、POS 等格式</small></span></div>
        <div><ScanLine/><span><b>图片识谱</b><small>从棋盘截图识别黑白棋子，再检查并保存</small></span></div>
        <div><Palette/><span><b>丰富外观</b><small>多种主题、棋盘、棋子、透明度与标注高亮</small></span></div>
        <div><MessageCircle/><span><b>交流与帮助</b><small>加入 QQ 群 1091866163，交流使用心得、反馈问题；也可访问 <a className="first-run-github-link" href={GITHUB_PROJECT_URL} target="_blank" rel="noreferrer">GitHub 项目仓库</a></small></span></div>
      </div>
      <p className="first-run-reassurance">第一次使用不用急着全部学会。点击“使用手册”，跟着步骤做一遍就能上手；以后也可以随时从设置里重新打开。</p>
      <div className="first-run-actions">
        <button className="primary-button" onClick={onOpenManual}><BookOpen/>带我看看怎么用</button>
        <button className="secondary-button" onClick={onDismiss}><Check/>先自己试试</button>
      </div>
    </section>
  </div>;
}
