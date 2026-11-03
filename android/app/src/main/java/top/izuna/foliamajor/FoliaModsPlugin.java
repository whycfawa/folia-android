package top.izuna.foliamajor;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 安卓端 Folium 模组宿主（仅客户端模组）。
 *
 * 负责模组的安装（zip 或目录选择）、删除、启用状态与内容摘要；client.mjs 的加载与
 * folium API 的接入在 WebView 里进行。main 入口（index.cjs）在 Android 上不受支持：
 * 导入时发现 index.cjs 直接拒绝，并给出原因。
 */
@CapacitorPlugin(name = "FoliaMods")
public class FoliaModsPlugin extends Plugin {
    private static final String TAG = "FoliaMods";

    private boolean importOpen;
    private final Set<String> importing = ConcurrentHashMap.newKeySet();
    private FoliaModsServer server;

    private FoliaModsServer server() {
        if (server == null) server = new FoliaModsServer(getContext());
        return server;
    }

    private File modsDir() {
        File dir = new File(getContext().getFilesDir(), "mods");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) return null;
        return dir;
    }

    private static File findManifest(File dir) {
        File direct = new File(dir, "mod.json");
        if (direct.isFile()) return direct;
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) {
                    File nested = new File(child, "mod.json");
                    if (nested.isFile()) return nested;
                }
            }
        }
        return null;
    }

    private static String sha256(File file) throws IOException {
        try (InputStream input = new java.io.FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.US, "%02x", value));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 is unavailable", error);
        }
    }

    /** 清单里必须没有 main 入口；有的话返回原因，安卓不支持主进程模组。 */
    private static String unsupportedReason(File manifest) {
        try {
            byte[] bytes = new byte[(int) Math.min(manifest.length(), 65536)];
            try (InputStream input = new FileInputStream(manifest)) {
                int read = 0, n;
                while (read < bytes.length && (n = input.read(bytes, read, bytes.length - read)) > 0) read += n;
            }
            String json = new String(bytes, StandardCharsets.UTF_8);
            if (json.matches("(?s).*\"main\"\\s*:\\s*\"[^\"]+\".*")) {
                return "这个模组带有 main（Node 主进程）入口，Android 暂不支持";
            }
            return null;
        } catch (IOException error) {
            return "mod.json 无法读取: " + error.getMessage();
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray mods = new JSArray();
        File dir = modsDir();
        if (dir != null && dir.isDirectory()) {
            File[] children = dir.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (!child.isDirectory()) continue;
                    File manifest = findManifest(child);
                    if (manifest == null) continue;
                    try {
                        String json = new String(readAllBytes(manifest), StandardCharsets.UTF_8);
                        JSObject item = new JSObject();
                        item.put("id", child.getName());
                        item.put("dir", child.getName());
                        item.put("manifest", json);
                        item.put("digest", sha256(manifest));
                        item.put("enabled", enabled(child.getName()));
                        String client = readStringField(manifest, "client");
                        String base = server().baseUrl();
                        if (client != null && !client.isEmpty() && !base.isEmpty()) {
                            item.put("clientUrl", base + "/" + child.getName() + "/" + client);
                        }
                        mods.put(item);
                    } catch (Exception error) {
                        Log.w(TAG, "mod manifest read failed: " + child, error);
                    }
                }
            }
        }
        JSObject result = new JSObject();
        result.put("mods", mods);
        call.resolve(result);
    }

    /** 打开系统文件选择器导入 zip；handleImportedZip 收结果。 */
    @PluginMethod
    public void importZip(PluginCall call) {
        if (importOpen) {
            call.reject("A mod import is already open");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*");
        importOpen = true;
        startActivityForResult(call, intent, "handleImportedZip");
    }

    @ActivityCallback
    private void handleImportedZip(PluginCall call, ActivityResult result) {
        importOpen = false;
        if (call == null) return;
        int code = result == null ? android.app.Activity.RESULT_CANCELED : result.getResultCode();
        Uri uri = result != null && result.getData() != null ? result.getData().getData() : null;
        if (code != android.app.Activity.RESULT_OK || uri == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        if (!importing.add("zip")) {
            call.reject("import-in-progress");
            return;
        }
        com.getcapacitor.PluginCall pending = call;
        new Thread(() -> {
            try {
                String modId = installZip(getContext(), uri);
                JSObject answer = new JSObject();
                answer.put("imported", modId);
                pending.resolve(answer);
            } catch (Exception error) {
                Log.w(TAG, "mod import failed", error);
                pending.reject(error.getMessage() == null ? "mod import failed" : error.getMessage(), error);
            } finally {
                importing.remove("zip");
            }
        }).start();
    }

    /** 把 zip 解到临时目录，检查 mod.json 与 main 入口，再整个搬进 mods/<id>。 */
    static String installZip(Context context, Uri uri) throws IOException {
        File staging = new File(context.getCacheDir(), "mod-install-" + System.nanoTime());
        if (!staging.mkdirs()) throw new IOException("could not create a staging directory");
        try {
            File manifest = null;
            InputStream raw = context.getContentResolver().openInputStream(uri);
            if (raw == null) throw new IOException("cannot read the zip");
            try (java.util.zip.ZipInputStream zip = new java.util.zip.ZipInputStream(raw, StandardCharsets.UTF_8)) {
                java.util.zip.ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    String name = entry.getName();
                    if (name.startsWith("__MACOSX/") || name.contains("/.")) continue;
                    File target = new File(staging, name);
                    if (!target.getCanonicalPath().startsWith(staging.getCanonicalPath() + File.separator)
                            && !target.getCanonicalPath().equals(staging.getCanonicalPath())) {
                        throw new IOException("the zip has an unsafe path: " + name);
                    }
                    if (entry.isDirectory()) {
                        //noinspection ResultOfMethodCallIgnored
                        target.mkdirs();
                        continue;
                    }
                    //noinspection ResultOfMethodCallIgnored
                    target.getParentFile().mkdirs();
                    try (OutputStream output = new FileOutputStream(target)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = zip.read(buffer)) > 0) output.write(buffer, 0, read);
                    }
                    if (name.endsWith("mod.json")) manifest = manifest == null ? target : manifest;
                }
            }
            if (manifest == null) throw new IOException("the zip has no mod.json");
            String reason = unsupportedReason(manifest);
            if (reason != null) throw new IOException(reason);
            File modRoot = manifest.getParentFile();
            String modId = readModId(manifest);
            if (modId == null || modId.isEmpty()) throw new IOException("mod.json has no id");
            File dir = modsDir(context);
            if (dir == null) throw new IOException("the mods directory is unavailable");
            File destination = new File(dir, modId);
            if (destination.exists()) deleteRecursive(destination);
            if (!modRoot.renameTo(destination)) {
                copyRecursive(modRoot, destination);
                deleteRecursive(modRoot);
            }
            return modId;
        } finally {
            deleteRecursive(staging);
        }
    }

    private static String readModId(File manifest) throws IOException {
        return readStringField(manifest, "id");
    }

    private static String readStringField(File manifest, String field) throws IOException {
        String json = new String(readAllBytes(manifest), StandardCharsets.UTF_8);
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("\"" + field + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }

    private boolean enabled(String id) {
        return getContext().getSharedPreferences("folia_mods", 0).getBoolean("enabled:" + id, false);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        String id = call.getString("id", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (id == null || id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        getContext().getSharedPreferences("folia_mods", 0).edit().putBoolean("enabled:" + id, enabled).apply();
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        if (server != null) server.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id", "");
        File dir = modsDir();
        File target = dir == null ? null : new File(dir, id);
        boolean deleted = target != null && target.isDirectory() && deleteRecursive(target);
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    /** 客户端读取某模组文件的内容（mod.json / client.mjs / 静态资源）。 */
    @PluginMethod
    public void readFile(PluginCall call) {
        String dir = call.getString("dir", "");
        String path = call.getString("path", "");
        File root = modsDir();
        if (root == null || dir.isEmpty() || path.isEmpty()) {
            call.reject("dir and path are required");
            return;
        }
        File file = new File(new File(root, dir), path);
        try {
            if (!file.getCanonicalPath().startsWith(new File(root, dir).getCanonicalPath())) {
                call.reject("path escapes the mod directory");
                return;
            }
        } catch (IOException error) {
            call.reject("bad path");
            return;
        }
        if (!file.isFile()) {
            call.reject("not found: " + path);
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("base64", android.util.Base64.encodeToString(readAllBytes(file), android.util.Base64.NO_WRAP));
            call.resolve(result);
        } catch (IOException error) {
            call.reject("read failed: " + error.getMessage(), error);
        }
    }

    private static File modsDir(Context context) {
        File dir = new File(context.getFilesDir(), "mods");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) return null;
        return dir;
    }

    private static byte[] readAllBytes(File file) throws IOException {
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private static void copyRecursive(File from, File to) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        to.mkdirs();
        File[] children = from.listFiles();
        if (children == null) return;
        for (File child : children) {
            File target = new File(to, child.getName());
            if (child.isDirectory()) copyRecursive(child, target);
            else try (InputStream in = new FileInputStream(child); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            }
        }
    }

    private static boolean deleteRecursive(File target) {
        if (target.isFile()) return target.delete();
        File[] children = target.listFiles();
        if (children != null) for (File child : children) deleteRecursive(child);
        return target.delete();
    }
}
