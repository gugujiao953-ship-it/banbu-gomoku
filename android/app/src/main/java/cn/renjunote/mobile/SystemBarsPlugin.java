package cn.renjunote.mobile;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏控制：**全屏模式**开关（设置里那一项）与状态栏图标的深浅。
 *
 * ## 为什么安全区必须由原生告诉网页层
 * 安卓 WebView 的 `env(safe-area-inset-*)` 基本恒为 0（那是 iOS Safari 的特性）——
 * 2026-10-14 一加 13 那轮就是踩了这个：原生一开 edge-to-edge，网页层补不出那条安全区，
 * 顶栏直接压进状态栏与摄像头那一行，最上面一排按钮点不到（触摸落在系统的下拉条上）。
 * ⇒ 现在由原生读 `WindowInsets` 的真值，写成网页层的 CSS 变量 `--safe-area-top/bottom`，
 *   CSS 那边一直用的就是这两个变量（`design-tokens.css` 里 `env()` 只是回退）。
 *   **不写任何机型尺寸**：刘海多高、手势条多高，全部来自系统当次汇报。
 *
 * ## 两种模式
 * - **默认（全屏关）**：什么都不做 ⇒ 就是安卓默认——系统自己给状态栏/导航栏留位，
 *   网页层从那两条下面开始画，顶栏完整可见可点。安全区变量显式写 0，避免任何"加两遍"。
 * - **全屏开**：`setDecorFitsSystemWindows(false)` + 显示挖孔区 + **隐藏状态栏** +
 *   把真实内缩写成 CSS 变量。用户要的"顶到最上面、不显示手机上方状态"。
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /** 当前是不是全屏模式（进程内记忆；页面重载后由网页层重新下发一次）。 */
    private static boolean fullScreen = false;

    /** 网页层在启动时与开关变化时调：`{ enabled: boolean, dark: boolean }`。 */
    @PluginMethod
    public void setStyle(PluginCall call) {
        Boolean enabledBox = call.getBoolean("enabled");
        Boolean darkBox = call.getBoolean("dark");
        final boolean enabled = Boolean.TRUE.equals(enabledBox);
        final boolean dark = Boolean.TRUE.equals(darkBox);
        getActivity().runOnUiThread(() -> {
            fullScreen = enabled;
            Window window = getActivity().getWindow();
            applyFullScreen(window, enabled, bridgeOf());
            applyIconStyle(window, dark);
            // 内缩随方向/系统栏变化，挂一个监听把最新的值推给网页（换方向、切手势导航都算）。
            installInsetListener(window, bridgeOf());
            call.resolve();
        });
    }

    private Bridge bridgeOf() {
        Bridge bridge = getBridge();
        return bridge;
    }

    /** 网页层重载（换版本清缓存后会 reload）时把上次的模式与内缩补发一次。 */
    @PluginMethod
    public void refresh(PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark"));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            applyFullScreen(window, fullScreen, bridgeOf());
            applyIconStyle(window, dark);
            call.resolve();
        });
    }

    // ────────────────────────── 实现 ──────────────────────────

    static void applyFullScreen(Window window, boolean enabled, Bridge bridge) {
        if (window == null) return;
        if (enabled) {
            if (Build.VERSION.SDK_INT >= 30) {
                window.setDecorFitsSystemWindows(false);
                WindowManager.LayoutParams attrs = window.getAttributes();
                attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
                window.setAttributes(attrs);
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                window.getDecorView().setSystemUiVisibility(
                        window.getDecorView().getSystemUiVisibility()
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN);
                if (Build.VERSION.SDK_INT >= 28) {
                    WindowManager.LayoutParams attrs = window.getAttributes();
                    attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                    window.setAttributes(attrs);
                }
            }
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        } else {
            // 交还给系统：内容从状态栏/导航栏下方开始（这就是"之前那样"）。
            if (Build.VERSION.SDK_INT >= 30) {
                window.setDecorFitsSystemWindows(true);
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) controller.show(WindowInsets.Type.statusBars());
            } else {
                int flags = window.getDecorView().getSystemUiVisibility();
                flags &= ~(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                window.getDecorView().setSystemUiVisibility(flags);
            }
            restoreSystemBarColors(window);
        }
        pushInsetsToWeb(bridge, window);
    }

    /**
     * 全屏关掉时把系统栏颜色恢复成主题里那条：全屏模式把状态栏设成了透明，
     * 直接退出会留一条"透明状态栏压在浅色界面上"的白条（用户 2026-10-14 报的
     * 「最上面的状态栏白得看不见了」就是这个形态）。主题没给值就退回透明 + 深色图标，
     * 至少保证浅底深字看得清。
     */
    static void restoreSystemBarColors(Window window) {
        if (window == null) return;
        android.util.TypedValue value = new android.util.TypedValue();
        boolean hasStatus = window.getContext().getTheme().resolveAttribute(android.R.attr.statusBarColor, value, true);
        window.setStatusBarColor(hasStatus ? value.data : android.graphics.Color.TRANSPARENT);
        android.util.TypedValue navValue = new android.util.TypedValue();
        boolean hasNav = window.getContext().getTheme().resolveAttribute(android.R.attr.navigationBarColor, navValue, true);
        window.setNavigationBarColor(hasNav ? navValue.data : android.graphics.Color.TRANSPARENT);
    }

    /** 把系统当次汇报的内缩写成 CSS 变量（全屏关时显式写 0，杜绝任何"加两遍"）。 */
    private static void pushInsetsToWeb(Bridge bridge, Window window) {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null || window == null) return;
        float density = window.getContext().getResources().getDisplayMetrics().density;
        int topPx = 0;
        int bottomPx = 0;
        if (Build.VERSION.SDK_INT >= 30 && fullScreen) {
            WindowInsets insets = window.getDecorView().getRootWindowInsets();
            if (insets != null) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets cutout = insets.getInsets(WindowInsets.Type.displayCutout());
                topPx = Math.max(bars.top, cutout.top);
                bottomPx = bars.bottom;
            }
        } else if (Build.VERSION.SDK_INT >= 23 && fullScreen) {
            // 老系统：不深究内缩来源，用系统栏高度兜底（`setDecorFitsSystemWindows` 不存在时的近似）。
            android.util.DisplayMetrics metrics = window.getContext().getResources().getDisplayMetrics();
            topPx = (int) (24 * density);
            bottomPx = (int) (48 * metrics.density);
        }
        String js = "(function(){var r=document.documentElement;if(!r)return;"
                + "r.style.setProperty('--safe-area-top','" + (topPx / density) + "px');"
                + "r.style.setProperty('--safe-area-bottom','" + (bottomPx / density) + "px');})();";
        webView.evaluateJavascript(js, null);
    }

    private void installInsetListener(Window window, Bridge bridge) {
        if (Build.VERSION.SDK_INT < 30 || window == null) return;
        window.getDecorView().setOnApplyWindowInsetsListener((view, insets) -> {
            pushInsetsToWeb(bridge, window);
            return view.onApplyWindowInsets(insets);
        });
    }

    /** 状态栏/导航栏图标深浅：浅色界面用深色图标，深色主题用浅色图标。 */
    @SuppressWarnings("deprecation")
    static void applyIconStyle(Window window, boolean dark) {
        if (window == null) return;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(dark ? 0 : light, light);
            return;
        }
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        flags &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (!dark) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }
}
