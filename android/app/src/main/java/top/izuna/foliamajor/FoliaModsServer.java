package top.izuna.foliamajor;

import android.content.Context;
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
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 模组文件的本地回环服务：client.mjs 以及它相对导入的 vendor/资源都从这里取。
 * 只绑 127.0.0.1，路径带随机 token；WebView 用 http://127.0.0.1:port/token/<mod>/client.mjs 动态 import。
 */
final class FoliaModsServer {
    private static final String TAG = "FoliaModsServer";

    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final String token = Long.toHexString(Double.doubleToLongBits(Math.random()));
    private ServerSocket serverSocket;
    private int port;

    FoliaModsServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized String baseUrl() {
        if (serverSocket == null || serverSocket.isClosed()) {
            try {
                serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
                port = serverSocket.getLocalPort();
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
            } catch (IOException error) {
                Log.w(TAG, "failed to bind the mods server", error);
                serverSocket = null;
                port = 0;
            }
        }
        return port > 0 ? "http://127.0.0.1:" + port + "/" + token : "";
    }

    synchronized void stop() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        serverSocket = null;
        port = 0;
    }

    private void handle(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(15000);
            BufferedInputStream input = new BufferedInputStream(client.getInputStream());
            String request = readLine(input);
            if (request == null) return;
            String[] parts = request.split(" ");
            if (parts.length < 2) return;
            while (true) {
                String header = readLine(input);
                if (header == null || header.isEmpty()) break;
            }
            if ("OPTIONS".equalsIgnoreCase(parts[0])) {
                writeHead(client.getOutputStream(), 204, 0, "text/plain", "");
                return;
            }
            String path = URLDecoder.decode(parts[1].split("\\?")[0], "UTF-8");
            String prefix = "/" + token + "/";
            if (!path.startsWith(prefix)) {
                writeHead(client.getOutputStream(), 404, 0, "text/plain", "");
                return;
            }
            String relative = path.substring(prefix.length());
            File root = modsDir();
            File file = root == null ? null : new File(root, relative);
            if (file == null || !file.isFile()) {
                writeHead(client.getOutputStream(), 404, 0, "text/plain", "");
                return;
            }
            if (!file.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) {
                writeHead(client.getOutputStream(), 403, 0, "text/plain", "");
                return;
            }
            long length = file.length();
            String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: " + mime(file.getName()) + "\r\n"
                    + "Content-Length: " + length + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Cache-Control: no-cache\r\n"
                    + "Connection: close\r\n\r\n";
            OutputStream output = client.getOutputStream();
            output.write(head.getBytes(StandardCharsets.ISO_8859_1));
            try (InputStream from = new FileInputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = from.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            output.flush();
        } catch (Exception error) {
            Log.w(TAG, "mod file request failed", error);
        }
    }

    private static void writeHead(OutputStream output, int code, long length, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + " " + (code == 204 ? "No Content" : "Not Found") + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + (code == 204 ? 0 : bytes.length) + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
        output.write(head.getBytes(StandardCharsets.ISO_8859_1));
        if (code != 204) output.write(bytes);
        output.flush();
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

    private static String mime(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".mjs") || lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private File modsDir() {
        File dir = new File(context.getFilesDir(), "mods");
        return dir.isDirectory() ? dir : null;
    }
}
