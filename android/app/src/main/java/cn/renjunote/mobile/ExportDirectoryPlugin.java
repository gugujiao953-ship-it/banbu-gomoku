package cn.renjunote.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Storage Access Framework bridge.
 *
 * Android has no directory picker in the WebView, so the export folder is
 * chosen through the system document picker (ACTION_OPEN_DOCUMENT_TREE) and the
 * grant is persisted, which means a chosen folder keeps working after restarts
 * and needs no storage permission of its own.
 */
@CapacitorPlugin(name = "ExportDirectory")
public class ExportDirectoryPlugin extends Plugin {

    private static final int GRANT_FLAGS =
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(GRANT_FLAGS
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        // 重选时让系统选择器直接落在当前文件夹（Android 11 起生效；旧版本忽略这个
        // extra，行为与之前一致）。否则每次都从「文档」起步，用户要重新翻目录。
        String initialUri = call.getString("initialUri");
        if (initialUri != null) {
            try {
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initialUri));
            } catch (Exception ignored) {
                // 起始位置只是便利项：解析失败就交给系统默认位置。
            }
        }
        try {
            startActivityForResult(call, intent, "directoryPicked");
        } catch (Exception error) {
            call.reject("无法打开系统的文件夹选择器");
        }
    }

    @ActivityCallback
    private void directoryPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            call.reject("已取消选择文件夹");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, GRANT_FLAGS);
        } catch (SecurityException error) {
            call.reject("没有拿到该文件夹的长期写入权限，请重新选择");
            return;
        }
        JSObject payload = new JSObject();
        payload.put("uri", tree.toString());
        payload.put("name", displayName(tree));
        payload.put("location", location(tree));
        call.resolve(payload);
    }

    @PluginMethod
    public void checkDirectory(PluginCall call) {
        String uriString = call.getString("uri");
        JSObject payload = new JSObject();
        payload.put("granted", false);
        if (uriString != null) {
            try {
                Uri tree = Uri.parse(uriString);
                String wanted = treeDocumentId(tree);
                for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
                    if (!permission.isWritePermission()) {
                        continue;
                    }
                    // 按「树文档 id」比对而不是 Uri 字符串全等：同一个文件夹的 tree
                    // Uri 在不同 ROM / 不同系统版本上编码形式可能不同，全等比对会把
                    // 有效授权误判成已撤销（用户看到的现象就是「选完文件夹又变回默认」）。
                    // 另外用户当初授权的若是上级目录，同样覆盖当前目录。
                    String granted = treeDocumentId(permission.getUri());
                    if (granted == null || wanted == null) {
                        continue;
                    }
                    if (granted.equals(wanted) || wanted.startsWith(granted + "/")) {
                        payload.put("granted", true);
                        payload.put("name", displayName(tree));
                        payload.put("location", location(tree));
                        break;
                    }
                }
            } catch (Exception ignored) {
                // An unreadable grant means "not granted" rather than a hard error.
            }
        }
        call.resolve(payload);
    }

    @PluginMethod
    public void releaseDirectory(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uriString), GRANT_FLAGS);
            } catch (Exception ignored) {
                // Dropping a grant that is already gone is not a failure.
            }
        }
        call.resolve();
    }

    /**
     * 公共「下载」目录是否可写（用户 09-14：默认位置改成下载夹，设备没有就退回文档）。
     *
     * Android 10（API 29）起 MediaStore.Downloads 允许 App 免权限写入自己的文件，
     * 这是唯一不需要「所有文件访问权限」就能落到公共下载夹的正规途径；更老的系统没有
     * 这个集合，此时由 JS 侧退回「文档」默认位置（Capacitor Filesystem）。
     */
    @PluginMethod
    public void checkDownloads(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("available", downloadsAvailable());
        call.resolve(payload);
    }

    /** 写入公共下载目录下的 <folder>/<filename>：同名且是本 App 建的就覆盖，否则新建。 */
    @PluginMethod
    public void writeFileToDownloads(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        String folder = call.getString("folder");
        if (filename == null || data == null) {
            call.reject("写入参数不完整");
            return;
        }
        if (!downloadsAvailable()) {
            call.reject("当前设备不支持写入公共下载目录");
            return;
        }
        String relativePath = Environment.DIRECTORY_DOWNLOADS + (folder == null || folder.isEmpty() ? "" : "/" + folder);
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        ContentResolver resolver = getContext().getContentResolver();
        try {
            Uri existing = findDownload(resolver, relativePath, filename);
            if (existing != null) {
                try (OutputStream output = resolver.openOutputStream(existing, "rwt")) {
                    if (output == null) throw new IllegalStateException("无法写入下载目录");
                    output.write(bytes);
                    output.flush();
                }
                call.resolve();
                return;
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, normalizeMimeType(call.getString("mimeType")));
            values.put(MediaStore.Downloads.RELATIVE_PATH, relativePath + "/");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri created = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (created == null) throw new IllegalStateException("无法在下载目录新建文件");
            try (OutputStream output = resolver.openOutputStream(created, "w")) {
                if (output == null) throw new IllegalStateException("无法写入下载目录");
                output.write(bytes);
                output.flush();
            }
            ContentValues finished = new ContentValues();
            finished.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(created, finished, null, null);
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "写入下载目录失败" : error.getMessage());
        }
    }

    private boolean downloadsAvailable() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return false;
        }
        try (Cursor cursor = getContext().getContentResolver().query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[] { MediaStore.Downloads._ID },
                null, null, null)) {
            return cursor != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** 下载目录里同相对路径下的同名条目（只可能是本 App 建的，才拿得到写权限）。 */
    private Uri findDownload(ContentResolver resolver, String relativePath, String filename) {
        try {
            String selection = MediaStore.Downloads.DISPLAY_NAME + "=? AND " + MediaStore.Downloads.RELATIVE_PATH + "=?";
            try (Cursor cursor = resolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    new String[] { MediaStore.Downloads._ID },
                    selection,
                    new String[] { filename, relativePath + "/" },
                    null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getLong(0));
                }
            }
        } catch (Exception ignored) {
            // 查询失败就当作「不存在」，交给上层新建（MediaStore 会自己处理重名）。
        }
        return null;
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (uriString == null || filename == null || data == null) {
            call.reject("写入参数不完整");
            return;
        }
        try {
            Uri tree = Uri.parse(uriString);
            ContentResolver resolver = getContext().getContentResolver();
            Uri target = findChild(resolver, tree, filename);
            boolean existing = target != null;
            if (!existing) {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                target = DocumentsContract.createDocument(resolver, parent, normalizeMimeType(call.getString("mimeType")), filename);
            }
            if (target == null) {
                call.reject("无法在该文件夹中新建文件");
                return;
            }
            try (OutputStream output = openOutput(resolver, target, existing)) {
                output.write(Base64.decode(data, Base64.DEFAULT));
                output.flush();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "写入所选文件夹失败" : error.getMessage());
        }
    }

    private OutputStream openOutput(ContentResolver resolver, Uri target, boolean existing) throws Exception {
        if (!existing) {
            OutputStream created = resolver.openOutputStream(target, "w");
            if (created == null) throw new IllegalStateException("无法写入该文件夹");
            return created;
        }
        OutputStream truncated = resolver.openOutputStream(target, "rwt");
        if (truncated != null) {
            return truncated;
        }
        OutputStream overwritten = resolver.openOutputStream(target, "w");
        if (overwritten == null) throw new IllegalStateException("无法写入该文件夹");
        return overwritten;
    }

    private Uri findChild(ContentResolver resolver, Uri tree, String filename) {
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME };
            try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
                if (cursor == null) {
                    return null;
                }
                while (cursor.moveToNext()) {
                    if (filename.equals(cursor.getString(1))) {
                        return DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall through: a missing listing simply means "create a new file".
        }
        return null;
    }

    private String displayName(Uri tree) {
        try {
            Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String[] columns = { DocumentsContract.Document.COLUMN_DISPLAY_NAME };
            try (Cursor cursor = getContext().getContentResolver().query(document, columns, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.trim().isEmpty()) {
                        return name.trim();
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall through to the document id, which still names the folder.
        }
        try {
            String id = DocumentsContract.getTreeDocumentId(tree);
            int separator = id.indexOf(':');
            String tail = separator >= 0 ? id.substring(separator + 1) : id;
            return tail.isEmpty() ? "所选文件夹" : tail;
        } catch (Exception ignored) {
            return "所选文件夹";
        }
    }

    /** 树的文档 id；不是树 Uri 时返回 null。 */
    private String treeDocumentId(Uri tree) {
        try {
            return DocumentsContract.getTreeDocumentId(tree);
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 文件夹在人能认出来的层面上的位置。SAF 不给绝对路径，所以用树文档 id 去掉卷标
     *  之后的部分（如 "Documents/棋谱"）；选到卷根时只回卷标别名（"内部存储"）。 */
    private String location(Uri tree) {
        String id = treeDocumentId(tree);
        if (id == null) {
            return displayName(tree);
        }
        int separator = id.indexOf(':');
        String volume = separator >= 0 ? id.substring(0, separator) : "";
        String tail = separator >= 0 ? id.substring(separator + 1) : id;
        if (tail.isEmpty()) {
            return "primary".equals(volume) ? "内部存储" : (volume.isEmpty() ? "根目录" : volume);
        }
        return tail;
    }

    /** SAF rejects MIME types that carry parameters such as ";charset=utf-8". */
    private String normalizeMimeType(String mimeType) {
        if (mimeType == null) {
            return "application/octet-stream";
        }
        int separator = mimeType.indexOf(';');
        String normalized = (separator >= 0 ? mimeType.substring(0, separator) : mimeType).trim();
        return normalized.isEmpty() ? "application/octet-stream" : normalized;
    }
}
