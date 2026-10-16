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
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 安卓原生 Rapfi 引擎：把随包分发的可执行文件当成子进程跑起来，用管道喂命令、按行收输出。
 *
 * 为什么需要它：安卓 WebView 不支持跨源隔离（设备实测：即使带上 COOP/COEP，
 * crossOriginIsolated 仍为 false、SharedArrayBuffer 为 undefined），所以 wasm 的
 * pthread 多线程在 APK 里永远不可能生效。原生进程用真正的线程，不需要 SAB。
 * 模拟器 4 核实测：wasm 强力 23.7k nps → 原生 4 线程 235k nps（≈10×）。
 *
 * 可执行文件放在 jniLibs/<abi>/librapfi-engine.so：Android 会把 native libs 解压到
 * 应用私有目录并允许执行，这是不需要 root 就能 exec 自带二进制的标准做法（必须以
 * lib*.so 命名才会被打进 APK）。权重放在 assets/engine-native/，首次运行时复制到
 * 私有目录——引擎是按路径读文件的。
 *
 * 协议与网页版的 WASM worker 完全一致（START / INFO … / YXBOARD … DONE / YXNBEST /
 * YXSTOP），所以协议逻辑只存在于 JS worker 一处，这里纯粹是管道。
 */
@CapacitorPlugin(name = "NativeEngine")
public class NativeEnginePlugin extends Plugin {

    /** 引擎要读的文件（与 scripts/build-android-engine.mjs 铺进 assets 的一致）。 */
    private static final String[] ENGINE_ASSETS = {
            "config.toml",
            "classical210901.toml",
            "classical220723.toml",
            "model210901.bin",
            "model220723.bin",
            "mix9svqfreestyle_bsmix.bin.lz4",
            "mix9svqstandard_bs15.bin.lz4",
            "mix9svqrenju_bs15_black.bin.lz4",
            "mix9svqrenju_bs15_white.bin.lz4",
    };
    private static final String ASSET_DIR = "engine-native";
    private static final String WORK_DIR_NAME = "native-engine";
    /** 权重 39MB，复制一次即可；用文件长度做完整性标记。
     *  2026-10-01：随引擎 0.43.01→0.43.02 换新格式经典模型
     *  （model210901 23,204→30,109、model220723 59,730→77,518，合计 +24,693），
     *  旧引擎读不了新模型、新引擎读不了旧模型，字节总数必须同步更新，
     *  否则升级后设备上旧模型残留、引擎起不来。
     *  ⚠ 改 config.toml 也要过这一关：2026-10-13 把 advanced_stop_ratio 从官方的 0.75
     *  改成 0.90（与网页版 wasm 数据包的同名调针一致，见 src/features/ai/engine-pack.ts 的
     *  CONFIG_TUNE_NEEDLES 与提交 34ec781）。写成 **0.90 而不是 0.9** 是故意的——等长替换
     *  让这个字节和保持不变；谁要是顺手改成 `0.9`，总数会少 1 字节，
     *  isPayloadComplete() 就会判非法、原生引擎根本不启动。 */
    private static final long ENGINE_PAYLOAD_BYTES = 40331099L;

    private Process process;
    private Writer processStdin;
    private Thread readerThread;
    private final AtomicBoolean running = new AtomicBoolean(false);
    /** 进程重启时使旧 reader 线程不能覆盖新进程的状态。 */
    private volatile long processGeneration = 0L;
    /** 选中哪个可执行文件（诊断用；见 binaryFile 的选择逻辑）。 */
    private String binaryVariant = "";
    /** NEON DotProd 开关（用户 09-16 要求能在分析栏里开/关）：null = 按 CPU 能力自动。
     *  显式 true 时即使探测不到 asimddp 也照用（用于验证），显式 false 时强制基线。 */
    private static volatile Boolean dotprodPreference = null;
    /** 本机 CPU 是否支持 DotProd（与用户偏好无关，UI 用它决定开关是否可用）。 */
    private static boolean dotprodCapable = false;

    /** 探测：这个安装包到底带不带原生引擎、当前设备 ABI 对不对。 */
    @PluginMethod
    public void check(PluginCall call) {
        JSObject result = new JSObject();
        File binary = binaryFile();
        // 可用性只看「本包是否带了这个 ABI 的可执行文件」——权重是首次启动时才复制
        // 的（prepare），把它算进可用条件会让探测永远返回不可用。
        result.put("available", binary != null && binary.canExecute());
        boolean payloadReady = payloadDir().isDirectory() && isPayloadComplete();
        result.put("payloadReady", payloadReady);
        result.put("assetsCopied", payloadReady);
        result.put("binaryPath", binary == null ? "" : binary.getAbsolutePath());
        result.put("binaryVariant", binaryVariant);
        result.put("abi", android.os.Build.SUPPORTED_ABIS.length > 0 ? android.os.Build.SUPPORTED_ABIS[0] : "");
        result.put("cores", Runtime.getRuntime().availableProcessors());
        // 大小核拓扑：手机多是 4 大 + 4 小，而 Lazy SMP 的每一层迭代会被最慢的线程拖住，
        // 所以「全核」有可能比「按大核数」更慢。引擎自己不知道核心类型，这里报给 UI，
        // 用户才有依据去选线程数（2026-09-16）。
        result.put("bigCores", countBigCores(Runtime.getRuntime().availableProcessors()));
        result.put("dotprodCapable", dotprodCapable);
        result.put("dotprodEnabled", binaryVariant.equals("dotprod"));
        result.put("dotprodPreference", dotprodPreference == null ? "auto" : (dotprodPreference ? "on" : "off"));
        call.resolve(result);
    }

    /** 以各核最大频率区分大小核：取最高频那批的数量。读不到就返回全部核心数（当作同构）。 */
    private static int countBigCores(int cores) {
        try {
            long maxKhz = 0;
            long[] freqs = new long[cores];
            for (int cpu = 0; cpu < cores; cpu += 1) {
                File file = new File("/sys/devices/system/cpu/cpu" + cpu + "/cpufreq/cpuinfo_max_freq");
                if (!file.isFile()) return cores;
                long khz = Long.parseLong(readFirstLine(file));
                freqs[cpu] = khz;
                maxKhz = Math.max(maxKhz, khz);
            }
            int big = 0;
            for (long khz : freqs) if (khz >= maxKhz * 9 / 10) big += 1;
            return big > 0 ? big : cores;
        } catch (Exception ignored) {
            return cores;
        }
    }

    private static String readFirstLine(File file) throws IOException {
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line = reader.readLine();
            return line == null ? "" : line.trim();
        }
    }

    /** 切换 NEON DotProd（下一轮搜索生效；引擎进程需重启才能换二进制）。 */
    @PluginMethod
    public void setDotprod(PluginCall call) {
        String mode = call.getString("mode", "auto");
        dotprodPreference = "on".equals(mode) ? Boolean.TRUE : "off".equals(mode) ? Boolean.FALSE : null;
        boolean capable = cpuSupportsDotprod();
        JSObject result = new JSObject();
        result.put("preference", mode);
        // 显式开启但本机不支持时如实回报：二进制仍会按用户要求使用（用于验证），
        // 但真机上执行到 sdot/udot 会 SIGILL，所以这项只在排障时用。
        result.put("capable", capable);
        result.put("restartRequired", true);
        call.resolve(result);
    }

    /** 首次运行把 assets 里的权重铺到私有目录；已铺过就直接返回。 */
    @PluginMethod
    public void prepare(PluginCall call) {
        try {
            File dir = payloadDir();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建引擎目录");
            if (!isPayloadComplete()) copyPayload(dir);
            JSObject result = new JSObject();
            result.put("ready", true);
            result.put("dir", dir.getAbsolutePath());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("原生引擎权重准备失败：" + error.getMessage());
        }
    }

    /** 起进程。协议里的命令随后用 write 送进去。 */
    @PluginMethod
    public void start(PluginCall call) {
        if (running.get()) {
            JSObject result = new JSObject();
            result.put("running", true);
            result.put("cores", Runtime.getRuntime().availableProcessors());
            call.resolve(result);
            return;
        }
        File binary = binaryFile();
        if (binary == null || !binary.canExecute()) {
            call.reject("本安装包不包含当前设备可用的原生引擎");
            return;
        }
        try {
            File dir = payloadDir();
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath());
            builder.directory(dir);          // 引擎按相对路径找 config.toml 与权重
            builder.redirectErrorStream(true); // 引擎的错误也走同一管道，便于日志
            builder.environment().put("RAPFI_HOME", dir.getAbsolutePath());
            Process child = builder.start();
            process = child;
            long generation = ++processGeneration;
            processStdin = new OutputStreamWriter(child.getOutputStream(), StandardCharsets.UTF_8);
            running.set(true);
            startReader(child, generation);
            JSObject result = new JSObject();
            result.put("running", true);
            result.put("cores", Runtime.getRuntime().availableProcessors());
            call.resolve(result);
        } catch (Exception error) {
            running.set(false);
            call.reject("原生引擎启动失败：" + error.getMessage());
        }
    }

    /** 送一行命令（引擎按行读 stdin）。 */
    @PluginMethod
    public void write(PluginCall call) {
        String line = call.getString("line", "");
        try {
            if (!running.get() || processStdin == null) throw new IOException("引擎未运行");
            processStdin.write(line);
            processStdin.write("\n");
            processStdin.flush();
            call.resolve();
        } catch (Exception error) {
            call.reject("写入原生引擎失败：" + error.getMessage());
        }
    }

    /** 硬停止：进程级别的 kill。正常停止应先在 JS 侧发协议命令 YXSTOP。 */
    @PluginMethod
    public void stop(PluginCall call) {
        killProcess();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        killProcess();
        super.handleOnDestroy();
    }

    private void startReader(final Process child, final long generation) {
        readerThread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
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
        }, "native-engine-reader");
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

    /** jniLibs 里的可执行文件（Android 会把 native libs 解到应用私有目录）。
     *
     *  arm64 打了两份：基线 `-march=armv8-a+simd` 与 NEON DotProd（`armv8.2-a+dotprod`）。
     *  DotProd 是 NNUE int8 点积的硬件加速——基线二进制里 `sdot`/`udot` 指令数是 0，
     *  等于整个放弃这项加速；但 armv8.2 之前的机器执行到会 SIGILL。所以按 CPU 特性挑：
     *  支持 `asimddp` 才用 dotprod 那份，否则用基线（见 build-android-engine.mjs）。 */
    private File binaryFile() {
        String dir = getContext().getApplicationInfo().nativeLibraryDir;
        File dotprod = new File(dir, "librapfi-engine-dotprod.so");
        dotprodCapable = cpuSupportsDotprod();
        Boolean preference = dotprodPreference;
        // null = 自动（有能力就用）；true/false = 用户在分析栏里的显式选择。
        boolean wantDotprod = dotprod.isFile() && (preference == null ? dotprodCapable : preference);
        File candidate = new File(dir, wantDotprod ? "librapfi-engine-dotprod.so" : "librapfi-engine.so");
        binaryVariant = wantDotprod ? "dotprod" : "baseline";
        if (candidate.isFile()) return candidate;
        binaryVariant = "";
        return null;
    }

    /** /proc/cpuinfo 的 Features 里有 asimddp 就是 ARMv8.2+ 的 DotProd（读一次并缓存）。
     *  包内可见：NativeKataGoPlugin 的智子大网档共用同一个探测结果（那份 .so 里确实有
     *  dotprod 指令，在没有 asimddp 的 CPU 上执行会直接 SIGILL，不能只按文件存在性放行）。 */
    private static volatile Boolean dotprodSupported = null;

    static boolean cpuSupportsDotprod() {
        Boolean cached = dotprodSupported;
        if (cached != null) return cached;
        boolean supported = false;
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/cpuinfo"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.toLowerCase().startsWith("features")) continue;
                if (line.toLowerCase().contains("asimddp")) { supported = true; break; }
            }
        } catch (Exception ignored) {
            // 读不到就当不支持：宁可少一点加速，也不能让引擎执行非法指令。
        }
        dotprodSupported = supported;
        return supported;
    }

    private File payloadDir() {
        return new File(getContext().getFilesDir(), WORK_DIR_NAME);
    }

    private boolean isPayloadComplete() {
        long total = 0;
        for (String name : ENGINE_ASSETS) {
            File file = new File(payloadDir(), name);
            if (!file.isFile()) return false;
            total += file.length();
        }
        return total == ENGINE_PAYLOAD_BYTES;
    }

    private void copyPayload(File dir) throws IOException {
        AssetManager assets = getContext().getAssets();
        List<String> source = new ArrayList<>(Arrays.asList(ENGINE_ASSETS));
        for (String name : source) {
            File target = new File(dir, name);
            try (InputStream in = assets.open(ASSET_DIR + "/" + name); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            }
        }
    }
}
