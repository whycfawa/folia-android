package top.izuna.foliamajor;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Headers;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 洛雪脚本沙箱页面的本地服务：隐藏 WebView 从 {@code http://127.0.0.1:<port>/} 打开那张空页，
 * 页面里 {@code lx.request} 的每一次调用都 POST 回这里的 {@code /__lx/request}。
 *
 * 这一层就是桌面版 {@code main/sandboxHost.ts} + {@code main/egress.ts} 的角色：
 *   - 页面只认这个源（CSP 的 connect-src 只放 'self'），所以脚本的请求必须过这里，没有绕过受控出口的路；
 *   - 出口判定用 {@link LxEgress}（和桌面 {@code egressGuard.ts} 同一套网段规矩），跳转自己跟、每一跳重判；
 *   - 正文进来、回答出去都有上限；同时在途的请求数也有上限（桌面 MAX_PENDING_REQUESTS 的同一条）。
 * 页面是第三方脚本的宿主，所以这里一条路都不多开：除 {@code /} 与 {@code /__lx/request} 之外一律 403。
 */
final class LxSandboxServer {
    private static final String TAG = "LxSandboxServer";
    /** 桌面 sandbox/constants.ts 里的 SANDBOX_ORIGIN：注入文本时要把它换成这里的源。 */
    static final String SANDBOX_ORIGIN = "https://lx-sandbox.invalid";
    static final String REQUEST_PATH = "/__lx/request";

    /** default-src 'none'：页面加载不了任何子资源；脚本只认注入的；联网只许回到本页的源，也就是只到得了这里。 */
    private static final String PAGE_CSP =
        "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; "
            + "base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin";
    private static final String BLANK_PAGE =
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title></title></head><body></body></html>";

    /** lx.request 一个回答的上限、一个请求正文的上限、整个 POST 信封的上限（正文是 base64）。 */
    private static final int MAX_ANSWER_BYTES = 8 * 1024 * 1024;
    private static final int MAX_REQUEST_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
    private static final int MAX_PENDING_REQUESTS = 24;
    private static final int MAX_REDIRECTS = 8;
    private static final int DEFAULT_TIMEOUT_MS = 15_000;
    private static final int MAX_TIMEOUT_MS = 60_000;
    /** 桌面 egress.ts 的 DEFAULT_USER_AGENT：脚本没写 UA 时由出口补上，和上游一字不差。 */
    private static final String DEFAULT_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    /** Chromium 不许 HTTP 去碰的端口里常见的那些（桌面 egress.ts 那张表的压缩版）：往这些端口发正文可以冒充别的协议。 */
    private static final Set<Integer> BLOCKED_PORTS = new HashSet<>();
    static {
        for (int port : new int[] {
            1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
            103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512,
            513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
            1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
        }) {
            BLOCKED_PORTS.add(port);
        }
    }
    /** 跨源跳转时拿掉的（带凭据的）头。 */
    private static final Set<String> CREDENTIAL_HEADERS = new HashSet<>();
    static {
        CREDENTIAL_HEADERS.add("authorization");
        CREDENTIAL_HEADERS.add("cookie");
        CREDENTIAL_HEADERS.add("proxy-authorization");
    }
    /** 连接层归我们管，脚本给的一律不转。 */
    private static final Set<String> HOP_HEADERS = new HashSet<>();
    static {
        for (String name : new String[] {
            "host", "content-length", "connection", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer",
            "expect", "proxy-authorization", "proxy-connection", "content-encoding",
        }) {
            HOP_HEADERS.add(name);
        }
    }
    /**
     * 回给脚本的头里要去掉的：这几条是连接层的，或者已经被 OkHttp 解开了（gzip）。
     * 和上面那张表不同，content-length / content-type 要留着 —— 桌面版也是原样交给脚本的。
     */
    private static final Set<String> RESPONSE_HOP_HEADERS = new HashSet<>();
    static {
        for (String name : new String[] {
            "connection", "keep-alive", "transfer-encoding", "upgrade", "trailer", "content-encoding", "proxy-connection",
        }) {
            RESPONSE_HOP_HEADERS.add(name);
        }
    }

    private final OkHttpClient client = new OkHttpClient.Builder()
        // 跳转自己跟：每一跳都要重新过 LxEgress，交给 OkHttp 跟就看不见中间的地址了。
        .followRedirects(false)
        .followSslRedirects(false)
        .build();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final AtomicInteger inFlight = new AtomicInteger();
    private ServerSocket serverSocket;
    private int port;

    synchronized int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return port;
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        executor.execute(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handle(socket));
                } catch (IOException error) {
                    if (!serverSocket.isClosed()) Log.w(TAG, "accept failed", error);
                    break;
                }
            }
        });
        return port;
    }

    int getPort() {
        return port;
    }

    synchronized void stop() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
            // 关不上也没有别的办法。
        }
        serverSocket = null;
    }

    /** 页面地址：注入的 sandbox.cjs 里那个占位的源要换成它。 */
    String origin() {
        return "http://127.0.0.1:" + port;
    }

    private void handle(Socket socket) {
        try (Socket clientSocket = socket;
             BufferedInputStream input = new BufferedInputStream(clientSocket.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(clientSocket.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.ROOT);
            String target = parts[1];
            int queryAt = target.indexOf('?');
            String path = queryAt >= 0 ? target.substring(0, queryAt) : target;

            Map<String, String> headers = new LinkedHashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }

            if ("GET".equals(method) && "/".equals(path)) {
                write(output, 200, "OK", "text/html; charset=utf-8", BLANK_PAGE.getBytes(StandardCharsets.UTF_8),
                    "Content-Security-Policy: " + PAGE_CSP + "\r\n");
                return;
            }
            if ("POST".equals(method) && REQUEST_PATH.equals(path)) {
                if (inFlight.get() >= MAX_PENDING_REQUESTS) {
                    writeJson(output, 429, errorJson("too many requests at once"));
                    return;
                }
                byte[] body = readBody(input, headers, MAX_ENVELOPE_BYTES);
                if (body == null) {
                    writeJson(output, 413, errorJson("request too large"));
                    return;
                }
                inFlight.incrementAndGet();
                try {
                    writeJson(output, 200, answer(new String(body, StandardCharsets.UTF_8)));
                } finally {
                    inFlight.decrementAndGet();
                }
                return;
            }
            writeJson(output, 403, errorJson("not allowed"));
        } catch (Exception error) {
            Log.w(TAG, "sandbox request failed", error);
        }
    }

    /** 一个 lx.request：校验形状 → 受控出口发出去 → 整个回答读回来。 */
    private String answer(String envelope) {
        try {
            JSONObject request = new JSONObject(envelope);
            String url = request.optString("url", null);
            if (url == null || url.length() > 8192) return errorJson("bad request");
            String method = request.optString("method", "GET");
            int timeoutMs = request.has("timeoutMs") ? request.optInt("timeoutMs", DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
            if (timeoutMs <= 0) timeoutMs = DEFAULT_TIMEOUT_MS;
            timeoutMs = Math.min(timeoutMs, MAX_TIMEOUT_MS);

            Map<String, String> headers = new HashMap<>();
            JSONObject givenHeaders = request.optJSONObject("headers");
            if (givenHeaders != null) {
                java.util.Iterator<String> names = givenHeaders.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    Object value = givenHeaders.opt(name);
                    if (value instanceof String) headers.put(name, (String) value);
                }
            }
            String bodyText = request.optString("body", null);
            byte[] body = null;
            if (bodyText != null) {
                body = Base64.decode(bodyText, Base64.DEFAULT);
                if (body.length > MAX_REQUEST_BYTES) return errorJson("request body too large");
            }
            // 桌面 egress.ts：脚本没给的头由出口补默认 UA / Accept（脚本给的不覆盖）。
            // 没有这一行，OkHttp 会用它自己的 UA 发出去，几个接口因此回空或回错误页 —— 脚本报「响应中未找到有效链接」。
            if (!hasHeader(headers, "user-agent")) headers.put("User-Agent", DEFAULT_USER_AGENT);
            if (!hasHeader(headers, "accept")) headers.put("Accept", "*/*");
            // 在途数的闸套住整个 lx.request（桌面 sandboxHost 把 concurrency 交给出口，一处管一次请求）。
            final String requestUrl = url;
            final String requestMethod = method;
            final Map<String, String> requestHeaders = headers;
            final byte[] requestBody = body;
            final int requestTimeoutMs = timeoutMs;
            try {
                return LxLimits.scriptConcurrency().run(hostOf(requestUrl),
                    () -> forward(requestUrl, requestMethod, requestHeaders, requestBody, requestTimeoutMs));
            } catch (LxLimits.RateLimitedException error) {
                return errorJson(error.getMessage());
            }
        } catch (Exception error) {
            return errorJson("bad request");
        }
    }

    /** 出口：地址逐跳判定，最多 MAX_REDIRECTS 跳；回答整个读回来（有上限）。 */
    private String forward(String startUrl, String startMethod, Map<String, String> startHeaders, byte[] body, int timeoutMs)
        throws IOException {
        String url = startUrl;
        String method = startMethod == null ? "GET" : startMethod.toUpperCase(Locale.ROOT);
        Map<String, String> headers = new HashMap<>(startHeaders);
        String origin = originOf(url);
        long deadline = System.currentTimeMillis() + timeoutMs;

        for (int hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            // 每一跳都把地址里的账号密码和片段去掉：不让它们混进主机名判定，也不往外带（桌面 egress.ts 同一条）。
            try {
                URL parsed = new URL(url);
                if (parsed.getUserInfo() != null || parsed.getRef() != null) {
                    url = new URL(parsed.getProtocol(), parsed.getHost(), parsed.getPort(), parsed.getPath()).toString();
                    // query 不能丢：脚本的 API 参数大多在 query 里。
                    String query = parsed.getQuery();
                    if (query != null && !query.isEmpty()) url += "?" + query;
                }
            } catch (Exception ignored) {
                // 地址不合法后面 blockReason 会拒掉，这里不必先抛。
            }
            String reason = blockReason(url);
            if (reason != null) return errorJson("egress blocked (" + reason + ")");
            // 限速在判定之后：被拦的去处不占名额，跳转的每一跳各算一次（桌面 egress.ts 同一条）。
            try {
                LxLimits.scriptRate().take(hostOf(url));
            } catch (LxLimits.RateLimitedException error) {
                return errorJson(error.getMessage());
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return errorJson("request timed out");
            }

            Request.Builder builder = new Request.Builder().url(url).headers(Headers.of(filtered(headers)));
            boolean bodyless = "GET".equals(method) || "HEAD".equals(method);
            boolean needsBody = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)
                || "PROPPATCH".equals(method) || "REPORT".equals(method);
            if (body != null && !bodyless) {
                builder.method(method, RequestBody.create(body, (okhttp3.MediaType) null));
            } else if (needsBody) {
                builder.method(method, RequestBody.create(new byte[0], (okhttp3.MediaType) null));
            } else {
                builder.method(method, null);
            }
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) return errorJson("request timed out");
            OkHttpClient bounded = client.newBuilder()
                .connectTimeout(left, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(left, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build();

            try (Response response = bounded.newCall(builder.build()).execute()) {
                int status = response.code();
                String location = response.header("Location");
                boolean redirect = status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
                if (redirect && location != null && !location.isEmpty()) {
                    String next;
                    try {
                        next = new URL(new URL(url), location).toString();
                    } catch (Exception error) {
                        return errorJson("bad redirect");
                    }
                    String nextOrigin = originOf(next);
                    if (!nextOrigin.equals(origin)) {
                        // 换了源：带凭据的头不跟过去。
                        headers.keySet().removeIf(name -> CREDENTIAL_HEADERS.contains(name.toLowerCase(Locale.ROOT)));
                    }
                    if (status == 303 || ((status == 301 || status == 302) && !"GET".equals(method) && !"HEAD".equals(method))) {
                        method = "GET";
                        body = null;
                        // 桌面 egress.ts 把 `content-*` 全去掉（不只是 content-type）。
                        headers.keySet().removeIf(name -> name.toLowerCase(Locale.ROOT).startsWith("content-"));
                    }
                    origin = nextOrigin;
                    url = next;
                    continue;
                }
                ResponseBody answerBody = response.body();
                byte[] bytes = answerBody == null ? new byte[0] : readCapped(answerBody.byteStream(), MAX_ANSWER_BYTES);
                if (bytes == null) return errorJson("the answer is too large");
                // 桌面 fetchBytes 会按 content-encoding 解压后再交给脚本；OkHttp 默认自己解 gzip，
                // 只有脚本显式要了压缩编码（关掉了 OkHttp 的自动解压）时才走到这里。
                String encoding = response.header("Content-Encoding");
                if (encoding != null && bytes.length > 0) {
                    String kind = encoding.trim().toLowerCase(Locale.ROOT);
                    try {
                        if (kind.equals("gzip") || kind.equals("x-gzip")) {
                            bytes = readCapped(new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(bytes)), MAX_ANSWER_BYTES);
                        } else if (kind.equals("deflate")) {
                            bytes = readCapped(new java.util.zip.InflaterInputStream(new java.io.ByteArrayInputStream(bytes)), MAX_ANSWER_BYTES);
                        }
                    } catch (Exception error) {
                        return errorJson("the answer could not be decompressed");
                    }
                    if (bytes == null) return errorJson("the answer is too large");
                }

                try {
                    JSONObject result = new JSONObject();
                    result.put("ok", true);
                    result.put("statusCode", status);
                    result.put("statusMessage", response.message() == null ? "" : response.message());
                    JSONObject outHeaders = new JSONObject();
                    for (String name : response.headers().names()) {
                        String value = response.header(name);
                        if (value == null || RESPONSE_HOP_HEADERS.contains(name.toLowerCase(Locale.ROOT))) continue;
                        // 解压过的回答不能把 content-encoding / content-length 原样交给脚本（桌面 fetchBytes 也删掉）。
                        if (encoding != null && (name.equalsIgnoreCase("content-encoding") || name.equalsIgnoreCase("content-length"))) continue;
                        outHeaders.put(name, value);
                    }
                    result.put("headers", outHeaders);
                    result.put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    return result.toString();
                } catch (org.json.JSONException error) {
                    return errorJson("the answer could not be encoded");
                }
            } catch (IOException error) {
                return errorJson(error.getMessage() == null ? "request failed" : error.getMessage());
            }
        }
        return errorJson("too many redirects");
    }

    /** 地址该不该拦：字面与解析出的地址都由 {@link LxEgress} 判，端口另看。 */
    private static String blockReason(String url) {
        String reason = LxEgress.blockReason(url);
        if (reason != null) return reason;
        try {
            URL parsed = new URL(url);
            int port = parsed.getPort();
            if (port <= 0) port = "https".equalsIgnoreCase(parsed.getProtocol()) ? 443 : 80;
            if (BLOCKED_PORTS.contains(port)) return "blocked-port";
        } catch (Exception error) {
            return "invalid-address";
        }
        return null;
    }

    private static String originOf(String url) {
        try {
            URL parsed = new URL(url);
            int port = parsed.getPort();
            if (port <= 0) port = "https".equalsIgnoreCase(parsed.getProtocol()) ? 443 : 80;
            return parsed.getProtocol().toLowerCase(Locale.ROOT) + "://" + parsed.getHost().toLowerCase(Locale.ROOT) + ":" + port;
        } catch (Exception error) {
            return "";
        }
    }

    /** 限速与在途数按主机记账：取 URL 的主机名（取不到就给个空串，和别处一样当同一个未知去处）。 */
    private static String hostOf(String url) {
        try {
            String host = new URL(url).getHost();
            return host == null ? "" : host;
        } catch (Exception error) {
            return "";
        }
    }

    /** 头名不分大小写（脚本给的头和我们要补的头大小写可能不同）。 */
    private static boolean hasHeader(Map<String, String> headers, String name) {
        for (String key : headers.keySet()) {
            if (key != null && key.equalsIgnoreCase(name)) return true;
        }
        return false;
    }

    private static Map<String, String> filtered(Map<String, String> headers) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String name = entry.getKey();
            if (name == null || name.isEmpty()) continue;
            if (HOP_HEADERS.contains(name.toLowerCase(Locale.ROOT))) continue;
            out.put(name, entry.getValue());
        }
        return out;
    }

    private static byte[] readCapped(InputStream stream, int maxBytes) throws IOException {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            sink.write(buffer, 0, read);
            if (sink.size() > maxBytes) return null;
        }
        return sink.toByteArray();
    }

    /** 读 POST 的正文：按 Content-Length，超上限的不读进来。 */
    private static byte[] readBody(InputStream input, Map<String, String> headers, int maxBytes) throws IOException {
        String declared = headers.get("content-length");
        int length;
        try {
            length = declared == null ? 0 : Integer.parseInt(declared.trim());
        } catch (NumberFormatException error) {
            return null;
        }
        if (length < 0 || length > maxBytes) return null;
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(body, offset, length - offset);
            if (read < 0) break;
            offset += read;
        }
        if (offset != length) return null;
        return body;
    }

    private static String errorJson(String message) {
        JSONObject value = new JSONObject();
        try {
            value.put("ok", false);
            value.put("error", message == null ? "request failed" : message.length() > 200 ? message.substring(0, 200) : message);
        } catch (Exception ignored) {
            // JSONObject.put(String,String) 不会抛。
        }
        return value.toString();
    }

    private static void writeJson(BufferedOutputStream output, int status, String body) throws IOException {
        write(output, status, status == 200 ? "OK" : "Error", "application/json; charset=utf-8",
            body.getBytes(StandardCharsets.UTF_8), "Cache-Control: no-store\r\n");
    }

    private static void write(BufferedOutputStream output, int status, String reason, String contentType, byte[] body, String extra)
        throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        if (extra != null) head.append(extra);
        head.append("Connection: close\r\n\r\n");
        output.write(head.toString().getBytes(StandardCharsets.US_ASCII));
        output.write(body);
        output.flush();
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.write(value);
            if (line.size() > 8192) return null;
        }
        if (value == -1 && line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.UTF_8);
    }
}
