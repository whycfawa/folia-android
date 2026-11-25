package top.izuna.foliamajor;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
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
import okhttp3.ResponseBody;

/**
 * 本地音频流服务器。
 *
 * 两种来源：
 *   /audio/<MediaStore id>          系统媒体库里的文件
 *   /audio/imported-<file name>     通过系统文件管理器挑选后复制进 App 私有目录的文件
 *
 * WebView 的 <audio> 播不了 content:// 这种 URI，也不认 App 私有目录里的路径，
 * 所以原生起一个只监听 127.0.0.1 的小服务，把音频以 http 的形式喂回去。
 * 必须支持 Range：<audio> 拖进度、以及某些格式要先读文件尾部的元数据，都靠它。
 */
final class LocalAudioServer {
    private static final String TAG = "LocalAudioServer";
    private static final String AUDIO_PATH_PREFIX = "/audio/";
    private static final String REMOTE_AUDIO_PATH_PREFIX = "/remote-audio/";
    private static final String IMPORTED_PREFIX = "imported-";
    /** 直接按绝对路径流原文件的 ref 前缀（文件系统兜底扫描出来的歌，不复制进私有目录）。 */
    private static final String FILE_PREFIX = "file-";
    /*
     * 汽水音乐（抖音/字节）播放地址所在的 CDN 后缀。
     *
     * 播放地址来自 douyinvod / bytefcdn / zjcdn 这类字节域，qishui.com、douyin.com
     * 自己也会直发流。单列一份是因为 Referer 要按这一族单独判（见 refererForHost），
     * 下面那份白名单只是把它并进去。不要在这里写 com / cn 这种过宽的后缀：
     * 这个数组决定本机能代谁去取流，宽一格就多一片可被滥用的目标。
     */
    private static final String[] BYTEDANCE_AUDIO_HOST_SUFFIXES = {
        "douyinvod.com",
        "bytefcdn.com",
        "bytecdn.cn",
        "byteicdn.com",
        "ibytedtos.com",
        "pstatp.com",
        "bytedance.com",
        "bytetos.com",
        "volcvideo.com",
        "volccdn.com",
        "volces.com",
        "volcengineapi.com",
        "douyin.com",
        "qishui.com",
        "zijieapi.com",
        "zjcdn.com",
        "snssdk.com"
    };
    /*
     * 只能代哪些主机的远端音频。
     *
     * 这个服务监听在 127.0.0.1 上，设备上任何应用都能连上来 —— 放行任意 URL 就等于
     * 开了一个「任读全网」的口子，所以按主机白名单收口。目前只有 Kuwo（波点）/ 网易 /
     * 酷狗，以及汽水音乐（抖音/字节）需要它：它们的 CDN 不下发 CORS 头，而
     * <audio> 带 crossOrigin="anonymous"，于是播放被同源策略挡掉
     * （表现是 MEDIA_ELEMENT_ERROR: Format error）。
     */
    private static final String[] REMOTE_AUDIO_HOST_SUFFIXES = withSuffixes(
        new String[] { "kuwo.cn", "music.126.net", "kugou.com" },
        BYTEDANCE_AUDIO_HOST_SUFFIXES
    );
    private static final String REMOTE_AUDIO_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
    private static final String REMOTE_AUDIO_REFERER = "https://www.kuwo.cn/";
    private static final String NETEASE_REMOTE_AUDIO_REFERER = "https://music.163.com/";
    /** 汽水（抖音）的 CDN 只认自家站点来的请求，桌面站点的 Referer 会被拒或被回错误页。 */
    private static final String BYTEDANCE_REMOTE_AUDIO_REFERER = "https://music.douyin.com/";
    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient remoteAudioClient = new OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build();
    /**
     * 洛雪音源那一路（脚本给的地址）另用一份：读超时 30 秒，对应桌面 rateLimit.ts 的 `streamIdleMs`
     * ——「我们在等、上游 30 秒不来数据就断」。别的平台（酷我 / 网易 / 酷狗 / 汽水 / 飞牛）仍用上面那份，
     * 行为一点不动：这里的转发是阻塞式读，只有下游确实想要数据时才会阻塞在 read 上，正好是上游那条规则的条件。
     */
    private final OkHttpClient scriptedAudioClient = remoteAudioClient.newBuilder()
        .readTimeout(LxLimits.Limits.STREAM_IDLE_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
        .build();
    private final Map<String, String> remoteAudioUrls = new LinkedHashMap<>();
    /** 转发时要额外带上的请求头（按 token 存）；没有时为 null，见 {@link #registerRemoteAudio}。 */
    private final Map<String, Map<String, String>> remoteAudioHeaders = new LinkedHashMap<>();
    /** 哪些 token 来自洛雪脚本（要过限速、算在音频流上限里）。 */
    private final java.util.Set<String> scriptedTokens = new java.util.HashSet<>();
    private ServerSocket serverSocket;
    private int port;

    LocalAudioServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return port;
        // 端口交给系统分配（0）：写死一个的话，被别的进程占了就起不来，
        // 而每次启动拿到的端口都可能不同，所以 URL 不能持久化，播放前要重新拼（见插件的 localAudioServerPort）。
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        executor.execute(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handle(socket));
                } catch (IOException ignored) {
                    Log.i(TAG, "server socket closed, stopping accept loop");
                    break;
                }
            }
        });
        return port;
    }

    int getPort() {
        return port;
    }

    /**
     * 把一个远端音频地址挂到本地服务上，返回 `http://127.0.0.1:<port>/remote-audio/<token>`。
     *
     * 为什么要绕这一圈：<audio> 带 crossOrigin="anonymous"，而 Kuwo（波点）的 CDN
     * 根本不下发 Access-Control-Allow-Origin —— 请求连字节都拿不到，报出来却是
     * 一句毫无特征的 "MEDIA_ELEMENT_ERROR: Format error" / "The element has no supported sources"。
     * 本地服务回包带 ACAO: *，同源检查就过了；Range 也照样转发，拖进度条不受影响。
     */
    synchronized String registerRemoteAudio(String value) throws IOException {
        return registerRemoteAudio(value, null, false);
    }

    /**
     * 同 {@link #registerRemoteAudio(String)}，但多两个开关：转发时要附带的请求头，以及"允许任意主机"。
     *
     * 为什么要它们：飞牛（FNOS）这类自建服务的音频流只认 `Cookie: music-token=...`，
     * 而 <audio> 加不了任何请求头；它的地址又是用户在登录时自己填的局域网地址，
     * 不可能出现在 {@link #REMOTE_AUDIO_HOST_SUFFIXES} 那份白名单里。
     * 两个开关都由调用方显式打开，白名单那一路（Kuwo / 网易）行为不变。
     */
    synchronized String registerRemoteAudio(String value, Map<String, String> headers, boolean allowAnyHost) throws IOException {
        return registerRemoteAudio(value, headers, allowAnyHost, false);
    }

    /**
     * 同上，多一个 `scripted`：洛雪音源给的地址要按桌面 `rateLimit.ts` 那套收口（音频流的每秒请求数、
     * 同时在转发的 8 条流、单流 4 GiB、上游 30 秒不来数据就断）。别家平台的流走原路，一条限制都不加。
     */
    synchronized String registerRemoteAudio(String value, Map<String, String> headers, boolean allowAnyHost, boolean scripted)
        throws IOException {
        URL url = new URL(value);
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))
            || !(allowAnyHost || isRemoteAudioHostAllowed(host))) {
            throw new IOException("Unsupported remote audio host");
        }
        int localPort = start();
        String token = android.util.Base64.encodeToString(
            value.getBytes(StandardCharsets.UTF_8),
            android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP
        );
        synchronized (remoteAudioUrls) {
            remoteAudioUrls.remove(token);
            remoteAudioUrls.put(token, value);
            remoteAudioHeaders.remove(token);
            if (headers != null && !headers.isEmpty()) remoteAudioHeaders.put(token, new HashMap<>(headers));
            if (scripted) scriptedTokens.add(token);
            else scriptedTokens.remove(token);
            while (remoteAudioUrls.size() > 128) {
                String oldest = remoteAudioUrls.keySet().iterator().next();
                remoteAudioUrls.remove(oldest);
                remoteAudioHeaders.remove(oldest);
                scriptedTokens.remove(oldest);
            }
        }
        return "http://127.0.0.1:" + localPort + REMOTE_AUDIO_PATH_PREFIX + token;
    }

    /** 有些 CDN 看 Referer 决定给不给资源：不带时回的是一段 HTML 而不是音频。 */
    private static String remoteAudioReferer(String value) {
        String host;
        try {
            host = new URL(value).getHost();
        } catch (Exception ignored) {
            return REMOTE_AUDIO_REFERER;
        }
        return refererForHost(host);
    }

    /**
     * 按主机挑 Referer。
     *
     * 汽水（抖音）的 CDN 只认自家站点来的请求：带 www.kuwo.cn 那种无关的 Referer
     * 会被回成一段 HTML 或 403，喂进 <audio> 就是 "Format error"。所以这一族主机
     * 统一发 music.douyin.com；UA 仍然是上面那条移动 Chrome，不发 LunaOpenSDK 的
     * 客户端 UA —— 那套 UA 是桌面端登录链路的，拿它取流反而容易被判成异常客户端。
     */
    static String refererForHost(String host) {
        String normalized = host == null ? "" : host.toLowerCase(Locale.ROOT);
        if (matchesHost(normalized, "music.126.net")) return NETEASE_REMOTE_AUDIO_REFERER;
        // 酷狗 CDN 对没有 Referer 的请求有时回错误页；带上官网 Referer 与普通移动 UA 即可。
        if (matchesHost(normalized, "kugou.com")) return "https://www.kugou.com/";
        if (isByteDanceHost(normalized)) return BYTEDANCE_REMOTE_AUDIO_REFERER;
        return REMOTE_AUDIO_REFERER;
    }

    /** 汽水/抖音那批 CDN 主机（含 qishui.com、douyin.com 自身）。 */
    private static boolean isByteDanceHost(String host) {
        if (host.isEmpty()) return false;
        for (String suffix : BYTEDANCE_AUDIO_HOST_SUFFIXES) {
            if (matchesHost(host, suffix)) return true;
        }
        return false;
    }

    /** 主机正好是后缀本身，或者是它的子域。 */
    private static boolean matchesHost(String host, String suffix) {
        return host.equals(suffix) || host.endsWith("." + suffix);
    }

    private static boolean isRemoteAudioHostAllowed(String host) {
        if (host.isEmpty()) return false;
        for (String suffix : REMOTE_AUDIO_HOST_SUFFIXES) {
            if (matchesHost(host, suffix)) return true;
        }
        return false;
    }

    /** 把几组主机后缀并成一份白名单；域名只在各自的数组里写一次。 */
    private static String[] withSuffixes(String[]... groups) {
        int total = 0;
        for (String[] group : groups) total += group.length;
        String[] merged = new String[total];
        int offset = 0;
        for (String[] group : groups) {
            System.arraycopy(group, 0, merged, offset, group.length);
            offset += group.length;
        }
        return merged;
    }

    /** 调用方带来的头里有没有这一条（HTTP 头名不分大小写，Map 的键却是大小写敏感的）。 */
    private static boolean hasHeader(Map<String, String> headers, String name) {
        if (headers == null) return false;
        for (String key : headers.keySet()) {
            if (name.equalsIgnoreCase(key)) return true;
        }
        return false;
    }

    /** 复制进私有目录的音频存放位置。 */
    File importedAudioDirectory() {
        File dir = new File(context.getFilesDir(), "imported-audio");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private void handle(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] requestParts = requestLine.split(" ");
            if (requestParts.length < 2) return;

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0) {
                    headers.put(
                        line.substring(0, separator).trim().toLowerCase(),
                        line.substring(separator + 1).trim()
                    );
                }
            }

            String path = requestParts[1];
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            /*
             * 预检（OPTIONS）必须自己答。
             *
             * 跨源请求只要带了 Range 之外的头、或者某些 WebView 版本对 Range 也走预检，
             * 浏览器就会先发一个 OPTIONS —— 服务不答就是 CORS 失败，
             * 而失败的表现和「文件不存在」一模一样（mediaErrorCode=4）。
             * 答一个 204 并放行 Range，探测和播放两条路都才走得通。
             */
            if ("OPTIONS".equals(requestParts[0])) {
                String response = "HTTP/1.1 204 No Content\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: range, content-range, content-length\r\n"
                    + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
                    + "Access-Control-Max-Age: 86400\r\n"
                    + "Content-Length: 0\r\nConnection: close\r\n\r\n";
                output.write(response.getBytes(StandardCharsets.US_ASCII));
                output.flush();
                return;
            }
            if (path.startsWith(REMOTE_AUDIO_PATH_PREFIX)) {
                streamRemoteAudio(output, client, requestParts, headers, path.substring(REMOTE_AUDIO_PATH_PREFIX.length()));
                return;
            }
            if (!path.startsWith(AUDIO_PATH_PREFIX)) {
                writeStatus(output, 404, "Not Found");
                return;
            }

            String token = URLDecoder.decode(path.substring(AUDIO_PATH_PREFIX.length()), "UTF-8");
            if (token.startsWith(IMPORTED_PREFIX)) {
                /*
                 * 传**完整的** token，别先剥掉 imported- 再拼路径。
                 *
                 * 磁盘上的副本名本身就是 "imported-<稳定名>"（导入那边 safeName 就是这么起的，
                 * 删副本的 resolveImportedFile 也是按完整 ref 拼的），而这里剥掉前缀之后
                 * 拼出来的是 "imported-audio/<稳定名>" —— 少了一段，永远 isFile() == false，
                 * 于是每一首手动导入的歌都回 404：<audio> 报 Format error、
                 * 导入时抓封面和内嵌歌词的那次 fetch 也一起失败（封面/歌词全空）。
                 * 表现正是「扫描导入能播，手动导入一律播不了」。
                 */
                streamImportedFile(output, requestParts, headers, token);
                return;
            }
            if (token.startsWith(FILE_PREFIX)) {
                streamExternalFile(output, requestParts, headers, token.substring(FILE_PREFIX.length()));
                return;
            }
            streamMediaStoreFile(output, requestParts, headers, token);
        } catch (Exception error) {
            // 之前这里连日志都没有：流写到一半断掉，WebView 那边只会报一句
            // Format error，原生侧连发生了什么都不知道。
            Log.w(TAG, "audio request failed", error);
            // 顺带进崩溃诊断：诊断报告里能直接读到 local-audio-server 这条，
            // 不用再让用户去捞 logcat。
            CrashDiagnostics.record(context, "local-audio-server", "server", error);
        }
    }

    private void streamMediaStoreFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String mediaId
    ) throws IOException {
        Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
        ContentResolver resolver = context.getContentResolver();
        long size = -1;
        String mime = "audio/*";
        try (Cursor cursor = resolver.query(uri, new String[]{
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE
        }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                size = cursor.getLong(0);
                String queriedMime = cursor.getString(1);
                if (queriedMime != null && !queriedMime.isEmpty()) mime = queriedMime;
            }
        }
        writeResponse(output, requestParts, headers, size, mime, () -> resolver.openInputStream(uri));
    }

    private void streamImportedFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        // 现在传进来的是完整文件名（含 imported- 前缀）。这个服务监听在 127.0.0.1 上，
        // 设备上任何应用都能连，名字来自 URL，必须挡掉路径穿越。
        if (fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
            Log.w(TAG, "imported audio refused: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        File target = new File(importedAudioDirectory(), fileName);
        if (!target.isFile()) {
            Log.w(TAG, "imported audio missing: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(fileName),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 按绝对路径流用户自己的音频（文件系统兜底扫描的歌）。
     *
     * 只放行外存根目录下的音频文件，别的一律 404 —— 这个服务监听在 127.0.0.1 上，
     * 设备上任何应用都能连上来，不能让它变成一个任读全盘的口子。
     * 走这条路的歌要求已授予「所有文件访问」，没授权时读流会自己失败。
     */
    private void streamExternalFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String encodedPath
    ) throws IOException {
        String filePath = URLDecoder.decode(encodedPath, "UTF-8");
        File target = new File(filePath);
        File root = Environment.getExternalStorageDirectory();
        boolean insideRoot = root != null && filePath.startsWith(root.getPath() + File.separator);
        if (!insideRoot || !target.isFile() || !isAudioFileName(filePath)) {
            Log.w(TAG, "external audio refused: " + filePath);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(filePath),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 代转发一个远端音频（只有白名单主机能用，见 {@link #registerRemoteAudio}）。
     *
     * Range 原样往上带：拖进度条时 <audio> 会发 `bytes=xxx-`，上游回 206，
     * 我们也要回 206 并把它的 Content-Range 转给 WebView，否则播放器会认为
     * 服务端不支持拖动，重新整首下载一次。
     */
    private void streamRemoteAudio(
        BufferedOutputStream output,
        Socket clientSocket,
        String[] requestParts,
        Map<String, String> headers,
        String token
    ) throws IOException {
        String target;
        Map<String, String> extraHeaders;
        boolean scripted;
        synchronized (remoteAudioUrls) {
            target = remoteAudioUrls.get(token);
            extraHeaders = remoteAudioHeaders.get(token);
            scripted = scriptedTokens.contains(token);
        }
        if (target == null) {
            Log.w(TAG, "remote audio token unknown: " + token);
            writeStatus(output, 404, "Not Found");
            return;
        }

        // 洛雪脚本给的地址：过音频那套令牌桶（和脚本的 lx.request 不共用额度），并算在「同时在转发的流」上限里。
        LxLimits.StreamSlot slot = null;
        OkHttpClient client = remoteAudioClient;
        if (scripted) {
            try {
                LxLimits.audioRate().take(hostOfUrl(target));
            } catch (LxLimits.RateLimitedException error) {
                Log.w(TAG, "audio rate limited: " + target);
                writeStatus(output, 429, "Too Many Requests");
                return;
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                writeStatus(output, 503, "Interrupted");
                return;
            }
            slot = LxLimits.streams().begin(token);
            slot.bind(clientSocket);
            client = scriptedAudioClient;
        }

        Request.Builder request = new Request.Builder().url(target);
        // 有些 CDN 看 UA / Referer 决定给不给资源，不带的话会回一段 HTML 而不是音频
        // —— 那种回包喂进 <audio> 正是「Format error」的经典来源。
        //
        // 默认值只补空缺：调用方显式给了 UA / Referer（汽水的 CDN 有时要带自己的）时，
        // 不再写默认值，同名的头以调用方为准。HTTP 头不分大小写，所以这里按忽略大小写判。
        if (!hasHeader(extraHeaders, "user-agent")) {
            request.header("User-Agent", REMOTE_AUDIO_USER_AGENT);
        }
        if (!hasHeader(extraHeaders, "referer")) {
            request.header("Referer", remoteAudioReferer(target));
        }
        // 调用方带来的头（汽水的 Referer/UA、飞牛的 music-token）最后写：同名的以它为准。
        if (extraHeaders != null) {
            for (Map.Entry<String, String> entry : extraHeaders.entrySet()) {
                /*
                 * 空值是「不要发这个头」：注册时带一个空的 referer 就能压掉上面那条默认的 Referer。
                 * 洛雪音源的地址是用户导入的脚本现算的，主机哪家都有，桌面版转发时一条 Referer 都不带
                 * （乱带 www.kuwo.cn 会被别的 CDN 回一段 HTML，喂进 <audio> 就是 Format error）。
                 */
                if (entry.getValue() == null || entry.getValue().isEmpty()) continue;
                request.header(entry.getKey(), entry.getValue());
            }
        }
        String range = headers.get("range");
        if (range != null && range.startsWith("bytes=")) request.header("Range", range);

        Response upstream;
        try {
            upstream = client.newCall(request.build()).execute();
        } catch (IOException error) {
            if (slot != null) LxLimits.streams().release(token);
            throw error;
        }
        try {
            ResponseBody body = upstream.body();
            if (!upstream.isSuccessful() || body == null) {
                Log.w(TAG, "remote audio upstream " + upstream.code() + " for " + target);
                writeStatus(output, 502, "Upstream Error");
                return;
            }
            String contentType = body.contentType() != null ? body.contentType().toString() : "audio/mpeg";
            String contentRange = upstream.header("Content-Range");
            long size = body.contentLength();
            // 上游不给长度（chunked）时用 Content-Range 兜底，但要分清是哪一段：
            // 206 的 Content-Length 必须是「这一段」的字节数，拿 Content-Range 里的 total
            // 顶上去，发出去的字节比头部声明少，播放器就会一直等剩下的数据（拖进度条后卡住）；
            // 200 的 Content-Length 才是整首长度。
            if (size < 0 && contentRange != null) {
                size = upstream.code() == 206
                    ? contentRangeWidth(contentRange)
                    : contentRangeTotal(contentRange);
            }
            boolean partial = upstream.code() == 206 || contentRange != null;

            Log.i(TAG, "remote " + target + " -> " + upstream.code()
                + " type=" + contentType + " size=" + size + " range=" + (contentRange == null ? "-" : contentRange));

            StringBuilder response = new StringBuilder();
            response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            response.append("Content-Type: ").append(contentType).append("\r\n");
            response.append("Accept-Ranges: bytes\r\n");
            // 这一整条链路存在的唯一理由就是同源：没有这两行，<audio crossOrigin="anonymous">
            // 依然会被 CORS 挡在门外，和直连 CDN 没区别。
            response.append("Access-Control-Allow-Origin: *\r\n");
            response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
            response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
            response.append("Connection: close\r\n");
            if (size >= 0) {
                response.append("Content-Length: ").append(size).append("\r\n");
                if (contentRange != null) {
                    response.append("Content-Range: ").append(contentRange).append("\r\n");
                }
            }
            response.append("\r\n");
            output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

            if ("GET".equals(requestParts[0])) {
                try (InputStream audio = body.byteStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = audio.read(buffer)) != -1) {
                        if (slot != null) {
                            if (!slot.addBytes(read)) {
                                // 一条流最多 4 GiB（桌面 guardStream 的 maxBytes）。
                                Log.w(TAG, "audio stream over the size limit, closing: " + target + " (" + slot.bytesSoFar() + " bytes)");
                                break;
                            }
                            LxLimits.streams().touch(token);
                        }
                        output.write(buffer, 0, read);
                    }
                }
            }
            output.flush();
        } finally {
            upstream.close();
            if (slot != null) LxLimits.streams().release(token);
        }
    }

    /** 限速按主机记账：取地址的主机名（取不到就给空串，和别处一样当同一个未知去处）。 */
    private static String hostOfUrl(String value) {
        try {
            String host = new URL(value).getHost();
            return host == null ? "" : host;
        } catch (Exception error) {
            return "";
        }
    }

    private interface StreamSupplier {
        InputStream open() throws IOException;
    }

    /** "bytes 100-199/1000" → 100（这一段有多少字节）；解析不出来回 -1。 */
    private static long contentRangeWidth(String contentRange) {
        int space = contentRange.indexOf(' ');
        int dash = space < 0 ? -1 : contentRange.indexOf('-', space + 1);
        int slash = dash < 0 ? -1 : contentRange.indexOf('/', dash + 1);
        if (dash < 0 || slash < 0) return -1;
        try {
            long start = Long.parseLong(contentRange.substring(space + 1, dash).trim());
            long end = Long.parseLong(contentRange.substring(dash + 1, slash).trim());
            return end - start + 1;
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    /** "bytes 100-199/1000" → 1000（整首有多大）；解析不出来回 -1。 */
    private static long contentRangeTotal(String contentRange) {
        int slash = contentRange.indexOf('/');
        if (slash < 0 || slash + 1 >= contentRange.length()) return -1;
        try {
            return Long.parseLong(contentRange.substring(slash + 1).trim());
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private void writeResponse(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        long size,
        String mime,
        StreamSupplier supplier
    ) throws IOException {
        // 空文件喂给 <audio> 只会换来一句莫名的 MEDIA_ELEMENT_ERROR: Format error；
        // 这里直接 404 并把原因写进日志，下次一眼就能看出是"文件是空的"。
        if (size <= 0) {
            Log.w(TAG, "audio source is empty or unreadable (size=" + size + "): " + requestParts[1]);
            writeStatus(output, 404, "Empty Audio");
            return;
        }
        long start = 0;
        long end = size > 0 ? size - 1 : -1;
        String range = headers.get("range");
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-", -1);
            try {
                if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1]);
                if (size > 0) end = Math.min(end, size - 1);
                partial = true;
            } catch (NumberFormatException ignored) {
                start = 0;
                end = size > 0 ? size - 1 : -1;
                partial = false;
            }
        }

        long contentLength = end >= start ? end - start + 1 : -1;
        Log.i(TAG, requestParts[0] + " " + requestParts[1]
            + " range=" + (range == null ? "-" : range)
            + " size=" + size + " partial=" + partial
            + (partial ? " bytes=" + start + "-" + end : ""));
        StringBuilder response = new StringBuilder();
        response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(mime).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Access-Control-Allow-Origin: *\r\n");
        // crossOrigin="anonymous" 的 <audio> 会带 CORS 语义，把 Range 相关头暴露出来，
        // 拖进度条（发 Range、读 Content-Range）才不会在 CORS 检查上被拦。
        response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
        response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
        response.append("Connection: close\r\n");
        if (size > 0) {
            response.append("Content-Length: ").append(contentLength).append("\r\n");
            if (partial) {
                response.append("Content-Range: bytes ")
                    .append(start).append('-').append(end).append('/').append(size).append("\r\n");
            }
        }
        response.append("\r\n");
        output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

        // HEAD 只回头部：<audio> 在真正下载前会先探一次，那时不能把整首歌读一遍。
        if ("GET".equals(requestParts[0])) {
            try (InputStream audio = supplier.open()) {
                if (audio != null) {
                    skipFully(audio, start);
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = contentLength;
                    int read;
                    while ((read = audio.read(buffer)) != -1 && (remaining < 0 || remaining > 0)) {
                        int writeLength = remaining < 0 ? read : (int) Math.min(read, remaining);
                        output.write(buffer, 0, writeLength);
                        if (remaining > 0) remaining -= writeLength;
                    }
                }
            }
        }
        output.flush();
    }

    /**
     * InputStream.skip 不保证一次跳够（它爱跳多少跳多少），文件流上偶尔也会短跳。
     * 之前直接一个 skip 了事，短跳时从错误的位置开始发 —— 解码器读到的就是一段
     * 被错位的数据，表现正是「MEDIA_ELEMENT_ERROR: Format error」这类莫名失败。
     */
    private static void skipFully(InputStream audio, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = audio.skip(remaining);
            if (skipped <= 0) {
                // skip 返回 0 只能靠读来推进（可能已经到头）。
                if (audio.read() == -1) return;
                skipped = 1;
            }
            remaining -= skipped;
        }
    }

    /** 路径是不是设备上常见的音频扩展名（文件系统兜底扫描与 file- 路由共用）。 */
    static boolean isAudioFileName(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        return lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".wav")
            || lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".ogg")
            || lower.endsWith(".opus") || lower.endsWith(".ape") || lower.endsWith(".wma");
    }

    static String guessMimeType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ape")) return "audio/ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/mpeg";
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
        }
        return value == -1 && line.length() == 0 ? null : line.toString();
    }

    /**
     * 错误响应也一定要带 CORS 头。
     *
     * <audio> 带 crossOrigin="anonymous"，响应缺 Access-Control-Allow-Origin 时，
     * 浏览器把「CORS 被拒」和「文件不存在 / 空文件」报成一模一样的东西：
     * networkState=3、mediaErrorCode=4（MEDIA_ERR_SRC_NOT_SUPPORTED）——
     * 也就是那句毫无特征的 MEDIA_ELEMENT_ERROR: Format error。
     * 带上 ACAO 之后，上层用 fetch 探一次就能读到真实的 404/502，不用再猜。
     */
    private static void writeStatus(OutputStream output, int status, String message) throws IOException {
        String response = "HTTP/1.1 " + status + " " + message + "\r\n"
            + "Content-Type: text/plain\r\n"
            + "Content-Length: 0\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: range, content-range, content-length\r\n"
            + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
            + "Connection: close\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }
}
