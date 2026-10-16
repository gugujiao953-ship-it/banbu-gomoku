import { BookOpen, Check, Compass, FileInput, MessageCircle, Palette, ScanLine, Smartphone, ClipboardList } from "lucide-react";
import { GITHUB_RELEASES_URL } from "../../update-check";
import { OverlayBrandMark, OverlayPattern } from "../../ui/overlays/OverlayBrand";

const GITHUB_PROJECT_URL = GITHUB_RELEASES_URL.replace(/\/releases$/, "");

/**
 * 每次换版本都会再弹一次（`onboarding.ts` 把「已读」记成版本号，见 shouldShowFirstRunWelcome）。
 * 右上角那枚「本版本更新了什么」就是给这个场景用的（用户 2026-10-01）：更新完先告诉他
 * 这一版动了什么，而不是让他自己去翻发布页。点了会关掉弹窗并跳到「关于 → 更新内容」。
 *
 * ## 这里为什么**不放**凭证入口（2026-10-11 用户指定）
 *
 * R169 曾经在这张卡上加过一枚「我有本机凭证」（理由是"重装后第一件事是拿回数据"）。
 * 用户看过之后要求去掉：**新手提示只负责"带新人上手"**，
 * 而"导入凭证"是装过的人才会用的事 —— 它该待在设置里的固定位置，
 * 不该混在欢迎新人的三个按钮里（那三个都是"从这里开始用"的语义）。
 *
 * 所以这张卡回到**三个出口**：新手引导 / 阅读使用手册 / 先自己试试。
 * 回「导入凭证」的路径是：设置 → 数据与兼容 → 本机凭证（手册第 15 章也写了）。
 */
export function FirstRunWelcome({ onDismiss, onOpenManual, onStartTour, onOpenReleaseNotes }: { onDismiss: () => void; onOpenManual: () => void; onStartTour: () => void; onOpenReleaseNotes?: () => void }) {
  return <div className="first-run-backdrop" role="presentation">
    <section className="first-run-dialog" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
      <div className="welcome-decoration" aria-hidden="true"><OverlayPattern/></div>
      {/* 调用方没接这个回调时（例如某条路径还没接线）就不渲染入口，而不是给一枚点了没反应的按钮
          ——那是改造表 R93 里画中画那个教训的正面做法。 */}
      {onOpenReleaseNotes && (
        <button type="button" className="first-run-updates" data-first-run-updates="" onClick={onOpenReleaseNotes}>
          <ClipboardList size={14}/>本版本更新了什么
        </button>
      )}
      <div className="first-run-content">
        <div className="first-run-art"><OverlayBrandMark/></div>
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
        <p className="first-run-reassurance">第一次使用不用急着全部学会。先来一遍「新手引导」——高亮带你认全每个按钮；想随时重看，设置里“使用手册与反馈”区都留着入口。</p>
      </div>
      <div className="first-run-actions">
        <button className="primary-button" onClick={onStartTour}><Compass/>新手引导</button>
        <button className="secondary-button" onClick={onOpenManual}><BookOpen/>阅读使用手册</button>
        <button className="secondary-button" onClick={onDismiss}><Check/>先自己试试</button>
      </div>
    </section>
  </div>;
}
