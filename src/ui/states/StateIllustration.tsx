type StateVariant = "library" | "puzzle" | "search" | "loading" | "error";

const copy: Record<StateVariant, { title: string; description: string }> = {
  library: { title: "空棋谱库", description: "导入棋谱，或从空棋盘开始记录。" },
  puzzle: { title: "空题库", description: "导入题库后，就可以开始练习。" },
  search: { title: "没有找到结果", description: "换一个关键词，或清除搜索条件再试。" },
  loading: { title: "正在加载", description: "内容准备好后会自动显示。" },
  error: { title: "暂时无法加载", description: "请稍后重试，已有内容不会受到影响。" },
};

export function StateIllustration({ variant, title, description }: { variant: StateVariant; title?: string; description?: string }) {
  const text = copy[variant];
  return <div className={`state-illustration state-illustration-${variant}`} role="status" aria-label={title || text.title}>
    <svg viewBox="0 0 96 76" aria-hidden="true" focusable="false">
      <rect x="13" y="14" width="70" height="48" rx="12" className="state-paper"/>
      <path d="M27 29h42M27 39h27M27 49h35" className="state-line"/>
      {variant === "library" && <><circle cx="65" cy="48" r="9" className="state-accent-fill"/><path d="m61 48 3 3 6-7" className="state-check"/></>}
      {variant === "puzzle" && <><circle cx="48" cy="46" r="12" className="state-accent-fill"/><path d="M48 38v16M40 46h16" className="state-symbol"/></>}
      {variant === "search" && <><circle cx="46" cy="39" r="11" className="state-accent-outline"/><path d="m54 47 10 10" className="state-symbol"/><path d="m42 35 8 8M50 35l-8 8" className="state-cross"/></>}
      {variant === "loading" && <><circle cx="48" cy="45" r="13" className="state-spinner-track"/><path d="M48 32a13 13 0 0 1 12 8" className="state-spinner"/></>}
      {variant === "error" && <><path d="M48 30 63 56H33Z" className="state-warning"/><path d="M48 39v8M48 51v1" className="state-warning-mark"/></>}
    </svg>
    <b>{title || text.title}</b>
    <span>{description || text.description}</span>
  </div>;
}
