// @ts-expect-error 应用有意不引 Node 类型；Vitest 在 Node 下跑这个文件。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 引擎档位守卫（2026-09-30 照搬「智子本地版」的双引擎适配）。
 *
 * 背景：智子本地版能同时提供「普通（Eigen + 4MB 原生小网，CPU 最快）」和「增强
 * （ONNX Runtime + b24c256，新机可走 QNN/NPU）」两档，靠的是**两个可执行文件 + 两个
 * 各自格式的模型**。我们照搬这套适配，但把执行点做成纯常量：
 *   档位名（engine.choice，JS 写）只用来在**三组编译期常量参数**之间选择，
 *   任何运行期取值都不会进命令行 —— 本文件原有的「命令注入面为零」这条不变量得以保持。
 *
 * 真机实测（Redmi K20 Pro / 骁龙 855，同一局面 30~90s）：
 *   自带 ORT + 蒸馏网      27 访问/秒
 *   智子 gl(Eigen)+小网   113 访问/秒（4 线程；加到 8 线程降到 91）
 *   智子 zz + b24c256     2.7~3.7 访问/秒（fp32/fp16/int8 都测了，CPU 硬件极限）
 * 所以默认档必须仍是自带档：档位是**加法**，不是替换。
 */
describe("引擎档位（原生档位表 ↔ 资产清单 ↔ JS 入口 ↔ UI 取值 必须一致）", () => {
  const plugin = readFileSync(
    new URL("../../../android/app/src/main/java/cn/renjunote/mobile/NativeKataGoPlugin.java", import.meta.url),
    "utf8",
  );
  const bridge = readFileSync(new URL("./native-engine.ts", import.meta.url), "utf8");
  const tuning = readFileSync(new URL("./KataTuning.tsx", import.meta.url), "utf8");

  it("启动参数由编译期字面量拼出，且各自指定自己的模型", () => {
    // 2026-10-12：自带档的 `-model` 改为**按规则换网**（r15/f15 两张），
    // 所以不再有 BINARY_ARGS_OWN 字面量数组，而是 ownArgs(model) —— model 只可能是
    // RENJU_MODEL_NAME / FREESTYLE_MODEL_NAME 两个编译期常量之一（见 ownModelForRule）。
    expect(plugin).toMatch(/ownArgs\(String model\)\s*\{[\s\S]*?"-model", model/s);
    expect(plugin).toMatch(/RENJU_MODEL_NAME = "distill-fp16\.onnx"/);
    expect(plugin).toMatch(/FREESTYLE_MODEL_NAME = "distill-freestyle-fp16\.onnx"/);
    expect(plugin).toMatch(/BINARY_ARGS_ZZ = ownArgs\(ZZ_MODEL_NAME\)/);
    // 默认值必须是连珠网：档位是加法，不允许悄悄改变默认行为
    expect(plugin).toMatch(/String\[\] BINARY_ARGS = ownArgs\(RENJU_MODEL_NAME\);/);
    // 「智子迷你网」（Eigen + 6b64f）2026-10-01 已移除：不再有该档的启动参数与档位常量
    expect(plugin).not.toMatch(/BINARY_ARGS_GL/);
    expect(plugin).not.toMatch(/PROFILE_GL\b/);
    // 它的模型只允许出现在「旧文件清理清单」里（升级时顺手回收磁盘）
    expect(plugin).toMatch(/STALE_PAYLOAD_FILES = \{[^}]*"6b64f\.bin"/s);
  });

  it("自带档按规则换网：连珠→r15、freestyle/standard→f15，且规则名不进命令行", () => {
    // 用户 2026-10-12：「无禁手时用的是同一张连珠网」是错的 —— r15 把黑双三当"走不通"，
    // 自由规则下那恰是黑方最凶的杀法。所以按规则类别换网。
    expect(plugin).toMatch(/private String ownModelForRule\(String rule\)/);
    expect(plugin).toMatch(/RULE_RENJU = "renju"/);
    expect(plugin).toMatch(/RULE_FREESTYLE = "freestyle"/);
    // 非 freestyle（含 standard）一律回落 r15 —— 规则网缺失时也不能起不了引擎
    expect(plugin).toMatch(/ownModelForRule[\s\S]*?!RULE_FREESTYLE\.equals\(rule\)\) return RENJU_MODEL_NAME/s);
    // 规则贴纸读写 + 归一化：只有 renju / freestyle 两个取值（standard 归 freestyle 一侧）
    expect(plugin).toMatch(/RULE_FILE = "engine\.rule"/);
    expect(plugin).toMatch(/public void setRule\(PluginCall call\)/);
    expect(plugin).toMatch(/RULE_FREESTYLE\.equals\(requested\) \? RULE_FREESTYLE : RULE_RENJU/);
    expect(plugin).toMatch(/result\.put\("freestyleAvailable"/);
    // 资产版本戳必须升过（新增网要重铺，否则老设备刷不到那张网）
    const version = Number(plugin.match(/PAYLOAD_VERSION\s*=\s*(\d+)/)?.[1]);
    expect(version).toBeGreaterThanOrEqual(10);
  });

  it("两个档位都从同一个参数构造函数派生（视角兜底不可能只带一半）", () => {
    // 2026-10-12 起不再有两份手写数组：自带档（按规则换 model）与大网档都走 ownArgs()，
    // 所以"换哪个引擎都带视角兜底"这件事由结构保证，而不是靠数出现次数。
    expect(plugin).toMatch(/ownArgs\(String model\)\s*\{[\s\S]*?"reportAnalysisWinratesAs=SIDETOMOVE"/s);
    expect(plugin).toMatch(/BINARY_ARGS = ownArgs\(ownModelForRule\(readRule\(\)\)\)/);
    expect(plugin).toMatch(/BINARY_ARGS_ZZ = ownArgs\(ZZ_MODEL_NAME\)/);
    // 任何"绕开构造函数的第二份参数数组"都会重新引入漏带视角的风险，禁止出现
    expect(plugin).not.toMatch(/String\[\] BINARY_ARGS_OWN/);
  });

  it("两个引擎都在 jniLibs（Android 10+ 只有 nativeLibraryDir 允许 exec）", () => {
    // 2026-10-01 修复：智子档引擎曾当 assets 铺到 files/ 再 chmod +x —— Android 10 起
    // 可写目录里的文件一律不允许 exec（W^X），真机必然 `error=13 Permission denied`，
    // 表现为「切了档、引擎没换、还是 rapfi 在算」。现在引擎统一走 jniLibs。
    for (const name of ["libkatago-engine.so", "libkatago_zz.so"]) {
      expect(plugin).toContain(`"${name}"`);
    }
    expect(plugin).not.toContain("EXECUTABLE_ASSETS");
    expect(plugin).not.toMatch(/setExecutable\(true, false\)/);
    // 模型与配置仍是 assets（只读文件，私有目录里读没问题；铺不开只该置灰那一档）。
    // 大网模型 2026-10-01 起 int8 静态量化版替换 fp16（实测 1.95×，等预算对局 2:2 持平）
    for (const name of ["distill-fp16.onnx", "distill-freestyle-fp16.onnx", "zhizi-b24-int8.onnx"]) {
      expect(plugin).toContain(`"${name}"`);
    }
    expect(plugin).toMatch(/REQUIRED_ASSETS = \{ "distill-fp16\.onnx", "kata\.cfg" \}/);
    expect(plugin).toMatch(/name \+ "\.part"/);
    // 构建脚本必须把大网引擎铺进 jniLibs，否则换个工作区就构建不出来
    const buildScript = readFileSync(new URL("../../../scripts/build-android-katago.mjs", import.meta.url), "utf8");
    expect(buildScript).toMatch(/libkatago_zz\.so/);
    expect(buildScript).not.toMatch(/libkatago_gl\.so/);
  });

  it("原生侧提供档位探测字段与切换方法，且档位名归一化成常量", () => {
    expect(plugin).toMatch(/public void setProfile\(PluginCall call\)/);
    expect(plugin).toMatch(/result\.put\("zzAvailable"/);
    // 大网档必须先问 CPU 再放行（2026-10-03 群友报「计算引擎打不开」：libkatago_zz.so 里
    // 实测 1582 条 dotprod 指令，在无 asimddp 的 CPU（虎贲 T610 这一代 A75）上是 SIGILL，
    // 而旧代码只看文件在不在 —— 探测与启动两条路都得有这道闸）
    expect(plugin).toMatch(/zzAvailable[^\n]*dotprodCapable/);
    expect(plugin).toMatch(/PROFILE_ZZ\.equals\(profile\)[\s\S]{0,220}cpuSupportsDotprod\(\)/s);
    const rapfi = readFileSync(
      new URL("../../../android/app/src/main/java/cn/renjunote/mobile/NativeEnginePlugin.java", import.meta.url),
      "utf8",
    );
    // 两个引擎共用同一个探测结果（各自读一遍 cpuinfo 会漂）
    expect(rapfi).toMatch(/^\s*static boolean cpuSupportsDotprod\(\)/m);
    // 不可用时整对回落自带档（引擎与模型同源，避免「自带引擎配别的模型」）
    expect(plugin).toMatch(/BINARY_ARGS = ownArgs\(ownModelForRule\(readRule\(\)\)\);\s*\n\s*launchBinary = ownBinary\(\)/);
  });

  it("JS 按档位分流到 startZz，未知档位回落 start", () => {
    expect(bridge).toMatch(/kataProfile === "zz" && api\.startZz/);
    expect(bridge).toMatch(/export const setNativeKataProfile/);
  });

  it("JS 侧的规则映射与原生一致（renju→renju，其余→freestyle）", async () => {
    const { kataNetRuleForRule } = await import("./kata-net");
    expect(kataNetRuleForRule("renju")).toBe("renju");
    expect(kataNetRuleForRule("freestyle")).toBe("freestyle");
    // standard（无禁、长连不算胜）与 freestyle 共用 f15 —— 口径见原生 ownModelForRule
    expect(kataNetRuleForRule("standard")).toBe("freestyle");
    // 桥必须真的把贴纸写下去，而不是只在本地记一笔
    expect(bridge).toMatch(/setRule\?\.\s*\(|api\.setRule\(/);
    expect(bridge).toMatch(/export const setNativeKataRule/);
  });

  it("UI 的档位取值与原生侧常量一致，且切换后重启引擎", () => {
    // 档位名如实标出网络身份；10-01 用户两轮要求后定为极简版「规格 + 小网/大网」
    // （上一版带快/慢/默认/最强修饰词，太长、把面板里的内存格挤出屏幕）
    expect(tuning).toMatch(/\["own", "b10c128 小网"\]/);
    expect(tuning).toMatch(/\["zz", "b24c256 大网"\]/);
    expect(tuning).not.toMatch(/"gl"/);
    expect(tuning).toMatch(/restartKataEngine\(\)/);
  });
});
