import { useMemo, useState } from "react";
import { Bug, Code2, Lightbulb, Mail, MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_EMAIL,
  buildFeedbackBody,
  buildGithubIssueUrl,
  buildMailtoUrl,
  feedbackKindLabel,
  isValidFeedbackEmail,
  loadFeedbackContact,
  saveFeedbackContact,
  type FeedbackKind,
} from "./feedback";

const KIND_OPTIONS: Array<{ value: FeedbackKind; label: string; hint: string }> = [
  { value: "bug", label: "遇到问题", hint: "功能异常、崩溃或显示错误" },
  { value: "suggestion", label: "功能建议", hint: "希望增加或改进的体验" },
  { value: "other", label: "其他反馈", hint: "内容、版权或其他联系" },
];

export function FeedbackPanel({ version, location, onNotice }: { version: string; location: string; onNotice: (message: string) => void }) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState(loadFeedbackContact);
  const context = useMemo(() => ({ version, location, userAgent: navigator.userAgent }), [version, location]);
  const draft = { kind, message: message.trim(), contactEmail: contactEmail.trim() };
  const emailInvalid = Boolean(contactEmail.trim()) && !isValidFeedbackEmail(contactEmail);
  const ready = draft.message.length >= 5 && !emailInvalid;

  const rememberContact = () => saveFeedbackContact(contactEmail);
  const openGithub = () => {
    if (!ready) return;
    rememberContact();
    window.open(buildGithubIssueUrl(draft, context), "_blank", "noopener,noreferrer");
    onNotice("已打开 GitHub Issue，请确认内容后提交");
  };
  const openEmail = () => {
    if (!ready || !FEEDBACK_EMAIL) return;
    rememberContact();
    window.location.href = buildMailtoUrl(draft, context, FEEDBACK_EMAIL);
    onNotice("已调用系统邮件应用，请确认内容后发送");
  };
  const copyFeedback = async () => {
    if (!ready) return;
    rememberContact();
    const text = `${feedbackKindLabel(kind)}\n\n${buildFeedbackBody(draft, context)}`;
    try {
      await navigator.clipboard.writeText(text);
      onNotice("反馈内容已复制");
    } catch {
      onNotice("浏览器未允许复制，请使用邮件或 GitHub");
    }
  };

  return <div className="sheet-body feedback-sheet">
    <section className="feedback-intro"><MessageSquareText/><div><b>把问题和想法告诉我</b><span>应用只会生成反馈文本；点击发送前不会上传棋局、文件或设备数据。</span></div></section>
    <fieldset className="feedback-kind"><legend>反馈类型</legend>{KIND_OPTIONS.map((option) => <button key={option.value} type="button" className={kind === option.value ? "selected" : ""} onClick={() => setKind(option.value)} aria-pressed={kind === option.value}>{option.value === "bug" ? <Bug/> : option.value === "suggestion" ? <Lightbulb/> : <MessageSquareText/>}<span><b>{option.label}</b><small>{option.hint}</small></span></button>)}</fieldset>
    <label className="feedback-message"><span>具体内容 <em>{message.length}/1200</em></span><textarea autoFocus rows={7} maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="请描述发生了什么、你期望怎样改进；如果是问题，可以写一下复现步骤。"/><small className={message.length > 0 && message.trim().length < 5 ? "error" : ""}>{message.length > 0 && message.trim().length < 5 ? "请至少输入 5 个字" : "越具体越容易定位和改进"}</small></label>
    <label className="feedback-contact"><span>回复邮箱（可选）</span><input type="email" inputMode="email" autoComplete="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="如果希望收到回复，可以填写"/><small className={emailInvalid ? "error" : ""}>{emailInvalid ? "邮箱格式不正确" : "仅写入本次反馈并保存在本机，不会自动发送"}</small></label>
    <section className="feedback-actions" aria-label="发送方式">
      <button type="button" className="feedback-github" disabled={!ready} onClick={openGithub}><Code2/><span><b>提交到 GitHub</b><small>打开预填好的 New Issue 页面</small></span><Send/></button>
      <button type="button" className="feedback-email" disabled={!ready || !FEEDBACK_EMAIL} onClick={openEmail}><Mail/><span><b>通过邮件发送</b><small>{FEEDBACK_EMAIL ? "调用系统默认邮件应用" : "构建时尚未配置接收邮箱"}</small></span><Send/></button>
      <button type="button" className="secondary-button feedback-copy" disabled={!ready} onClick={() => { void copyFeedback(); }}>复制反馈文字</button>
    </section>
    <p className="feedback-privacy">自动附带：应用版本、当前页面和浏览器设备信息。不会附带当前棋谱内容、导入文件、存储数据或诊断日志。</p>
  </div>;
}
