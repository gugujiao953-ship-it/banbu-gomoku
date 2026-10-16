/**
 * 成就的「一次性信号位」存储（用户 2026-10-09）。
 *
 * ## 为什么需要它
 *
 * `achievements.ts` 的设计口径是**只读已有账本、不新增埋点**。但有些成就天然没有账本：
 * 「打开过使用手册」「导出过棋谱」「用过 10 种主题」「造出过图案题」——这些动作
 * 发生完什么痕迹都不留。这一层就是给它们留的最小痕迹：一个**只增不减**的键值集合。
 *
 * ## 与账本来源的边界
 *
 * 有账本可查的一律**不**进这里（对弈、做题、VCF、复盘、识谱计数都在各自模块里）。
 * 这里只放"没有别的地方记"的事实。判断标准：如果删掉这个文件里的某个字段，
 * 能不能从别处恢复出来？能 —— 那它不该在这里。
 *
 * ## 口径
 *
 * - **只增不减**：计数类取最大值、集合类取并集、布尔类一旦为真不再变假
 *   （`recordAchievementSignals` 的合并逻辑保证这一点）。
 * - **不进备份**：这是可达性信号，不是用户资产。换机后重新触发即可；
 *   放进去反而会让备份里多出一堆没人看得懂的内部字段
 *   （对照 `backup.ts` 里那些"必须进备份"的用户资产：收藏、进度、账本）。
 * - **读失败一律当空**：它只是成就判定的输入之一，坏了就是少解锁几条，不能连累主流程。
 */

export const ACHIEVEMENT_SIGNAL_KEY = "banbu-achievement-signals-v1";

export interface AchievementSignals {
  // ── 计数类（取最大） ──
  /** 累计成功识谱张数 */
  recognitionCount?: number;
  /** 识别过的最大手数（判断 50 手 / 225 手两条成就） */
  recognitionMaxMoves?: number;
  /** 棋谱库里累计见过多少种连珠开局（`explore-openings-26` 用） */
  openingKinds?: number;
  /** 变化树里的分支总数（打开棋谱时顺手统计） */
  branchCount?: number;
  /** 「每日一题」累计完成次数（**不是连续天数**——打卡那套已被用户删掉） */
  dailyDoneCount?: number;
  /** 生成器造出过的最深手数 */
  generatorMaxDepth?: number;
  /** 生成器**累计造出**的题目数（只增不减：每保存一批就加上那一批的数量） */
  generatorCount?: number;
  /**
   * 累计点魂火次数（用户 2026-10-10：「点击棋魂也算成就，1下，99下，299下……9999下」）。
   *
   * 这是**唯一一个"动作本身就是成就"**的计数：点魂火除了加余额什么都不做，
   * 所以它量的就是"你愿意在这儿待多久"。九档梯度（1/99/299/…/9999）见 catalog。
   *
   * 为什么不从账本里数 `reason === "manual"` 的条数：
   *  · 账本超上限会被折叠成 carry（那些点击就数不到了，成就永远够不着）；
   *  · 连点会被 `tapCountsAsEarned` 影响统计口径（那是"算不算钱"，与"点了多少下"无关）。
   * 所以它必须是独立的、只增不减的计数。
   */
  tapCount?: number;
  /** 买过任何棋魂解锁项（`explore-unlock-first` 用）。存的是**数量**，>0 即为真。 */
  unlockedAny?: number;

  // ── 集合类（取并集） ──
  /** 用过的外观主题 id */
  themes?: string[];
  /** 生成器造出过的题型（ordinary / forbidden / shape / text） */
  generatorKinds?: string[];

  // ── 布尔类（一旦为真不再变假） ──
  /** 打开过使用手册任意一章 */
  readManual?: boolean;
  /** 自定义过底部工具栏布局 */
  customizedLayout?: boolean;
  /** 完整备份过资料 */
  didBackup?: boolean;
  /** 导出过棋谱 / 分享过图片 */
  didExport?: boolean;
  /** 在 VCF 挑战里解出过 20 手以上的题 */
  vcfDeepSolved?: boolean;
  /** 成功复原过完整手序 */
  restoredMoveOrder?: boolean;
  /** 打开过十万节点以上的大型棋谱 */
  openedBigLibrary?: boolean;
  /** 跨谱局面检索命中过 */
  usedCrossSearch?: boolean;
  /** 把一道错题重新做对过（从错题本移除） */
  clearedWrongPuzzle?: boolean;
}

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

const COUNT_KEYS = [
  "recognitionCount", "recognitionMaxMoves", "openingKinds", "branchCount",
  "dailyDoneCount", "generatorMaxDepth", "generatorCount", "tapCount", "unlockedAny",
] as const;

const BOOL_KEYS = [
  "readManual", "customizedLayout", "didBackup", "didExport", "vcfDeepSolved",
  "restoredMoveOrder", "openedBigLibrary", "usedCrossSearch", "clearedWrongPuzzle",
] as const;

const normalise = (raw: unknown): AchievementSignals => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const out: AchievementSignals = {};
  for (const key of COUNT_KEYS) {
    const n = value[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
  }
  for (const key of BOOL_KEYS) {
    if (value[key] === true) out[key] = true;
  }
  if (Array.isArray(value.themes)) out.themes = value.themes.filter((item): item is string => typeof item === "string").slice(0, 64);
  if (Array.isArray(value.generatorKinds)) out.generatorKinds = value.generatorKinds.filter((item): item is string => typeof item === "string").slice(0, 16);
  return out;
};

export const loadAchievementSignals = (): AchievementSignals => {
  const storage = safeStorage();
  if (!storage) return {};
  try { return normalise(JSON.parse(storage.getItem(ACHIEVEMENT_SIGNAL_KEY) || "{}")); } catch { return {}; }
};

/**
 * 合并写入。**只增不减**由这里保证：计数取 max、集合取并集、布尔取或。
 *
 * 这样调用方可以放心地"每次看到什么就记什么"，不必自己先读再判断——
 * 例如打开棋谱时报 `branchCount: 12`，不会把之前记下的 300 覆盖成 12。
 */
export const recordAchievementSignals = (patch: AchievementSignals): AchievementSignals => {
  const storage = safeStorage();
  const current = loadAchievementSignals();
  if (!storage) return current;
  const next: AchievementSignals = { ...current };

  for (const key of COUNT_KEYS) {
    const incoming = patch[key];
    if (typeof incoming === "number" && Number.isFinite(incoming)) {
      next[key] = Math.max(current[key] || 0, Math.floor(incoming));
    }
  }
  for (const key of BOOL_KEYS) {
    if (patch[key] === true) next[key] = true;
  }
  if (patch.themes) next.themes = [...new Set([...(current.themes || []), ...patch.themes])].slice(0, 64);
  if (patch.generatorKinds) next.generatorKinds = [...new Set([...(current.generatorKinds || []), ...patch.generatorKinds])].slice(0, 16);

  try { storage.setItem(ACHIEVEMENT_SIGNAL_KEY, JSON.stringify(next)); } catch { /* 存不下就静默跳过 */ }
  return next;
};

/** 测试用：清空信号位。**产品路径不要调用**（那是"重置成就数据"，得走资料安全那套）。 */
export const clearAchievementSignals = (): void => {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(ACHIEVEMENT_SIGNAL_KEY); } catch { /* 忽略 */ }
};

/**
 * **累加**型计数（目前只有 `tapCount`，用户 2026-10-10 的九档连点成就靠它）。
 *
 * 为什么不复用 `recordAchievementSignals` 的"取最大值"：点魂火的次数是**逐次累加**的，
 * 取最大值会让第二次点直接丢掉（1 → max(1, 1) = 1，永远停在 1）。
 *
 * 也不让调用方自己 `load → +1 → record`：那是读-改-写，连点时两次调用之间若有重入
 * 会丢计数。这里在**同一个函数里**读完就写，把窗口压到最小 ——
 * 也就不会出现"我明明点了 3000 下，成就还停在 2999"。
 */
export const bumpAchievementCounter = (key: "tapCount", delta = 1): number => {
  const storage = safeStorage();
  const current = loadAchievementSignals();
  const next = Math.max(0, Math.floor((current[key] || 0) + delta));
  if (!storage) return next;
  try { storage.setItem(ACHIEVEMENT_SIGNAL_KEY, JSON.stringify({ ...current, [key]: next })); } catch { /* 存不下就静默跳过 */ }
  return next;
};
