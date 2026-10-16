package cn.renjunote.mobile;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 悬浮棋盘（画中画）插件（用户 09-17 第二批⑥）。
 *
 * 安卓 WebView 不支持网页的 Document PiP API，所以小窗必须由原生 Activity 提供：
 * enterPictureInPictureMode 之后 WebView 仍然渲染在同一个 Activity 里，前端无需
 * 搬家 DOM。要点：
 *  - 只有 API 26+ 才有 PiP（minSdk 24，所以运行时要判版本）。
 *  - 进入 PiP 时 Activity 只是 onPause（可见但失焦），WebView 的 JS 会被系统降频；
 *    前端因此要按"是否 PiP"给后台取消引擎计算的逻辑开例外——这个状态由本插件
 *    通过 pictureInPicture 事件回传（见 MainActivity.onPictureInPictureModeChanged）。
 */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        result.put("active", isActivityInPip());
        call.resolve(result);
    }

    @PluginMethod
    public void enter(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("当前系统版本不支持画中画（需要 Android 8.0 及以上）");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("拿不到当前界面，无法进入画中画");
            return;
        }
        if (isActivityInPip()) {
            JSObject already = new JSObject();
            already.put("active", true);
            call.resolve(already);
            return;
        }
        try {
            // 16:9 是小窗的常规比例；棋盘是正方形，前端在小窗里居中显示。
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(9, 16));
            activity.enterPictureInPictureMode(builder.build());
            JSObject result = new JSObject();
            result.put("active", true);
            call.resolve(result);
        } catch (IllegalStateException error) {
            // 系统拒绝（例如正在分屏、或设备策略禁止）时如实报错，前端回落到"不支持"。
            call.reject("系统拒绝了画中画请求：" + error.getMessage());
        }
    }

    @PluginMethod
    public void exit(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", false);
        call.resolve(result);
    }

    private boolean isActivityInPip() {
        Activity activity = getActivity();
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity != null && activity.isInPictureInPictureMode();
    }
}
