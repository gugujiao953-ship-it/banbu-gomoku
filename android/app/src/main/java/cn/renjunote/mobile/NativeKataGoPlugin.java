package cn.renjunote.mobile;

import android.content.res.AssetManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 安卓原生 KataGo 旗舰引擎（KataGomo 分支，ONNX Runtime CPU 后端）：GTP 协议子进程。
 *
 * 与 NativeEnginePlugin（Rapfi）的关系：管道模式完全同构（jniLibs 可执行文件、assets
 * 权重首启复制、stdin/stdout 行管道、常驻进程），但做成**独立插件**——两个引擎字段
 * 收进一个类再按名字路由，stdout/exit 事件就得全部带引擎标识，一处漏改就会串线。
 * 独立插件天然隔离，代价只是 ~150 行结构重复。
 *
 * 与 Rapfi 插件的差异：
 *  1. 启动带 GTP 参数（gtp -model … -config …，都是随包常量）；工作目录设为资产目录，
 *     模型/配置用相对文件名，引擎自己按 cwd 解析（与 Rapfi 按相对路径找权重同款）。
 *  2. 资产校验按文件逐个存在性判断，不能用「文件长度总和」——模型将来单独换文件时
 *     总和校验会静默失效。
 *  3. logDir（gtp_logs/）必须存在：KataGo 上游对日志目录缺失的处理不可靠，prepare 时建好。
 *  4. 时间控制不走命令行参数（start 不接收任何 JS 输入，命令注入面为零）：worker 起
 *     进程后用 GTP `time_settings` 下发每手预算，标定协议算出的值也走这条通道。
 *
 * 资产在 assets/engine-katago/（独立目录——scripts/build-android-engine.mjs 会 rmSync
 * 整个 engine-native/，混放会被它删掉）。二进制在 jniLibs/<abi>/libkatago-engine.so
 * （必须 lib*.so 命名才会被 AGP 打包并解压到 nativeLibraryDir，且可执行）。
 */
@CapacitorPlugin(name = "NativeKataGo")
public class NativeKataGoPlugin extends Plugin {

    /** 引擎要读的**数据资产**（与 assets/engine-katago/ 一致）。
     *
     *  这里只放模型与配置——它们是「读」的文件，应用私有目录完全可以读。
     *  三个**可执行文件**不在这里，全部走 jniLibs（见 EXEC 段注释）：Android 10+
     *  起，应用可写目录（files/）里的文件即使 chmod +x 也不允许 exec（W^X），
     *  2026-09-30 那版把智子两个引擎铺到 files/ 再 chmod，真机上必然 EACCES。 */
    private static final String[] ENGINE_ASSETS = {
            // 连珠（有禁手）网 —— 官方 Gomocup 包的 r15 蒸馏网（`..._renjudistill-*`）。
            "distill-fp16.onnx",
            // 无禁手网 —— 同一套蒸馏网的 f15 版（`..._fs15xdistill-*`）。
            // 用户 2026-10-12：「无禁手时用的是同一张连珠网」是错的，会把黑方棋力压掉一截
            // （r15 网把双三/双四当成"非法/不赢"，自由规则下那恰是黑方最凶的杀法）。
            // 与 r15 同架构、同为 3.2MB，转换流水线逐字节复现（见改造表 R171）。
            "distill-freestyle-fp16.onnx",
            "kata.cfg",
            // 「智子本地版」的大网模型（引擎在 jniLibs，见 ZZ_BINARY_NAME）。
            // 2026-10-01 起 int8 静态量化版替换 fp16：K20 同机同口径实测
            // 5.6 → 10.9 访问/秒（1.95×），模型 44MB → 23MB；等预算对局 2:2 持平。
            "zhizi-b24-int8.onnx",
    };
    /** 其中**缺了就起不了引擎**的最小集合（自带档那两件）。
     *  智子档的资产在磁盘紧张的机器上可能铺不开——那种情况应该只是「档位置灰」，
     *  绝不能连自带档也一起拖死（升级前只要 3.4MB，升级后要 46MB，这个差别会真实发生）。 */
    private static final String[] REQUIRED_ASSETS = { "distill-fp16.onnx", "kata.cfg" };
    /** 旧版本留下、现已不再使用的 payload 文件：铺开时顺手删掉回收空间。
     *  katago_gl/katago_zz = 曾铺进 files/ 的两个引擎（Android 10+ 不可 exec，已改走 jniLibs）；
     *  6b64f.bin = 「智子迷你网」档的模型（2026-10-01 用户要求删掉该档：棋力最弱、价值最低）；
     *  zhizi-b24-fp16.onnx = 大网的 fp16 模型（2026-10-01 起 int8 量化版替换，回收 44MB）。 */
    private static final String[] STALE_PAYLOAD_FILES = { "katago_gl", "katago_zz", "6b64f.bin", "zhizi-b24-fp16.onnx" };
    private static final String ASSET_DIR = "engine-katago";
    private static final String WORK_DIR_NAME = "native-katago";
    private static final String BINARY_NAME = "libkatago-engine.so";
    /** 智子·大网档的引擎（2026-10-01 从 assets 挪进 jniLibs）。
     *
     *  **这不是格式问题，是执行权限问题**：Android 10（API 29）起禁止执行应用可写目录
     *  （`getFilesDir()` 下的 files/）里的文件——`ProcessBuilder` 直接抛
     *  `error=13, Permission denied`，chmod +x 也救不了（W^X）。系统只允许执行
     *  安装器解压出来的 `nativeLibraryDir`（jniLibs）里的 `lib*.so`。
     *  证据：真机日志里 `start(): binary=katago_gl` 紧跟 `kata-start-failed Permission
     *  denied`；同一个二进制放进 jniLibs 后能打出 `GTP ready`。 */
    private static final String ZZ_BINARY_NAME = "libkatago_zz.so";
    /** 大网档的模型（assets 铺到 payload 目录；只读文件，私有目录里读没问题）。
     *  int8 静态量化版（真实局面标定）：K20 同机同口径 5.6 → 10.9 访问/秒（1.95×）。 */
    private static final String ZZ_MODEL_NAME = "zhizi-b24-int8.onnx";
    /** 自带档的两张**小网** —— 同一套 b10c128 蒸馏网的两个规则版本（官方 Gomocup 包
     *  `pbrain-katagomo_{r15,f15}.zip` 里的 `default_model.bin.gz`）。
     *
     *  用户 2026-10-12：「那我们的小网在有禁手的时候会有影响吗」—— 查下来真正的缺口不在
     *  有禁手（r15 正是有禁手那张），而在无禁手：从前一个档位只有一张 r15 网，无禁手时
     *  复用它，等于让一个"认为黑双三走不通"的网去下允许双三的自由棋，黑方棋力被压一截。
     *  现在按规则换网：**连珠（renju）→ r15；freestyle / standard → f15**。 */
    private static final String RENJU_MODEL_NAME = "distill-fp16.onnx";
    private static final String FREESTYLE_MODEL_NAME = "distill-freestyle-fp16.onnx";
    /**
     * 随包资产（模型 + 配置）的版本戳。改 assets/engine-katago/ 里的任何文件都必须
     * +1：铺开的资产在私有目录里，只看「文件在不在」是发现不了内容变化的——上一版
     * 就是这样把排查期临时打开的 GTP 日志开关（每行通信写盘 + 并进 stdout）永久留
     * 在了用户的机器上，新包也刷不掉。现在版本戳不一致就整体重铺。
     *
     * 10 = 新增无禁手网 `distill-freestyle-fp16.onnx`（2026-10-12）。
     */
    private static final int PAYLOAD_VERSION = 10;
    private static final String PAYLOAD_STAMP = ".payload-version";
    /** 引擎档位 = 可执行文件 + 模型（2026-09-30 照搬「智子本地版」的双引擎适配，2026-10-01 收敛为两档）。
     *
     * 两档的差别是**网的大小**，后端与文件格式也随之不同：
     *   · 自带小网（默认）：蒸馏网 `gom_distill-b10c128nbt`（10 块 × 128 通道，fp16 3.4MB），
     *     走 ONNX Runtime —— 真机平衡局面实测 **106.9 访问/秒**（t16 b16）。
     *   · 智子大网：社区 b24c256（24 块 × 256 通道），同样走 ONNX Runtime ——
     *     **int8 静态量化版**（2026-10-01 替换 fp16）：真机 **10.9 访问/秒**
     *     （fp16 版为 5.6，量化换来 1.95×；等预算对局 2:2 持平），棋力更强但要等。
     *   · ~~智子迷你网（Eigen + 6b64f，4MB）~~ **2026-10-01 移除**：棋力最弱（真机等时对抗
     *     0:5 输给自带小网），留着只是徒增包体与一个会让人选错的档位。
     *
     * 档位名由 JS 写进 payload 目录下的 engine.choice（与 kata.cfg 同一套路子），**只用于在
     * 下面两组编译期常量之间选择**——任何运行期取值都不会进命令行。 */
    private static final String CHOICE_FILE = "engine.choice";
    private static final String PROFILE_OWN = "own";
    private static final String PROFILE_ZZ = "zz";
    /** 规则贴纸（JS 写、Java 读，与 engine.choice 同一套路子）：只有两个取值，
     *  决定自带档用 r15 还是 f15 那张网（见 RENJU_MODEL_NAME / FREESTYLE_MODEL_NAME）。
     *
     *  ⚠ 规则变化**必须重启进程**才生效：网是启动参数 `-model`，KataGo 没有运行期换网
     *    的命令。所以 JS 侧在规则类别变化时写这张贴纸 + 停进程，下一次分析按新网加载
     *    （与线程/缓存、档位变更同一条链路 —— 都是"只停不启"，等真正要用时才加载）。
     *  缺文件（老 payload）时按 renju 处理：r15 是随包最早、也最可能在场的那张。 */
    private static final String RULE_FILE = "engine.rule";
    private static final String RULE_RENJU = "renju";
    private static final String RULE_FREESTYLE = "freestyle";
    /** 自带档的启动参数：`-model` 由 `ownArgs(model)` 传进来，而 model **只可能是**
     *  RENJU_MODEL_NAME 或 FREESTYLE_MODEL_NAME 两个编译期常量之一（见 ownModelForRule）。
     *  也就是说"运行期取值永不进命令行"这条性质仍然成立 —— 规则名与档位名一样，
     *  只用来在字面量之间选分支。
     *
     * `-override-config` 是**视角兜底**（2026-09-30）：kata.cfg 里写
     * `reportAnalysisWinratesAs = SIDETOMOVE`（行棋方视角），这里再用命令行参数强制一次。
     * 原因：09-29 把 cfg 改成 BLACK 却忘了升 PAYLOAD_VERSION，设备上跑的仍是旧 payload 的
     * 旧 cfg，前端的语义却已经跟着新约定改了 —— 用户报的「黑白颠倒」就是这么来的。
     * 启动参数不依赖 payload 文件是否重铺，是这条链路上唯一不会被漏掉的开关。
     * （智子的大网引擎实测同样认这个参数，且视角矩阵与自带引擎一致：白走·黑四连报 0.0。） */
    private static String[] ownArgs(String model) {
        return new String[]{
                "gtp", "-config", "kata.cfg",
                "-override-config", "reportAnalysisWinratesAs=SIDETOMOVE",
                "-model", model,
        };
    }

    /** 大网（智子档）的启动参数。**不随规则换网**：包里只有一张 b24c256，来源是社区分发、
     *  没有对应的无禁手版本，所以两种规则共用它（口径写在改造表 R171）。 */
    private static final String[] BINARY_ARGS_ZZ = ownArgs(ZZ_MODEL_NAME);
    /** 本次 spawn 用的参数：由 applyLaunchProfile() 在 prepare/setProfile/setRule 时装配。
     *  留成非 final 只是为了让 start() 里那段 spawn 代码保持原样（它读的就是这个标识符），
     *  取值永远来自编译期字面量，档位名/规则名本身不进命令行。 */
    private static String[] BINARY_ARGS = ownArgs(RENJU_MODEL_NAME);

    private Process process;
    private Writer processStdin;
    private Thread readerThread;
    private final AtomicBoolean running = new AtomicBoolean(false);
    /** 进程重启时使旧 reader 线程不能覆盖新进程的状态。 */
    private volatile long processGeneration = 0L;

    // ---- 诊断通道（默认关闭，零开销）----------------------------------------
    // 排查「引擎不动」这类只能真机复现的问题时把它改成 true 重新打包：JS 桥与
    // worker 的关键消息流（含每条 GTP 命令与引擎 stdout）会写进
    //   /sdcard/Android/data/<包名>/files/kata_diag/kata_diag.log
    // adb 直接 pull 即可看到断在哪一层（release 包不可 run-as、WebView console 不
    // 转发 logcat、Worker 里没有 alert——这是唯一可靠通道）。
    private static final boolean DEBUG_DIAG = true;
    /** 诊断文件的**硬上限**。不设限时真机实测一次调试会话就写到 138MB 全留在用户存储里，
     *  而每行都要 open/append/close 一次——搜索期每秒上百行，这笔 I/O 自己就是负担。
     *  超了就整份截断重来：盘上留下的永远是最近几轮，排查「刚才那次为什么没出数据」照样够用。 */
    private static final long DIAG_MAX_BYTES = 8L * 1024 * 1024;
    private long diagBytes = 0L;
    private final Object diagLock = new Object();
    private final java.util.concurrent.atomic.AtomicInteger diagCount = new java.util.concurrent.atomic.AtomicInteger();
    private long diagWindowStart = 0L;
    private void diag(String text) {
        if (!DEBUG_DIAG) return;
        // 限制诊断量：搜索期 info 行每秒多条，全写文件会拖慢 reader 线程、反而制造
        // 管道背压污染诊断。关键标记（载荷/状态/请求）不受上限约束；噪声行超限后
        // 只留协议行。
        // **滚动窗口（10-01 教训）**：原实现 diagCount 是进程生命周期单调计数——
        // 首轮分析 ~400 条噪声行就把预算花光，之后 info 帧/start()/write>/progress
        // 全部静默消失，排查「切换后无数据」时被它骗了半天（引擎明明在出帧）。
        // 改成每秒重置的滚动窗口：每秒至多 400 条噪声行，既限流又永不失明。
        boolean important = text.contains("emitProgress") || text.contains("app:aiAnalysis")
                || text.contains("app:startThink") || text.contains("runKata") || text.contains("analyze in")
                || text.contains("app:autoEffect") || text.contains("app:accept") || text.contains("drain:");
        boolean protocol = text.startsWith("read< =") || text.startsWith("read< ?") || text.startsWith("read< play");
        if (!important && !protocol) {
            long now = System.currentTimeMillis();
            if (now - diagWindowStart >= 1000) {
                diagWindowStart = now;
                diagCount.set(0);
            }
            if (diagCount.incrementAndGet() > 400) return;
        }
        try {
            File dir = getContext().getExternalFilesDir("kata_diag");
            if (dir == null) return;
            File file = new File(dir, "kata_diag.log");
            synchronized (diagLock) {
                try (OutputStream out = new FileOutputStream(file, true)) {
                    String line = System.currentTimeMillis() + " " + text + "\n";
                    out.write(line.getBytes(StandardCharsets.UTF_8));
                }
                diagBytes += text.length() + 20;
                if (diagBytes > DIAG_MAX_BYTES) {
                    diagBytes = 0L;
                    // 截断而不是删除：路径保持稳定，用户 pull 到的永远是最近这几兆。
                    try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(file, "rw")) { raf.setLength(0L); } catch (Exception ignored) { /* 截断失败顶多文件偏大 */ }
                }
            }
        } catch (Exception ignored) { /* 诊断失败不影响引擎 */ }
    }

    /** JS 桥转发诊断事件（kata-start/kata-ready/analyze 等消息流）。 */
    @PluginMethod
    public void diag(PluginCall call) {
        diag("js:" + call.getString("text", "?"));
        call.resolve();
    }

    /** 探测：安装包是否带当前 ABI 的 KataGo、权重铺了没有、有哪些引擎档位可用。 */
    @PluginMethod
    public void check(PluginCall call) {
        JSObject result = new JSObject();
        // 可用性只看二进制——权重是 prepare 时才复制的，算进可用条件会永远探测失败。
        File binary = ownBinary();
        result.put("available", binary != null);
        result.put("payloadReady", payloadDir().isDirectory() && isPayloadComplete());
        result.put("binaryPath", binary == null ? "" : binary.getAbsolutePath());
        // 引擎档位（2026-09-30 照搬智子的双引擎适配）：报当前档位 + 每档是否可用，
        // UI 据此把用不了的档位置灰，而不是让用户选了之后才发现回落。
        applyLaunchProfile();
        result.put("profile", readProfile());
        result.put("activeBinary", launchBinary == null ? "" : launchBinary.getName());
        // 「大网可用」不能只看文件在不在：libkatago_zz.so 编译时开了 NEON DotProd
        // （实测 1582 条 dotprod 指令），在没有 asimddp 的 CPU（如虎贲 T610、A75 r0p0 这一代）
        // 上 exec 下去是 SIGILL，界面表现就是「计算引擎打不开」。这里如实报不可用，
        // UI 早就有「·本机不可用 + 回落自带引擎」这条路径，只是以前从来没被点亮。
        boolean dotprodCapable = NativeEnginePlugin.cpuSupportsDotprod();
        result.put("dotprodCapable", dotprodCapable);
        result.put("zzRequiresDotprod", true);
        result.put("zzAvailable", engineBinary(ZZ_BINARY_NAME) != null && dotprodCapable);
        // 规则贴纸与无禁手网是否在场：JS 侧靠它决定"要不要写贴纸 + 停进程"，
        // 以及界面上如实说明"无禁手会换成 f15 网 / 没铺开就沿用 r15"。
        result.put("rule", readRule());
        result.put("freestyleAvailable", payloadModel(FREESTYLE_MODEL_NAME) != null);
        result.put("abi", android.os.Build.SUPPORTED_ABIS.length > 0 ? android.os.Build.SUPPORTED_ABIS[0] : "");
        result.put("cores", Runtime.getRuntime().availableProcessors());
        call.resolve(result);
    }

    /** 设置规则贴纸（**归一化成 renju / freestyle 两个常量之一**）。
     *  只有两个取值要区分：网是按"有没有禁手"分的（r15 / f15），`standard` 归到 freestyle 一侧。
     *  改贴纸只影响下一次 spawn，调用方必须接着重启引擎（与 setProfile / kata 设置同一条链路）。 */
    @PluginMethod
    public void setRule(PluginCall call) {
        String requested = call.getString("rule", RULE_RENJU);
        String value = RULE_FREESTYLE.equals(requested) ? RULE_FREESTYLE : RULE_RENJU;
        try {
            File dir = payloadDir();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建引擎目录");
            try (OutputStream out = new FileOutputStream(new File(dir, RULE_FILE))) {
                out.write(value.getBytes(StandardCharsets.UTF_8));
            }
            JSObject result = new JSObject();
            result.put("rule", value);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("设置引擎规则失败：" + error.getMessage());
        }
    }

    /** 切换引擎档位：把档位名写进 payload 目录的 engine.choice（**归一化成常量之一**）。
     *  改档只影响下一次 spawn，调用方必须接着重启引擎（与 kata 设置变更同一条链路）。 */
    @PluginMethod
    public void setProfile(PluginCall call) {
        String requested = call.getString("profile", PROFILE_OWN);
        // 只认 own / zz；旧版留下的 "gl"（迷你网档，2026-10-01 已移除）与任何未知值一律归到默认档。
        String value = PROFILE_ZZ.equals(requested) ? PROFILE_ZZ : PROFILE_OWN;
        try {
            File dir = payloadDir();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建引擎目录");
            try (OutputStream out = new FileOutputStream(new File(dir, CHOICE_FILE))) {
                out.write(value.getBytes(StandardCharsets.UTF_8));
            }
            JSObject result = new JSObject();
            result.put("profile", value);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("切换引擎档位失败：" + error.getMessage());
        }
    }

    /** 首次运行把模型与配置铺到私有目录（幂等）；顺带建好 logDir。 */
    @PluginMethod
    public void prepare(PluginCall call) {
        try {
            File dir = payloadDir();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建引擎目录");
            if (!isPayloadComplete()) copyPayload(dir);
            // KataGo 的 logDir 必须存在（kata.cfg 里 logDir = gtp_logs）
            File logs = new File(dir, "gtp_logs");
            if (!logs.isDirectory() && !logs.mkdirs()) throw new IOException("无法创建日志目录");
            JSObject result = new JSObject();
            result.put("ready", true);
            result.put("dir", dir.getAbsolutePath());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("KataGo 引擎准备失败：" + error.getMessage());
        }
    }

    /** 起进程（不接受任何 JS 参数——后续一切控制都走 GTP 命令）。 */
    @PluginMethod
    public void start(PluginCall call) {
        diag("start() called; running=" + running.get());
        if (running.get()) {
            JSObject result = new JSObject();
            result.put("running", true);
            // spawned=false = 复用了已有进程：桥据此**保留**「已就绪」状态
            // （进程早已打出过 GTP ready，不会再打第二遍）。
            result.put("spawned", false);
            call.resolve(result);
            return;
        }
        // 档位 → 「可执行文件 + 参数」这一对（必须同源，否则会出现「自带引擎配 Eigen 模型」
        // 这种必然失败的组合）。档位不可用时整对回落自带档：用户看到的只是「档位没生效」，
        // 而不是「引擎起不来」。
        applyLaunchProfile();
        File binary = launchBinary;
        if (binary == null) {
            call.reject("本安装包不包含当前设备可用的 KataGo 引擎");
            return;
        }
        diag("start(): binary=" + binary.getName() + " args=" + java.util.Arrays.toString(BINARY_ARGS));
        // 启动前先清扫**残留的引擎子进程**：应用被划掉/异常退出时，上一轮 spawn 的
        // 引擎会变成孤儿继续活着（模型+缓存动辄上百 MB），不清掉的话新进程在本就
        // 紧张的内存下分配失败——这正是「关了再开就一直起不来」的根因。
        killStaleEngines(binary.getName());
        try {
            File dir = payloadDir();
            // 参数全为随包常量；工作目录 = 资产目录，引擎按相对路径读模型/配置/日志。
            java.util.ArrayList<String> command = new java.util.ArrayList<>();
            command.add(binary.getAbsolutePath());
            for (String arg : BINARY_ARGS) command.add(arg);
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(dir);
            builder.redirectErrorStream(true);        // 引擎错误并进同一管道，便于日志
            // libonnxruntime.so 与二进制同在 nativeLibraryDir（jniLibs 解压目标）
            builder.environment().put("LD_LIBRARY_PATH", getContext().getApplicationInfo().nativeLibraryDir);
            // NNAPI 加速（引擎侧已支持，KATAGO_NNAPI=1 时启用）：**09-27 装机实测这台
            // 设备上 NNAPI 会话初始化挂起**——引擎活着但不就绪，搜索拿不到输出，候选
            // 全无。已回退为不注入（纯 CPU 路径）。引擎能力保留，待换机验证或 ORT
            // 升级后再开。
            // builder.environment().put("KATAGO_NNAPI", "1");
            Process child = builder.start();
            process = child;
            long generation = ++processGeneration;
            processStdin = new OutputStreamWriter(child.getOutputStream(), StandardCharsets.UTF_8);
            running.set(true);
            startReader(child, generation);
            JSObject result = new JSObject();
            result.put("running", true);
            // spawned=true = 这是全新进程：桥必须重新等它的 `GTP ready`
            result.put("spawned", true);
            call.resolve(result);
        } catch (Exception error) {
            running.set(false);
            call.reject("KataGo 引擎启动失败：" + error.getMessage());
        }
    }

    /**
     * 清扫**本应用自己的**残留引擎进程（不含当前这一个）。
     *
     * 为什么必须只扫本应用：原实现遍历 /proc 下所有数字目录并逐个尝试打开
     * cmdline——别的 App 的进程一律 SELinux 拒绝（真机 logcat 里刷出成百上千条
     * `avc: denied { search }`，`app=com.tencent.mtt` 之类），既是噪音也拖慢启动；
     * 更糟的是「命令行含本引擎名」这一条**会把刚 spawn 的新进程也匹配上**
     * （同一 binary、同一 argv），于是自我清扫、启动中途自杀——真机实测单次
     * 应用启动内引擎 PID 从 26182 变成 26214，正是「容易启动未成功」的来源之一。
     * 现在只认 /proc/<pid>/cmdline 且**排除自身 pid**，并且只清理确实属于本包
     * 的（UID 相同由内核保证：不同 UID 的 kill 会被拒绝）。
     *
     * 另一个保护：正在启动中（process 非空且存活）时**不扫**——这时任何同 argv
     * 进程都可能是我们要保留的那一个。
     */
    private void killStaleEngines(String binaryName) {
        int selfPid = android.os.Process.myPid();
        int myUid = android.os.Process.myUid();
        File procDir = new File("/proc");
        String[] candidates = procDir.list((dir, name) -> {
            for (int i = 0; i < name.length(); i += 1) {
                char c = name.charAt(i);
                if (c < '0' || c > '9') return false;
            }
            return !name.isEmpty();
        });
        if (candidates == null) return;
        byte[] buffer = new byte[1024];
        for (String pid : candidates) {
            int target;
            try {
                target = Integer.parseInt(pid);
            } catch (NumberFormatException ignored) {
                continue;
            }
            // 别扫自己（本进程名也含 binary 关键字，扫到就会自杀）
            if (target == selfPid) continue;
            // 只考虑本应用的进程：/proc/<pid> 的 owner 即 UID，不同 UID 直接跳过
            // （这样连打开 cmdline 都不必尝试，从根上消除跨应用 avc denied 噪音）
            try {
                android.system.StructStat stat = android.system.Os.stat("/proc/" + pid);
                if ((int) stat.st_uid != myUid) continue;
            } catch (Exception ignored) {
                continue;
            }
            try (java.io.FileInputStream in = new java.io.FileInputStream(new File("/proc/" + pid + "/cmdline"))) {
                int len = in.read(buffer);
                if (len <= 0) continue;
                String cmdline = new String(buffer, 0, len, StandardCharsets.UTF_8);
                if (cmdline.contains(binaryName)) {
                    android.system.Os.kill(target, android.system.OsConstants.SIGKILL);
                }
            } catch (Exception ignored) {
                // 读不到/杀不动（已退出或权限不足）都无所谓：只影响清扫，不影响启动
            }
        }
    }

    /** 送一行 GTP 命令（时间控制、boardsize/play、analyze 全走这里）。 */
    @PluginMethod
    public void write(PluginCall call) {
        String line = call.getString("line", "");
        diag("write> " + line);
        try {
            if (!running.get() || processStdin == null) throw new IOException("引擎未运行");
            processStdin.write(line);
            processStdin.write("\n");
            processStdin.flush();
            call.resolve();
        } catch (Exception error) {
            // 写入失败最常见的原因是**进程已死**（被系统回收/自己崩了），而 JS 侧的
            // 重试链会立刻再发一次 start()。这里把 running 复位，让下一次 start()
            // 走真正的 spawn（否则 start() 见到 running=true 会早退复用死进程）。
            running.set(false);
            processStdin = null;
            call.reject("写入 KataGo 引擎失败：" + error.getMessage());
        }
    }

    /** 硬停止。正常中断搜索应在 JS 侧发 GTP stop 命令。 */
    @PluginMethod
    public void stop(PluginCall call) {
        android.util.Log.i("NativeKataGo", "stop() called; reason=" + call.getString("reason", "?"));
        killProcess();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        android.util.Log.i("NativeKataGo", "handleOnDestroy() -> killProcess");
        killProcess();
        super.handleOnDestroy();
    }

    /** 逐行回灌 stdout 给 JS（协议层消费）。 */
    private void startReader(final Process child, final long generation) {
        readerThread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    diag("read< " + line);
                    JSObject payload = new JSObject();
                    payload.put("line", line);
                    notifyListeners("stdout", payload);
                }
            } catch (Exception ignored) {
                // 进程结束时的读异常属于正常收尾
            } finally {
                int code = -1;
                try { code = child.waitFor(); } catch (Exception ignored) { /* 已退出 */ }
                // 旧进程的 reader 可能晚于新进程结束；不能把新进程标成已退出，
                // 也不能把旧进程的 EOF 广播成当前进程崩溃。
                if (generation != processGeneration || process != child) return;
                running.set(false);
                processStdin = null;
                process = null;
                JSObject payload = new JSObject();
                payload.put("code", code);
                notifyListeners("exit", payload);
            }
        }, "native-katago-reader");
        readerThread.setDaemon(true);
        readerThread.start();
    }

    private void killProcess() {
        processGeneration += 1L;
        running.set(false);
        try { if (processStdin != null) processStdin.close(); } catch (Exception ignored) { /* 关不关都行 */ }
        processStdin = null;
        Process child = process;
        process = null;
        if (child != null) {
            child.destroy();
        }
    }

    /** 当前档位 = payload 目录下的 engine.choice（JS 写、Java 读，与 kata.cfg 同一套路子）。
     *  它的内容**只用来在几个编译期常量之间选分支**，永远不会被拼进命令行。 */
    private String readProfile() {
        File choice = new File(payloadDir(), CHOICE_FILE);
        if (!choice.isFile()) return PROFILE_OWN;
        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new InputStreamReader(new java.io.FileInputStream(choice), StandardCharsets.UTF_8))) {
            String line = reader.readLine();
            String value = line == null ? "" : line.trim();
            // "gl"（迷你网档）已在 2026-10-01 移除：设备上残留的选择一律归到默认的自带小网。
            if (PROFILE_ZZ.equals(value)) return PROFILE_ZZ;
            if (PROFILE_OWN.equals(value)) return PROFILE_OWN;
        } catch (Exception ignored) { /* 读不到就按自带档 */ }
        return PROFILE_OWN;
    }

    /** jniLibs 解压目录里的引擎二进制（`lib*.so` 命名，安装器解压即带执行位；
     *  Android 10+ 只允许执行这个目录，见 ZZ_BINARY_NAME 的注释）。 */
    private File ownBinary() {
        return engineBinary(BINARY_NAME);
    }

    private File engineBinary(String name) {
        File candidate = new File(getContext().getApplicationInfo().nativeLibraryDir, name);
        return candidate.isFile() && candidate.canExecute() ? candidate : null;
    }

    /** 本次 spawn 的可执行文件；与 BINARY_ARGS 由 applyLaunchProfile() 一起装配。 */
    private File launchBinary = null;

    /** 读档位 → 装好**本次 spawn 的「可执行文件 + 参数」**。
     *
     * 这一对必须同源：档位二进制不可用时（资产没铺好、x86_64 设备装不了 arm64 引擎、
     * 文件被清掉）要**整对**回落自带档，否则会出现「自带 ONNX 引擎 + Eigen 原生模型」
     * 这种必然加载失败的组合。参数本身仍只由编译期字面量拼出（型号来自 ownModelForRule 的
     * 两个常量、档位只选 ZZ 那组），运行期取值不进命令行。 */
    private void applyLaunchProfile() {
        String profile = readProfile();
        // 档位可用 = 引擎可执行 **且** 模型铺好在场：只有引擎没有模型时启动会失败并
        // 回落 rapfi（用户看到「切了档还是 rapfi」），不如在这里就整对回落自带档。
        File zz = PROFILE_ZZ.equals(profile) && payloadModel(ZZ_MODEL_NAME) != null
                && NativeEnginePlugin.cpuSupportsDotprod()
                ? engineBinary(ZZ_BINARY_NAME) : null;
        if (zz != null) {
            BINARY_ARGS = BINARY_ARGS_ZZ;
            launchBinary = zz;
        } else {
            BINARY_ARGS = ownArgs(ownModelForRule(readRule()));
            launchBinary = ownBinary();
        }
    }

    /** 自带档按**规则**挑网：连珠（有禁手）用 r15，其余（freestyle / standard）用 f15。
     *
     *  · 官方 Gomocup 包分 r15 / f15 / s15 三份（连珠 / 自由 / 标准）。这里只转了两份：
     *    **standard 与 freestyle 共用 f15** —— 按 `rapfi-worker.js` 的 `kataRuleName`，
     *    standard 与 freestyle 的差别"只在长连是否算胜"，用 f15 是刻意的近似；
     *    真要精确得再补一份 s15（+3.2MB 包体），按需再加。
     *  · 规则网不在场（老 payload、磁盘紧张、升级中途）时回落 r15：宁可"网与规则略不配"，
     *    也不能因为少一个可选文件就起不了引擎 —— 与 REQUIRED_ASSETS 只保底两件同一口径。 */
    private String ownModelForRule(String rule) {
        if (!RULE_FREESTYLE.equals(rule)) return RENJU_MODEL_NAME;
        return payloadModel(FREESTYLE_MODEL_NAME) != null ? FREESTYLE_MODEL_NAME : RENJU_MODEL_NAME;
    }

    /** 当前规则贴纸（payload 目录下的 engine.rule）。认不出的一律当 renju。 */
    private String readRule() {
        File file = new File(payloadDir(), RULE_FILE);
        if (!file.isFile()) return RULE_RENJU;
        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new InputStreamReader(new java.io.FileInputStream(file), StandardCharsets.UTF_8))) {
            String line = reader.readLine();
            String value = line == null ? "" : line.trim();
            return RULE_FREESTYLE.equals(value) ? RULE_FREESTYLE : RULE_RENJU;
        } catch (Exception ignored) { /* 读不到就按连珠 */ }
        return RULE_RENJU;
    }

    /** payload 目录里的模型（只读，不要求可执行位）。 */
    private File payloadModel(String name) {
        File candidate = new File(payloadDir(), name);
        return candidate.isFile() && candidate.length() > 0 ? candidate : null;
    }

    private File payloadDir() {
        return new File(getContext().getFilesDir(), WORK_DIR_NAME);
    }

    /** 必备资产的存在性校验 + 版本戳一致（模型将来单独换文件时，长度总和校验会静默失效）。
     *  只看 REQUIRED_ASSETS（自带档那两件）——理由见该常量的注释。 */
    private boolean isPayloadComplete() {
        for (String name : REQUIRED_ASSETS) {
            File file = new File(payloadDir(), name);
            if (!file.isFile() || file.length() == 0) return false;
        }
        return readPayloadStamp() == PAYLOAD_VERSION;
    }

    private static boolean isRequiredAsset(String name) {
        for (String required : REQUIRED_ASSETS) {
            if (required.equals(name)) return true;
        }
        return false;
    }

    private int readPayloadStamp() {
        File stamp = new File(payloadDir(), PAYLOAD_STAMP);
        if (!stamp.isFile()) return 0;
        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new InputStreamReader(new java.io.FileInputStream(stamp), StandardCharsets.UTF_8))) {
            String line = reader.readLine();
            return line == null ? 0 : Integer.parseInt(line.trim());
        } catch (Exception error) {
            return 0;
        }
    }

    private void copyPayload(File dir) throws IOException {
        AssetManager assets = getContext().getAssets();
        for (String name : ENGINE_ASSETS) {
            // 先写 .part 再改名：中途写满/被杀时不会留下「看着铺好了、其实是半截」的
            // 引擎二进制（那种文件能过 isFile/canExecute 检查，一跑就崩）。
            File target = new File(dir, name);
            File staging = new File(dir, name + ".part");
            try (InputStream in = assets.open(ASSET_DIR + "/" + name); OutputStream out = new FileOutputStream(staging)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            } catch (IOException error) {
                staging.delete();
                if (isRequiredAsset(name)) throw error;
                // 可选资产（智子档）铺不开只是那一档置灰，自带档照常可用。
                diag("可选资产铺开失败（该档位将置灰）：" + name + " — " + error.getMessage());
                continue;
            }
            if (!staging.renameTo(target)) {
                staging.delete();
                throw new IOException("资产落盘失败：" + name);
            }
        }
        // 旧版本留下的引擎/模型（见 STALE_PAYLOAD_FILES）：铺开时顺手删掉，回收那 20MB 磁盘。
        for (String stale : STALE_PAYLOAD_FILES) {
            new File(dir, stale).delete();
        }
        // 戳最后写：中途失败（磁盘满/被杀）时戳不更新，下次 prepare 会整体重铺，
        // 不会留下「半新半旧却自认已铺好」的资产。
        try (OutputStream out = new FileOutputStream(new File(dir, PAYLOAD_STAMP))) {
            out.write(String.valueOf(PAYLOAD_VERSION).getBytes(StandardCharsets.UTF_8));
        }
    }
}
