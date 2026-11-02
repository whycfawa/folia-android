package top.izuna.foliamajor;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 分析模型权重的本地回环服务。
 *
 * WebView 不能直接读 assets 里的 40/88MB 文件，桥也不适合把这么大的 ArrayBuffer 走 JSON。
 * 这里把 assets/models 里的权重按需复制到 cache，再以 HTTP 暴露给渲染层的 fetch；
 * 只绑 127.0.0.1，路径带随机 token，别的本地程序读不到。
 */
final class AnalysisModelServer {
    private static final String TAG = "AnalysisModelServer";
    private static final String[] FILES = {"beat_this-wgsl.bin", "htdemucs-wgsl.bin"};

    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final String token = Long.toHexString(Double.doubleToLongBits(Math.random()));

    private ServerSocket serverSocket;
    private int port;

    AnalysisModelServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized boolean start() {
        if (serverSocket != null && !serverSocket.isClosed()) return true;
        try {
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = serverSocket.getLocalPort();
        } catch (IOException error) {
            Log.w(TAG, "failed to bind the model server", error);
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
        Log.i(TAG, "model server on 127.0.0.1:" + port);
        return true;
    }

    synchronized void stop() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        serverSocket = null;
        port = 0;
    }

    synchronized String url(String name) {
        if (!start() || port <= 0 || !allowed(name)) return "";
        return "http://127.0.0.1:" + port + "/" + token + "/" + name;
    }

    private static boolean allowed(String name) {
        for (String file : FILES) if (file.equals(name)) return true;
        return false;
    }

    private void handle(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(20000);
            BufferedInputStream input = new BufferedInputStream(client.getInputStream());
            String requestLine = readLine(input);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            while (true) {
                String header = readLine(input);
                if (header == null || header.isEmpty()) break;
            }
            if ("OPTIONS".equalsIgnoreCase(parts[0])) {
                writeEmpty(client.getOutputStream(), 204, "");
                return;
            }
            String path = parts[1];
            String prefix = "/" + token + "/";
            if (!path.startsWith(prefix)) {
                writeEmpty(client.getOutputStream(), 404, "");
                return;
            }
            String name = path.substring(prefix.length());
            if (!allowed(name)) {
                writeEmpty(client.getOutputStream(), 404, "");
                return;
            }
            File file = materialize(name);
            if (file == null || !file.isFile() || file.length() <= 0) {
                writeEmpty(client.getOutputStream(), 500, "");
                return;
            }
            stream(file, client.getOutputStream());
        } catch (Exception error) {
            Log.w(TAG, "model request failed", error);
        }
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
            if (line.length() > 8192) break;
        }
        return line.toString();
    }

    private static void writeEmpty(OutputStream output, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + " " + (code == 204 ? "No Content" : "Not Found") + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: range\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Connection: close\r\n\r\n";
        output.write(head.getBytes(StandardCharsets.ISO_8859_1));
        output.write(bytes);
        output.flush();
    }

    private void stream(File file, OutputStream output) throws IOException {
        long total = file.length();
        String head = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: application/octet-stream\r\n"
                + "Content-Length: " + total + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Accept-Ranges: bytes\r\n"
                + "Cache-Control: public, max-age=31536000, immutable\r\n"
                + "Connection: close\r\n\r\n";
        output.write(head.getBytes(StandardCharsets.ISO_8859_1));
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
        }
        output.flush();
    }

    private File materialize(String name) {
        // 按需下载落在私有目录 models/；旧安装包里自带的 assets 仍然作为后备。
        File installed = AnalysisModelDownloader.target(context, name);
        if (installed != null && installed.isFile() && installed.length() > 0) return installed;
        try {
            File dir = new File(context.getCacheDir(), "analysis-models/" + versionTag());
            if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) return null;
            File target = new File(dir, name);
            if (target.isFile() && target.length() > 0) return target;
            File temporary = new File(dir, name + ".partial");
            try (InputStream input = context.getAssets().open("models/" + name);
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temporary))) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            if (!temporary.renameTo(target)) {
                // 上一次失败留下的 partial 可能还在；先删目标再改名。
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                if (!temporary.renameTo(target)) return null;
            }
            return target;
        } catch (Exception error) {
            Log.w(TAG, "could not materialize " + name, error);
            return null;
        }
    }

    private String versionTag() {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return String.format(Locale.US, "%s-%d", info.versionName, info.versionCode).replaceAll("[^A-Za-z0-9._-]", "_");
        } catch (Exception ignored) {
            return "current";
        }
    }
}
