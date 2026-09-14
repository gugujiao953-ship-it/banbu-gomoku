/** 使用手册的数据形状。章节内容按章放在 sections/ 下，这里只留类型。 */
export type ManualIconName = "home" | "new" | "save" | "import" | "export" | "library" | "folder" | "comment" | "mark" | "branch" | "tree" | "ai" | "undo" | "backup" | "settings" | "review" | "palette" | "help" | "info";

export interface ManualSection {
  icon: ManualIconName;
  title: string;
  summary: string;
  features: Array<{ title: string; text: string; image?: string }>;
  steps: string[];
  tip: string;
  ruleEntry?: boolean;
}
