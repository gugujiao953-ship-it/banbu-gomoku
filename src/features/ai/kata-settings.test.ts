// @vitest-environment jsdom
/**
 * KataGo 旗舰引擎专属设置的纯逻辑测试。
 *
 * 重点在两处：rewriteKataCfg 必须只动目标两行（别把用户/引擎的其它配置弄丢），
 * 以及非法存档值要被夹回默认（版本升级/手改 localStorage 都不该让引擎拿到坏值）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "UTF8" },
  Filesystem: { readFile: vi.fn(), writeFile: vi.fn() },
}));

import { Filesystem } from "@capacitor/filesystem";
import {
  KATA_DEFAULT_SETTINGS,
  applyKataSettings,
  isKataDefaultSettings,
  loadKataSettings,
  resetKataSettings,
  rewriteKataCfg,
  setKataRestartHandler,
  subscribeKataSettings,
} from "./kata-settings";

const CFG = [
  "# KataGo 配置",
  "numSearchThreads = 16",
  "backendNumThreads = 4",
  "nnCacheSizePowerOfTwo = 18",
  "maxTime = 30",
].join("\n");

const readMock = Filesystem.readFile as ReturnType<typeof vi.fn>;
const writeMock = Filesystem.writeFile as ReturnType<typeof vi.fn>;

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setKataRestartHandler(null);
});

describe("kata-settings", () => {
  it("只替换线程与缓存两行，其它配置原样保留", () => {
    const next = rewriteKataCfg(CFG, { threads: 8, cachePower: 20 });
    expect(next).toContain("numSearchThreads = 8");
    expect(next).toContain("nnCacheSizePowerOfTwo = 20");
    expect(next).toContain("maxTime = 30");
    expect(next).toContain("# KataGo 配置");
    expect(next.split("\n").filter((line) => line.startsWith("numSearchThreads")).length).toBe(1);
  });

  it("backendNumThreads 不被改写（固定 4，实测 4 优于 8）", () => {
    // ORT intra-op 线程：实测 4 线程 95.6 访问/秒、8 线程 86.4——暴露给滑杆只会更慢。
    const next = rewriteKataCfg(CFG, { threads: 24, cachePower: 18 });
    expect(next).toContain("backendNumThreads = 4");
    expect(next).not.toContain("backendNumThreads = 24");
  });

  it("缺键时补在末尾（空配置也能得到完整两行）", () => {
    const next = rewriteKataCfg("", { threads: 8, cachePower: 16 });
    expect(next).toContain("numSearchThreads = 8");
    expect(next).toContain("nnCacheSizePowerOfTwo = 16");
  });

  it("存档里的非法值夹回默认", () => {
    localStorage.setItem("banbu-kata-settings-v1", JSON.stringify({ threads: 99, cachePower: 3 }));
    expect(loadKataSettings()).toEqual(KATA_DEFAULT_SETTINGS);
    localStorage.setItem("banbu-kata-settings-v1", JSON.stringify({ threads: 8, cachePower: 20 }));
    expect(loadKataSettings()).toEqual({ threads: 8, cachePower: 20 });
    localStorage.clear();
    expect(loadKataSettings()).toEqual(KATA_DEFAULT_SETTINGS);
    expect(isKataDefaultSettings(KATA_DEFAULT_SETTINGS)).toBe(true);
    expect(isKataDefaultSettings({ threads: 4, cachePower: 18 })).toBe(false);
  });

  it("cfg 内容没变时不触发引擎重启（用户 09-26：每次切设置都重新加载）", async () => {
    readMock.mockResolvedValue({ data: CFG });
    writeMock.mockResolvedValue(undefined as never);
    const restart = vi.fn();
    setKataRestartHandler(restart);
    let notified = 0;
    const unsubscribe = subscribeKataSettings(() => { notified += 1; });
    // 相同值：写文件（幂等）但不重启、也照常通知 UI
    await expect(applyKataSettings({ threads: 16, cachePower: 18 })).resolves.toBe(true);
    expect(restart).not.toHaveBeenCalled();
    expect(notified).toBe(1);
    // 改了值：必须重启
    await expect(applyKataSettings({ threads: 8, cachePower: 18 })).resolves.toBe(true);
    expect(restart).toHaveBeenCalledTimes(1);
    // 恢复默认：cfg 与基线一致（本来就是默认）→ 不重启
    readMock.mockResolvedValue({ data: CFG });
    localStorage.setItem("banbu-kata-cfg-baseline-v1", CFG);
    await expect(resetKataSettings()).resolves.toBe(true);
    expect(restart).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
