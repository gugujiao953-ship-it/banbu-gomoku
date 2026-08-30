export type FeedbackKind = "bug" | "suggestion" | "other";

export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  contactEmail?: string;
}

export interface FeedbackContext {
  version: string;
  userAgent: string;
  location: string;
}

export const FEEDBACK_CONTACT_KEY = "banbu-feedback-contact-v1";
export const GITHUB_ISSUES_URL = "https://github.com/gugujiao953-ship-it/banbu-gomoku/issues/new";
export const FEEDBACK_EMAIL = String(import.meta.env.VITE_FEEDBACK_EMAIL || "").trim();

export const feedbackKindLabel = (kind: FeedbackKind) => {
  if (kind === "bug") return "问题反馈";
  if (kind === "suggestion") return "功能建议";
  return "其他反馈";
};

export const isValidFeedbackEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const loadFeedbackContact = () => {
  try { return localStorage.getItem(FEEDBACK_CONTACT_KEY) || ""; } catch { return ""; }
};

export const saveFeedbackContact = (value: string) => {
  try {
    const normalized = value.trim();
    if (normalized) localStorage.setItem(FEEDBACK_CONTACT_KEY, normalized);
    else localStorage.removeItem(FEEDBACK_CONTACT_KEY);
  } catch { /* feedback convenience state is optional */ }
};

export const buildFeedbackBody = (draft: FeedbackDraft, context: FeedbackContext) => [
  `反馈类型：${feedbackKindLabel(draft.kind)}`,
  "",
  draft.message.trim(),
  "",
  "--- 环境信息 ---",
  `版本：${context.version}`,
  `页面：${context.location}`,
  `设备：${context.userAgent || "未知"}`,
  draft.contactEmail?.trim() ? `回复邮箱：${draft.contactEmail.trim()}` : "",
].filter(Boolean).join("\n");

export const buildFeedbackSubject = (kind: FeedbackKind) => `[半步五子棋] ${feedbackKindLabel(kind)}`;

export const buildMailtoUrl = (draft: FeedbackDraft, context: FeedbackContext, destinationEmail: string) => {
  const subject = buildFeedbackSubject(draft.kind);
  const body = buildFeedbackBody(draft, context);
  return `mailto:${encodeURIComponent(destinationEmail.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export const buildGithubIssueUrl = (draft: FeedbackDraft, context: FeedbackContext) => {
  const body = buildFeedbackBody(draft, context);
  return `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(buildFeedbackSubject(draft.kind))}&body=${encodeURIComponent(body)}`;
};
