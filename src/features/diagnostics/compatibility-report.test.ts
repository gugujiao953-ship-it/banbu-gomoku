import { describe, expect, it } from "vitest";

import { formatCompatibilityReport, type CompatibilityReportInput } from "./compatibility-report";

const base: CompatibilityReportInput = {
  version: "1.1.9",
  buildMode: "production",
  platform: "安卓 Android 11",
  userAgent: "Mozilla/5.0 (Linux; Android 11; Vixus A5 Pro) AppleWebKit/537.36 Chrome/89.0.4389.105 Mobile Safari/537.36",
  language: "zh-CN",
  crossOriginIsolated: false,
  cores: 8,
  deviceMemoryGb: 4,
  screen: { width: 1080, height: 2400, dpr: 2.75 },
  viewport: { width: 411, height: 820 },
  fontScale: "1",
  engineChoice: "kata",
  storage: { usageMb: 120.5, quotaMb: 2048 },
  incomingPending: 0,
  nativeEngine: {
    available: true, abi: "arm64-v8a", cores: 8, assetsCopied: true, binaryPath: "/data/app/.../librapfi-engine.so",
    binaryVariant: "baseline", bigCores: 2, dotprodCapable: false, dotprodEnabled: false, dotprodPreference: "auto",
  },
  kataProfile: { profile: "zz", zzAvailable: false },
  nativeKataGo: {
    available: true, payloadReady: true, abi: "arm64-v8a", cores: 8,
    binaryPath: "/data/app/.../libkatago-engine.so", profile: "zz",
    activeBinary: "libkatago_zz.so", zzAvailable: false, dotprodCapable: false,
    zzRequiresDotprod: true,
  },
  pack: { state: null, objectUrl: null },
};

const report = () => formatCompatibilityReport(base);

describe("兼容性自检文本（群友报障要靠这段文字定位）", () => {
  it("关键判定一条都不许漏：版本、ABI、核心、DotProd、档位、剪贴板环境", () => {
    const text = report();
    for (const needle of ["1.1.9", "arm64-v8a", "Chrome/89", "逻辑核心 8", "约 4GB", "基线", "asimddp", "b24c256", "crossOriginIsolated"]) {
      expect(text).toContain(needle);
    }
  });

  it("CPU 不支持 DotProd 时要说清这是硬件事实，不是「切换没成功」", () => {
    expect(report()).toMatch(/本机 CPU 没有 asimddp[^\n]*正常的，不是没切换成功/);
  });

  it("大网档不可用要标出来，并把原因写在同一行附近", () => {
    const text = report();
    expect(text).toMatch(/当前档 zz/);
    expect(text).toMatch(/大网\(b24c256\)本机可用 否/);
    expect(text).toMatch(/置灰是如实标记，不是切换失败/);
  });

  it("KataGo 自检要带 ABI、活动二进制和资产状态", () => {
    const text = report();
    expect(text).toContain("原生 KataGo：当前档 zz");
    expect(text).toContain("可用 是｜ABI arm64-v8a｜核 8｜资产已铺开 是");
    expect(text).toContain("活动二进制 libkatago_zz.so");
    expect(text).toContain("CPU 支持 DotProd 否");
  });

  it("跨源隔离没开时讲明只影响网页版多线程，别让人以为手机坏了", () => {
    expect(report()).toMatch(/多线程隔离\(crossOriginIsolated\) 否[^\n]*与设备好坏无关/);
  });

  it("暂存区还有文件要说「上次没接上」，没有就报 0 份", () => {
    expect(formatCompatibilityReport({ ...base, incomingPending: 2 })).toMatch(/等待处理的外部文件：2 份[^\n]*上次投递没接上/);
    expect(report()).toMatch(/等待处理的外部文件：0 份/);
    // 非原生环境探不到（undefined）时这一行整条不出现，避免把"探不到"讲成"没有"
    expect(formatCompatibilityReport({ ...base, incomingPending: undefined })).not.toContain("等待处理的外部文件");
  });

  it("原生插件还没就绪时不许编出「可用 否」这种假结论", () => {
    const text = formatCompatibilityReport({ ...base, nativeEngine: null, nativeKataGo: null, kataProfile: null });
    expect(text).toContain("未探测到");
    expect(text).not.toMatch(/大网\(b24c256\)本机可用/);
  });

  it("引擎包状态两种都要如实写", () => {
    expect(report()).toContain("未下载（用随包轻量档）");
    const withPack = formatCompatibilityReport({ ...base, pack: { state: { version: 3, size: 40 * 1048576, downloadedAt: Date.parse("2026-10-01") }, objectUrl: null } });
    expect(withPack).toMatch(/已装 v3（40\.0MB/);
  });

  it("内部枚举名换成应用里的叫法，配额探不到不许写成 0MB", () => {
    expect(formatCompatibilityReport({ ...base, engineChoice: "strong" })).toContain("当前选择 内置备用引擎（Rapfi）");
    expect(formatCompatibilityReport({ ...base, engineChoice: "ikatago" })).toContain("当前选择 iKataGo（网页版引擎）");
    // 认不出的值原样带出来，别编一个好看的标签
    expect(formatCompatibilityReport({ ...base, engineChoice: "brand-new" })).toContain("当前选择 brand-new");
    expect(formatCompatibilityReport({ ...base, storage: { usageMb: 0, quotaMb: 0 } })).toContain("不给存储配额（探不到）");
  });

  it("网页版不许出现「原生 KataGo」这一行（那台设备上根本没有它）", () => {
    expect(formatCompatibilityReport({ ...base, platform: "网页" })).not.toMatch(/原生 KataGo/);
    expect(report()).toMatch(/原生 KataGo：当前档 zz/);
  });

  it("存储数字不许二次换算（字节只在收集时除过一次）", () => {
    expect(report()).toContain("已用 120.5MB / 配额 2048MB");
    expect(formatCompatibilityReport({ ...base, storage: { usageMb: 0, quotaMb: 0 } })).toContain("不给存储配额（探不到）");
  });

  it("最近操作与引擎异常要带进自检（群友的机器摸不到，靠这段还原现场）", () => {
    const text = formatCompatibilityReport({
      ...base,
      recentActions: [
        { time: "2026-10-03T10:00:00.000Z", action: "切到旗舰引擎 b24c256 大网" },
        { time: "2026-10-03T10:00:05.000Z", action: "AI 分析线程异常：回退引擎（内置）线程也失败" },
      ],
    });
    expect(text).toContain("最近操作与异常");
    expect(text).toContain("切到旗舰引擎 b24c256 大网");
    expect(text).toContain("AI 分析线程异常：回退引擎（内置）线程也失败");
    // 只带最近 14 条，别把整段环形日志灌进聊天窗口
    const many = Array.from({ length: 30 }, (_, index) => ({ time: "2026-10-03T10:00:00.000Z", action: `第 ${index} 条` }));
    const trimmed = formatCompatibilityReport({ ...base, recentActions: many });
    expect(trimmed).toContain("第 29 条");
    expect(trimmed).not.toContain("第 15 条");
    expect(formatCompatibilityReport({ ...base, recentActions: [] })).toContain("还没有记录到操作或引擎异常");
  });
});
