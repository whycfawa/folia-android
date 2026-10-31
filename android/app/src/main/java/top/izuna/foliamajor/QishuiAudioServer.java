package top.izuna.foliamajor;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 汽水加密音频的本地回环代理 —— electron/qishuiApiBridge.cjs 里 loopback 音频代理
 * 的安卓版。上游直链带 `#auth=spade_a` 的，<audio> 解不开：这里在 127.0.0.1 上
 * 起一个一次性服务器，按 `?u=<cleanUrl>&a=<auth>` 下载上游、交给
 * {@link QishuiAudioDecryptor} 解密后按 Range 切给播放器。
 *
 * 与桌面端的差异只有缓存实现：LinkedHashMap(accessOrder) LRU，语义一致
 * （96MB 上限，整曲驻内存）。只绑回环 + 随机 token 路径，别的本地程序读不到。
 */
final class QishuiAudioServer {
    private static final String TAG = "QishuiAudioServer";
    private static final String AUDIO_ROUTE = "audio";
    private static final long CACHE_MAX_BYTES = 96L * 1024 * 1024;
    private static final String USER_AGENT = "Folia/0.7.20 (Qishui audio proxy)";
    private static final String[] CDN_HOST_HINTS = {"qishui.com", "byteimg.com", "douyin", "bytedance"};

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient client = new OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    private ServerSocket serverSocket;
    private int port;
    private final String audioToken = randomToken();

    /** 解密结果缓存：key = sha1(cleanUrl + '\n' + auth)。 */
    private final LinkedHashMap<String, Entry> cache = new LinkedHashMap<>(64, 0.75f, true);
    private long cacheBytes = 0;

    private static final class Entry {
        final byte[] buffer;
        final String contentType;

        Entry(byte[] buffer, String contentType) {
            this.buffer = buffer;
            this.contentType = contentType;
        }
    }

    /** 起服务器（端口交给系统分配）；已在跑就直接返回。返回是否成功。 */
    synchronized boolean start() {
        if (serverSocket != null && !serverSocket.isClosed()) return true;
        try {
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = serverSocket.getLocalPort();
        } catch (IOException error) {
            Log.w(TAG, "failed to bind the loopback audio proxy", error);
            serverSocket = null;
            port = 0;
            return false;
        }
        ServerSocket socket = serverSocket;
        executor.execute(() -> {
            while (!socket.isClosed()) {
                try {
                    Socket accepted = socket.accept();
                    executor.execute(() -> handle(accepted));
                } catch (IOException ignored) {
                    break;
                }
            }
        });
        Log.i(TAG, "loopback audio proxy on 127.0.0.1:" + port);
        return true;
    }

    synchronized boolean isRunning() {
        return serverSocket != null && !serverSocket.isClosed() && port > 0;
    }

    synchronized void stop() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        serverSocket = null;
        port = 0;
        synchronized (cache) {
            cache.clear();
            cacheBytes = 0;
        }
    }

    /**
     * 给签名页面的协议层用：把带 #auth= 的直链改写成 loopback 地址。
     * 服务器没起来时返回空串，页面侧会原样返回直链（与桌面「无本地代理」一致）。
     */
    synchronized String buildProxyUrl(String cleanUrl, String auth) {
        if (!isRunning() || cleanUrl == null || cleanUrl.isEmpty()) return "";
        try {
            return "http://127.0.0.1:" + port + "/" + audioToken + "/" + AUDIO_ROUTE
                    + "?u=" + URLEncoder.encode(cleanUrl, "UTF-8")
                    + (auth == null || auth.isEmpty() ? "" : "&a=" + URLEncoder.encode(auth, "UTF-8"));
        } catch (Exception error) {
            return "";
        }
    }

    private void handle(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;

            String range = null;
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0 && "range".equalsIgnoreCase(line.substring(0, separator).trim())) {
                    range = line.substring(separator + 1).trim();
                }
            }

            if ("OPTIONS".equalsIgnoreCase(parts[0])) {
                writeHead(output, 204, "No Content",
                        "Access-Control-Allow-Origin: *\r\n"
                                + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"
                                + "Access-Control-Allow-Headers: range\r\n"
                                + "Content-Length: 0\r\nConnection: close\r\n");
                return;
            }
            if (!"GET".equalsIgnoreCase(parts[0]) && !"HEAD".equalsIgnoreCase(parts[0])) {
                writeHead(output, 405, "Method Not Allowed", "Content-Length: 0\r\nConnection: close\r\n");
                return;
            }

            String query = parts[1];
            int queryStart = query.indexOf('?');
            if (queryStart < 0) {
                writeHead(output, 404, "Not Found", "Content-Length: 0\r\nConnection: close\r\n");
                return;
            }
            Map<String, String> params = parseQuery(query.substring(queryStart + 1));
            String cleanUrl = params.get("u");
            String auth = params.get("a");
            if (cleanUrl == null || cleanUrl.isEmpty()) {
                writeHead(output, 400, "Bad Request", "Content-Length: 0\r\nConnection: close\r\n");
                return;
            }
            if (auth == null || auth.isEmpty()) {
                // 未加密直链本来就不该走代理；真被请求就让播放器自己直连。
                writeHead(output, 302, "Found", "Location: " + cleanUrl.replace("\r", "").replace("\n", "")
                        + "\r\nContent-Length: 0\r\nConnection: close\r\n");
                return;
            }

            Entry entry = getDecrypted(cleanUrl, auth);
            if (entry == null) {
                writeHead(output, 502, "Bad Gateway",
                        "Content-Type: text/plain\r\nContent-Length: 0\r\nConnection: close\r\n");
                return;
            }
            sendAudio(output, parts[0], entry, range);
        } catch (Exception error) {
            Log.w(TAG, "audio proxy request failed", error);
        }
    }

    private Entry getDecrypted(String cleanUrl, String auth) {
        String key;
        try {
            key = QishuiAudioDecryptor.cacheKey(cleanUrl, auth);
        } catch (Exception error) {
            return null;
        }
        synchronized (cache) {
            Entry cached = cache.get(key);
            if (cached != null) return cached;
        }
        byte[] encrypted;
        try {
            encrypted = fetchUpstream(cleanUrl);
        } catch (Exception error) {
            Log.w(TAG, "qishui encrypted audio fetch failed: " + error.getMessage());
            return null;
        }
        if (encrypted == null || encrypted.length == 0) return null;
        try {
            QishuiAudioDecryptor.Result result = QishuiAudioDecryptor.decrypt(encrypted, auth);
            Entry entry = new Entry(result.buffer, result.flac ? "audio/flac" : "audio/mp4");
            remember(key, entry);
            return entry;
        } catch (Exception error) {
            Log.w(TAG, "qishui audio decrypt failed", error);
            return null;
        }
    }

    private byte[] fetchUpstream(String cleanUrl) throws IOException {
        Request.Builder builder = new Request.Builder().url(cleanUrl);
        builder.header("User-Agent", USER_AGENT);
        builder.header("Referer", refererFor(cleanUrl));
        try (Response response = client.newCall(builder.build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("HTTP " + response.code());
            }
            InputStream stream = response.body().byteStream();
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = stream.read(chunk)) >= 0) out.write(chunk, 0, read);
            return out.toByteArray();
        }
    }

    private static String refererFor(String audioUrl) {
        try {
            String host = new java.net.URL(audioUrl).getHost().toLowerCase(Locale.US);
            for (String hint : CDN_HOST_HINTS) {
                if (host.contains(hint)) return "https://www.qishui.com/";
            }
        } catch (Exception ignored) {
        }
        return "https://music.163.com/";
    }

    private void remember(String key, Entry entry) {
        synchronized (cache) {
            cache.put(key, entry);
            cacheBytes += entry.buffer.length;
            while (cacheBytes > CACHE_MAX_BYTES && cache.size() > 1) {
                String oldest = cache.keySet().iterator().next();
                Entry evicted = cache.remove(oldest);
                cacheBytes -= evicted.buffer.length;
            }
        }
    }

    /** 与桌面 qishuiSendAudioBuffer 一致：整段驻内存后按 RFC 7233 切。 */
    private static void sendAudio(BufferedOutputStream output, String method, Entry entry, String range) throws IOException {
        int total = entry.buffer.length;
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("^bytes=(\\d*)-(\\d*)$", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(range == null ? "" : range);
        if (matcher.matches()) {
            long start = matcher.group(1).isEmpty() ? 0 : Long.parseLong(matcher.group(1));
            long end = matcher.group(2).isEmpty() ? total - 1 : Long.parseLong(matcher.group(2));
            if (start < 0) start = 0;
            if (end >= total) end = total - 1;
            if (start > end || start >= total) {
                writeHead(output, 416, "Range Not Satisfiable",
                        "Content-Range: bytes */" + total + "\r\nContent-Length: 0\r\nConnection: close\r\n");
                return;
            }
            writeHead(output, 206, "Partial Content",
                    audioHeaders(entry.contentType)
                            + "Content-Length: " + (end - start + 1) + "\r\n"
                            + "Content-Range: bytes " + start + "-" + end + "/" + total + "\r\n"
                            + "Connection: close\r\n");
            if ("HEAD".equalsIgnoreCase(method)) return;
            output.write(entry.buffer, (int) start, (int) (end - start + 1));
            output.flush();
            return;
        }
        writeHead(output, 200, "OK",
                audioHeaders(entry.contentType)
                        + "Content-Length: " + total + "\r\nConnection: close\r\n");
        if ("HEAD".equalsIgnoreCase(method)) return;
        output.write(entry.buffer);
        output.flush();
    }

    private static String audioHeaders(String contentType) {
        return "Content-Type: " + (contentType == null ? "audio/mp4" : contentType) + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Accept-Ranges: bytes\r\n";
    }

    private static void writeHead(BufferedOutputStream output, int status, String reason, String headers) throws IOException {
        output.write(("HTTP/1.1 " + status + " " + reason + "\r\n" + headers + "\r\n")
                .getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new HashMap<>();
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            try {
                params.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"),
                        URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
            } catch (Exception ignored) {
            }
        }
        return params;
    }

    private static String readLine(BufferedInputStream input) throws IOException {
        StringBuilder builder = new StringBuilder();
        int value;
        while ((value = input.read()) >= 0) {
            if (value == '\n') {
                if (builder.length() > 0 && builder.charAt(builder.length() - 1) == '\r') {
                    builder.setLength(builder.length() - 1);
                }
                return builder.toString();
            }
            builder.append((char) value);
        }
        return builder.length() == 0 ? null : builder.toString();
    }

    private static String randomToken() {
        byte[] bytes = new byte[24];
        new java.security.SecureRandom().nextBytes(bytes);
        StringBuilder builder = new StringBuilder();
        for (byte value : bytes) builder.append(String.format("%02x", value));
        return builder.toString();
    }
}
