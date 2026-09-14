/**
 * 快捷中心自定义：可选条目池 + 本机持久化。
 *
 * 铁律（用户 2026-09-10 要求）：**快捷中心里能出现的每一项，设置页里必须也有同一项**。
 * 因此池子里每项都带 `settingsLabel`（设置页里的可见文字，用于门禁逐项核对）；
 * 往池子里加新项之前，先在设置页把对应行加上。
 *
 * 2026-09-10 复选 7（用户）：条目池扩到「所有设置里有的」，默认仍只显示常用项；
 * 每个主功能目录（section）带一键「全部显示/全部隐藏」开关。
 */

export type QuickDrawerSectionId = "entry" | "playback" | "analysis" | "visual" | "board" | "accessibility" | "data" | "misc";

export interface QuickDrawerItem {
  id: string;
  section: QuickDrawerSectionId;
  /** 快捷中心里的标题（与设置页口径统一） */
  label: string;
  /** 一句话说明 */
  hint: string;
  /** 设置页里对应条目的可见文字（任一条命中即可，用于门禁核对「设置里也有」） */
  settingsLabel: string[];
  /** 默认是否显示（未勾选自定义时）。旧存档未知 id 自动失效后，这里决定新用户看到的默认项。 */
  defaultVisible?: boolean;
}

export const QUICK_DRAWER_SECTIONS: ReadonlyArray<{ id: QuickDrawerSectionId; title: string }> = [
  { id: "entry", title: "入口" },
  { id: "playback", title: "自动演示" },
  { id: "analysis", title: "分析" },
  { id: "visual", title: "外观与声音" },
  { id: "board", title: "棋盘显示" },
  { id: "accessibility", title: "无障碍" },
  { id: "data", title: "数据" },
  { id: "misc", title: "手册与其他" },
];

export const QUICK_DRAWER_ITEMS: ReadonlyArray<QuickDrawerItem> = [
  // ── 入口 ──
  { id: "entry.layout", section: "entry", label: "功能区布局", hint: "打开三区布局编辑器", settingsLabel: ["功能区布局"], defaultVisible: true },

  // ── 自动演示 ──
  { id: "playback.speed", section: "playback", label: "播放速度", hint: "每步之间的等待时间", settingsLabel: ["播放速度"], defaultVisible: true },
  { id: "playback.branch", section: "playback", label: "分支处理", hint: "遇到多个后续时的行为", settingsLabel: ["分支处理"], defaultVisible: true },
  { id: "playback.loop", section: "playback", label: "循环当前变化", hint: "到末尾后回到本次播放起点继续", settingsLabel: ["循环当前变化"], defaultVisible: true },

  // ── 分析（默认全显）──
  { id: "analysis.engine", section: "analysis", label: "分析引擎", hint: "轻量快速 / 强力深度", settingsLabel: ["分析引擎"], defaultVisible: true },
  { id: "analysis.indicator", section: "analysis", label: "思考显示位置", hint: "棋盘右上角 / 棋盘下方", settingsLabel: ["思考显示位置"], defaultVisible: true },
  { id: "analysis.candidates", section: "analysis", label: "棋盘显示实时选点", hint: "只显示在空位上，不会落子或写入棋谱", settingsLabel: ["棋盘显示实时选点"], defaultVisible: true },
  { id: "analysis.metric", section: "analysis", label: "候选点显示内容", hint: "胜率、评估分、计算量或深度", settingsLabel: ["候选点显示内容"], defaultVisible: true },
  { id: "analysis.count", section: "analysis", label: "候选点数量", hint: "默认只显示最佳点，最多 10 选", settingsLabel: ["候选点数量"], defaultVisible: true },
  { id: "analysis.mode", section: "analysis", label: "分析模式", hint: "持续 / 自对弈 / 提示", settingsLabel: ["分析模式"], defaultVisible: true },
  { id: "analysis.selfplayTime", section: "analysis", label: "自对弈每步时限", hint: "到点即落子，五连或满盘自动结束", settingsLabel: ["自对弈每步时限"], defaultVisible: true },
  { id: "analysis.memory", section: "analysis", label: "分析内存档", hint: "自动 / 256M / 512M / 1G / 2G，档位越高长分析越深", settingsLabel: ["分析内存档"], defaultVisible: true },

  // ── 外观与声音（默认全显）──
  { id: "visual.theme", section: "visual", label: "应用主题", hint: "页面颜色与氛围", settingsLabel: ["主题"], defaultVisible: true },
  { id: "visual.board", section: "visual", label: "棋盘", hint: "棋盘材质与网格", settingsLabel: ["棋盘"], defaultVisible: true },
  { id: "visual.stone", section: "visual", label: "棋子", hint: "黑白棋子的视觉样式", settingsLabel: ["棋子"], defaultVisible: true },
  { id: "visual.boardSize", section: "visual", label: "默认棋盘大小", hint: "新建棋谱时使用的路数", settingsLabel: ["默认棋盘大小"], defaultVisible: true },
  { id: "visual.sound", section: "visual", label: "声音与音效", hint: "音量、音效开关与落子音色", settingsLabel: ["声音与音效"], defaultVisible: true },

  // ── 棋盘显示（默认显示，用户 09-13）──
  { id: "board.numbers", section: "board", label: "显示手数", hint: "在棋子上显示落子序号", settingsLabel: ["显示手数"], defaultVisible: true },
  { id: "board.coordinates", section: "board", label: "显示坐标", hint: "棋盘边缘显示 A–O / 1–15", settingsLabel: ["显示坐标"], defaultVisible: true },
  { id: "board.forbidden", section: "board", label: "禁手辅助", hint: "提示黑方常见三三、四四与长连", settingsLabel: ["禁手辅助"], defaultVisible: true },
  { id: "board.lastMove", section: "board", label: "最后一手标记", hint: "最新一手显示红点", settingsLabel: ["最后一手标记"], defaultVisible: true },
  { id: "board.numberScale", section: "board", label: "棋子序号大小", hint: "0.7×–1.8× 缩放序号", settingsLabel: ["棋子序号大小"] },
  { id: "board.gridWidth", section: "board", label: "棋盘画线粗细", hint: "0.6–3px 线宽", settingsLabel: ["棋盘画线粗细"] },
  { id: "board.coordFont", section: "board", label: "坐标字体大小", hint: "6–14px", settingsLabel: ["坐标字体大小"] },

  // ── 无障碍（新增，默认隐藏）──
  { id: "accessibility.font", section: "accessibility", label: "界面字号", hint: "正常 / 大字 / 特大字", settingsLabel: ["界面字号", "大字", "特大字"] },

  // ── 数据（新增，默认隐藏）──
  { id: "data.restore", section: "data", label: "退出后恢复上次局面", hint: "下次进入时恢复上次棋谱与节点", settingsLabel: ["退出后恢复上次局面"] },
  { id: "data.import", section: "data", label: "导入棋谱", hint: "SGF / JSON / LIB / DP / DB", settingsLabel: ["导入棋谱"] },
  { id: "data.export", section: "data", label: "导出棋谱", hint: "原始格式或完整 SGF / JSON", settingsLabel: ["导出棋谱"] },
  { id: "data.backup", section: "data", label: "一键备份", hint: "棋谱库、题库、进度、草稿与设置", settingsLabel: ["一键备份"] },
  { id: "data.restoreBackup", section: "data", label: "恢复备份", hint: "导入前完整校验，失败自动回滚", settingsLabel: ["恢复备份"] },
  { id: "data.help", section: "data", label: "格式兼容说明", hint: "各格式的可写能力与保真范围", settingsLabel: ["格式兼容说明"] },

  // ── 手册与其他（新增，默认隐藏）──
  { id: "misc.tour", section: "misc", label: "新手引导", hint: "spotlight 再走一遍核心功能", settingsLabel: ["新手引导"] },
  { id: "misc.manual", section: "misc", label: "使用手册", hint: "逐项了解棋盘、棋谱库、题库与 AI", settingsLabel: ["使用手册"] },
  { id: "misc.feedback", section: "misc", label: "反馈问题或建议", hint: "邮件或 GitHub Issue", settingsLabel: ["反馈问题或建议"] },
  { id: "misc.about", section: "misc", label: "关于与更新", hint: "版本、检查更新与项目说明", settingsLabel: ["关于半步五子棋打谱"] },
];

const QUICK_DRAWER_STORAGE_KEY = "banbu-quick-drawer-v1";

export interface QuickDrawerPrefs {
  /** 被隐藏的条目 id；空数组 = 全部显示（默认） */
  hidden: string[];
  /** 自定义排序（用户 09-13）：条目 id 的优先序列；未列出的按池子默认顺序排在后面。 */
  order?: string[];
  /** 主目录排序（用户 09-13）：分区 id 的优先序列；未列出的按默认顺序排在后面。 */
  sectionOrder?: QuickDrawerSectionId[];
  /** 自定义存储版本：2 = 已完成「新增条目默认隐藏」迁移，此后不再对用户
   * 主动取消隐藏的默认隐藏项做回补（用户显示即显示）。 */
  v?: number;
}

const PREFS_VERSION = 2;

const DEFAULT_HIDDEN = QUICK_DRAWER_ITEMS.filter((item) => !item.defaultVisible).map((item) => item.id);

export const DEFAULT_QUICK_DRAWER_PREFS: QuickDrawerPrefs = { hidden: DEFAULT_HIDDEN, v: PREFS_VERSION };

const KNOWN_IDS = new Set(QUICK_DRAWER_ITEMS.map((item) => item.id));

const KNOWN_SECTIONS = new Set(QUICK_DRAWER_SECTIONS.map((section) => section.id));

const normalizeSectionOrder = (value: unknown): QuickDrawerSectionId[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is QuickDrawerSectionId => typeof id === "string" && KNOWN_SECTIONS.has(id as QuickDrawerSectionId))));
};

const normalizeOrder = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  // 只保留已知 id、去重；未列出的条目由 orderQuickDrawerItems 追加在末尾。
  return Array.from(new Set(value.filter((id): id is string => typeof id === "string" && KNOWN_IDS.has(id))));
};

export const normalizeQuickDrawerPrefs = (value: unknown): QuickDrawerPrefs => {
  if (!value || typeof value !== "object") return { ...DEFAULT_QUICK_DRAWER_PREFS };
  const order = normalizeOrder((value as { order?: unknown }).order);
  const sectionOrder = normalizeSectionOrder((value as { sectionOrder?: unknown }).sectionOrder);
  const raw = (value as { hidden?: unknown }).hidden;
  if (!Array.isArray(raw)) return { ...DEFAULT_QUICK_DRAWER_PREFS };
  const version = (value as { v?: unknown }).v;
  // 只保留已知 id（旧版本存的、或已删除的条目自动失效）。
  const kept = Array.from(new Set(raw.filter((id): id is string => typeof id === "string" && KNOWN_IDS.has(id))));
  if (version === PREFS_VERSION) {
    // 已迁移：完全信任用户列表（用户取消隐藏的默认隐藏项保持显示）。
    return { hidden: kept, order, sectionOrder, v: PREFS_VERSION };
  }
  // v1 或未知版本 → 首次迁移：新加入的条目（从未出现在 hidden 里）按默认可见性补齐。
  const added = QUICK_DRAWER_ITEMS.filter((item) => !kept.includes(item.id) && !raw.includes(item.id));
  const newlyHidden = added.filter((item) => !item.defaultVisible).map((item) => item.id);
  return { hidden: [...kept, ...newlyHidden], order, sectionOrder, v: PREFS_VERSION };
};

export const loadQuickDrawerPrefs = (): QuickDrawerPrefs => {
  try {
    const stored = window.localStorage.getItem(QUICK_DRAWER_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_QUICK_DRAWER_PREFS };
    return normalizeQuickDrawerPrefs(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_QUICK_DRAWER_PREFS };
  }
};

export const saveQuickDrawerPrefs = (prefs: QuickDrawerPrefs) => {
  try {
    const next = normalizeQuickDrawerPrefs({ hidden: prefs.hidden, order: prefs.order, sectionOrder: prefs.sectionOrder, v: PREFS_VERSION });
    window.localStorage.setItem(QUICK_DRAWER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时保持内存态即可，不打断使用
  }
};

export const isQuickDrawerItemVisible = (prefs: QuickDrawerPrefs, id: string) => !prefs.hidden.includes(id);

/** 依用户自定义顺序重排条目（未列出的按池子默认序追加），同目录内生效。 */
export const orderQuickDrawerItems = <T extends { id: string }>(items: readonly T[], order: string[] | undefined): T[] => {
  if (!order?.length) return [...items];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
};

/** 把 id 移动到 targetId 之前/之后（同目录内排序，落盘 order 为全局扁平序列）。 */
export const moveQuickDrawerItem = (prefs: QuickDrawerPrefs, id: string, targetId: string, position: "before" | "after"): QuickDrawerPrefs => {
  if (id === targetId) return prefs;
  const flat = orderQuickDrawerItems(QUICK_DRAWER_ITEMS, prefs.order).map((item) => item.id);
  const from = flat.indexOf(id);
  if (from < 0) return prefs;
  flat.splice(from, 1);
  const at = flat.indexOf(targetId);
  if (at < 0) return prefs;
  flat.splice(position === "after" ? at + 1 : at, 0, id);
  return { ...prefs, order: flat, v: prefs.v ?? PREFS_VERSION };
};

export const toggleQuickDrawerItem = (prefs: QuickDrawerPrefs, id: string): QuickDrawerPrefs => ({
  hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((item) => item !== id) : [...prefs.hidden, id],
  v: prefs.v ?? PREFS_VERSION,
});

/** 按用户顺序重排主目录。 */
export const orderQuickDrawerSections = <T extends { id: QuickDrawerSectionId }>(sections: readonly T[], sectionOrder: QuickDrawerSectionId[] | undefined): T[] => {
  if (!sectionOrder?.length) return [...sections];
  const rank = new Map(sectionOrder.map((id, index) => [id, index]));
  return [...sections].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
};

/** 移动主目录到目标目录之前（落盘 sectionOrder）。 */
export const moveQuickDrawerSection = (prefs: QuickDrawerPrefs, id: QuickDrawerSectionId, targetId: QuickDrawerSectionId): QuickDrawerPrefs => {
  if (id === targetId) return prefs;
  const flat = orderQuickDrawerSections(QUICK_DRAWER_SECTIONS, prefs.sectionOrder).map((section) => section.id);
  const from = flat.indexOf(id);
  if (from < 0) return prefs;
  flat.splice(from, 1);
  const at = flat.indexOf(targetId);
  if (at < 0) return prefs;
  flat.splice(at, 0, id);
  return { ...prefs, sectionOrder: flat, v: prefs.v ?? PREFS_VERSION };
};

/** 某目录下所有条目 id（用于一键全显/全隐）。 */
export const quickDrawerSectionItemIds = (section: QuickDrawerSectionId): string[] =>
  QUICK_DRAWER_ITEMS.filter((item) => item.section === section).map((item) => item.id);

/** 一键开关目录：全隐 ⇄ 全显（返回新的 prefs）。 */
export const toggleQuickDrawerSection = (prefs: QuickDrawerPrefs, section: QuickDrawerSectionId): QuickDrawerPrefs => {
  const ids = quickDrawerSectionItemIds(section);
  const allHidden = ids.every((id) => prefs.hidden.includes(id));
  if (allHidden) {
    // 全部隐藏 → 全部显示
    return { hidden: prefs.hidden.filter((id) => !ids.includes(id)), v: prefs.v ?? PREFS_VERSION };
  }
  // 至少一个显示 → 全部隐藏
  return { hidden: Array.from(new Set([...prefs.hidden, ...ids])), v: prefs.v ?? PREFS_VERSION };
};
