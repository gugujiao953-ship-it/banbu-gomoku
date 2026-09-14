import { APP_VERSION } from "../../diagnostics";

export const FIRST_RUN_WELCOME_KEY = "banbu-first-run-welcome-v1";

const legacyInstallKeys = ["renju-note-active-v1", "renju-note-library-v1", "renju-note-default-v1", "banbu-active-large-record-v1", "renju-note-puzzle-progress-v1"];

/**
 * 首运行欢迎页是否要出现。
 *
 * 记录**按版本号**保存（用户 09-14：版本更新后欢迎页要重新出现一次）——旧版本升上来时
 * 存档里存的是上一个版本号，与当前版本不等，于是欢迎页再次出现；用户看完/关掉后写入
 * 当前版本号，同一版本不再打扰。
 *
 * 兼容旧值：v1.1.7 及更早写的是字面量 "true"，那代表「在更早的某个版本上看过」，
 * 对当前版本按「没看过」处理，所以老用户升级后同样会看到一次。
 * 想彻底抑制（自动化脚本）请用 URL 上的 `?qa=1`：qa 门禁 runner 会统一带上，
 * 个别脚本也不要再靠写 "true" 来跳过——那个值现在已经不表示「对当前版本看过了」。
 */
export const shouldShowFirstRunWelcome = (storage: Storage = localStorage, version: string = APP_VERSION): boolean => {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("qa") === "1") return false;
    if (storage.getItem(FIRST_RUN_WELCOME_KEY) === version) return false;
    if (legacyInstallKeys.some((key) => storage.getItem(key) !== null)) {
      storage.setItem(FIRST_RUN_WELCOME_KEY, version);
      return false;
    }
    return true;
  } catch { return false; }
};

export const markFirstRunWelcomeRead = (storage: Storage = localStorage, version: string = APP_VERSION) => {
  try { storage.setItem(FIRST_RUN_WELCOME_KEY, version); } catch { /* storage is optional */ }
};

// 新手引导（T32）：完成/跳过后记一笔，之后从设置页随时可重播（重播不看该键）。
export const ONBOARDING_TOUR_KEY = "banbu-onboarding-tour-v1";

export const markOnboardingTourSeen = (storage: Storage = localStorage) => {
  try { storage.setItem(ONBOARDING_TOUR_KEY, "seen"); } catch { /* storage is optional */ }
};

export const hasOnboardingTourSeen = (storage: Storage = localStorage): boolean => {
  try { return storage.getItem(ONBOARDING_TOUR_KEY) !== null; } catch { return true; }
};
