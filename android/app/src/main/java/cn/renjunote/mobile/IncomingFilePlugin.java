package cn.renjunote.mobile;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 接收系统交给本应用的棋谱文件（用户 2026-09-23）。
 *
 * 场景：用户在文件管理器 / 微信 / QQ 里点一个 .sgf，或长按文件选「分享」再选半步。
 * 系统于是带着一个 VIEW / SEND intent 找上门来，这里负责把文件接住并交给网页层。
 *
 * 为什么不是「拿到就直接调 JS」：
 *   · 冷启动（应用根本没开）时系统是先起 Activity，此刻 Capacitor 的 bridge 与 WebView
 *     都还没就绪，这时候发 JS 事件会**静默丢掉**——而「从微信点文件」正是冷启动占多数。
 *   · 所以这里只做一件事：把文件**暂存**到应用私有目录，然后由网页层启动后主动来取
 *     （takeFiles）。事件只用于热启动（应用在后台时又收到一份）的即时提醒。
 *
 * 暂存用 getFilesDir()/incoming（内部私有目录）：走 ContentResolver 读别人的
 * content:// 不需要任何存储权限，落在私有目录也不需要，所以本功能**不需要新增权限**。
 *
 * 传的是 dataUrl 而不是文件路径：网页层拿不到安卓真实路径，而它的导入管线（zip/lib/dp 判定、
 * 图片识谱）都只要一个 File 对象，File 只能由字节构造。这与 PhotoPickerPlugin 的做法一致。
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {

    private static final String STAGE_DIR = "incoming";
    private static final String META_SUFFIX = ".meta";
    /** 单份上限 256MB：大型 LIB/DP 可能很大，但不能无限吃内存（超限如实报错而不是崩）。 */
    private static final long MAX_BYTES = 256L * 1024 * 1024;

    /**
     * 从 intent 里把文件拷进暂存目录。由 MainActivity 在冷启动（onCreate 取 getIntent）
     * 与热启动（onNewIntent）两条路上调用，返回本次接住的文件数。
     *
     * 三种携带方式都要认：
     *   · intent.getData()          → VIEW（点文件打开）
     *   · EXTRA_STREAM              → SEND（单份分享）
     *   · ClipData（含 EXTRA_STREAM 里的多份）→ SEND_MULTIPLE（多选分享）
     *
     * 2026-10-03 修：EXTRA_STREAM 这一路**以前根本没实现**。原代码只读 getData() 与
     * getClipData()，而单份分享时系统只填 EXTRA_STREAM、ClipData 是 null —— 于是在微信
     * 里「分享 → 半步」会把应用叫起来却一份文件都不传（用户当天的报障就是这个）。
     * 有些机型/OEM 还会把多份直接塞成 EXTRA_STREAM 里的 ArrayList<Uri>，一并认掉。
     */
    public static int stageFromIntent(Context context, Intent intent) {
        if (context == null || intent == null) {
            return 0;
        }
        List<Uri> uris = new ArrayList<>();
        addUri(uris, intent.getData());
        Object stream = intent.getExtras() == null ? null : intent.getExtras().get(Intent.EXTRA_STREAM);
        if (stream instanceof List<?>) {
            for (Object item : (List<?>) stream) addUri(uris, item);
        } else {
            addUri(uris, stream);
        }
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int index = 0; index < clip.getItemCount(); index += 1) {
                addUri(uris, clip.getItemAt(index).getUri());
            }
        }
        String action = intent.getAction();
        boolean expectsFile = Intent.ACTION_VIEW.equals(action)
                || Intent.ACTION_SEND.equals(action)
                || Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (uris.isEmpty()) {
            // 系统按 manifest 的声明把应用叫起来了，却没给任何可读的东西（三方应用自己没填对）。
            // 这时必须出声：否则用户的体验是「点了半步，界面开了又什么都没发生」，
            // 只会当成我们的 bug，而真实原因是对方没把文件交出来。
            if (expectsFile) {
                notifyUser(context, "没有收到文件，请在文件上选「分享 → 半步五子棋打谱」再试");
            }
            return 0;
        }
        int staged = 0;
        // 同一份文件可能以**两个不同的 Uri** 被交来（QQ 等把 getData() 与
        // EXTRA_STREAM/ClipData 都填上：Uri 字符串不同、指向的文件相同）——
        // addUri 的 contains 去重挡不住。再按「显示名 + 大小」挡一层
        // （用户 2026-10-08：一次导入两份同名文件，「第 2/2 份」把 .db 卷进
        // 批量解析，报「必须通过动态局面查询会话打开」）；拿不到大小的不判重。
        java.util.HashSet<String> stagedKeys = new java.util.HashSet<>();
        for (Uri uri : uris) {
            String[] meta = displayMeta(context.getContentResolver(), uri);
            String key = meta[1] == null || meta[1].isEmpty() ? null : meta[0] + ":" + meta[1];
            if (key != null && stagedKeys.contains(key)) {
                continue;
            }
            if (stageOne(context, uri)) {
                if (key != null) {
                    stagedKeys.add(key);
                }
                staged += 1;
            }
        }
        if (staged == 0 && expectsFile) {
            notifyUser(context, "文件读取失败，可能已被删除或本应用没有访问权限");
        }
        return staged;
    }

    /** 只收 Uri，并且去重：VIEW 的 data 与 EXTRA_STREAM 常常是同一个地址。 */
    private static void addUri(List<Uri> uris, Object candidate) {
        if (!(candidate instanceof Uri)) {
            return;
        }
        Uri uri = (Uri) candidate;
        if (!uris.contains(uri)) {
            uris.add(uri);
        }
    }

    /** 显示名与大小（都拿不到就给空串）；stageFromIntent 的「同名同大小」判重用。 */
    private static String[] displayMeta(ContentResolver resolver, Uri uri) {
        String name = displayName(resolver, uri);
        String size = "";
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) {
                    size = String.valueOf(cursor.getLong(index));
                }
            }
        } catch (Exception ignored) {
            // 拿不到大小就不参与判重（宁可多存一份，也别把不同文件误判成同一份）。
        }
        return new String[]{name, size};
    }

    private static void notifyUser(Context context, String message) {
        try {
            android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {
            // 提示失败不该影响文件本身的处理。
        }
    }

    private static boolean stageOne(Context context, Uri uri) {
        ContentResolver resolver = context.getContentResolver();
        InputStream input = null;
        FileOutputStream output = null;
        try {
            input = resolver.openInputStream(uri);
            if (input == null) {
                return false;
            }
            File directory = stageDirectory(context);
            if (!directory.exists() && !directory.mkdirs()) {
                return false;
            }
            // 文件名去重：同一秒收到两份同名文件不能互相覆盖。
            String name = displayName(resolver, uri);
            File target = new File(directory, System.currentTimeMillis() + "-" + Math.abs(uri.hashCode()) + "-" + name);
            output = new FileOutputStream(target);
            byte[] chunk = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(chunk)) > 0) {
                total += read;
                if (total > MAX_BYTES) {
                    output.close();
                    output = null;
                    target.delete();
                    return false;
                }
                output.write(chunk, 0, read);
            }
            output.close();
            output = null;
            // 元数据（原始文件名与 mimeType）单独记：网页层要按扩展名分派，
            // 而暂存文件名带了前缀，不记下来就分不清 .sgf 与 .zip。
            // 前缀同时保证了即使元数据丢失，也不会把两份文件看成一个。
            writeMeta(target, name, resolver.getType(uri));
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            closeQuietly(input);
            closeQuietly(output);
        }
    }

    /**
     * 取出全部待处理文件并**清空暂存区**。
     *
     * 读完即删是刻意的：网页层取走之后就是它自己的事（先进预览、等用户确认），
     * 若暂存留到下次启动会被再取一次，那就是「同一份棋谱被导入两遍」的经典 bug。
     * 所以即使网页层这次导入失败，也不会在下次启动时自动重放——宁可少一次，
     * 不要多一次（导入失败用户可以重新点一次文件）。
     */
    @PluginMethod
    public void takeFiles(PluginCall call) {
        List<JSObject> collected = new ArrayList<>();
        File directory = stageDirectory(getContext());
        File[] entries = directory.listFiles();
        if (entries != null) {
            for (File entry : entries) {
                if (!entry.isFile() || entry.getName().endsWith(META_SUFFIX)) {
                    continue;
                }
                try {
                    JSObject file = readStagedFile(entry);
                    if (file != null) {
                        collected.add(file);
                    }
                } catch (Exception ignored) {
                    // 单份读失败不影响其余文件；这一份同样在下面被删掉。
                }
                deleteQuietly(entry);
                deleteQuietly(new File(entry.getAbsolutePath() + META_SUFFIX));
            }
        }
        JSObject result = new JSObject();
        result.put("files", new JSArray(collected));
        call.resolve(result);
    }

    /** 暂存区里还有几份没被取走。MainActivity 回到前台时用它决定要不要补发事件。 */
    public static int countStaged(Context context) {
        File[] entries = stageDirectory(context).listFiles();
        if (entries == null) {
            return 0;
        }
        int count = 0;
        for (File entry : entries) {
            if (entry.isFile() && !entry.getName().endsWith(META_SUFFIX)) {
                count += 1;
            }
        }
        return count;
    }

    /** 只查有没有待处理文件（网页层启动早期用它决定要不要提示「正在处理外部文件」）。 */
    @PluginMethod
    public void hasFiles(PluginCall call) {
        JSObject result = new JSObject();
        result.put("count", countStaged(getContext()));
        call.resolve(result);
    }

    private JSObject readStagedFile(File entry) throws Exception {
        String[] meta = readMeta(entry);
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        InputStream input = new java.io.FileInputStream(entry);
        try {
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = input.read(chunk)) > 0) {
                buffer.write(chunk, 0, read);
            }
        } finally {
            closeQuietly(input);
        }
        byte[] bytes = buffer.toByteArray();
        String mimeType = meta[1] != null && !meta[1].isEmpty() ? meta[1] : "application/octet-stream";
        JSObject file = new JSObject();
        file.put("name", meta[0]);
        file.put("size", bytes.length);
        file.put("mimeType", mimeType);
        file.put("dataUrl", "data:" + mimeType + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
        return file;
    }

    private static File stageDirectory(Context context) {
        return new File(context.getFilesDir(), STAGE_DIR);
    }

    private static void writeMeta(File target, String name, String mimeType) {
        try (FileOutputStream output = new FileOutputStream(target.getAbsolutePath() + META_SUFFIX)) {
            org.json.JSONObject meta = new org.json.JSONObject();
            meta.put("name", name);
            meta.put("mimeType", mimeType == null ? "" : mimeType);
            output.write(meta.toString().getBytes("UTF-8"));
        } catch (Exception ignored) {
            // 元数据写失败只是丢了原名；文件本身仍能被取走（name 会回落到暂存名）。
        }
    }

    private static String[] readMeta(File entry) {
        File metaFile = new File(entry.getAbsolutePath() + META_SUFFIX);
        if (metaFile.exists()) {
            try (InputStream input = new java.io.FileInputStream(metaFile)) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int read;
                while ((read = input.read(chunk)) > 0) {
                    buffer.write(chunk, 0, read);
                }
                org.json.JSONObject meta = new org.json.JSONObject(buffer.toString("UTF-8"));
                return new String[]{meta.optString("name", fallbackName(entry)), meta.optString("mimeType", "")};
            } catch (Exception ignored) {
                // 落到下面的兜底。
            }
        }
        return new String[]{fallbackName(entry), ""};
    }

    /** 元数据丢了就把暂存名里的前缀剥掉，至少让扩展名还在（网页层靠它分派）。 */
    private static String fallbackName(File entry) {
        String name = entry.getName();
        int separator = name.indexOf('-', name.indexOf('-') + 1);
        return separator >= 0 && separator + 1 < name.length() ? name.substring(separator + 1) : name;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.isEmpty()) {
                        // 文件名会进暂存目录，去掉路径分隔符免得写到别处去。
                        return value.replace('/', '_').replace('\\', '_');
                    }
                }
            }
        } catch (Exception ignored) {
            // 拿不到名字是外观问题，下面兜底。
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "棋谱文件" : last.replace('/', '_');
    }

    private static void closeQuietly(java.io.Closeable stream) {
        if (stream == null) {
            return;
        }
        try {
            stream.close();
        } catch (Exception ignored) {
            // 关闭失败无可挽回，也不影响已经读到的内容。
        }
    }

    private static void deleteQuietly(File target) {
        try {
            if (target.exists()) {
                target.delete();
            }
        } catch (Exception ignored) {
            // 删不掉最坏是占一点空间，不该让整个流程失败。
        }
    }
}
