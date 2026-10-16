package cn.renjunote.mobile;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.util.HashMap;
import java.util.Map;

/**
 * 给本地资源响应补上**跨源隔离**响应头（2026-10-09，用户问「为啥电脑识谱快，你不能适配吗」）。
 *
 * 问题：同一份识谱代码，网页版快（识谱 1～2 秒），APK 里慢十几倍。差别不在代码也不在模型，
 * 而在 ORT 的 wasm 能不能多线程：
 *   · 网页版由服务器下发 COOP/COEP → `crossOriginIsolated === true` → ORT 走
 *     `ort-wasm-simd-threaded` 多线程（实测桌面 12 核：225 格 cell-cls 约 1 秒）；
 *   · APK 里 WebView 从本地资产加载页面，**没人下发这两个头** → `crossOriginIsolated`
 *     为 false → ORT 只能单线程 → 同样 225 格要 13–40 秒（降频 6× 实测 37 秒）。
 * 项目里那句「安卓 WebView 不支持跨源隔离（设备实测）」是在**没有注入响应头**的前提下
 * 得出的结论——缺的正是这里做的事：在 `shouldInterceptRequest` 里把 COOP/COEP 加到
 * 本地资源的响应上。
 *
 * 实现：继承 Capacitor 的 BridgeWebViewClient，只覆写 shouldInterceptRequest——
 * 先拿原响应，再往 headers 里补两个头，原样返回（不改状态码/流/编码）。
 * Android 的 WebResourceResponse 允许替换 headers，前提是流不被消费。
 *
 * 生效条件与边界：
 *   · `Cross-Origin-Embedder-Policy: require-corp` 要求页面**所有子资源**都带
 *     CORP/CORS 头，或同源。本应用所有资源（wasm/模型/图标）都由同一个本地服务器
 *     提供，属同源，因此不需要额外加 `Cross-Origin-Resource-Policy`；
 *     若后续引入跨源资源，那些资源会加载失败——这是 require-corp 的固有语义。
 *   · 若设备 WebView 版本过旧（< Chrome 88 不支持 COEP），加头也不会隔离，行为与
 *     现在完全一致（OTR 仍单线程），不会更坏。
 *   · 升级风险：`crossOriginIsolated` 变 true 后，`SharedArrayBuffer` 变成可用，
 *     ORT 会按 `numThreads` 起线程池。识别逻辑本身不依赖 SAB，所以功能上安全；
 *     性能上多线程只影响 wasm 内部并行，结果逐位相同（同一份 kernel）。
 */
public class IsolatedWebViewClient extends BridgeWebViewClient {

    public IsolatedWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse response = super.shouldInterceptRequest(view, request);
        if (response == null) {
            return null;
        }
        Map<String, String> headers = response.getResponseHeaders();
        Map<String, String> patched = headers == null ? new HashMap<>() : new HashMap<>(headers);
        // 与 vite.config.ts 的 dev server 头一致（那边也是这两条）。
        patched.put("Cross-Origin-Opener-Policy", "same-origin");
        patched.put("Cross-Origin-Embedder-Policy", "require-corp");
        response.setResponseHeaders(patched);
        return response;
    }
}
