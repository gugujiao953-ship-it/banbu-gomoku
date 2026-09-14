// 坐标字号默认值曾是 8——在 viewBox(560) 缩到手机 ~390px 宽后实际只有约 5.6px，
// 看不清。默认提到 12。必须做一次性迁移：显示设置的 useEffect 会把「全部当前值
// （含默认值）」回写 localStorage，光改默认常量，存量安装读到的仍是存好的 8。
// 迁移只在第一次运行时把恰好等于旧默认 8 的值升为新默认；用户显式设过的其它值
// 一律尊重，标记键消费后即便再手动拖回 8 也不动。
export const DEFAULT_COORDINATE_FONT_SIZE = 12;
const LEGACY_DEFAULT_COORDINATE_FONT_SIZE = 8;
const MIGRATION_KEY = "banbu-coordinate-font-default-12-v1";

// StrictMode 双调用 initializer 会二次执行本函数：若每次现读标记键，第一次调用
// 写入键后第二次就判定「已迁移」→ 返回旧值 8，迁移等于没做。用模块级闭包把本
// 次加载的迁移判定与副作用固化：pending 结果只算一次，双调用两次返回一致。
const migrateOnce = (() => {
  let evaluated = false;
  let wasPending = false;
  return (stored: unknown): number => {
    const value = typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_COORDINATE_FONT_SIZE;
    try {
      if (!evaluated) {
        evaluated = true;
        wasPending = localStorage.getItem(MIGRATION_KEY) === null;
        if (wasPending) localStorage.setItem(MIGRATION_KEY, "1");
      }
    } catch { /* storage 不可用（隐私模式等）：不迁移，直接用新默认 */ }
    return wasPending && value === LEGACY_DEFAULT_COORDINATE_FONT_SIZE ? DEFAULT_COORDINATE_FONT_SIZE : value;
  };
})();

export const migrateCoordinateFontSize = migrateOnce;
