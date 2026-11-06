package top.izuna.foliamajor;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * 飞牛音乐（fnOS 官方音乐服务器）的安卓桥 —— electron/fnmusic/fnmusicApiBridge.cjs 的安卓版。
 *
 * 为什么需要原生桥：飞牛音乐靠 {@code Cookie: music-token=} 认证，浏览器 fetch 不允许设置
 * Cookie 头，跨域还被 CORS 拦；NAS 多半是私网自签名 HTTPS。和桌面一样，这些只在这里做：
 * 地址与 token 存应用私有 SharedPreferences，渲染层只发操作。
 *
 * 协议：{origin}/music/api/v1，登录 POST /user/password-login {username, password: sha256, deviceId}
 * → {userToken, user}；信封 {code,msg,data}，0/200 成功，120001 账号或密码错误；
 * 播放 /track/stream?guid= 回原始文件，封面 /static/cover?coverId=。
 *
 * 播放与封面走 127.0.0.1 的回环代理（随机 token 路径），把 Cookie 与 Range 透传给 NAS：
 * 桌面端用 folia-fnmusic:// 协议做同一件事，安卓没有自定义协议，用回环端口代替。
 */
@CapacitorPlugin(name = "FoliaFnMusic")
public class FoliaFnMusicPlugin extends Plugin {
    private static final String TAG = "FnMusic";
    private static final String PREFS = "folia-fnmusic";
    private static final String KEY_BASE = "base";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_USER_ID = "userId";
    private static final String KEY_NICKNAME = "nickname";
    private static final String KEY_DEVICE = "deviceId";
    private static final long TIMEOUT_MS = 12_000L;
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final SecureRandom random = new SecureRandom();
    private OkHttpClient strictClient;
    private OkHttpClient privateClient;
    private FnMusicProxy proxy;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static OkHttpClient build(boolean trustAnyCertificate) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .followRedirects(true)
                .followSslRedirects(true)
                .connectTimeout(TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
                .writeTimeout(TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS);
        if (trustAnyCertificate) {
            try {
                TrustManager[] trustAll = new TrustManager[] { new X509TrustManager() {
                    @Override public void checkClientTrusted(java.security.cert.X509Certificate[] chain, String authType) { }
                    @Override public void checkServerTrusted(java.security.cert.X509Certificate[] chain, String authType) { }
                    @Override public java.security.cert.X509Certificate[] getAcceptedIssuers() { return new java.security.cert.X509Certificate[0]; }
                } };
                SSLContext context = SSLContext.getInstance("TLS");
                context.init(null, trustAll, new SecureRandom());
                builder.sslSocketFactory(context.getSocketFactory(), (X509TrustManager) trustAll[0]);
                builder.hostnameVerifier((hostname, session) -> true);
            } catch (Throwable error) {
                Log.w(TAG, "无法为私网地址放宽证书校验", error);
            }
        }
        return builder.build();
    }

    /** 只有私网地址（局域网自签名 NAS）放宽证书；公网必须严格校验，防止中间人拿到 token。 */
    private static boolean isPrivateHost(String hostname) {
        String host = hostname == null ? "" : hostname.toLowerCase(Locale.ROOT).replaceAll("^\\[|\\]$", "");
        if (host.equals("localhost") || host.endsWith(".local")) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            try { octets[i] = Integer.parseInt(parts[i]); } catch (NumberFormatException error) { return false; }
            if (octets[i] < 0 || octets[i] > 255) return false;
        }
        if (octets[0] == 127 || octets[0] == 10) return true;
        if (octets[0] == 192 && octets[1] == 168) return true;
        if (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) return true;
        if (octets[0] == 169 && octets[1] == 254) return true;
        if (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127) return true;
        return false;
    }

    private OkHttpClient clientFor(String base) {
        if (strictClient == null) strictClient = build(false);
        if (privateClient == null) privateClient = build(true);
        try {
            return isPrivateHost(new URL(base).getHost()) ? privateClient : strictClient;
        } catch (Throwable error) {
            return strictClient;
        }
    }

    /** 规范化服务器地址：没写协议按 http（fnOS 默认 5666 是 HTTP），只收 http/https。 */
    private static String normalizeBase(String value) {
        String raw = value == null ? "" : value.trim();
        if (raw.isEmpty()) return null;
        String withScheme = raw.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*") ? raw : "http://" + raw;
        try {
            URL url = new URL(withScheme);
            String protocol = url.getProtocol();
            if (!protocol.equals("http") && !protocol.equals("https")) return null;
            if (url.getHost() == null || url.getHost().isEmpty()) return null;
            String origin = protocol + "://" + url.getHost() + (url.getPort() > 0 ? ":" + url.getPort() : "");
            String path = url.getPath() == null ? "" : url.getPath().replaceAll("/+$", "");
            return origin + path;
        } catch (Throwable error) {
            return null;
        }
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Throwable error) {
            return value;
        }
    }

    private String deviceId() {
        SharedPreferences prefs = prefs();
        String stored = prefs.getString(KEY_DEVICE, null);
        if (stored != null && !stored.isEmpty()) return stored;
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) hex.append(String.format("%02x", b));
        String created = hex.toString();
        prefs.edit().putString(KEY_DEVICE, created).apply();
        return created;
    }

    private static String query(Iterator<String> keys, JSONObject params) {
        StringBuilder out = new StringBuilder();
        while (keys.hasNext()) {
            String key = keys.next();
            Object raw = params.opt(key);
            if (raw == null || raw == JSONObject.NULL) continue;
            if (out.length() > 0) out.append('&');
            try {
                out.append(java.net.URLEncoder.encode(key, "UTF-8")).append('=')
                        .append(java.net.URLEncoder.encode(String.valueOf(raw), "UTF-8"));
            } catch (Throwable ignored) { }
        }
        return out.toString();
    }

    /** 一次上游请求，按桌面桥的信封规则回答。 */
    private JSObject perform(String base, String method, String path, JSONObject params, JSONObject body, String token) {
        JSObject result = new JSObject();
        String pathname = path.startsWith("/") ? path : "/" + path;
        String encoded = params == null ? "" : query(params.keys(), params);
        String url = base.replaceAll("/+$", "") + pathname + (encoded.isEmpty() ? "" : "?" + encoded);
        Request.Builder builder = new Request.Builder().url(url).header("Accept", "application/json");
        if (token != null && !token.isEmpty()) builder.header("Cookie", "music-token=" + token);
        if ("POST".equalsIgnoreCase(method)) {
            String payload = body == null ? "{}" : body.toString();
            builder.post(RequestBody.create(payload, JSON));
        } else {
            builder.get();
        }
        int status = 0;
        String raw = "";
        try (Response response = clientFor(base).newCall(builder.build()).execute()) {
            status = response.code();
            raw = response.body() == null ? "" : response.body().string();
        } catch (Throwable error) {
            Log.w(TAG, "FAIL " + method + " " + pathname, error);
            result.put("ok", false);
            result.put("status", 0);
            JSObject failure = new JSObject();
            failure.put("code", "network");
            failure.put("message", String.valueOf(error.getMessage()));
            result.put("error", failure);
            return result;
        }
        JSONObject envelope = null;
        try { envelope = raw.isEmpty() ? null : new JSONObject(raw); } catch (Throwable ignored) { }
        int code = envelope == null ? -1 : envelope.optInt("code", -1);
        if (envelope != null && code != -1 && code != 0 && code != 200) {
            Log.w(TAG, "BIZ-ERR " + method + " " + pathname + " status=" + status + " code=" + code);
            result.put("ok", false);
            result.put("status", status);
            JSObject failure = new JSObject();
            failure.put("code", code);
            failure.put("message", envelope.optString("msg", "业务错误 code=" + code));
            result.put("error", failure);
            return result;
        }
        if (envelope == null) {
            Log.w(TAG, "BAD-RESP " + method + " " + pathname + " status=" + status);
            result.put("ok", false);
            result.put("status", status);
            JSObject failure = new JSObject();
            failure.put("code", "invalid-response");
            failure.put("message", raw.length() > 200 ? raw.substring(0, 200) : (raw.isEmpty() ? "空响应" : raw));
            result.put("error", failure);
            return result;
        }
        Log.i(TAG, "OK " + method + " " + pathname + " status=" + status);
        result.put("ok", true);
        result.put("status", status);
        result.put("data", envelope.opt("data"));
        return result;
    }

    private JSObject status() {
        SharedPreferences prefs = prefs();
        JSObject out = new JSObject();
        out.put("available", true);
        out.put("configured", prefs.contains(KEY_BASE));
        out.put("authenticated", prefs.contains(KEY_TOKEN));
        out.put("base", prefs.getString(KEY_BASE, null));
        out.put("username", prefs.getString(KEY_USERNAME, null));
        out.put("userId", prefs.getString(KEY_USER_ID, null));
        out.put("nickname", prefs.getString(KEY_NICKNAME, null));
        // 已配置就把回环代理备好：封面地址在渲染层要立刻能用。
        if (prefs.contains(KEY_BASE)) ensureProxy();
        out.put("proxyBase", proxyBase());
        return out;
    }

    private String proxyBase() {
        if (proxy == null) return null;
        return "http://127.0.0.1:" + proxy.port() + "/" + proxy.token();
    }

    private void fail(PluginCall call, String code, String message) {
        JSObject out = new JSObject();
        out.put("ok", false);
        out.put("status", 0);
        JSObject failure = new JSObject();
        failure.put("code", code);
        failure.put("message", message);
        out.put("error", failure);
        call.resolve(out);
    }

    /** 一个入口，operation 与桌面桥同名：getStatus / login / logout / request / stream / cover。 */
    @PluginMethod
    public void api(PluginCall call) {
        JSObject incoming = call.getObject("params");
        // 工作线程里要用，必须是 final：可空入参先落成空对象。
        final JSObject params = incoming == null ? new JSObject() : incoming;
        final String requested = call.getString("operation", "") == null ? "" : call.getString("operation", "");
        executor.execute(() -> {
            String operation = requested;
            try {
                switch (operation) {
                    case "getStatus": {
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        out.put("status", 200);
                        out.put("data", status());
                        call.resolve(out);
                        return;
                    }
                    case "login": {
                        String rawBase = params.getString("base", "");
                        String username = params.getString("username", "");
                        String password = params.getString("password", "");
                        if (rawBase.isEmpty() || username.isEmpty() || password.isEmpty()) {
                            fail(call, "invalid-params", "登录缺少服务器地址 / 账号 / 密码");
                            return;
                        }
                        String base = normalizeBase(rawBase);
                        if (base == null) {
                            fail(call, "invalid-base", "服务器地址无效");
                            return;
                        }
                        JSONObject body = new JSONObject();
                        body.put("username", username);
                        body.put("password", sha256Hex(password));
                        body.put("deviceId", deviceId());
                        JSObject result = perform(base, "POST", "/music/api/v1/user/password-login", null, body, null);
                        if (!Boolean.TRUE.equals(result.getBool("ok"))) {
                            call.resolve(result);
                            return;
                        }
                        Object rawData = result.opt("data");
                        JSONObject data = rawData instanceof JSONObject ? (JSONObject) rawData : null;
                        String token = data == null ? "" : data.optString("userToken", "");
                        JSONObject user = data == null ? null : data.optJSONObject("user");
                        if (token.isEmpty() || user == null) {
                            fail(call, "invalid-response", "登录响应缺少 userToken 或 user");
                            return;
                        }
                        String userId = user.optString("guid", user.optString("id", user.optString("uid", "")));
                        String nickname = user.optString("name", user.optString("nickname", user.optString("username", "")));
                        prefs().edit()
                                .putString(KEY_BASE, base)
                                .putString(KEY_USERNAME, username)
                                .putString(KEY_TOKEN, token)
                                .putString(KEY_USER_ID, userId)
                                .putString(KEY_NICKNAME, nickname)
                                .apply();
                        Log.i(TAG, "login ok base=" + base + " user=" + (userId.isEmpty() ? "(none)" : "present"));
                        JSObject answer = new JSObject();
                        answer.put("ok", true);
                        answer.put("status", 200);
                        JSObject payload = new JSObject();
                        payload.put("user", user);
                        answer.put("data", payload);
                        call.resolve(answer);
                        return;
                    }
                    case "logout": {
                        String base = prefs().getString(KEY_BASE, null);
                        String token = prefs().getString(KEY_TOKEN, null);
                        if (base != null && token != null) perform(base, "POST", "/music/api/v1/user/logout", null, new JSONObject(), token);
                        prefs().edit().remove(KEY_BASE).remove(KEY_USERNAME).remove(KEY_TOKEN)
                                .remove(KEY_USER_ID).remove(KEY_NICKNAME).apply();
                        JSObject answer = new JSObject();
                        answer.put("ok", true);
                        answer.put("status", 200);
                        call.resolve(answer);
                        return;
                    }
                    case "request": {
                        String base = prefs().getString(KEY_BASE, null);
                        if (base == null) {
                            fail(call, "unconfigured", "飞牛尚未配置服务器");
                            return;
                        }
                        String path = params.getString("path", "");
                        String method = params.getString("method", "GET");
                        JSONObject query = params.optJSONObject("params");
                        JSONObject body = params.optJSONObject("body");
                        call.resolve(perform(base, method == null ? "GET" : method, path, query, body, prefs().getString(KEY_TOKEN, null)));
                        return;
                    }
                    case "stream": {
                        String base = prefs().getString(KEY_BASE, null);
                        if (base == null) {
                            fail(call, "unconfigured", "飞牛尚未配置服务器");
                            return;
                        }
                        ensureProxy();
                        String guid = params.getString("trackId", "");
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        out.put("status", 200);
                        JSObject payload = new JSObject();
                        payload.put("url", proxyBase() + "/stream?guid=" + java.net.URLEncoder.encode(guid, "UTF-8"));
                        out.put("data", payload);
                        call.resolve(out);
                        return;
                    }
                    case "cover": {
                        if (prefs().getString(KEY_BASE, null) == null) {
                            fail(call, "unconfigured", "飞牛尚未配置服务器");
                            return;
                        }
                        ensureProxy();
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        out.put("status", 200);
                        JSObject payload = new JSObject();
                        payload.put("url", proxyBase() + "/cover?coverId=" + java.net.URLEncoder.encode(params.getString("coverId", ""), "UTF-8")
                                + "&size=" + java.net.URLEncoder.encode(params.getString("size", "600"), "UTF-8"));
                        out.put("data", payload);
                        call.resolve(out);
                        return;
                    }
                    default:
                        fail(call, "invalid-params", "未知操作 " + operation);
                }
            } catch (Throwable error) {
                Log.w(TAG, "operation failed " + operation, error);
                JSObject out = new JSObject();
                out.put("ok", false);
                out.put("status", 0);
                JSObject failure = new JSObject();
                failure.put("code", "network");
                failure.put("message", String.valueOf(error.getMessage()));
                out.put("error", failure);
                call.resolve(out);
            }
        });
    }

    private synchronized void ensureProxy() {
        if (proxy != null) return;
        FnMusicProxy created = new FnMusicProxy(this);
        if (created.start()) proxy = created;
    }

    String upstreamBase() { return prefs().getString(KEY_BASE, null); }

    String upstreamToken() { return prefs().getString(KEY_TOKEN, null); }

    OkHttpClient upstreamClient(String base) { return clientFor(base); }

    @Override
    protected void handleOnDestroy() {
        if (proxy != null) {
            proxy.stop();
            proxy = null;
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    /** 回环代理：把播放与封面请求带上 Cookie 转发给 NAS，Range 原样透传。 */
    static final class FnMusicProxy {
        private final FoliaFnMusicPlugin plugin;
        private final String token;
        private final ExecutorService workers = Executors.newCachedThreadPool();
        private ServerSocket socket;

        FnMusicProxy(FoliaFnMusicPlugin plugin) {
            this.plugin = plugin;
            byte[] bytes = new byte[12];
            new SecureRandom().nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) hex.append(String.format("%02x", b));
            this.token = hex.toString();
        }

        String token() { return token; }

        int port() { return socket == null ? 0 : socket.getLocalPort(); }

        boolean start() {
            try {
                socket = new ServerSocket(0, 40, InetAddress.getByName("127.0.0.1"));
                Thread thread = new Thread(() -> {
                    while (socket != null && !socket.isClosed()) {
                        try {
                            Socket client = socket.accept();
                            workers.execute(() -> serve(client));
                        } catch (Throwable error) {
                            if (socket == null || socket.isClosed()) return;
                        }
                    }
                }, "fnmusic-proxy");
                thread.setDaemon(true);
                thread.start();
                Log.i(TAG, "proxy listening on " + port());
                return true;
            } catch (Throwable error) {
                Log.w(TAG, "proxy failed to start", error);
                return false;
            }
        }

        void stop() {
            try { if (socket != null) socket.close(); } catch (Throwable ignored) { }
            socket = null;
            workers.shutdownNow();
        }

        private void serve(Socket client) {
            try (Socket socket = client) {
                InputStream input = new BufferedInputStream(socket.getInputStream());
                StringBuilder head = new StringBuilder();
                while (true) {
                    int b = input.read();
                    if (b < 0) return;
                    head.append((char) b);
                    if (head.length() >= 4 && head.substring(head.length() - 4).equals("\r\n\r\n")) break;
                    if (head.length() > 8192) return;
                }
                String requestLine = head.substring(0, head.indexOf("\r\n"));
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) return;
                String target = parts[1];
                String range = null;
                for (String line : head.toString().split("\r\n")) {
                    int colon = line.indexOf(':');
                    if (colon <= 0) continue;
                    if (line.substring(0, colon).trim().equalsIgnoreCase("Range")) range = line.substring(colon + 1).trim();
                }
                String base = plugin.upstreamBase();
                String authToken = plugin.upstreamToken();
                if (base == null || !target.startsWith("/" + token + "/")) {
                    write(socket.getOutputStream(), 403, "text/plain", "forbidden".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                String rest = target.substring(token.length() + 2);
                String path;
                if (rest.startsWith("stream?")) path = "/music/api/v1/track/stream?" + rest.substring("stream?".length());
                else if (rest.startsWith("cover?")) path = "/music/api/v1/static/cover?" + rest.substring("cover?".length());
                else {
                    write(socket.getOutputStream(), 404, "text/plain", new byte[0]);
                    return;
                }
                Request.Builder request = new Request.Builder().url(base.replaceAll("/+$", "") + path).header("Accept", "*/*");
                if (authToken != null && !authToken.isEmpty()) request.header("Cookie", "music-token=" + authToken);
                if (range != null) request.header("Range", range);
                try (Response response = plugin.upstreamClient(base).newCall(request.build()).execute()) {
                    String contentType = response.header("Content-Type", "application/octet-stream");
                    String contentRange = response.header("Content-Range");
                    String acceptRanges = response.header("Accept-Ranges");
                    OutputStream output = new BufferedOutputStream(socket.getOutputStream());
                    StringBuilder header = new StringBuilder();
                    header.append("HTTP/1.1 ").append(response.code()).append(" ").append(response.isSuccessful() ? "OK" : "ERR").append("\r\n");
                    header.append("Content-Type: ").append(contentType).append("\r\n");
                    header.append("Access-Control-Allow-Origin: *\r\n");
                    if (contentRange != null) header.append("Content-Range: ").append(contentRange).append("\r\n");
                    if (acceptRanges != null) header.append("Accept-Ranges: ").append(acceptRanges).append("\r\n");
                    long length = response.body() == null ? 0 : response.body().contentLength();
                    if (length >= 0 && contentRange == null) header.append("Content-Length: ").append(length).append("\r\n");
                    header.append("Connection: close\r\n\r\n");
                    output.write(header.toString().getBytes(StandardCharsets.UTF_8));
                    if (response.body() != null) {
                        InputStream upstream = response.body().byteStream();
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = upstream.read(buffer)) > 0) {
                            output.write(buffer, 0, read);
                        }
                    }
                    output.flush();
                }
            } catch (Throwable error) {
                Log.w(TAG, "proxy request failed", error);
            }
        }

        private static void write(OutputStream output, int status, String type, byte[] body) throws Exception {
            StringBuilder header = new StringBuilder();
            header.append("HTTP/1.1 ").append(status).append(" ERROR\r\n");
            header.append("Content-Type: ").append(type).append("\r\n");
            header.append("Access-Control-Allow-Origin: *\r\n");
            header.append("Content-Length: ").append(body.length).append("\r\n");
            header.append("Connection: close\r\n\r\n");
            output.write(header.toString().getBytes(StandardCharsets.UTF_8));
            output.write(body);
            output.flush();
        }
    }
}
