package cn.renjunote.mobile;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * 原生震动（用户 2026-09-28 真机反馈「触觉反馈没有生效」）。
 *
 * 为什么必须走原生：网页侧那套实现用的是 navigator.vibrate，而 WebView 把震动委托给
 * 宿主应用的 WebChromeClient.onVibrate()——Capacitor 的 BridgeWebChromeClient 压根没
 * 实现它（整个 com/getcapacitor 里 grep onVibrate 零命中），也没有任何地方补过。结果就是
 * 应用里这条 API 永远静默无操作（部分版本还返回 true，于是连"失败"都看不出来）。
 * 原注释里「安卓 WebView 原生支持、不需要新增插件」的前提是错的。
 *
 * 两件事配套，缺一不可：
 *   1) AndroidManifest 里的 <uses-permission android:name="android.permission.VIBRATE"/>
 *      ——之前完全没有；targetSdk 31+ 上没这条权限，vibrate() 会 SecurityException。
 *   2) 本插件 + MainActivity 的 registerPlugin。
 *
 * 插件名叫 NativeHaptics 而不是 Haptics：官方包 @capacitor/haptics 占用了 "Haptics"
 * 这个注册名（当前没装），将来万一装上不会撞车。
 *
 * 与 @capacitor/haptics 不同，这里刻意不做 npm 依赖：本项目所有自研桥（NativeEngine /
 * NativeKataGo / Pip / IncomingFile…）都是 Java 注册 + 网页层鸭子类型取用，不写进
 * assets/capacitor.plugins.json，保持一致。
 */
@CapacitorPlugin(name = "NativeHaptics")
public class HapticsPlugin extends Plugin {

    /** supported() → { hasVibrator }：网页层用它判断"这台机器到底能不能震"，避免每次落子都吃一个 reject。 */
    @PluginMethod
    public void supported(PluginCall call) {
        Vibrator vibrator = obtainVibrator();
        JSObject result = new JSObject();
        result.put("hasVibrator", vibrator != null && vibrator.hasVibrator());
        call.resolve(result);
    }

    /**
     * vibrate({ pattern: [12] }) 或 vibrate({ duration: 12 })。
     * pattern 与 navigator.vibrate 同口径——「震/停」交替的毫秒数组，网页层一套节奏表两端共用。
     */
    @PluginMethod
    public void vibrate(PluginCall call) {
        Vibrator vibrator = obtainVibrator();
        if (vibrator == null || !vibrator.hasVibrator()) {
            call.reject("这台设备没有震动马达");
            return;
        }
        long[] pattern = readPattern(call);
        if (pattern.length == 0) {
            call.reject("缺少震动参数 pattern");
            return;
        }
        boolean started = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // 31+：vibrate(VibrationEffect) 在公开 SDK 里是 **void** 签名（没有任何
            // boolean 重载——编译报「void 无法转换为 boolean」就是这个原因），被系统
            // 挡下（省电模式等）时不会报错，只能事后探测。这里火后不理：真的被挡
            // 也只是不震，不当作失败。
            vibrator.vibrate(buildEffect(pattern));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // 26–30：同一个方法在这几个版本上是 void 签名（描述符不同），
            // 所以绝不能在这里接返回值——那会在老机器上抛 NoSuchMethodError。
            vibrator.vibrate(buildEffect(pattern));
        } else {
            // 24–25：没有 VibrationEffect，用旧接口。
            vibrator.vibrate(pattern, -1);
        }
        if (!started) {
            call.reject("震动被系统拒绝（省电模式或无障碍设置）");
            return;
        }
        JSObject result = new JSObject();
        result.put("vibrated", true);
        call.resolve(result);
    }

    private Vibrator obtainVibrator() {
        Context context = getContext();
        if (context == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        Object service = context.getSystemService(Context.VIBRATOR_SERVICE);
        return service instanceof Vibrator ? (Vibrator) service : null;
    }

    /** 单段封顶 5 秒：节奏表写错也不至于把手机震到发烫。 */
    private long[] readPattern(PluginCall call) {
        JSONArray raw = call.getData().optJSONArray("pattern");
        if (raw == null) {
            Integer duration = call.getInt("duration");
            if (duration == null || duration <= 0) return new long[0];
            return new long[] { Math.min(duration.longValue(), 5000L) };
        }
        long[] pattern = new long[raw.length()];
        for (int index = 0; index < raw.length(); index += 1) {
            pattern[index] = Math.max(0L, Math.min((long) raw.optInt(index, 0), 5000L));
        }
        return pattern;
    }

    private static VibrationEffect buildEffect(long[] pattern) {
        // createWaveform 要求数组至少两项（震-停成对）；单段震动用 createOneShot。
        if (pattern.length == 1) {
            return VibrationEffect.createOneShot(pattern[0], VibrationEffect.DEFAULT_AMPLITUDE);
        }
        return VibrationEffect.createWaveform(pattern, -1);
    }
}
