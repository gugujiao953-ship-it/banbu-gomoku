package cn.renjunote.mobile;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * 应用内下载的新版安装包 → 系统安装器。
 *
 * 为什么需要原生插件：WebView 里拿不到一条能唤起包安装器的路径。把 APK 写进应用
 * 私有/外部 files 目录后，必须用 FileProvider 换成 content:// URI 并配
 * FLAG_GRANT_READ_URI_PERMISSION，系统安装器才愿意读它——file:// 会被
 * FileUriExposedException 直接拒绝。
 *
 * 关于权限：这里**不需要** REQUEST_INSTALL_PACKAGES。该权限用于「静默安装」；
 * 本插件的语义是「把包交给系统安装器」，安装器自己会弹标准的未知来源授权页，
 * 用户确认一次即可。加权限只会在应用商店审核与安全软件提示上带来额外负担。
 *
 * @CapacitorPlugin 的权限回调不需要：写的是应用自己的 files 目录。
 */
@CapacitorPlugin(name = "ApkInstall")
public class ApkInstallPlugin extends Plugin {

    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String APK_DIR = "updates";

    /**
     * 把 base64 编码的 APK 写入外部 files 目录并唤起系统安装器。
     * 参数：filename（文件名）、data（base64 内容）。
     */
    @PluginMethod
    public void install(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (filename == null || filename.trim().isEmpty()) {
            call.reject("缺少安装包文件名");
            return;
        }
        if (data == null || data.isEmpty()) {
            call.reject("缺少安装包内容");
            return;
        }
        // 只允许纯文件名，杜绝 ../ 之类穿越到目录之外。
        String safeName = new File(filename).getName();
        if (!safeName.toLowerCase().endsWith(".apk")) {
            call.reject("安装包文件名必须以 .apk 结尾");
            return;
        }

        try {
            File dir = new File(getContext().getExternalFilesDir(null), APK_DIR);
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建安装包缓存目录");
                return;
            }
            // 每次覆盖写同一个文件名：下载完成的包已经校验过，不留旧包占地。
            File target = new File(dir, safeName);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(bytes);
                output.flush();
            }

            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    target
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // 明确列出能处理 APK 的组件类型，避免某些 ROM 把 ACTION_VIEW 交给
            // 内容查看器打开二进制文件（那样用户看到的是一堆乱码而不是安装页）。
            intent.addCategory(Intent.CATEGORY_DEFAULT);

            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("launched", true);
            result.put("path", target.getAbsolutePath());
            result.put("bytes", target.length());
            call.resolve(result);
        } catch (Exception error) {
            // 安装器缺失 / FileProvider 未配置 / 写盘失败都归到这里：上层据此退回
            // 「分享文件」或「浏览器下载」，不让用户卡在一个没有反应的按钮上。
            call.reject(error.getMessage() == null ? "无法唤起系统安装器" : error.getMessage());
        }
    }

    /** 清掉已下载的安装包缓存（安装或放弃后调用，避免外部 files 目录里留旧包）。 */
    @PluginMethod
    public void clearCache(PluginCall call) {
        try {
            File dir = new File(getContext().getExternalFilesDir(null), APK_DIR);
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
            }
            JSObject result = new JSObject();
            result.put("cleared", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "清理安装包缓存失败" : error.getMessage());
        }
    }
}
