package cn.renjunote.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String MIGRATION_PREFERENCES = "banbu_native_migrations";
    // Bump this whenever the bundled web UI changes in a way that could be
    // masked by a legacy WebView service-worker/cache entry. The preference
    // is app-local; changing it clears only cached web resources, not user
    // records or settings.
    private static final String SERVICE_WORKER_MIGRATION = "service_worker_cache_cleared_v116_ui3";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean shouldRefreshBundledWebUi = shouldRefreshBundledWebUi();
        if (shouldRefreshBundledWebUi) {
            clearLegacyServiceWorkerStorage();
        }
        super.onCreate(savedInstanceState);
        if (shouldRefreshBundledWebUi && bridge != null && bridge.getWebView() != null) {
            // Capacitor's index.html can also be held by the ordinary WebView
            // HTTP cache. Clearing only Service Worker/CacheStorage is not
            // enough when several APKs reuse the same version name.
            bridge.getWebView().clearCache(true);
            bridge.getWebView().post(() -> {
                if (bridge == null || bridge.getWebView() == null) {
                    return;
                }
                bridge.getWebView().reload();
                getSharedPreferences(MIGRATION_PREFERENCES, MODE_PRIVATE)
                        .edit()
                        .putBoolean(SERVICE_WORKER_MIGRATION, true)
                        .apply();
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
            bridge.getWebView().goBack();
            return;
        }
        super.onBackPressed();
    }

    private boolean shouldRefreshBundledWebUi() {
        return !getSharedPreferences(MIGRATION_PREFERENCES, MODE_PRIVATE)
                .getBoolean(SERVICE_WORKER_MIGRATION, false);
    }

    private void clearLegacyServiceWorkerStorage() {
        File webViewRoot = new File(getDataDir(), "app_webview");
        deleteRecursively(new File(webViewRoot, "Default/Service Worker"));
        deleteRecursively(new File(webViewRoot, "Service Worker"));
        deleteRecursively(new File(webViewRoot, "Default/CacheStorage"));
        deleteRecursively(new File(webViewRoot, "CacheStorage"));
    }

    private boolean deleteRecursively(File target) {
        if (!target.exists()) {
            return true;
        }
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                if (!deleteRecursively(child)) {
                    return false;
                }
            }
        }
        return target.delete();
    }
}
