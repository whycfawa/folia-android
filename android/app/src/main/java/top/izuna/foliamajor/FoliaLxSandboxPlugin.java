package top.izuna.foliamajor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 洛雪自定义源脚本的安卓沙箱：一个隐藏 WebView 里跑上游那份 sandbox.cjs（洛雪桌面版给脚本的那套接口），
 * 页面本身由 {@link LxSandboxServer} 在 127.0.0.1 上应答，脚本的每一次 lx.request 也从那里出去。
 *
 * 和桌面版 sandboxHost.ts 的分工一致：这个类只管「开窗、注入、调 load/call、销毁」，判定与转发在 server 里。
 *
 * 页面地址是 http://127.0.0.1:<port>/ 而不是桌面的 https://lx-sandbox.invalid：
 * 安卓的 WebView 没有 Electron 的 session.intercept，能自己读请求正文的只有本地 socket。注入 sandbox.cjs 时
 * 把里面的 SANDBOX_ORIGIN 换成这个源，页面的 fetch 就落在同一个源上（CSP 的 connect-src 'self' 也才过得去）。
 */
@CapacitorPlugin(name = "FoliaLxSandbox")
public class FoliaLxSandboxPlugin extends Plugin {
    private static final String TAG = "FoliaLxSandbox";
    /** 和桌面 sandboxHost.ts 同一组时限。 */
    private static final long LOAD_TIMEOUT_MS = 15_000L;
    private static final long CALL_TIMEOUT_MS = 20_000L;
    /** 注入的沙箱运行环境（dist-mods/lxmusic/sandbox.cjs，构建时拷进 assets）。 */
    private static final String RUNTIME_ASSET = "lxSandbox.js";
    /** 导入脚本：单个文件读进来的上限（桌面 MAX_SCRIPT_BYTES 的两倍，校验在 JS 侧）。 */
    private static final int MAX_SCRIPT_FILE_BYTES = 4 * 1024 * 1024;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private LxSandboxServer server;
    private FrameLayout container;
    private WebView webView;
    /** 页面上的运行环境装好了没有（装好之前不能调 __lxHost）。 */
    private boolean pageReady;
    /** 页面里现在跑的是哪个脚本；null 表示只有运行环境、还没加载脚本。 */
    private String loadedScriptId;
    /** 正在为哪个脚本开窗；开窗期间再来的请求排队等它。 */
    private String startingScriptId;
    private String pendingCode;
    private JSONObject pendingInfo;
    private Runnable afterReady;
    private String runtimeCode;

    /** 一次等页面回答的调用。{@code sources} 模式下要的是 load 的返回值，否则是 call 的结果。 */
    private interface Answer {
        void arrived(boolean ok, Object value, String error);
    }

    private static final class Pending {
        final Answer answer;
        final Runnable timeout;
        Pending(Answer answer, Runnable timeout) {
            this.answer = answer;
            this.timeout = timeout;
        }
    }

    private Activity activity() {
        return getActivity();
    }

    /** 脚本的报错只留一行、截短了再进日志。 */
    private static String clip(String line) {
        if (line == null) return "";
        String flat = line.replaceAll("\\s+", " ").trim();
        return flat.length() > 300 ? flat.substring(0, 300) : flat;
    }

    /**
     * 开窗并注入运行环境。只在该脚本还没有窗口（或换脚本了）时重开；换脚本一律重开，
     * 和桌面一样：一个窗口只跑一个脚本。
     */
    private void ensureLoaded(String scriptId, String code, JSONObject info, Answer answer) {
        handler.post(() -> {
            if (webView != null && pageReady && scriptId.equals(loadedScriptId)) {
                answer.arrived(true, null, null);
                return;
            }
            if (webView != null && pageReady && scriptId.equals(startingScriptId)) {
                handler.postDelayed(() -> ensureLoaded(scriptId, code, info, answer), 120L);
                return;
            }
            startPage(scriptId, code, info, answer);
        });
    }

    private void startPage(String scriptId, String code, JSONObject info, Answer answer) {
        Activity activity = activity();
        if (activity == null) {
            answer.arrived(false, null, "the app is not in the foreground");
            return;
        }
        try {
            if (server == null) server = new LxSandboxServer();
            server.start();
        } catch (Exception error) {
            answer.arrived(false, null, "the sandbox server did not start");
            return;
        }
        destroyPage();
        startingScriptId = scriptId;
        pendingCode = code;
        pendingInfo = info;
        afterReady = () -> {
            String id = scriptId;
            String snippet = "globalThis.__lxHost.load(" + JSONObject.quote(code) + ", " + info + ", " + LOAD_TIMEOUT_MS + ")";
            evaluate(id + ":load", snippet, LOAD_TIMEOUT_MS + 5_000L, (ok, value, error) -> {
                // 加载失败也要把 startingScriptId 清掉：留着的话下一次调用会一直走「正在开窗」那条重试分支。
                startingScriptId = null;
                if (ok) loadedScriptId = id;
                answer.arrived(ok, value, error);
            });
            afterReady = null;
        };

        container = new FrameLayout(activity);
        container.setBackgroundColor(Color.BLACK);
        container.setAlpha(0.01f);
        container.setVisibility(ViewGroup.VISIBLE);
        webView = new WebView(activity);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBlockNetworkImage(true);
        // 沙箱页不需要 Cookie（服务本身也不下发 Set-Cookie）。只关这个窗口的第三方 Cookie，
        // 不动 CookieManager 的全局开关 —— 那是宿主会话的，动了会连累 Apple Music / YouTube Music 的登录。
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.addJavascriptInterface(new PageBridge(), "FoliaLxPageBridge");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) {
                request.deny();
            }

            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                String line = message == null ? "" : clip(message.message());
                if (line.startsWith("[lx]")) Log.w(TAG, "page: " + line);
                else Log.d(TAG, "page: " + line);
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 页面不许跳走：脚本改 location 也只是失败。
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url == null || url.getScheme() == null) return null;
                String scheme = url.getScheme().toLowerCase(java.util.Locale.ROOT);
                if (!scheme.equals("http") && !scheme.equals("https")) return null;
                if (server == null) return blocked();
                // CSP 已经只放 'self'，这里再挡一道：除了本服务，任何地址都不给。
                if (!server.origin().equals(scheme + "://" + url.getHost() + ":" + url.getPort())) return blocked();
                // 交给本地服务：请求正文只有 socket 读得到（WebResourceRequest 不带 body）。
                return null;
            }

            @Override public void onPageFinished(WebView view, String url) {
                injectRuntime();
            }
        });
        container.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root != null) root.addView(container, new FrameLayout.LayoutParams(1, 1));
        webView.loadUrl(server.origin() + "/");
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
            java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    /** 把 sandbox.cjs 注入页面，装好 globalThis.__lxHost。 */
    private void injectRuntime() {
        if (webView == null) return;
        try {
            String code = runtimeText().replace(LxSandboxServer.SANDBOX_ORIGIN, server.origin());
            String snippet = "(() => { const module = { exports: {} }; const exports = module.exports;\n"
                + code + "\n})(); (globalThis.__lxHost ? 'ready' : 'missing');";
            webView.evaluateJavascript(snippet, value -> handler.post(() -> {
                if (!"\"ready\"".equals(value)) {
                    Log.w(TAG, "the sandbox runtime did not install: " + value);
                    failPending("the sandbox runtime did not install");
                    return;
                }
                pageReady = true;
                Runnable ready = afterReady;
                if (ready != null) ready.run();
            }));
        } catch (Exception error) {
            Log.w(TAG, "injecting the sandbox runtime failed", error);
            failPending(error.getMessage());
        }
    }

    private String runtimeText() {
        if (runtimeCode != null) return runtimeCode;
        try (InputStream stream = getContext().getAssets().open(RUNTIME_ASSET)) {
            ByteArrayOutputStream sink = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = stream.read(buffer)) != -1) sink.write(buffer, 0, read);
            runtimeCode = sink.toString("UTF-8");
            return runtimeCode;
        } catch (Exception error) {
            throw new IllegalStateException("assets/" + RUNTIME_ASSET + " is missing", error);
        }
    }

    /** 在页面里跑一段返回 Promise 的表达式，把它的结果经 PageBridge 交回来。 */
    private void evaluate(String requestId, String expression, long timeoutMs, Answer answer) {
        String id = requestId + ":" + System.nanoTime();
        Runnable timeout = () -> {
            Pending still = pending.remove(id);
            if (still == null) return;
            // 页面不答（死循环、崩了）：窗口换掉，下次用到重开。
            Log.w(TAG, "the sandbox did not answer; closing its window");
            handler.post(this::destroyPage);
            still.answer.arrived(false, null, "the script sandbox did not answer");
        };
        pending.put(id, new Pending(answer, timeout));
        handler.postDelayed(timeout, timeoutMs);
        String snippet = "(function(){"
            + "var id = " + JSONObject.quote(id) + ";"
            + "function finish(payload){ try { FoliaLxPageBridge.done(id, payload); } catch (e) {} }"
            + "try { Promise.resolve(" + expression + ").then(function(r){"
            + "  finish(JSON.stringify({ ok: true, value: (r === undefined ? null : r) }));"
            + "}, function(e){ finish(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); });"
            + "} catch (e) { finish(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); }"
            + "})();";
        handler.post(() -> {
            if (webView == null) {
                Pending gone = pending.remove(id);
                if (gone != null) {
                    handler.removeCallbacks(gone.timeout);
                    gone.answer.arrived(false, null, "the script sandbox is closed");
                }
                return;
            }
            webView.evaluateJavascript(snippet, null);
        });
    }

    private void failPending(String message) {
        for (String id : pending.keySet()) {
            Pending gone = pending.remove(id);
            if (gone == null) continue;
            handler.removeCallbacks(gone.timeout);
            gone.answer.arrived(false, null, message);
        }
        startingScriptId = null;
    }

    private void destroyPage() {
        pageReady = false;
        loadedScriptId = null;
        startingScriptId = null;
        afterReady = null;
        if (webView != null) {
            try {
                container.removeView(webView);
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.destroy();
            } catch (Throwable ignored) {
                // 已经销毁过就算了。
            }
            webView = null;
        }
        if (container != null) {
            ViewGroup parent = (ViewGroup) container.getParent();
            if (parent != null) parent.removeView(container);
            container = null;
        }
    }

    /** 页面把一次 load/call 的结果送回来。 */
    private final class PageBridge {
        @JavascriptInterface
        public void done(String id, String payload) {
            Pending waiting = pending.remove(id);
            if (waiting == null) return;
            handler.removeCallbacks(waiting.timeout);
            boolean ok = false;
            Object value = null;
            String error = "the script sandbox answered nothing";
            try {
                JSONObject answer = new JSONObject(payload == null ? "{}" : payload);
                ok = answer.optBoolean("ok", false);
                if (ok) value = answer.isNull("value") ? null : answer.opt("value");
                else error = answer.optString("error", error);
            } catch (Exception parseError) {
                error = "the script sandbox answered something that is not JSON";
            }
            waiting.answer.arrived(ok, value, error);
        }
    }

    // ---------------------------------------------------------------- 插件方法

    @PluginMethod
    public void load(PluginCall call) {
        String scriptId = call.getString("scriptId", "");
        String code = call.getString("code", "");
        JSONObject info = call.getObject("info");
        if (scriptId == null || scriptId.isEmpty() || code == null || code.isEmpty()) {
            call.reject("Missing script");
            return;
        }
        ensureLoaded(scriptId, code, info == null ? new JSONObject() : info, (ok, value, error) -> {
            if (!ok) {
                call.reject(error == null ? "the script did not load" : error);
                return;
            }
            // 页面里 load 的回答是 { sources }（和桌面 sandboxHost.ts 的 `loaded?.sources` 同一层意思），
            // 这里只把 sources 交出去；整包塞进 sources 会让 JS 侧拿到 { sources: { sources: ... } }，
            // sanitizeDeclaredSources 见不到 kw/kg/tx/wy，导入被判成 no-platform。
            Object declared = JSONObject.NULL;
            if (value instanceof JSONObject) {
                Object inner = ((JSONObject) value).opt("sources");
                if (inner != null) declared = inner;
            }
            Log.i(TAG, "script declared: " + clip(String.valueOf(declared)));
            JSObject result = new JSObject();
            result.put("sources", declared);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void call(PluginCall call) {
        String scriptId = call.getString("scriptId", "");
        String code = call.getString("code", "");
        JSONObject info = call.getObject("info");
        JSONObject payload = call.getObject("payload");
        if (scriptId == null || scriptId.isEmpty() || code == null || code.isEmpty() || payload == null) {
            call.reject("Missing script or payload");
            return;
        }
        ensureLoaded(scriptId, code, info == null ? new JSONObject() : info, (ok, _value, error) -> {
            if (!ok) {
                call.reject(error == null ? "the script did not load" : error);
                return;
            }
            evaluate(scriptId + ":call", "globalThis.__lxHost.call(" + payload + ", " + CALL_TIMEOUT_MS + ")",
                CALL_TIMEOUT_MS + 5_000L, (answered, result, reason) -> {
                    if (!answered) {
                        call.reject(reason == null ? "the script did not answer" : reason);
                        return;
                    }
                    JSObject out = new JSObject();
                    out.put("result", result == null ? JSONObject.NULL : result);
                    call.resolve(out);
                });
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        handler.post(() -> {
            failPending("the script sandbox is closed");
            destroyPage();
            call.resolve();
        });
    }

    @PluginMethod
    public void pickScript(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handlePickedScript");
    }

    @ActivityCallback
    public void handlePickedScript(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            String name = displayName(resolver, uri);
            byte[] bytes;
            try (InputStream stream = resolver.openInputStream(uri)) {
                if (stream == null) throw new IllegalStateException("the picked file could not be opened");
                ByteArrayOutputStream sink = new ByteArrayOutputStream();
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = stream.read(buffer)) != -1) {
                    sink.write(buffer, 0, read);
                    if (sink.size() > MAX_SCRIPT_FILE_BYTES) throw new IllegalStateException("the picked file is too large");
                }
                bytes = sink.toByteArray();
            }
            Log.i(TAG, "script picked: " + clip(name) + " (" + bytes.length + " bytes)");
            JSObject answer = new JSObject();
            answer.put("name", name);
            answer.put("text", new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "the picked file could not be read" : error.getMessage());
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // 名字只是给人看的。
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "script.js" : last;
    }
}
