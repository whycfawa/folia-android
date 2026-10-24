package top.izuna.foliamajor;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.os.Build;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.view.WindowManager;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.PermissionState;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(
    name = "FoliaNative",
    permissions = {
        @Permission(
            alias = "audio",
            strings = { Manifest.permission.READ_MEDIA_AUDIO }
        ),
        @Permission(
            alias = "audioLegacy",
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class FoliaNativePlugin extends Plugin {
    private static volatile FoliaNativePlugin instance;
    private static volatile String playbackArtworkCover = "";
    private static volatile String playbackArtworkStatus = "none";
    private static volatile String playbackArtworkDetail = "";
    private static volatile long playbackArtworkAt = 0;
    private static volatile boolean playbackArtworkApplied = false;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build();
    private LocalAudioServer localAudioServer;
    private boolean isAudioPickerOpen = false;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    static void emitMediaAction(String action) {
        FoliaNativePlugin plugin = instance;
        if (plugin == null) return;
        JSObject payload = new JSObject();
        payload.put("action", action);
        plugin.getActivity().runOnUiThread(() -> plugin.notifyListeners("mediaAction", payload));
    }

    /** True when the WebView handled Back; false lets the activity fall back to normal exit. */
    static boolean emitBackPressed() {
        FoliaNativePlugin plugin = instance;
        if (plugin == null || !plugin.hasListeners("backButton")) {
            if (plugin != null) {
                CrashDiagnostics.recordText(
                    plugin.getContext(),
                    "back-press",
                    "main",
                    "native-fallback",
                    "No JS backButton listener; activity will finish",
                    "FoliaNativePlugin.emitBackPressed"
                );
            }
            return false;
        }
        Activity activity = plugin.getActivity();
        if (activity == null) return false;
        CrashDiagnostics.recordText(
            plugin.getContext(),
            "back-press",
            "main",
            "native-emit",
            "Forwarding Back to the WebView listener",
            "FoliaNativePlugin.emitBackPressed"
        );
        JSObject payload = new JSObject();
        activity.runOnUiThread(() -> plugin.notifyListeners("backButton", payload));
        return true;
    }

    static void notePlaybackArtwork(String coverUrl, String status, String detail) {
        playbackArtworkCover = describePlaybackArtworkUrl(coverUrl);
        playbackArtworkStatus = status == null || status.isEmpty() ? "unknown" : status;
        playbackArtworkDetail = detail == null ? "" : detail;
        playbackArtworkAt = System.currentTimeMillis();
    }

    static void notePlaybackArtworkApplied(boolean applied) {
        playbackArtworkApplied = applied;
    }

    private static String describePlaybackArtworkUrl(String value) {
        if (value == null || value.isEmpty()) return "";
        try {
            URL url = new URL(value);
            return url.getProtocol() + "://" + url.getHost() + url.getPath();
        } catch (Exception ignored) {
            return "invalid";
        }
    }

    @PluginMethod
    public void cookiesGetAll(PluginCall call) {
        String url = call.getString("url", "");
        String domain = call.getString("domain", "");
        if (url == null || url.isEmpty()) {
            if (domain == null || domain.isEmpty()) {
                url = "https://localhost/";
            } else {
                url = domain.startsWith("http") ? domain : "https://" + domain;
            }
        }

        JSArray cookies = new JSArray();
        for (JSObject cookie : parseCookieHeader(CookieManager.getInstance().getCookie(url), domain)) {
            cookies.put(cookie);
        }
        JSObject result = new JSObject();
        result.put("cookies", cookies);
        call.resolve(result);
    }

    @PluginMethod
    public void cookiesGet(PluginCall call) {
        String url = call.getString("url", "https://localhost/");
        String name = call.getString("name", "");
        if (name == null || name.isEmpty()) {
            call.reject("Missing cookie name");
            return;
        }
        for (JSObject cookie : parseCookieHeader(CookieManager.getInstance().getCookie(url), "")) {
            if (name.equals(cookie.optString("name"))) {
                JSObject result = new JSObject();
                result.put("cookie", cookie);
                call.resolve(result);
                return;
            }
        }
        JSObject result = new JSObject();
        result.put("cookie", null);
        call.resolve(result);
    }

    @PluginMethod
    public void cookiesSet(PluginCall call) {
        String url = call.getString("url", "");
        String name = call.getString("name", "");
        String value = call.getString("value", "");
        if (url == null || url.isEmpty() || name == null || name.isEmpty()) {
            call.reject("Cookie url and name are required");
            return;
        }

        StringBuilder cookie = new StringBuilder();
        cookie.append(name).append('=').append(value == null ? "" : value);
        String domain = call.getString("domain", "");
        String path = call.getString("path", "/");
        if (domain != null && !domain.isEmpty()) cookie.append("; domain=").append(domain);
        if (path != null && !path.isEmpty()) cookie.append("; path=").append(path);
        if (Boolean.TRUE.equals(call.getBoolean("secure", false))) cookie.append("; Secure");
        Double expirationDate = call.getDouble("expirationDate");
        if (expirationDate != null) {
            cookie.append("; Max-Age=").append((int) Math.max(0, expirationDate - System.currentTimeMillis() / 1000.0));
        }

        CookieManager.getInstance().setCookie(url, cookie.toString());
        CookieManager.getInstance().flush();
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void cookiesRemove(PluginCall call) {
        String url = call.getString("url", "");
        String name = call.getString("name", "");
        if (url == null || url.isEmpty() || name == null || name.isEmpty()) {
            call.reject("Cookie url and name are required");
            return;
        }
        CookieManager.getInstance().setCookie(url, name + "=; Max-Age=0; path=/");
        CookieManager.getInstance().flush();
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    /**
     * 批量删除 cookie：entries 是 [{url, name}, ...]。
     *
     * 逐条删除每条都要过一次桥并在原生侧 flush 一次，登录通道切换要清几十条，
     * 累加起来会超过调用方的截止时间，结果只清掉一半。这里在原生侧一次做完。
     */
    @PluginMethod
    public void cookiesRemoveBatch(PluginCall call) {
        JSArray entries = call.getArray("entries");
        if (entries == null || entries.length() == 0) {
            JSObject empty = new JSObject();
            empty.put("ok", true);
            empty.put("removed", 0);
            call.resolve(empty);
            return;
        }
        CookieManager manager = CookieManager.getInstance();
        int removed = 0;
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            String url = entry.optString("url", "");
            String name = entry.optString("name", "");
            if (url == null || url.isEmpty() || name == null || name.isEmpty()) continue;
            manager.setCookie(url, name + "=; Max-Age=0; path=/");
            removed++;
        }
        if (removed > 0) manager.flush();
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("removed", removed);
        call.resolve(result);
    }

    @PluginMethod
    public void httpRequest(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET");
        String bodyText = call.getString("bodyText", "");
        String bodyBase64 = call.getString("bodyBase64", "");
        String redirect = call.getString("redirect", "follow");
        if (url == null || url.isEmpty()) {
            call.reject("Missing request url");
            return;
        }

        try {
            Request.Builder builder = new Request.Builder().url(url);
            JSObject headers = call.getObject("headers");
            if (headers != null) {
                Iterator<String> headerNames = headers.keys();
                while (headerNames.hasNext()) {
                    String headerName = headerNames.next();
                    Object headerValue = headers.opt(headerName);
                    if (headerValue != null) {
                        String value = String.valueOf(headerValue);
                        // OkHttp rejects non-ASCII header values (the WebView cookie store can
                        // hold a cookie with a CJK value). Cookie values must be ASCII; encode
                        // the invalid bytes rather than failing the whole request.
                        if ("cookie".equalsIgnoreCase(headerName)) {
                            value = sanitizeCookieHeader(value);
                            if (value.isEmpty()) continue;
                        }
                        builder.header(headerName, value);
                    }
                }
            }
            // OkHttp has no cookie jar here, so carry the WebView cookie store
            // ourselves unless the caller injected an explicit Cookie header.
            //
            // sendCookies=false 是给桌面桥那套 credentials:'omit' 用的：汽水（抖音）的接口
            // 按不带登录态的匿名请求取流，若这里偷偷补上 WebView 里残留的抖音 Cookie，
            // 拿到的就可能是另一份（甚至 401 的）响应。显式的 Cookie 头仍然照发：
            // 调用方自己要的凭据不能被这个开关吞掉。
            boolean sendCookies = Boolean.TRUE.equals(call.getBoolean("sendCookies", true));
            if (sendCookies && !hasHeader(headers, "cookie")) {
                String storedCookies = CookieManager.getInstance().getCookie(url);
                if (storedCookies != null && !storedCookies.isEmpty()) {
                    String sanitized = sanitizeCookieHeader(storedCookies);
                    if (!sanitized.isEmpty()) builder.header("Cookie", sanitized);
                }
            }

            RequestBody body = null;
            if (bodyBase64 != null && !bodyBase64.isEmpty()) {
                body = RequestBody.create(MediaType.parse("application/octet-stream"), Base64.decode(bodyBase64, Base64.DEFAULT));
            } else if (bodyText != null && !bodyText.isEmpty()) {
                MediaType mediaType = MediaType.parse(headers == null ? null : headers.optString("content-type", null));
                body = RequestBody.create(mediaType, bodyText);
            }
            String requestMethod = method == null ? "GET" : method;
            if (body != null && "GET".equalsIgnoreCase(requestMethod)) {
                // Bodian's playback endpoints use GET with a JSON body. OkHttp's public
                // method() rejects that combination, so set the validated request body
                // through its own setter after selecting GET.
                builder.method("GET", null);
                try {
                    Method setBody = Request.Builder.class.getMethod("setBody$okhttp", RequestBody.class);
                    setBody.invoke(builder, body);
                } catch (ReflectiveOperationException error) {
                    call.reject("GET request body is unsupported by this runtime", error);
                    return;
                }
            } else {
                // OkHttp 的 method() 对 POST / PUT / PATCH 要求非 null 的 body，而调用方经常只带
                // 参数、正文是空的（酷狗的 everyday_recommend 就把参数全放在 query 里）。补一个
                // 0 长度 body，否则会直接抛 "method POST must have a request body"。
                RequestBody effectiveBody = body;
                if (effectiveBody == null && requiresRequestBody(requestMethod)) {
                    effectiveBody = RequestBody.create(null, new byte[0]);
                }
                builder.method(requestMethod, effectiveBody);
            }

            OkHttpClient requestClient = client;
            if ("manual".equals(redirect)) {
                requestClient = client.newBuilder()
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .build();
            }
            // AI 请求可能远超默认的 45s 读超时，调用方可以按需放宽。
            Integer timeoutMs = call.getInt("timeoutMs");
            if (timeoutMs != null && timeoutMs > 0) {
                requestClient = requestClient.newBuilder()
                    .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build();
            }

            String requestUrl = url;
            try (Response response = requestClient.newCall(builder.build()).execute()) {
                // Preserve repeated headers (Set-Cookie) by handing JS an array
                // instead of an object, which would collapse duplicates.
                JSArray responseHeaders = new JSArray();
                for (String name : response.headers().names()) {
                    for (String value : response.headers().values(name)) {
                        JSObject headerEntry = new JSObject();
                        headerEntry.put("name", name);
                        headerEntry.put("value", value);
                        responseHeaders.put(headerEntry);
                    }
                }
                storeResponseCookies(requestUrl, response);
                ResponseBody responseBody = response.body();
                byte[] bytes = responseBody == null ? new byte[0] : responseBody.bytes();
                JSObject result = new JSObject();
                result.put("status", response.code());
                result.put("headers", responseHeaders);
                result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(result);
            }
        } catch (IOException | IllegalArgumentException error) {
            call.reject(error.getMessage(), error);
        }
    }

    /** JS 传过来的请求头有没有这一条；HTTP 头名不分大小写，JSON 键却是原样保留的。 */
    private static boolean hasHeader(JSObject headers, String name) {
        if (headers == null || name == null) return false;
        Iterator<String> names = headers.keys();
        while (names.hasNext()) {
            if (name.equalsIgnoreCase(names.next())) return true;
        }
        return false;
    }

    private void storeResponseCookies(String requestUrl, Response response) {
        List<String> setCookies = response.headers().values("Set-Cookie");
        if (setCookies.isEmpty()) return;
        CookieManager manager = CookieManager.getInstance();
        boolean changed = false;
        for (String rawCookie : setCookies) {
            String cookie = normalizeCookieForUrl(requestUrl, rawCookie);
            if (cookie == null || cookie.isEmpty()) continue;
            manager.setCookie(requestUrl, cookie);
            changed = true;
        }
        if (changed) manager.flush();
    }

    // CookieManager ignores a Set-Cookie that has no Path/Domain even though
    // every real response carries them, but some providers omit Path entirely.
    private static String normalizeCookieForUrl(String requestUrl, String rawCookie) {
        if (rawCookie == null || rawCookie.isEmpty()) return null;
        boolean hasPath = false;
        for (String attribute : rawCookie.split(";")) {
            if (attribute.trim().toLowerCase().startsWith("path=")) {
                hasPath = true;
                break;
            }
        }
        if (hasPath) return rawCookie;
        return rawCookie + "; Path=/";
    }

    @PluginMethod
    public void scanLocalAudio(PluginCall call) {
        String alias = audioPermissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "audioPermissionCallback");
            return;
        }
        resolveLocalAudioScan(call);
    }

    /**
     * Android 13 起读音频用 READ_MEDIA_AUDIO，之前的版本用 READ_EXTERNAL_STORAGE。
     *
     * 这两个权限不能放在同一个别名里：被申请的那一个拿到授权后，另一个在系统看来仍是
     * 拒绝，而 Capacitor 对同一别名取「全部授权才算授权」，结果永远停在 PROMPT，
     * 扫描会被误判成「权限被拒」。所以按系统版本分开取别名。
     */
    private String audioPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "audioLegacy";
    }

    @PluginMethod
    public void pickAudioFiles(PluginCall call) {
        if (isAudioPickerOpen) {
            call.reject("Audio picker is already open");
            return;
        }
        // 用 Capacitor 自己的活动回调机制（@ActivityCallback + startActivityForResult），
        // 而不是在 load() 里直接 registerForActivityResult：后者依赖活动生命周期时序，
        // 在部分设备上会拿不到可用的启动器，表现就是「点了导入毫无反应」。
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("audio/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        isAudioPickerOpen = true;
        startActivityForResult(call, intent, "handlePickedAudio");
    }

    /** 选择整个文件夹；原生侧递归扫描其中的音频，用户可以一次导入整张专辑/目录。 */
    @PluginMethod
    public void pickAudioFolder(PluginCall call) {
        if (isAudioPickerOpen) {
            call.reject("Audio picker is already open");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        isAudioPickerOpen = true;
        startActivityForResult(call, intent, "handlePickedAudioFolder");
    }

    /** 供 WebView 重建导入音频的流地址（端口每次启动都可能不同）。 */
    @PluginMethod
    public void localAudioServerPort(PluginCall call) {
        try {
            if (localAudioServer == null) localAudioServer = new LocalAudioServer(getContext());
            int port = localAudioServer.start();
            JSObject result = new JSObject();
            result.put("port", port);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    /** 自适应屏幕分辨率开关：关闭＝跟随系统原生布局，打开＝沉浸式全屏铺满。 */
    /** Wraps an issued Kuwo/Bodian audio URL behind the local Range-capable stream server. */
    @PluginMethod
    public void registerRemoteAudio(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("Missing remote audio url");
            return;
        }
        try {
            if (localAudioServer == null) localAudioServer = new LocalAudioServer(getContext());
            // 汽水（抖音）那批 CDN 的流地址有时只认特定的 Referer / UA / 自定义头，
            // 而 <audio> 自己一条头都加不了，只能注册时把调用方要的头带进来。
            // 不传 headers 时走和以前完全一样的那条路（本地服务补默认 UA / Referer）。
            String localUrl = localAudioServer.registerRemoteAudio(url, headerMap(call.getObject("headers")), false);
            JSObject result = new JSObject();
            result.put("url", localUrl);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    /** JSObject（字符串字典）→ 请求头 Map；空对象与不传等价，返回 null。 */
    private static Map<String, String> headerMap(JSObject source) {
        if (source == null) return null;
        Map<String, String> headers = new LinkedHashMap<>();
        Iterator<String> names = source.keys();
        while (names.hasNext()) {
            String name = names.next();
            if (name == null || name.isEmpty()) continue;
            String value = source.optString(name, null);
            if (value == null) continue;
            headers.put(name, value);
        }
        return headers.isEmpty() ? null : headers;
    }

    @PluginMethod
    public void getPlaybackDiagnostics(PluginCall call) {
        JSObject result = new JSObject();
        result.put("cover", playbackArtworkCover);
        result.put("status", playbackArtworkStatus);
        result.put("detail", playbackArtworkDetail);
        result.put("at", playbackArtworkAt);
        result.put("applied", playbackArtworkApplied);
        result.put("power", FoliaPlaybackService.getPowerDiagnostic());
        call.resolve(result);
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        Activity activity = getActivity();
        call.resolve();
        if (activity != null) {
            CrashDiagnostics.recordText(
                getContext(),
                "app-exit",
                "main",
                "js-exit-app",
                "JS back handler requested exit",
                "FoliaNativePlugin.exitApp"
            );
            activity.runOnUiThread(activity::finish);
        }
    }

    /**
     * 「返回键退到后台」：把任务移出前台，而不是结束 Activity。
     *
     * 结束 Activity 会连带收掉 WebView 与前台播放服务，用户看到的就是「退出应用就自动暂停播放」；
     * 而这个前台服务本来就是为了后台播放准备的（onTaskRemoved 只记诊断、不自停）。真正的退出
     * 交给系统（从最近任务划掉）或应用内的退出入口，它的 exitApp 仍然保留。
     */
    @PluginMethod
    public void moveTaskToBack(PluginCall call) {
        Activity activity = getActivity();
        call.resolve();
        if (activity != null) {
            CrashDiagnostics.recordText(
                getContext(),
                "activity-lifecycle",
                "main",
                "back-to-background",
                "JS back handler moved the task to the background",
                "FoliaNativePlugin.moveTaskToBack"
            );
            activity.runOnUiThread(() -> activity.moveTaskToBack(true));
        }
    }

    /**
     * 「导出诊断数据」：把报告写进缓存目录的 txt，再用 FileProvider 拉起系统分享面板。
     *
     * 报告正文由 WebView 侧生成后原样传入，这里只负责落盘和分享。文件名做白名单清洗，
     * 避免调用方传来的名字带路径分隔符或被 `..` 穿越到缓存目录之外。
     */
    @PluginMethod
    public void shareTextFile(PluginCall call) {
        String rawName = call.getString("filename", "folia-diagnostics.txt");
        String content = call.getString("content", "");
        String title = call.getString("title", "Folia diagnostics");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is not available");
            return;
        }
        try {
            File directory = new File(getContext().getCacheDir(), "diagnostics");
            if (!directory.exists() && !directory.mkdirs()) {
                call.reject("Could not create diagnostics directory");
                return;
            }
            File target = new File(directory, sanitizeDiagnosticFileName(rawName));
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.setClipData(ClipData.newUri(getContext().getContentResolver(), target.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(chooser);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not share diagnostics: " + error.getMessage(), error);
        }
    }

    /** 「删除诊断」：清掉之前导出到缓存目录的诊断 txt，返回实际删除的文件数。 */
    @PluginMethod
    public void deleteDiagnosticFiles(PluginCall call) {
        int deleted = 0;
        File directory = new File(getContext().getCacheDir(), "diagnostics");
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isFile() && file.delete()) deleted++;
            }
        }
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    /** 只保留文件名，挡掉路径分隔符和 `..`，并保证以 .txt 结尾。 */
    private static String sanitizeDiagnosticFileName(String rawName) {
        String name = rawName == null ? "" : rawName.trim();
        name = name.replace('/', '_').replace('\\', '_');
        if (name.isEmpty() || name.contains("..")) name = "folia-diagnostics.txt";
        if (!name.toLowerCase(Locale.ROOT).endsWith(".txt")) name = name + ".txt";
        return name;
    }

    @PluginMethod
    public void getPhoneFitLayout(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", PhoneLayoutOrientation.isEnabled(getContext()));
        result.put("orientation", PhoneLayoutOrientation.getOrientation(getContext()));
        call.resolve(result);
    }

    /**
     * 屏幕常亮：直接操作窗口标志。
     *
     * 网页的 Screen Wake Lock 在页面隐藏时会被浏览器释放，而且要重新申请；窗口标志是系统级的，
     * 切页、锁屏前都有效，所以安卓这边以它为准（JS 侧在拿不到插件时才退回 Wake Lock）。
     */
    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (enabled) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void setPhoneFitLayout(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        String orientation = call.getString("orientation", PhoneLayoutOrientation.getOrientation(getContext()));
        PhoneLayoutOrientation.update(getContext(), enabled, orientation);
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                PhoneLayoutOrientation.apply(activity);
                // 挖孔适配跟手机适配开关无关，这里只是顺手在开关变化时再铺一次。
                PhoneFitCutout.apply(activity);
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && AdaptiveLayout.isEnabled(getContext())) {
                    AdaptiveLayout.apply(activity, webView, true);
                }
            });
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        result.put("orientation", PhoneLayoutOrientation.getOrientation(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setAdaptiveLayout(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        try {
            AdaptiveLayout.setEnabled(getContext(), enabled);
            Activity activity = getActivity();
            if (activity != null) {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                // 系统栏显隐必须在主线程上做。
                activity.runOnUiThread(() -> AdaptiveLayout.apply(activity, webView, enabled));
            }
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getAdaptiveLayout(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", AdaptiveLayout.isEnabled(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void getDisplayCutout(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(PhoneFitCutout.describe(getActivity())));
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @ActivityCallback
    private void handlePickedAudio(PluginCall call, ActivityResult activityResult) {
        isAudioPickerOpen = false;
        if (call == null) return;

        // -1 = RESULT_OK，0 = RESULT_CANCELED。区分「用户取消」和「选完了却没数据」，
        // 否则两种情况的返回值一模一样，只能靠猜。
        int resultCode = activityResult == null ? Activity.RESULT_CANCELED : activityResult.getResultCode();
        List<Uri> uris = new ArrayList<>();
        Intent data = activityResult == null ? null : activityResult.getData();
        if (data != null) {
            ClipData clipData = data.getClipData();
            if (clipData != null) {
                for (int index = 0; index < clipData.getItemCount(); index += 1) {
                    Uri uri = clipData.getItemAt(index).getUri();
                    if (uri != null) uris.add(uri);
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }

        completePickedAudioImport(call, uris, resultCode);
    }

    @ActivityCallback
    private void handlePickedAudioFolder(PluginCall call, ActivityResult activityResult) {
        isAudioPickerOpen = false;
        if (call == null) return;
        int resultCode = activityResult == null ? Activity.RESULT_CANCELED : activityResult.getResultCode();
        List<Uri> uris = new ArrayList<>();
        Intent data = activityResult == null ? null : activityResult.getData();
        Uri treeUri = data == null ? null : data.getData();
        if (treeUri != null) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(
                    treeUri,
                    data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
            } catch (Exception ignored) {
                // Some providers do not offer persistable grants; the current grant is still usable.
            }
            collectAudioDocuments(treeUri, DocumentsContract.getTreeDocumentId(treeUri), uris);
        }
        completePickedAudioImport(call, uris, resultCode);
    }

    private void collectAudioDocuments(Uri treeUri, String parentDocumentId, List<Uri> output) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId);
        String[] projection = new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                String documentId = cursor.getString(0);
                String displayName = cursor.getString(1);
                String mimeType = cursor.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    collectAudioDocuments(treeUri, documentId, output);
                    continue;
                }
                if (isAudioDocument(displayName, mimeType)) {
                    output.add(DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId));
                }
            }
        } catch (Exception ignored) {
            // A provider can deny one subtree without invalidating the rest of the selection.
        }
    }

    private static boolean isAudioDocument(String displayName, String mimeType) {
        if (mimeType != null && mimeType.startsWith("audio/")) return true;
        String lower = displayName == null ? "" : displayName.toLowerCase(Locale.ROOT);
        return lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".wav")
            || lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".ogg")
            || lower.endsWith(".opus") || lower.endsWith(".ape") || lower.endsWith(".wma");
    }

    private void completePickedAudioImport(PluginCall call, List<Uri> uris, int resultCode) {
        if (uris.isEmpty()) {
            JSObject result = new JSObject();
            result.put("tracks", new JSArray());
            result.put("cancelled", resultCode != Activity.RESULT_OK);
            result.put("picked", 0);
            result.put("resultCode", resultCode);
            if (resultCode == Activity.RESULT_OK) {
                result.put("error", "Picker returned RESULT_OK without a readable document uri");
            }
            call.resolve(result);
            return;
        }

        final Activity activity = getActivity();
        new Thread(() -> {
          try {
            if (localAudioServer == null) localAudioServer = new LocalAudioServer(getContext());
            int port = localAudioServer.start();
            File directory = localAudioServer.importedAudioDirectory();
            ContentResolver resolver = getContext().getContentResolver();
            JSArray tracks = new JSArray();
            JSArray failures = new JSArray();
            int copied = 0;

            for (Uri uri : uris) {
                try {
                    String displayName = queryDisplayName(resolver, uri);
                    long fileSize = queryFileSize(resolver, uri);
                    if (displayName == null || displayName.isEmpty()) displayName = "track-" + System.currentTimeMillis();
                    String safeName = "imported-" + stableFileId(displayName, fileSize, directory);
                    File target = new File(directory, safeName);
                    if (!target.isFile() || target.length() != fileSize) {
                        try (InputStream source = resolver.openInputStream(uri);
                             OutputStream sink = new FileOutputStream(target)) {
                            if (source == null) continue;
                            byte[] buffer = new byte[128 * 1024];
                            int read;
                            while ((read = source.read(buffer)) != -1) {
                                sink.write(buffer, 0, read);
                            }
                        }
                    }

                    JSObject track = new JSObject();
                    track.put("id", safeName);
                    track.put("fileName", displayName);
                    track.put("fileSize", target.length());
                    track.put("mimeType", LocalAudioServer.guessMimeType(safeName));
                    track.put("url", "http://127.0.0.1:" + port + "/audio/" + safeName);
                    tracks.put(track);
                    copied += 1;
                } catch (Exception error) {
                    // 单个文件读不了不该让整批失败，但必须把原因带回去，
                    // 否则界面只会「什么都没发生」。
                    JSObject failure = new JSObject();
                    failure.put("uri", String.valueOf(uri));
                    failure.put("message", error.getMessage() == null ? error.toString() : error.getMessage());
                    failures.put(failure);
                }
            }

            JSObject result = new JSObject();
            result.put("tracks", tracks);
            result.put("port", port);
            result.put("picked", uris.size());
            result.put("copied", copied);
            result.put("failures", failures);
            result.put("resultCode", resultCode);
            if (activity != null) activity.runOnUiThread(() -> call.resolve(result));
            else call.resolve(result);
          } catch (Exception error) {
            String message = error.getMessage() == null ? error.toString() : error.getMessage();
            if (activity != null) activity.runOnUiThread(() -> call.reject(message, error));
            else call.reject(message, error);
          }
        }, "folia-audio-import").start();
    }

    private static String stableFileId(String displayName, long fileSize, File directory) {
        String candidate = displayName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (candidate.length() > 60) {
            candidate = candidate.substring(candidate.length() - 60);
        }
        int dot = candidate.lastIndexOf('.');
        String base = dot > 0 ? candidate.substring(0, dot) : candidate;
        String extension = dot > 0 ? candidate.substring(dot) : "";
        String stamp = Integer.toHexString((displayName + ':' + fileSize).hashCode());
        String name = base + "-" + stamp + extension;
        if (new File(directory, name).isFile()) return name;
        return name;
    }

    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? null : last.substring(last.lastIndexOf('/') + 1);
    }

    private static long queryFileSize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        } catch (Exception ignored) {
        }
        return -1;
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
            return;
        }
        applyPlaybackState(call);
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        applyPlaybackState(call);
    }

    private void applyPlaybackState(PluginCall call) {
        Intent intent = new Intent(getContext(), FoliaPlaybackService.class);
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("album", call.getString("album", ""));
        intent.putExtra("coverUrl", call.getString("coverUrl", ""));
        intent.putExtra("songKey", call.getString("songKey", ""));
        intent.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        Double position = call.getDouble("position");
        Double duration = call.getDouble("duration");
        intent.putExtra("position", position == null ? 0L : position.longValue());
        intent.putExtra("duration", duration == null ? 0L : duration.longValue());
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void clearPlaybackState(PluginCall call) {
        getContext().stopService(new Intent(getContext(), FoliaPlaybackService.class));
        call.resolve();
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (getPermissionState(audioPermissionAlias()) == PermissionState.GRANTED) {
            resolveLocalAudioScan(call);
        } else {
            call.reject("Audio permission denied");
        }
    }

    private void resolveLocalAudioScan(PluginCall call) {
        try {
            if (localAudioServer == null) {
                localAudioServer = new LocalAudioServer(getContext());
            }
            int port = localAudioServer.start();
            JSArray tracks = new JSArray();
            String[] projection = new String[]{
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE
            };
            try (Cursor cursor = getContext().getContentResolver().query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                MediaStore.Audio.Media.IS_MUSIC + " != 0",
                null,
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC"
            )) {
                if (cursor != null) {
                    int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                    int titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                    int mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idColumn);
                        JSObject track = new JSObject();
                        track.put("id", String.valueOf(id));
                        track.put("fileName", cursor.getString(nameColumn));
                        track.put("title", cursor.getString(titleColumn));
                        track.put("artist", cursor.getString(artistColumn));
                        track.put("album", cursor.getString(albumColumn));
                        track.put("duration", cursor.getLong(durationColumn));
                        track.put("fileSize", cursor.getLong(sizeColumn));
                        track.put("mimeType", cursor.getString(mimeColumn));
                        track.put("url", "http://127.0.0.1:" + port + "/audio/" + id);
                        tracks.put(track);
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    /**
     * 删除「导入文件夹」时复制进私有目录的音频副本。
     *
     * 只删 App 自己的副本，绝不碰用户的原文件；扫描设备音乐库（MediaStore）得到的歌不在
     * 这里删除，它们只是引用，用户的原文件必须保留。
     */
    /** Returns the bounded native crash trail for the settings diagnostics report. */
    @PluginMethod
    public void getCrashDiagnostics(PluginCall call) {
        CrashDiagnostics.collectHistoricalExits(getContext());
        JSObject result = new JSObject();
        result.put("history", CrashDiagnostics.read(getContext()));
        result.put("heartbeat", CrashDiagnostics.readHeartbeat(getContext()));
        result.put("previousHeartbeat", CrashDiagnostics.readPreviousHeartbeat(getContext()));
        result.put("serviceHeartbeat", CrashDiagnostics.readServiceHeartbeat(getContext()));
        result.put("previousServiceHeartbeat", CrashDiagnostics.readPreviousServiceHeartbeat(getContext()));
        call.resolve(result);
    }

    /** Small 10-second breadcrumb: what was on screen and playing before an abrupt process death. */
    @PluginMethod
    public void recordPlaybackHeartbeat(PluginCall call) {
        try {
            JSObject payload = new JSObject();
            payload.put("at", System.currentTimeMillis());
            payload.put("visualizer", call.getString("visualizer", "unknown"));
            payload.put("background", call.getString("background", "unknown"));
            payload.put("playing", call.getBoolean("playing", false));
            payload.put("visibility", call.getString("visibility", "unknown"));
            Activity activity = getActivity();
            payload.put(
                "foreground",
                activity != null && !activity.isFinishing() && activity.hasWindowFocus()
            );
            PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            payload.put("screenOn", powerManager != null && powerManager.isInteractive());
            CrashDiagnostics.recordHeartbeat(getContext(), payload.toString());
            call.resolve();
        } catch (Exception error) {
            call.reject("Failed to record playback heartbeat", error);
        }
    }

    /** Clears only the crash trail; normal app data and sessions are untouched. */
    @PluginMethod
    public void clearCrashDiagnostics(PluginCall call) {
        CrashDiagnostics.clear(getContext());
        call.resolve();
    }

    /** Stores a WebView error next to native crashes so the next diagnostic copy includes it. */
    @PluginMethod
    public void recordRuntimeDiagnostic(PluginCall call) {
        CrashDiagnostics.recordText(
            getContext(),
            call.getString("source", "webview"),
            call.getString("thread", "webview"),
            call.getString("type", "error"),
            call.getString("message", ""),
            call.getString("stack", "")
        );
        call.resolve();
    }

    @PluginMethod
    public void deleteImportedAudio(PluginCall call) {
        JSArray refs = call.getArray("refs", new JSArray());
        JSArray deleted = new JSArray();
        JSArray failed = new JSArray();
        try {
            if (localAudioServer == null) localAudioServer = new LocalAudioServer(getContext());
            File directory = localAudioServer.importedAudioDirectory();
            for (int index = 0; index < refs.length(); index += 1) {
                String ref = refs.getString(index);
                File target = resolveImportedFile(directory, ref);
                if (target == null) {
                    failed.put(ref);
                    continue;
                }
                // 已经不在了也算成功，重复删除不该被当成错误。
                if (!target.exists() || target.delete()) {
                    deleted.put(ref);
                } else {
                    failed.put(ref);
                }
            }
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            result.put("failed", failed);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    /** 只接受 App 自己写出的 imported-* 文件名，挡掉任何路径穿越。 */
    private static File resolveImportedFile(File directory, String ref) {
        if (ref == null || !ref.startsWith("imported-")) return null;
        if (ref.contains("/") || ref.contains("\\") || ref.contains("..")) return null;
        return new File(directory, ref);
    }

    /**
     * 把 WebView Cookie 值里的非 ASCII 字节按 UTF-8 百分号编码。
     *
     * OkHttp 的 Headers.Builder 会拒绝非 ASCII 字符（报 "Unexpected char 0x.... in Cookie value"），
     * 而 WebView 的 CookieManager 可能存着带中文的 cookie（酷狗登录时出现过 0x5fb5）。
     * HTTP cookie 本来只能是 ASCII；这里只编码非 ASCII/控制字符，普通 token 原样保留。
     * cookie 名不是合法 token 的整对丢弃，避免把请求头再次弄坏。
     */
    static String sanitizeCookieHeader(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        StringBuilder out = new StringBuilder(raw.length());
        for (String pair : raw.split(";")) {
            int separator = pair.indexOf('=');
            if (separator <= 0) continue;
            String name = pair.substring(0, separator).trim();
            String value = pair.substring(separator + 1).trim();
            if (name.isEmpty() || !isCookieName(name)) continue;
            if (out.length() > 0) out.append("; ");
            out.append(name).append('=');
            appendCookieValue(out, value);
        }
        return out.toString();
    }

    private static boolean isCookieName(String name) {
        for (int i = 0; i < name.length(); i += 1) {
            char c = name.charAt(i);
            boolean token = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || "!#$%&'*+-.^_`|~".indexOf(c) >= 0;
            if (!token) return false;
        }
        return true;
    }

    private static void appendCookieValue(StringBuilder out, String value) {
        for (byte b : value.getBytes(java.nio.charset.StandardCharsets.UTF_8)) {
            int v = b & 0xff;
            if (v >= 0x20 && v <= 0x7e) {
                out.append((char) v);
            } else {
                out.append('%');
                out.append(Character.toUpperCase(Character.forDigit((v >> 4) & 0x0f, 16)));
                out.append(Character.toUpperCase(Character.forDigit(v & 0x0f, 16)));
            }
        }
    }

    /** 与 OkHttp 的 HttpMethod.requiresRequestBody 同一份判定：这几个方法必须有请求体。 */
    private static boolean requiresRequestBody(String method) {
        if (method == null) return false;
        return "POST".equalsIgnoreCase(method)
            || "PUT".equalsIgnoreCase(method)
            || "PATCH".equalsIgnoreCase(method)
            || "PROPPATCH".equalsIgnoreCase(method)
            || "REPORT".equalsIgnoreCase(method);
    }

    private List<JSObject> parseCookieHeader(String header, String domain) {
        List<JSObject> cookies = new ArrayList<>();
        if (header == null || header.isEmpty()) return cookies;
        String[] pairs = header.split(";");
        for (String pair : pairs) {
            int separator = pair.indexOf('=');
            if (separator <= 0) continue;
            String name = pair.substring(0, separator).trim();
            String value = pair.substring(separator + 1).trim();
            if (name.isEmpty()) continue;
            JSObject cookie = new JSObject();
            cookie.put("name", name);
            cookie.put("value", value);
            cookie.put("domain", domain == null ? "" : domain);
            cookie.put("path", "/");
            cookie.put("secure", true);
            cookie.put("httpOnly", false);
            cookies.add(cookie);
        }
        return cookies;
    }
    // ── Spotify 登录（OAuth PKCE + 回环回调，见 SpotifyAuth.java）────────────────

    @PluginMethod
    public void spotifyStartLogin(PluginCall call) {
        new Thread(() -> {
            try {
                String id = SpotifyAuth.signIn(getContext());
                JSObject result = new JSObject();
                result.put("signedIn", id != null);
                result.put("id", id);
                result.put("reason", SpotifyAuth.lastError());
                result.put("detail", SpotifyAuth.lastDetail() == null ? "" : SpotifyAuth.lastDetail());
                if (id != null) result.put("user", toJsUser(SpotifyAuth.profile(getContext())));
                call.resolve(result);
            } catch (IOException error) {
                call.reject("Spotify sign-in failed: " + error.getMessage(), error);
            }
        }, "folia-spotify-login").start();
    }

    @PluginMethod
    public void spotifyCancelLogin(PluginCall call) {
        SpotifyAuth.cancel();
        call.resolve();
    }

    @PluginMethod
    public void spotifyLoginStatus(PluginCall call) {
        JSObject result = new JSObject();
        String id = SpotifyAuth.signedInId(getContext());
        result.put("signedIn", id != null);
        result.put("id", id);
        if (id != null) result.put("user", toJsUser(SpotifyAuth.profile(getContext())));
        call.resolve(result);
    }

    /** 当前可用的访问令牌（过期前自动刷新）；没有登录时为 null。 */
    @PluginMethod
    public void spotifyAccessToken(PluginCall call) {
        new Thread(() -> {
            try {
                String token = SpotifyAuth.accessToken(getContext());
                JSObject result = new JSObject();
                result.put("token", token == null ? "" : token);
                call.resolve(result);
            } catch (IOException error) {
                call.reject("Spotify token could not be read: " + error.getMessage(), error);
            }
        }, "folia-spotify-token").start();
    }

    @PluginMethod
    public void spotifyLogout(PluginCall call) {
        SpotifyAuth.signOut(getContext());
        call.resolve();
    }

    /** Spotify 的 Web API 代取：令牌留在原生侧，渲染层只说「哪个接口」。 */
    @PluginMethod
    public void spotifyRequest(PluginCall call) {
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        String path = call.getString("path", "");
        String bodyText = call.getString("bodyText", "");
        if (path == null || (!path.startsWith("/") && !path.startsWith("https://api.spotify.com/"))) {
            call.reject("Spotify request path must be a Spotify API path");
            return;
        }
        new Thread(() -> {
            try {
                String token = SpotifyAuth.accessToken(getContext());
                if (token == null) {
                    call.reject("Spotify is not signed in");
                    return;
                }
                String url = path.startsWith("https://") ? path : "https://api.spotify.com" + path;
                RequestBody body = null;
                if (!bodyText.isEmpty()) {
                    body = RequestBody.create(bodyText, MediaType.parse("application/json; charset=utf-8"));
                }
                Request.Builder builder = new Request.Builder()
                        .url(url)
                        .header("Authorization", "Bearer " + token);
                if (body != null) builder.method(method, body);
                else if ("GET".equals(method)) builder.get();
                else builder.method(method, RequestBody.create(new byte[0], null));
                try (Response response = client.newCall(builder.build()).execute()) {
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    String responseBody = response.body() == null ? "" : response.body().string();
                    result.put("body", responseBody);
                    call.resolve(result);
                }
            } catch (IOException error) {
                call.reject("Spotify request failed: " + error.getMessage(), error);
            }
        }, "folia-spotify-api").start();
    }

    private JSObject toJsUser(JSONObject profile) {
        JSObject user = new JSObject();
        if (profile == null) return user;
        user.put("id", profile.optString("id", ""));
        user.put("displayName", profile.optString("display_name", ""));
        user.put("product", profile.optString("product", ""));
        user.put("country", profile.optString("country", ""));
        org.json.JSONArray images = profile.optJSONArray("images");
        if (images != null && images.length() > 0) {
            user.put("avatarUrl", images.optJSONObject(0) == null ? "" : images.optJSONObject(0).optString("url", ""));
        }
        return user;
    }
}
