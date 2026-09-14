package cn.renjunote.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;

/**
 * Photo-library picker bridge.
 *
 * The WebView's &lt;input type="file"&gt; cannot choose a starting directory — browsers
 * deliberately hide that — so Android users land in "Recents" and have to dig
 * into folders every single time. The system photo picker opens on the pictures
 * collection by default and still lets the user switch to any other provider or
 * folder, which is exactly the requested behaviour.
 *
 * Two paths:
 *   · API 33+      ACTION_PICK_IMAGES (the modern photo picker)
 *   · API 24..32   ACTION_OPEN_DOCUMENT with an image MIME filter — same
 *                  "pick" semantics without requiring a storage permission
 *
 * The picked image is returned as raw bytes so the web layer can feed its
 * existing image-recognition pipeline without a second fetch.
 */
@CapacitorPlugin(name = "PhotoPicker")
public class PhotoPickerPlugin extends Plugin {

    private static final String[] IMAGE_MIME_TYPES = new String[]{
            "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/heic", "image/heif"
    };

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 系统相册选择器：默认停在「图片」集合，用户仍可切到其他图库/文件夹。
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.setType("image/*");
        } else {
            // 旧系统没有相册选择器：用文档选择器并限定图片类型（等效的「挑选」语义，
            // 同样无需任何存储权限，用户可在侧栏切换到下载/相册等来源）。
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, IMAGE_MIME_TYPES);
        }
        try {
            startActivityForResult(call, intent, "imagePicked");
        } catch (Exception error) {
            call.reject("无法打开系统的图片选择器");
        }
    }

    @ActivityCallback
    private void imagePicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("已取消选择图片");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            String mimeType = resolver.getType(uri);
            InputStream input = resolver.openInputStream(uri);
            if (input == null) {
                call.reject("无法读取所选图片");
                return;
            }
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = input.read(chunk)) > 0) {
                buffer.write(chunk, 0, read);
            }
            input.close();

            JSObject payload = new JSObject();
            payload.put("dataUrl", "data:" + (mimeType == null ? "image/*" : mimeType)
                    + ";base64," + Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            payload.put("mimeType", mimeType == null ? "image/*" : mimeType);
            payload.put("name", displayName(uri));
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("读取所选图片失败：" + error.getMessage());
        }
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.isEmpty()) {
                        return value;
                    }
                }
            }
        } catch (Exception ignored) {
            // A missing display name is cosmetic; the caller falls back to a default.
        }
        return "棋谱照片";
    }
}
